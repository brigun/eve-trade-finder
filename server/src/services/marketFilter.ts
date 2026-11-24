import type { AnomalyFlag } from './tradeAnalytics.js';

export type FilterKey =
  | 'marketGroup'
  | 'includeRootGroups'
  | 'excludeRootGroups'
  | 'watchlistOnly'
  | 'requireHistory'
  | 'trendingOnly'
  | 'hideAnomalies'
  | 'minRoiPct'
  | 'maxRoiPct'
  | 'minPrice'
  | 'maxPrice'
  | 'minNetProfit'
  | 'minDailyIskVolume'
  | 'minDailyUnits'
  | 'maxCompetition'
  | 'maxRecentUpdates1h'
  | 'twoSidedBook';

export interface FilterFailure {
  key: FilterKey;
  label: string;
  reason: string;
  excludedGroup?: string;
}

export interface MarketFilterCriteria {
  minRoiPct: number | null;
  maxRoiPct: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  priceField: 'buy' | 'sell';
  minNetProfit: number | null;
  minDailyIskVolume: number | null;
  minDailyUnits: number | null;
  maxCompetition: number | null;
  maxRecentUpdates1h: number | null;
  includeRootGroups: Set<string>;
  excludeRootGroups: Set<string>;
  allowedMarketGroupIds: Set<number> | null;
  trendingOnly: boolean;
  hideAnomalies: boolean;
  watchlistOnly: boolean;
  requireHistory: boolean;
}

export interface FilterableItem {
  typeId: number;
  name: string;
  marketGroupId: number | null;
  rootGroupName: string;
  bestBid: number;
  bestAsk: number;
  netProfit: number;
  roiPct: number;
  hasHistory: boolean;
  dailyIskVolume7d: number | null;
  dailyVolume7d: number | null;
  totalCompetition: number;
  recentUpdates1h: number;
  isTrending: boolean;
  hasAnomaly: boolean;
  anomalies: AnomalyFlag[];
  isWatchlisted: boolean;
  tradeScore: number;
  bookDepthIsk: number;
}

function formatCompactNum(val: number): string {
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  if (abs >= 100) return `${sign}${Math.round(abs).toLocaleString('en-US')}`;
  return `${sign}${abs.toFixed(2)}`;
}

export function isQuickExcluded(
  rootGroupName: string,
  excludeRootGroups: Set<string>,
): boolean {
  return excludeRootGroups.size > 0 && excludeRootGroups.has(rootGroupName);
}

