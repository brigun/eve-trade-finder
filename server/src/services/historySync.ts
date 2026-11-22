import { THE_FORGE_REGION_ID } from '../config.js';
import { getDb, withTransaction } from '../db/database.js';
import { esiFetchJson, getEsiRateState, sleep } from './esiClient.js';

export interface EsiHistoryEntry {
  date: string;
  average: number;
  highest: number;
  lowest: number;
  order_count: number;
  volume: number;
}

export interface HistoryBackfillProgress {
  running: boolean;
  done: number;
  total: number;
  lastError: string | null;
}

const backfillState: HistoryBackfillProgress = {
  running: false,
  done: 0,
  total: 0,
  lastError: null,
};

let activeBackfillPromise: Promise<{ fetched: number; total: number }> | null = null;
const inFlightTypeFetches = new Map<number, Promise<EsiHistoryEntry[]>>();

export function getHistoryBackfillProgress(): HistoryBackfillProgress {
  return { ...backfillState };
}

function parseDateMs(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00Z`);
}

export async function fetchHistoryForType(typeId: number, force = false): Promise<EsiHistoryEntry[]> {
  const existingPromise = inFlightTypeFetches.get(typeId);
  if (existingPromise) return existingPromise;

  const db = getDb();
  if (!force) {
    const log = db
      .prepare('SELECT fetched_at, status FROM history_fetch_log WHERE type_id = ?')
      .get(typeId) as { fetched_at: string; status: string } | undefined;
    if (log) {
      const ageMs = Date.now() - Date.parse(log.fetched_at);
      if (ageMs < 23 * 3600_000) {
        return db
          .prepare(
            'SELECT date, average, highest, lowest, order_count, volume FROM market_history WHERE type_id = ? ORDER BY date ASC',
          )
          .all(typeId) as unknown as EsiHistoryEntry[];
      }
    }
  }

  const work = (async () => {
    try {
      const { data, status } = await esiFetchJson<EsiHistoryEntry[]>(
        `/markets/${THE_FORGE_REGION_ID}/history/?type_id=${typeId}`,
        { allowNotFound: true, retries: 2 },
      );

      const entries = Array.isArray(data) ? data : [];
      const now = new Date();
      const todayMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const cutoff45Ms = todayMidnight - 45 * 86_400_000;
      const cutoff30Ms = todayMidnight - 30 * 86_400_000;
      const cutoff7Ms = todayMidnight - 7 * 86_400_000;

      const recentEntries = entries
        .filter((e) => parseDateMs(e.date) >= cutoff45Ms)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

      let vol7 = 0;
      let isk7 = 0;
      let vol30 = 0;
      let isk30 = 0;
      let activeDays30 = 0;

      for (const e of recentEntries) {
        const ms = parseDateMs(e.date);
        if (ms >= cutoff30Ms) {
          vol30 += e.volume;
          isk30 += e.volume * e.average;
          if (e.volume > 0) activeDays30++;
        }
        if (ms >= cutoff7Ms) {
          vol7 += e.volume;
          isk7 += e.volume * e.average;
        }
      }

      const dailyVol7d = vol7 / 7;
      const dailyVol30d = vol30 / 30;
      const dailyIskVol7d = isk7 / 7;
      const dailyIskVol30d = isk30 / 30;
      const avgPrice7d = vol7 > 0 ? isk7 / vol7 : 0;
      const avgPrice30d = vol30 > 0 ? isk30 / vol30 : 0;
      const volumeTrendPct =
        dailyVol30d > 0 ? ((dailyVol7d - dailyVol30d) / dailyVol30d) * 100 : 0;
      const priceTrendPct =
        avgPrice30d > 0 && avgPrice7d > 0 ? ((avgPrice7d - avgPrice30d) / avgPrice30d) * 100 : 0;

      const fetchedAt = now.toISOString();

      withTransaction(db, () => {
        db.prepare('DELETE FROM market_history WHERE type_id = ?').run(typeId);

        const insertHist = db.prepare(`
          INSERT INTO market_history (type_id, date, average, highest, lowest, order_count, volume)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const e of recentEntries) {
          insertHist.run(
            typeId,
            e.date,
            e.average,
            e.highest,
            e.lowest,
            e.order_count,
            e.volume,
          );
        }

        db.prepare(`
          INSERT INTO history_metrics (
            type_id, daily_volume_7d, daily_volume_30d, daily_isk_volume_7d, daily_isk_volume_30d,
            avg_price_7d, avg_price_30d, volume_trend_pct, price_trend_pct, active_days_30d, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(type_id) DO UPDATE SET
            daily_volume_7d = excluded.daily_volume_7d,
            daily_volume_30d = excluded.daily_volume_30d,
            daily_isk_volume_7d = excluded.daily_isk_volume_7d,
            daily_isk_volume_30d = excluded.daily_isk_volume_30d,
            avg_price_7d = excluded.avg_price_7d,
            avg_price_30d = excluded.avg_price_30d,
            volume_trend_pct = excluded.volume_trend_pct,
            price_trend_pct = excluded.price_trend_pct,
            active_days_30d = excluded.active_days_30d,
            updated_at = excluded.updated_at
        `).run(
          typeId,
          dailyVol7d,
          dailyVol30d,
          dailyIskVol7d,
          dailyIskVol30d,
          avgPrice7d,
          avgPrice30d,
          volumeTrendPct,
          priceTrendPct,
          activeDays30,
          fetchedAt,
        );

        db.prepare(`
          INSERT INTO history_fetch_log (type_id, fetched_at, status, days_count)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(type_id) DO UPDATE SET
            fetched_at = excluded.fetched_at,
            status = excluded.status,
            days_count = excluded.days_count
        `).run(typeId, fetchedAt, status === 404 || recentEntries.length === 0 ? 'empty' : 'ok', recentEntries.length);
      });

      return recentEntries;
    } finally {
      inFlightTypeFetches.delete(typeId);
    }
  })();

  inFlightTypeFetches.set(typeId, work);
  return work;
}

