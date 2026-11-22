import { JITA_STATION_ID, THE_FORGE_REGION_ID } from '../config.js';
import { getDb, withTransaction } from '../db/database.js';
import { esiFetchJson, getEsiRateState } from './esiClient.js';
import { runIncrementalHistoryBackfill } from './historySync.js';
import { isSdePopulated, resolveUnknownTypeIds, syncSdeData } from './sdeSync.js';

export interface EsiMarketOrder {
  order_id: number;
  type_id: number;
  location_id: number;
  is_buy_order: boolean;
  price: number;
  volume_remain: number;
  volume_total: number;
  min_volume: number;
  duration: number;
  issued: string;
}

export interface OrderSyncProgress {
  running: boolean;
  stage: string;
  pagesDone: number;
  totalPages: number;
  jitaOrdersCount: number;
  lastError: string | null;
}

const syncState: OrderSyncProgress = {
  running: false,
  stage: 'idle',
  pagesDone: 0,
  totalPages: 0,
  jitaOrdersCount: 0,
  lastError: null,
};

let activeOrderSync: Promise<{
  ordersFetched: number;
  jitaOrders: number;
  itemsUpdated: number;
}> | null = null;

export function getOrderSyncProgress(): OrderSyncProgress {
  return { ...syncState };
}

export async function syncJitaOrders(options: {
  triggerHistoryBackfill?: boolean;
} = {}): Promise<{ ordersFetched: number; jitaOrders: number; itemsUpdated: number }> {
  if (activeOrderSync) return activeOrderSync;

  const { triggerHistoryBackfill = true } = options;

  activeOrderSync = (async () => {
    const db = getDb();
    const startedAt = new Date().toISOString();
    const runInfo = db
      .prepare('INSERT INTO sync_runs (kind, status, started_at, detail) VALUES (?, ?, ?, ?)')
      .run('orders', 'running', startedAt, 'Fetching Jita 4-4 market orders from ESI');
    const runId = Number(runInfo.lastInsertRowid);

    syncState.running = true;
    syncState.stage = 'checking_sde';
    syncState.pagesDone = 0;
    syncState.totalPages = 0;
    syncState.jitaOrdersCount = 0;
    syncState.lastError = null;

    try {
      if (!isSdePopulated()) {
        syncState.stage = 'syncing_sde';
        try {
          await syncSdeData();
        } catch (sdeErr) {
          console.warn(
            '[orderSync] SDE sync failed, continuing with ESI order sync & /universe/names fallback:',
            sdeErr,
          );
        }
      }

      syncState.stage = 'fetching_orders';
      const firstPage = await esiFetchJson<EsiMarketOrder[]>(
        `/markets/${THE_FORGE_REGION_ID}/orders/?order_type=all&page=1`,
      );
      const totalPages = Math.max(1, Number(firstPage.headers.get('x-pages') ?? '1'));
      syncState.totalPages = totalPages;
      syncState.pagesDone = 1;

      const jitaOrdersById = new Map<number, EsiMarketOrder>();
      let totalForgeOrders = Array.isArray(firstPage.data) ? firstPage.data.length : 0;

      if (Array.isArray(firstPage.data)) {
        for (const order of firstPage.data) {
          if (order.location_id === JITA_STATION_ID) {
            jitaOrdersById.set(order.order_id, order);
          }
        }
      }
      syncState.jitaOrdersCount = jitaOrdersById.size;

      if (totalPages > 1) {
        let nextPage = 2;
        const concurrency = 8;

        const workers = Array.from({ length: concurrency }, async () => {
          while (true) {
            if (getEsiRateState().errorLimitRemain < 15) {
              throw new Error('ESI error limit low while syncing order book');
            }
            const page = nextPage++;
            if (page > totalPages) break;

            const res = await esiFetchJson<EsiMarketOrder[]>(
              `/markets/${THE_FORGE_REGION_ID}/orders/?order_type=all&page=${page}`,
              { allowNotFound: true },
            );
            if (Array.isArray(res.data)) {
              totalForgeOrders += res.data.length;
              for (const order of res.data) {
                if (order.location_id === JITA_STATION_ID) {
                  jitaOrdersById.set(order.order_id, order);
                }
              }
            }
            syncState.pagesDone++;
            syncState.jitaOrdersCount = jitaOrdersById.size;
          }
        });

        await Promise.all(workers);
      }

      const allJitaOrders = Array.from(jitaOrdersById.values());
      syncState.stage = 'aggregating';
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const oneHourAgo = now - 3600_000;
      const twentyFourHoursAgo = now - 24 * 3600_000;

      const byType = new Map<number, { buys: EsiMarketOrder[]; sells: EsiMarketOrder[] }>();
      for (const order of allJitaOrders) {
        let bucket = byType.get(order.type_id);
        if (!bucket) {
          bucket = { buys: [], sells: [] };
          byType.set(order.type_id, bucket);
        }
        if (order.is_buy_order) {
          if (order.min_volume <= order.volume_remain) {
            bucket.buys.push(order);
          }
        } else {
          bucket.sells.push(order);
        }
      }

      interface SummaryRow {
        type_id: number;
        best_bid: number | null;
        best_ask: number | null;
        raw_best_bid: number | null;
        bid_min_volume: number;
        bid_volume: number;
        ask_volume: number;
        buy_order_count: number;
        sell_order_count: number;
        top_buy_competition: number;
        top_sell_competition: number;
        recent_updates_1h: number;
        recent_updates_24h: number;
      }

      const summaries: SummaryRow[] = [];

      for (const [typeId, { buys, sells }] of byType.entries()) {
        let rawBestBid: number | null = null;
        let rawBestBidMinVol = 1;
        let singleUnitBestBid: number | null = null;
        let bidVolume = 0;
        let recent1h = 0;
        let recent24h = 0;

        for (const b of buys) {
          bidVolume += b.volume_remain;
          if (rawBestBid === null || b.price > rawBestBid) {
            rawBestBid = b.price;
            rawBestBidMinVol = b.min_volume;
          }
          if (b.min_volume <= 1 && (singleUnitBestBid === null || b.price > singleUnitBestBid)) {
            singleUnitBestBid = b.price;
          }
          const issuedMs = Date.parse(b.issued);
          if (issuedMs >= oneHourAgo) recent1h++;
          if (issuedMs >= twentyFourHoursAgo) recent24h++;
        }

        let bestAsk: number | null = null;
        let askVolume = 0;
        for (const s of sells) {
          askVolume += s.volume_remain;
          if (bestAsk === null || s.price < bestAsk) {
            bestAsk = s.price;
          }
          const issuedMs = Date.parse(s.issued);
          if (issuedMs >= oneHourAgo) recent1h++;
          if (issuedMs >= twentyFourHoursAgo) recent24h++;
        }

        const bestBid = singleUnitBestBid ?? rawBestBid;
        let topBuyComp = 0;
        if (bestBid !== null) {
          const threshold = bestBid * 0.98;
          for (const b of buys) {
            if (b.price >= threshold) topBuyComp++;
          }
        }

        let topSellComp = 0;
        if (bestAsk !== null) {
          const threshold = bestAsk * 1.02;
          for (const s of sells) {
            if (s.price <= threshold) topSellComp++;
          }
        }

        summaries.push({
          type_id: typeId,
          best_bid: bestBid,
          best_ask: bestAsk,
          raw_best_bid: rawBestBid,
          bid_min_volume: rawBestBidMinVol,
          bid_volume: bidVolume,
          ask_volume: askVolume,
          buy_order_count: buys.length,
          sell_order_count: sells.length,
          top_buy_competition: topBuyComp,
          top_sell_competition: topSellComp,
          recent_updates_1h: recent1h,
          recent_updates_24h: recent24h,
        });
      }

      syncState.stage = 'persisting';
      const pruneBefore = new Date(now - 7 * 24 * 3600_000).toISOString();

      withTransaction(db, () => {
        db.prepare('DELETE FROM jita_orders').run();
        const insertOrder = db.prepare(`
          INSERT OR REPLACE INTO jita_orders (
            order_id, type_id, is_buy_order, price, volume_remain, volume_total, min_volume, duration, issued
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const o of allJitaOrders) {
          insertOrder.run(
            o.order_id,
            o.type_id,
            o.is_buy_order ? 1 : 0,
            o.price,
            o.volume_remain,
            o.volume_total,
            o.min_volume,
            o.duration,
            o.issued,
          );
        }

        db.prepare('DELETE FROM market_summary').run();
        const insertSummary = db.prepare(`
          INSERT INTO market_summary (
            type_id, best_bid, best_ask, raw_best_bid, bid_min_volume,
            bid_volume, ask_volume, buy_order_count, sell_order_count,
            top_buy_competition, top_sell_competition, recent_updates_1h, recent_updates_24h, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertSnapshot = db.prepare(`
          INSERT INTO market_snapshots (
            captured_at, type_id, best_bid, best_ask, buy_order_count, sell_order_count, recent_updates_1h
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const s of summaries) {
          insertSummary.run(
            s.type_id,
            s.best_bid,
            s.best_ask,
            s.raw_best_bid,
            s.bid_min_volume,
            s.bid_volume,
            s.ask_volume,
            s.buy_order_count,
            s.sell_order_count,
            s.top_buy_competition,
            s.top_sell_competition,
            s.recent_updates_1h,
            s.recent_updates_24h,
            nowIso,
          );

          if (s.best_bid !== null && s.best_ask !== null) {
            insertSnapshot.run(
              nowIso,
              s.type_id,
              s.best_bid,
              s.best_ask,
              s.buy_order_count,
              s.sell_order_count,
              s.recent_updates_1h,
            );
          }
        }

        db.prepare('DELETE FROM market_snapshots WHERE captured_at < ?').run(pruneBefore);
      });

      const resolvedNewTypes = await resolveUnknownTypeIds(Array.from(byType.keys()));
      const detailMsg = `Synced ${allJitaOrders.length.toLocaleString()} Jita 4-4 orders across ${summaries.length.toLocaleString()} items (${totalForgeOrders.toLocaleString()} regional orders)${resolvedNewTypes > 0 ? `, resolved ${resolvedNewTypes} new names` : ''}`;

      db.prepare(
        'UPDATE sync_runs SET status = ?, finished_at = ?, orders_fetched = ?, items_updated = ?, detail = ? WHERE id = ?',
      ).run('completed', new Date().toISOString(), allJitaOrders.length, summaries.length, detailMsg, runId);

      syncState.stage = 'idle';

      if (triggerHistoryBackfill) {
        void runIncrementalHistoryBackfill(120).catch((err) => {
          console.error('[historySync] background backfill error:', err);
        });
      }

      return {
        ordersFetched: totalForgeOrders,
        jitaOrders: allJitaOrders.length,
        itemsUpdated: summaries.length,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      syncState.lastError = msg;
      syncState.stage = 'error';
      db.prepare(
        'UPDATE sync_runs SET status = ?, finished_at = ?, error_message = ? WHERE id = ?',
      ).run('failed', new Date().toISOString(), msg, runId);
      throw error;
    } finally {
      syncState.running = false;
      activeOrderSync = null;
    }
  })();

  return activeOrderSync;
}