export function evaluateItemFilters(
  item: FilterableItem,
  criteria: MarketFilterCriteria,
): FilterFailure[] {
  const failures: FilterFailure[] = [];

  if (item.bestBid <= 0 || item.bestAsk <= 0) {
    const reason =
      item.bestBid <= 0 && item.bestAsk <= 0
        ? 'No active Jita 4-4 orders'
        : item.bestBid <= 0
          ? 'No Jita 4-4 buy orders'
          : 'No Jita 4-4 sell orders';
    failures.push({
      key: 'twoSidedBook',
      label: 'Two-Sided Book',
      reason,
    });
  }

  if (criteria.allowedMarketGroupIds !== null) {
    if (item.marketGroupId === null || !criteria.allowedMarketGroupIds.has(item.marketGroupId)) {
      failures.push({
        key: 'marketGroup',
        label: 'Market Segment',
        reason: `In ${item.rootGroupName} (outside selected segment)`,
      });
    }
  } else {
    if (criteria.includeRootGroups.size > 0 && !criteria.includeRootGroups.has(item.rootGroupName)) {
      failures.push({
        key: 'includeRootGroups',
        label: 'Market Segment',
        reason: `In ${item.rootGroupName}`,
      });
    }
    if (criteria.excludeRootGroups.has(item.rootGroupName)) {
      failures.push({
        key: 'excludeRootGroups',
        label: `Exclude ${item.rootGroupName}`,
        reason: `Excluded category (${item.rootGroupName})`,
        excludedGroup: item.rootGroupName,
      });
    }
  }

  if (criteria.watchlistOnly && !item.isWatchlisted) {
    failures.push({
      key: 'watchlistOnly',
      label: 'Watchlist',
      reason: 'Not on Watchlist',
    });
  }

  if (criteria.requireHistory && !item.hasHistory) {
    failures.push({
      key: 'requireHistory',
      label: 'Has History',
      reason: 'No 30d history cached yet',
    });
  }

  if (criteria.trendingOnly && !item.isTrending) {
    failures.push({
      key: 'trendingOnly',
      label: 'Trending Only',
      reason: 'Not currently trending',
    });
  }

  if (criteria.hideAnomalies && item.hasAnomaly) {
    const labels = item.anomalies.map((a) => a.label).join(', ');
    failures.push({
      key: 'hideAnomalies',
      label: 'Hide Anomalies',
      reason: labels ? `Flagged: ${labels}` : 'Anomaly detected',
    });
  }

  if (criteria.minRoiPct !== null && item.roiPct < criteria.minRoiPct) {
    failures.push({
      key: 'minRoiPct',
      label: 'Min Profit %',
      reason: `${item.roiPct.toFixed(1)}% < ${criteria.minRoiPct}%`,
    });
  }

  if (criteria.maxRoiPct !== null && item.roiPct > criteria.maxRoiPct) {
    failures.push({
      key: 'maxRoiPct',
      label: 'Max Profit %',
      reason: `${item.roiPct.toFixed(1)}% > ${criteria.maxRoiPct}%`,
    });
  }

  const targetPrice = criteria.priceField === 'sell' ? item.bestAsk : item.bestBid;
  const priceLabel = criteria.priceField === 'sell' ? 'Sell' : 'Buy';

  if (criteria.minPrice !== null && targetPrice < criteria.minPrice) {
    failures.push({
      key: 'minPrice',
      label: 'Min Price',
      reason: `${priceLabel} ${formatCompactNum(targetPrice)} < ${formatCompactNum(criteria.minPrice)}`,
    });
  }

  if (criteria.maxPrice !== null && targetPrice > criteria.maxPrice) {
    failures.push({
      key: 'maxPrice',
      label: 'Max Price',
      reason: `${priceLabel} ${formatCompactNum(targetPrice)} > ${formatCompactNum(criteria.maxPrice)}`,
    });
  }

  if (criteria.minNetProfit !== null && item.netProfit < criteria.minNetProfit) {
    failures.push({
      key: 'minNetProfit',
      label: 'Min Net Profit',
      reason: `${formatCompactNum(item.netProfit)} < ${formatCompactNum(criteria.minNetProfit)}`,
    });
  }

  if (criteria.minDailyIskVolume !== null) {
    if (!item.hasHistory || (item.dailyIskVolume7d ?? 0) < criteria.minDailyIskVolume) {
      failures.push({
        key: 'minDailyIskVolume',
        label: 'Min Daily ISK Vol',
        reason: !item.hasHistory
          ? 'No 30d history'
          : `${formatCompactNum(item.dailyIskVolume7d ?? 0)} < ${formatCompactNum(criteria.minDailyIskVolume)}`,
      });
    }
  }

  if (criteria.minDailyUnits !== null) {
    if (!item.hasHistory || (item.dailyVolume7d ?? 0) < criteria.minDailyUnits) {
      failures.push({
        key: 'minDailyUnits',
        label: 'Min Daily Units',
        reason: !item.hasHistory
          ? 'No 30d history'
          : `${Math.round(item.dailyVolume7d ?? 0)} < ${criteria.minDailyUnits} u/d`,
      });
    }
  }

  if (criteria.maxCompetition !== null && item.totalCompetition > criteria.maxCompetition) {
    failures.push({
      key: 'maxCompetition',
      label: 'Max 2% Competing',
      reason: `${item.totalCompetition} > ${criteria.maxCompetition}`,
    });
  }

  if (criteria.maxRecentUpdates1h !== null && item.recentUpdates1h > criteria.maxRecentUpdates1h) {
    failures.push({
      key: 'maxRecentUpdates1h',
      label: 'Max 1h Updates',
      reason: `${item.recentUpdates1h} > ${criteria.maxRecentUpdates1h}/1h`,
    });
  }

  return failures;
}

export function computeSearchRelevance(
  item: { typeId: number; name: string },
  queryLower: string,
): number {
  const nameLower = item.name.toLowerCase();
  if (String(item.typeId) === queryLower || nameLower === queryLower) return 0;
  if (nameLower.startsWith(queryLower)) return 1;
  if (nameLower.includes(` ${queryLower}`) || nameLower.includes(`-${queryLower}`)) return 2;
  return 3;
}

export function rankLookupMatches<T extends FilterableItem & { failedFilters: FilterFailure[] }>(
  items: T[],
  queryLower: string,
): T[] {
  return [...items].sort((a, b) => {
    const relDiff = computeSearchRelevance(a, queryLower) - computeSearchRelevance(b, queryLower);
    if (relDiff !== 0) return relDiff;

    const aTwoSided = a.bestBid > 0 && a.bestAsk > 0 ? 1 : 0;
    const bTwoSided = b.bestBid > 0 && b.bestAsk > 0 ? 1 : 0;
    if (bTwoSided !== aTwoSided) return bTwoSided - aTwoSided;

    const aAnyOrder = a.bestBid > 0 || a.bestAsk > 0 ? 1 : 0;
    const bAnyOrder = b.bestBid > 0 || b.bestAsk > 0 ? 1 : 0;
    if (bAnyOrder !== aAnyOrder) return bAnyOrder - aAnyOrder;

    if (a.failedFilters.length !== b.failedFilters.length) {
      return a.failedFilters.length - b.failedFilters.length;
    }

    if (b.bookDepthIsk !== a.bookDepthIsk) return b.bookDepthIsk - a.bookDepthIsk;
    return b.tradeScore - a.tradeScore;
  });
}
