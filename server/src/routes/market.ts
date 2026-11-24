import { Router } from 'express';
import { EXCLUDED_DEFAULT_GROUPS } from '../config.js';
import { getDb } from '../db/database.js';
import { EsiHttpError } from '../services/esiClient.js';
import { getItemGameInfo } from '../services/gameInfoService.js';
import {
  evaluateItemFilters,
  isQuickExcluded,
  rankLookupMatches,
  type FilterFailure,
  type MarketFilterCriteria,
} from '../services/marketFilter.js';
import { getFeeConfig } from '../services/settingsService.js';
import {
  computeItemMetrics,
  type AnomalyFlag,
  type HistoryMetricsLike,
  type MarketSummaryLike,
  type ScoreBreakdown,
} from '../services/tradeAnalytics.js';

export const marketRouter = Router();

export interface MarketGroupTreeNode {
  id: number;
  parentId: number | null;
  name: string;
  itemCount: number;
  path: string[];
  children: MarketGroupTreeNode[];
}

export function getDescendantMarketGroupIds(
  db: ReturnType<typeof getDb>,
  targetGroupIds: number[],
): Set<number> {
  const rows = db
    .prepare('SELECT market_group_id, parent_group_id FROM market_groups')
    .all() as Array<{ market_group_id: number; parent_group_id: number | null }>;

  const childrenByParent = new Map<number, number[]>();
  for (const row of rows) {
    if (row.parent_group_id !== null) {
      let list = childrenByParent.get(row.parent_group_id);
      if (!list) {
        list = [];
        childrenByParent.set(row.parent_group_id, list);
      }
      list.push(row.market_group_id);
    }
  }

  const result = new Set<number>(targetGroupIds);
  const queue = [...targetGroupIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const kids = childrenByParent.get(current);
    if (!kids) continue;
    for (const childId of kids) {
      if (!result.has(childId)) {
        result.add(childId);
        queue.push(childId);
      }
    }
  }
  return result;
}

export function getGroupScopeLabel(db: ReturnType<typeof getDb>, targetGroupIds: number[]): string {
  if (targetGroupIds.length === 0) return 'Overall Jita 4-4';
  const stmt = db.prepare('SELECT name FROM market_groups WHERE market_group_id = ?');
  const names = targetGroupIds
    .map((id) => (stmt.get(id) as { name?: string } | undefined)?.name)
    .filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(' + ') : 'Selected Segment';
}

function buildMarketGroupTree(db: ReturnType<typeof getDb>): MarketGroupTreeNode[] {
  const groupRows = db
    .prepare('SELECT market_group_id, parent_group_id, name FROM market_groups')
    .all() as Array<{ market_group_id: number; parent_group_id: number | null; name: string }>;

  const countRows = db
    .prepare(`
      SELECT it.market_group_id, COUNT(*) AS cnt
      FROM market_summary ms
      JOIN item_types it ON it.type_id = ms.type_id
      WHERE ms.best_bid IS NOT NULL AND ms.best_ask IS NOT NULL
        AND ms.best_bid > 0 AND ms.best_ask > 0
        AND it.market_group_id IS NOT NULL
      GROUP BY it.market_group_id
    `)
    .all() as Array<{ market_group_id: number; cnt: number }>;

  const directCounts = new Map<number, number>();
  for (const r of countRows) {
    directCounts.set(r.market_group_id, r.cnt);
  }

  const groupById = new Map<
    number,
    { id: number; parentId: number | null; name: string }
  >();
  const childrenByParent = new Map<number, number[]>();
  const rootIds: number[] = [];

  for (const g of groupRows) {
    groupById.set(g.market_group_id, {
      id: g.market_group_id,
      parentId: g.parent_group_id,
      name: g.name,
    });
  }

  for (const g of groupById.values()) {
    if (g.parentId !== null && groupById.has(g.parentId)) {
      let list = childrenByParent.get(g.parentId);
      if (!list) {
        list = [];
        childrenByParent.set(g.parentId, list);
      }
      list.push(g.id);
    } else {
      rootIds.push(g.id);
    }
  }

  const visited = new Set<number>();

  const buildNode = (id: number, parentPath: string[]): MarketGroupTreeNode | null => {
    if (visited.has(id)) return null;
    visited.add(id);

    const g = groupById.get(id);
    if (!g) return null;

    const path = [...parentPath, g.name];
    const childIds = childrenByParent.get(id) ?? [];
    const children: MarketGroupTreeNode[] = [];

    for (const cid of childIds) {
      const childNode = buildNode(cid, path);
      if (childNode && childNode.itemCount > 0) {
        children.push(childNode);
      }
    }

    children.sort((a, b) => a.name.localeCompare(b.name));

    const direct = directCounts.get(id) ?? 0;
    const childTotal = children.reduce((acc, c) => acc + c.itemCount, 0);
    const itemCount = direct + childTotal;
    if (itemCount === 0) return null;

    return {
      id: g.id,
      parentId: g.parentId,
      name: g.name,
      itemCount,
      path,
      children,
    };
  };

  const tree: MarketGroupTreeNode[] = [];
  for (const rootId of rootIds) {
    const node = buildNode(rootId, []);
    if (node && node.itemCount > 0) {
      tree.push(node);
    }
  }

  tree.sort((a, b) => a.name.localeCompare(b.name));
  return tree;
}

