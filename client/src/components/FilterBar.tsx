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
  Trash2,
} from 'lucide-react';
import { formatShorthandInput, parseIskShorthand } from '../lib/format.ts';
import type { FilterPreset, FilterState, MarketGroupTreeNode } from '../types/api.ts';
import { MarketGroupPicker } from './MarketGroupPicker.tsx';

interface FilterBarProps {
  filters: FilterState;
  presets: FilterPreset[];
  groupTree: MarketGroupTreeNode[];
  activePresetName: string | null;
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
  onCommit: (val: number | null) => void;
}

function ShorthandNumericInput({ label, value, placeholder, onCommit }: ShorthandInputProps) {
  const [draft, setDraft] = useState(() => formatShorthandInput(value));

  useEffect(() => {
    setDraft(formatShorthandInput(value));
  }, [value]);

  const commit = () => {
    const parsed = parseIskShorthand(draft);
    onCommit(parsed);
    setDraft(formatShorthandInput(parsed));
  };

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#656A7C]">
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

function PercentInput({
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

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#656A7C]">
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

const QUICK_EXCLUDE_GROUPS = ['Ship SKINs', 'Apparel', 'Blueprints & Reactions'];

export function FilterBar({
  filters,
  presets,
  groupTree,
  activePresetName,
  onChange,
  onReset,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
}: FilterBarProps) {
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [showMoreFilters, setShowMoreFilters] = useState(true);

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
        {/* Search Input */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-[#656A7C] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={filters.q}
            onChange={(e) => onChange({ ...filters, q: e.target.value })}
            placeholder="Search Jita 4-4 item name or Type ID..."
            className="w-full pl-8 pr-3 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none text-xs text-[#EFEAE0] placeholder:text-[#656A7C]"
          />
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
            onClick={() => onChange({ ...filters, trendingOnly: !filters.trendingOnly })}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors cursor-pointer ${
              filters.trendingOnly
                ? 'bg-[#46E595]/15 text-[#46E595] border-[#46E595]/50'
                : 'bg-[#161923] text-[#9CA0B0] border-[#262938] hover:text-[#EFEAE0]'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Trending Only</span>
          </button>

          <button
            type="button"
            onClick={() => onChange({ ...filters, hideAnomalies: !filters.hideAnomalies })}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors cursor-pointer ${
              filters.hideAnomalies
                ? 'bg-[#9B7BFF]/18 text-[#B298FF] border-[#9B7BFF]/50'
                : 'bg-[#161923] text-[#9CA0B0] border-[#262938] hover:text-[#EFEAE0]'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Hide Anomalies</span>
          </button>

          <button
            type="button"
            onClick={() => onChange({ ...filters, watchlistOnly: !filters.watchlistOnly })}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors cursor-pointer ${
              filters.watchlistOnly
                ? 'bg-[#E07A63]/18 text-[#E07A63] border-[#E07A63]/50'
                : 'bg-[#161923] text-[#9CA0B0] border-[#262938] hover:text-[#EFEAE0]'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>Watchlist</span>
          </button>

          <button
            type="button"
            onClick={() => onChange({ ...filters, requireHistory: !filters.requireHistory })}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors cursor-pointer ${
              filters.requireHistory
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
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs bg-[#161923] border border-[#262938] text-[#9CA0B0] hover:text-[#EFEAE0] cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#9B7BFF]" />
            <span>{showMoreFilters ? 'Hide Constraints' : 'Constraints'}</span>
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
              onCommit={(v) => onChange({ ...filters, minRoiPct: v })}
            />
            <PercentInput
              label="Max Profit %"
              value={filters.maxRoiPct}
              placeholder="e.g. 120"
              onCommit={(v) => onChange({ ...filters, maxRoiPct: v })}
            />
            <ShorthandNumericInput
              label="Min Price (ISK)"
              value={filters.minPrice}
              placeholder="e.g. 100k"
              onCommit={(v) => onChange({ ...filters, minPrice: v })}
            />
            <ShorthandNumericInput
              label="Max Price (ISK)"
              value={filters.maxPrice}
              placeholder="e.g. 500m"
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
              onCommit={(v) => onChange({ ...filters, minDailyIskVolume: v })}
            />
            <PercentInput
              label="Min Daily Units"
              value={filters.minDailyUnits}
              placeholder="e.g. 5"
              onCommit={(v) => onChange({ ...filters, minDailyUnits: v })}
            />
            <PercentInput
              label="Max 2% Competing"
              value={filters.maxCompetition}
              placeholder="e.g. 15"
              onCommit={(v) => onChange({ ...filters, maxCompetition: v })}
            />
            <PercentInput
              label="Max 1h Updates"
              value={filters.maxRecentUpdates1h}
              placeholder="e.g. 12"
              onCommit={(v) => onChange({ ...filters, maxRecentUpdates1h: v })}
            />
          </div>

          {/* Market Category Filter Row */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#656A7C]">
              Market Segment:
            </span>
            <MarketGroupPicker
              tree={groupTree}
              selectedGroupId={filters.marketGroupId}
              onSelect={(groupId) =>
                onChange({
                  ...filters,
                  marketGroupId: groupId,
                  includeRootGroups: [],
                })
              }
            />

            <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#656A7C] ml-2">
              Quick Excludes:
            </span>
            {QUICK_EXCLUDE_GROUPS.map((grp) => {
              const active = filters.excludeRootGroups.includes(grp);
              return (
                <button
                  key={grp}
                  type="button"
                  onClick={() => toggleExcludedGroup(grp)}
                  className={`px-2 py-0.5 rounded text-[11px] border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#FF4D6D]/12 text-[#FF4D6D] border-[#FF4D6D]/40'
                      : 'bg-[#161923] text-[#9CA0B0] border-[#262938] hover:text-[#EFEAE0]'
                  }`}
                >
                  {active ? `Excluding ${grp}` : `Exclude ${grp}`}
                </button>
              );
            })}
            {filters.marketGroupId !== null && (
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
