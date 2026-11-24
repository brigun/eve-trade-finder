import { getDb } from '../db/database.js';
import { getHistoryBackfillProgress, runIncrementalHistoryBackfill } from './historySync.js';
import { getOrderSyncProgress, syncJitaOrders } from './orderSync.js';
import { getAllSettings } from './settingsService.js';

let timer: ReturnType<typeof setInterval> | null = null;
let lastOrderAttemptMs = 0;
let nextScheduledAtIso: string | null = null;

export function getSchedulerStatus(): {
  enabled: boolean;
  intervalMin: number;
  nextScheduledAt: string | null;
} {
  const s = getAllSettings();
  return {
    enabled: s.autoSyncEnabled,
    intervalMin: s.autoSyncIntervalMin,
    nextScheduledAt: s.autoSyncEnabled ? nextScheduledAtIso : null,
  };
}

function getLastCompletedOrderSyncMs(): number {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT finished_at FROM sync_runs WHERE kind = 'orders' AND status = 'completed' ORDER BY id DESC LIMIT 1",
    )
    .get() as { finished_at: string | null } | undefined;
  if (!row?.finished_at) return 0;
  return Date.parse(row.finished_at) || 0;
}

async function tick(): Promise<void> {
  const settings = getAllSettings();
  if (!settings.autoSyncEnabled) {
    nextScheduledAtIso = null;
    return;
  }

  const intervalMs = Math.max(5, settings.autoSyncIntervalMin) * 60_000;
  const lastSyncMs = Math.max(lastOrderAttemptMs, getLastCompletedOrderSyncMs());

  if (lastSyncMs === 0) {
    // Do not slam ESI immediately on first fresh startup; let the user initiate or wait one interval
    const firstTarget = Date.now() + intervalMs;
    nextScheduledAtIso = new Date(firstTarget).toISOString();
    return;
  }

  const nextAt = lastSyncMs + intervalMs;
  nextScheduledAtIso = new Date(nextAt).toISOString();

  if (Date.now() >= nextAt && !getOrderSyncProgress().running) {
    lastOrderAttemptMs = Date.now();
    try {
      await syncJitaOrders({ triggerHistoryBackfill: true });
      nextScheduledAtIso = new Date(Date.now() + intervalMs).toISOString();
    } catch (err) {
      console.error('[scheduler] order sync failed:', err);
    }
    return;
  }

  // If orders exist and no backfill is running, steadily warm remaining stale/missing histories
  if (!getOrderSyncProgress().running && !getHistoryBackfillProgress().running) {
    const db = getDb();
    const summaryCount = db.prepare('SELECT COUNT(*) AS cnt FROM market_summary').get() as
      | { cnt: number }
      | undefined;
    if ((summaryCount?.cnt ?? 0) > 0) {
      void runIncrementalHistoryBackfill(60).catch(() => {});
    }
  }
}

export function startScheduler(): void {
  if (timer) return;
  const settings = getAllSettings();
  const lastSyncMs = getLastCompletedOrderSyncMs();
  if (settings.autoSyncEnabled && lastSyncMs > 0) {
    nextScheduledAtIso = new Date(
      lastSyncMs + Math.max(5, settings.autoSyncIntervalMin) * 60_000,
    ).toISOString();
  }

  timer = setInterval(() => {
    void tick();
  }, 30_000);
  timer.unref?.();
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function refreshSchedulerSchedule(): void {
  const settings = getAllSettings();
  if (!settings.autoSyncEnabled) {
    nextScheduledAtIso = null;
    return;
  }
  const lastSyncMs = Math.max(lastOrderAttemptMs, getLastCompletedOrderSyncMs());
  const base = lastSyncMs > 0 ? lastSyncMs : Date.now();
  nextScheduledAtIso = new Date(
    base + Math.max(5, settings.autoSyncIntervalMin) * 60_000,
  ).toISOString();
}
