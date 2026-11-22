import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandleSeries } from '../../../../client/src/lib/candleAnalytics.ts';

describe('buildCandleSeries', () => {
  it('computes exact bid/ask execution split from low, average, and high', () => {
    const model = buildCandleSeries([
      { date: '2026-11-01', lowest: 100, average: 100, highest: 200, order_count: 10, volume: 100 },
      { date: '2026-11-02', lowest: 100, average: 200, highest: 200, order_count: 10, volume: 100 },
      { date: '2026-11-03', lowest: 100, average: 150, highest: 200, order_count: 10, volume: 100 },
    ]);

    assert.equal(model.candles.length, 3);
    // Day 1: average === lowest -> 0% ask, 100% bid
    assert.equal(model.candles[0].askShare, 0);
    assert.equal(model.candles[0].bidShare, 1);
    assert.equal(model.candles[0].estAskVolume, 0);
    assert.equal(model.candles[0].estBidVolume, 100);
    assert.equal(model.candles[0].flowBias, 'BID_HEAVY');

    // Day 2: average === highest -> 100% ask, 0% bid
    assert.equal(model.candles[1].askShare, 1);
    assert.equal(model.candles[1].bidShare, 0);
    assert.equal(model.candles[1].estAskVolume, 100);
    assert.equal(model.candles[1].estBidVolume, 0);
    assert.equal(model.candles[1].flowBias, 'ASK_HEAVY');

    // Day 3: average === midpoint -> 50% ask, 50% bid
    assert.equal(model.candles[2].askShare, 0.5);
    assert.equal(model.candles[2].bidShare, 0.5);
    assert.equal(model.candles[2].estAskVolume, 50);
    assert.equal(model.candles[2].estBidVolume, 50);
    assert.equal(model.candles[2].flowBias, 'TWO_SIDED');
  });

  it('infers bid/ask fill side on flat single-price days using bestBid/bestAsk', () => {
    const bidHit = buildCandleSeries(
      [{ date: '2026-11-10', lowest: 100, average: 100, highest: 100, order_count: 5, volume: 40 }],
      { bestBid: 100, bestAsk: 150 },
    );
    assert.equal(bidHit.candles[0].isFlat, true);
    assert.equal(bidHit.candles[0].askShare, 0);
    assert.equal(bidHit.candles[0].estBidVolume, 40);
    assert.equal(bidHit.candles[0].flowBias, 'BID_HEAVY');

    const askHit = buildCandleSeries(
      [{ date: '2026-11-10', lowest: 150, average: 150, highest: 150, order_count: 5, volume: 40 }],
      { bestBid: 100, bestAsk: 150 },
    );
    assert.equal(askHit.candles[0].askShare, 1);
    assert.equal(askHit.candles[0].estAskVolume, 40);
    assert.equal(askHit.candles[0].flowBias, 'ASK_HEAVY');
  });

  it('clamps gap-day candle bodies inside [lowest, highest] while preserving isUp direction', () => {
    const model = buildCandleSeries([
      { date: '2026-11-01', lowest: 100, average: 105, highest: 110, order_count: 10, volume: 50 },
      // Gap up: prevAverage=105 is below day-2 lowest=140
      { date: '2026-11-02', lowest: 140, average: 155, highest: 165, order_count: 12, volume: 60 },
      // Gap down: prevAverage=155 is above day-3 highest=120
      { date: '2026-11-03', lowest: 95, average: 105, highest: 120, order_count: 14, volume: 70 },
    ]);

    assert.equal(model.candles[1].isUp, true);
    assert.equal(model.candles[1].bodyOpen, 140);
    assert.equal(model.candles[1].bodyClose, 155);

    assert.equal(model.candles[2].isUp, false);
    assert.equal(model.candles[2].bodyOpen, 120);
    assert.equal(model.candles[2].bodyClose, 105);
  });

  it('produces accurate OrderFlowSummary verdicts across trading regimes', () => {
    const twoSided = buildCandleSeries([
      { date: '2026-11-01', lowest: 100, average: 150, highest: 200, order_count: 10, volume: 100 },
      { date: '2026-11-02', lowest: 100, average: 145, highest: 200, order_count: 10, volume: 100 },
    ]);
    assert.equal(twoSided.summary.verdict, 'TWO_SIDED');

    const askHeavy = buildCandleSeries([
      { date: '2026-11-01', lowest: 100, average: 190, highest: 200, order_count: 10, volume: 100 },
      { date: '2026-11-02', lowest: 100, average: 185, highest: 200, order_count: 10, volume: 100 },
    ]);
    assert.equal(askHeavy.summary.verdict, 'ASK_HEAVY');

    const bidHeavy = buildCandleSeries([
      { date: '2026-11-01', lowest: 100, average: 110, highest: 200, order_count: 10, volume: 100 },
      { date: '2026-11-02', lowest: 100, average: 115, highest: 200, order_count: 10, volume: 100 },
    ]);
    assert.equal(bidHeavy.summary.verdict, 'BID_HEAVY');

    const lowAct = buildCandleSeries([]);
    assert.equal(lowAct.summary.verdict, 'LOW_ACTIVITY');
  });

  it('keeps priceDomain focused on historical range when bestAsk is an extreme outlier', () => {
    const model = buildCandleSeries(
      [
        { date: '2026-11-01', lowest: 100, average: 110, highest: 120, order_count: 5, volume: 10 },
        { date: '2026-11-02', lowest: 105, average: 112, highest: 125, order_count: 6, volume: 12 },
      ],
      { bestBid: 108, bestAsk: 1200 },
    );

    assert.equal(model.showBestBidLine, true);
    assert.equal(model.showBestAskLine, false);
    assert.ok(model.priceDomain[1] < 200, `Expected domainMax < 200, got ${model.priceDomain[1]}`);
  });
});
