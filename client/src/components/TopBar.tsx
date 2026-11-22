import { useState } from 'react';
import {
  Activity,
  Bookmark,
  Database,
  History,
  ListOrdered,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  NLDF_CORP_ID,
  characterPortraitUrl,
  corporationLogoUrl,
  formatRelativeTime,
} from '../lib/format.ts';
import type { FeeConfig, MarketStats, SsoStatusResponse, SyncStatusResponse } from '../types/api.ts';

export type AppTab = 'scanner' | 'watchlist' | 'orders' | 'settings';

interface TopBarProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  stats: MarketStats | null;
  fees: FeeConfig;
  syncStatus: SyncStatusResponse | null;
  ssoStatus: SsoStatusResponse | null;
  undercutCount: number;
  onSyncOrders: () => void;
  onBackfillHistory: () => void;
  onAskNeon: () => void;
}

export function TopBar({
  activeTab,
  onTabChange,
  stats,
  fees,
  syncStatus,
  ssoStatus,
  undercutCount,
  onSyncOrders,
  onBackfillHistory,
  onAskNeon,
}: TopBarProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  const orderRunning = syncStatus?.orderSync.running ?? false;
  const sdeRunning = syncStatus?.sdeSync.running ?? false;
  const historyRunning = syncStatus?.historyBackfill.running ?? false;

  const orderProgressPct =
    syncStatus && syncStatus.orderSync.totalPages > 0
      ? Math.round((syncStatus.orderSync.pagesDone / syncStatus.orderSync.totalPages) * 100)
      : 0;

  const historyProgressPct =
    syncStatus && syncStatus.historyBackfill.total > 0
      ? Math.round((syncStatus.historyBackfill.done / syncStatus.historyBackfill.total) * 100)
      : 0;

  return (
    <header className="sticky top-0 z-30 border-b border-[#262938] bg-[#0F1118]/92 backdrop-blur-md">
      <div className="max-w-[1640px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand & Station Identity */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            title="Naval Defence Force [NLDF]"
            className="relative w-10 h-10 rounded-md bg-[#161923] border border-[#262938] overflow-hidden flex items-center justify-center shrink-0"
          >
            {logoFailed ? (
              <span className="font-mono-num text-[10px] font-bold tracking-wider text-[#B298FF]">
                NLDF
              </span>
            ) : (
              <img
                src={corporationLogoUrl(NLDF_CORP_ID, 128)}
                alt="Naval Defence Force [NLDF]"
                onError={() => setLogoFailed(true)}
                className="w-full h-full object-cover"
              />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-sm sm:text-base font-bold tracking-wider text-[#EFEAE0] truncate">
                JITA IV <span className="text-[#9B7BFF]">//</span> MONOLITH
              </h1>
              <span className="hidden md:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono-num tracking-widest uppercase bg-[#161923] text-[#9CA0B0] border border-[#262938]">
                CNAP 60003760
              </span>
            </div>
            <p className="text-[11px] font-mono-num text-[#656A7C] tracking-wide truncate">
              THE FORGE · STATION TRADE TELEMETRY
            </p>
          </div>
        </div>

        {/* Primary Navigation Tabs */}
        <nav className="flex items-center bg-[#08090D] p-1 rounded-lg border border-[#262938]">
          <button
            type="button"
            onClick={() => onTabChange('scanner')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'scanner'
                ? 'bg-[#9B7BFF]/20 text-[#EFEAE0] border border-[#9B7BFF]/45'
                : 'text-[#9CA0B0] hover:text-[#EFEAE0] border border-transparent'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-[#9B7BFF]" />
            <span>Scanner</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('watchlist')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'watchlist'
                ? 'bg-[#9B7BFF]/20 text-[#EFEAE0] border border-[#9B7BFF]/45'
                : 'text-[#9CA0B0] hover:text-[#EFEAE0] border border-transparent'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5 text-[#E07A63]" />
            <span>Watchlist</span>
            {stats && stats.watchlistCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-[#1D2130] text-[#EFEAE0] font-mono-num text-[10px]">
                {stats.watchlistCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onTabChange('orders')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'orders'
                ? 'bg-[#9B7BFF]/20 text-[#EFEAE0] border border-[#9B7BFF]/45'
                : 'text-[#9CA0B0] hover:text-[#EFEAE0] border border-transparent'
            }`}
          >
            <ListOrdered className="w-3.5 h-3.5 text-[#46E595]" />
            <span>My Orders</span>
            {undercutCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-[#FF4D6D]/20 text-[#FF4D6D] border border-[#FF4D6D]/40 font-mono-num text-[10px]">
                {undercutCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onTabChange('settings')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-[#9B7BFF]/20 text-[#EFEAE0] border border-[#9B7BFF]/45'
                : 'text-[#9CA0B0] hover:text-[#EFEAE0] border border-transparent'
            }`}
          >
            <Settings className="w-3.5 h-3.5 text-[#9CA0B0]" />
            <span>Settings</span>
          </button>
        </nav>

        {/* Right Status & Action Cluster */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Active Fee Pill */}
          <button
            type="button"
            onClick={() => onTabChange('settings')}
            title="Click to adjust broker fee, sales tax, or EVE skills"
            className="hidden xl:flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#161923] border border-[#262938] hover:border-[#9B7BFF]/50 transition-colors cursor-pointer"
          >
            <span className="text-[10px] font-mono-num uppercase tracking-wider text-[#656A7C]">
              FEES
            </span>
            <span className="text-xs font-mono-num text-[#EFEAE0]">
              {fees.brokerFeePct.toFixed(2)}% + {fees.salesTaxPct.toFixed(2)}%
            </span>
          </button>

          {/* Sync Status Pill */}
          <div className="hidden lg:flex flex-col items-end text-right px-2">
            {orderRunning || sdeRunning ? (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#9B7BFF] animate-pulse" />
                <span className="text-[11px] font-mono-num text-[#B298FF]">
                  {sdeRunning
                    ? `SDE: ${syncStatus?.sdeSync.stage.replace('_', ' ')}`
                    : syncStatus?.orderSync.totalPages
                      ? `Orders ${syncStatus.orderSync.pagesDone}/${syncStatus.orderSync.totalPages} (${orderProgressPct}%)`
                      : 'Starting sync...'}
                </span>
              </div>
            ) : historyRunning ? (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#46E595] animate-pulse" />
                <span className="text-[11px] font-mono-num text-[#46E595]">
                  History {syncStatus?.historyBackfill.done}/{syncStatus?.historyBackfill.total} (
                  {historyProgressPct}%)
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[11px] font-mono-num text-[#9CA0B0]">
                <Database className="w-3 h-3 text-[#656A7C]" />
                <span>Synced {formatRelativeTime(stats?.lastOrderSyncAt)}</span>
              </div>
            )}

            <span className="text-[10px] font-mono-num text-[#656A7C]">
              ESI Quota {syncStatus?.esiRate.errorLimitRemain ?? 100}/100
            </span>
          </div>

          {/* Backfill History Button */}
          <button
            type="button"
            onClick={onBackfillHistory}
            disabled={historyRunning || orderRunning || (stats?.twoSidedItems ?? 0) === 0}
            title="Fetch 30-day market history batch for active Jita items"
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[#161923] text-[#EFEAE0] border border-[#262938] hover:border-[#9B7BFF]/60 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <History className={`w-3.5 h-3.5 text-[#9B7BFF] ${historyRunning ? 'animate-spin' : ''}`} />
            <span>History</span>
          </button>

          {/* Ask Neon Advisor Button */}
          <button
            type="button"
            onClick={onAskNeon}
            title="Consult Neon LLM for top 3 session trade recommendations"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-[#9B7BFF]/18 text-[#EFEAE0] border border-[#9B7BFF]/60 hover:bg-[#9B7BFF]/30 transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#B298FF]" />
            <span>Ask Neon</span>
          </button>

          {/* Primary Sync Jita Button */}
          <button
            type="button"
            onClick={onSyncOrders}
            disabled={orderRunning || sdeRunning}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-[#9B7BFF] text-[#08090D] hover:bg-[#B298FF] disabled:opacity-55 disabled:cursor-not-allowed transition-colors shadow-sm cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${orderRunning || sdeRunning ? 'animate-spin' : ''}`} />
            <span>{orderRunning || sdeRunning ? 'Syncing...' : 'Sync Jita'}</span>
          </button>

          {/* Optional SSO Portrait / Connect Shortcut */}
          <button
            type="button"
            onClick={() => onTabChange('orders')}
            title={
              ssoStatus?.connected
                ? `Connected: ${ssoStatus.characterName}`
                : 'Connect optional EVE Online SSO'
            }
            className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-md bg-[#161923] border border-[#262938] hover:border-[#9B7BFF]/50 transition-colors cursor-pointer"
          >
            {ssoStatus?.connected && ssoStatus.characterId ? (
              <>
                <img
                  src={characterPortraitUrl(ssoStatus.characterId, 64)}
                  alt={ssoStatus.characterName}
                  className="w-6 h-6 rounded object-cover border border-[#46E595]/50"
                />
                <span className="hidden md:inline text-xs font-medium text-[#EFEAE0] max-w-[110px] truncate">
                  {ssoStatus.characterName}
                </span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4 text-[#656A7C]" />
                <span className="hidden md:inline text-xs text-[#9CA0B0]">SSO</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Live thin telemetry progress bar */}
      {(orderRunning || historyRunning || sdeRunning) && (
        <div className="h-[2px] w-full bg-[#161923] overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              orderRunning || sdeRunning ? 'bg-[#9B7BFF]' : 'bg-[#46E595]'
            }`}
            style={{
              width: `${
                orderRunning
                  ? Math.max(8, orderProgressPct)
                  : historyRunning
                    ? Math.max(8, historyProgressPct)
                    : 50
              }%`,
            }}
          />
        </div>
      )}
    </header>
  );
}