export async function runIncrementalHistoryBackfill(
  batchSize = 150,
): Promise<{ fetched: number; total: number }> {
  if (activeBackfillPromise) return activeBackfillPromise;

  activeBackfillPromise = (async () => {
    const db = getDb();
    const staleCutoff = new Date(Date.now() - 24 * 3600_000).toISOString();

    const candidates = db
      .prepare(`
        SELECT ms.type_id
        FROM market_summary ms
        LEFT JOIN history_fetch_log hfl ON hfl.type_id = ms.type_id
        LEFT JOIN watchlist w ON w.type_id = ms.type_id
        LEFT JOIN character_orders co ON co.type_id = ms.type_id
        LEFT JOIN item_types it ON it.type_id = ms.type_id
        WHERE ms.best_bid IS NOT NULL
          AND ms.best_ask IS NOT NULL
          AND ms.best_ask > ms.best_bid
          AND (hfl.fetched_at IS NULL OR hfl.fetched_at < ?)
        GROUP BY ms.type_id
        ORDER BY
          CASE WHEN w.type_id IS NOT NULL THEN 0 ELSE 1 END ASC,
          CASE WHEN co.type_id IS NOT NULL THEN 0 ELSE 1 END ASC,
          CASE WHEN it.root_group_name IN ('Ship SKINs', 'Apparel', 'Blueprints & Reactions') THEN 1 ELSE 0 END ASC,
          (ms.recent_updates_24h * 3 + ms.buy_order_count + ms.sell_order_count) DESC
        LIMIT ?
      `)
      .all(staleCutoff, batchSize) as Array<{ type_id: number }>;

    backfillState.running = true;
    backfillState.done = 0;
    backfillState.total = candidates.length;
    backfillState.lastError = null;

    if (candidates.length === 0) {
      backfillState.running = false;
      activeBackfillPromise = null;
      return { fetched: 0, total: 0 };
    }

    const startedAt = new Date().toISOString();
    const runInfo = db
      .prepare('INSERT INTO sync_runs (kind, status, started_at, detail) VALUES (?, ?, ?, ?)')
      .run('history', 'running', startedAt, `Backfilling 30d history for ${candidates.length} priority Jita items`);
    const runId = Number(runInfo.lastInsertRowid);

    let fetched = 0;
    let cursor = 0;
    const concurrency = 4;

    try {
      const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
          if (getEsiRateState().errorLimitRemain < 25) {
            throw new Error('Pausing history backfill to preserve ESI error limit');
          }
          const idx = cursor++;
          if (idx >= candidates.length) break;

          const { type_id } = candidates[idx];
          try {
            await fetchHistoryForType(type_id);
            fetched++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/error limit|420|rate-limit/i.test(msg)) {
              throw err;
            }
          } finally {
            backfillState.done++;
          }
          await sleep(60);
        }
      });

      await Promise.all(workers);

      db.prepare(
        'UPDATE sync_runs SET status = ?, finished_at = ?, items_updated = ?, detail = ? WHERE id = ?',
      ).run(
        'completed',
        new Date().toISOString(),
        fetched,
        `Backfilled 30d Forge history for ${fetched}/${candidates.length} items`,
        runId,
      );

      return { fetched, total: candidates.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      backfillState.lastError = msg;
      db.prepare(
        'UPDATE sync_runs SET status = ?, finished_at = ?, items_updated = ?, error_message = ? WHERE id = ?',
      ).run('partial', new Date().toISOString(), fetched, msg, runId);
      return { fetched, total: candidates.length };
    } finally {
      backfillState.running = false;
      activeBackfillPromise = null;
    }
  })();

  return activeBackfillPromise;
}
