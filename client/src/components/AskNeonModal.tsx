import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Copy,
  ExternalLink,
  RefreshCw,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  formatIskCompact,
  formatIskExact,
  formatPct,
  formatRelativeTime,
  parseIskShorthand,
} from '../lib/format.ts';
import { getHubMeta } from '../lib/hubs.ts';
import type {
  HubId,
  LlmModelOption,
  LlmThinkingLevel,
  NeonAdvisorStatus,
  NeonBriefingResponse,
  NeonSessionStyle,
} from '../types/api.ts';
import { ItemIcon } from './ItemIcon.tsx';

interface AskNeonModalProps {
  open: boolean;
  activeHub: HubId;
  minRoiPct: number | null;
  marketGroupId: number | null;
  marketGroupIds: number[];
  onClose: () => void;
  onSelectTypeId: (typeId: number) => void;
  onOpenSettings: () => void;
  onNotify: (msg: string) => void;
}

const SESSION_STYLES: Array<{
  id: NeonSessionStyle;
  label: string;
  hint: string;
}> = [
  { id: 'quick_flip', label: 'Quick Flip', hint: 'Fast velocity & lower undercut churn' },
  { id: 'balanced', label: 'Balanced', hint: 'Best composite Trade Score' },
  { id: 'overnight', label: 'Overnight', hint: 'Higher ROI & deeper order books' },
];

