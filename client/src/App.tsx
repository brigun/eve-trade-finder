import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { ArbitrageView } from './components/ArbitrageView.tsx';
import { AskNeonModal } from './components/AskNeonModal.tsx';
import { FilterBar } from './components/FilterBar.tsx';
import { ItemDrawer } from './components/ItemDrawer.tsx';
import { KpiRibbon } from './components/KpiRibbon.tsx';
import { MarketTable } from './components/MarketTable.tsx';
import { MyOrdersView } from './components/MyOrdersView.tsx';
import { RecommendedTradeCard } from './components/RecommendedTradeCard.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { TopBar, type AppTab } from './components/TopBar.tsx';
import { UpdateBanner } from './components/UpdateBanner.tsx';
import { WatchlistView } from './components/WatchlistView.tsx';
import { api } from './lib/api.ts';
import { getHubMeta, isValidHubId } from './lib/hubs.ts';
import type {
  FeeConfig,
  FilterFailure,
  FilterKey,
  FilterPreset,
  FilterState,
  HubId,
  LookupMarketItem,
  MarketGroupTreeNode,
  MarketItem,
  MarketStats,
  RecommendedTradesResponse,
  SsoStatusResponse,
  SyncStatusResponse,
  UpdateCheckResponse,
} from './types/api.ts';

