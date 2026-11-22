import type { MarketItemDto } from '../routes/market.js';

export type NeonSessionStyle = 'quick_flip' | 'balanced' | 'overnight';

export interface NeonPickInput {
  typeId?: unknown;
  headline?: unknown;
  rationale?: unknown;
  executionPlan?: unknown;
  riskNote?: unknown;
  suggestedQty?: unknown;
}

export interface RawNeonLlmResponse {
  sessionSummary?: unknown;
  recommendations?: unknown;
}

export interface NeonTradePick {
  rank: number;
  typeId: number;
  headline: string;
  rationale: string;
  executionPlan: string;
  riskNote: string;
  suggestedQty: number;
  estimatedCapitalIsk: number;
  estimatedNetProfitIsk: number;
  outbidBuyPrice: number;
  undercutSellPrice: number;
  item: MarketItemDto;
}

const DEFAULT_EXCLUDED_GROUPS = new Set([
  'Ship SKINs',
  'Apparel',
  'Blueprints & Reactions',
]);

function clampNum(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export function parseLlmJsonObject(rawText: string): RawNeonLlmResponse {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('LLM returned an empty response.');
  }

  // Strip optional markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as RawNeonLlmResponse;
    }
  } catch {
    // Fall through to brace extraction
  }

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = candidate.slice(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(slice);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as RawNeonLlmResponse;
    }
  }

  throw new Error('Could not parse structured JSON from LLM response.');
}

function sessionAdjustedRankScore(
  item: MarketItemDto,
  sessionStyle: NeonSessionStyle,
): number {
  if (sessionStyle === 'quick_flip') {
    const unitsBonus = item.dailyVolume7d && item.dailyVolume7d >= 20 ? 4 : 0;
    const compPenalty = Math.max(0, item.totalCompetition - 8) * 0.6;
    const velBonus = item.recentUpdates1h <= 6 && item.recentUpdates24h > 0 ? 4 : 0;
    return item.tradeScore + unitsBonus + velBonus - compPenalty;
  }
  if (sessionStyle === 'overnight') {
    const roiBonus = clampNum((item.roiPct - 10) * 0.25, 0, 8);
    const depthBonus = clampNum(item.scoreBreakdown.bookDepthScore * 0.25, 0, 5);
    return item.tradeScore + roiBonus + depthBonus;
  }
  return item.tradeScore;
}

export function selectNeonCandidates(
  items: MarketItemDto[],
  opts: {
    minRoiPct?: number;
    budgetIsk?: number | null;
    sessionStyle?: NeonSessionStyle;
    explicitGroupFilter?: boolean;
    limit?: number;
  },
): MarketItemDto[] {
  const minRoiPct = opts.minRoiPct ?? 10;
  const budgetIsk =
    opts.budgetIsk !== undefined && opts.budgetIsk !== null && opts.budgetIsk > 0
      ? opts.budgetIsk
      : null;
  const sessionStyle = opts.sessionStyle ?? 'balanced';
  const limit = opts.limit ?? 25;

  const baseFiltered = items.filter((item) => {
    if (item.roiPct < minRoiPct) return false;
    if (!opts.explicitGroupFilter && DEFAULT_EXCLUDED_GROUPS.has(item.rootGroupName)) {
      return false;
    }
    if (budgetIsk !== null && item.buyCost > budgetIsk) return false;
    return true;
  });

  let pool = baseFiltered.filter(
    (item) =>
      !item.hasAnomaly &&
      item.hasHistory &&
      (item.activeDays30d ?? 0) >= 5 &&
      (item.dailyIskVolume7d ?? 0) >= 5_000_000 &&
      item.buyOrderCount >= 2 &&
      item.sellOrderCount >= 2,
  );

  if (pool.length < 6) {
    pool = baseFiltered.filter(
      (item) => !item.hasCriticalAnomaly && item.buyOrderCount >= 1 && item.sellOrderCount >= 1,
    );
  }

  return [...pool]
    .sort((a, b) => {
      const diff =
        sessionAdjustedRankScore(b, sessionStyle) - sessionAdjustedRankScore(a, sessionStyle);
      if (Math.abs(diff) > 0.01) return diff;
      return (b.estDailyProfit ?? 0) - (a.estDailyProfit ?? 0);
    })
    .slice(0, limit);
}

function defaultSuggestedQty(item: MarketItemDto, budgetIsk: number | null): number {
  const volumeTarget = Math.max(1, Math.round((item.dailyVolume7d ?? 5) * 0.15));
  const softCapitalCap = budgetIsk !== null ? budgetIsk * 0.45 : 250_000_000;
  const maxByCap = Math.max(1, Math.floor(softCapitalCap / Math.max(1, item.buyCost)));
  return Math.max(1, Math.min(volumeTarget, maxByCap, 100_000));
}

