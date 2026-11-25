import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Globe,
  type LucideIcon,
  Package,
  Repeat,
  RotateCcw,
  Search,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  formatIskCompact,
  formatIskExact,
  formatPct,
  formatRelativeTime,
  formatShorthandInput,
  parseIskShorthand,
} from '../lib/format.ts';
import { getHubMeta, HUB_LIST } from '../lib/hubs.ts';
import type {
  ArbitrageFilterState,
  ArbitrageMode,
  ArbitrageOpportunity,
  ArbitrageResponse,
  HubId,
  MarketGroupTreeNode,
  SyncStatusResponse,
} from '../types/api.ts';
import { ItemIcon } from './ItemIcon.tsx';
import { MarketGroupPicker } from './MarketGroupPicker.tsx';

interface ArbitrageViewProps {
  groupTree: MarketGroupTreeNode[];
  syncStatus: SyncStatusResponse | null;
  onSyncAllHubs: () => void;
  onSelectItem: (typeId: number, hubId: HubId) => void;
  onNotify: (msg: string) => void;
}

const DEFAULT_ARB_FILTERS: ArbitrageFilterState = {
  q: '',
  mode: 'instant',
  sourceHub: 'any',
  destHub: 'any',
  minRoiPct: 5,
  maxRoiPct: null,
  minUnitProfit: null,
  minTotalProfit: 500_000,
  minBuyPrice: null,
  maxBuyPrice: null,
  maxCargoM3: 10_000,
  minIskPerM3: null,
  maxJumps: null,
  hideLowSecRoutes: false,
  minAvailableUnits: 1,
  hideAnomalies: true,
  excludeRootGroups: ['Ship SKINs', 'Apparel', 'Blueprints & Reactions'],
  marketGroupId: null,
  marketGroupIds: [],
  sortBy: 'totalNetProfit',
  sortDir: 'desc',
};

const CARGO_PRESETS: Array<{ label: string; value: number | null }> = [
  { label: 'Any', value: null },
  { label: '400m³ (Frig)', value: 400 },
  { label: '10k m³ (BR)', value: 10_000 },
  { label: '60k m³ (DST)', value: 60_000 },
  { label: '350k m³ (Freighter)', value: 350_000 },
];

const QUICK_EXCLUDES = ['Ship SKINs', 'Apparel', 'Blueprints & Reactions'];

const PAIRING_MODES: Array<{
  mode: ArbitrageMode;
  label: string;
  title: string;
  buyColHeader: string;
  sellColHeader: string;
  activeClass: string;
  Icon: LucideIcon;
}> = [
  {
    mode: 'instant',
    label: 'Instant (Sell → Buy)',
    title:
      'Buy from Source Sell orders and dump immediately into Destination Buy orders (sales tax only)',
    buyColHeader: 'Buy (Source Ask)',
    sellColHeader: 'Sell (Dest Bid)',
    activeClass: 'bg-[#46E595]/20 text-[#46E595] border-[#46E595]/45',
    Icon: Zap,
  },
  {
    mode: 'relist',
    label: 'Relist (Sell → Sell)',
    title:
      'Buy from Source Sell orders and list Sell order at Destination Best Ask -1 Tick (pays Dest broker + sales tax)',
    buyColHeader: 'Buy (Source Ask)',
    sellColHeader: 'List (Dest -1T)',
    activeClass: 'bg-[#9B7BFF]/20 text-[#B298FF] border-[#9B7BFF]/45',
    Icon: Package,
  },
  {
    mode: 'buy_to_buy',
    label: 'Bid → Instant (Buy → Buy)',
    title:
      'Place Buy order at Source Best Bid +1 Tick and dump into Destination Buy orders (pays Source broker + sales tax)',
    buyColHeader: 'Bid (Source +1T)',
    sellColHeader: 'Sell (Dest Bid)',
    activeClass: 'bg-[#F5B841]/18 text-[#F5B841] border-[#F5B841]/45',
    Icon: ArrowDownToLine,
  },
  {
    mode: 'buy_to_sell',
    label: 'Bid → Relist (Buy → Sell)',
    title:
      'Place Buy order at Source Best Bid +1 Tick and list Sell order at Destination Best Ask -1 Tick (pays both Source & Dest broker fees + sales tax)',
    buyColHeader: 'Bid (Source +1T)',
    sellColHeader: 'List (Dest -1T)',
    activeClass: 'bg-[#38BDF8]/18 text-[#38BDF8] border-[#38BDF8]/45',
    Icon: Repeat,
  },
];