const SKIPPED_UPDATE_STORAGE_KEY = 'jitaMonolith.skippedUpdateVersion';
const STARTUP_UPDATE_DELAY_MS = 4_000;
const UPDATE_RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const DEFAULT_FILTERS: FilterState = {
  q: '',
  minRoiPct: 10,
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
  marketGroupIds: [],
  trendingOnly: false,
  hideAnomalies: true,
  watchlistOnly: false,
  requireHistory: false,
  sortBy: 'tradeScore',
  sortDir: 'desc',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    return t === 'arbitrage' || t === 'watchlist' || t === 'orders' || t === 'settings'
      ? t
      : 'scanner';
  });

  const [activeHub, setActiveHub] = useState<HubId>(() => {
    const params = new URLSearchParams(window.location.search);
    const h = params.get('hub');
    if (isValidHubId(h)) return h;
    try {
      const saved = window.localStorage.getItem('jitaMonolith.activeHub');
      if (isValidHubId(saved)) return saved;
    } catch {
      // ignore storage failure
    }
    return 'jita';
  });

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [activePresetName, setActivePresetName] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<MarketItem[]>([]);
  const [filteredOutMatches, setFilteredOutMatches] = useState<LookupMarketItem[]>([]);
  const [filteredOutTotal, setFilteredOutTotal] = useState(0);
  const [excludedByQuickExcludesCount, setExcludedByQuickExcludesCount] = useState(0);
  const [excludedByQuickExcludeGroups, setExcludedByQuickExcludeGroups] = useState<string[]>([]);
  const [hoveredLookupTypeId, setHoveredLookupTypeId] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [avgRoiPct, setAvgRoiPct] = useState(0);
  const [fees, setFees] = useState<FeeConfig>({
    brokerFeePct: 3.0,
    salesTaxPct: 7.5,
    captureSharePct: 15,
  });
  const [loadingItems, setLoadingItems] = useState(true);
  const [recommended, setRecommended] = useState<RecommendedTradesResponse | null>(null);
  const [loadingRecommended, setLoadingRecommended] = useState(true);

  const [stats, setStats] = useState<MarketStats | null>(null);
  const [groupTree, setGroupTree] = useState<MarketGroupTreeNode[]>([]);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null);
  const [ssoStatus, setSsoStatus] = useState<SsoStatusResponse | null>(null);
  const [undercutCount, setUndercutCount] = useState(0);

  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [drawerHubId, setDrawerHubId] = useState<HubId | null>(null);
  const [askNeonOpen, setAskNeonOpen] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResponse | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null);
  const [skippedUpdateVersion, setSkippedUpdateVersion] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(SKIPPED_UPDATE_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const wasRunningRef = useRef(false);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const openItemDrawer = useCallback((typeId: number, hubOverride?: HubId) => {
    setSelectedTypeId(typeId);
    setDrawerHubId(hubOverride ?? null);
  }, []);

  const handleHubChange = useCallback((nextHub: HubId) => {
    setActiveHub(nextHub);
    setPage(1);
    setHoveredLookupTypeId(null);
    try {
      window.localStorage.setItem('jitaMonolith.activeHub', nextHub);
    } catch {
      // ignore storage failure
    }
    void api.updateSettings({ activeHub: nextHub }).catch(() => {});
  }, []);

  const loadMeta = useCallback(async () => {
    const [statsRes, groupsRes, presetsRes, syncRes, authRes] = await Promise.all([
      api.getMarketStats(activeHub),
      api.getMarketGroups(activeHub),
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
      const charOrders = await api.getCharacterOrders('all');
      setUndercutCount(
        charOrders.orders.filter((o) => o.status === 'UNDERCUT' || o.status === 'OUTBID').length,
      );
    } else {
      setUndercutCount(0);
    }
  }, [activeHub]);

  const loadItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const res = await api.getMarketItems(filters, page, 50, activeHub);
      setItems(res.items);
      setFilteredOutMatches(res.filteredOutMatches ?? []);
      setFilteredOutTotal(res.filteredOutTotal ?? 0);
      setExcludedByQuickExcludesCount(res.excludedByQuickExcludesCount ?? 0);
      setExcludedByQuickExcludeGroups(res.excludedByQuickExcludeGroups ?? []);
      setTotal(res.total);
      setTotalPages(res.totalPages);
      setFees(res.fees);
      setAvgRoiPct(res.summaryStats.avgRoiPct);
    } catch (err) {
      notify(err instanceof Error ? err.message : `Failed to load ${getHubMeta(activeHub).name} market data`);
    } finally {
      setLoadingItems(false);
    }
  }, [filters, page, activeHub, notify]);

  const loadRecommended = useCallback(async () => {
    setLoadingRecommended(true);
    try {
      const res = await api.getRecommendedTrades({
        hubId: activeHub,
        minRoiPct: filters.minRoiPct ?? 10,
        marketGroupId: filters.marketGroupId,
        marketGroupIds: filters.marketGroupIds,
      });
      setRecommended(res);
    } catch {
      // keep existing recommendation on transient fetch error
    } finally {
      setLoadingRecommended(false);
    }
  }, [activeHub, filters.minRoiPct, filters.marketGroupId, filters.marketGroupIds]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadItems();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [loadItems]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRecommended();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [loadRecommended]);

  // Poll sync progress cleanly while active (and slow refresh when idle)
  useEffect(() => {
    const running =
      Boolean(syncStatus?.orderSync.running) ||
      Boolean(syncStatus?.historyBackfill.running) ||
      Boolean(syncStatus?.sdeSync.running);

    if (wasRunningRef.current && !running) {
      void loadMeta();
      void loadItems();
      void loadRecommended();
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
    loadRecommended,
  ]);

  const runUpdateCheck = useCallback(
    async (manual: boolean) => {
      setCheckingUpdates(true);
      try {
        const res = await api.checkForUpdates(manual);
        setUpdateInfo(res);
        if (manual) {
          if (res.status === 'error') {
            notify(res.error ? `Update check failed: ${res.error}` : 'Update check failed');
          } else if (res.updateAvailable && res.latestVersion) {
            setDismissedUpdateVersion(null);
            notify(`Update available: v${res.latestVersion}`);
          } else {
            notify(`You're up to date (v${res.currentVersion})`);
          }
        }
      } catch (err) {
        if (manual) {
          notify(err instanceof Error ? err.message : 'Update check failed');
        }
      } finally {
        setCheckingUpdates(false);
      }
    },
    [notify],
  );

  useEffect(() => {
    const startupTimer = window.setTimeout(() => {
      void runUpdateCheck(false);
    }, STARTUP_UPDATE_DELAY_MS);
    const intervalId = window.setInterval(() => {
      void runUpdateCheck(false);
    }, UPDATE_RECHECK_INTERVAL_MS);

    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(intervalId);
    };
  }, [runUpdateCheck]);

  const handleSkipUpdateVersion = useCallback(
    (version: string) => {
      try {
        window.localStorage.setItem(SKIPPED_UPDATE_STORAGE_KEY, version);
      } catch {
        // ignore storage failure
      }
      setSkippedUpdateVersion(version);
      notify(`Skipped update v${version} — you can still check in Settings`);
    },
    [notify],
  );

  const handleClearSkippedUpdate = useCallback(() => {
    try {
      window.localStorage.removeItem(SKIPPED_UPDATE_STORAGE_KEY);
    } catch {
      // ignore storage failure
    }
    setSkippedUpdateVersion(null);
    setDismissedUpdateVersion(null);
  }, []);

  const handleSyncOrders = async () => {
    try {
      setDismissedError(null);
      await api.triggerOrderSync(activeHub);
      notify(`Started ${getHubMeta(activeHub).name} order sync (persisting to SQLite)...`);
      const next = await api.getSyncStatus();
      setSyncStatus(next);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Order sync failed to start');
    }
  };

  const handleSyncAllHubs = async () => {
    try {
      setDismissedError(null);
      await api.triggerAllHubsSync();
      notify('Started syncing all 6 trade hubs (Jita, Amarr, Dodixie, Rens, Hek, Amamake)...');
      const next = await api.getSyncStatus();
      setSyncStatus(next);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Multi-hub sync failed to start');
    }
  };

  const handleBackfillHistory = async () => {
    try {
      await api.triggerHistoryBackfill(150, activeHub);
      notify(
        `Started 30-day ${getHubMeta(activeHub).regionName} history backfill batch (150 items)...`,
      );
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
    if (next.q !== filters.q) {
      setHoveredLookupTypeId(null);
    }
    setFilters(next);
  };

  const handleResetFilters = () => {
    setActivePresetName(null);
    setHoveredLookupTypeId(null);
    setPage(1);
    setFilters(DEFAULT_FILTERS);
  };

  const handleRelaxFilter = (failure: FilterFailure) => {
    setActivePresetName(null);
    setPage(1);
    setFilters((prev) => {
      switch (failure.key) {
        case 'minRoiPct':
          return { ...prev, minRoiPct: null };
        case 'maxRoiPct':
          return { ...prev, maxRoiPct: null };
        case 'minPrice':
          return { ...prev, minPrice: null };
        case 'maxPrice':
          return { ...prev, maxPrice: null };
        case 'minNetProfit':
          return { ...prev, minNetProfit: null };
        case 'minDailyIskVolume':
          return { ...prev, minDailyIskVolume: null };
        case 'minDailyUnits':
          return { ...prev, minDailyUnits: null };
        case 'maxCompetition':
          return { ...prev, maxCompetition: null };
        case 'maxRecentUpdates1h':
          return { ...prev, maxRecentUpdates1h: null };
        case 'trendingOnly':
          return { ...prev, trendingOnly: false };
        case 'hideAnomalies':
          return { ...prev, hideAnomalies: false };
        case 'watchlistOnly':
          return { ...prev, watchlistOnly: false };
        case 'requireHistory':
          return { ...prev, requireHistory: false };
        case 'marketGroup':
          return { ...prev, marketGroupId: null, marketGroupIds: [] };
        case 'includeRootGroups':
          return { ...prev, includeRootGroups: [] };
        case 'excludeRootGroups':
          return {
            ...prev,
            excludeRootGroups: failure.excludedGroup
              ? prev.excludeRootGroups.filter((g) => g !== failure.excludedGroup)
              : [],
          };
        default:
          return prev;
      }
    });
  };

  const activeLookupFocus = useMemo<LookupMarketItem | null>(() => {
    if (!filters.q.trim() || filteredOutMatches.length === 0) return null;
    if (hoveredLookupTypeId !== null) {
      const hovered = filteredOutMatches.find((m) => m.typeId === hoveredLookupTypeId);
      if (hovered) return hovered;
    }
    return items.length === 0 ? filteredOutMatches[0] : null;
  }, [filters.q, filteredOutMatches, hoveredLookupTypeId, items.length]);

  const { breakingFilterKeys, breakingExcludedGroups, breakingFilterReasons } = useMemo(() => {
    const keys = new Set<FilterKey>();
    const excluded = new Set<string>();
    const reasons = new Map<FilterKey, string>();
    if (activeLookupFocus) {
      for (const f of activeLookupFocus.failedFilters) {
        keys.add(f.key);
        if (!reasons.has(f.key)) {
          reasons.set(f.key, f.reason);
        }
        if (f.excludedGroup) {
          excluded.add(f.excludedGroup);
        }
      }
    } else if (
      filters.q.trim() &&
      items.length === 0 &&
      filteredOutMatches.length === 0 &&
      excludedByQuickExcludeGroups.length > 0
    ) {
      keys.add('excludeRootGroups');
      reasons.set(
        'excludeRootGroups',
        `Hiding ${excludedByQuickExcludesCount} search match(es)`,
      );
      for (const grp of excludedByQuickExcludeGroups) {
        excluded.add(grp);
      }
    }
    return {
      breakingFilterKeys: keys,
      breakingExcludedGroups: excluded,
      breakingFilterReasons: reasons,
    };
  }, [
    activeLookupFocus,
    filters.q,
    items.length,
    filteredOutMatches.length,
    excludedByQuickExcludesCount,
    excludedByQuickExcludeGroups,
  ]);

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
    const hubMeta = getHubMeta(activeHub);
    if (item.isWatchlisted) {
      await api.removeWatchlist(item.typeId, activeHub);
      notify(`Removed ${item.name} from ${hubMeta.shortName} Watchlist`);
    } else {
      await api.upsertWatchlist({ typeId: item.typeId }, activeHub);
      notify(`Added ${item.name} to ${hubMeta.shortName} Watchlist`);
    }
    await Promise.all([loadMeta(), loadItems()]);
  };

  return (
    <div className="min-h-screen flex flex-col text-[#EFEAE0]">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        activeHub={activeHub}
        onHubChange={handleHubChange}
        stats={stats}
        fees={fees}
        syncStatus={syncStatus}
        ssoStatus={ssoStatus}
        undercutCount={undercutCount}
        onSyncOrders={() => void handleSyncOrders()}
        onSyncAllHubs={() => void handleSyncAllHubs()}
        onBackfillHistory={() => void handleBackfillHistory()}
        onAskNeon={() => setAskNeonOpen(true)}
      />

      <main className="flex-1 max-w-[1640px] w-full mx-auto px-4 sm:px-6 py-5 space-y-4">
        {updateInfo?.status === 'ok' &&
          updateInfo.updateAvailable &&
          updateInfo.latestVersion &&
          updateInfo.latestVersion !== skippedUpdateVersion &&
          updateInfo.latestVersion !== dismissedUpdateVersion && (
            <UpdateBanner
              updateInfo={updateInfo}
              onDismissSession={() => setDismissedUpdateVersion(updateInfo.latestVersion)}
              onSkipVersion={handleSkipUpdateVersion}
            />
          )}

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
              activeHub={activeHub}
              stats={stats}
              matchedCount={total}
              avgRoiPct={avgRoiPct}
              trendingOnly={filters.trendingOnly}
              onToggleTrending={() =>
                handleFilterChange({ ...filters, trendingOnly: !filters.trendingOnly })
              }
            />

            <RecommendedTradeCard
              activeHub={activeHub}
              recommended={recommended}
              loading={loadingRecommended}
              onSelectItem={(item) => openItemDrawer(item.typeId)}
              onAskNeon={() => setAskNeonOpen(true)}
              onNotify={notify}
            />

            <FilterBar
              activeHub={activeHub}
              filters={filters}
              presets={presets}
              groupTree={groupTree}
              activePresetName={activePresetName}
              breakingFilterKeys={breakingFilterKeys}
              breakingExcludedGroups={breakingExcludedGroups}
              breakingFilterReasons={breakingFilterReasons}
              lookupFocusName={activeLookupFocus?.name ?? null}
              onChange={handleFilterChange}
              onReset={handleResetFilters}
              onApplyPreset={handleApplyPreset}
              onSavePreset={handleSavePreset}
              onDeletePreset={handleDeletePreset}
            />

            <MarketTable
              activeHub={activeHub}
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
              searchQuery={filters.q}
              filteredOutMatches={filteredOutMatches}
              filteredOutTotal={filteredOutTotal}
              excludedByQuickExcludesCount={excludedByQuickExcludesCount}
              excludedByQuickExcludeGroups={excludedByQuickExcludeGroups}
              activeLookupTypeId={activeLookupFocus?.typeId ?? null}
              onSort={handleSort}
              onPageChange={setPage}
              onSelectItem={(item) => openItemDrawer(item.typeId)}
              onToggleWatchlist={(item) => void handleToggleWatchlist(item)}
              onSyncOrders={() => void handleSyncOrders()}
              onResetFilters={handleResetFilters}
              onHoverLookupItem={setHoveredLookupTypeId}
              onRelaxFilter={handleRelaxFilter}
            />
          </>
        )}

        {activeTab === 'arbitrage' && (
          <ArbitrageView
            groupTree={groupTree}
            syncStatus={syncStatus}
            onSyncAllHubs={() => void handleSyncAllHubs()}
            onSelectItem={(typeId, hubId) => openItemDrawer(typeId, hubId)}
            onNotify={notify}
          />
        )}

        {activeTab === 'watchlist' && (
          <WatchlistView
            activeHub={activeHub}
            onSelectTypeId={(typeId) => openItemDrawer(typeId)}
            onWatchlistChanged={() => void Promise.all([loadMeta(), loadItems()])}
            onNotify={notify}
          />
        )}

        {activeTab === 'orders' && (
          <MyOrdersView
            activeHub={activeHub}
            ssoStatus={ssoStatus}
            onRefreshAuth={loadMeta}
            onSelectTypeId={(typeId, hubId) => openItemDrawer(typeId, hubId)}
            onNotify={notify}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            syncStatus={syncStatus}
            updateInfo={updateInfo}
            checkingUpdates={checkingUpdates}
            skippedUpdateVersion={skippedUpdateVersion}
            onCheckForUpdates={() => void runUpdateCheck(true)}
            onClearSkippedUpdate={handleClearSkippedUpdate}
            onSettingsUpdated={async () => {
              await Promise.all([loadMeta(), loadItems(), loadRecommended()]);
            }}
            onTriggerSde={() => void handleTriggerSde()}
            onTriggerBackfill={() => void handleBackfillHistory()}
            onNotify={notify}
          />
        )}
      </main>

      <footer className="border-t border-[#262938] bg-[#0F1118]/90 mt-6">
        <div className="max-w-[1640px] mx-auto px-4 sm:px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-[11px] text-[#656A7C]">
          <p className="leading-relaxed max-w-4xl">
            © 2026 Fenris Creations. All rights reserved.{' '}
            <span className="text-[#9CA0B0]">EVE Online®</span>,{' '}
            <span className="text-[#9CA0B0]">Fenris Creations™</span>, the EVE logo, and all
            associated logos, designs, artwork, screenshots, characters, vehicles, storylines, world
            facts, and game data (ESI &amp; SDE) are the intellectual property and trademarks of
            Fenris Creations (formerly CCP hf.). All other trademarks are the property of their
            respective owners. This application is an independent third-party tool and is not
            endorsed by or affiliated with Fenris Creations.
          </p>
          <div className="flex flex-wrap items-center gap-3 font-mono-num text-[10px] shrink-0">
            {updateInfo?.currentVersion && (
              <span className="text-[#9CA0B0]">v{updateInfo.currentVersion}</span>
            )}
            <span>Market data via EVE ESI &amp; Official SDE · Auth via EVE SSO</span>
            <a
              href="https://www.eveonline.com"
              target="_blank"
              rel="noreferrer"
              className="text-[#B298FF] hover:underline"
            >
              EVE Online
            </a>
            <a
              href="https://developers.eveonline.com"
              target="_blank"
              rel="noreferrer"
              className="text-[#B298FF] hover:underline"
            >
              EVE Developers
            </a>
          </div>
        </div>
      </footer>

      <ItemDrawer
        typeId={selectedTypeId}
        hubId={drawerHubId ?? activeHub}
        onHubChange={(nextHub) => setDrawerHubId(nextHub)}
        onClose={() => {
          setSelectedTypeId(null);
          setDrawerHubId(null);
        }}
        onWatchlistChanged={() => void Promise.all([loadMeta(), loadItems()])}
        onNotify={notify}
      />

      <AskNeonModal
        open={askNeonOpen}
        activeHub={activeHub}
        minRoiPct={filters.minRoiPct}
        marketGroupId={filters.marketGroupId}
        marketGroupIds={filters.marketGroupIds}
        onClose={() => setAskNeonOpen(false)}
        onSelectTypeId={(typeId) => openItemDrawer(typeId)}
        onOpenSettings={() => setActiveTab('settings')}
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
