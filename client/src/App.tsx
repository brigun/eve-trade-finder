import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { FilterBar } from './components/FilterBar.tsx';
import { ItemDrawer } from './components/ItemDrawer.tsx';
import { KpiRibbon } from './components/KpiRibbon.tsx';
import { MarketTable } from './components/MarketTable.tsx';
import { MyOrdersView } from './components/MyOrdersView.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { TopBar, type AppTab } from './components/TopBar.tsx';
import { WatchlistView } from './components/WatchlistView.tsx';
import { api } from './lib/api.ts';
import type {
  FeeConfig,
  FilterPreset,
  FilterState,
  MarketGroupTreeNode,
  MarketItem,
  MarketStats,
  SsoStatusResponse,
  SyncStatusResponse,
} from './types/api.ts';

const DEFAULT_FILTERS: FilterState = {
  q: '',
  minRoiPct: 5,
  maxRoiPct: null,
  minPrice: 50_000,
  maxPrice: null,
  priceField: 'buy',
  minNetProfit: null,
  minDailyIskVolume: null,
  minDailyUnits: null,
  maxCompetition: null,
  maxRecentUpdates1h: null,
  includeRootGroups: [],
  excludeRootGroups: ['Ship SKINs', 'Apparel', 'Blueprints & Reactions'],
  marketGroupId: null,
  trendingOnly: false,
  hideAnomalies: true,
  watchlistOnly: false,
  requireHistory: false,
  sortBy: 'estDailyProfit',
  sortDir: 'desc',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    return t === 'watchlist' || t === 'orders' || t === 'settings' ? t : 'scanner';
  });

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [activePresetName, setActivePresetName] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<MarketItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [avgRoiPct, setAvgRoiPct] = useState(0);
  const [fees, setFees] = useState<FeeConfig>({
    brokerFeePct: 3.0,
    salesTaxPct: 7.5,
    captureSharePct: 15,
  });
  const [loadingItems, setLoadingItems] = useState(true);

  const [stats, setStats] = useState<MarketStats | null>(null);
  const [groupTree, setGroupTree] = useState<MarketGroupTreeNode[]>([]);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null);
  const [ssoStatus, setSsoStatus] = useState<SsoStatusResponse | null>(null);
  const [undercutCount, setUndercutCount] = useState(0);

  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const wasRunningRef = useRef(false);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const loadMeta = useCallback(async () => {
    const [statsRes, groupsRes, presetsRes, syncRes, authRes] = await Promise.all([
      api.getMarketStats(),
      api.getMarketGroups(),
      api.getPresets(),
      api.getSyncStatus(),
      api.getAuthStatus(),
    ]);
    setStats(statsRes);
    setFees(statsRes.fees);
    setGroupTree(groupsRes.tree);
    setPresets(presetsRes.presets);
    setSyncStatus(syncRes);
    setSsoStatus(authRes);

    if (authRes.connected) {
      const charOrders = await api.getCharacterOrders();
      setUndercutCount(
        charOrders.orders.filter((o) => o.status === 'UNDERCUT' || o.status === 'OUTBID').length,
      );
    } else {
      setUndercutCount(0);
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const res = await api.getMarketItems(filters, page, 50);
      setItems(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
      setFees(res.fees);
      setAvgRoiPct(res.summaryStats.avgRoiPct);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load Jita market data');
    } finally {
      setLoadingItems(false);
    }
  }, [filters, page, notify]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadItems();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [loadItems]);

  // Poll sync progress cleanly while active (and slow refresh when idle)
  useEffect(() => {
    const running =
      Boolean(syncStatus?.orderSync.running) ||
      Boolean(syncStatus?.historyBackfill.running) ||
      Boolean(syncStatus?.sdeSync.running);

    if (wasRunningRef.current && !running) {
      void loadMeta();
      void loadItems();
    }
    wasRunningRef.current = running;

    const intervalMs = running ? 1500 : 15000;
    const id = window.setInterval(async () => {
      try {
        const next = await api.getSyncStatus();
        setSyncStatus(next);
      } catch {
        // ignore transient poll failures
      }
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [
    syncStatus?.orderSync.running,
    syncStatus?.historyBackfill.running,
    syncStatus?.sdeSync.running,
    loadMeta,
    loadItems,
  ]);

  const handleSyncOrders = async () => {
    try {
      setDismissedError(null);
      await api.triggerOrderSync();
      notify('Started Jita 4-4 order sync (persisting to SQLite)...');
      const next = await api.getSyncStatus();
      setSyncStatus(next);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Order sync failed to start');
    }
  };

  const handleBackfillHistory = async () => {
    try {
      await api.triggerHistoryBackfill(150);
      notify('Started 30-day market history backfill batch (150 priority items)...');
      const next = await api.getSyncStatus();
      setSyncStatus(next);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'History backfill failed to start');
    }
  };

  const handleTriggerSde = async () => {
    try {
      setDismissedError(null);
      await api.triggerSdeSync();
      notify('Started CCP official SDE static catalog refresh...');
      const next = await api.getSyncStatus();
      setSyncStatus(next);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'SDE sync failed');
    }
  };

  const handleFilterChange = (next: FilterState) => {
    setActivePresetName(null);
    setPage(1);
    setFilters(next);
  };

  const handleResetFilters = () => {
    setActivePresetName(null);
    setPage(1);
    setFilters(DEFAULT_FILTERS);
  };

  const handleApplyPreset = (preset: FilterPreset) => {
    setActivePresetName(preset.name);
    setPage(1);
    setFilters({
      ...DEFAULT_FILTERS,
      includeRootGroups: [],
      excludeRootGroups: [],
      ...preset.filters,
    });
  };

  const handleSavePreset = async (name: string) => {
    const res = await api.savePreset(name, filters);
    const list = await api.getPresets();
    setPresets(list.presets);
    setActivePresetName(res.preset.name);
    notify(`Saved preset "${res.preset.name}"`);
  };

  const handleDeletePreset = async (id: number) => {
    await api.deletePreset(id);
    const list = await api.getPresets();
    setPresets(list.presets);
    setActivePresetName(null);
    notify('Deleted preset');
  };

  const handleSort = (column: string) => {
    setPage(1);
    if (filters.sortBy === column) {
      setFilters({ ...filters, sortDir: filters.sortDir === 'desc' ? 'asc' : 'desc' });
    } else {
      setFilters({ ...filters, sortBy: column, sortDir: column === 'name' ? 'asc' : 'desc' });
    }
  };

  const handleToggleWatchlist = async (item: MarketItem) => {
    if (item.isWatchlisted) {
      await api.removeWatchlist(item.typeId);
      notify(`Removed ${item.name} from Watchlist`);
    } else {
      await api.upsertWatchlist({ typeId: item.typeId });
      notify(`Added ${item.name} to Watchlist`);
    }
    await Promise.all([loadMeta(), loadItems()]);
  };

  return (
    <div className="min-h-screen flex flex-col text-[#EFEAE0]">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        stats={stats}
        fees={fees}
        syncStatus={syncStatus}
        ssoStatus={ssoStatus}
        undercutCount={undercutCount}
        onSyncOrders={() => void handleSyncOrders()}
        onBackfillHistory={() => void handleBackfillHistory()}
      />

      <main className="flex-1 max-w-[1640px] w-full mx-auto px-4 sm:px-6 py-5 space-y-4">
        {activeTab === 'scanner' && (
          <>
            {(() => {
              const isRunning = Boolean(
                syncStatus?.orderSync.running || syncStatus?.sdeSync.running,
              );
              const syncErr = !isRunning
                ? syncStatus?.orderSync.lastError || syncStatus?.sdeSync.lastError || null
                : null;
              if (!syncErr || syncErr === dismissedError) return null;
              return (
                <div className="anomaly-hatch border border-[#FF4D6D]/55 rounded-md px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AlertTriangle className="w-4 h-4 text-[#FF4D6D] shrink-0" />
                    <div className="min-w-0">
                      <span className="text-[11px] font-mono-num uppercase tracking-wider text-[#FF4D6D] mr-2">
                        Sync Error
                      </span>
                      <span className="text-xs text-[#EFEAE0] break-all">{syncErr}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleSyncOrders()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#FF4D6D]/20 border border-[#FF4D6D]/50 hover:bg-[#FF4D6D]/30 text-xs font-medium text-[#EFEAE0] cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Retry Sync</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDismissedError(syncErr)}
                      aria-label="Dismiss sync error"
                      className="p-1 rounded text-[#9CA0B0] hover:text-[#EFEAE0] cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })()}

            <KpiRibbon
              stats={stats}
              matchedCount={total}
              avgRoiPct={avgRoiPct}
              trendingOnly={filters.trendingOnly}
              onToggleTrending={() =>
                handleFilterChange({ ...filters, trendingOnly: !filters.trendingOnly })
              }
            />

            <FilterBar
              filters={filters}
              presets={presets}
              groupTree={groupTree}
              activePresetName={activePresetName}
              onChange={handleFilterChange}
              onReset={handleResetFilters}
              onApplyPreset={handleApplyPreset}
              onSavePreset={handleSavePreset}
              onDeletePreset={handleDeletePreset}
            />

            <MarketTable
              items={items}
              total={total}
              page={page}
              pageSize={50}
              totalPages={totalPages}
              loading={loadingItems}
              hasAnyData={(stats?.totalJitaItems ?? 0) > 0}
              syncingOrders={Boolean(syncStatus?.orderSync.running || syncStatus?.sdeSync.running)}
              selectedTypeId={selectedTypeId}
              sortBy={filters.sortBy}
              sortDir={filters.sortDir}
              onSort={handleSort}
              onPageChange={setPage}
              onSelectItem={(item) => setSelectedTypeId(item.typeId)}
              onToggleWatchlist={(item) => void handleToggleWatchlist(item)}
              onSyncOrders={() => void handleSyncOrders()}
              onResetFilters={handleResetFilters}
            />
          </>
        )}

        {activeTab === 'watchlist' && (
          <WatchlistView
            onSelectTypeId={setSelectedTypeId}
            onWatchlistChanged={() => void Promise.all([loadMeta(), loadItems()])}
            onNotify={notify}
          />
        )}

        {activeTab === 'orders' && (
          <MyOrdersView
            ssoStatus={ssoStatus}
            onRefreshAuth={loadMeta}
            onSelectTypeId={setSelectedTypeId}
            onNotify={notify}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            syncStatus={syncStatus}
            onSettingsUpdated={async () => {
              await Promise.all([loadMeta(), loadItems()]);
            }}
            onTriggerSde={() => void handleTriggerSde()}
            onTriggerBackfill={() => void handleBackfillHistory()}
            onNotify={notify}
          />
        )}
      </main>

      <ItemDrawer
        typeId={selectedTypeId}
        onClose={() => setSelectedTypeId(null)}
        onWatchlistChanged={() => void Promise.all([loadMeta(), loadItems()])}
        onNotify={notify}
      />

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-md bg-[#161923] border border-[#9B7BFF]/60 shadow-xl text-xs font-mono-num text-[#EFEAE0]">
          {toast}
        </div>
      )}
    </div>
  );
}