interface RawScannerRow extends MarketSummaryLike {
  type_id: number;
  updated_at: string;
  name: string | null;
  market_group_id: number | null;
  root_group_id: number | null;
  root_group_name: string | null;
  volume: number | null;
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
  is_watchlisted: number;
  char_order_count: number;
}

export interface MarketItemDto {
  typeId: number;
  name: string;
  marketGroupId: number | null;
  rootGroupName: string;
  itemVolume: number | null;
  bestBid: number;
  bestAsk: number;
  rawBestBid: number;
  bidMinVolume: number;
  bidVolume: number;
  askVolume: number;
  buyOrderCount: number;
  sellOrderCount: number;
  topBuyCompetition: number;
  topSellCompetition: number;
  totalCompetition: number;
  recentUpdates1h: number;
  recentUpdates24h: number;
  buyCost: number;
  sellProceeds: number;
  spreadIsk: number;
  netProfit: number;
  roiPct: number;
  netMarginPct: number;
  estDailyProfit: number | null;
  bidDepthIsk: number;
  askDepthIsk: number;
  bookDepthIsk: number;
  tradeScore: number;
  scoreBreakdown: ScoreBreakdown;
  hasHistory: boolean;
  dailyVolume7d: number | null;
  dailyVolume30d: number | null;
  dailyIskVolume7d: number | null;
  avgPrice7d: number | null;
  avgPrice30d: number | null;
  volumeTrendPct: number | null;
  priceTrendPct: number | null;
  activeDays30d: number | null;
  isTrending: boolean;
  hasAnomaly: boolean;
  hasCriticalAnomaly: boolean;
  anomalies: AnomalyFlag[];
  isWatchlisted: boolean;
  hasCharacterOrder: boolean;
  updatedAt: string;
}

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

export function buildItemDto(row: RawScannerRow, fees: ReturnType<typeof getFeeConfig>): MarketItemDto {
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
    marketGroupId: row.market_group_id,
    rootGroupName: row.root_group_name ?? 'Uncategorized',
    itemVolume: row.volume,
    bestBid: row.best_bid ?? 0,
    bestAsk: row.best_ask ?? 0,
    rawBestBid: row.raw_best_bid ?? row.best_bid ?? 0,
    bidMinVolume: row.bid_min_volume,
    bidVolume: row.bid_volume,
    askVolume: row.ask_volume,
    buyOrderCount: row.buy_order_count,
    sellOrderCount: row.sell_order_count,
    topBuyCompetition: row.top_buy_competition,
    topSellCompetition: row.top_sell_competition,
    totalCompetition: row.top_buy_competition + row.top_sell_competition,
    recentUpdates1h: row.recent_updates_1h,
    recentUpdates24h: row.recent_updates_24h,
    buyCost: computed.buyCost,
    sellProceeds: computed.sellProceeds,
    spreadIsk: computed.spreadIsk,
    netProfit: computed.netProfit,
    roiPct: computed.roiPct,
    netMarginPct: computed.netMarginPct,
    estDailyProfit: computed.estDailyProfit,
    bidDepthIsk: computed.bidDepthIsk,
    askDepthIsk: computed.askDepthIsk,
    bookDepthIsk: computed.bookDepthIsk,
    tradeScore: computed.tradeScore,
    scoreBreakdown: computed.scoreBreakdown,
    hasHistory,
    dailyVolume7d: hasHistory ? row.daily_volume_7d : null,
    dailyVolume30d: hasHistory ? row.daily_volume_30d : null,
    dailyIskVolume7d: hasHistory ? row.daily_isk_volume_7d : null,
    avgPrice7d: hasHistory ? row.avg_price_7d : null,
    avgPrice30d: hasHistory ? row.avg_price_30d : null,
    volumeTrendPct: hasHistory ? row.volume_trend_pct : null,
    priceTrendPct: hasHistory ? row.price_trend_pct : null,
    activeDays30d: hasHistory ? row.active_days_30d : null,
    isTrending: computed.isTrending,
    hasAnomaly: computed.hasAnomaly,
    hasCriticalAnomaly: computed.hasCriticalAnomaly,
    anomalies: computed.anomalies,
    isWatchlisted: row.is_watchlisted > 0,
    hasCharacterOrder: row.char_order_count > 0,
    updatedAt: row.updated_at,
  };
}

