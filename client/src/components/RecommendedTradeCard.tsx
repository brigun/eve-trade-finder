import { Copy, Flame, Sparkles, TrendingUp } from 'lucide-react';
import {
  formatIskCompact,
  formatIskExact,
  formatPct,
  formatUnitsCompact,
  nextEveTick,
} from '../lib/format.ts';
import type { MarketItem, RecommendedTradesResponse } from '../types/api.ts';
import { ItemIcon } from './ItemIcon.tsx';

interface RecommendedTradeCardProps {
  recommended: RecommendedTradesResponse | null;
  loading: boolean;
  onSelectItem: (item: MarketItem) => void;
  onAskNeon: () => void;
  onNotify: (msg: string) => void;
}

function FactorBar({
  label,
  points,
  maxPoints,
  detail,
  barColor,
}: {
  label: string;
  points: number;
  maxPoints: number;
  detail: string;
  barColor: string;
}) {
  const pct = Math.min(100, Math.max(0, (points / maxPoints) * 100));
  return (
    <div className="bg-[#08090D]/80 border border-[#262938] rounded px-2.5 py-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#9CA0B0]">
          {label}
        </span>
        <span className="text-[11px] font-mono-num font-semibold text-[#EFEAE0]">
          {points.toFixed(1)}
          <span className="text-[#656A7C]">/{maxPoints}</span>
        </span>
      </div>
      <div className="h-1 w-full bg-[#161923] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
      <div className="text-[10px] font-mono-num text-[#656A7C] truncate">{detail}</div>
    </div>
  );
}

