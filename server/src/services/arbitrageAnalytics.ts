import { getHubById, getHubRoute, type HubId } from '../config.js';
import {
  nextEveTick,
  type AnomalyFlag,
  type FeeConfig,
} from './tradeAnalytics.js';

export type ArbitrageMode = 'instant' | 'relist' | 'buy_to_buy' | 'buy_to_sell';

export function parseArbitrageMode(val: unknown): ArbitrageMode {
  if (typeof val !== 'string') return 'instant';
  const normalized = val.trim().toLowerCase();
  if (normalized === 'relist' || normalized === 'sell_to_sell') return 'relist';
  if (normalized === 'buy_to_buy') return 'buy_to_buy';
  if (normalized === 'buy_to_sell') return 'buy_to_sell';
  return 'instant';
}

export function isSourceBuyOrderMode(mode: ArbitrageMode): boolean {
  return mode === 'buy_to_buy' || mode === 'buy_to_sell';
}

export function hasEligibleArbitrageSource(
  row: Pick<ArbitrageHubRow, 'best_bid' | 'best_ask' | 'bid_volume' | 'ask_volume' | 'buy_order_count'>,
  mode: ArbitrageMode,
): boolean {
  if (isSourceBuyOrderMode(mode)) {
    return (
      row.best_bid !== null &&
      row.best_bid > 0 &&
      row.bid_volume > 0 &&
      row.buy_order_count > 0
    );
  }
  return row.best_ask !== null && row.best_ask > 0 && row.ask_volume > 0;
}

export interface ArbitrageHubRow {
  hub_id: HubId;
  type_id: number;
  name: string;
  market_group_id: number | null;
  root_group_name: string;
  volume: number | null;
  best_bid: number | null;
  best_ask: number | null;
  raw_best_bid: number | null;
  bid_min_volume: number;
  bid_volume: number;
  ask_volume: number;
  buy_order_count: number;
  sell_order_count: number;
  // Hub-level regional history metrics (named dest_* for backwards compatibility; populated for both source and dest rows)
  dest_daily_volume_7d: number | null;
  dest_avg_price_30d: number | null;
  dest_active_days_30d: number | null;
}

export interface ArbitrageOpportunity {
  typeId: number;
  name: string;
  marketGroupId: number | null;
  rootGroupName: string;
  itemVolume: number | null;
  mode: ArbitrageMode;
  sourceHubId: HubId;
  sourceHubName: string;
  destHubId: HubId;
  destHubName: string;
  sourceBid: number | null;
  sourceAsk: number | null;
  destBid: number | null;
  destAsk: number | null;
  buyPrice: number;
  sellPrice: number;
  unitBuyCost: number;
  unitSellProceeds: number;
  unitNetProfit: number;
  roiPct: number;
  availableUnits: number;
  haulUnits: number;
  fitsCargo: boolean;
  totalBuyCost: number;
  totalNetProfit: number;
  totalVolumeM3: number | null;
  iskPerM3: number | null;
  jumps: number;
  isLowSecRoute: boolean;
  iskPerJump: number;
  destDailyVolume7d: number | null;
  hasAnomaly: boolean;
  anomalies: AnomalyFlag[];
}