export function loadScannerRows(): RawScannerRow[] {
  const db = getDb();
  return db
    .prepare(`
      SELECT
        ms.*,
        it.name,
        it.market_group_id,
        it.root_group_id,
        it.root_group_name,
        it.volume,
        hm.daily_volume_7d,
        hm.daily_volume_30d,
        hm.daily_isk_volume_7d,
        hm.daily_isk_volume_30d,
        hm.avg_price_7d,
        hm.avg_price_30d,
        hm.volume_trend_pct,
        hm.price_trend_pct,
        hm.active_days_30d,
        hm.updated_at AS history_updated_at,
        CASE WHEN w.type_id IS NOT NULL THEN 1 ELSE 0 END AS is_watchlisted,
        COALESCE(co.cnt, 0) AS char_order_count
      FROM market_summary ms
      LEFT JOIN item_types it ON it.type_id = ms.type_id
      LEFT JOIN history_metrics hm ON hm.type_id = ms.type_id
      LEFT JOIN watchlist w ON w.type_id = ms.type_id
      LEFT JOIN (
        SELECT type_id, COUNT(*) AS cnt FROM character_orders GROUP BY type_id
      ) co ON co.type_id = ms.type_id
      WHERE ms.best_bid IS NOT NULL AND ms.best_ask IS NOT NULL AND ms.best_bid > 0 AND ms.best_ask > 0
    `)
    .all() as unknown as RawScannerRow[];
}

export interface LookupMarketItemDto extends MarketItemDto {
  failedFilters: FilterFailure[];
}

function escapeLikePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
}

function loadOneSidedSearchRows(db: ReturnType<typeof getDb>, q: string): RawScannerRow[] {
  const likePattern = escapeLikePattern(q);
  const exactId = /^\d+$/.test(q) ? Number.parseInt(q, 10) : -1;
  return db
    .prepare(`
      SELECT
        ms.*,
        it.name,
        it.market_group_id,
        it.root_group_id,
        it.root_group_name,
        it.volume,
        hm.daily_volume_7d,
        hm.daily_volume_30d,
        hm.daily_isk_volume_7d,
        hm.daily_isk_volume_30d,
        hm.avg_price_7d,
        hm.avg_price_30d,
        hm.volume_trend_pct,
        hm.price_trend_pct,
        hm.active_days_30d,
        hm.updated_at AS history_updated_at,
        CASE WHEN w.type_id IS NOT NULL THEN 1 ELSE 0 END AS is_watchlisted,
        COALESCE(co.cnt, 0) AS char_order_count
      FROM market_summary ms
      LEFT JOIN item_types it ON it.type_id = ms.type_id
      LEFT JOIN history_metrics hm ON hm.type_id = ms.type_id
      LEFT JOIN watchlist w ON w.type_id = ms.type_id
      LEFT JOIN (
        SELECT type_id, COUNT(*) AS cnt FROM character_orders GROUP BY type_id
      ) co ON co.type_id = ms.type_id
      WHERE (ms.best_bid IS NULL OR ms.best_bid <= 0 OR ms.best_ask IS NULL OR ms.best_ask <= 0)
        AND (LOWER(COALESCE(it.name, '')) LIKE ? ESCAPE '\\' OR ms.type_id = ?)
      LIMIT 40
    `)
    .all(likePattern, exactId) as unknown as RawScannerRow[];
}

