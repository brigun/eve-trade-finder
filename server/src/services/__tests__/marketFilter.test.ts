import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateItemFilters,
  isQuickExcluded,
  rankLookupMatches,
  type FilterableItem,
  type MarketFilterCriteria,
} from '../marketFilter.ts';

function makeItem(overrides: Partial<FilterableItem> = {}): FilterableItem {
  return {
    typeId: 34,
    name: 'Tritanium',
    marketGroupId: 1857,
    rootGroupName: 'Manufacture & Research',
    bestBid: 100_000,
    bestAsk: 130_000,
    netProfit: 18_000,
    roiPct: 17.6,
    hasHistory: true,
    dailyIskVolume7d: 500_000_000,
    dailyVolume7d: 4_000,
    totalCompetition: 6,
    recentUpdates1h: 2,
    isTrending: false,
    hasAnomaly: false,
    anomalies: [],
    isWatchlisted: false,
    tradeScore: 80,
    bookDepthIsk: 1_000_000_000,
    ...overrides,
  };
}

function makeCriteria(overrides: Partial<MarketFilterCriteria> = {}): MarketFilterCriteria {
  return {
    minRoiPct: 10,
    maxRoiPct: null,
    minPrice: 50_000,
    maxPrice: null,
    priceField: 'buy',
    minNetProfit: null,
    minDailyIskVolume: null,
    minDailyUnits: null,
    maxCompetition: null,
    maxRecentUpdates1h: null,
    includeRootGroups: new Set<string>(),
    excludeRootGroups: new Set(['Ship SKINs', 'Apparel', 'Blueprints & Reactions']),
    allowedMarketGroupIds: null,
    trendingOnly: false,
    hideAnomalies: true,
    watchlistOnly: false,
    requireHistory: false,
    ...overrides,
  };
}

describe('evaluateItemFilters', () => {
  it('returns no failures when item satisfies all active constraints', () => {
    const failures = evaluateItemFilters(makeItem(), makeCriteria());
    assert.deepEqual(failures, []);
  });

  it('reports exact breaking filters for unprofitable and low-price lookup items', () => {
    const item = makeItem({
      name: 'Tritanium',
      bestBid: 3.86,
      bestAsk: 4.08,
      netProfit: -0.05,
      roiPct: -1.3,
    });
    const failures = evaluateItemFilters(item, makeCriteria());
    const keys = failures.map((f) => f.key);
    assert.deepEqual(keys, ['minRoiPct', 'minPrice']);
    assert.match(failures[0].reason, /-1\.3% < 10%/);
    assert.match(failures[1].reason, /Buy 3\.86 < 50\.0K/);
  });

  it('identifies excluded root group specifically and lets segment filter override excludes', () => {
    const skin = makeItem({
      typeId: 40000,
      name: 'Vexor Quafe SKIN',
      marketGroupId: 1954,
      rootGroupName: 'Ship SKINs',
    });

    const excludedFailures = evaluateItemFilters(skin, makeCriteria());
    assert.equal(excludedFailures.length, 1);
    assert.equal(excludedFailures[0].key, 'excludeRootGroups');
    assert.equal(excludedFailures[0].excludedGroup, 'Ship SKINs');

    const segmentFailures = evaluateItemFilters(
      skin,
      makeCriteria({ allowedMarketGroupIds: new Set([9, 10]) }),
    );
    assert.equal(segmentFailures.length, 1);
    assert.equal(segmentFailures[0].key, 'marketGroup');
  });

  it('flags toggle constraints and one-sided/zero-order books', () => {
    const item = makeItem({
      bestBid: 0,
      bestAsk: 250_000,
      netProfit: 0,
      roiPct: 0,
      hasHistory: false,
      hasAnomaly: true,
      anomalies: [
        {
          code: 'SINGLE_SELLER',
          severity: 'medium',
          label: 'Single Seller',
          reason: 'Only 1 active sell order',
        },
      ],
    });

    const failures = evaluateItemFilters(
      item,
      makeCriteria({
        requireHistory: true,
        trendingOnly: true,
        watchlistOnly: true,
        hideAnomalies: true,
      }),
    );

    const keys = new Set(failures.map((f) => f.key));
    assert.ok(keys.has('twoSidedBook'));
    assert.ok(keys.has('watchlistOnly'));
    assert.ok(keys.has('requireHistory'));
    assert.ok(keys.has('trendingOnly'));
    assert.ok(keys.has('hideAnomalies'));
    assert.ok(keys.has('minRoiPct'));
    assert.ok(keys.has('minPrice'));
  });
});

describe('rankLookupMatches', () => {
  it('ranks exact name matches ahead of prefix, substring, and zero-order items', () => {
    const exact = {
      ...makeItem({ typeId: 34, name: 'Tritanium', roiPct: 2 }),
      failedFilters: [{ key: 'minRoiPct' as const, label: 'Min Profit %', reason: '2.0% < 10%' }],
    };
    const prefix = {
      ...makeItem({ typeId: 34001, name: 'Tritanium Blueprint', roiPct: 2 }),
      failedFilters: [{ key: 'minRoiPct' as const, label: 'Min Profit %', reason: '2.0% < 10%' }],
    };
    const substring = {
      ...makeItem({ typeId: 34002, name: 'Compressed Tritanium Ore', roiPct: 2 }),
      failedFilters: [{ key: 'minRoiPct' as const, label: 'Min Profit %', reason: '2.0% < 10%' }],
    };
    const zeroOrderPrefix = {
      ...makeItem({ typeId: 34003, name: 'Tritanium Relic', bestBid: 0, bestAsk: 0 }),
      failedFilters: [
        { key: 'twoSidedBook' as const, label: 'Two-Sided Book', reason: 'No active Jita 4-4 orders' },
      ],
    };

    const ranked = rankLookupMatches([substring, zeroOrderPrefix, prefix, exact], 'tritanium');
    assert.deepEqual(
      ranked.map((r) => r.name),
      ['Tritanium', 'Tritanium Blueprint', 'Tritanium Relic', 'Compressed Tritanium Ore'],
    );
  });
});

describe('isQuickExcluded', () => {
  it('detects items belonging to quick-excluded root categories', () => {
    const excluded = new Set(['Ship SKINs', 'Apparel', 'Blueprints & Reactions']);
    assert.equal(isQuickExcluded('Ship SKINs', excluded), true);
    assert.equal(isQuickExcluded('Blueprints & Reactions', excluded), true);
    assert.equal(isQuickExcluded('Ships', excluded), false);
    assert.equal(isQuickExcluded('Ship SKINs', new Set()), false);
  });
});
