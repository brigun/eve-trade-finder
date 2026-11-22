import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hydrateAndValidateNeonPicks,
  parseLlmJsonObject,
  selectNeonCandidates,
} from '../neonAdvisorLogic.ts';
import type { MarketItemDto } from '../../routes/market.ts';

function makeMockItem(overrides: Partial<MarketItemDto> = {}): MarketItemDto {
  return {
    typeId: 100,
    name: 'Mock Item',
    marketGroupId: 535,
    rootGroupName: 'Ship Equipment',
    itemVolume: 5,
    bestBid: 1_000_000,
    bestAsk: 1_250_000,
    rawBestBid: 1_000_000,
    bidMinVolume: 1,
    bidVolume: 100,
    askVolume: 90,
    buyOrderCount: 10,
    sellOrderCount: 10,
    topBuyCompetition: 4,
    topSellCompetition: 4,
    totalCompetition: 8,
    recentUpdates1h: 3,
    recentUpdates24h: 20,
    buyCost: 1_018_000,
    sellProceeds: 1_185_312.5,
    spreadIsk: 250_000,
    netProfit: 167_312.5,
    roiPct: 16.43,
    netMarginPct: 13.38,
    estDailyProfit: 2_500_000,
    bidDepthIsk: 100_000_000,
    askDepthIsk: 112_500_000,
    bookDepthIsk: 212_500_000,
    tradeScore: 82.5,
    scoreBreakdown: {
      profitScore: 19,
      salesVolumeScore: 24,
      bookDepthScore: 19.5,
      competitionScore: 20,
      momentumBonus: 0,
      riskPenalty: 0,
    },
    hasHistory: true,
    dailyVolume7d: 60,
    dailyVolume30d: 50,
    dailyIskVolume7d: 70_000_000,
    avgPrice7d: 1_120_000,
    avgPrice30d: 1_100_000,
    volumeTrendPct: 20,
    priceTrendPct: 1.8,
    activeDays30d: 28,
    isTrending: false,
    hasAnomaly: false,
    hasCriticalAnomaly: false,
    anomalies: [],
    isWatchlisted: false,
    hasCharacterOrder: false,
    updatedAt: '2026-11-22T12:00:00.000Z',
    ...overrides,
  };
}

describe('Neon Advisor candidate selection and JSON validation', () => {
  it('parses both raw JSON and markdown-fenced JSON responses cleanly', () => {
    const raw = '{"sessionSummary":"Solid picks","recommendations":[{"typeId":101}]}';
    const fenced = 'Here is the briefing:\n```json\n' + raw + '\n```';
    assert.equal(parseLlmJsonObject(raw).sessionSummary, 'Solid picks');
    assert.equal(parseLlmJsonObject(fenced).sessionSummary, 'Solid picks');
  });

  it('filters candidates by minRoiPct, excludes anomalies & default excluded groups, and respects budget', () => {
    const items = [
      makeMockItem({ typeId: 1, name: 'Valid A', roiPct: 14, buyCost: 10_000_000, tradeScore: 85 }),
      makeMockItem({ typeId: 2, name: 'Low ROI', roiPct: 7, buyCost: 5_000_000, tradeScore: 90 }),
      makeMockItem({ typeId: 3, name: 'Anomaly', roiPct: 25, hasAnomaly: true, hasCriticalAnomaly: true }),
      makeMockItem({ typeId: 4, name: 'SKIN', rootGroupName: 'Ship SKINs', roiPct: 20 }),
      makeMockItem({ typeId: 5, name: 'Too Expensive', roiPct: 18, buyCost: 500_000_000 }),
    ];

    const selected = selectNeonCandidates(items, {
      minRoiPct: 10,
      budgetIsk: 100_000_000,
      sessionStyle: 'balanced',
    });

    assert.equal(selected.length, 1);
    assert.equal(selected[0].typeId, 1);
  });

  it('rejects hallucinated typeIds and backfills up to 3 grounded picks', () => {
    const candidates = [
      makeMockItem({ typeId: 101, name: 'Item One', tradeScore: 90 }),
      makeMockItem({ typeId: 102, name: 'Item Two', tradeScore: 85 }),
      makeMockItem({ typeId: 103, name: 'Item Three', tradeScore: 80 }),
      makeMockItem({ typeId: 104, name: 'Item Four', tradeScore: 75 }),
    ];

    const hydrated = hydrateAndValidateNeonPicks(
      {
        sessionSummary: 'Test briefing',
        recommendations: [
          { typeId: 999999, headline: 'Hallucinated item', suggestedQty: 10 },
          { typeId: 102, headline: 'Top Pick 102', suggestedQty: 5 },
          { typeId: 102, headline: 'Duplicate 102', suggestedQty: 2 },
        ],
      },
      candidates,
      {
        budgetIsk: 20_000_000,
        tickFn: (p, dir) => (dir === 'up' ? p + 100 : p - 100),
      },
    );

    assert.equal(hydrated.recommendations.length, 3);
    assert.equal(hydrated.recommendations[0].typeId, 102);
    assert.equal(hydrated.recommendations[0].headline, 'Top Pick 102');
    assert.equal(hydrated.recommendations[0].suggestedQty, 5);
    assert.equal(hydrated.recommendations[1].typeId, 101);
    assert.equal(hydrated.recommendations[2].typeId, 103);
    assert.equal(hydrated.recommendations[0].outbidBuyPrice, 1_000_100);
    assert.equal(hydrated.recommendations[0].undercutSellPrice, 1_249_900);
  });
});