function loadSdeOnlySearchRows(db: ReturnType<typeof getDb>, q: string): RawScannerRow[] {
  const likePattern = escapeLikePattern(q);
  const exactId = /^\d+$/.test(q) ? Number.parseInt(q, 10) : -1;
  return db
    .prepare(`
      SELECT
        it.type_id,
        NULL AS best_bid,
        NULL AS best_ask,
        NULL AS raw_best_bid,
        1 AS bid_min_volume,
        0 AS bid_volume,
        0 AS ask_volume,
        0 AS buy_order_count,
        0 AS sell_order_count,
        0 AS top_buy_competition,
        0 AS top_sell_competition,
        0 AS recent_updates_1h,
        0 AS recent_updates_24h,
        COALESCE(hm.updated_at, '') AS updated_at,
        it.name,
        it.market_group_id,
        it.root_group_id,
        it.root_group_name,
        it.volume,
        hm.daily_volume_7d,
        hm.daily_volume_30d,
        hm.daily_isk_volume_7d,
        hm.daily_isk_volume_30d,
        hm.avg_price_7d,
        hm.avg_price_30d,
        hm.volume_trend_pct,
        hm.price_trend_pct,
        hm.active_days_30d,
        hm.updated_at AS history_updated_at,
        CASE WHEN w.type_id IS NOT NULL THEN 1 ELSE 0 END AS is_watchlisted,
        COALESCE(co.cnt, 0) AS char_order_count
      FROM item_types it
      LEFT JOIN market_summary ms ON ms.type_id = it.type_id
      LEFT JOIN history_metrics hm ON hm.type_id = it.type_id
      LEFT JOIN watchlist w ON w.type_id = it.type_id
      LEFT JOIN (
        SELECT type_id, COUNT(*) AS cnt FROM character_orders GROUP BY type_id
      ) co ON co.type_id = it.type_id
      WHERE ms.type_id IS NULL
        AND it.published = 1
        AND it.market_group_id IS NOT NULL
        AND (LOWER(it.name) LIKE ? ESCAPE '\\' OR it.type_id = ?)
      LIMIT 60
    `)
    .all(likePattern, exactId) as unknown as RawScannerRow[];
}

