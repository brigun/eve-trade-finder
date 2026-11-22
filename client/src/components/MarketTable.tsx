import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  DatabaseZap,
  Flame,
  RefreshCw,
  RotateCcw,
  Star,
} from 'lucide-react';
import {
  formatIskCompact,
  formatIskExact,
  formatPct,
  formatUnitsCompact,
} from '../lib/format.ts';
import type { MarketItem } from '../types/api.ts';
import { ItemIcon } from './ItemIcon.tsx';

interface MarketTableProps {
  items: MarketItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  loading: boolean;
  hasAnyData: boolean;
  syncingOrders: boolean;
  selectedTypeId: number | null;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  onSort: (column: string) => void;
  onPageChange: (page: number) => void;
  onSelectItem: (item: MarketItem) => void;
  onToggleWatchlist: (item: MarketItem) => void;
  onSyncOrders: () => void;
  onResetFilters: () => void;
}

function SortHeader({
  label,
  column,
  sortBy,
  sortDir,
  align = 'right',
  onSort,
}: {
  label: string;
  column: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  align?: 'left' | 'right';
  onSort: (col: string) => void;
}) {
  const active = sortBy === column;
  return (
    <th
      className={`px-3 py-2.5 text-[10px] font-mono-num uppercase tracking-wider whitespace-nowrap select-none cursor-pointer transition-colors ${
        align === 'left' ? 'text-left' : 'text-right'
      } ${active ? 'text-[#B298FF]' : 'text-[#9CA0B0] hover:text-[#EFEAE0]'}`}
      onClick={() => onSort(column)}
    >
      <span className="inline-flex items-center gap-1">
        {align === 'right' &&
          (active ? (
            sortDir === 'asc' ? (
              <ArrowUp className="w-3 h-3 text-[#9B7BFF]" />
            ) : (
              <ArrowDown className="w-3 h-3 text-[#9B7BFF]" />
            )
          ) : (
            <ArrowUpDown className="w-3 h-3 opacity-40" />
          ))}
        <span>{label}</span>
        {align === 'left' &&
          (active ? (
            sortDir === 'asc' ? (
              <ArrowUp className="w-3 h-3 text-[#9B7BFF]" />
            ) : (
              <ArrowDown className="w-3 h-3 text-[#9B7BFF]" />
            )
          ) : (
            <ArrowUpDown className="w-3 h-3 opacity-40" />
          ))}
      </span>
    </th>
  );
}

