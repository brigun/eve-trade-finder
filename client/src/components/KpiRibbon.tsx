import { Flame, Layers, LineChart, Target } from 'lucide-react';
import { formatPct } from '../lib/format.ts';
import { getHubMeta } from '../lib/hubs.ts';
import type { HubId, MarketStats } from '../types/api.ts';

interface KpiRibbonProps {
  activeHub: HubId;
  stats: MarketStats | null;
  matchedCount: number;
  avgRoiPct: number;
  trendingOnly: boolean;
  onToggleTrending: () => void;
}

export function KpiRibbon({
  activeHub,
  stats,
  matchedCount,
  avgRoiPct,
  trendingOnly,
  onToggleTrending,
}: KpiRibbonProps) {
  const coveragePct = stats?.historyCoveragePct ?? 0;
  const hubMeta = getHubMeta(activeHub);

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {/* KPI 1: Active Hub Market Coverage */}
      <div className="corner-frame bg-[#0F1118] border border-[#262938] rounded-md px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono-num uppercase tracking-widest text-[#656A7C]">
            {hubMeta.name} Active Markets
          </span>
          <Layers className="w-3.5 h-3.5 text-[#9B7BFF]" />
        </div>
        <div className="mt-1.5 flex items-baseline justify-between">
          <span className="font-mono-num text-xl font-semibold text-[#EFEAE0]">
            {stats ? stats.twoSidedItems.toLocaleString() : '—'}
          </span>
          <span className="font-mono-num text-[11px] text-[#9CA0B0]">
            {stats ? `${stats.totalJitaOrders.toLocaleString()} orders` : 'No orders synced'}
          </span>
        </div>
      </div>

      {/* KPI 2: Matching Constraints */}
      <div className="corner-frame bg-[#0F1118] border border-[#262938] rounded-md px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono-num uppercase tracking-widest text-[#656A7C]">
            Filtered Opportunities
          </span>
          <Target className="w-3.5 h-3.5 text-[#E07A63]" />
        </div>
        <div className="mt-1.5 flex items-baseline justify-between">
          <span className="font-mono-num text-xl font-semibold text-[#EFEAE0]">
            {matchedCount.toLocaleString()}
          </span>
          <span className="font-mono-num text-[11px] text-[#46E595]">
            Avg ROI {formatPct(avgRoiPct)}
          </span>
        </div>
      </div>

      {/* KPI 3: Trending Movers */}
      <button
        type="button"
        onClick={onToggleTrending}
        className={`corner-frame text-left rounded-md px-4 py-3 border transition-colors cursor-pointer ${
          trendingOnly
            ? 'bg-[#46E595]/10 border-[#46E595]/50'
            : 'bg-[#0F1118] border-[#262938] hover:border-[#46E595]/40'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono-num uppercase tracking-widest text-[#656A7C]">
            Trending Movers (7d vs 30d)
          </span>
          <Flame className="w-3.5 h-3.5 text-[#46E595]" />
        </div>
        <div className="mt-1.5 flex items-baseline justify-between">
          <span className="font-mono-num text-xl font-semibold text-[#46E595]">
            {stats ? stats.trendingItemsCount.toLocaleString() : '—'}
          </span>
          <span className="font-mono-num text-[11px] text-[#9CA0B0]">
            {trendingOnly ? 'Filter Active' : 'Click to isolate'}
          </span>
        </div>
      </button>

      {/* KPI 4: 30-Day History Coverage */}
      <div className="corner-frame bg-[#0F1118] border border-[#262938] rounded-md px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono-num uppercase tracking-widest text-[#656A7C]">
            30d History Telemetry
          </span>
          <LineChart className="w-3.5 h-3.5 text-[#9B7BFF]" />
        </div>
        <div className="mt-1.5 flex items-baseline justify-between">
          <span className="font-mono-num text-xl font-semibold text-[#EFEAE0]">
            {stats ? `${stats.historyCoveredItems.toLocaleString()}` : '—'}
          </span>
          <span className="font-mono-num text-[11px] text-[#9B7BFF]">{coveragePct.toFixed(1)}%</span>
        </div>
        <div className="mt-1.5 h-1 w-full bg-[#161923] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#9B7BFF] transition-all duration-300"
            style={{ width: `${Math.min(100, coveragePct)}%` }}
          />
        </div>
      </div>
    </section>
  );
}