marketRouter.get('/items', (req, res) => {
  const db = getDb();
  const fees = getFeeConfig();
  const rows = loadScannerRows();

  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const minRoiPct = parseOptionalNumber(req.query.minRoiPct);
  const maxRoiPct = parseOptionalNumber(req.query.maxRoiPct);
  const minPrice = parseOptionalNumber(req.query.minPrice);
  const maxPrice = parseOptionalNumber(req.query.maxPrice);
  const priceField = req.query.priceField === 'sell' ? 'sell' : 'buy';
  const minNetProfit = parseOptionalNumber(req.query.minNetProfit);
  const minDailyIskVolume = parseOptionalNumber(req.query.minDailyIskVolume);
  const minDailyUnits = parseOptionalNumber(req.query.minDailyUnits);
  const maxCompetition = parseOptionalNumber(req.query.maxCompetition);
  const maxRecentUpdates1h = parseOptionalNumber(req.query.maxRecentUpdates1h);
  const includeRootGroups = new Set(parseGroupList(req.query.includeRootGroups));
  const excludeRootGroups = new Set(parseGroupList(req.query.excludeRootGroups));
  const singleGroupId = parseOptionalNumber(req.query.marketGroupId);
  const multiGroupIds = parseIdList(req.query.marketGroupIds);
  const targetGroupIds = [
    ...(singleGroupId !== null && singleGroupId > 0 ? [Math.floor(singleGroupId)] : []),
    ...multiGroupIds,
  ];
  const allowedMarketGroupIds =
    targetGroupIds.length > 0 ? getDescendantMarketGroupIds(db, targetGroupIds) : null;
  const trendingOnly = parseBool(req.query.trendingOnly);
  const hideAnomalies = parseBool(req.query.hideAnomalies);
  const watchlistOnly = parseBool(req.query.watchlistOnly);
  const requireHistory = parseBool(req.query.requireHistory);

  const criteria: MarketFilterCriteria = {
    minRoiPct,
    maxRoiPct,
    minPrice,
    maxPrice,
    priceField,
    minNetProfit,
    minDailyIskVolume,
    minDailyUnits,
    maxCompetition,
    maxRecentUpdates1h,
    includeRootGroups,
    excludeRootGroups,
    allowedMarketGroupIds,
    trendingOnly,
    hideAnomalies,
    watchlistOnly,
    requireHistory,
  };

  const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'tradeScore';
  const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Math.floor(parseOptionalNumber(req.query.page) ?? 1));
  const pageSize = Math.min(200, Math.max(10, Math.floor(parseOptionalNumber(req.query.pageSize) ?? 50)));

  const matched: MarketItemDto[] = [];
  const filteredOutRaw: LookupMarketItemDto[] = [];
  const seenTypeIds = new Set<number>();
  let excludedByQuickExcludesCount = 0;
  const excludedByQuickExcludeGroups = new Set<string>();

  for (const row of rows) {
    const item = buildItemDto(row, fees);

    if (q && !item.name.toLowerCase().includes(q) && String(item.typeId) !== q) continue;
    seenTypeIds.add(item.typeId);

    // Quick Excludes still strictly filter out matching items during search lookup
    if (q && isQuickExcluded(item.rootGroupName, excludeRootGroups)) {
      excludedByQuickExcludesCount++;
      excludedByQuickExcludeGroups.add(item.rootGroupName);
      continue;
    }

    const failedFilters = evaluateItemFilters(item, criteria);
    if (failedFilters.length === 0) {
      matched.push(item);
    } else if (q) {
      filteredOutRaw.push({ ...item, failedFilters });
    }
  }

  let filteredOutMatches: LookupMarketItemDto[] = [];
  let filteredOutTotal = 0;

  if (q) {
    const oneSidedRows = loadOneSidedSearchRows(db, q);
    for (const row of oneSidedRows) {
      if (seenTypeIds.has(row.type_id)) continue;
      seenTypeIds.add(row.type_id);
      const item = buildItemDto(row, fees);
      if (isQuickExcluded(item.rootGroupName, excludeRootGroups)) {
        excludedByQuickExcludesCount++;
        excludedByQuickExcludeGroups.add(item.rootGroupName);
        continue;
      }
      const failedFilters = evaluateItemFilters(item, criteria);
      filteredOutRaw.push({ ...item, failedFilters });
    }

    if (matched.length === 0 && filteredOutRaw.length < 15) {
      const sdeOnlyRows = loadSdeOnlySearchRows(db, q);
      for (const row of sdeOnlyRows) {
        if (seenTypeIds.has(row.type_id)) continue;
        seenTypeIds.add(row.type_id);
        const item = buildItemDto(row, fees);
        if (isQuickExcluded(item.rootGroupName, excludeRootGroups)) {
          excludedByQuickExcludesCount++;
          excludedByQuickExcludeGroups.add(item.rootGroupName);
          continue;
        }
        const failedFilters = evaluateItemFilters(item, criteria);
        filteredOutRaw.push({ ...item, failedFilters });
      }
    }

    filteredOutTotal = filteredOutRaw.length;
    filteredOutMatches = rankLookupMatches(filteredOutRaw, q).slice(0, 25);
  }

  const getSortValue = (item: MarketItemDto): number | string | null => {
    switch (sortBy) {
      case 'name':
        return item.name;
      case 'bestBid':
        return item.bestBid;
      case 'bestAsk':
        return item.bestAsk;
      case 'netProfit':
        return item.netProfit;
      case 'roiPct':
        return item.roiPct;
      case 'tradeScore':
        return item.tradeScore;
      case 'bookDepthIsk':
        return item.bookDepthIsk;
      case 'estDailyProfit':
        return item.estDailyProfit;
      case 'dailyIskVolume7d':
        return item.dailyIskVolume7d;
      case 'dailyVolume7d':
        return item.dailyVolume7d;
      case 'volumeTrendPct':
        return item.volumeTrendPct;
      case 'priceTrendPct':
        return item.priceTrendPct;
      case 'competition':
        return item.totalCompetition;
      case 'recentUpdates1h':
        return item.recentUpdates1h;
      default:
        return item.tradeScore;
    }
  };

  matched.sort((a, b) => {
    const va = getSortValue(a);
    const vb = getSortValue(b);

    // Push null history values to bottom regardless of sort direction
    if (va === null && vb === null) return b.roiPct - a.roiPct;
    if (va === null) return 1;
    if (vb === null) return -1;

    if (typeof va === 'string' && typeof vb === 'string') {
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    }

    const diff = Number(va) - Number(vb);
    if (diff !== 0) {
      return sortDir === 'asc' ? diff : -diff;
    }
    return b.roiPct - a.roiPct;
  });

  const total = matched.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const items = matched.slice(start, start + pageSize);

  const avgRoiPct =
    total > 0 ? matched.reduce((acc, cur) => acc + cur.roiPct, 0) / total : 0;
  const trendingInMatchCount = matched.reduce((acc, cur) => acc + (cur.isTrending ? 1 : 0), 0);

  res.json({
    items,
    total,
    page: safePage,
    pageSize,
    totalPages,
    fees,
    summaryStats: {
      totalMatched: total,
      avgRoiPct,
      trendingInMatchCount,
    },
    filteredOutMatches,
    filteredOutTotal,
    excludedByQuickExcludesCount,
    excludedByQuickExcludeGroups: Array.from(excludedByQuickExcludeGroups),
  });
});