export function AskNeonModal({
  open,
  activeHub,
  minRoiPct,
  marketGroupId,
  marketGroupIds,
  onClose,
  onSelectTypeId,
  onOpenSettings,
  onNotify,
}: AskNeonModalProps) {
  const hubMeta = getHubMeta(activeHub);
  const [status, setStatus] = useState<NeonAdvisorStatus | null>(null);
  const [models, setModels] = useState<LlmModelOption[]>([]);
  const [modelsSource, setModelsSource] = useState<'live' | 'fallback'>('fallback');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [customModelMode, setCustomModelMode] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<LlmThinkingLevel>('MEDIUM');
  const [briefing, setBriefing] = useState<NeonBriefingResponse | null>(null);
  const [sessionStyle, setSessionStyle] = useState<NeonSessionStyle>('balanced');
  const [budgetText, setBudgetText] = useState('');
  const [userNote, setUserNote] = useState('');
  const [asking, setAsking] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!asking) {
      setElapsedSec(0);
      return;
    }
    const id = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [asking]);

  const loadModels = async () => {
    setLoadingModels(true);
    try {
      const mRes = await api.getAdvisorModels();
      setModels(mRes.models);
      setModelsSource(mRes.source);
      setSelectedModel((prev) => prev || mRes.activeModel);
    } catch {
      // ignore transient model fetch failure
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCustomModelMode(false);
    void Promise.all([api.getAdvisorStatus(), api.getAdvisorModels(), api.getLatestBriefing()])
      .then(([statusRes, modelsRes, latestRes]) => {
        setStatus(statusRes);
        setModels(modelsRes.models);
        setModelsSource(modelsRes.source);
        setSelectedModel(statusRes.model);
        setThinkingLevel(statusRes.thinkingLevel ?? 'MEDIUM');
        if (latestRes.briefing) {
          setBriefing(latestRes.briefing);
        }
      })
      .catch(() => {
        // ignore transient open fetch error
      });
  }, [open]);

  if (!open) return null;

  const effectiveMinRoi = minRoiPct ?? 10;

  const handleSelectModel = async (nextModel: string) => {
    setSelectedModel(nextModel);
    if (!nextModel.trim()) return;
    try {
      const res = await api.updateSettings({ llmModel: nextModel.trim() });
      setStatus((prev) => (prev ? { ...prev, model: res.settings.llmModel } : prev));
    } catch {
      // keep local override even if settings save fails
    }
  };

  const handleSelectThinkingLevel = async (nextLevel: LlmThinkingLevel) => {
    setThinkingLevel(nextLevel);
    try {
      await api.updateSettings({ llmThinkingLevel: nextLevel });
    } catch {
      // keep local choice
    }
  };

  const handleConsult = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setAsking(true);
    setError(null);
    try {
      const budgetIsk = parseIskShorthand(budgetText);
      const res = await api.askNeon({
        hubId: activeHub,
        budgetIsk,
        sessionStyle,
        userNote: userNote.trim(),
        minRoiPct: effectiveMinRoi,
        marketGroupId,
        marketGroupIds,
        model: selectedModel.trim() || undefined,
        thinkingLevel: status?.provider === 'gemini' ? thinkingLevel : undefined,
      });
      setBriefing(res.briefing);
      onNotify(`Neon (${res.briefing.model}) returned top 3 picks`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to consult Neon');
    } finally {
      setAsking(false);
    }
  };

  const copyTick = async (label: string, val: number) => {
    try {
      await navigator.clipboard.writeText(String(val));
      onNotify(`Copied ${label}: ${formatIskExact(val)}`);
    } catch {
      onNotify(`Value: ${formatIskExact(val)}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-[#08090D]/80 backdrop-blur-xs">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative z-10 w-full max-w-4xl max-h-[90vh] bg-[#0F1118] border border-[#262938] rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-[#161923] border-b border-[#262938] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded bg-[#9B7BFF]/18 border border-[#9B7BFF]/45 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-[#B298FF]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display text-sm sm:text-base font-bold tracking-wide text-[#EFEAE0]">
                  ASK NEON <span className="text-[#9B7BFF]">//</span> SESSION ADVISOR
                </h2>
                {status && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded bg-[#08090D] border border-[#262938] font-mono-num text-[10px] uppercase text-[#9CA0B0]">
                      {status.provider === 'gemini' ? 'GEMINI' : 'COMPAT'}
                    </span>
                    {customModelMode ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          setCustomModelMode(false);
                          void handleSelectModel(selectedModel);
                        }}
                        className="flex items-center gap-1"
                      >
                        <input
                          type="text"
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                          placeholder="Custom model ID..."
                          autoFocus
                          className="px-2 py-0.5 rounded bg-[#08090D] border border-[#9B7BFF] font-mono-num text-[11px] text-[#EFEAE0] w-44 focus:outline-none"
                        />
                        <button
                          type="submit"
                          className="px-2 py-0.5 rounded bg-[#9B7BFF] text-[#08090D] text-[10px] font-semibold cursor-pointer"
                        >
                          Use
                        </button>
                      </form>
                    ) : (
                      <select
                        aria-label="Select Neon LLM Model"
                        value={selectedModel}
                        onChange={(e) => {
                          if (e.target.value === '__custom__') {
                            setCustomModelMode(true);
                            return;
                          }
                          void handleSelectModel(e.target.value);
                        }}
                        className="px-2 py-0.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-[11px] text-[#EFEAE0] max-w-[230px]"
                      >
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.displayName !== m.id ? `${m.displayName} (${m.id})` : m.id}
                          </option>
                        ))}
                        <option value="__custom__">+ Enter custom model ID...</option>
                      </select>
                    )}
                    <button
                      type="button"
                      onClick={() => void loadModels()}
                      disabled={loadingModels}
                      title={`Refresh available models (${modelsSource})`}
                      className="p-1 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] text-[#9CA0B0] hover:text-[#EFEAE0] cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${loadingModels ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-[#9CA0B0] truncate">
                Top 3 grounded {hubMeta.name} trades scored by price, book depth, volume, and active traders
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
              title="Configure LLM API Key & Model"
              className="p-1.5 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] text-[#9CA0B0] hover:text-[#EFEAE0] cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Ask Neon modal"
              className="p-1.5 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] text-[#9CA0B0] hover:text-[#EFEAE0] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Missing API Key Banner */}
          {status && !status.configured && (
            <div className="anomaly-hatch border border-[#FF4D6D]/50 rounded-md px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs text-[#EFEAE0]">
                <AlertTriangle className="w-4 h-4 text-[#FF4D6D] shrink-0" />
                <span>
                  Gemini API key is not set. Add your key in Settings (or switch to a local Ollama
                  endpoint) to consult Neon.
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="px-3 py-1 rounded bg-[#9B7BFF] text-[#08090D] text-xs font-semibold hover:bg-[#B298FF] cursor-pointer"
              >
                Open LLM Settings
              </button>
            </div>
          )}

          {/* Session Prompt Controls */}
          <form
            onSubmit={(e) => void handleConsult(e)}
            className="bg-[#161923] border border-[#262938] rounded-md p-3.5 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#656A7C] mr-1">
                  Session Style:
                </span>
                {SESSION_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    title={s.hint}
                    onClick={() => setSessionStyle(s.id)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors cursor-pointer ${
                      sessionStyle === s.id
                        ? 'bg-[#9B7BFF]/22 text-[#EFEAE0] border-[#9B7BFF]/60'
                        : 'bg-[#08090D] text-[#9CA0B0] border-[#262938] hover:text-[#EFEAE0]'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 text-[10px] font-mono-num text-[#9CA0B0] flex-wrap">
                {status?.provider === 'gemini' && (
                  <div className="inline-flex items-center gap-1 bg-[#08090D] border border-[#262938] rounded p-0.5">
                    <span className="px-1.5 text-[#656A7C]">THINK</span>
                    {(['LOW', 'MEDIUM', 'HIGH'] as const).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => void handleSelectThinkingLevel(lvl)}
                        className={`px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                          thinkingLevel === lvl
                            ? 'bg-[#9B7BFF]/25 text-[#EFEAE0] font-semibold'
                            : 'text-[#656A7C] hover:text-[#EFEAE0]'
                        }`}
                      >
                        {lvl === 'MEDIUM' ? 'MED' : lvl}
                      </button>
                    ))}
                  </div>
                )}
                <span className="px-2 py-0.5 rounded bg-[#08090D] border border-[#262938]">
                  Min ROI {effectiveMinRoi}%
                </span>
                {(marketGroupId !== null || marketGroupIds.length > 0) && (
                  <span className="px-2 py-0.5 rounded bg-[#9B7BFF]/15 border border-[#9B7BFF]/40 text-[#B298FF]">
                    Segment Scoped
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
              <label className="sm:col-span-3 flex flex-col gap-1">
                <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#656A7C]">
                  Session Budget (Optional)
                </span>
                <input
                  type="text"
                  value={budgetText}
                  onChange={(e) => setBudgetText(e.target.value)}
                  placeholder="e.g. 250m or 1b"
                  className="px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-xs text-[#EFEAE0] placeholder:text-[#656A7C]/70"
                />
              </label>

              <label className="sm:col-span-6 flex flex-col gap-1">
                <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#656A7C]">
                  Trading Goal / Constraints (Optional)
                </span>
                <input
                  type="text"
                  value={userNote}
                  onChange={(e) => setUserNote(e.target.value)}
                  placeholder="e.g. Fast turnover for 1 hour, avoid ultra-expensive hulls"
                  className="px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none text-xs text-[#EFEAE0] placeholder:text-[#656A7C]/70"
                />
              </label>

              <div className="sm:col-span-3">
                <button
                  type="submit"
                  disabled={asking}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded bg-[#9B7BFF] text-[#08090D] font-semibold text-xs hover:bg-[#B298FF] disabled:opacity-55 disabled:cursor-not-allowed transition-colors cursor-pointer h-[30px]"
                >
                  {asking ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Consulting ({elapsedSec}s)...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Consult Neon</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>

          {/* Error Display */}
          {error && (
            <div className="anomaly-hatch border border-[#FF4D6D]/55 rounded-md px-4 py-2.5 text-xs text-[#EFEAE0] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#FF4D6D] shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Briefing Output */}
          {briefing ? (
            <div className="space-y-3.5">
              {/* Session Summary Card */}
              <div className="corner-frame bg-[#161923] border border-[#262938] rounded-md p-3.5 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono-num uppercase tracking-wider text-[#9CA0B0]">
                  <span className="text-[#46E595]">
                    Briefing · {briefing.scopeLabel} · {briefing.sessionStyle.replace('_', ' ')}
                  </span>
                  <span>
                    {formatRelativeTime(briefing.createdAt)} · {briefing.model} ·{' '}
                    {briefing.candidateCount} candidates analyzed
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-[#EFEAE0] leading-relaxed">
                  {briefing.sessionSummary}
                </p>
              </div>

              {/* Top 3 Picks */}
              <div className="space-y-3">
                {briefing.recommendations.map((pick) => (
                  <div
                    key={pick.typeId}
                    className="bg-[#161923]/90 border border-[#262938] hover:border-[#9B7BFF]/45 rounded-md p-4 space-y-3 transition-colors"
                  >
                    {/* Pick Header */}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-7 h-7 rounded bg-[#9B7BFF]/18 border border-[#9B7BFF]/45 flex items-center justify-center font-mono-num text-xs font-bold text-[#B298FF] shrink-0">
                          #{pick.rank}
                        </span>
                        <ItemIcon
                          typeId={pick.typeId}
                          name={pick.item.name}
                          size={32}
                          className="w-9 h-9"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-display text-sm font-bold text-[#EFEAE0]">
                              {pick.item.name}
                            </h3>
                            <span className="px-1.5 py-0.5 rounded bg-[#46E595]/15 text-[#46E595] border border-[#46E595]/35 font-mono-num text-[10px] font-semibold">
                              {formatPct(pick.item.roiPct)} ROI
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-[#9B7BFF]/15 text-[#B298FF] border border-[#9B7BFF]/35 font-mono-num text-[10px] font-semibold">
                              Score {pick.item.tradeScore.toFixed(1)}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#9CA0B0]">
                            <span className="text-[#E07A63] font-medium">{pick.headline}</span>
                            <span className="text-[#656A7C]"> · {pick.item.rootGroupName}</span>
                          </div>
                        </div>
                      </div>

                      {/* Quick Action Buttons */}
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void copyTick('Buy +1T', pick.outbidBuyPrice)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#08090D] border border-[#262938] hover:border-[#46E595] font-mono-num text-[11px] text-[#EFEAE0] cursor-pointer"
                        >
                          <Copy className="w-3 h-3 text-[#46E595]" />
                          <span>Buy {formatIskCompact(pick.outbidBuyPrice, false)}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyTick('Sell -1T', pick.undercutSellPrice)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#08090D] border border-[#262938] hover:border-[#9B7BFF] font-mono-num text-[11px] text-[#EFEAE0] cursor-pointer"
                        >
                          <Copy className="w-3 h-3 text-[#9B7BFF]" />
                          <span>Sell {formatIskCompact(pick.undercutSellPrice, false)}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onSelectTypeId(pick.typeId);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#9B7BFF]/20 border border-[#9B7BFF]/50 hover:bg-[#9B7BFF]/30 text-[11px] font-medium text-[#EFEAE0] cursor-pointer"
                        >
                          <ExternalLink className="w-3 h-3 text-[#B298FF]" />
                          <span>Inspect</span>
                        </button>
                      </div>
                    </div>

                    {/* Quantitative Strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 py-2 px-2.5 rounded bg-[#08090D]/80 border border-[#262938] font-mono-num text-[11px]">
                      <div>
                        <span className="block text-[9px] uppercase text-[#656A7C]">
                          Suggested Qty
                        </span>
                        <span className="text-[#EFEAE0] font-semibold">
                          {pick.suggestedQty.toLocaleString()} units
                        </span>
                      </div>
                      <div>
                        <span className="block text-[9px] uppercase text-[#656A7C]">
                          Est. Capital
                        </span>
                        <span className="text-[#EFEAE0]">
                          {formatIskCompact(pick.estimatedCapitalIsk, false)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[9px] uppercase text-[#656A7C]">
                          Est. Batch Profit
                        </span>
                        <span className="text-[#46E595] font-semibold">
                          {formatIskCompact(pick.estimatedNetProfitIsk, false)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[9px] uppercase text-[#656A7C]">
                          Book Depth
                        </span>
                        <span className="text-[#9CA0B0]">
                          {formatIskCompact(pick.item.bookDepthIsk, false)} (
                          {pick.item.buyOrderCount}B/{pick.item.sellOrderCount}S)
                        </span>
                      </div>
                      <div>
                        <span className="block text-[9px] uppercase text-[#656A7C]">
                          Active Traders
                        </span>
                        <span className="text-[#9CA0B0]">
                          {pick.item.totalCompetition} (2%) · {pick.item.recentUpdates1h}/1h
                        </span>
                      </div>
                    </div>

                    {/* Rationale, Execution & Risk */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
                      <div className="space-y-0.5">
                        <div className="text-[10px] font-mono-num uppercase tracking-wider text-[#9B7BFF]">
                          Why It Scores High
                        </div>
                        <p className="text-[#EFEAE0]/90 leading-relaxed">{pick.rationale}</p>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-[10px] font-mono-num uppercase tracking-wider text-[#46E595]">
                          Execution Plan
                        </div>
                        <p className="text-[#9CA0B0] leading-relaxed">{pick.executionPlan}</p>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-[10px] font-mono-num uppercase tracking-wider text-[#FF4D6D]">
                          Risk Watch
                        </div>
                        <p className="text-[#9CA0B0] leading-relaxed">{pick.riskNote}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-10 text-center space-y-2 border border-dashed border-[#262938] rounded-md">
              <Sparkles className="w-6 h-6 text-[#9B7BFF] mx-auto" />
              <p className="text-xs text-[#EFEAE0] font-medium">
                Ready to analyze {hubMeta.name} opportunities for your session
              </p>
              <p className="text-[11px] text-[#656A7C] max-w-md mx-auto">
                Choose a session style (and optional ISK budget), then click{' '}
                <span className="text-[#B298FF]">Consult Neon</span> to receive your top 3 tailored
                trades.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
