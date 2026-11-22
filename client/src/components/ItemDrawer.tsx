import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calculator,
  Copy,
  Flame,
  RefreshCw,
  Star,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  formatIskCompact,
  formatIskExact,
  formatPct,
  formatRelativeTime,
  formatUnitsCompact,
  nextEveTick,
} from '../lib/format.ts';
import type { ItemDetailResponse } from '../types/api.ts';
import { ItemGameInfoModal } from './ItemGameInfoModal.tsx';
import { ItemIcon } from './ItemIcon.tsx';
import { MarketCandlestickChart } from './MarketCandlestickChart.tsx';

interface ItemDrawerProps {
  typeId: number | null;
  onClose: () => void;
  onWatchlistChanged: () => void;
  onNotify: (message: string) => void;
}

export function ItemDrawer({
  typeId,
  onClose,
  onWatchlistChanged,
  onNotify,
}: ItemDrawerProps) {
  const [detail, setDetail] = useState<ItemDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [gameInfoOpen, setGameInfoOpen] = useState(false);

  // Interactive calculator state
  const [calcBuy, setCalcBuy] = useState<number>(0);
  const [calcSell, setCalcSell] = useState<number>(0);
  const [calcQty, setCalcQty] = useState<number>(1);

  const loadDetail = useCallback(async (id: number, autoFetchHistory: boolean) => {
    setLoading(true);
    try {
      const res = await api.getItemDetail(id);
      setDetail(res);
      setCalcBuy(nextEveTick(res.item.bestBid, 'up'));
      setCalcSell(nextEveTick(res.item.bestAsk, 'down'));
      setCalcQty(1);

      if (autoFetchHistory && !res.historyMeta) {
        setHistoryLoading(true);
        try {
          await api.syncItemHistory(id, false);
          const updated = await api.getItemDetail(id);
          setDetail(updated);
        } finally {
          setHistoryLoading(false);
        }
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to load item details');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    setGameInfoOpen(false);
    if (typeId !== null) {
      void loadDetail(typeId, true);
    } else {
      setDetail(null);
    }
  }, [typeId, loadDetail]);

  const copyValue = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify(`Copied ${label}: ${text}`);
    } catch {
      onNotify(`Copy failed — value: ${text}`);
    }
  };

  const handleRefreshHistory = async () => {
    if (!detail) return;
    setHistoryLoading(true);
    try {
      await api.syncItemHistory(detail.item.typeId, true);
      const updated = await api.getItemDetail(detail.item.typeId);
      setDetail(updated);
      onNotify(`Updated 30d history for ${detail.item.name}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to refresh history');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleToggleWatchlist = async () => {
    if (!detail) return;
    if (detail.item.isWatchlisted) {
      await api.removeWatchlist(detail.item.typeId);
      onNotify(`Removed ${detail.item.name} from Watchlist`);
    } else {
      await api.upsertWatchlist({ typeId: detail.item.typeId });
      onNotify(`Added ${detail.item.name} to Watchlist`);
    }
    onWatchlistChanged();
    await loadDetail(detail.item.typeId, false);
  };

  const calcResult = useMemo(() => {
    if (!detail) return null;
    const brokerRate = detail.fees.brokerFeePct / 100;
    const taxRate = detail.fees.salesTaxPct / 100;
    const qty = Math.max(1, Math.floor(calcQty || 1));

    const buyBroker = calcBuy * brokerRate;
    const sellBroker = calcSell * brokerRate;
    const sellTax = calcSell * taxRate;

    const unitCost = calcBuy + buyBroker;
    const unitProceeds = calcSell - sellBroker - sellTax;
    const unitProfit = unitProceeds - unitCost;
    const roi = unitCost > 0 ? (unitProfit / unitCost) * 100 : 0;

    return {
      qty,
      capitalRequired: unitCost * qty,
      totalFees: (buyBroker + sellBroker + sellTax) * qty,
      unitProfit,
      totalProfit: unitProfit * qty,
      roi,
    };
  }, [detail, calcBuy, calcSell, calcQty]);

  if (typeId === null) return null;

  const charOrderIds = new Set(detail?.characterOrders.map((o) => o.order_id) ?? []);
  const maxSellVol = Math.max(1, ...(detail?.sellOrders.slice(0, 20).map((o) => o.volume_remain) ?? [1]));
  const maxBuyVol = Math.max(1, ...(detail?.buyOrders.slice(0, 20).map((o) => o.volume_remain) ?? [1]));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#08090D]/70 backdrop-blur-[2px]">
      <div className="absolute inset-0" onClick={onClose} />

      <aside className="relative z-10 w-full max-w-3xl h-full bg-[#0F1118] border-l border-[#262938] shadow-2xl flex flex-col overflow-hidden">
        {/* Drawer Header */}
        <div className="px-5 py-4 bg-[#161923] border-b border-[#262938] flex items-start justify-between gap-4">
          {detail ? (
            <div className="flex items-start gap-3.5 min-w-0">
              <ItemIcon typeId={detail.item.typeId} name={detail.item.name} size={64} className="w-12 h-12" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-display text-base sm:text-lg font-bold text-[#EFEAE0] truncate">
                    {detail.item.name}
                  </h2>
                  {detail.item.isTrending && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono-num bg-[#46E595]/15 text-[#46E595] border border-[#46E595]/40">
                      <Flame className="w-3 h-3" /> TRENDING
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-[#9CA0B0] truncate">
                  {detail.groupPath.length > 0
                    ? detail.groupPath.join(' › ')
                    : detail.item.rootGroupName}
                  <span className="ml-2 font-mono-num text-[11px] text-[#656A7C]">
                    #{detail.item.typeId}
                    {detail.item.itemVolume ? ` · ${detail.item.itemVolume} m³` : ''}
                  </span>
                </p>
              </div>
            </div>
          ) : (
            <div className="text-sm text-[#9CA0B0]">Loading item telemetry...</div>
          )}

          <div className="flex items-center gap-1.5 shrink-0">
            {detail && (
              <>
                <button
                  type="button"
                  onClick={() => setGameInfoOpen(true)}
                  title="View EVE Online in-game item description, required skills, and attributes"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#9B7BFF]/15 border border-[#9B7BFF]/50 hover:bg-[#9B7BFF]/25 text-xs font-medium text-[#B298FF] cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Game Info</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleWatchlist()}
                  title={detail.item.isWatchlisted ? 'Remove from Watchlist' : 'Bookmark'}
                  className="p-2 rounded bg-[#08090D] border border-[#262938] hover:border-[#E07A63] cursor-pointer"
                >
                  <Star
                    className={`w-4 h-4 ${
                      detail.item.isWatchlisted
                        ? 'fill-[#E07A63] text-[#E07A63]'
                        : 'text-[#9CA0B0]'
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => void handleRefreshHistory()}
                  disabled={historyLoading}
                  title="Force refresh 30d Forge history from ESI"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] text-xs text-[#EFEAE0] cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-[#9B7BFF] ${historyLoading ? 'animate-spin' : ''}`} />
                  <span>30d</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="p-2 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] text-[#9CA0B0] hover:text-[#EFEAE0] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Drawer Scroll Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && !detail ? (
            <div className="py-12 text-center text-sm text-[#9CA0B0] font-mono-num">
              Querying Jita 4-4 order depth...
            </div>
          ) : detail ? (
            <>
              {/* Quick-Copy Action Bar */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyValue('Item Name', detail.item.name)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#161923] border border-[#262938] hover:border-[#9B7BFF] text-xs text-[#EFEAE0] cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-[#9B7BFF]" />
                  <span>Copy Name</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void copyValue(
                      'Outbid Buy (4-sig-fig)',
                      String(nextEveTick(detail.item.bestBid, 'up')),
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#161923] border border-[#262938] hover:border-[#46E595] text-xs font-mono-num text-[#EFEAE0] cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-[#46E595]" />
                  <span>Buy +1 Tick: {formatIskExact(nextEveTick(detail.item.bestBid, 'up'))}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void copyValue(
                      'Undercut Sell (4-sig-fig)',
                      String(nextEveTick(detail.item.bestAsk, 'down')),
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#161923] border border-[#262938] hover:border-[#9B7BFF] text-xs font-mono-num text-[#EFEAE0] cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-[#9B7BFF]" />
                  <span>
                    Sell -1 Tick: {formatIskExact(nextEveTick(detail.item.bestAsk, 'down'))}
                  </span>
                </button>
              </div>

              {/* Anomaly Warning Banner */}
              {detail.item.anomalies.length > 0 && (
                <div className="anomaly-hatch border border-[#FF4D6D]/50 rounded-md p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#FF4D6D] uppercase tracking-wider font-mono-num">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Anomaly & Manipulation Guards Triggered</span>
                  </div>
                  <ul className="space-y-1 text-xs text-[#EFEAE0]/90">
                    {detail.item.anomalies.map((a) => (
                      <li key={a.code} className="flex items-start gap-2">
                        <span className="font-mono-num text-[10px] px-1.5 py-0.5 rounded bg-[#FF4D6D]/20 text-[#FF4D6D] shrink-0">
                          {a.label}
                        </span>
                        <span className="text-[#9CA0B0]">{a.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Interactive Profit & Tax Calculator */}
              <div className="corner-frame bg-[#161923] border border-[#262938] rounded-md p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-[#9B7BFF]" />
                    <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-[#EFEAE0]">
                      Station Profit Simulator
                    </h3>
                  </div>
                  <span className="font-mono-num text-[11px] text-[#9CA0B0]">
                    Broker {detail.fees.brokerFeePct.toFixed(2)}% · Tax{' '}
                    {detail.fees.salesTaxPct.toFixed(2)}%
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                      Your Buy Bid (ISK)
                    </span>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        step="any"
                        value={calcBuy}
                        onChange={(e) => setCalcBuy(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-xs text-[#EFEAE0]"
                      />
                      <button
                        type="button"
                        onClick={() => setCalcBuy(nextEveTick(calcBuy, 'up'))}
                        className="px-2 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] text-[10px] font-mono-num text-[#9B7BFF] cursor-pointer"
                        title="Step up 1 EVE tick"
                      >
                        +1T
                      </button>
                    </div>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                      Your Sell Ask (ISK)
                    </span>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        step="any"
                        value={calcSell}
                        onChange={(e) => setCalcSell(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-xs text-[#EFEAE0]"
                      />
                      <button
                        type="button"
                        onClick={() => setCalcSell(nextEveTick(calcSell, 'down'))}
                        className="px-2 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] text-[10px] font-mono-num text-[#9B7BFF] cursor-pointer"
                        title="Step down 1 EVE tick"
                      >
                        -1T
                      </button>
                    </div>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                      Quantity (Units)
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={calcQty}
                      onChange={(e) => setCalcQty(Math.max(1, Number(e.target.value)))}
                      className="w-full px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-xs text-[#EFEAE0]"
                    />
                  </label>
                </div>

                {calcResult && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-[#262938]">
                    <div>
                      <div className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                        Capital Req.
                      </div>
                      <div className="font-mono-num text-xs font-medium text-[#EFEAE0]">
                        {formatIskCompact(calcResult.capitalRequired)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                        Total Fees
                      </div>
                      <div className="font-mono-num text-xs font-medium text-[#E07A63]">
                        {formatIskCompact(calcResult.totalFees)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                        Total Net Profit
                      </div>
                      <div
                        className={`font-mono-num text-xs font-semibold ${
                          calcResult.totalProfit >= 0 ? 'text-[#46E595]' : 'text-[#FF4D6D]'
                        }`}
                      >
                        {formatIskCompact(calcResult.totalProfit)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                        Simulated ROI
                      </div>
                      <div
                        className={`font-mono-num text-xs font-semibold ${
                          calcResult.roi >= 0 ? 'text-[#46E595]' : 'text-[#FF4D6D]'
                        }`}
                      >
                        {formatPct(calcResult.roi)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Price Candlesticks & Buy/Sell Execution Flow */}
              <div className="bg-[#161923] border border-[#262938] rounded-md p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-[#EFEAE0]">
                      The Forge Price Candlesticks &amp; Buy/Sell Flow
                    </h3>
                    <p className="text-[11px] font-mono-num text-[#656A7C]">
                      {detail.item.hasHistory
                        ? `7d Avg ${formatUnitsCompact(detail.item.dailyVolume7d)} u/d · 30d Avg ${formatUnitsCompact(detail.item.dailyVolume30d)} u/d · Vol Trend ${formatPct(detail.item.volumeTrendPct, true)}`
                        : 'Fetching regional history telemetry...'}
                    </p>
                  </div>
                  {detail.historyMeta && (
                    <span className="text-[10px] font-mono-num text-[#656A7C]">
                      Cached {formatRelativeTime(detail.historyMeta.fetched_at)}
                    </span>
                  )}
                </div>

                {historyLoading ? (
                  <div className="h-56 flex items-center justify-center text-xs font-mono-num text-[#B298FF]">
                    Fetching 30d ESI market history...
                  </div>
                ) : detail.history.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-xs font-mono-num text-[#656A7C]">
                    No historical trades recorded in The Forge over the last 45 days.
                  </div>
                ) : (
                  <MarketCandlestickChart
                    history={detail.history}
                    bestBid={detail.item.bestBid}
                    bestAsk={detail.item.bestAsk}
                  />
                )}
              </div>

              {/* Jita 4-4 Split Order Book */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Sell Orders */}
                <div className="bg-[#161923] border border-[#262938] rounded-md overflow-hidden">
                  <div className="px-3.5 py-2.5 bg-[#08090D]/60 border-b border-[#262938] flex items-center justify-between">
                    <span className="font-display text-xs font-semibold uppercase tracking-wider text-[#9B7BFF]">
                      Sell Orders ({detail.item.sellOrderCount})
                    </span>
                    <span className="font-mono-num text-[11px] text-[#656A7C]">
                      {detail.item.askVolume.toLocaleString()} units
                    </span>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-[#262938]/50">
                    {detail.sellOrders.slice(0, 30).map((order) => {
                      const pct = Math.min(100, (order.volume_remain / maxSellVol) * 100);
                      const isMine = charOrderIds.has(order.order_id);
                      return (
                        <div
                          key={order.order_id}
                          className="relative px-3 py-1.5 flex items-center justify-between text-[11px] font-mono-num"
                        >
                          <div
                            className="absolute inset-y-0 right-0 bg-[#9B7BFF]/10 pointer-events-none"
                            style={{ width: `${pct}%` }}
                          />
                          <div className="relative z-10 flex items-center gap-1.5">
                            <span className="text-[#EFEAE0]">{formatIskExact(order.price)}</span>
                            {isMine && (
                              <span className="px-1 rounded text-[9px] bg-[#E07A63]/25 text-[#E07A63]">
                                YOU
                              </span>
                            )}
                          </div>
                          <div className="relative z-10 flex items-center gap-2 text-[#9CA0B0]">
                            <span>{order.volume_remain.toLocaleString()}</span>
                            <span className="text-[10px] text-[#656A7C]">
                              {formatRelativeTime(order.issued)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Buy Orders */}
                <div className="bg-[#161923] border border-[#262938] rounded-md overflow-hidden">
                  <div className="px-3.5 py-2.5 bg-[#08090D]/60 border-b border-[#262938] flex items-center justify-between">
                    <span className="font-display text-xs font-semibold uppercase tracking-wider text-[#46E595]">
                      Buy Orders ({detail.item.buyOrderCount})
                    </span>
                    <span className="font-mono-num text-[11px] text-[#656A7C]">
                      {detail.item.bidVolume.toLocaleString()} units
                    </span>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-[#262938]/50">
                    {detail.buyOrders.slice(0, 30).map((order) => {
                      const pct = Math.min(100, (order.volume_remain / maxBuyVol) * 100);
                      const isMine = charOrderIds.has(order.order_id);
                      return (
                        <div
                          key={order.order_id}
                          className="relative px-3 py-1.5 flex items-center justify-between text-[11px] font-mono-num"
                        >
                          <div
                            className="absolute inset-y-0 right-0 bg-[#46E595]/10 pointer-events-none"
                            style={{ width: `${pct}%` }}
                          />
                          <div className="relative z-10 flex items-center gap-1.5">
                            <span className="text-[#EFEAE0]">{formatIskExact(order.price)}</span>
                            {order.min_volume > 1 && (
                              <span
                                title={`Minimum fill volume: ${order.min_volume}`}
                                className="px-1 rounded text-[9px] bg-[#FF4D6D]/20 text-[#FF4D6D]"
                              >
                                min {order.min_volume}
                              </span>
                            )}
                            {isMine && (
                              <span className="px-1 rounded text-[9px] bg-[#E07A63]/25 text-[#E07A63]">
                                YOU
                              </span>
                            )}
                          </div>
                          <div className="relative z-10 flex items-center gap-2 text-[#9CA0B0]">
                            <span>{order.volume_remain.toLocaleString()}</span>
                            <span className="text-[10px] text-[#656A7C]">
                              {formatRelativeTime(order.issued)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </aside>

      <ItemGameInfoModal
        typeId={detail?.item.typeId ?? null}
        initialName={detail?.item.name}
        open={gameInfoOpen}
        onClose={() => setGameInfoOpen(false)}
      />
    </div>
  );
}
