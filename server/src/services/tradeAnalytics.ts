export interface FeeConfig {
  brokerFeePct: number;
  salesTaxPct: number;
  captureSharePct: number;
}

export interface FeeSkillInputs {
  accountingLevel: number;
  brokerRelationsLevel: number;
  factionStanding: number;
  corpStanding: number;
}

export interface MarketSummaryLike {
  best_bid: number | null;
  best_ask: number | null;
  raw_best_bid: number | null;
  bid_min_volume: number;
  bid_volume: number;
  ask_volume: number;
  buy_order_count: number;
  sell_order_count: number;
  top_buy_competition: number;
  top_sell_competition: number;
  recent_updates_1h: number;
  recent_updates_24h: number;
}

export interface HistoryMetricsLike {
  daily_volume_7d: number;
  daily_volume_30d: number;
  daily_isk_volume_7d: number;
  daily_isk_volume_30d: number;
  avg_price_7d: number;
  avg_price_30d: number;
  volume_trend_pct: number;
  price_trend_pct: number;
  active_days_30d: number;
}

export interface AnomalyFlag {
  code:
    | 'MIN_VOL_TRAP'
    | 'INFLATED_ASK'
    | 'DEPRESSED_BID'
    | 'EXTREME_MARGIN'
    | 'LOW_HISTORY'
    | 'SINGLE_SELLER';
  severity: 'high' | 'medium';
  label: string;
  reason: string;
}

export interface ScoreBreakdown {
  profitScore: number;
  salesVolumeScore: number;
  bookDepthScore: number;
  competitionScore: number;
  momentumBonus: number;
  riskPenalty: number;
}

export interface ComputedItemMetrics {
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
  anomalies: AnomalyFlag[];
  hasAnomaly: boolean;
  hasCriticalAnomaly: boolean;
  isTrending: boolean;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export function eveTickStep(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0.01;
  const magnitude = Math.floor(Math.log10(price));
  return Math.max(0.01, Math.pow(10, magnitude - 3));
}

export function roundToEveSigFigs(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0.01;
  const step = eveTickStep(price);
  const rounded = Math.round(price / step) * step;
  const decimals = step < 1 ? Math.max(0, Math.round(-Math.log10(step))) : 0;
  return Number(Math.max(0.01, rounded).toFixed(decimals));
}

export function nextEveTick(price: number, direction: 'up' | 'down'): number {
  const p = roundToEveSigFigs(price);
  if (direction === 'up') {
    const step = eveTickStep(p);
    return roundToEveSigFigs(p + step);
  }
  if (p <= 0.01) return 0.01;

  const log10 = Math.log10(p);
  const nearestPow = Math.round(log10);
  if (p >= 100 && Math.abs(log10 - nearestPow) < 1e-9) {
    const stepBelow = Math.max(0.01, Math.pow(10, nearestPow - 4));
    return roundToEveSigFigs(p - stepBelow);
  }
  const step = eveTickStep(p);
  return roundToEveSigFigs(Math.max(0.01, p - step));
}

export function calculateEveFees(inputs: FeeSkillInputs): {
  brokerFeePct: number;
  salesTaxPct: number;
} {
  const accounting = clamp(Math.floor(inputs.accountingLevel), 0, 5);
  const brokerRelations = clamp(Math.floor(inputs.brokerRelationsLevel), 0, 5);
  const factionStanding = clamp(inputs.factionStanding, -10, 10);
  const corpStanding = clamp(inputs.corpStanding, -10, 10);

  const salesTaxPct = Number((7.5 * (1 - 0.11 * accounting)).toFixed(3));
  const brokerFeePct = Number(
    Math.max(
      1.0,
      3.0 - 0.3 * brokerRelations - 0.03 * factionStanding - 0.02 * corpStanding,
    ).toFixed(3),
  );

  return { brokerFeePct, salesTaxPct };
}

export function detectAnomalies(
  summary: MarketSummaryLike,
  history: HistoryMetricsLike | null,
  roiPct: number,
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];

  if (summary.bid_min_volume > 1) {
    flags.push({
      code: 'MIN_VOL_TRAP',
      severity: 'high',
      label: `Min Vol ${summary.bid_min_volume}`,
      reason: `Highest raw buy order requires minimum ${summary.bid_min_volume} units per fill (common Jita margin-trap pattern).`,
    });
  }

  if (
    history &&
    history.avg_price_30d > 0 &&
    summary.best_ask !== null &&
    summary.best_ask > history.avg_price_30d * 1.45
  ) {
    const mult = (summary.best_ask / history.avg_price_30d).toFixed(2);
    flags.push({
      code: 'INFLATED_ASK',
      severity: 'high',
      label: `Ask ${mult}x 30d Avg`,
      reason: `Current Jita best ask is ${mult}x higher than the 30-day average price — spread may be artificially bought out.`,
    });
  }

