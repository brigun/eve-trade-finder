import { Router } from 'express';
import { getHubById, isHubId, type HubId } from '../config.js';
import { getDb } from '../db/database.js';
import {
  computeArbitrageOpportunity,
  filterAndSortArbitrage,
  type ArbitrageFilterCriteria,
  type ArbitrageHubRow,
  type ArbitrageMode,
  type ArbitrageOpportunity,
} from '../services/arbitrageAnalytics.js';
import { getHubSyncFreshness } from '../services/orderSync.js';
import { getFeeConfig } from '../services/settingsService.js';
import { getDescendantMarketGroupIds } from './market.js';

export const arbitrageRouter = Router();

function parseOptionalNumber(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function parseBool(val: unknown): boolean {
  return val === 'true' || val === '1' || val === true;
}

function parseGroupList(val: unknown): string[] {
  if (typeof val !== 'string' || !val.trim()) return [];
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseIdList(val: unknown): number[] {
  if (typeof val !== 'string' || !val.trim()) return [];
  return val
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function parseHubOrAny(val: unknown): HubId | 'any' {
  if (typeof val === 'string') {
    const normalized = val.trim().toLowerCase();
    if (isHubId(normalized)) return normalized;
  }
  return 'any';
}

interface RawArbitrageSummaryRow {
  hub_id: string;
  type_id: number;
  name: string | null;
  market_group_id: number | null;
  root_group_name: string | null;
  volume: number | null;
  best_bid: number | null;
  best_ask: number | null;
  raw_best_bid: number | null;
  bid_min_volume: number;
  bid_volume: number;
  ask_volume: number;
  buy_order_count: number;
  sell_order_count: number;
  dest_daily_volume_7d: number | null;
  dest_avg_price_30d: number | null;
  dest_active_days_30d: number | null;
}

arbitrageRouter.get('/opportunities', (req, res) => {
  const db = getDb();
  const fees = getFeeConfig();

  const mode: ArbitrageMode = req.query.mode === 'relist' ? 'relist' : 'instant';
  const sourceHub = parseHubOrAny(req.query.sourceHub);
  const destHub = parseHubOrAny(req.query.destHub);
  const maxCargoM3 = parseOptionalNumber(req.query.maxCargoM3);

  const singleGroupId = parseOptionalNumber(req.query.marketGroupId);
  const multiGroupIds = parseIdList(req.query.marketGroupIds);
  const targetGroupIds = [
    ...(singleGroupId !== null && singleGroupId > 0 ? [Math.floor(singleGroupId)] : []),
    ...multiGroupIds,
  ];
  const allowedMarketGroupIds =
    targetGroupIds.length > 0 ? getDescendantMarketGroupIds(db, targetGroupIds) : null;

  const criteria: ArbitrageFilterCriteria = {
    q: typeof req.query.q === 'string' ? req.query.q.trim() : '',
    mode,
    sourceHub,
    destHub,
    minRoiPct: parseOptionalNumber(req.query.minRoiPct),
    maxRoiPct: parseOptionalNumber(req.query.maxRoiPct),
    minUnitProfit: parseOptionalNumber(req.query.minUnitProfit),
    minTotalProfit: parseOptionalNumber(req.query.minTotalProfit),
    minBuyPrice: parseOptionalNumber(req.query.minBuyPrice),
    maxBuyPrice: parseOptionalNumber(req.query.maxBuyPrice),
    maxCargoM3,
    minIskPerM3: parseOptionalNumber(req.query.minIskPerM3),
    maxJumps: parseOptionalNumber(req.query.maxJumps),
    hideLowSecRoutes: parseBool(req.query.hideLowSecRoutes),
    minAvailableUnits: parseOptionalNumber(req.query.minAvailableUnits),
    hideAnomalies: parseBool(req.query.hideAnomalies),
    allowedMarketGroupIds,
    excludeRootGroups: new Set(parseGroupList(req.query.excludeRootGroups)),
    sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : 'totalNetProfit',
    sortDir: req.query.sortDir === 'asc' ? 'asc' : 'desc',
  };

  const page = Math.max(1, Math.floor(parseOptionalNumber(req.query.page) ?? 1));
  const pageSize = Math.min(200, Math.max(10, Math.floor(parseOptionalNumber(req.query.pageSize) ?? 50)));

  const rawRows = db
    .prepare(`
      SELECT
        ms.hub_id,
        ms.type_id,
        it.name,
        it.market_group_id,
        it.root_group_name,
        it.volume,
        ms.best_bid,
        ms.best_ask,
        ms.raw_best_bid,
        COALESCE(ms.bid_min_volume, 1) AS bid_min_volume,
        COALESCE(ms.bid_volume, 0) AS bid_volume,
        COALESCE(ms.ask_volume, 0) AS ask_volume,
        COALESCE(ms.buy_order_count, 0) AS buy_order_count,
        COALESCE(ms.sell_order_count, 0) AS sell_order_count,
        hm.daily_volume_7d AS dest_daily_volume_7d,
        hm.avg_price_30d AS dest_avg_price_30d,
        hm.active_days_30d AS dest_active_days_30d
      FROM market_summary ms
      LEFT JOIN item_types it ON it.type_id = ms.type_id
      LEFT JOIN history_metrics hm ON hm.type_id = ms.type_id AND hm.region_id = CASE ms.hub_id
        WHEN 'jita' THEN 10000002
        WHEN 'amarr' THEN 10000043
        WHEN 'dodixie' THEN 10000032
        WHEN 'rens' THEN 10000030
        WHEN 'hek' THEN 10000042
        WHEN 'amamake' THEN 10000030
        ELSE 10000002
      END
      WHERE (ms.best_ask IS NOT NULL AND ms.best_ask > 0)
         OR (ms.best_bid IS NOT NULL AND ms.best_bid > 0)
    `)
    .all() as unknown as RawArbitrageSummaryRow[];

  const rowsByType = new Map<number, ArbitrageHubRow[]>();
  for (const r of rawRows) {
    if (!isHubId(r.hub_id)) continue;
    // Validate hub exists in config
    getHubById(r.hub_id);
    const hubRow: ArbitrageHubRow = {
      hub_id: r.hub_id,
      type_id: r.type_id,
      name: r.name ?? `Type #${r.type_id}`,
      market_group_id: r.market_group_id,
      root_group_name: r.root_group_name ?? 'Uncategorized',
      volume: r.volume,
      best_bid: r.best_bid,
      best_ask: r.best_ask,
      raw_best_bid: r.raw_best_bid,
      bid_min_volume: r.bid_min_volume,
      bid_volume: r.bid_volume,
      ask_volume: r.ask_volume,
      buy_order_count: r.buy_order_count,
      sell_order_count: r.sell_order_count,
      dest_daily_volume_7d: r.dest_daily_volume_7d,
      dest_avg_price_30d: r.dest_avg_price_30d,
      dest_active_days_30d: r.dest_active_days_30d,
    };
    let list = rowsByType.get(r.type_id);
    if (!list) {
      list = [];
      rowsByType.set(r.type_id, list);
    }
    list.push(hubRow);
  }

  const allOpportunities: ArbitrageOpportunity[] = [];
  for (const hubRows of rowsByType.values()) {
    if (hubRows.length < 2) continue;
    for (let i = 0; i < hubRows.length; i++) {
      const src = hubRows[i];
      if (sourceHub !== 'any' && src.hub_id !== sourceHub) continue;
      if (src.best_ask === null || src.best_ask <= 0 || src.ask_volume <= 0) continue;

      for (let j = 0; j < hubRows.length; j++) {
        if (i === j) continue;
        const dst = hubRows[j];
        if (destHub !== 'any' && dst.hub_id !== destHub) continue;

        const opp = computeArbitrageOpportunity({
          source: src,
          dest: dst,
          mode,
          fees,
          maxCargoM3,
        });
        if (opp && opp.unitNetProfit > 0) {
          allOpportunities.push(opp);
        }
      }
    }
  }

  const matched = filterAndSortArbitrage(allOpportunities, criteria);
  const total = matched.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const items = matched.slice(start, start + pageSize);

  const bestHaulProfit =
    matched.length > 0
      ? matched.reduce((max, cur) => (cur.totalNetProfit > max ? cur.totalNetProfit : max), 0)
      : 0;
  const avgRoiPct =
    matched.length > 0
      ? matched.reduce((acc, cur) => acc + cur.roiPct, 0) / matched.length
      : 0;

  const hubs = getHubSyncFreshness();
  const syncedHubsCount = hubs.filter((h) => h.twoSidedItems > 0 || h.totalOrders > 0).length;

  res.json({
    items,
    total,
    page: safePage,
    pageSize,
    totalPages,
    mode,
    fees,
    summaryStats: {
      totalMatched: total,
      bestHaulProfit,
      avgRoiPct,
      syncedHubsCount,
    },
    hubs,
  });
});
