import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEveFees,
  computeItemMetrics,
  nextEveTick,
  roundToEveSigFigs,
  type HistoryMetricsLike,
  type MarketSummaryLike,
} from '../tradeAnalytics.ts';

describe('EVE 4-significant-figure tick math', () => {
  it('rounds prices cleanly to 4 significant figures with 0.01 ISK minimum', () => {
    assert.equal(roundToEveSigFigs(0), 0.01);
    assert.equal(roundToEveSigFigs(0.004), 0.01);
    assert.equal(roundToEveSigFigs(9.994), 9.99);
    assert.equal(roundToEveSigFigs(12.345), 12.35);
    assert.equal(roundToEveSigFigs(999.94), 999.9);
    assert.equal(roundToEveSigFigs(123456), 123500);
  });

  it('steps up and down across power-of-10 boundaries accurately', () => {
    assert.equal(nextEveTick(999.9, 'up'), 1000);
    assert.equal(nextEveTick(1000, 'up'), 1001);
    assert.equal(nextEveTick(1000, 'down'), 999.9);
    assert.equal(nextEveTick(100, 'down'), 99.99);
    assert.equal(nextEveTick(10, 'down'), 9.99);
    assert.equal(nextEveTick(123400, 'up'), 123500);
    assert.equal(nextEveTick(123400, 'down'), 123300);
    assert.equal(nextEveTick(0.01, 'down'), 0.01);
  });
});

describe('EVE fee calculator', () => {
  it('computes base fees with 0 skills and 0 standings', () => {
    const fees = calculateEveFees({
      accountingLevel: 0,
      brokerRelationsLevel: 0,
      factionStanding: 0,
      corpStanding: 0,
    });
    assert.equal(fees.salesTaxPct, 7.5);
    assert.equal(fees.brokerFeePct, 3.0);
  });

  it('computes max-skill and max-standing NPC fees accurately', () => {
    const fees = calculateEveFees({
      accountingLevel: 5,
      brokerRelationsLevel: 5,
      factionStanding: 10,
      corpStanding: 10,
    });
    assert.equal(fees.salesTaxPct, 3.375);
    assert.equal(fees.brokerFeePct, 1.0);
  });
});

describe('Station trading metrics, trending, and anomaly detection', () => {
  const baseSummary: MarketSummaryLike = {
    best_bid: 1_000_000,
    best_ask: 1_250_000,
    raw_best_bid: 1_000_000,
    bid_min_volume: 1,
    bid_volume: 500,
    ask_volume: 400,
    buy_order_count: 15,
    sell_order_count: 12,
    top_buy_competition: 4,
    top_sell_competition: 5,
    recent_updates_1h: 3,
    recent_updates_24h: 22,
  };

  const healthyHistory: HistoryMetricsLike = {
    daily_volume_7d: 100,
    daily_volume_30d: 75,
    daily_isk_volume_7d: 112_000_000,
    daily_isk_volume_30d: 82_000_000,
    avg_price_7d: 1_120_000,
    avg_price_30d: 1_100_000,
    volume_trend_pct: 33.33,
    price_trend_pct: 1.82,
    active_days_30d: 30,
  };

  it('calculates profit, ROI, daily profit, and trending status for healthy items', () => {
    const metrics = computeItemMetrics(baseSummary, healthyHistory, {
      brokerFeePct: 3.0,
      salesTaxPct: 7.5,
      captureSharePct: 15,
    });

    // buyCost = 1_000_000 * 1.03 = 1_030_000
    // sellProceeds = 1_250_000 * (1 - 0.105) = 1_118_750
    // netProfit = 88_750
    assert.equal(metrics.buyCost, 1_030_000);
    assert.equal(metrics.sellProceeds, 1_118_750);
    assert.equal(metrics.netProfit, 88_750);
    assert.ok(Math.abs(metrics.roiPct - (88_750 / 1_030_000) * 100) < 1e-6);
    assert.equal(metrics.estDailyProfit, 88_750 * 100 * 0.15);
    assert.equal(metrics.hasAnomaly, false);
    assert.equal(metrics.isTrending, true);
  });

  it('flags manipulated spreads, min-volume traps, and blocks trending on critical anomalies', () => {
    const trappedSummary: MarketSummaryLike = {
      ...baseSummary,
      best_ask: 3_500_000,
      bid_min_volume: 100,
      sell_order_count: 1,
    };
    const metrics = computeItemMetrics(trappedSummary, healthyHistory, {
      brokerFeePct: 2.0,
      salesTaxPct: 4.5,
      captureSharePct: 15,
    });

    const codes = metrics.anomalies.map((a) => a.code);
    assert.ok(codes.includes('MIN_VOL_TRAP'));
    assert.ok(codes.includes('INFLATED_ASK'));
    assert.ok(codes.includes('EXTREME_MARGIN'));
    assert.ok(codes.includes('SINGLE_SELLER'));
    assert.equal(metrics.hasCriticalAnomaly, true);
    assert.equal(metrics.isTrending, false);
  });
});