export interface ArbitrageFilterCriteria {
  q: string;
  mode: ArbitrageMode;
  sourceHub: HubId | 'any';
  destHub: HubId | 'any';
  minRoiPct: number | null;
  maxRoiPct: number | null;
  minUnitProfit: number | null;
  minTotalProfit: number | null;
  minBuyPrice: number | null;
  maxBuyPrice: number | null;
  maxCargoM3: number | null;
  minIskPerM3: number | null;
  maxJumps: number | null;
  hideLowSecRoutes: boolean;
  minAvailableUnits: number | null;
  hideAnomalies: boolean;
  allowedMarketGroupIds: Set<number> | null;
  excludeRootGroups: Set<string>;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

export function computeArbitrageOpportunity(params: {
  source: ArbitrageHubRow;
  dest: ArbitrageHubRow;
  mode: ArbitrageMode;
  fees: FeeConfig;
  maxCargoM3: number | null;
}): ArbitrageOpportunity | null {
  const { source, dest, mode, fees, maxCargoM3 } = params;
  if (source.hub_id === dest.hub_id) return null;
  if (!hasEligibleArbitrageSource(source, mode)) return null;

  const usesSourceBuyOrder = isSourceBuyOrderMode(mode);
  const usesDestSellOrder = mode === 'relist' || mode === 'buy_to_sell';

  const brokerRate = fees.brokerFeePct / 100;
  const salesTaxRate = fees.salesTaxPct / 100;

  let buyPrice: number;
  let unitBuyCost: number;
  if (!usesSourceBuyOrder) {
    buyPrice = source.best_ask as number;
    unitBuyCost = buyPrice; // Buying from existing source sell order incurs 0% broker fee
  } else {
    buyPrice = nextEveTick(source.best_bid as number, 'up');
    unitBuyCost = buyPrice * (1 + brokerRate); // Placing source buy order incurs source broker fee
  }

  let sellPrice: number;
  let unitSellProceeds: number;
  if (!usesDestSellOrder) {
    if (dest.best_bid === null || dest.best_bid <= 0 || dest.bid_volume <= 0) return null;
    sellPrice = dest.best_bid;
    unitSellProceeds = sellPrice * (1 - salesTaxRate); // Dumping into existing buy order pays sales tax only
  } else {
    if (dest.best_ask === null || dest.best_ask <= 0 || dest.sell_order_count <= 0) return null;
    sellPrice = nextEveTick(dest.best_ask, 'down');
    unitSellProceeds = sellPrice * (1 - brokerRate - salesTaxRate);
  }

  let availableUnits: number;
  if (mode === 'instant') {
    availableUnits = Math.min(source.ask_volume, dest.bid_volume);
  } else if (mode === 'relist') {
    availableUnits = source.ask_volume;
  } else if (mode === 'buy_to_buy') {
    availableUnits = dest.bid_volume;
  } else {
    availableUnits = source.bid_volume;
  }

  const unitNetProfit = unitSellProceeds - unitBuyCost;
  const roiPct = unitBuyCost > 0 ? (unitNetProfit / unitBuyCost) * 100 : 0;

  const itemVolume = source.volume !== null && source.volume > 0 ? source.volume : null;
  const cargoUnits =
    maxCargoM3 !== null && maxCargoM3 > 0 && itemVolume !== null
      ? Math.floor(maxCargoM3 / itemVolume)
      : null;
  const fitsCargo = cargoUnits === null || cargoUnits >= 1;
  const haulUnits = Math.max(
    0,
    cargoUnits !== null ? Math.min(availableUnits, cargoUnits) : availableUnits,
  );

  const totalBuyCost = unitBuyCost * haulUnits;
  const totalNetProfit = unitNetProfit * haulUnits;
  const totalVolumeM3 = itemVolume !== null ? itemVolume * haulUnits : null;
  const iskPerM3 = itemVolume !== null ? unitNetProfit / itemVolume : null;

  const route = getHubRoute(source.hub_id, dest.hub_id);
  const iskPerJump = route.jumps > 0 ? totalNetProfit / route.jumps : totalNetProfit;

  const anomalies: AnomalyFlag[] = [];
  if (!usesDestSellOrder && dest.bid_min_volume > 1) {
    anomalies.push({
      code: 'MIN_VOL_TRAP',
      severity: 'high',
      label: `Min Vol ${dest.bid_min_volume}`,
      reason: `Destination buy order requires minimum ${dest.bid_min_volume} units per fill.`,
    });
  }
  if (roiPct > 150) {
    anomalies.push({
      code: 'EXTREME_MARGIN',
      severity: 'high',
      label: `Extreme ROI (${roiPct.toFixed(0)}%)`,
      reason: 'Arbitrage ROI exceeds 150%; verify destination book depth and price history.',
    });
  }
  if (usesSourceBuyOrder) {
    const srcName = getHubById(source.hub_id).shortName;
    if (
      source.dest_avg_price_30d !== null &&
      source.dest_avg_price_30d > 0 &&
      source.best_bid !== null &&
      source.best_bid < source.dest_avg_price_30d * 0.55
    ) {
      const ratioPct = Math.round((source.best_bid / source.dest_avg_price_30d) * 100);
      anomalies.push({
        code: 'DEPRESSED_BID',
        severity: 'medium',
        label: `Src Bid ${ratioPct}% of Avg`,
        reason: `Source best bid at ${srcName} is only ${ratioPct}% of its 30-day regional average; buy order may fill slowly.`,
      });
    }
    if (source.dest_active_days_30d !== null && source.dest_active_days_30d < 5) {
      anomalies.push({
        code: 'LOW_HISTORY',
        severity: 'medium',
        label: `${srcName} ${source.dest_active_days_30d}/30d`,
        reason: `Low source regional volume at ${srcName} (${source.dest_active_days_30d} active days in last 30d); buy order may fill slowly.`,
      });
    }
  }
  if (usesDestSellOrder && dest.sell_order_count === 1) {
    anomalies.push({
      code: 'SINGLE_SELLER',
      severity: 'medium',
      label: 'Single Seller',
      reason: `Only 1 sell order at ${getHubById(dest.hub_id).shortName}; destination ask may be inflated.`,
    });
  }
  if (
    usesDestSellOrder &&
    dest.dest_avg_price_30d !== null &&
    dest.dest_avg_price_30d > 0 &&
    dest.best_ask !== null &&
    dest.best_ask > dest.dest_avg_price_30d * 1.45
  ) {
    const mult = (dest.best_ask / dest.dest_avg_price_30d).toFixed(2);
    anomalies.push({
      code: 'INFLATED_ASK',
      severity: 'high',
      label: `Ask ${mult}x 30d Avg`,
      reason: `Destination ask is ${mult}x above the regional 30-day average price.`,
    });
  }
  if (
    usesDestSellOrder &&
    dest.dest_active_days_30d !== null &&
    dest.dest_active_days_30d < 5
  ) {
    anomalies.push({
      code: 'LOW_HISTORY',
      severity: 'medium',
      label: `${dest.dest_active_days_30d}/30 Active Days`,
      reason: `Low destination regional volume (${dest.dest_active_days_30d} active days in last 30d).`,
    });
  }

  return {
    typeId: source.type_id,
    name: source.name,
    marketGroupId: source.market_group_id,
    rootGroupName: source.root_group_name,
    itemVolume,
    mode,
    sourceHubId: source.hub_id,
    sourceHubName: getHubById(source.hub_id).shortName,
    destHubId: dest.hub_id,
    destHubName: getHubById(dest.hub_id).shortName,
    sourceBid: source.best_bid,
    sourceAsk: source.best_ask,
    destBid: dest.best_bid,
    destAsk: dest.best_ask,
    buyPrice,
    sellPrice,
    unitBuyCost,
    unitSellProceeds,
    unitNetProfit,
    roiPct,
    availableUnits,
    haulUnits,
    fitsCargo,
    totalBuyCost,
    totalNetProfit,
    totalVolumeM3,
    iskPerM3,
    jumps: route.jumps,
    isLowSecRoute: route.isLowSecRoute,
    iskPerJump,
    destDailyVolume7d: dest.dest_daily_volume_7d,
    hasAnomaly: anomalies.length > 0,
    anomalies,
  };
}

export function filterAndSortArbitrage(
  opportunities: ArbitrageOpportunity[],
  criteria: ArbitrageFilterCriteria,
): ArbitrageOpportunity[] {
  const qLower = criteria.q.trim().toLowerCase();

  const filtered = opportunities.filter((opp) => {
    if (opp.unitNetProfit <= 0 || !opp.fitsCargo || opp.haulUnits <= 0) return false;
    if (criteria.sourceHub !== 'any' && opp.sourceHubId !== criteria.sourceHub) return false;
    if (criteria.destHub !== 'any' && opp.destHubId !== criteria.destHub) return false;

    if (qLower && !opp.name.toLowerCase().includes(qLower) && String(opp.typeId) !== qLower) {
      return false;
    }

    if (criteria.allowedMarketGroupIds !== null) {
      if (opp.marketGroupId === null || !criteria.allowedMarketGroupIds.has(opp.marketGroupId)) {
        return false;
      }
    } else if (criteria.excludeRootGroups.has(opp.rootGroupName)) {
      return false;
    }

    if (criteria.hideLowSecRoutes && opp.isLowSecRoute) return false;
    if (criteria.hideAnomalies && opp.hasAnomaly) return false;
    if (criteria.maxJumps !== null && opp.jumps > criteria.maxJumps) return false;
    if (criteria.minRoiPct !== null && opp.roiPct < criteria.minRoiPct) return false;
    if (criteria.maxRoiPct !== null && opp.roiPct > criteria.maxRoiPct) return false;
    if (criteria.minUnitProfit !== null && opp.unitNetProfit < criteria.minUnitProfit) return false;
    if (criteria.minTotalProfit !== null && opp.totalNetProfit < criteria.minTotalProfit) return false;
    if (criteria.minBuyPrice !== null && opp.buyPrice < criteria.minBuyPrice) return false;
    if (criteria.maxBuyPrice !== null && opp.buyPrice > criteria.maxBuyPrice) return false;
    if (criteria.minAvailableUnits !== null && opp.haulUnits < criteria.minAvailableUnits) {
      return false;
    }
    if (criteria.minIskPerM3 !== null) {
      if (opp.iskPerM3 === null || opp.iskPerM3 < criteria.minIskPerM3) return false;
    }

    return true;
  });

  const getSortValue = (opp: ArbitrageOpportunity): number | string | null => {
    switch (criteria.sortBy) {
      case 'name':
        return opp.name;
      case 'unitNetProfit':
        return opp.unitNetProfit;
      case 'roiPct':
        return opp.roiPct;
      case 'iskPerM3':
        return opp.iskPerM3;
      case 'iskPerJump':
        return opp.iskPerJump;
      case 'jumps':
        return opp.jumps;
      case 'totalBuyCost':
        return opp.totalBuyCost;
      case 'haulUnits':
        return opp.haulUnits;
      case 'totalNetProfit':
      default:
        return opp.totalNetProfit;
    }
  };

  filtered.sort((a, b) => {
    const va = getSortValue(a);
    const vb = getSortValue(b);
    if (va === null && vb === null) return b.totalNetProfit - a.totalNetProfit;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === 'string' && typeof vb === 'string') {
      return criteria.sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    const diff = Number(va) - Number(vb);
    if (diff !== 0) {
      return criteria.sortDir === 'asc' ? diff : -diff;
    }
    return b.totalNetProfit - a.totalNetProfit;
  });

  return filtered;
}