marketRouter.get('/stats', (_req, res) => {
  const fees = getFeeConfig();
  const rows = loadScannerRows();
  const db = getDb();

  const totalJitaRow = db.prepare('SELECT COUNT(*) AS cnt FROM market_summary').get() as {
    cnt: number;
  };
  const totalOrdersRow = db.prepare('SELECT COUNT(*) AS cnt FROM jita_orders').get() as {
    cnt: number;
  };
  const historyRow = db
    .prepare("SELECT COUNT(*) AS cnt FROM history_fetch_log WHERE status IN ('ok', 'empty')")
    .get() as { cnt: number };
  const watchlistRow = db.prepare('SELECT COUNT(*) AS cnt FROM watchlist').get() as { cnt: number };
  const sdeRow = db.prepare('SELECT COUNT(*) AS cnt FROM item_types').get() as { cnt: number };
  const lastOrderSync = db
    .prepare(
      "SELECT finished_at FROM sync_runs WHERE kind = 'orders' AND status = 'completed' ORDER BY id DESC LIMIT 1",
    )
    .get() as { finished_at: string | null } | undefined;

  let trendingItemsCount = 0;
  for (const row of rows) {
    const dto = buildItemDto(row, fees);
    if (dto.isTrending) trendingItemsCount++;
  }

  const twoSidedItems = rows.length;
  const historyCoveredItems = rows.filter((r) => r.history_updated_at !== null).length;

  res.json({
    totalJitaItems: totalJitaRow.cnt,
    twoSidedItems,
    totalJitaOrders: totalOrdersRow.cnt,
    historyFetchedTotal: historyRow.cnt,
    historyCoveredItems,
    historyCoveragePct:
      twoSidedItems > 0 ? Math.round((historyCoveredItems / twoSidedItems) * 1000) / 10 : 0,
    trendingItemsCount,
    watchlistCount: watchlistRow.cnt,
    sdeItemCount: sdeRow.cnt,
    lastOrderSyncAt: lastOrderSync?.finished_at ?? null,
    fees,
  });
});

marketRouter.get('/groups', (_req, res) => {
  const db = getDb();
  const groups = db
    .prepare(`
      SELECT
        COALESCE(it.root_group_name, 'Uncategorized') AS name,
        COUNT(*) AS itemCount
      FROM market_summary ms
      LEFT JOIN item_types it ON it.type_id = ms.type_id
      WHERE ms.best_bid IS NOT NULL AND ms.best_ask IS NOT NULL
      GROUP BY COALESCE(it.root_group_name, 'Uncategorized')
      ORDER BY itemCount DESC, name ASC
    `)
    .all() as Array<{ name: string; itemCount: number }>;

  const tree = buildMarketGroupTree(db);
  res.json({ groups: groups.map((g) => ({ ...g })), tree });
});