  if (
    history &&
    history.avg_price_30d > 0 &&
    summary.best_bid !== null &&
    summary.best_bid < history.avg_price_30d * 0.55
  ) {
    const ratioPct = Math.round((summary.best_bid / history.avg_price_30d) * 100);
    flags.push({
      code: 'DEPRESSED_BID',
      severity: 'medium',
      label: `Bid ${ratioPct}% of Avg`,
      reason: `Best buy order is only ${ratioPct}% of the 30-day average price — check order book depth before bidding.`,
    });
  }

  if (roiPct > 150) {
    flags.push({
      code: 'EXTREME_MARGIN',
      severity: 'high',
      label: `Extreme ROI (${roiPct.toFixed(0)}%)`,
      reason: 'Spread ROI exceeds 150%; unusually wide spreads often indicate illiquid or manipulated markets.',
    });
  }

  if (history && history.active_days_30d < 5) {
    flags.push({
      code: 'LOW_HISTORY',
      severity: 'medium',
      label: `${history.active_days_30d}/30 Active Days`,
      reason: `Item only traded on ${history.active_days_30d} of the last 30 days in The Forge.`,
    });
  }

  if (summary.sell_order_count === 1) {
    flags.push({
      code: 'SINGLE_SELLER',
      severity: 'medium',
      label: 'Single Seller',
      reason: 'Only 1 active sell order in Jita 4-4; ask price may reflect a monopoly listing.',
    });
  }

  return flags;
}

export function computeTradeScore(params: {
  summary: MarketSummaryLike;
  history: HistoryMetricsLike | null;
  bestBid: number;
  bestAsk: number;
  netProfit: number;
  roiPct: number;
  estDailyProfit: number | null;
  bidDepthIsk: number;
  askDepthIsk: number;
  anomalies: AnomalyFlag[];
  isTrending: boolean;
  hasCriticalAnomaly: boolean;
}): { tradeScore: number; scoreBreakdown: ScoreBreakdown } {
  const {
    summary,
    history,
    bestBid,
    bestAsk,
    netProfit,
    roiPct,
    estDailyProfit,
    bidDepthIsk,
    askDepthIsk,
    anomalies,
    isTrending,
    hasCriticalAnomaly,
  } = params;

  const round1 = (n: number) => Number(n.toFixed(1));

  // 1. Profit & Price Efficiency (0 - 25 pts)
  let profitScore = 0;
  if (netProfit > 0 && bestBid > 0 && bestAsk > 0) {
    const roiPart = 18 * clamp(Math.log1p(Math.min(roiPct, 80)) / Math.log1p(50), 0, 1);
    let pricePart = 2;
    if (bestBid >= 10_000 && bestBid <= 500_000_000) {
      pricePart = 7;
    } else if (bestBid >= 50 && bestBid < 10_000) {
      pricePart = 3 + 4 * clamp(Math.log10(bestBid / 50) / Math.log10(10_000 / 50), 0, 1);
    } else if (bestBid > 500_000_000 && bestBid <= 2_000_000_000) {
      pricePart = 7 - 3 * clamp((bestBid - 500_000_000) / 1_500_000_000, 0, 1);
    }
    profitScore = roiPart + pricePart;
  }

  // 2. Sales Volume & Daily Profit (0 - 30 pts)
  let salesVolumeScore = 0;
  if (history !== null) {
    const iskVolPart =
      16 * clamp(Math.log10(Math.max(1, history.daily_isk_volume_7d / 1_000_000)) / 3.7, 0, 1);
    const estProfitPart =
      10 * clamp(Math.log10(Math.max(1, (estDailyProfit ?? 0) / 100_000)) / 3.3, 0, 1);
    const consistencyPart = 4 * clamp(history.active_days_30d / 28, 0, 1);
    salesVolumeScore = iskVolPart + estProfitPart + consistencyPart;
  }

  // 3. Order Book Depth & Balance (0 - 20 pts)
  const minSideDepth = Math.min(bidDepthIsk, askDepthIsk);
  const maxSideDepth = Math.max(bidDepthIsk, askDepthIsk);
  const depthPart = 10 * clamp(Math.log10(Math.max(1, minSideDepth / 1_000_000)) / 3.0, 0, 1);
  const balancePart = maxSideDepth > 0 ? 5 * clamp(minSideDepth / maxSideDepth, 0, 1) : 0;
  const orderCountPart =
    5 * clamp(Math.min(summary.buy_order_count, summary.sell_order_count) / 5, 0, 1);
  const bookDepthScore = depthPart + balancePart + orderCountPart;

  // 4. Active Competing Traders & Velocity (0 - 20 pts)
  const topComp = summary.top_buy_competition + summary.top_sell_competition;
  let compPart = 4;
  if (topComp > 0 && topComp <= 10) {
    compPart = 8 + 4 * clamp(topComp / 4, 0, 1);
  } else if (topComp > 10) {
    compPart = 12 * Math.exp(-(topComp - 10) / 18);
  }

  let velocityPart = 2;
  if (summary.recent_updates_24h > 0) {
    if (summary.recent_updates_1h <= 6) {
      velocityPart = 8;
    } else {
      velocityPart = 8 * Math.exp(-(summary.recent_updates_1h - 6) / 10);
    }
  }
  const competitionScore = compPart + velocityPart;

  // 5. Momentum Bonus (0 - 5 pts) & Risk Penalty (0 - 25 pts)
  const momentumBonus = isTrending
    ? 5
    : history && history.volume_trend_pct >= 10 && !hasCriticalAnomaly
      ? 2
      : 0;

  let highSeverityCount = 0;
  let mediumSeverityCount = 0;
  for (const flag of anomalies) {
    if (flag.severity === 'high') highSeverityCount++;
    else mediumSeverityCount++;
  }
  const riskPenalty = Math.min(25, highSeverityCount * 15 + mediumSeverityCount * 6);

  const rawScore =
    profitScore + salesVolumeScore + bookDepthScore + competitionScore + momentumBonus - riskPenalty;
  const tradeScore = round1(clamp(rawScore, 0, 100));

  return {
    tradeScore,
    scoreBreakdown: {
      profitScore: round1(profitScore),
      salesVolumeScore: round1(salesVolumeScore),
      bookDepthScore: round1(bookDepthScore),
      competitionScore: round1(competitionScore),
      momentumBonus: round1(momentumBonus),
      riskPenalty: round1(riskPenalty),
    },
  };
}

