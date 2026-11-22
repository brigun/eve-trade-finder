import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Box,
  Cpu,
  ExternalLink,
  GraduationCap,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatRelativeTime } from '../lib/format.ts';
import type { DescriptionSegment, ItemGameInfo } from '../types/api.ts';
import { ItemIcon } from './ItemIcon.tsx';

interface ItemGameInfoModalProps {
  typeId: number | null;
  initialName?: string;
  open: boolean;
  onClose: () => void;
}

function formatSpecNumber(val: number, unit: string): string {
  const formatted = val.toLocaleString('en-US', {
    maximumFractionDigits: val < 10 ? 3 : 2,
  });
  return `${formatted} ${unit}`;
}

function metaBadgeClass(label: string): string {
  if (/tech ii|tech iii/i.test(label)) {
    return 'bg-[#9B7BFF]/15 text-[#B298FF] border border-[#9B7BFF]/45';
  }
  if (/faction|deadspace|officer|storyline|abyssal/i.test(label)) {
    return 'bg-[#E07A63]/15 text-[#E07A63] border border-[#E07A63]/45';
  }
  return 'bg-[#1D2130] text-[#9CA0B0] border border-[#262938]';
}

export function ItemGameInfoModal({
  typeId,
  initialName,
  open,
  onClose,
}: ItemGameInfoModalProps) {
  const [activeTypeId, setActiveTypeId] = useState<number | null>(typeId);
  const [navHistory, setNavHistory] = useState<number[]>([]);
  const [gameInfo, setGameInfo] = useState<ItemGameInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderFailed, setRenderFailed] = useState(false);
  const [attrFilter, setAttrFilter] = useState('');

  // Reset stack whenever modal opens or root item changes
  useEffect(() => {
    if (open && typeId !== null) {
      setActiveTypeId(typeId);
      setNavHistory([]);
      setAttrFilter('');
      setRenderFailed(false);
    } else if (!open) {
      setGameInfo(null);
      setError(null);
      setNavHistory([]);
      setAttrFilter('');
    }
  }, [open, typeId]);

  const fetchInfo = useCallback(async (targetId: number, force: boolean) => {
    setLoading(true);
    setError(null);
    setRenderFailed(false);
    try {
      const res = await api.getItemGameInfo(targetId, force);
      setGameInfo(res.gameInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load in-game item info');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || activeTypeId === null) return;
    setAttrFilter('');
    void fetchInfo(activeTypeId, false);
  }, [open, activeTypeId, fetchInfo]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const navigateToType = (nextTypeId: number) => {
    if (!nextTypeId || nextTypeId === activeTypeId) return;
    if (activeTypeId !== null) {
      setNavHistory((prev) => [...prev, activeTypeId]);
    }
    setActiveTypeId(nextTypeId);
  };

  const navigateBack = () => {
    setNavHistory((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const previousId = next.pop()!;
      setActiveTypeId(previousId);
      return next;
    });
  };

  const filteredAttributes = useMemo(() => {
    if (!gameInfo) return [];
    const q = attrFilter.trim().toLowerCase();
    if (!q) return gameInfo.attributes;
    return gameInfo.attributes.filter(
      (a) =>
        a.displayName.toLowerCase().includes(q) ||
        a.formattedValue.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q),
    );
  }, [gameInfo, attrFilter]);

  const physicalSpecs = useMemo(() => {
    if (!gameInfo) return [];
    const specs: Array<{ label: string; value: string }> = [];
    if (gameInfo.volume !== null) {
      specs.push({ label: 'Volume', value: formatSpecNumber(gameInfo.volume, 'm³') });
    }
    if (gameInfo.packagedVolume !== null && gameInfo.packagedVolume !== gameInfo.volume) {
      specs.push({
        label: 'Packaged',
        value: formatSpecNumber(gameInfo.packagedVolume, 'm³'),
      });
    }
    if (gameInfo.mass !== null && gameInfo.mass > 0) {
      specs.push({ label: 'Mass', value: formatSpecNumber(gameInfo.mass, 'kg') });
    }
    if (gameInfo.capacity !== null && gameInfo.capacity > 0) {
      specs.push({ label: 'Capacity', value: formatSpecNumber(gameInfo.capacity, 'm³') });
    }
    if (gameInfo.portionSize !== null && gameInfo.portionSize > 1) {
      specs.push({
        label: 'Portion Size',
        value: `${gameInfo.portionSize.toLocaleString('en-US')} units`,
      });
    }
    if (gameInfo.radius !== null && gameInfo.radius > 0) {
      specs.push({ label: 'Radius', value: formatSpecNumber(gameInfo.radius, 'm') });
    }
    return specs;
  }, [gameInfo]);

  if (!open || activeTypeId === null) return null;

  const displayName =
    gameInfo?.name ?? (navHistory.length === 0 ? initialName : undefined) ?? `Type #${activeTypeId}`;

  const renderSegment = (seg: DescriptionSegment, idx: number) => {
    const styleCls = `${seg.bold ? 'font-semibold text-[#EFEAE0]' : ''} ${
      seg.italic ? 'italic text-[#EFEAE0]/80' : ''
    }`.trim();

    if (seg.showInfoTypeId !== undefined) {
      return (
        <button
          key={idx}
          type="button"
          onClick={() => navigateToType(seg.showInfoTypeId!)}
          title={`Open Show Info for Type #${seg.showInfoTypeId}`}
          className={`inline text-left text-[#B298FF] underline decoration-[#9B7BFF]/50 hover:text-[#EFEAE0] cursor-pointer ${styleCls}`}
        >
          {seg.text}
        </button>
      );
    }

    if (seg.loreLink) {
      return (
        <span key={idx} className={`text-[#E07A63] ${styleCls}`}>
          {seg.text}
        </span>
      );
    }

    return (
      <span key={idx} className={styleCls}>
        {seg.text}
      </span>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-5 bg-[#08090D]/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`EVE Online Show Info: ${displayName}`}
    >
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative z-10 w-full max-w-3xl max-h-[90vh] bg-[#0F1118] border border-[#262938] rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-[#161923] border-b border-[#262938] flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            {navHistory.length > 0 && (
              <button
                type="button"
                onClick={navigateBack}
                title="Back to previous item"
                className="mt-1 p-2 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] text-[#9CA0B0] hover:text-[#EFEAE0] cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}

            {gameInfo?.supportsRender && !renderFailed ? (
              <img
                key={`render-${activeTypeId}`}
                src={`https://images.evetech.net/types/${activeTypeId}/render?size=256`}
                alt={displayName}
                onError={() => setRenderFailed(true)}
                className="w-16 h-16 shrink-0 rounded-md bg-[#08090D] border border-[#262938] object-contain p-0.5"
              />
            ) : (
              <ItemIcon
                key={`icon-${activeTypeId}`}
                typeId={activeTypeId}
                name={displayName}
                size={64}
                className="w-14 h-14"
              />
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono-num uppercase tracking-wider bg-[#9B7BFF]/15 text-[#B298FF] border border-[#9B7BFF]/40">
                  <BookOpen className="w-3 h-3" />
                  <span>Show Info</span>
                </span>
                <h2 className="font-display text-base sm:text-lg font-bold text-[#EFEAE0] truncate">
                  {displayName}
                </h2>
                {gameInfo?.metaGroupLabel && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono-num ${metaBadgeClass(
                      gameInfo.metaGroupLabel,
                    )}`}
                  >
                    {gameInfo.metaGroupLabel}
                  </span>
                )}
                {gameInfo && gameInfo.metaLevel !== null && gameInfo.metaLevel > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono-num bg-[#08090D] text-[#9CA0B0] border border-[#262938]">
                    Meta {gameInfo.metaLevel}
                  </span>
                )}
              </div>

              <p className="mt-1 text-xs text-[#9CA0B0] truncate">
                {gameInfo ? (
                  <>
                    <span>{gameInfo.categoryName}</span>
                    <span className="mx-1 text-[#656A7C]">›</span>
                    <span className="text-[#EFEAE0]/90">{gameInfo.groupName}</span>
                  </>
                ) : (
                  <span>Querying EVE Online Encyclopedia...</span>
                )}
                <span className="ml-2 font-mono-num text-[11px] text-[#656A7C]">
                  #{activeTypeId}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => void fetchInfo(activeTypeId, true)}
              disabled={loading}
              title="Refresh item data from EVE ESI"
              className="p-2 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] text-[#9CA0B0] hover:text-[#EFEAE0] disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 text-[#9B7BFF] ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close game info modal"
              className="p-2 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] text-[#9CA0B0] hover:text-[#EFEAE0] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && !gameInfo ? (
            <div className="py-16 text-center space-y-2">
              <div className="font-mono-num text-xs text-[#B298FF]">
                Retrieving item dossier & dogma attributes from ESI...
              </div>
              <div className="text-[11px] text-[#656A7C]">Type #{activeTypeId}</div>
            </div>
          ) : error && !gameInfo ? (
            <div className="py-10 px-4 rounded-md bg-[#FF4D6D]/10 border border-[#FF4D6D]/40 text-center space-y-3">
              <p className="text-xs text-[#FF4D6D] font-mono-num">{error}</p>
              <button
                type="button"
                onClick={() => void fetchInfo(activeTypeId, true)}
                className="px-3 py-1.5 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] text-xs text-[#EFEAE0] cursor-pointer"
              >
                Retry ESI Fetch
              </button>
            </div>
          ) : gameInfo ? (
            <>
              {error && (
                <div className="px-3 py-2 rounded bg-[#FF4D6D]/10 border border-[#FF4D6D]/40 text-[11px] text-[#FF4D6D] font-mono-num">
                  Refresh failed: {error}
                </div>
              )}

              {/* In-Game Description */}
              <div className="corner-frame bg-[#161923] border border-[#262938] rounded-md p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-[#9B7BFF]" />
                    <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-[#EFEAE0]">
                      Description & Traits
                    </h3>
                  </div>
                  {loading && (
                    <span className="text-[10px] font-mono-num text-[#B298FF]">Refreshing...</span>
                  )}
                </div>

                {gameInfo.descriptionParagraphs.length > 0 ? (
                  <div className="space-y-2.5 text-sm leading-relaxed text-[#EFEAE0]/90">
                    {gameInfo.descriptionParagraphs.map((segs, pIdx) => (
                      <p key={pIdx}>{segs.map((seg, sIdx) => renderSegment(seg, sIdx))}</p>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#656A7C] italic">
                    No in-game description text is published for this item.
                  </p>
                )}

                {gameInfo.marketGroupDescription && (
                  <div className="pt-2.5 border-t border-[#262938]/80 text-xs space-y-1">
                    {gameInfo.marketGroupPath.length > 0 && (
                      <div className="font-mono-num text-[10px] uppercase tracking-wider text-[#9CA0B0]">
                        Market Classification: {gameInfo.marketGroupPath.join(' › ')}
                      </div>
                    )}
                    <p className="text-[#9CA0B0] leading-relaxed">
                      {gameInfo.marketGroupDescription}
                    </p>
                  </div>
                )}
              </div>

              {/* Physical & Technical Specs */}
              {physicalSpecs.length > 0 && (
                <div className="bg-[#161923] border border-[#262938] rounded-md p-4 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Box className="w-4 h-4 text-[#9B7BFF]" />
                    <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-[#EFEAE0]">
                      Physical Specifications
                    </h3>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                    {physicalSpecs.map((spec) => (
                      <div
                        key={spec.label}
                        className="px-3 py-2 rounded bg-[#08090D]/70 border border-[#262938]"
                      >
                        <div className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                          {spec.label}
                        </div>
                        <div className="mt-0.5 font-mono-num text-xs font-semibold text-[#EFEAE0]">
                          {spec.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Required Skills */}
              {gameInfo.requiredSkills.length > 0 && (
                <div className="bg-[#161923] border border-[#262938] rounded-md p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <GraduationCap className="w-4 h-4 text-[#46E595]" />
                      <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-[#EFEAE0]">
                        Required Skills ({gameInfo.requiredSkills.length})
                      </h3>
                    </div>
                    <span className="text-[10px] text-[#656A7C]">Click any skill to inspect</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {gameInfo.requiredSkills.map((skill) => (
                      <button
                        key={skill.skillTypeId}
                        type="button"
                        onClick={() => navigateToType(skill.skillTypeId)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] text-xs text-[#EFEAE0] cursor-pointer transition-colors"
                      >
                        <span className="text-[#B298FF] font-medium">{skill.skillName}</span>
                        <span className="px-1.5 py-0.5 rounded font-mono-num text-[10px] font-semibold bg-[#46E595]/15 text-[#46E595] border border-[#46E595]/40">
                          {skill.levelRoman}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Dogma Attributes */}
              {gameInfo.attributes.length > 0 && (
                <div className="bg-[#161923] border border-[#262938] rounded-md p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-[#9B7BFF]" />
                      <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-[#EFEAE0]">
                        In-Game Attributes ({gameInfo.attributes.length})
                      </h3>
                    </div>

                    {gameInfo.attributes.length > 10 && (
                      <label className="relative flex items-center">
                        <Search className="w-3.5 h-3.5 text-[#656A7C] absolute left-2.5 pointer-events-none" />
                        <input
                          type="text"
                          value={attrFilter}
                          onChange={(e) => setAttrFilter(e.target.value)}
                          placeholder="Filter attributes..."
                          className="pl-7 pr-2.5 py-1 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none text-xs text-[#EFEAE0] placeholder:text-[#656A7C]"
                        />
                      </label>
                    )}
                  </div>

                  {filteredAttributes.length === 0 ? (
                    <div className="py-4 text-center text-xs text-[#656A7C]">
                      No attributes match &ldquo;{attrFilter}&rdquo;.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {filteredAttributes.map((attr) => (
                        <div
                          key={attr.attributeId}
                          title={attr.description || attr.name}
                          className="px-3 py-2 rounded bg-[#08090D]/60 border border-[#262938]/80 flex items-center justify-between gap-3 text-xs"
                        >
                          <span className="text-[#9CA0B0] truncate">{attr.displayName}</span>
                          <span className="font-mono-num font-medium text-[#EFEAE0] shrink-0">
                            {attr.formattedValue}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#161923] border-t border-[#262938] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#9CA0B0]">
          <div className="flex items-center gap-2 font-mono-num">
            <span>EVE Online In-Game Data (ESI)</span>
            {gameInfo?.fetchedAt && (
              <span className="text-[#656A7C]">
                · {gameInfo.cached ? 'Cached' : 'Fetched'} {formatRelativeTime(gameInfo.fetchedAt)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <a
              href={`https://wiki.eveuniversity.org/Special:Search?search=${encodeURIComponent(
                displayName,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[#B298FF] hover:text-[#EFEAE0]"
            >
              <span>EVE Uni Wiki</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href={`https://everef.net/types/${activeTypeId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[#B298FF] hover:text-[#EFEAE0]"
            >
              <span>EVE Ref</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
