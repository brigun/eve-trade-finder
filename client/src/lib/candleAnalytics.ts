export interface HistoryInputPoint {
  date: string;
  average: number;
  highest: number;
  lowest: number;
  order_count: number;
  volume: number;
}

export type OrderFlowVerdict = 'TWO_SIDED' | 'ASK_HEAVY' | 'BID_HEAVY' | 'LOW_ACTIVITY';
export type DayFlowBias = 'BID_HEAVY' | 'TWO_SIDED' | 'ASK_HEAVY';

export interface CandlePoint {
  date: string;
  lowest: number;
  highest: number;
  average: number;
  prevAverage: number;
  bodyOpen: number;
  bodyClose: number;
  candleRange: [number, number];
  isUp: boolean;
  isFlat: boolean;
  rangeIsk: number;
  rangePct: number;
  volume: number;
  orderCount: number;
  askShare: number;
  bidShare: number;
  estAskVolume: number;
  estBidVolume: number;
  flowBias: DayFlowBias;
}

export interface OrderFlowSummary {
  totalVolume: number;
  estBidVolume: number;
  estAskVolume: number;
  bidSharePct: number;
  askSharePct: number;
  twoSidedDays: number;
  bidHeavyDays: number;
  askHeavyDays: number;
  activeDays: number;
  verdict: OrderFlowVerdict;
  verdictLabel: string;
  verdictDetail: string;
}

export interface CandleChartModel {
  candles: CandlePoint[];
  summary: OrderFlowSummary;
  priceDomain: [number, number];
  showBestBidLine: boolean;
  showBestAskLine: boolean;
}

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  if (val < min) return min;
  if (val > max) return max;
  return val;
}

