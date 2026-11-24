import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchOrderToHubs } from '../../config/hubs.js';
import {
  computeArbitrageOpportunity,
  filterAndSortArbitrage,
  type ArbitrageFilterCriteria,
  type ArbitrageHubRow,
} from '../arbitrageAnalytics.js';
import type { FeeConfig } from '../tradeAnalytics.js';

const DEFAULT_FEES: FeeConfig = {
  brokerFeePct: 3.0,
  salesTaxPct: 7.5,
  captureSharePct: 15,
};

function makeHubRow(overrides: Partial<ArbitrageHubRow>): ArbitrageHubRow {
  return {
    hub_id: 'jita',
    type_id: 34,
    name: 'Tritanium',
    market_group_id: 18,
    root_group_name: 'Materials',
    volume: 10,
    best_bid: 90,
    best_ask: 100,
    raw_best_bid: 90,
    bid_min_volume: 1,
    bid_volume: 100,
    ask_volume: 100,
    buy_order_count: 5,
    sell_order_count: 5,
    dest_daily_volume_7d: 500,
    dest_avg_price_30d: 150,
    dest_active_days_30d: 30,
    ...overrides,
  };
}

describe('Inter-hub arbitrage analytics', () => {
  it('computes Instant (Sell -> Buy) profit with sales tax only and caps haul by cargo and depth', () => {
    const jitaSource = makeHubRow({
      hub_id: 'jita',
      type_id: 1001,
      name: 'Damage Control II',
      volume: 5,
      best_ask: 1_000_000,
      ask_volume: 300,
    });
    const amarrDest = makeHubRow({
      hub_id: 'amarr',
      type_id: 1001,
      name: 'Damage Control II',
      volume: 5,
      best_bid: 1_200_000,
      bid_volume: 200,
    });

    // 400 m3 cargo fits 80 units of 5 m3 item (< min(300, 200))
    const opp = computeArbitrageOpportunity({
      source: jitaSource,
      dest: amarrDest,
      mode: 'instant',
      fees: DEFAULT_FEES,
      maxCargoM3: 400,
    });

    assert.ok(opp);
    assert.equal(opp.buyPrice, 1_000_000);
    assert.equal(opp.sellPrice, 1_200_000);
    // 1,200,000 * (1 - 0.075) = 1,110,000 -> unit profit = 110,000 ISK
    assert.equal(opp.unitSellProceeds, 1_110_000);
    assert.equal(opp.unitNetProfit, 110_000);
    assert.equal(Math.round(opp.roiPct * 10) / 10, 11.0);
    assert.equal(opp.haulUnits, 80);
    assert.equal(opp.totalVolumeM3, 400);
    assert.equal(opp.totalNetProfit, 8_800_000);
    assert.equal(opp.iskPerM3, 22_000);
    assert.equal(opp.jumps, 45);
    assert.equal(opp.isLowSecRoute, false);
    assert.equal(Math.round(opp.iskPerJump), Math.round(8_800_000 / 45));
  });

  it('computes Relist (Sell -> Sell) profit with dest broker fee + sales tax and -1 tick undercut', () => {
    const jitaSource = makeHubRow({
      hub_id: 'jita',
      type_id: 1002,
      name: 'Adaptive Invulnerability Field II',
      volume: 5,
      best_ask: 1_000_000,
      ask_volume: 50,
    });
    const dodixieDest = makeHubRow({
      hub_id: 'dodixie',
      type_id: 1002,
      name: 'Adaptive Invulnerability Field II',
      volume: 5,
      best_ask: 1_300_000,
      sell_order_count: 4,
      dest_avg_price_30d: 1_250_000,
    });

    const opp = computeArbitrageOpportunity({
      source: jitaSource,
      dest: dodixieDest,
      mode: 'relist',
      fees: DEFAULT_FEES,
      maxCargoM3: 10_000,
    });

    assert.ok(opp);
    // 1,300,000 stepped down 1 EVE sig-fig tick = 1,299,000
    assert.equal(opp.sellPrice, 1_299_000);
    // 1,299,000 * (1 - 0.03 - 0.075) = 1,299,000 * 0.895 = 1,162,605
    assert.equal(Math.round(opp.unitSellProceeds), 1_162_605);
    assert.equal(Math.round(opp.unitNetProfit), 162_605);
    assert.equal(opp.haulUnits, 50);
    assert.equal(opp.jumps, 15);
    assert.equal(opp.isLowSecRoute, false);
  });

  it('flags Amamake routes as low-sec and filters them when hideLowSecRoutes is true', () => {
    const rensSource = makeHubRow({
      hub_id: 'rens',
      type_id: 1003,
      name: 'Nanite Repair Paste',
      volume: 0.01,
      best_ask: 20_000,
      ask_volume: 1000,
    });
    const amamakeDest = makeHubRow({
      hub_id: 'amamake',
      type_id: 1003,
      name: 'Nanite Repair Paste',
      volume: 0.01,
      best_bid: 30_000,
      bid_volume: 500,
    });
    const hekDest = makeHubRow({
      hub_id: 'hek',
      type_id: 1003,
      name: 'Nanite Repair Paste',
      volume: 0.01,
      best_bid: 25_000,
      bid_volume: 500,
    });

    const amamakeOpp = computeArbitrageOpportunity({
      source: rensSource,
      dest: amamakeDest,
      mode: 'instant',
      fees: DEFAULT_FEES,
      maxCargoM3: 1000,
    })!;
    const hekOpp = computeArbitrageOpportunity({
      source: rensSource,
      dest: hekDest,
      mode: 'instant',
      fees: DEFAULT_FEES,
      maxCargoM3: 1000,
    })!;

    assert.equal(amamakeOpp.isLowSecRoute, true);
    assert.equal(amamakeOpp.jumps, 5);
    assert.equal(hekOpp.isLowSecRoute, false);

    const baseCriteria: ArbitrageFilterCriteria = {
      q: '',
      mode: 'instant',
      sourceHub: 'any',
      destHub: 'any',
      minRoiPct: null,
      maxRoiPct: null,
      minUnitProfit: null,
      minTotalProfit: null,
      minBuyPrice: null,
      maxBuyPrice: null,
      maxCargoM3: 1000,
      minIskPerM3: null,
      maxJumps: 10,
      hideLowSecRoutes: true,
      minAvailableUnits: null,
      hideAnomalies: false,
      allowedMarketGroupIds: null,
      excludeRootGroups: new Set(),
      sortBy: 'totalNetProfit',
      sortDir: 'desc',
    };

    const highSecOnly = filterAndSortArbitrage([amamakeOpp, hekOpp], baseCriteria);
    assert.equal(highSecOnly.length, 1);
    assert.equal(highSecOnly[0].destHubId, 'hek');

    const withLowSec = filterAndSortArbitrage([amamakeOpp, hekOpp], {
      ...baseCriteria,
      hideLowSecRoutes: false,
    });
    assert.equal(withLowSec.length, 2);
    assert.equal(withLowSec[0].destHubId, 'amamake');
  });

  it('matches local orders cleanly for both Rens station and Amamake NPC stations', () => {
    // Rens Brutor Tribe Treasury station order also matches system 30002510 (not Amamake)
    assert.deepEqual(matchOrderToHubs({ location_id: 60004588, system_id: 30002510 }), ['rens']);
    // Any NPC station order in Amamake system 30002537 matches amamake
    assert.deepEqual(matchOrderToHubs({ location_id: 60004624, system_id: 30002537 }), ['amamake']);
    // Remote Perimeter buy order should NOT match Jita (local only)
    assert.deepEqual(matchOrderToHubs({ location_id: 60003754, system_id: 30000144 }), []);
  });
});