export function hydrateAndValidateNeonPicks(
  raw: RawNeonLlmResponse,
  candidates: MarketItemDto[],
  opts: {
    budgetIsk?: number | null;
    tickFn: (price: number, dir: 'up' | 'down') => number;
  },
): { sessionSummary: string; recommendations: NeonTradePick[] } {
  const budgetIsk =
    opts.budgetIsk !== undefined && opts.budgetIsk !== null && opts.budgetIsk > 0
      ? opts.budgetIsk
      : null;

  const candidateById = new Map<number, MarketItemDto>();
  for (const c of candidates) {
    candidateById.set(c.typeId, c);
  }

  const picks: NeonTradePick[] = [];
  const usedIds = new Set<number>();

  const rawList = Array.isArray(raw.recommendations) ? (raw.recommendations as NeonPickInput[]) : [];

  for (const entry of rawList) {
    if (!entry || typeof entry !== 'object') continue;
    const typeId = Number(entry.typeId);
    if (!Number.isInteger(typeId) || usedIds.has(typeId)) continue;
    const item = candidateById.get(typeId);
    if (!item) continue;

    usedIds.add(typeId);

    const parsedQty = Number(entry.suggestedQty);
    let qty =
      Number.isFinite(parsedQty) && parsedQty >= 1
        ? Math.round(parsedQty)
        : defaultSuggestedQty(item, budgetIsk);

    if (budgetIsk !== null) {
      const maxAffordable = Math.max(1, Math.floor(budgetIsk / Math.max(1, item.buyCost)));
      qty = Math.min(qty, maxAffordable);
    }
    qty = clampNum(qty, 1, 1_000_000);

    picks.push({
      rank: picks.length + 1,
      typeId: item.typeId,
      headline:
        typeof entry.headline === 'string' && entry.headline.trim()
          ? entry.headline.trim()
          : `${item.roiPct.toFixed(1)}% ROI · Score ${item.tradeScore.toFixed(1)}`,
      rationale:
        typeof entry.rationale === 'string' && entry.rationale.trim()
          ? entry.rationale.trim()
          : `Strong ${item.roiPct.toFixed(1)}% spread backed by balanced order book depth and active Jita turnover.`,
      executionPlan:
        typeof entry.executionPlan === 'string' && entry.executionPlan.trim()
          ? entry.executionPlan.trim()
          : `Place buy order 1 tick above best bid and list sell order 1 tick below best ask.`,
      riskNote:
        typeof entry.riskNote === 'string' && entry.riskNote.trim()
          ? entry.riskNote.trim()
          : `Monitor ${item.totalCompetition} competing orders within 2% (${item.recentUpdates1h} updates/1h).`,
      suggestedQty: qty,
      estimatedCapitalIsk: item.buyCost * qty,
      estimatedNetProfitIsk: item.netProfit * qty,
      outbidBuyPrice: opts.tickFn(item.bestBid, 'up'),
      undercutSellPrice: opts.tickFn(item.bestAsk, 'down'),
      item,
    });

    if (picks.length >= 3) break;
  }

  // Backfill up to 3 grounded picks if the model omitted or hallucinated any IDs
  for (const item of candidates) {
    if (picks.length >= 3) break;
    if (usedIds.has(item.typeId)) continue;
    usedIds.add(item.typeId);

    const qty = defaultSuggestedQty(item, budgetIsk);
    picks.push({
      rank: picks.length + 1,
      typeId: item.typeId,
      headline: `Quantitative Backup · ${item.roiPct.toFixed(1)}% ROI`,
      rationale: `Ranks among the top Jita 4-4 candidates with Trade Score ${item.tradeScore.toFixed(1)}/100, ${item.buyOrderCount}B/${item.sellOrderCount}S orders, and clean anomaly checks.`,
      executionPlan: `Enter via buy order at +1 EVE tick and exit just under top sell.`,
      riskNote: `Watch ${item.totalCompetition} close competitors and ${item.recentUpdates1h} updates/1h.`,
      suggestedQty: qty,
      estimatedCapitalIsk: item.buyCost * qty,
      estimatedNetProfitIsk: item.netProfit * qty,
      outbidBuyPrice: opts.tickFn(item.bestBid, 'up'),
      undercutSellPrice: opts.tickFn(item.bestAsk, 'down'),
      item,
    });
  }

  const sessionSummary =
    typeof raw.sessionSummary === 'string' && raw.sessionSummary.trim()
      ? raw.sessionSummary.trim()
      : `Selected top ${picks.length} Jita 4-4 station-trading opportunities ranked by price efficiency, sales volume, book depth, and trader competition.`;

  return { sessionSummary, recommendations: picks };
}
