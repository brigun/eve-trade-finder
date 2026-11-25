import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchOrderToHubs } from '../../config/hubs.js';
import {
  computeArbitrageOpportunity,
  filterAndSortArbitrage,
  hasEligibleArbitrageSource,
  parseArbitrageMode,
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

  it('parses all 4 arbitrage pairing modes and legacy aliases safely', () => {
    assert.equal(parseArbitrageMode('instant'), 'instant');
    assert.equal(parseArbitrageMode('sell_to_buy'), 'instant');
    assert.equal(parseArbitrageMode('relist'), 'relist');
    assert.equal(parseArbitrageMode('sell_to_sell'), 'relist');
    assert.equal(parseArbitrageMode('buy_to_buy'), 'buy_to_buy');
    assert.equal(parseArbitrageMode(' BUY_TO_SELL '), 'buy_to_sell');
    assert.equal(parseArbitrageMode(undefined), 'instant');
    assert.equal(parseArbitrageMode('unknown'), 'instant');
  });

  it('computes Bid -> Instant (Buy -> Buy) with source +1 tick, source broker fee, and dest sales tax', () => {
    const jitaSource = makeHubRow({
      hub_id: 'jita',
      type_id: 1004,
      name: 'Shield Boost Amplifier II',
      volume: 5,
      best_bid: 1_000_000,
      best_ask: null,
      ask_volume: 0,
      sell_order_count: 0,
      bid_volume: 300,
      buy_order_count: 5,
      dest_avg_price_30d: 1_100_000,
      dest_active_days_30d: 30,
    });
    const amarrDest = makeHubRow({
      hub_id: 'amarr',
      type_id: 1004,
      name: 'Shield Boost Amplifier II',
      volume: 5,
      best_bid: 1_200_000,
      bid_volume: 80,
      bid_min_volume: 1,
    });

    const opp = computeArbitrageOpportunity({
      source: jitaSource,
      dest: amarrDest,
      mode: 'buy_to_buy',
      fees: DEFAULT_FEES,
      maxCargoM3: 10_000,
    });

    assert.ok(opp);
    assert.equal(opp.mode, 'buy_to_buy');
    assert.equal(opp.sourceBid, 1_000_000);
    assert.equal(opp.sourceAsk, null);
    // 1,000,000 + 1 EVE tick = 1,001,000; * (1 + 0.03) = 1,031,030
    assert.equal(opp.buyPrice, 1_001_000);
    assert.equal(Math.round(opp.unitBuyCost), 1_031_030);
    assert.equal(opp.sellPrice, 1_200_000);
    assert.equal(Math.round(opp.unitSellProceeds), 1_110_000);
    assert.equal(Math.round(opp.unitNetProfit), 78_970);
    assert.equal(opp.availableUnits, 80);
    assert.equal(opp.haulUnits, 80);
    assert.equal(opp.hasAnomaly, false);

    // Cargo-capping (< availableUnits)
    const cargoCapped = computeArbitrageOpportunity({
      source: jitaSource,
      dest: amarrDest,
      mode: 'buy_to_buy',
      fees: DEFAULT_FEES,
      maxCargoM3: 100, // 100 / 5 = 20 units (< 80 dest bid_volume)
    });
    assert.ok(cargoCapped);
    assert.equal(cargoCapped.availableUnits, 80);
    assert.equal(cargoCapped.haulUnits, 20);
    assert.equal(cargoCapped.totalVolumeM3, 100);

    // Null guards for missing/zero source or destination legs
    assert.equal(
      hasEligibleArbitrageSource({ ...jitaSource, best_bid: null }, 'buy_to_buy'),
      false,
    );
    assert.equal(
      hasEligibleArbitrageSource({ ...jitaSource, buy_order_count: 0 }, 'buy_to_buy'),
      false,
    );
    assert.equal(
      computeArbitrageOpportunity({
        source: { ...jitaSource, best_bid: null },
        dest: amarrDest,
        mode: 'buy_to_buy',
        fees: DEFAULT_FEES,
        maxCargoM3: 10_000,
      }),
      null,
    );
    assert.equal(
      computeArbitrageOpportunity({
        source: { ...jitaSource, buy_order_count: 0 },
        dest: amarrDest,
        mode: 'buy_to_buy',
        fees: DEFAULT_FEES,
        maxCargoM3: 10_000,
      }),
      null,
    );
    assert.equal(
      computeArbitrageOpportunity({
        source: jitaSource,
        dest: { ...amarrDest, best_bid: null },
        mode: 'buy_to_buy',
        fees: DEFAULT_FEES,
        maxCargoM3: 10_000,
      }),
      null,
    );

    // Flags MIN_VOL_TRAP on dest and DEPRESSED_BID on source
    const risky = computeArbitrageOpportunity({
      source: { ...jitaSource, best_bid: 500_000 },
      dest: { ...amarrDest, bid_min_volume: 5 },
      mode: 'buy_to_buy',
      fees: DEFAULT_FEES,
      maxCargoM3: 10_000,
    });
    assert.ok(risky);
    assert.ok(risky.anomalies.some((a) => a.code === 'MIN_VOL_TRAP'));
    assert.ok(risky.anomalies.some((a) => a.code === 'DEPRESSED_BID'));
  });

  it('computes Bid -> Relist (Buy -> Sell) with +1/-1 ticks, double broker fee, and source/dest anomalies', () => {
    const jitaSource = makeHubRow({
      hub_id: 'jita',
      type_id: 1005,
      name: 'Warp Scrambler II',
      volume: 5,
      best_bid: 1_000_000,
      best_ask: null,
      ask_volume: 0,
      sell_order_count: 0,
      bid_volume: 60,
      buy_order_count: 4,
      dest_avg_price_30d: 1_050_000,
      dest_active_days_30d: 25,
    });
    const dodixieDest = makeHubRow({
      hub_id: 'dodixie',
      type_id: 1005,
      name: 'Warp Scrambler II',
      volume: 5,
      best_ask: 1_300_000,
      sell_order_count: 3,
      dest_avg_price_30d: 1_250_000,
      dest_active_days_30d: 20,
    });

    const opp = computeArbitrageOpportunity({
      source: jitaSource,
      dest: dodixieDest,
      mode: 'buy_to_sell',
      fees: DEFAULT_FEES,
      maxCargoM3: 10_000,
    });

    assert.ok(opp);
    assert.equal(opp.mode, 'buy_to_sell');
    assert.equal(opp.buyPrice, 1_001_000);
    assert.equal(Math.round(opp.unitBuyCost), 1_031_030);
    assert.equal(opp.sellPrice, 1_299_000);
    assert.equal(Math.round(opp.unitSellProceeds), 1_162_605);
    assert.equal(Math.round(opp.unitNetProfit), 131_575);
    assert.equal(opp.availableUnits, 60);
    assert.equal(opp.haulUnits, 60);
    assert.equal(opp.hasAnomaly, false);

    // Cargo-capping (< source.bid_volume) and null-leg rejection
    const cargoCappedSell = computeArbitrageOpportunity({
      source: jitaSource,
      dest: dodixieDest,
      mode: 'buy_to_sell',
      fees: DEFAULT_FEES,
      maxCargoM3: 75, // 75 / 5 = 15 units (< 60 source bid_volume)
    });
    assert.ok(cargoCappedSell);
    assert.equal(cargoCappedSell.availableUnits, 60);
    assert.equal(cargoCappedSell.haulUnits, 15);
    assert.equal(cargoCappedSell.totalVolumeM3, 75);
    assert.equal(
      computeArbitrageOpportunity({
        source: jitaSource,
        dest: { ...dodixieDest, best_ask: null },
        mode: 'buy_to_sell',
        fees: DEFAULT_FEES,
        maxCargoM3: 10_000,
      }),
      null,
    );

    // Flags SINGLE_SELLER, INFLATED_ASK, DEPRESSED_BID, and LOW_HISTORY
    const risky = computeArbitrageOpportunity({
      source: { ...jitaSource, best_bid: 400_000, dest_active_days_30d: 2 },
      dest: { ...dodixieDest, sell_order_count: 1, best_ask: 2_500_000, dest_active_days_30d: 3 },
      mode: 'buy_to_sell',
      fees: DEFAULT_FEES,
      maxCargoM3: 10_000,
    });
    assert.ok(risky);
    const codes = new Set(risky.anomalies.map((a) => a.code));
    assert.ok(codes.has('SINGLE_SELLER'));
    assert.ok(codes.has('INFLATED_ASK'));
    assert.ok(codes.has('DEPRESSED_BID'));
    assert.ok(codes.has('LOW_HISTORY'));
  });

  it('matches best_bid / best_ask instead of crossing the spread on 1-tick tight spreads', () => {
    // 1-tick source spread: 999,900 bid / 1,000,000 ask (+1 tick would cross 1,000,000 ask)
    const tightSource = makeHubRow({
      hub_id: 'jita',
      type_id: 1006,
      name: '1-Tick Spread Module',
      volume: 5,
      best_bid: 999_900,
      best_ask: 1_000_000,
      bid_volume: 50,
      ask_volume: 50,
    });
    // 1-tick dest spread: 1,299,000 bid / 1,300,000 ask (-1 tick would cross 1,299,000 bid)
    const tightDest = makeHubRow({
      hub_id: 'amarr',
      type_id: 1006,
      name: '1-Tick Spread Module',
      volume: 5,
      best_bid: 1_299_000,
      best_ask: 1_300_000,
      bid_volume: 50,
      ask_volume: 50,
    });

    const buyToBuy = computeArbitrageOpportunity({
      source: tightSource,
      dest: tightDest,
      mode: 'buy_to_buy',
      fees: DEFAULT_FEES,
      maxCargoM3: 10_000,
    });
    assert.ok(buyToBuy);
    assert.equal(buyToBuy.sourceTickMatched, true);
    assert.equal(buyToBuy.destTickMatched, false);
    assert.equal(buyToBuy.buyPrice, 999_900);
    assert.equal(buyToBuy.sellPrice, 1_299_000);

    const buyToSell = computeArbitrageOpportunity({
      source: tightSource,
      dest: tightDest,
      mode: 'buy_to_sell',
      fees: DEFAULT_FEES,
      maxCargoM3: 10_000,
    });
    assert.ok(buyToSell);
    assert.equal(buyToSell.sourceTickMatched, true);
    assert.equal(buyToSell.destTickMatched, true);
    assert.equal(buyToSell.buyPrice, 999_900);
    assert.equal(buyToSell.sellPrice, 1_300_000);

    const relist = computeArbitrageOpportunity({
      source: tightSource,
      dest: tightDest,
      mode: 'relist',
      fees: DEFAULT_FEES,
      maxCargoM3: 10_000,
    });
    assert.ok(relist);
    assert.equal(relist.sourceTickMatched, false);
    assert.equal(relist.destTickMatched, true);
    assert.equal(relist.buyPrice, 1_000_000);
    assert.equal(relist.sellPrice, 1_300_000);

    // Wide spread behaves with normal +1T / -1T stepping and flags false
    const wide = computeArbitrageOpportunity({
      source: { ...tightSource, best_bid: 990_000 },
      dest: { ...tightDest, best_bid: 1_200_000 },
      mode: 'buy_to_sell',
      fees: DEFAULT_FEES,
      maxCargoM3: 10_000,
    });
    assert.ok(wide);
    assert.equal(wide.sourceTickMatched, false);
    assert.equal(wide.destTickMatched, false);
    assert.equal(wide.buyPrice, 990_100);
    assert.equal(wide.sellPrice, 1_299_000);
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