export function RecommendedTradeCard({
  recommended,
  loading,
  onSelectItem,
  onAskNeon,
  onNotify,
}: RecommendedTradeCardProps) {
  if (loading && !recommended) {
    return (
      <section className="corner-frame bg-[#0F1118] border border-[#262938] rounded-md px-4 py-3 text-xs font-mono-num text-[#656A7C]">
        Evaluating top Jita 4-4 trade recommendation...
      </section>
    );
  }

  if (!recommended || !recommended.top) {
    return null;
  }

  const top = recommended.top;
  const { scoreBreakdown } = top;

  const copyTick = async (e: React.MouseEvent, label: string, val: number) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(String(val));
      onNotify(`Copied ${label}: ${formatIskExact(val)}`);
    } catch {
      onNotify(`Value: ${formatIskExact(val)}`);
    }
  };

  return (
    <section className="corner-frame bg-[#0F1118] border border-[#262938] rounded-md p-4 space-y-3">
      {/* Spotlight Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#9B7BFF]/18 text-[#B298FF] border border-[#9B7BFF]/45 text-[10px] font-mono-num uppercase tracking-widest font-semibold">
            <Sparkles className="w-3 h-3" />
            Recommended Trade Right Now
          </span>
          <span className="px-2 py-0.5 rounded bg-[#161923] border border-[#262938] text-[10px] font-mono-num uppercase tracking-wider text-[#EFEAE0]">
            {recommended.scopeLabel}
          </span>
          <span className="text-[10px] font-mono-num text-[#656A7C]">
            Min ROI {recommended.minRoiPct}% · {recommended.evaluatedCount.toLocaleString()} qualified
            {recommended.fallbackUsed ? ' (relaxed history gate)' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {scoreBreakdown.momentumBonus > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#46E595]/15 text-[#46E595] border border-[#46E595]/35 text-[10px] font-mono-num">
              <TrendingUp className="w-3 h-3" />+{scoreBreakdown.momentumBonus.toFixed(0)} Momentum
            </span>
          )}
          <span className="px-2.5 py-0.5 rounded bg-[#46E595]/18 text-[#46E595] border border-[#46E595]/50 font-mono-num text-xs font-bold">
            SCORE {top.tradeScore.toFixed(1)} / 100
          </span>
          <button
            type="button"
            onClick={onAskNeon}
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-[#9B7BFF]/18 border border-[#9B7BFF]/55 hover:bg-[#9B7BFF]/30 text-[11px] font-semibold text-[#EFEAE0] cursor-pointer transition-colors"
          >
            <Sparkles className="w-3 h-3 text-[#B298FF]" />
            <span>Ask Neon</span>
          </button>
        </div>
      </div>

      {/* Main Content Grid: #1 Hero + #2/#3 Runners Up */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-stretch">
        {/* #1 Top Pick */}
        <div
          onClick={() => onSelectItem(top)}
          className="xl:col-span-8 bg-[#161923]/90 hover:bg-[#1D2130]/90 border border-[#262938] hover:border-[#9B7BFF]/60 rounded-md p-3.5 cursor-pointer transition-colors space-y-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <ItemIcon typeId={top.typeId} name={top.name} size={64} className="w-11 h-11" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono-num text-[11px] font-bold text-[#9B7BFF]">#1</span>
                  <h2 className="font-display text-sm sm:text-base font-bold text-[#EFEAE0] truncate">
                    {top.name}
                  </h2>
                  {top.isTrending && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-mono-num bg-[#46E595]/15 text-[#46E595] border border-[#46E595]/40">
                      <Flame className="w-2.5 h-2.5" />
                      HOT
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[#9CA0B0] truncate">{top.rootGroupName}</p>
              </div>
            </div>

            {/* Quick Copy Tick Buttons */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={(e) => void copyTick(e, 'Buy +1T', nextEveTick(top.bestBid, 'up'))}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#08090D] border border-[#262938] hover:border-[#46E595] font-mono-num text-[11px] text-[#EFEAE0] cursor-pointer"
                title="Copy 4-sig-fig outbid buy price"
              >
                <Copy className="w-3 h-3 text-[#46E595]" />
                <span>Buy {formatIskCompact(nextEveTick(top.bestBid, 'up'), false)}</span>
              </button>
              <button
                type="button"
                onClick={(e) => void copyTick(e, 'Sell -1T', nextEveTick(top.bestAsk, 'down'))}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] font-mono-num text-[11px] text-[#EFEAE0] cursor-pointer"
                title="Copy 4-sig-fig undercut sell price"
              >
                <Copy className="w-3 h-3 text-[#9B7BFF]" />
                <span>Sell {formatIskCompact(nextEveTick(top.bestAsk, 'down'), false)}</span>
              </button>
            </div>
          </div>

          {/* Core Trade Economics */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1 border-t border-[#262938]/80 text-xs font-mono-num">
            <div>
              <div className="text-[10px] uppercase text-[#656A7C]">Best Buy</div>
              <div className="text-[#EFEAE0] font-medium">{formatIskExact(top.bestBid)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-[#656A7C]">Best Sell</div>
              <div className="text-[#9CA0B0]">{formatIskExact(top.bestAsk)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-[#656A7C]">Net Profit / Unit</div>
              <div className="text-[#46E595] font-semibold">
                {formatIskCompact(top.netProfit, false)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-[#656A7C]">ROI %</div>
              <div className="text-[#46E595] font-bold">{formatPct(top.roiPct)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-[#656A7C]">Est. Daily Profit</div>
              <div className="text-[#EFEAE0] font-semibold">
                {formatIskCompact(top.estDailyProfit, false)}
              </div>
            </div>
          </div>

          {/* 4-Factor Scoring Telemetry Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <FactorBar
              label="Price & ROI"
              points={scoreBreakdown.profitScore}
              maxPoints={25}
              detail={`${formatPct(top.roiPct)} ROI · ${formatIskCompact(top.bestBid, false)}`}
              barColor="#46E595"
            />
            <FactorBar
              label="Sales Volume"
              points={scoreBreakdown.salesVolumeScore}
              maxPoints={30}
              detail={
                top.hasHistory
                  ? `${formatIskCompact(top.dailyIskVolume7d, false)}/d · ${formatUnitsCompact(top.dailyVolume7d)} u/d`
                  : 'No 30d history yet'
              }
              barColor="#9B7BFF"
            />
            <FactorBar
              label="Book Depth"
              points={scoreBreakdown.bookDepthScore}
              maxPoints={20}
              detail={`${formatIskCompact(top.bookDepthIsk, false)} · ${top.buyOrderCount}B/${top.sellOrderCount}S`}
              barColor="#B298FF"
            />
            <FactorBar
              label="Active Traders"
              points={scoreBreakdown.competitionScore}
              maxPoints={20}
              detail={`${top.totalCompetition} within 2% · ${top.recentUpdates1h} upd/1h`}
              barColor="#E07A63"
            />
          </div>
        </div>

        {/* Runners-Up (#2 & #3) */}
        <div className="xl:col-span-4 flex flex-col justify-between gap-2.5">
          {recommended.runnersUp.length > 0 ? (
            recommended.runnersUp.map((candidate, idx) => (
              <button
                key={candidate.typeId}
                type="button"
                onClick={() => onSelectItem(candidate)}
                className="flex-1 text-left bg-[#161923]/70 hover:bg-[#1D2130] border border-[#262938] hover:border-[#9B7BFF]/55 rounded-md p-3 transition-colors cursor-pointer flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-mono-num text-xs font-semibold text-[#656A7C] w-5 shrink-0">
                    #{idx + 2}
                  </span>
                  <ItemIcon
                    typeId={candidate.typeId}
                    name={candidate.name}
                    size={32}
                    className="w-8 h-8"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[#EFEAE0] truncate">
                      {candidate.name}
                    </div>
                    <div className="text-[10px] font-mono-num text-[#656A7C] truncate">
                      {candidate.rootGroupName} · {candidate.totalCompetition} comp ·{' '}
                      {formatIskCompact(candidate.bookDepthIsk, false)} depth
                    </div>
                  </div>
                </div>

                <div className="text-right font-mono-num shrink-0">
                  <div className="text-xs font-semibold text-[#46E595]">
                    {formatPct(candidate.roiPct)} ROI
                  </div>
                  <div className="text-[10px] text-[#B298FF]">
                    Score {candidate.tradeScore.toFixed(1)}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="flex-1 bg-[#161923]/40 border border-[#262938] rounded-md p-4 flex items-center justify-center text-xs font-mono-num text-[#656A7C]">
              No additional runners-up in current segment
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
