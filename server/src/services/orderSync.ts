import {
  getHubById,
  getHubsByRegion,
  getUniqueHubRegions,
  matchOrderToHubs,
  TRADE_HUBS,
  type HubId,
  type TradeHubDefinition,
} from '../config.js';
import { getDb, withTransaction } from '../db/database.js';
import { esiFetchJson, getEsiRateState } from './esiClient.js';
import { runIncrementalHistoryBackfill } from './historySync.js';
import { isSdePopulated, resolveUnknownTypeIds, syncSdeData } from './sdeSync.js';

export interface EsiMarketOrder {
  order_id: number;
  type_id: number;
  location_id: number;
  system_id?: number;
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
  syncScope: HubId | 'all' | null;
  currentHubId: HubId | null;
  hubsDone: number;
  totalHubs: number;
  pagesDone: number;
  totalPages: number;
  jitaOrdersCount: number;
  ordersCount: number;
  lastError: string | null;
}

export interface HubSyncFreshness {
  hubId: HubId;
  name: string;
  shortName: string;
  stationName: string;
  stationCode: string;
  regionId: number;
  regionName: string;
  security: number;
  isLowSec: boolean;
  accentColor: string;
  lastSyncedAt: string | null;
  twoSidedItems: number;
  totalOrders: number;
}

const syncState: OrderSyncProgress = {
  running: false,
  stage: 'idle',
  syncScope: null,
  currentHubId: null,
  hubsDone: 0,
  totalHubs: 0,
  pagesDone: 0,
  totalPages: 0,
  jitaOrdersCount: 0,
  ordersCount: 0,
  lastError: null,
};

let activeOrderSync: Promise<{
  ordersFetched: number;
  jitaOrders: number;
  ordersSynced: number;
  itemsUpdated: number;
  hubsUpdated: HubId[];
}> | null = null;

export function getOrderSyncProgress(): OrderSyncProgress {
  return { ...syncState };
}

export function getHubSyncFreshness(): HubSyncFreshness[] {
  const db = getDb();

  const summaryRows = db
    .prepare(`
      SELECT hub_id, COUNT(*) AS cnt
      FROM market_summary
      WHERE best_bid IS NOT NULL AND best_ask IS NOT NULL AND best_bid > 0 AND best_ask > 0
      GROUP BY hub_id
    `)
    .all() as Array<{ hub_id: string; cnt: number }>;
  const twoSidedByHub = new Map(summaryRows.map((r) => [r.hub_id, r.cnt]));

  const orderRows = db
    .prepare('SELECT hub_id, COUNT(*) AS cnt FROM hub_orders GROUP BY hub_id')
    .all() as Array<{ hub_id: string; cnt: number }>;
  const ordersByHub = new Map(orderRows.map((r) => [r.hub_id, r.cnt]));

  const runRows = db
    .prepare(`
      SELECT COALESCE(hub_id, 'jita') AS hub_id, MAX(finished_at) AS last_synced_at
      FROM sync_runs
      WHERE kind = 'orders' AND status = 'completed'
      GROUP BY COALESCE(hub_id, 'jita')
    `)
    .all() as Array<{ hub_id: string; last_synced_at: string | null }>;
  const lastSyncByHub = new Map(runRows.map((r) => [r.hub_id, r.last_synced_at]));

  return TRADE_HUBS.map((hub) => ({
    hubId: hub.id,
    name: hub.name,
    shortName: hub.shortName,
    stationName: hub.stationName,
    stationCode: hub.stationCode,
    regionId: hub.regionId,
    regionName: hub.regionName,
    security: hub.security,
    isLowSec: hub.isLowSec,
    accentColor: hub.accentColor,
    lastSyncedAt: lastSyncByHub.get(hub.id) ?? null,
    twoSidedItems: twoSidedByHub.get(hub.id) ?? 0,
    totalOrders: ordersByHub.get(hub.id) ?? 0,
  }));
}

export interface SummaryRow {
  type_id: number;
  best_bid: number | null;
  best_ask: number | null;
  raw_best_bid: number | null;
  bid_min_volume: number;
  bid_volume: number;
  ask_volume: number;
  top_bid_volume: number;
  top_ask_volume: number;
  buy_order_count: number;
  sell_order_count: number;
  top_buy_competition: number;
  top_sell_competition: number;
  recent_updates_1h: number;
  recent_updates_24h: number;
}

