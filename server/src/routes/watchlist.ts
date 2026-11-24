import { Router } from 'express';
import { getDb } from '../db/database.js';
import { getFeeConfig } from '../services/settingsService.js';
import {
  computeItemMetrics,
  type HistoryMetricsLike,
  type MarketSummaryLike,
} from '../services/tradeAnalytics.js';

export const watchlistRouter = Router();

interface WatchlistJoinRow extends MarketSummaryLike {
  type_id: number;
  note: string;
  target_buy: number | null;
  target_sell: number | null;
  created_at: string;
  name: string | null;
  root_group_name: string | null;
  daily_volume_7d: number | null;
  daily_volume_30d: number | null;
  daily_isk_volume_7d: number | null;
  daily_isk_volume_30d: number | null;
  avg_price_7d: number | null;
  avg_price_30d: number | null;
  volume_trend_pct: number | null;
  price_trend_pct: number | null;
  active_days_30d: number | null;
  history_updated_at: string | null;
}

watchlistRouter.get('/', (_req, res) => {
  const db = getDb();
  const fees = getFeeConfig();

  const rows = db
    .prepare(`
      SELECT
        w.type_id,
        w.note,
        w.target_buy,
        w.target_sell,
        w.created_at,
        it.name,
        it.root_group_name,
        ms.best_bid,
        ms.best_ask,
        ms.raw_best_bid,
        COALESCE(ms.bid_min_volume, 1) AS bid_min_volume,
        COALESCE(ms.bid_volume, 0) AS bid_volume,
        COALESCE(ms.ask_volume, 0) AS ask_volume,
        COALESCE(ms.buy_order_count, 0) AS buy_order_count,
        COALESCE(ms.sell_order_count, 0) AS sell_order_count,
        COALESCE(ms.top_buy_competition, 0) AS top_buy_competition,
        COALESCE(ms.top_sell_competition, 0) AS top_sell_competition,
        COALESCE(ms.recent_updates_1h, 0) AS recent_updates_1h,
        COALESCE(ms.recent_updates_24h, 0) AS recent_updates_24h,
        hm.daily_volume_7d,
        hm.daily_volume_30d,
        hm.daily_isk_volume_7d,
        hm.daily_isk_volume_30d,
        hm.avg_price_7d,
        hm.avg_price_30d,
        hm.volume_trend_pct,
        hm.price_trend_pct,
        hm.active_days_30d,
        hm.updated_at AS history_updated_at
      FROM watchlist w
      LEFT JOIN item_types it ON it.type_id = w.type_id
      LEFT JOIN market_summary ms ON ms.type_id = w.type_id
      LEFT JOIN history_metrics hm ON hm.type_id = w.type_id
      ORDER BY w.created_at DESC
    `)
    .all() as unknown as WatchlistJoinRow[];

  const items = rows.map((row) => {
    const hasHistory = row.history_updated_at !== null;
    const history: HistoryMetricsLike | null = hasHistory
      ? {
          daily_volume_7d: row.daily_volume_7d ?? 0,
          daily_volume_30d: row.daily_volume_30d ?? 0,
          daily_isk_volume_7d: row.daily_isk_volume_7d ?? 0,
          daily_isk_volume_30d: row.daily_isk_volume_30d ?? 0,
          avg_price_7d: row.avg_price_7d ?? 0,
          avg_price_30d: row.avg_price_30d ?? 0,
          volume_trend_pct: row.volume_trend_pct ?? 0,
          price_trend_pct: row.price_trend_pct ?? 0,
          active_days_30d: row.active_days_30d ?? 0,
        }
      : null;

    const computed = computeItemMetrics(row, history, fees);

    return {
      typeId: row.type_id,
      name: row.name ?? `Type #${row.type_id}`,
      rootGroupName: row.root_group_name ?? 'Uncategorized',
      note: row.note ?? '',
      targetBuy: row.target_buy,
      targetSell: row.target_sell,
      createdAt: row.created_at,
      bestBid: row.best_bid,
      bestAsk: row.best_ask,
      netProfit: computed.netProfit,
      roiPct: computed.roiPct,
      estDailyProfit: computed.estDailyProfit,
      dailyIskVolume7d: hasHistory ? row.daily_isk_volume_7d : null,
      volumeTrendPct: hasHistory ? row.volume_trend_pct : null,
      isTrending: computed.isTrending,
      hasAnomaly: computed.hasAnomaly,
      anomalies: computed.anomalies,
    };
  });

  res.json({ items });
});