export function buildCandleSeries(
  history: HistoryInputPoint[],
  opts?: {
    bestBid?: number | null;
    bestAsk?: number | null;
    days?: number;
  },
): CandleChartModel {
  const bestBid = opts?.bestBid ?? null;
  const bestAsk = opts?.bestAsk ?? null;
  const days = Math.max(1, Math.floor(opts?.days ?? 30));

  if (history.length === 0) {
    return {
      candles: [],
      summary: {
        totalVolume: 0,
        estBidVolume: 0,
        estAskVolume: 0,
        bidSharePct: 50,
        askSharePct: 50,
        twoSidedDays: 0,
        bidHeavyDays: 0,
        askHeavyDays: 0,
        activeDays: 0,
        verdict: 'LOW_ACTIVITY',
        verdictLabel: 'Low Activity',
        verdictDetail: 'No recorded sales volume in this window.',
      },
      priceDomain: [0, 1],
      showBestBidLine: false,
      showBestAskLine: false,
    };
  }

  const sorted = [...history].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  const startIdx = Math.max(0, sorted.length - days);
  const visible = sorted.slice(startIdx);

  const candles: CandlePoint[] = [];
  let totalVolume = 0;
  let totalEstBidVolume = 0;
  let totalEstAskVolume = 0;
  let twoSidedDays = 0;
  let bidHeavyDays = 0;
  let askHeavyDays = 0;
  let activeDays = 0;

  let histMin = Infinity;
  let histMax = -Infinity;

  for (let i = 0; i < visible.length; i++) {
    const entry = visible[i];
    const prevEntry = i > 0 ? visible[i - 1] : startIdx > 0 ? sorted[startIdx - 1] : entry;

    const low = Math.min(entry.lowest, entry.highest);
    const high = Math.max(entry.lowest, entry.highest);
    const avg = entry.average;
    const prevAvg = prevEntry.average;
    const isFlat = high <= low;

    let askShare: number;
    if (high > low) {
      askShare = clamp((avg - low) / (high - low), 0, 1);
    } else if (bestBid !== null && bestAsk !== null && bestAsk > bestBid) {
      askShare = clamp((avg - bestBid) / (bestAsk - bestBid), 0, 1);
    } else {
      askShare = 0.5;
    }

    const bidShare = 1 - askShare;
    const vol = Math.max(0, Math.round(entry.volume));
    const estAskVolume = Math.round(vol * askShare);
    const estBidVolume = Math.max(0, vol - estAskVolume);

    const bodyOpen = clamp(prevAvg, low, high);
    const bodyClose = clamp(avg, low, high);
    const isUp = avg >= prevAvg;
    const rangeIsk = Math.max(0, high - low);
    const rangePct = low > 0 ? (rangeIsk / low) * 100 : 0;

    const flowBias: DayFlowBias =
      askShare < 0.3 ? 'BID_HEAVY' : askShare > 0.7 ? 'ASK_HEAVY' : 'TWO_SIDED';

    if (vol > 0) {
      activeDays++;
      totalVolume += vol;
      totalEstBidVolume += estBidVolume;
      totalEstAskVolume += estAskVolume;
      if (flowBias === 'BID_HEAVY') bidHeavyDays++;
      else if (flowBias === 'ASK_HEAVY') askHeavyDays++;
      else twoSidedDays++;
    }

    if (low < histMin) histMin = low;
    if (high > histMax) histMax = high;

    candles.push({
      date: entry.date,
      lowest: low,
      highest: high,
      average: avg,
      prevAverage: prevAvg,
      bodyOpen,
      bodyClose,
      candleRange: [low, high],
      isUp,
      isFlat,
      rangeIsk,
      rangePct,
      volume: vol,
      orderCount: Math.max(0, Math.round(entry.order_count)),
      askShare,
      bidShare,
      estAskVolume,
      estBidVolume,
      flowBias,
    });
  }

  let askSharePct = 50;
  let bidSharePct = 50;
  let verdict: OrderFlowVerdict = 'LOW_ACTIVITY';
  let verdictLabel = 'Low Activity';
  let verdictDetail = 'No recorded sales volume in this window.';

  if (totalVolume > 0) {
    askSharePct = (totalEstAskVolume / totalVolume) * 100;
    bidSharePct = 100 - askSharePct;

    if (askSharePct >= 70) {
      verdict = 'ASK_HEAVY';
      verdictLabel = 'Sell-Order Heavy';
      verdictDetail =
        'Most volume is bought off sell orders — easy to sell, slower to fill buy orders.';
    } else if (askSharePct <= 30) {
      verdict = 'BID_HEAVY';
      verdictLabel = 'Buy-Order Heavy';
      verdictDetail =
        'Most volume is dumped into buy orders — easy to buy, slower to move sell orders.';
    } else {
      verdict = 'TWO_SIDED';
      verdictLabel = 'Two-Sided Flow';
      verdictDetail =
        'Active fills on both buy and sell sides — healthy station-trading flow.';
    }
  }

  const showBestBidLine =
    bestBid !== null &&
    bestBid > 0 &&
    Number.isFinite(histMin) &&
    Number.isFinite(histMax) &&
    bestBid >= histMin * 0.5 &&
    bestBid <= histMax * 1.5;

  const showBestAskLine =
    bestAsk !== null &&
    bestAsk > 0 &&
    Number.isFinite(histMin) &&
    Number.isFinite(histMax) &&
    bestAsk >= histMin * 0.5 &&
    bestAsk <= histMax * 1.5;

  let rawMin = Number.isFinite(histMin) ? histMin : 0;
  let rawMax = Number.isFinite(histMax) ? histMax : 1;

  if (showBestBidLine && bestBid !== null) {
    rawMin = Math.min(rawMin, bestBid);
    rawMax = Math.max(rawMax, bestBid);
  }
  if (showBestAskLine && bestAsk !== null) {
    rawMin = Math.min(rawMin, bestAsk);
    rawMax = Math.max(rawMax, bestAsk);
  }

  const span = rawMax - rawMin;
  const pad = span > 0 ? span * 0.06 : Math.max(rawMax * 0.05, 0.01);
  const domainMin = Math.max(0, rawMin - pad);
  const domainMax = rawMax + pad;

  return {
    candles,
    summary: {
      totalVolume,
      estBidVolume: totalEstBidVolume,
      estAskVolume: totalEstAskVolume,
      bidSharePct,
      askSharePct,
      twoSidedDays,
      bidHeavyDays,
      askHeavyDays,
      activeDays,
      verdict,
      verdictLabel,
      verdictDetail,
    },
    priceDomain: [domainMin, domainMax],
    showBestBidLine,
    showBestAskLine,
  };
}