export function aggregateHubSummaries(orders: EsiMarketOrder[], nowMs: number): SummaryRow[] {
  const oneHourAgo = nowMs - 3600_000;
  const twentyFourHoursAgo = nowMs - 24 * 3600_000;

  const byType = new Map<number, { buys: EsiMarketOrder[]; sells: EsiMarketOrder[] }>();
  for (const order of orders) {
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
    let topBidVolume = 0;
    if (bestBid !== null) {
      const threshold = bestBid * 0.98;
      for (const b of buys) {
        if (b.price >= threshold) {
          topBuyComp++;
          if (singleUnitBestBid === null || b.min_volume <= 1) {
            topBidVolume += b.volume_remain;
          }
        }
      }
    }

    let topSellComp = 0;
    let topAskVolume = 0;
    if (bestAsk !== null) {
      const threshold = bestAsk * 1.02;
      for (const s of sells) {
        if (s.price <= threshold) {
          topSellComp++;
          topAskVolume += s.volume_remain;
        }
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
      top_bid_volume: topBidVolume,
      top_ask_volume: topAskVolume,
      buy_order_count: buys.length,
      sell_order_count: sells.length,
      top_buy_competition: topBuyComp,
      top_sell_competition: topSellComp,
      recent_updates_1h: recent1h,
      recent_updates_24h: recent24h,
    });
  }

  return summaries;
}