export function MarketTable({
  items,
  total,
  page,
  pageSize,
  totalPages,
  loading,
  hasAnyData,
  syncingOrders,
  selectedTypeId,
  sortBy,
  sortDir,
  onSort,
  onPageChange,
  onSelectItem,
  onToggleWatchlist,
  onSyncOrders,
  onResetFilters,
}: MarketTableProps) {
  if (!hasAnyData && !loading) {
    return (
      <div className="corner-frame bg-[#0F1118] border border-[#262938] rounded-md p-8 sm:p-12 text-center">
        <div className="mx-auto w-12 h-12 rounded-lg bg-[#9B7BFF]/15 border border-[#9B7BFF]/40 flex items-center justify-center mb-4">
          <DatabaseZap className="w-6 h-6 text-[#9B7BFF]" />
        </div>
        <h2 className="font-display text-lg font-semibold text-[#EFEAE0]">
          Jita 4-4 Local Database Ready
        </h2>
        <p className="mt-2 max-w-xl mx-auto text-sm text-[#9CA0B0]">
          Your local SQLite telemetry store is initialized. Sync the EVE static item catalog and
          pull live The Forge market orders filtered strictly to{' '}
          <span className="font-mono-num text-[#EFEAE0]">
            Jita IV - Moon 4 - Caldari Navy Assembly Plant
          </span>
          .
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onSyncOrders}
            disabled={syncingOrders}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#9B7BFF] text-[#08090D] font-semibold text-sm hover:bg-[#B298FF] disabled:opacity-50 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${syncingOrders ? 'animate-spin' : ''}`} />
            <span>
              {syncingOrders ? 'Syncing SDE & Jita Orders...' : 'Initialize SDE & Sync Jita 4-4'}
            </span>
          </button>
        </div>
      </div>
    );
  }

  if (items.length === 0 && !loading) {
    return (
      <div className="bg-[#0F1118] border border-[#262938] rounded-md p-10 text-center">
        <p className="font-display text-base font-medium text-[#EFEAE0]">
          No Jita 4-4 items match your active constraints
        </p>
        <p className="mt-1.5 text-xs text-[#9CA0B0]">
          Try lowering Min Profit %, expanding price bounds, or disabling Trending / History-only
          toggles if 30d history is still backfilling.
        </p>
        <button
          type="button"
          onClick={onResetFilters}
          className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-[#161923] border border-[#262938] hover:border-[#9B7BFF] text-xs text-[#EFEAE0] cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5 text-[#9B7BFF]" />
          <span>Reset Filters</span>
        </button>
      </div>
    );
  }

  const startIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIdx = Math.min(total, page * pageSize);

  return (
    <div className="bg-[#0F1118] border border-[#262938] rounded-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="bg-[#161923] border-b border-[#262938]">
            <tr>
              <th className="w-9 px-2.5 py-2.5 text-center text-[10px] font-mono-num uppercase text-[#656A7C]">
                ★
              </th>
              <SortHeader
                label="Item / Group"
                column="name"
                sortBy={sortBy}
                sortDir={sortDir}
                align="left"
                onSort={onSort}
              />
              <SortHeader
                label="Best Buy"
                column="bestBid"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Best Sell"
                column="bestAsk"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Net Profit"
                column="netProfit"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="ROI %"
                column="roiPct"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Est. Daily"
                column="estDailyProfit"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="7d Daily Vol"
                column="dailyIskVolume7d"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Trend (7d/30d)"
                column="volumeTrendPct"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Comp / 1h"
                column="competition"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={onSort}
              />
            </tr>
          </thead>

          <tbody className="divide-y divide-[#262938]/70 text-xs">
            {items.map((item) => {
              const selected = item.typeId === selectedTypeId;
              const profitable = item.netProfit > 0;
              return (
                <tr
                  key={item.typeId}
                  onClick={() => onSelectItem(item)}
                  className={`cursor-pointer transition-colors ${
                    selected
                      ? 'bg-[#9B7BFF]/14'
                      : 'hover:bg-[#161923]/85'
                  }`}
                >
                  {/* Watchlist Star */}
                  <td
                    className="px-2.5 py-2 text-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleWatchlist(item);
                    }}
                  >
                    <button
                      type="button"
                      title={item.isWatchlisted ? 'Remove from Watchlist' : 'Add to Watchlist'}
                      className="p-1 rounded hover:bg-[#1D2130] transition-colors cursor-pointer"
                    >
                      <Star
                        className={`w-3.5 h-3.5 ${
                          item.isWatchlisted
                            ? 'fill-[#E07A63] text-[#E07A63]'
                            : 'text-[#656A7C] hover:text-[#EFEAE0]'
                        }`}
                      />
                    </button>
                  </td>

                  {/* Item Name, Icon & Status Badges */}
                  <td className="px-3 py-2 min-w-[260px] max-w-[360px]">
                    <div className="flex items-center gap-2.5">
                      <ItemIcon typeId={item.typeId} name={item.name} size={32} className="w-8 h-8" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-[#EFEAE0] truncate max-w-[230px]">
                            {item.name}
                          </span>
                          {item.isTrending && (
                            <span
                              title="Active volume or price surge over 30d baseline"
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-mono-num bg-[#46E595]/15 text-[#46E595] border border-[#46E595]/40"
                            >
                              <Flame className="w-2.5 h-2.5" />
                              HOT
                            </span>
                          )}
                          {item.hasAnomaly && (
                            <span
                              title={item.anomalies.map((a) => `${a.label}: ${a.reason}`).join('\n')}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-mono-num bg-[#FF4D6D]/15 text-[#FF4D6D] border border-[#FF4D6D]/45"
                            >
                              <AlertTriangle className="w-2.5 h-2.5" />
                              RISK
                            </span>
                          )}
                          {item.hasCharacterOrder && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono-num bg-[#E07A63]/20 text-[#E07A63] border border-[#E07A63]/45">
                              ORDER
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#656A7C] truncate">
                          {item.rootGroupName}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Best Buy */}
                  <td
                    className="px-3 py-2 text-right font-mono-num text-[#EFEAE0] whitespace-nowrap"
                    title={`${formatIskExact(item.bestBid)} ISK`}
                  >
                    {formatIskCompact(item.bestBid, false)}
                  </td>

                  {/* Best Sell */}
                  <td
                    className="px-3 py-2 text-right font-mono-num text-[#9CA0B0] whitespace-nowrap"
                    title={`${formatIskExact(item.bestAsk)} ISK`}
                  >
                    {formatIskCompact(item.bestAsk, false)}
                  </td>

                  {/* Net Profit / Unit */}
                  <td
                    className={`px-3 py-2 text-right font-mono-num font-medium whitespace-nowrap ${
                      profitable ? 'text-[#46E595]' : 'text-[#FF4D6D]'
                    }`}
                    title={`${formatIskExact(item.netProfit)} ISK/unit after fees`}
                  >
                    {formatIskCompact(item.netProfit, false)}
                  </td>

                  {/* ROI % */}
                  <td className="px-3 py-2 text-right font-mono-num whitespace-nowrap">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                        item.roiPct >= 15
                          ? 'bg-[#46E595]/15 text-[#46E595]'
                          : item.roiPct > 0
                            ? 'bg-[#9B7BFF]/15 text-[#B298FF]'
                            : 'bg-[#FF4D6D]/15 text-[#FF4D6D]'
                      }`}
                    >
                      {formatPct(item.roiPct)}
                    </span>
                  </td>

                  {/* Est Daily Profit */}
                  <td className="px-3 py-2 text-right font-mono-num whitespace-nowrap">
                    {item.estDailyProfit !== null ? (
                      <span className="text-[#EFEAE0]">
                        {formatIskCompact(item.estDailyProfit, false)}
                      </span>
                    ) : (
                      <span className="text-[10px] text-[#656A7C]">no 30d</span>
                    )}
                  </td>

                  {/* 7d Daily Volume */}
                  <td className="px-3 py-2 text-right font-mono-num whitespace-nowrap">
                    {item.hasHistory ? (
                      <div className="flex flex-col items-end leading-tight">
                        <span className="text-[#EFEAE0]">
                          {formatIskCompact(item.dailyIskVolume7d, false)}
                        </span>
                        <span className="text-[10px] text-[#656A7C]">
                          {formatUnitsCompact(item.dailyVolume7d)} u/d
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-[#656A7C]">pending</span>
                    )}
                  </td>

                  {/* 7d vs 30d Trend */}
                  <td className="px-3 py-2 text-right font-mono-num whitespace-nowrap">
                    {item.hasHistory ? (
                      <div className="flex flex-col items-end leading-tight">
                        <span
                          className={
                            (item.volumeTrendPct ?? 0) >= 15
                              ? 'text-[#46E595]'
                              : (item.volumeTrendPct ?? 0) <= -20
                                ? 'text-[#FF4D6D]'
                                : 'text-[#9CA0B0]'
                          }
                        >
                          Vol {formatPct(item.volumeTrendPct, true)}
                        </span>
                        <span
                          className={`text-[10px] ${
                            (item.priceTrendPct ?? 0) >= 3
                              ? 'text-[#46E595]'
                              : (item.priceTrendPct ?? 0) <= -5
                                ? 'text-[#FF4D6D]'
                                : 'text-[#656A7C]'
                          }`}
                        >
                          Px {formatPct(item.priceTrendPct, true)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[#656A7C]">—</span>
                    )}
                  </td>

                  {/* Competition & Order Velocity */}
                  <td className="px-3 py-2 text-right font-mono-num whitespace-nowrap">
                    <div className="flex flex-col items-end leading-tight">
                      <span className="text-[#EFEAE0]">
                        {item.topBuyCompetition}B / {item.topSellCompetition}S
                      </span>
                      <span
                        className={`text-[10px] ${
                          item.recentUpdates1h >= 15 ? 'text-[#E07A63]' : 'text-[#656A7C]'
                        }`}
                      >
                        {item.recentUpdates1h} upd/1h
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="px-4 py-2.5 bg-[#161923] border-t border-[#262938] flex items-center justify-between text-xs text-[#9CA0B0]">
        <div className="font-mono-num">
          {loading ? (
            <span className="text-[#B298FF]">Querying local telemetry...</span>
          ) : (
            <span>
              Showing <span className="text-[#EFEAE0]">{startIdx}</span>–
              <span className="text-[#EFEAE0]">{endIdx}</span> of{' '}
              <span className="text-[#EFEAE0]">{total.toLocaleString()}</span> matching items
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] disabled:opacity-40 disabled:cursor-not-allowed text-[#EFEAE0] cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Prev</span>
          </button>
          <span className="font-mono-num text-[11px]">
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] disabled:opacity-40 disabled:cursor-not-allowed text-[#EFEAE0] cursor-pointer"
          >
            <span>Next</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
