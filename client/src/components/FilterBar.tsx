import { useEffect, useState } from 'react';
import {
  Bookmark,
  Filter,
  Flame,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { formatShorthandInput, parseIskShorthand } from '../lib/format.ts';
import { getHubMeta } from '../lib/hubs.ts';
import type {
  FilterKey,
  FilterPreset,
  FilterState,
  HubId,
  MarketGroupTreeNode,
} from '../types/api.ts';
import { MarketGroupPicker } from './MarketGroupPicker.tsx';

interface FilterBarProps {
  activeHub: HubId;
  filters: FilterState;
  presets: FilterPreset[];
  groupTree: MarketGroupTreeNode[];
  activePresetName: string | null;
  breakingFilterKeys?: Set<FilterKey>;
  breakingExcludedGroups?: Set<string>;
  breakingFilterReasons?: Map<FilterKey, string>;
  lookupFocusName?: string | null;
  onChange: (next: FilterState) => void;
  onReset: () => void;
  onApplyPreset: (preset: FilterPreset) => void;
  onSavePreset: (name: string) => Promise<void>;
  onDeletePreset: (id: number) => Promise<void>;
}

interface ShorthandInputProps {
  label: string;
  value: number | null;
  placeholder: string;
  breakingReason?: string;
  onCommit: (val: number | null) => void;
}

function ShorthandNumericInput({
  label,
  value,
  placeholder,
  breakingReason,
  onCommit,
}: ShorthandInputProps) {
  const [draft, setDraft] = useState(() => formatShorthandInput(value));

  useEffect(() => {
    setDraft(formatShorthandInput(value));
  }, [value]);

  const commit = () => {
    const parsed = parseIskShorthand(draft);
    onCommit(parsed);
    setDraft(formatShorthandInput(parsed));
  };

  const isBreaking = Boolean(breakingReason);

  return (
    <label className="flex flex-col gap-1" title={breakingReason}>
      <span
        className={`text-[10px] font-mono-num uppercase tracking-wider flex items-center gap-1 ${
          isBreaking ? 'text-[#FF4D6D] font-semibold' : 'text-[#656A7C]'
        }`}
      >
        {isBreaking && <span className="w-1.5 h-1.5 rounded-full bg-[#FF4D6D] shrink-0" />}
        <span className="truncate">{label}</span>
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
        className={`w-full px-2.5 py-1.5 rounded border focus:outline-none text-xs font-mono-num text-[#EFEAE0] placeholder:text-[#656A7C]/70 transition-colors ${
          isBreaking
            ? 'bg-[#FF4D6D]/10 border-[#FF4D6D] ring-1 ring-[#FF4D6D]/55 focus:border-[#FF4D6D]'
            : 'bg-[#08090D] border-[#262938] focus:border-[#9B7BFF]'
        }`}
      />
    </label>
  );
}

function PercentInput({
  label,
  value,
  placeholder,
  breakingReason,
  onCommit,
}: {
  label: string;
  value: number | null;
  placeholder: string;
  breakingReason?: string;
  onCommit: (val: number | null) => void;
}) {
  const [draft, setDraft] = useState(value !== null ? String(value) : '');

  useEffect(() => {
    setDraft(value !== null ? String(value) : '');
  }, [value]);

  const commit = () => {
    const cleaned = draft.trim();
    if (!cleaned) {
      onCommit(null);
      return;
    }
    const n = Number(cleaned);
    onCommit(Number.isFinite(n) ? n : null);
  };

  const isBreaking = Boolean(breakingReason);

  return (
    <label className="flex flex-col gap-1" title={breakingReason}>
      <span
        className={`text-[10px] font-mono-num uppercase tracking-wider flex items-center gap-1 ${
          isBreaking ? 'text-[#FF4D6D] font-semibold' : 'text-[#656A7C]'
        }`}
      >
        {isBreaking && <span className="w-1.5 h-1.5 rounded-full bg-[#FF4D6D] shrink-0" />}
        <span className="truncate">{label}</span>
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
        className={`w-full px-2.5 py-1.5 rounded border focus:outline-none text-xs font-mono-num text-[#EFEAE0] placeholder:text-[#656A7C]/70 transition-colors ${
          isBreaking
            ? 'bg-[#FF4D6D]/10 border-[#FF4D6D] ring-1 ring-[#FF4D6D]/55 focus:border-[#FF4D6D]'
            : 'bg-[#08090D] border-[#262938] focus:border-[#9B7BFF]'
        }`}
      />
    </label>
  );
}

const QUICK_EXCLUDE_GROUPS = ['Ship SKINs', 'Apparel', 'Blueprints & Reactions'];

const CURATED_SEGMENTS: Array<{
  label: string;
  presetName: string;
  fallback: Partial<FilterState>;
}> = [
  {
    label: 'Best Ammo',
    presetName: 'Best Ammo Types',
    fallback: {
      marketGroupId: 11,
      marketGroupIds: [],
      minRoiPct: 10,
      minDailyIskVolume: 10_000_000,
      minDailyUnits: 500,
      hideAnomalies: true,
      requireHistory: true,
      sortBy: 'tradeScore',
      sortDir: 'desc',
    },
  },
  {
    label: 'Best Modules',
    presetName: 'Best Modules',
    fallback: {
      marketGroupId: 9,
      marketGroupIds: [],
      minRoiPct: 10,
      minPrice: 100_000,
      minDailyIskVolume: 20_000_000,
      minDailyUnits: 5,
      maxRecentUpdates1h: 18,
      hideAnomalies: true,
      requireHistory: true,
      sortBy: 'tradeScore',
      sortDir: 'desc',
    },
  },
  {
    label: 'Best PI Materials',
    presetName: 'Best PI Materials',
    fallback: {
      marketGroupId: 1332,
      marketGroupIds: [],
      minRoiPct: 10,
      minDailyIskVolume: 10_000_000,
      minDailyUnits: 20,
      hideAnomalies: true,
      requireHistory: true,
      sortBy: 'tradeScore',
      sortDir: 'desc',
    },
  },
  {
    label: 'Best Components',
    presetName: 'Best Construction Components',
    fallback: {
      marketGroupId: 1035,
      marketGroupIds: [],
      minRoiPct: 10,
      minPrice: 10_000,
      minDailyIskVolume: 15_000_000,
      minDailyUnits: 5,
      hideAnomalies: true,
      requireHistory: true,
      sortBy: 'tradeScore',
      sortDir: 'desc',
    },
  },
  {
    label: 'Best PI & Components',
    presetName: 'Best PI & Components',
    fallback: {
      marketGroupId: null,
      marketGroupIds: [1332, 1035],
      minRoiPct: 10,
      minDailyIskVolume: 10_000_000,
      minDailyUnits: 5,
      hideAnomalies: true,
      requireHistory: true,
      sortBy: 'tradeScore',
      sortDir: 'desc',
    },
  },
];

export function FilterBar({
  activeHub,
  filters,
  presets,
  groupTree,
  activePresetName,
  breakingFilterKeys,
  breakingExcludedGroups,
  breakingFilterReasons,
  lookupFocusName,
  onChange,
  onReset,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
}: FilterBarProps) {
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [showMoreFilters, setShowMoreFilters] = useState(true);

  const isBreaking = (key: FilterKey): boolean => Boolean(breakingFilterKeys?.has(key));
  const breakingTip = (key: FilterKey): string | undefined => {
    if (!breakingFilterKeys?.has(key)) return undefined;
    const raw = breakingFilterReasons?.get(key) ?? 'Blocking lookup match';
    return lookupFocusName ? `Blocking "${lookupFocusName}": ${raw}` : `Blocking filter: ${raw}`;
  };

  const collapsibleBreakingKeys: FilterKey[] = [
    'minRoiPct',
    'maxRoiPct',
    'minPrice',
    'maxPrice',
    'minDailyIskVolume',
    'minDailyUnits',
    'maxCompetition',
    'maxRecentUpdates1h',
    'marketGroup',
    'includeRootGroups',
    'excludeRootGroups',
  ];
  const hiddenBreakingCount = !showMoreFilters
    ? collapsibleBreakingKeys.filter((k) => isBreaking(k)).length
    : 0;

  const toggleExcludedGroup = (groupName: string) => {
    const exists = filters.excludeRootGroups.includes(groupName);
    const next = exists
      ? filters.excludeRootGroups.filter((g) => g !== groupName)
      : [...filters.excludeRootGroups, groupName];
    onChange({ ...filters, excludeRootGroups: next });
  };

  const handleSavePresetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!presetName.trim()) return;
    await onSavePreset(presetName.trim());
    setPresetName('');
    setSavingPreset(false);
  };

  const selectedPreset = presets.find((p) => p.name === activePresetName);

  return (
    <section className="bg-[#0F1118] border border-[#262938] rounded-md p-3.5 space-y-3">
      {/* Row 1: Search, Presets, Quick Toggles */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Search / Lookup Input */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-[#656A7C] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={filters.q}
            onChange={(e) => onChange({ ...filters, q: e.target.value })}
            placeholder={`Lookup any ${getHubMeta(activeHub).shortName} item by name or Type ID...`}
            className="w-full pl-8 pr-7 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none text-xs text-[#EFEAE0] placeholder:text-[#656A7C]"
          />
          {filters.q && (
            <button
              type="button"
              onClick={() => onChange({ ...filters, q: '' })}
              aria-label="Clear search"
              title="Clear lookup"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-[#656A7C] hover:text-[#EFEAE0] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Preset Selector */}
        <div className="flex items-center gap-1.5">
          <select
            value={activePresetName ?? ''}
            onChange={(e) => {
              const found = presets.find((p) => p.name === e.target.value);
              if (found) onApplyPreset(found);
            }}
            aria-label="Filter Preset"
            className="px-2.5 py-1.5 rounded bg-[#161923] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none text-xs text-[#EFEAE0]"
          >
            <option value="">{activePresetName ? activePresetName : 'Presets...'}</option>
            {presets.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setSavingPreset((s) => !s)}
            title="Save current filters as preset"
            className="p-1.5 rounded bg-[#161923] border border-[#262938] hover:border-[#9B7BFF] text-[#9CA0B0] hover:text-[#EFEAE0] transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          {selectedPreset && (
            <button
              type="button"
              onClick={() => void onDeletePreset(selectedPreset.id)}
              title={`Delete preset "${selectedPreset.name}"`}
              className="p-1.5 rounded bg-[#161923] border border-[#262938] hover:border-[#FF4D6D] text-[#9CA0B0] hover:text-[#FF4D6D] transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Quick Toggle Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            title={breakingTip('trendingOnly')}
            onClick={() => onChange({ ...filters, trendingOnly: !filters.trendingOnly })}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors cursor-pointer ${
              isBreaking('trendingOnly')
                ? 'bg-[#FF4D6D]/18 text-[#FF4D6D] border-[#FF4D6D] ring-1 ring-[#FF4D6D]/60'
                : filters.trendingOnly
                  ? 'bg-[#46E595]/15 text-[#46E595] border-[#46E595]/50'
                  : 'bg-[#161923] text-[#9CA0B0] border-[#262938] hover:text-[#EFEAE0]'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Trending Only</span>
          </button>

          <button
            type="button"
            title={breakingTip('hideAnomalies')}
            onClick={() => onChange({ ...filters, hideAnomalies: !filters.hideAnomalies })}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors cursor-pointer ${
              isBreaking('hideAnomalies')
                ? 'bg-[#FF4D6D]/18 text-[#FF4D6D] border-[#FF4D6D] ring-1 ring-[#FF4D6D]/60'
                : filters.hideAnomalies
                  ? 'bg-[#9B7BFF]/18 text-[#B298FF] border-[#9B7BFF]/50'
                  : 'bg-[#161923] text-[#9CA0B0] border-[#262938] hover:text-[#EFEAE0]'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Hide Anomalies</span>
          </button>

          <button
            type="button"
            title={breakingTip('watchlistOnly')}
            onClick={() => onChange({ ...filters, watchlistOnly: !filters.watchlistOnly })}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors cursor-pointer ${
              isBreaking('watchlistOnly')
                ? 'bg-[#FF4D6D]/18 text-[#FF4D6D] border-[#FF4D6D] ring-1 ring-[#FF4D6D]/60'
                : filters.watchlistOnly
                  ? 'bg-[#E07A63]/18 text-[#E07A63] border-[#E07A63]/50'
                  : 'bg-[#161923] text-[#9CA0B0] border-[#262938] hover:text-[#EFEAE0]'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>Watchlist</span>
          </button>

          <button
            type="button"
            title={breakingTip('requireHistory')}
            onClick={() => onChange({ ...filters, requireHistory: !filters.requireHistory })}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors cursor-pointer ${
              isBreaking('requireHistory')
                ? 'bg-[#FF4D6D]/18 text-[#FF4D6D] border-[#FF4D6D] ring-1 ring-[#FF4D6D]/60'
                : filters.requireHistory
                  ? 'bg-[#9B7BFF]/18 text-[#B298FF] border-[#9B7BFF]/50'
                  : 'bg-[#161923] text-[#9CA0B0] border-[#262938] hover:text-[#EFEAE0]'
            }`}
          >
            <Filter className="w-3 h-3" />
            <span>Has History</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <button
            type="button"
            onClick={() => setShowMoreFilters((v) => !v)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border cursor-pointer transition-colors ${
              hiddenBreakingCount > 0
                ? 'bg-[#FF4D6D]/15 border-[#FF4D6D] ring-1 ring-[#FF4D6D]/60 text-[#FF4D6D]'
                : 'bg-[#161923] border-[#262938] text-[#9CA0B0] hover:text-[#EFEAE0]'
            }`}
          >
            <SlidersHorizontal
              className={`w-3.5 h-3.5 ${hiddenBreakingCount > 0 ? 'text-[#FF4D6D]' : 'text-[#9B7BFF]'}`}
            />
            <span>
              {showMoreFilters
                ? 'Hide Constraints'
                : hiddenBreakingCount > 0
                  ? `Constraints (${hiddenBreakingCount} blocking)`
                  : 'Constraints'}
            </span>
          </button>

          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs bg-[#161923] border border-[#262938] text-[#9CA0B0] hover:text-[#EFEAE0] cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Inline Save Preset Form */}
      {savingPreset && (
        <form
          onSubmit={(e) => void handleSavePresetSubmit(e)}
          className="flex items-center gap-2 p-2.5 rounded bg-[#161923] border border-[#9B7BFF]/40"
        >
          <input
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Name this filter preset (e.g. Fast T2 Modules)..."
            autoFocus
            className="flex-1 px-2.5 py-1 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none text-xs text-[#EFEAE0]"
          />
          <button
            type="submit"
            className="px-3 py-1 rounded bg-[#9B7BFF] text-[#08090D] text-xs font-semibold hover:bg-[#B298FF] cursor-pointer"
          >
            Save Preset
          </button>
          <button
            type="button"
            onClick={() => setSavingPreset(false)}
            className="px-2.5 py-1 rounded bg-[#08090D] border border-[#262938] text-xs text-[#9CA0B0] cursor-pointer"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Row 2 & 3: Numeric Constraints & Categories */}
      {showMoreFilters && (
        <div className="pt-2.5 border-t border-[#262938] space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-2.5">
            <PercentInput
              label="Min Profit %"
              value={filters.minRoiPct}
              placeholder="e.g. 8"
              breakingReason={breakingTip('minRoiPct')}
              onCommit={(v) => onChange({ ...filters, minRoiPct: v })}
            />
            <PercentInput
              label="Max Profit %"
              value={filters.maxRoiPct}
              placeholder="e.g. 120"
              breakingReason={breakingTip('maxRoiPct')}
              onCommit={(v) => onChange({ ...filters, maxRoiPct: v })}
            />
            <ShorthandNumericInput
              label="Min Price (ISK)"
              value={filters.minPrice}
              placeholder="e.g. 100k"
              breakingReason={breakingTip('minPrice')}
              onCommit={(v) => onChange({ ...filters, minPrice: v })}
            />
            <ShorthandNumericInput
              label="Max Price (ISK)"
              value={filters.maxPrice}
              placeholder="e.g. 500m"
              breakingReason={breakingTip('maxPrice')}
              onCommit={(v) => onChange({ ...filters, maxPrice: v })}
            />
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#656A7C]">
                Price Basis
              </span>
              <select
                value={filters.priceField}
                onChange={(e) =>
                  onChange({ ...filters, priceField: e.target.value === 'sell' ? 'sell' : 'buy' })
                }
                className="w-full px-2 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none text-xs text-[#EFEAE0]"
              >
                <option value="buy">Best Buy (Capital)</option>
                <option value="sell">Best Sell (Ask)</option>
              </select>
            </label>
            <ShorthandNumericInput
              label="Min Daily ISK Vol"
              value={filters.minDailyIskVolume}
              placeholder="e.g. 20m"
              breakingReason={breakingTip('minDailyIskVolume')}
              onCommit={(v) => onChange({ ...filters, minDailyIskVolume: v })}
            />
            <PercentInput
              label="Min Daily Units"
              value={filters.minDailyUnits}
              placeholder="e.g. 5"
              breakingReason={breakingTip('minDailyUnits')}
              onCommit={(v) => onChange({ ...filters, minDailyUnits: v })}
            />
            <PercentInput
              label="Max 2% Competing"
              value={filters.maxCompetition}
              placeholder="e.g. 15"
              breakingReason={breakingTip('maxCompetition')}
              onCommit={(v) => onChange({ ...filters, maxCompetition: v })}
            />
            <PercentInput
              label="Max 1h Updates"
              value={filters.maxRecentUpdates1h}
              placeholder="e.g. 12"
              breakingReason={breakingTip('maxRecentUpdates1h')}
              onCommit={(v) => onChange({ ...filters, maxRecentUpdates1h: v })}
            />
          </div>

          {/* Curated Segment Quick Filters */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1 text-[10px] font-mono-num uppercase tracking-wider text-[#B298FF] mr-1">
              <Sparkles className="w-3 h-3" />
              Curated Filters:
            </span>
            {CURATED_SEGMENTS.map((seg) => {
              const matchingPreset = presets.find((p) => p.name === seg.presetName);
              const isActive =
                activePresetName === seg.presetName ||
                (seg.fallback.marketGroupId !== null &&
                  seg.fallback.marketGroupId !== undefined &&
                  filters.marketGroupId === seg.fallback.marketGroupId &&
                  filters.marketGroupIds.length === 0) ||
                (seg.fallback.marketGroupIds &&
                  seg.fallback.marketGroupIds.length > 0 &&
                  filters.marketGroupIds.join(',') === seg.fallback.marketGroupIds.join(','));

              return (
                <button
                  key={seg.presetName}
                  type="button"
                  onClick={() => {
                    if (matchingPreset) {
                      onApplyPreset(matchingPreset);
                    } else {
                      onChange({
                        ...filters,
                        includeRootGroups: [],
                        excludeRootGroups: [],
                        ...seg.fallback,
                      });
                    }
                  }}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#9B7BFF]/22 text-[#EFEAE0] border-[#9B7BFF]/65'
                      : 'bg-[#161923] text-[#9CA0B0] border-[#262938] hover:border-[#9B7BFF]/45 hover:text-[#EFEAE0]'
                  }`}
                >
                  {seg.label}
                </button>
              );
            })}
          </div>

          {/* Market Category Filter Row */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`text-[10px] font-mono-num uppercase tracking-wider ${
                isBreaking('marketGroup') || isBreaking('includeRootGroups')
                  ? 'text-[#FF4D6D] font-semibold'
                  : 'text-[#656A7C]'
              }`}
            >
              Market Segment:
            </span>
            <MarketGroupPicker
              tree={groupTree}
              selectedGroupId={filters.marketGroupId}
              breaking={isBreaking('marketGroup') || isBreaking('includeRootGroups')}
              breakingReason={breakingTip('marketGroup') ?? breakingTip('includeRootGroups')}
              onSelect={(groupId) =>
                onChange({
                  ...filters,
                  marketGroupId: groupId,
                  marketGroupIds: [],
                  includeRootGroups: [],
                })
              }
            />

            {filters.marketGroupIds.length > 0 && (
              <span
                title={breakingTip('marketGroup')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono-num border ${
                  isBreaking('marketGroup')
                    ? 'bg-[#FF4D6D]/18 border-[#FF4D6D] ring-1 ring-[#FF4D6D]/60 text-[#FF4D6D]'
                    : 'bg-[#9B7BFF]/18 border-[#9B7BFF]/45 text-[#EFEAE0]'
                }`}
              >
                <span>
                  {filters.marketGroupIds.join(',') === '1332,1035'
                    ? 'PI Materials + Construction Components'
                    : `${filters.marketGroupIds.length} Segments Selected`}
                </span>
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, marketGroupIds: [] })}
                  aria-label="Clear multi-segment filter"
                  className="text-[#9CA0B0] hover:text-[#FF4D6D] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#656A7C] ml-2">
              Quick Excludes:
            </span>
            {QUICK_EXCLUDE_GROUPS.map((grp) => {
              const active = filters.excludeRootGroups.includes(grp);
              const groupBreaking = Boolean(breakingExcludedGroups?.has(grp));
              return (
                <button
                  key={grp}
                  type="button"
                  title={groupBreaking ? breakingTip('excludeRootGroups') : undefined}
                  onClick={() => toggleExcludedGroup(grp)}
                  className={`px-2 py-0.5 rounded text-[11px] border transition-colors cursor-pointer ${
                    groupBreaking
                      ? 'bg-[#FF4D6D]/25 text-[#EFEAE0] border-[#FF4D6D] ring-2 ring-[#FF4D6D]/75 font-semibold'
                      : active
                        ? 'bg-[#FF4D6D]/12 text-[#FF4D6D] border-[#FF4D6D]/40'
                        : 'bg-[#161923] text-[#9CA0B0] border-[#262938] hover:text-[#EFEAE0]'
                  }`}
                >
                  {active ? `Excluding ${grp}` : `Exclude ${grp}`}
                </button>
              );
            })}
            {(filters.marketGroupId !== null || filters.marketGroupIds.length > 0) && (
              <span className="text-[10px] font-mono-num text-[#656A7C]">
                (overridden by selected segment)
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