async function syncRegionForHubs(
  regionId: number,
  regionHubs: TradeHubDefinition[],
): Promise<{
  regionalOrdersFetched: number;
  hubOrdersCount: number;
  itemsUpdated: number;
}> {
  const db = getDb();
  const primaryHub = regionHubs[0];
  syncState.currentHubId = primaryHub.id;
  syncState.stage = 'fetching_orders';
  syncState.pagesDone = 0;
  syncState.totalPages = 0;

  const startedAt = new Date().toISOString();
  const runIdsByHub = new Map<HubId, number>();
  for (const hub of regionHubs) {
    const info = db
      .prepare(
        'INSERT INTO sync_runs (hub_id, kind, status, started_at, detail) VALUES (?, ?, ?, ?, ?)',
      )
      .run(hub.id, 'orders', 'running', startedAt, `Fetching ${hub.name} market orders from ESI`);
    runIdsByHub.set(hub.id, Number(info.lastInsertRowid));
  }

  try {
    const firstPage = await esiFetchJson<EsiMarketOrder[]>(
      `/markets/${regionId}/orders/?order_type=all&page=1`,
    );
    const totalPages = Math.max(1, Number(firstPage.headers.get('x-pages') ?? '1'));
    syncState.totalPages = totalPages;
    syncState.pagesDone = 1;

    const ordersByHub = new Map<HubId, Map<number, EsiMarketOrder>>();
    for (const hub of regionHubs) {
      ordersByHub.set(hub.id, new Map());
    }

    const collectOrders = (pageOrders: EsiMarketOrder[] | null | undefined): number => {
      if (!Array.isArray(pageOrders)) return 0;
      for (const order of pageOrders) {
        const matched = matchOrderToHubs(order);
        for (const hubId of matched) {
          const map = ordersByHub.get(hubId);
          if (map) map.set(order.order_id, order);
        }
      }
      return pageOrders.length;
    };

    let totalRegionalOrders = collectOrders(firstPage.data);
    let regionMatchedCount = 0;
    for (const m of ordersByHub.values()) regionMatchedCount += m.size;
    syncState.ordersCount = regionMatchedCount;
    if (ordersByHub.has('jita')) {
      syncState.jitaOrdersCount = ordersByHub.get('jita')!.size;
    }

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
            `/markets/${regionId}/orders/?order_type=all&page=${page}`,
            { allowNotFound: true },
          );
          totalRegionalOrders += collectOrders(res.data);
          syncState.pagesDone++;

          let count = 0;
          for (const m of ordersByHub.values()) count += m.size;
          syncState.ordersCount = count;
          if (ordersByHub.has('jita')) {
            syncState.jitaOrdersCount = ordersByHub.get('jita')!.size;
          }
        }
      });

      await Promise.all(workers);
    }

    syncState.stage = 'aggregating';
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const pruneBefore = new Date(now - 7 * 24 * 3600_000).toISOString();

    const summariesByHub = new Map<HubId, SummaryRow[]>();
    const allTypeIds = new Set<number>();
    let totalHubOrders = 0;
    let totalItemsUpdated = 0;

    for (const hub of regionHubs) {
      const hubOrders = Array.from(ordersByHub.get(hub.id)!.values());
      totalHubOrders += hubOrders.length;
      const summaries = aggregateHubSummaries(hubOrders, now);
      summariesByHub.set(hub.id, summaries);
      totalItemsUpdated += summaries.length;
      for (const s of summaries) {
        allTypeIds.add(s.type_id);
      }
    }

    syncState.stage = 'persisting';
    withTransaction(db, () => {
      const deleteOrders = db.prepare('DELETE FROM hub_orders WHERE hub_id = ?');
      const insertOrder = db.prepare(`
        INSERT OR REPLACE INTO hub_orders (
          hub_id, order_id, type_id, location_id, is_buy_order, price,
          volume_remain, volume_total, min_volume, duration, issued
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const deleteSummary = db.prepare('DELETE FROM market_summary WHERE hub_id = ?');
      const insertSummary = db.prepare(`
        INSERT INTO market_summary (
          hub_id, type_id, best_bid, best_ask, raw_best_bid, bid_min_volume,
          bid_volume, ask_volume, top_bid_volume, top_ask_volume, buy_order_count, sell_order_count,
          top_buy_competition, top_sell_competition, recent_updates_1h, recent_updates_24h, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertSnapshot = db.prepare(`
        INSERT INTO market_snapshots (
          hub_id, captured_at, type_id, best_bid, best_ask, buy_order_count, sell_order_count, recent_updates_1h
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const hub of regionHubs) {
        const hubOrders = Array.from(ordersByHub.get(hub.id)!.values());
        const summaries = summariesByHub.get(hub.id) ?? [];

        deleteOrders.run(hub.id);
        for (const o of hubOrders) {
          insertOrder.run(
            hub.id,
            o.order_id,
            o.type_id,
            o.location_id,
            o.is_buy_order ? 1 : 0,
            o.price,
            o.volume_remain,
            o.volume_total,
            o.min_volume,
            o.duration,
            o.issued,
          );
        }

        deleteSummary.run(hub.id);
        for (const s of summaries) {
          insertSummary.run(
            hub.id,
            s.type_id,
            s.best_bid,
            s.best_ask,
            s.raw_best_bid,
            s.bid_min_volume,
            s.bid_volume,
            s.ask_volume,
            s.top_bid_volume,
            s.top_ask_volume,
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
              hub.id,
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
      }

      db.prepare('DELETE FROM market_snapshots WHERE captured_at < ?').run(pruneBefore);
    });

    const resolvedNewTypes = await resolveUnknownTypeIds(Array.from(allTypeIds));
    const finishedAt = new Date().toISOString();
    const updateRun = db.prepare(
      'UPDATE sync_runs SET status = ?, finished_at = ?, orders_fetched = ?, items_updated = ?, detail = ? WHERE id = ?',
    );

    for (const hub of regionHubs) {
      const hubOrdersCount = ordersByHub.get(hub.id)!.size;
      const hubItemsCount = summariesByHub.get(hub.id)?.length ?? 0;
      const detailMsg = `Synced ${hubOrdersCount.toLocaleString()} ${hub.name} orders across ${hubItemsCount.toLocaleString()} items (${totalRegionalOrders.toLocaleString()} regional orders)${resolvedNewTypes > 0 ? `, resolved ${resolvedNewTypes} new names` : ''}`;
      updateRun.run('completed', finishedAt, hubOrdersCount, hubItemsCount, detailMsg, runIdsByHub.get(hub.id)!);
    }

    return {
      regionalOrdersFetched: totalRegionalOrders,
      hubOrdersCount: totalHubOrders,
      itemsUpdated: totalItemsUpdated,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const finishedAt = new Date().toISOString();
    const failRun = db.prepare(
      'UPDATE sync_runs SET status = ?, finished_at = ?, error_message = ? WHERE id = ?',
    );
    for (const runId of runIdsByHub.values()) {
      failRun.run('failed', finishedAt, msg, runId);
    }
    throw error;
  }
}

export async function syncHubOrders(
  hubId: HubId = 'jita',
  options: { triggerHistoryBackfill?: boolean } = {},
): Promise<{
  ordersFetched: number;
  jitaOrders: number;
  ordersSynced: number;
  itemsUpdated: number;
  hubsUpdated: HubId[];
}> {
  if (activeOrderSync) return activeOrderSync;

  const { triggerHistoryBackfill = true } = options;
  const targetHub = getHubById(hubId);
  const regionHubs = getHubsByRegion(targetHub.regionId);

  activeOrderSync = (async () => {
    syncState.running = true;
    syncState.stage = 'checking_sde';
    syncState.syncScope = hubId;
    syncState.currentHubId = hubId;
    syncState.hubsDone = 0;
    syncState.totalHubs = regionHubs.length;
    syncState.pagesDone = 0;
    syncState.totalPages = 0;
    syncState.jitaOrdersCount = 0;
    syncState.ordersCount = 0;
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

      const res = await syncRegionForHubs(targetHub.regionId, regionHubs);
      syncState.hubsDone = regionHubs.length;
      syncState.stage = 'idle';

      if (triggerHistoryBackfill) {
        void runIncrementalHistoryBackfill(120, hubId).catch((err) => {
          console.error('[historySync] background backfill error:', err);
        });
      }

      return {
        ordersFetched: res.regionalOrdersFetched,
        jitaOrders: syncState.jitaOrdersCount,
        ordersSynced: res.hubOrdersCount,
        itemsUpdated: res.itemsUpdated,
        hubsUpdated: regionHubs.map((h) => h.id),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      syncState.lastError = msg;
      syncState.stage = 'error';
      throw error;
    } finally {
      syncState.running = false;
      syncState.currentHubId = null;
      syncState.syncScope = null;
      activeOrderSync = null;
    }
  })();

  return activeOrderSync;
}

export async function syncAllHubsOrders(
  options: { triggerHistoryBackfill?: boolean } = {},
): Promise<{
  ordersFetched: number;
  jitaOrders: number;
  ordersSynced: number;
  itemsUpdated: number;
  hubsUpdated: HubId[];
}> {
  if (activeOrderSync) return activeOrderSync;

  const { triggerHistoryBackfill = true } = options;
  const regions = getUniqueHubRegions();

  activeOrderSync = (async () => {
    syncState.running = true;
    syncState.stage = 'checking_sde';
    syncState.syncScope = 'all';
    syncState.currentHubId = null;
    syncState.hubsDone = 0;
    syncState.totalHubs = TRADE_HUBS.length;
    syncState.pagesDone = 0;
    syncState.totalPages = 0;
    syncState.jitaOrdersCount = 0;
    syncState.ordersCount = 0;
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

      let totalFetched = 0;
      let totalSynced = 0;
      let totalItems = 0;
      const hubsUpdated: HubId[] = [];

      for (const regionId of regions) {
        const regionHubs = getHubsByRegion(regionId);
        const res = await syncRegionForHubs(regionId, regionHubs);
        totalFetched += res.regionalOrdersFetched;
        totalSynced += res.hubOrdersCount;
        totalItems += res.itemsUpdated;
        for (const h of regionHubs) hubsUpdated.push(h.id);
        syncState.hubsDone = hubsUpdated.length;
      }

      syncState.stage = 'idle';

      if (triggerHistoryBackfill) {
        void runIncrementalHistoryBackfill(120, 'jita').catch((err) => {
          console.error('[historySync] background backfill error:', err);
        });
      }

      return {
        ordersFetched: totalFetched,
        jitaOrders: syncState.jitaOrdersCount,
        ordersSynced: totalSynced,
        itemsUpdated: totalItems,
        hubsUpdated,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      syncState.lastError = msg;
      syncState.stage = 'error';
      throw error;
    } finally {
      syncState.running = false;
      syncState.currentHubId = null;
      syncState.syncScope = null;
      activeOrderSync = null;
    }
  })();

  return activeOrderSync;
}

export async function syncJitaOrders(options: {
  triggerHistoryBackfill?: boolean;
} = {}) {
  return syncHubOrders('jita', options);
}