function getSummaryFeeLabel(mode: ArbitrageMode, fees?: ArbitrageResponse['fees']): string {
  const bkr = (fees?.brokerFeePct ?? 3.0).toFixed(2);
  const tax = (fees?.salesTaxPct ?? 7.5).toFixed(2);
  switch (mode) {
    case 'instant':
      return `Instant Fees (Tax ${tax}%)`;
    case 'relist':
      return `Relist Fees (Dest Bkr ${bkr}% + Tax ${tax}%)`;
    case 'buy_to_buy':
      return `Bid → Instant Fees (Src Bkr ${bkr}% + Tax ${tax}%)`;
    case 'buy_to_sell':
      return `Bid → Relist Fees (2× Bkr ${bkr}% + Tax ${tax}%)`;
  }
}

function ShorthandInput({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: number | null;
  placeholder: string;
  onCommit: (val: number | null) => void;
}) {
  const [draft, setDraft] = useState(() => formatShorthandInput(value));

  useEffect(() => {
    setDraft(formatShorthandInput(value));
  }, [value]);

  const commit = () => {
    const parsed = parseIskShorthand(draft);
    onCommit(parsed !== null && parsed >= 0 ? parsed : null);
    setDraft(formatShorthandInput(parsed !== null && parsed >= 0 ? parsed : null));
  };

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#656A7C] truncate">
        {label}
      </span>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none text-xs font-mono-num text-[#EFEAE0] placeholder:text-[#656A7C]/70"
      />
    </label>
  );
}

