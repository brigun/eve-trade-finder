import { Router } from 'express';
import { getDb } from '../db/database.js';
import { getEsiRateState } from '../services/esiClient.js';
import {
  fetchHistoryForType,
  getHistoryBackfillProgress,
  runIncrementalHistoryBackfill,
} from '../services/historySync.js';
import { getOrderSyncProgress, syncJitaOrders } from '../services/orderSync.js';
import { getSchedulerStatus } from '../services/scheduler.js';
import { getSdeProgress, isSdePopulated, syncSdeData } from '../services/sdeSync.js';

export const syncRouter = Router();

syncRouter.get('/status', (_req, res) => {
  const db = getDb();
  const runs = db
    .prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 20')
    .all()
    .map((r) => ({ ...r }));

  res.json({
    sdePopulated: isSdePopulated(),
    orderSync: getOrderSyncProgress(),
    historyBackfill: getHistoryBackfillProgress(),
    sdeSync: getSdeProgress(),
    esiRate: getEsiRateState(),
    scheduler: getSchedulerStatus(),
    recentRuns: runs,
  });
});

syncRouter.post('/orders', async (req, res, next) => {
  try {
    const wait = req.query.wait === 'true';
    const progress = getOrderSyncProgress();
    if (progress.running && !wait) {
      res.status(202).json({ started: false, alreadyRunning: true, progress });
      return;
    }

    const promise = syncJitaOrders({ triggerHistoryBackfill: true });
    if (wait) {
      const result = await promise;
      res.json({ started: true, completed: true, ...result });
      return;
    }

    promise.catch((err) => console.error('[sync/orders] failed:', err));
    res.status(202).json({ started: true, alreadyRunning: false, progress: getOrderSyncProgress() });
  } catch (err) {
    next(err);
  }
});

syncRouter.post('/sde', async (req, res, next) => {
  try {
    const wait = req.query.wait === 'true';
    const progress = getSdeProgress();
    if (progress.running && !wait) {
      res.status(202).json({ started: false, alreadyRunning: true, progress });
      return;
    }

    const promise = syncSdeData();
    if (wait) {
      const result = await promise;
      res.json({ started: true, completed: true, ...result });
      return;
    }

    promise.catch((err) => console.error('[sync/sde] failed:', err));
    res.status(202).json({ started: true, alreadyRunning: false, progress: getSdeProgress() });
  } catch (err) {
    next(err);
  }
});

syncRouter.post('/history/backfill', async (req, res, next) => {
  try {
    const wait = req.query.wait === 'true';
    const rawSize = Number(req.query.batchSize ?? req.body?.batchSize ?? 150);
    const batchSize = Number.isFinite(rawSize) ? Math.min(400, Math.max(10, Math.floor(rawSize))) : 150;

    const progress = getHistoryBackfillProgress();
    if (progress.running && !wait) {
      res.status(202).json({ started: false, alreadyRunning: true, progress });
      return;
    }

    const promise = runIncrementalHistoryBackfill(batchSize);
    if (wait) {
      const result = await promise;
      res.json({ started: true, completed: true, ...result });
      return;
    }

    promise.catch((err) => console.error('[sync/history/backfill] failed:', err));
    res.status(202).json({
      started: true,
      alreadyRunning: false,
      progress: getHistoryBackfillProgress(),
    });
  } catch (err) {
    next(err);
  }
});

syncRouter.post('/history/:typeId', async (req, res, next) => {
  try {
    const typeId = Number.parseInt(req.params.typeId, 10);
    if (!Number.isFinite(typeId) || typeId <= 0) {
      res.status(400).json({ error: 'Invalid typeId' });
      return;
    }
    const force = req.query.force === 'true';
    const entries = await fetchHistoryForType(typeId, force);
    res.json({ typeId, daysCount: entries.length, history: entries });
  } catch (err) {
    next(err);
  }
});