function parseTargetPrice(
  raw: unknown,
  fallback: number | null,
): { ok: true; value: number | null } | { ok: false } {
  if (raw === undefined) {
    return { ok: true, value: fallback };
  }
  if (raw === null || raw === '') {
    return { ok: true, value: null };
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) {
    return { ok: false };
  }
  return { ok: true, value: num };
}

watchlistRouter.post('/', (req, res) => {
  const typeId = Number(req.body?.typeId);
  if (!Number.isFinite(typeId) || typeId <= 0) {
    res.status(400).json({ error: 'Valid typeId is required' });
    return;
  }

  const db = getDb();
  const existing = db.prepare('SELECT * FROM watchlist WHERE type_id = ?').get(typeId) as
    | {
        type_id: number;
        note: string;
        target_buy: number | null;
        target_sell: number | null;
        created_at: string;
      }
    | undefined;

  const hasNote = req.body?.note !== undefined;
  const note = hasNote
    ? typeof req.body.note === 'string'
      ? req.body.note.slice(0, 500)
      : ''
    : (existing?.note ?? '');

  const parsedBuy = parseTargetPrice(req.body?.targetBuy, existing?.target_buy ?? null);
  const parsedSell = parseTargetPrice(req.body?.targetSell, existing?.target_sell ?? null);
  const targetBuy = parsedBuy.ok ? parsedBuy.value : (existing?.target_buy ?? null);
  const targetSell = parsedSell.ok ? parsedSell.value : (existing?.target_sell ?? null);

  const createdAt = existing?.created_at ?? new Date().toISOString();
  db.prepare(`
    INSERT INTO watchlist (type_id, note, target_buy, target_sell, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(type_id) DO UPDATE SET
      note = excluded.note,
      target_buy = excluded.target_buy,
      target_sell = excluded.target_sell
  `).run(typeId, note, targetBuy, targetSell, createdAt);

  res.status(201).json({ typeId, note, targetBuy, targetSell, createdAt });
});

watchlistRouter.patch('/:typeId', (req, res) => {
  const typeId = Number.parseInt(req.params.typeId, 10);
  if (!Number.isFinite(typeId) || typeId <= 0) {
    res.status(400).json({ error: 'Invalid typeId' });
    return;
  }

  const db = getDb();
  const existing = db.prepare('SELECT * FROM watchlist WHERE type_id = ?').get(typeId) as
    | { type_id: number; note: string; target_buy: number | null; target_sell: number | null }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Watchlist item not found' });
    return;
  }

  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : existing.note;
  const parsedBuy = parseTargetPrice(req.body?.targetBuy, existing.target_buy);
  const parsedSell = parseTargetPrice(req.body?.targetSell, existing.target_sell);
  if (!parsedBuy.ok || !parsedSell.ok) {
    res.status(400).json({ error: 'Target prices must be non-negative numbers' });
    return;
  }

  const targetBuy = parsedBuy.value;
  const targetSell = parsedSell.value;

  db.prepare('UPDATE watchlist SET note = ?, target_buy = ?, target_sell = ? WHERE type_id = ?').run(
    note,
    targetBuy,
    targetSell,
    typeId,
  );

  res.json({ typeId, note, targetBuy, targetSell });
});

watchlistRouter.delete('/:typeId', (req, res) => {
  const typeId = Number.parseInt(req.params.typeId, 10);
  if (!Number.isFinite(typeId) || typeId <= 0) {
    res.status(400).json({ error: 'Invalid typeId' });
    return;
  }

  const db = getDb();
  db.prepare('DELETE FROM watchlist WHERE type_id = ?').run(typeId);
  res.json({ deleted: true, typeId });
});