export function ArbitrageView({
  groupTree,
  syncStatus,
  onSyncAllHubs,
  onSelectItem,
  onNotify,
}: ArbitrageViewProps) {
  const [filters, setFilters] = useState<ArbitrageFilterState>(DEFAULT_ARB_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ArbitrageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const wasRunningRef = useRef(false);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestId = ++requestIdRef.current;

    setLoading(true);
    try {
      const res = await api.getArbitrageOpportunities(filters, page, 50, controller.signal);
      if (requestId === requestIdRef.current) {
        setData(res);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (requestId === requestIdRef.current) {
        onNotify(err instanceof Error ? err.message : 'Failed to load arbitrage opportunities');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [filters, page, onNotify]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void load();
    }, 120);
    return () => window.clearTimeout(id);
  }, [load]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const running = Boolean(syncStatus?.orderSync.running);
    if (wasRunningRef.current && !running) {
      void load();
    }
    wasRunningRef.current = running;
  }, [syncStatus?.orderSync.running, load]);

  const updateFilters = (next: ArbitrageFilterState) => {
    setPage(1);
    setFilters(next);
  };

  const handleSort = (col: string) => {
    setPage(1);
    if (filters.sortBy === col) {
      setFilters({ ...filters, sortDir: filters.sortDir === 'desc' ? 'asc' : 'desc' });
    } else {
      setFilters({
        ...filters,
        sortBy: col,
        sortDir: col === 'name' || col === 'jumps' ? 'asc' : 'desc',
      });
    }
  };

  const swapHubs = () => {
    updateFilters({
      ...filters,
      sourceHub: filters.destHub,
      destHub: filters.sourceHub,
    });
  };

  const toggleExclude = (grp: string) => {
    const exists = filters.excludeRootGroups.includes(grp);
    updateFilters({
      ...filters,
      excludeRootGroups: exists
        ? filters.excludeRootGroups.filter((g) => g !== grp)
        : [...filters.excludeRootGroups, grp],
    });
  };

  const renderSortArrow = (col: string) => {
    if (filters.sortBy !== col) return null;
    return <span className="ml-1 text-[#46E595]">{filters.sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  const hubs = data?.hubs ?? syncStatus?.hubs ?? [];
  const syncedHubsCount = hubs.filter((h) => h.twoSidedItems > 0 || h.totalOrders > 0).length;
  const orderRunning = Boolean(syncStatus?.orderSync.running || syncStatus?.sdeSync.running);
  const displayMode = data?.mode ?? filters.mode;
  const activePairing =
    PAIRING_MODES.find((p) => p.mode === displayMode) ?? PAIRING_MODES[0];

  return (
    <div className="space-y-4">
      {/* Hub Freshness Strip */}
      <div className="bg-[#0F1118] border border-[#262938] rounded-md px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-mono-num uppercase tracking-widest text-[#656A7C] mr-1">
            Hub Telemetry ({syncedHubsCount}/6)
          </span>
          {HUB_LIST.map((hub) => {
            const fresh = hubs.find((h) => h.hubId === hub.id);
            const hasData = (fresh?.twoSidedItems ?? 0) > 0 || (fresh?.totalOrders ?? 0) > 0;
            return (
              <span
                key={hub.id}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#161923] border border-[#262938] text-[11px] font-mono-num"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: hasData ? hub.accentColor : '#3C4055' }}
                />
                <span className={hasData ? 'text-[#EFEAE0]' : 'text-[#656A7C]'}>
                  {hub.shortName}
                </span>
                {hub.isLowSec && (
                  <span className="text-[9px] text-[#FF4D6D]">LS</span>
                )}
                <span className="text-[10px] text-[#656A7C]">
                  {fresh?.lastSyncedAt ? formatRelativeTime(fresh.lastSyncedAt) : 'unsynced'}
                </span>
              </span>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onSyncAllHubs}
          disabled={orderRunning}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border transition-colors cursor-pointer disabled:opacity-50 ${
            syncedHubsCount < 2
              ? 'bg-[#46E595] text-[#08090D] border-[#46E595] hover:bg-[#5ef0a8]'
              : 'bg-[#161923] text-[#46E595] border-[#46E595]/50 hover:bg-[#46E595]/15'
          }`}
        >
          <Globe className={`w-3.5 h-3.5 ${orderRunning ? 'animate-spin' : ''}`} />
          <span>{orderRunning ? 'Syncing Hubs...' : 'Sync All 6 Hubs'}</span>
        </button>
      </div>

      {syncedHubsCount < 2 && (
        <div className="bg-[#161923] border border-[#F5B841]/45 rounded-md px-4 py-3 flex items-center gap-3 text-xs text-[#EFEAE0]">
          <AlertTriangle className="w-4 h-4 text-[#F5B841] shrink-0" />
          <span>
            Inter-hub arbitrage needs at least <strong>2 synced trade hubs</strong>. Click{' '}
            <strong className="text-[#46E595]">Sync All 6 Hubs</strong> above (or sync individual
            hubs from the top bar) to compare live order books across Jita, Amarr, Dodixie, Rens,
            Hek, and Amamake.
          </span>
        </div>
      )}

      {/* Arbitrage Filter Panel */}
      <section className="bg-[#0F1118] border border-[#262938] rounded-md p-4 space-y-3.5">
        {/* Top Row: Execution Mode + Source/Dest + Search */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Sell/Buy Execution Pairings */}
          <div
            role="group"
            aria-label="Arbitrage pairing mode"
            className="flex flex-wrap items-center bg-[#08090D] p-1 rounded-md border border-[#262938] gap-0.5"
          >
            {PAIRING_MODES.map(({ mode, label, title, activeClass, Icon }) => {
              const active = filters.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={active}
                  onClick={() => updateFilters({ ...filters, mode })}
                  title={title}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border cursor-pointer transition-colors whitespace-nowrap ${
                    active
                      ? activeClass
                      : 'text-[#9CA0B0] hover:text-[#EFEAE0] border-transparent'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          {/* Route Hub Selectors */}
          <div className="flex items-center gap-1.5">
            <select
              aria-label="Source Hub"
              value={filters.sourceHub}
              onChange={(e) =>
                updateFilters({ ...filters, sourceHub: e.target.value as HubId | 'any' })
              }
              className="px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none text-xs font-mono-num text-[#EFEAE0]"
            >
              <option value="any">From: Any Hub</option>
              {HUB_LIST.map((h) => (
                <option key={h.id} value={h.id}>
                  From: {h.shortName}{h.isLowSec ? ' (LS)' : ''}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={swapHubs}
              title="Swap Source and Destination hubs"
              className="p-1.5 rounded bg-[#161923] border border-[#262938] hover:border-[#9B7BFF] text-[#9CA0B0] hover:text-[#EFEAE0] cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>

            <select
              aria-label="Destination Hub"
              value={filters.destHub}
              onChange={(e) =>
                updateFilters({ ...filters, destHub: e.target.value as HubId | 'any' })
              }
              className="px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none text-xs font-mono-num text-[#EFEAE0]"
            >
              <option value="any">To: Any Hub</option>
              {HUB_LIST.map((h) => (
                <option key={h.id} value={h.id}>
                  To: {h.shortName}{h.isLowSec ? ' (LS)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-[#656A7C] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={filters.q}
              onChange={(e) => updateFilters({ ...filters, q: e.target.value })}
              placeholder="Filter arbitrage items by name or typeID..."
              className="w-full pl-8 pr-3 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none text-xs text-[#EFEAE0] placeholder:text-[#656A7C]"
            />
          </div>

          <MarketGroupPicker
            tree={groupTree}
            selectedGroupId={filters.marketGroupId}
            onSelect={(id) => updateFilters({ ...filters, marketGroupId: id })}
          />

          <button
            type="button"
            onClick={() => updateFilters(DEFAULT_ARB_FILTERS)}
            title="Reset arbitrage filters"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#161923] border border-[#262938] hover:border-[#9B7BFF] text-xs text-[#9CA0B0] hover:text-[#EFEAE0] cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>

        {/* Cargo Capacity Presets + Route & Financial Inputs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 items-end">
          <ShorthandInput
            label="Max Cargo (m³)"
            value={filters.maxCargoM3}
            placeholder="e.g. 10k"
            onCommit={(val) => updateFilters({ ...filters, maxCargoM3: val })}
          />
          <ShorthandInput
            label="Min ISK / m³"
            value={filters.minIskPerM3}
            placeholder="e.g. 1k"
            onCommit={(val) => updateFilters({ ...filters, minIskPerM3: val })}
          />
          <ShorthandInput
            label="Max Jumps"
            value={filters.maxJumps}
            placeholder="Any"
            onCommit={(val) =>
              updateFilters({ ...filters, maxJumps: val !== null ? Math.round(val) : null })
            }
          />
          <ShorthandInput
            label="Min ROI %"
            value={filters.minRoiPct}
            placeholder="5"
            onCommit={(val) => updateFilters({ ...filters, minRoiPct: val })}
          />
          <ShorthandInput
            label="Min Haul Profit"
            value={filters.minTotalProfit}
            placeholder="500k"
            onCommit={(val) => updateFilters({ ...filters, minTotalProfit: val })}
          />
          <ShorthandInput
            label="Min Unit Profit"
            value={filters.minUnitProfit}
            placeholder="Any"
            onCommit={(val) => updateFilters({ ...filters, minUnitProfit: val })}
          />
          <ShorthandInput
            label="Max Buy Price"
            value={filters.maxBuyPrice}
            placeholder="Any"
            onCommit={(val) => updateFilters({ ...filters, maxBuyPrice: val })}
          />
          <ShorthandInput
            label="Min Haul Units"
            value={filters.minAvailableUnits}
            placeholder="1"
            onCommit={(val) =>
              updateFilters({
                ...filters,
                minAvailableUnits: val !== null ? Math.max(1, Math.round(val)) : null,
              })
            }
          />
        </div>

        {/* Ship Cargo Presets + Safety Toggles */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#262938]/70">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#656A7C] mr-1">
              Cargo Fit:
            </span>
            {CARGO_PRESETS.map((preset) => {
              const active = filters.maxCargoM3 === preset.value;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => updateFilters({ ...filters, maxCargoM3: preset.value })}
                  className={`px-2 py-1 rounded text-[11px] font-mono-num border cursor-pointer transition-colors ${
                    active
                      ? 'bg-[#9B7BFF]/20 text-[#B298FF] border-[#9B7BFF]/50'
                      : 'bg-[#161923] text-[#9CA0B0] border-[#262938] hover:text-[#EFEAE0]'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                updateFilters({ ...filters, hideLowSecRoutes: !filters.hideLowSecRoutes })
              }
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border cursor-pointer transition-colors ${
                filters.hideLowSecRoutes
                  ? 'bg-[#FF4D6D]/15 text-[#FF4D6D] border-[#FF4D6D]/50'
                  : 'bg-[#161923] text-[#9CA0B0] border-[#262938] hover:text-[#EFEAE0]'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Hide Low-Sec (Amamake)</span>
            </button>

            <button
              type="button"
              onClick={() => updateFilters({ ...filters, hideAnomalies: !filters.hideAnomalies })}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border cursor-pointer transition-colors ${
                filters.hideAnomalies
                  ? 'bg-[#9B7BFF]/18 text-[#B298FF] border-[#9B7BFF]/50'
                  : 'bg-[#161923] text-[#9CA0B0] border-[#262938] hover:text-[#EFEAE0]'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Hide Anomalies</span>
            </button>

            {QUICK_EXCLUDES.map((grp) => {
              const active = filters.excludeRootGroups.includes(grp);
              return (
                <button
                  key={grp}
                  type="button"
                  onClick={() => toggleExclude(grp)}
                  className={`px-2 py-1 rounded text-[11px] font-mono-num border cursor-pointer ${
                    active
                      ? 'bg-[#E07A63]/15 text-[#E07A63] border-[#E07A63]/45'
                      : 'bg-[#161923] text-[#656A7C] border-[#262938] hover:text-[#EFEAE0]'
                  }`}
                >
                  {active ? `− ${grp}` : `+ ${grp}`}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-[#0F1118] border border-[#262938] rounded-md px-4 py-2.5 flex items-center justify-between">
          <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#656A7C]">
            Matched Haul Routes
          </span>
          <span className="font-mono-num text-sm font-semibold text-[#EFEAE0]">
            {data ? data.summaryStats.totalMatched.toLocaleString() : '—'}
          </span>
        </div>
        <div className="bg-[#0F1118] border border-[#262938] rounded-md px-4 py-2.5 flex items-center justify-between">
          <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#656A7C]">
            Top Haul Net Profit
          </span>
          <span className="font-mono-num text-sm font-semibold text-[#46E595]">
            {data ? formatIskCompact(data.summaryStats.bestHaulProfit) : '—'}
          </span>
        </div>
        <div className="bg-[#0F1118] border border-[#262938] rounded-md px-4 py-2.5 flex items-center justify-between">
          <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#656A7C]">
            {getSummaryFeeLabel(displayMode, data?.fees)}
          </span>
          <span className="font-mono-num text-sm font-semibold text-[#B298FF]">
            Avg ROI {data ? formatPct(data.summaryStats.avgRoiPct) : '—'}
          </span>
        </div>
      </div>

      {/* Arbitrage Table */}
      <div className="bg-[#0F1118] border border-[#262938] rounded-md overflow-hidden">
        {loading && !data ? (
          <div className="p-10 text-center text-xs font-mono-num text-[#9CA0B0]">
            Scanning cross-hub order books...
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <ArrowLeftRight className="w-7 h-7 text-[#656A7C] mx-auto" />
            <div className="font-display text-sm font-semibold text-[#EFEAE0]">
              No Arbitrage Opportunities Matched
            </div>
            <p className="text-xs text-[#9CA0B0] max-w-md mx-auto">
              {syncedHubsCount < 2
                ? 'Sync at least two hubs first to discover inter-hub price spreads.'
                : 'Try lowering Min Haul Profit / Min ROI %, clearing Max Cargo m³, or switching between Sell/Buy pairing modes.'}
            </p>
          </div>
        ) : (
          <>
            <div
              className={`overflow-x-auto ${loading && data ? 'opacity-70 transition-opacity' : ''}`}
            >
              <table className="w-full border-collapse text-left">
                <thead className="bg-[#161923] border-b border-[#262938] text-[10px] font-mono-num uppercase tracking-wider text-[#9CA0B0]">
                  <tr>
                    <th
                      className="px-3 py-2.5 cursor-pointer hover:text-[#EFEAE0]"
                      onClick={() => handleSort('name')}
                    >
                      Item {renderSortArrow('name')}
                    </th>
                    <th
                      className="px-3 py-2.5 cursor-pointer hover:text-[#EFEAE0]"
                      onClick={() => handleSort('jumps')}
                    >
                      Route {renderSortArrow('jumps')}
                    </th>
                    <th className="px-3 py-2.5 text-right">{activePairing.buyColHeader}</th>
                    <th className="px-3 py-2.5 text-right">{activePairing.sellColHeader}</th>
                    <th
                      className="px-3 py-2.5 text-right cursor-pointer hover:text-[#EFEAE0]"
                      onClick={() => handleSort('unitNetProfit')}
                    >
                      Unit Profit {renderSortArrow('unitNetProfit')}
                    </th>
                    <th
                      className="px-3 py-2.5 text-right cursor-pointer hover:text-[#EFEAE0]"
                      onClick={() => handleSort('roiPct')}
                    >
                      ROI % {renderSortArrow('roiPct')}
                    </th>
                    <th
                      className="px-3 py-2.5 text-right cursor-pointer hover:text-[#EFEAE0]"
                      title="Capped by near-top-of-book depth (±2% of best price) and Max Cargo m³"
                      onClick={() => handleSort('haulUnits')}
                    >
                      Haul Qty {renderSortArrow('haulUnits')}
                    </th>
                    <th
                      className="px-3 py-2.5 text-right cursor-pointer hover:text-[#EFEAE0]"
                      onClick={() => handleSort('totalBuyCost')}
                    >
                      Capital {renderSortArrow('totalBuyCost')}
                    </th>
                    <th
                      className="px-3 py-2.5 text-right cursor-pointer hover:text-[#EFEAE0]"
                      onClick={() => handleSort('totalNetProfit')}
                    >
                      Total Profit {renderSortArrow('totalNetProfit')}
                    </th>
                    <th
                      className="px-3 py-2.5 text-right cursor-pointer hover:text-[#EFEAE0]"
                      onClick={() => handleSort('iskPerM3')}
                    >
                      ISK / m³ {renderSortArrow('iskPerM3')}
                    </th>
                    <th
                      className="px-3 py-2.5 text-right cursor-pointer hover:text-[#EFEAE0]"
                      onClick={() => handleSort('iskPerJump')}
                    >
                      ISK / Jump {renderSortArrow('iskPerJump')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#262938]/70 text-xs">
                  {data.items.map((opp: ArbitrageOpportunity) => {
                    const srcMeta = getHubMeta(opp.sourceHubId);
                    const dstMeta = getHubMeta(opp.destHubId);
                    return (
                      <tr
                        key={`${opp.mode}-${opp.typeId}-${opp.sourceHubId}-${opp.destHubId}`}
                        onClick={() => onSelectItem(opp.typeId, opp.destHubId)}
                        className="hover:bg-[#161923]/80 cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <ItemIcon
                              typeId={opp.typeId}
                              name={opp.name}
                              size={32}
                              className="w-8 h-8"
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-[#EFEAE0] truncate max-w-[210px]">
                                  {opp.name}
                                </span>
                                {opp.hasAnomaly && (
                                  <span
                                    title={opp.anomalies.map((a) => a.reason).join(' ')}
                                    className="px-1 rounded text-[9px] font-mono-num bg-[#FF4D6D]/20 text-[#FF4D6D]"
                                  >
                                    WARN
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] font-mono-num text-[#656A7C]">
                                {opp.rootGroupName}
                                {opp.itemVolume !== null ? ` · ${opp.itemVolume.toLocaleString()} m³/u` : ''}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 font-mono-num text-[11px]">
                            <span style={{ color: srcMeta.accentColor }}>{opp.sourceHubName}</span>
                            <ArrowRight className="w-3 h-3 text-[#656A7C]" />
                            <span style={{ color: dstMeta.accentColor }}>{opp.destHubName}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 text-[10px] font-mono-num">
                            <span className="text-[#9CA0B0]">{opp.jumps}j</span>
                            {opp.isLowSecRoute ? (
                              <span className="px-1 rounded bg-[#FF4D6D]/15 text-[#FF4D6D] border border-[#FF4D6D]/35">
                                LOW-SEC
                              </span>
                            ) : (
                              <span className="px-1 rounded bg-[#46E595]/10 text-[#46E595]/80">
                                HIGH-SEC
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-3 py-2.5 text-right font-mono-num text-[#EFEAE0]">
                          <div>{formatIskExact(opp.buyPrice)}</div>
                          {opp.sourceTickMatched && (
                            <div
                              title="1-tick source spread: matches Source Best Bid instead of crossing Source Best Ask"
                              className="text-[9px] text-[#F5B841]/90"
                            >
                              =BID
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-2.5 text-right font-mono-num text-[#9CA0B0]">
                          <div>{formatIskExact(opp.sellPrice)}</div>
                          {opp.destTickMatched && (
                            <div
                              title="1-tick destination spread: matches Dest Best Ask instead of crossing Dest Best Bid"
                              className="text-[9px] text-[#B298FF]/90"
                            >
                              =ASK
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-2.5 text-right font-mono-num text-[#46E595]">
                          {formatIskCompact(opp.unitNetProfit, false)}
                        </td>

                        <td className="px-3 py-2.5 text-right font-mono-num font-semibold text-[#46E595]">
                          {formatPct(opp.roiPct)}
                        </td>

                        <td
                          title={`Available near-top depth: ${opp.availableUnits.toLocaleString()} units (within ±2% of best price)`}
                          className="px-3 py-2.5 text-right font-mono-num text-[#EFEAE0]"
                        >
                          <div>{opp.haulUnits.toLocaleString()}</div>
                          {opp.totalVolumeM3 !== null && (
                            <div className="text-[10px] text-[#656A7C]">
                              {Math.round(opp.totalVolumeM3).toLocaleString()} m³
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-2.5 text-right font-mono-num text-[#9CA0B0]">
                          {formatIskCompact(opp.totalBuyCost, false)}
                        </td>

                        <td className="px-3 py-2.5 text-right font-mono-num font-semibold text-[#46E595]">
                          {formatIskCompact(opp.totalNetProfit, false)}
                        </td>

                        <td className="px-3 py-2.5 text-right font-mono-num text-[#B298FF]">
                          {opp.iskPerM3 !== null ? formatIskCompact(opp.iskPerM3, false) : '—'}
                        </td>

                        <td className="px-3 py-2.5 text-right font-mono-num text-[#EFEAE0]">
                          {formatIskCompact(opp.iskPerJump, false)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {data.totalPages > 1 && (
              <div className="px-4 py-2.5 bg-[#161923]/60 border-t border-[#262938] flex items-center justify-between text-xs font-mono-num text-[#9CA0B0]">
                <span>
                  Page {data.page} of {data.totalPages} ({data.total.toLocaleString()} routes)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={data.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="p-1.5 rounded bg-[#08090D] border border-[#262938] disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={data.page >= data.totalPages}
                    onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                    className="p-1.5 rounded bg-[#08090D] border border-[#262938] disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
