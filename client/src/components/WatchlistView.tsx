import { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, Flame, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  formatIskCompact,
  formatIskExact,
  formatIskInput,
  formatLiveNumericInput,
  formatPct,
  parseIskShorthand,
} from '../lib/format.ts';
import type { WatchlistItem } from '../types/api.ts';
import { ItemIcon } from './ItemIcon.tsx';

interface WatchlistViewProps {
  onSelectTypeId: (typeId: number) => void;
  onWatchlistChanged: () => void;
  onNotify: (msg: string) => void;
}

function parseTargetField(raw: string): { valid: boolean; value: number | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: true, value: null };
  const parsed = parseIskShorthand(trimmed);
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0) {
    return { valid: false, value: null };
  }
  return { valid: true, value: parsed };
}

function WatchlistRow({
  item,
  onSelect,
  onSave,
  onDelete,
  onNotify,
}: {
  item: WatchlistItem;
  onSelect: () => void;
  onSave: (
    typeId: number,
    note: string,
    targetBuy: number | null,
    targetSell: number | null,
  ) => Promise<boolean>;
  onDelete: (typeId: number) => Promise<void>;
  onNotify: (msg: string) => void;
}) {
  const [note, setNote] = useState(item.note);
  const [targetBuy, setTargetBuy] = useState(formatIskInput(item.targetBuy));
  const [targetSell, setTargetSell] = useState(formatIskInput(item.targetSell));
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimerRef = useRef<number | null>(null);

  const clearSavedFeedback = () => {
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }
    setJustSaved(false);
  };

  const buyInputRef = useRef<HTMLInputElement>(null);
  const sellInputRef = useRef<HTMLInputElement>(null);
  const noteInputRef = useRef<HTMLInputElement>(null);

  const typeIdRef = useRef(item.typeId);
  typeIdRef.current = item.typeId;

  const draftRef = useRef({
    note: item.note,
    targetBuy: formatIskInput(item.targetBuy),
    targetSell: formatIskInput(item.targetSell),
  });
  const lastSavedRef = useRef({
    note: item.note,
    targetBuy: item.targetBuy,
    targetSell: item.targetSell,
  });
  const deletedRef = useRef(false);

  useEffect(() => {
    lastSavedRef.current.targetBuy = item.targetBuy;
    if (document.activeElement !== buyInputRef.current) {
      const formatted = formatIskInput(item.targetBuy);
      setTargetBuy(formatted);
      draftRef.current.targetBuy = formatted;
    }
  }, [item.typeId, item.targetBuy]);

  useEffect(() => {
    lastSavedRef.current.targetSell = item.targetSell;
    if (document.activeElement !== sellInputRef.current) {
      const formatted = formatIskInput(item.targetSell);
      setTargetSell(formatted);
      draftRef.current.targetSell = formatted;
    }
  }, [item.typeId, item.targetSell]);

  useEffect(() => {
    lastSavedRef.current.note = item.note;
    if (document.activeElement !== noteInputRef.current) {
      setNote(item.note);
      draftRef.current.note = item.note;
    }
  }, [item.typeId, item.note]);

  // Flush any pending valid edits when navigating away or unmounting
  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
      if (deletedRef.current) return;
      const parsedBuy = parseTargetField(draftRef.current.targetBuy);
      const parsedSell = parseTargetField(draftRef.current.targetSell);
      if (!parsedBuy.valid || !parsedSell.valid) return;
      const nextNote = draftRef.current.note;
      const last = lastSavedRef.current;
      if (
        nextNote === last.note &&
        parsedBuy.value === last.targetBuy &&
        parsedSell.value === last.targetSell
      ) {
        return;
      }
      void api
        .updateWatchlist(typeIdRef.current, {
          note: nextNote,
          targetBuy: parsedBuy.value,
          targetSell: parsedSell.value,
        })
        .catch(() => {});
    };
  }, []);

  const parsedBuyLive = parseTargetField(targetBuy);
  const parsedSellLive = parseTargetField(targetSell);
  const isDirty =
    !parsedBuyLive.valid ||
    !parsedSellLive.valid ||
    parsedBuyLive.value !== item.targetBuy ||
    parsedSellLive.value !== item.targetSell ||
    note !== item.note;

  const commitSave = async () => {
    if (deletedRef.current) return;

    const draft = draftRef.current;
    const parsedBuy = parseTargetField(draft.targetBuy);
    const parsedSell = parseTargetField(draft.targetSell);

    if (!parsedBuy.valid || !parsedSell.valid) {
      onNotify('Invalid target price — use numbers or shorthand like 10m / 500k');
      if (!parsedBuy.valid) {
        const reverted = formatIskInput(item.targetBuy);
        draftRef.current.targetBuy = reverted;
        setTargetBuy(reverted);
      }
      if (!parsedSell.valid) {
        const reverted = formatIskInput(item.targetSell);
        draftRef.current.targetSell = reverted;
        setTargetSell(reverted);
      }
      return;
    }

    const formattedBuy = formatIskInput(parsedBuy.value);
    const formattedSell = formatIskInput(parsedSell.value);
    draftRef.current.targetBuy = formattedBuy;
    draftRef.current.targetSell = formattedSell;
    setTargetBuy(formattedBuy);
    setTargetSell(formattedSell);

    const last = lastSavedRef.current;
    if (
      draft.note === last.note &&
      parsedBuy.value === last.targetBuy &&
      parsedSell.value === last.targetSell
    ) {
      return;
    }

    lastSavedRef.current = {
      note: draft.note,
      targetBuy: parsedBuy.value,
      targetSell: parsedSell.value,
    };

    setSaving(true);
    try {
      const ok = await onSave(item.typeId, draft.note, parsedBuy.value, parsedSell.value);
      if (ok) {
        if (savedTimerRef.current !== null) {
          window.clearTimeout(savedTimerRef.current);
        }
        setJustSaved(true);
        savedTimerRef.current = window.setTimeout(() => {
          savedTimerRef.current = null;
          setJustSaved(false);
        }, 2000);
      } else {
        lastSavedRef.current = {
          note: item.note,
          targetBuy: item.targetBuy,
          targetSell: item.targetSell,
        };
      }
    } finally {
      setSaving(false);
    }
  };

  const revertEdits = () => {
    clearSavedFeedback();
    const revertedBuy = formatIskInput(item.targetBuy);
    const revertedSell = formatIskInput(item.targetSell);
    draftRef.current = {
      note: item.note,
      targetBuy: revertedBuy,
      targetSell: revertedSell,
    };
    setNote(item.note);
    setTargetBuy(revertedBuy);
    setTargetSell(revertedSell);
  };

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
          ref={buyInputRef}
          type="text"
          inputMode="decimal"
          value={targetBuy}
          onChange={(e) => {
            clearSavedFeedback();
            const next = formatLiveNumericInput(e.target.value, true);
            draftRef.current.targetBuy = next;
            setTargetBuy(next);
          }}
          onBlur={() => void commitSave()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              revertEdits();
              e.currentTarget.blur();
            }
          }}
          placeholder="Target Buy"
          className="w-28 px-2 py-1 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-[11px] text-[#EFEAE0]"
        />
      </td>

      <td className="px-3 py-2.5">
        <input
          ref={sellInputRef}
          type="text"
          inputMode="decimal"
          value={targetSell}
          onChange={(e) => {
            clearSavedFeedback();
            const next = formatLiveNumericInput(e.target.value, true);
            draftRef.current.targetSell = next;
            setTargetSell(next);
          }}
          onBlur={() => void commitSave()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              revertEdits();
              e.currentTarget.blur();
            }
          }}
          placeholder="Target Sell"
          className="w-28 px-2 py-1 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-[11px] text-[#EFEAE0]"
        />
      </td>

      <td className="px-3 py-2.5">
        <input
          ref={noteInputRef}
          type="text"
          value={note}
          onChange={(e) => {
            clearSavedFeedback();
            const next = e.target.value;
            draftRef.current.note = next;
            setNote(next);
          }}
          onBlur={() => void commitSave()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              revertEdits();
              e.currentTarget.blur();
            }
          }}
          placeholder="Add trader note..."
          className="w-44 px-2 py-1 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none text-xs text-[#EFEAE0]"
        />
      </td>

      <td className="px-3 py-2.5 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-1.5">
          {justSaved && !isDirty && !saving ? (
            <button
              type="button"
              disabled
              title="Saved"
              aria-label="Saved"
              className="p-1.5 rounded bg-[#46E595]/20 text-[#46E595] border border-[#46E595]/40 cursor-default"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          ) : isDirty || saving ? (
            <button
              type="button"
              disabled={saving}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void commitSave()}
              title={saving ? 'Saving...' : 'Save changes'}
              aria-label="Save changes"
              className={`p-1.5 rounded bg-[#9B7BFF]/20 text-[#B298FF] border border-[#9B7BFF]/50 hover:bg-[#9B7BFF]/30 cursor-pointer ${
                saving ? 'animate-pulse opacity-60' : ''
              }`}
            >
              <Save className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              disabled
              title="No unsaved changes"
              aria-label="No unsaved changes"
              className="p-1.5 rounded bg-[#161923] border border-[#262938] text-[#656A7C]/60 cursor-default"
            >
              <Save className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onMouseDown={(e) => {
              deletedRef.current = true;
              e.preventDefault();
            }}
            onClick={() => {
              void onDelete(item.typeId).catch(() => {
                deletedRef.current = false;
              });
            }}
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
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to load Watchlist');
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
  ): Promise<boolean> => {
    try {
      const updated = await api.updateWatchlist(typeId, { note, targetBuy, targetSell });
      setItems((prev) =>
        prev.map((row) =>
          row.typeId === typeId
            ? {
                ...row,
                note: updated.note,
                targetBuy: updated.targetBuy,
                targetSell: updated.targetSell,
              }
            : row,
        ),
      );
      onNotify('Saved watchlist targets & notes');
      onWatchlistChanged();
      return true;
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save watchlist changes');
      return false;
    }
  };

  const handleDelete = async (typeId: number) => {
    try {
      await api.removeWatchlist(typeId);
      setItems((prev) => prev.filter((row) => row.typeId !== typeId));
      onNotify('Removed item from Watchlist');
      onWatchlistChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to remove item from Watchlist');
      throw err;
    }
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
            Track spread alerts, target entry/exit prices (supports 10m/500k shorthand, auto-saves on Enter or blur), and notes
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
                onNotify={onNotify}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
