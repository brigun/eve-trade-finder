import { useEffect, useState } from 'react';
import { Bookmark, Check, Flame, Trash2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatIskCompact, formatIskExact, formatPct, parseIskShorthand } from '../lib/format.ts';
import type { WatchlistItem } from '../types/api.ts';
import { ItemIcon } from './ItemIcon.tsx';

interface WatchlistViewProps {
  onSelectTypeId: (typeId: number) => void;
  onWatchlistChanged: () => void;
  onNotify: (msg: string) => void;
}

function WatchlistRow({
  item,
  onSelect,
  onSave,
  onDelete,
}: {
  item: WatchlistItem;
  onSelect: () => void;
  onSave: (typeId: number, note: string, targetBuy: number | null, targetSell: number | null) => Promise<void>;
  onDelete: (typeId: number) => Promise<void>;
}) {
  const [note, setNote] = useState(item.note);
  const [targetBuy, setTargetBuy] = useState(item.targetBuy !== null ? String(item.targetBuy) : '');
  const [targetSell, setTargetSell] = useState(item.targetSell !== null ? String(item.targetSell) : '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setNote(item.note);
    setTargetBuy(item.targetBuy !== null ? String(item.targetBuy) : '');
    setTargetSell(item.targetSell !== null ? String(item.targetSell) : '');
    setDirty(false);
  }, [item]);

  const buyHit =
    item.targetBuy !== null && item.bestBid !== null && item.bestBid <= item.targetBuy;
  const sellHit =
    item.targetSell !== null && item.bestAsk !== null && item.bestAsk >= item.targetSell;

  return (
    <tr className="hover:bg-[#161923]/75 transition-colors">
      <td className="px-3 py-2.5 cursor-pointer" onClick={onSelect}>
        <div className="flex items-center gap-2.5">
          <ItemIcon typeId={item.typeId} name={item.name} size={32} className="w-8 h-8" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-[#EFEAE0] hover:text-[#B298FF] truncate max-w-[230px]">
                {item.name}
              </span>
              {item.isTrending && <Flame className="w-3.5 h-3.5 text-[#46E595] shrink-0" />}
            </div>
            <div className="text-[11px] text-[#656A7C]">{item.rootGroupName}</div>
          </div>
        </div>
      </td>

      <td className="px-3 py-2.5 text-right font-mono-num text-xs text-[#EFEAE0]">
        <div>{formatIskExact(item.bestBid)}</div>
        {buyHit && (
          <span className="text-[10px] text-[#46E595]">≤ target buy</span>
        )}
      </td>

      <td className="px-3 py-2.5 text-right font-mono-num text-xs text-[#9CA0B0]">
        <div>{formatIskExact(item.bestAsk)}</div>
        {sellHit && (
          <span className="text-[10px] text-[#46E595]">≥ target sell</span>
        )}
      </td>

      <td className="px-3 py-2.5 text-right font-mono-num text-xs">
        <span className={item.roiPct > 0 ? 'text-[#46E595] font-semibold' : 'text-[#FF4D6D]'}>
          {formatPct(item.roiPct)}
        </span>
      </td>

      <td className="px-3 py-2.5 text-right font-mono-num text-xs text-[#EFEAE0]">
        {formatIskCompact(item.estDailyProfit, false)}
      </td>

      <td className="px-3 py-2.5">
        <input
          type="text"
          value={targetBuy}
          onChange={(e) => {
            setTargetBuy(e.target.value);
            setDirty(true);
          }}
          placeholder="Target Buy"
          className="w-24 px-2 py-1 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-[11px] text-[#EFEAE0]"
        />
      </td>

      <td className="px-3 py-2.5">
        <input
          type="text"
          value={targetSell}
          onChange={(e) => {
            setTargetSell(e.target.value);
            setDirty(true);
          }}
          placeholder="Target Sell"
          className="w-24 px-2 py-1 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-[11px] text-[#EFEAE0]"
        />
      </td>

      <td className="px-3 py-2.5">
        <input
          type="text"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setDirty(true);
          }}
          placeholder="Add trader note..."
          className="w-44 px-2 py-1 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none text-xs text-[#EFEAE0]"
        />
      </td>

      <td className="px-3 py-2.5 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-1.5">
          {dirty && (
            <button
              type="button"
              onClick={() =>
                void onSave(
                  item.typeId,
                  note,
                  parseIskShorthand(targetBuy),
                  parseIskShorthand(targetSell),
                )
              }
              title="Save changes"
              className="p-1.5 rounded bg-[#46E595]/20 text-[#46E595] border border-[#46E595]/40 hover:bg-[#46E595]/30 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void onDelete(item.typeId)}
            title="Remove from Watchlist"
            className="p-1.5 rounded bg-[#161923] border border-[#262938] text-[#9CA0B0] hover:text-[#FF4D6D] hover:border-[#FF4D6D]/50 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

export function WatchlistView({
  onSelectTypeId,
  onWatchlistChanged,
  onNotify,
}: WatchlistViewProps) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getWatchlist();
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSave = async (
    typeId: number,
    note: string,
    targetBuy: number | null,
    targetSell: number | null,
  ) => {
    await api.updateWatchlist(typeId, { note, targetBuy, targetSell });
    onNotify('Saved watchlist targets & notes');
    onWatchlistChanged();
    await load();
  };

  const handleDelete = async (typeId: number) => {
    await api.removeWatchlist(typeId);
    onNotify('Removed item from Watchlist');
    onWatchlistChanged();
    await load();
  };

  if (loading) {
    return (
      <div className="bg-[#0F1118] border border-[#262938] rounded-md p-10 text-center text-xs font-mono-num text-[#9CA0B0]">
        Loading Watchlist telemetry...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="corner-frame bg-[#0F1118] border border-[#262938] rounded-md p-10 text-center">
        <Bookmark className="w-8 h-8 text-[#E07A63] mx-auto mb-3" />
        <h2 className="font-display text-base font-semibold text-[#EFEAE0]">
          Your Jita Watchlist is Empty
        </h2>
        <p className="mt-1.5 text-xs text-[#9CA0B0] max-w-md mx-auto">
          Click the star icon on any item in the Scanner or Item Detail drawer to track spreads,
          target buy/sell prices, and personal notes across restarts.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#0F1118] border border-[#262938] rounded-md overflow-hidden">
      <div className="px-4 py-3 bg-[#161923] border-b border-[#262938] flex items-center justify-between">
        <div>
          <h2 className="font-display text-sm font-semibold text-[#EFEAE0]">
            Persisted Trade Watchlist
          </h2>
          <p className="text-[11px] text-[#9CA0B0]">
            Track spread alerts, target entry/exit prices (supports 10m/500k shorthand), and notes
          </p>
        </div>
        <span className="font-mono-num text-xs text-[#E07A63]">{items.length} tracked</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="bg-[#161923]/60 border-b border-[#262938] text-[10px] font-mono-num uppercase tracking-wider text-[#9CA0B0]">
            <tr>
              <th className="px-3 py-2.5">Item</th>
              <th className="px-3 py-2.5 text-right">Best Buy</th>
              <th className="px-3 py-2.5 text-right">Best Sell</th>
              <th className="px-3 py-2.5 text-right">ROI %</th>
              <th className="px-3 py-2.5 text-right">Est. Daily</th>
              <th className="px-3 py-2.5">Target Buy</th>
              <th className="px-3 py-2.5">Target Sell</th>
              <th className="px-3 py-2.5">Notes</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#262938]/70 text-xs">
            {items.map((item) => (
              <WatchlistRow
                key={item.typeId}
                item={item}
                onSelect={() => onSelectTypeId(item.typeId)}
                onSave={handleSave}
                onDelete={handleDelete}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