export function computeItemMetrics(
  summary: MarketSummaryLike,
  history: HistoryMetricsLike | null,
  feeConfig: FeeConfig,
): ComputedItemMetrics {
  const bestBid = summary.best_bid ?? 0;
  const bestAsk = summary.best_ask ?? 0;
  const brokerRate = feeConfig.brokerFeePct / 100;
  const taxRate = feeConfig.salesTaxPct / 100;

  const buyCost = bestBid > 0 ? bestBid * (1 + brokerRate) : 0;
  const sellProceeds = bestAsk > 0 ? bestAsk * (1 - brokerRate - taxRate) : 0;
  const spreadIsk = bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : 0;
  const netProfit = bestBid > 0 && bestAsk > 0 ? sellProceeds - buyCost : 0;
  const roiPct = buyCost > 0 ? (netProfit / buyCost) * 100 : 0;
  const netMarginPct = bestAsk > 0 ? (netProfit / bestAsk) * 100 : 0;

  const captureShare = clamp(feeConfig.captureSharePct, 1, 100) / 100;
  const estDailyProfit =
    history && bestBid > 0 && bestAsk > 0
      ? Math.max(0, netProfit) * history.daily_volume_7d * captureShare
      : null;

  const bidDepthIsk = bestBid > 0 ? bestBid * summary.bid_volume : 0;
  const askDepthIsk = bestAsk > 0 ? bestAsk * summary.ask_volume : 0;
  const bookDepthIsk = bidDepthIsk + askDepthIsk;

  const anomalies = detectAnomalies(summary, history, roiPct);
  const hasAnomaly = anomalies.length > 0;
  const hasCriticalAnomaly = anomalies.some((flag) => flag.severity === 'high');

  const isTrending =
    history !== null &&
    history.active_days_30d >= 5 &&
    history.daily_isk_volume_7d >= 5_000_000 &&
    (history.volume_trend_pct >= 20 ||
      (history.price_trend_pct >= 5 && history.volume_trend_pct >= 0)) &&
    !hasCriticalAnomaly;

  const { tradeScore, scoreBreakdown } = computeTradeScore({
    summary,
    history,
    bestBid,
    bestAsk,
    netProfit,
    roiPct,
    estDailyProfit,
    bidDepthIsk,
    askDepthIsk,
    anomalies,
    isTrending,
    hasCriticalAnomaly,
  });

  return {
    buyCost,
    sellProceeds,
    spreadIsk,
    netProfit,
    roiPct,
    netMarginPct,
    estDailyProfit,
    bidDepthIsk,
    askDepthIsk,
    bookDepthIsk,
    tradeScore,
    scoreBreakdown,
    anomalies,
    hasAnomaly,
    hasCriticalAnomaly,
    isTrending,
  };
}