marketRouter.get('/recommended', (req, res) => {
  const db = getDb();
  const fees = getFeeConfig();
  const rows = loadScannerRows();

  const minRoiPct = parseOptionalNumber(req.query.minRoiPct) ?? 10;
  const limit = Math.min(5, Math.max(1, Math.floor(parseOptionalNumber(req.query.limit) ?? 3)));
  const singleGroupId = parseOptionalNumber(req.query.marketGroupId);
  const multiGroupIds = parseIdList(req.query.marketGroupIds);
  const targetGroupIds = [
    ...(singleGroupId !== null && singleGroupId > 0 ? [Math.floor(singleGroupId)] : []),
    ...multiGroupIds,
  ];
  const allowedMarketGroupIds =
    targetGroupIds.length > 0 ? getDescendantMarketGroupIds(db, targetGroupIds) : null;
  const defaultExcluded = new Set(EXCLUDED_DEFAULT_GROUPS);

  const scopedDtos: MarketItemDto[] = [];
  for (const row of rows) {
    const item = buildItemDto(row, fees);
    if (allowedMarketGroupIds !== null) {
      if (item.marketGroupId === null || !allowedMarketGroupIds.has(item.marketGroupId)) continue;
    } else if (defaultExcluded.has(item.rootGroupName)) {
      continue;
    }
    scopedDtos.push(item);
  }

  let candidates = scopedDtos.filter(
    (item) =>
      item.roiPct >= minRoiPct &&
      !item.hasAnomaly &&
      item.hasHistory &&
      (item.activeDays30d ?? 0) >= 7 &&
      (item.dailyIskVolume7d ?? 0) >= 10_000_000 &&
      (item.dailyVolume7d ?? 0) >= 2 &&
      item.buyOrderCount >= 2 &&
      item.sellOrderCount >= 2,
  );

  let fallbackUsed = false;
  if (candidates.length === 0) {
    fallbackUsed = true;
    candidates = scopedDtos.filter(
      (item) =>
        item.roiPct >= minRoiPct &&
        !item.hasCriticalAnomaly &&
        item.buyOrderCount >= 1 &&
        item.sellOrderCount >= 1,
    );
  }

  candidates.sort((a, b) => {
    if (b.tradeScore !== a.tradeScore) return b.tradeScore - a.tradeScore;
    return (b.estDailyProfit ?? 0) - (a.estDailyProfit ?? 0);
  });

  const selected = candidates.slice(0, limit);
  res.json({
    top: selected[0] ?? null,
    runnersUp: selected.slice(1),
    scopeLabel: getGroupScopeLabel(db, targetGroupIds),
    minRoiPct,
    evaluatedCount: candidates.length,
    fallbackUsed,
    fees,
  });
});

marketRouter.get('/items/:typeId/game-info', async (req, res) => {
  const typeId = Number.parseInt(req.params.typeId, 10);
  if (!Number.isFinite(typeId) || typeId <= 0) {
    res.status(400).json({ error: 'Invalid typeId' });
    return;
  }

  const force = parseBool(req.query.force);
  try {
    const gameInfo = await getItemGameInfo(typeId, force);
    res.json({ gameInfo });
  } catch (err) {
    if (err instanceof EsiHttpError && err.status === 404) {
      res.status(404).json({ error: 'Item not found in EVE Online ESI.' });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to load EVE Online item info';
    res.status(502).json({ error: message });
  }
});

marketRouter.get('/items/:typeId', (req, res) => {
  const typeId = Number.parseInt(req.params.typeId, 10);
  if (!Number.isFinite(typeId) || typeId <= 0) {
    res.status(400).json({ error: 'Invalid typeId' });
    return;
  }

  const db = getDb();
  const fees = getFeeConfig();

  let row = db
    .prepare(`
      SELECT
        ms.*,
        it.name,
        it.market_group_id,
        it.root_group_id,
        it.root_group_name,
        it.volume,
        hm.daily_volume_7d,
        hm.daily_volume_30d,
        hm.daily_isk_volume_7d,
        hm.daily_isk_volume_30d,
        hm.avg_price_7d,
        hm.avg_price_30d,
        hm.volume_trend_pct,
        hm.price_trend_pct,
        hm.active_days_30d,
        hm.updated_at AS history_updated_at,
        CASE WHEN w.type_id IS NOT NULL THEN 1 ELSE 0 END AS is_watchlisted,
        COALESCE(co.cnt, 0) AS char_order_count
      FROM market_summary ms
      LEFT JOIN item_types it ON it.type_id = ms.type_id
      LEFT JOIN history_metrics hm ON hm.type_id = ms.type_id
      LEFT JOIN watchlist w ON w.type_id = ms.type_id
      LEFT JOIN (
        SELECT type_id, COUNT(*) AS cnt FROM character_orders GROUP BY type_id
      ) co ON co.type_id = ms.type_id
      WHERE ms.type_id = ?
    `)
    .get(typeId) as RawScannerRow | undefined;

  if (!row) {
    row = db
      .prepare(`
        SELECT
          it.type_id,
          NULL AS best_bid,
          NULL AS best_ask,
          NULL AS raw_best_bid,
          1 AS bid_min_volume,
          0 AS bid_volume,
          0 AS ask_volume,
          0 AS buy_order_count,
          0 AS sell_order_count,
          0 AS top_buy_competition,
          0 AS top_sell_competition,
          0 AS recent_updates_1h,
          0 AS recent_updates_24h,
          COALESCE(hm.updated_at, '') AS updated_at,
          it.name,
          it.market_group_id,
          it.root_group_id,
          it.root_group_name,
          it.volume,
          hm.daily_volume_7d,
          hm.daily_volume_30d,
          hm.daily_isk_volume_7d,
          hm.daily_isk_volume_30d,
          hm.avg_price_7d,
          hm.avg_price_30d,
          hm.volume_trend_pct,
          hm.price_trend_pct,
          hm.active_days_30d,
          hm.updated_at AS history_updated_at,
          CASE WHEN w.type_id IS NOT NULL THEN 1 ELSE 0 END AS is_watchlisted,
          COALESCE(co.cnt, 0) AS char_order_count
        FROM item_types it
        LEFT JOIN history_metrics hm ON hm.type_id = it.type_id
        LEFT JOIN watchlist w ON w.type_id = it.type_id
        LEFT JOIN (
          SELECT type_id, COUNT(*) AS cnt FROM character_orders GROUP BY type_id
        ) co ON co.type_id = it.type_id
        WHERE it.type_id = ?
      `)
      .get(typeId) as RawScannerRow | undefined;
  }

  if (!row) {
    res.status(404).json({ error: 'Item not found in local Jita 4-4 or SDE catalog.' });
    return;
  }

  // Build market group breadcrumb path
  const groupPath: string[] = [];
  if (row.market_group_id !== null) {
    const getGroup = db.prepare(
      'SELECT market_group_id, parent_group_id, name FROM market_groups WHERE market_group_id = ?',
    );
    let currId: number | null = row.market_group_id;
    const seen = new Set<number>();
    while (currId !== null && !seen.has(currId)) {
      seen.add(currId);
      const grp = getGroup.get(currId) as
        | { market_group_id: number; parent_group_id: number | null; name: string }
        | undefined;
      if (!grp) break;
      groupPath.unshift(grp.name);
      currId = grp.parent_group_id;
    }
  }

  const sellOrders = db
    .prepare(
      'SELECT * FROM jita_orders WHERE type_id = ? AND is_buy_order = 0 ORDER BY price ASC LIMIT 120',
    )
    .all(typeId)
    .map((o) => ({ ...o }));

  const buyOrders = db
    .prepare(
      'SELECT * FROM jita_orders WHERE type_id = ? AND is_buy_order = 1 ORDER BY price DESC LIMIT 120',
    )
    .all(typeId)
    .map((o) => ({ ...o }));

  const history = db
    .prepare(
      'SELECT date, average, highest, lowest, order_count, volume FROM market_history WHERE type_id = ? ORDER BY date ASC',
    )
    .all(typeId)
    .map((h) => ({ ...h }));

  const fetchLog = db
    .prepare('SELECT fetched_at, status, days_count FROM history_fetch_log WHERE type_id = ?')
    .get(typeId) as { fetched_at: string; status: string; days_count: number } | undefined;

  const snapshots = db
    .prepare(
      'SELECT captured_at, best_bid, best_ask, buy_order_count, sell_order_count, recent_updates_1h FROM market_snapshots WHERE type_id = ? ORDER BY captured_at DESC LIMIT 48',
    )
    .all(typeId)
    .map((s) => ({ ...s }))
    .reverse();

  const watchlistEntry = db.prepare('SELECT * FROM watchlist WHERE type_id = ?').get(typeId) as
    | Record<string, unknown>
    | undefined;

  const charOrders = db
    .prepare('SELECT order_id, is_buy_order, price, volume_remain, volume_total FROM character_orders WHERE type_id = ?')
    .all(typeId)
    .map((o) => ({ ...o }));

  res.json({
    item: buildItemDto(row, fees),
    groupPath,
    fees,
    sellOrders,
    buyOrders,
    history,
    historyMeta: fetchLog ? { ...fetchLog } : null,
    snapshots,
    watchlist: watchlistEntry ? { ...watchlistEntry } : null,
    characterOrders: charOrders,
  });
});
