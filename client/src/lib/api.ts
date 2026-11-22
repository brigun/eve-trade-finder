import type {
  AppSettings,
  CharacterOrderItem,
  FilterPreset,
  FilterState,
  HistoryPoint,
  ItemDetailResponse,
  MarketGroupCount,
  MarketGroupTreeNode,
  MarketItemsResponse,
  MarketStats,
  SsoStatusResponse,
  SyncStatusResponse,
  WatchlistItem,
} from '../types/api.ts';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let errMessage = `HTTP ${res.status}`;
    try {
      const payload = (await res.json()) as { error?: string };
      if (payload?.error) errMessage = payload.error;
    } catch {
      // ignore json parse failure
    }
    throw new Error(errMessage);
  }
  return (await res.json()) as T;
}

export function buildMarketQueryParams(
  filters: FilterState,
  page: number,
  pageSize: number,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.minRoiPct !== null) params.set('minRoiPct', String(filters.minRoiPct));
  if (filters.maxRoiPct !== null) params.set('maxRoiPct', String(filters.maxRoiPct));
  if (filters.minPrice !== null) params.set('minPrice', String(filters.minPrice));
  if (filters.maxPrice !== null) params.set('maxPrice', String(filters.maxPrice));
  params.set('priceField', filters.priceField);
  if (filters.minNetProfit !== null) params.set('minNetProfit', String(filters.minNetProfit));
  if (filters.minDailyIskVolume !== null) {
    params.set('minDailyIskVolume', String(filters.minDailyIskVolume));
  }
  if (filters.minDailyUnits !== null) params.set('minDailyUnits', String(filters.minDailyUnits));
  if (filters.maxCompetition !== null) params.set('maxCompetition', String(filters.maxCompetition));
  if (filters.maxRecentUpdates1h !== null) {
    params.set('maxRecentUpdates1h', String(filters.maxRecentUpdates1h));
  }
  if (filters.includeRootGroups.length > 0) {
    params.set('includeRootGroups', filters.includeRootGroups.join(','));
  }
  if (filters.excludeRootGroups.length > 0) {
    params.set('excludeRootGroups', filters.excludeRootGroups.join(','));
  }
  if (filters.marketGroupId !== null) {
    params.set('marketGroupId', String(filters.marketGroupId));
  }
  if (filters.trendingOnly) params.set('trendingOnly', 'true');
  if (filters.hideAnomalies) params.set('hideAnomalies', 'true');
  if (filters.watchlistOnly) params.set('watchlistOnly', 'true');
  if (filters.requireHistory) params.set('requireHistory', 'true');
  params.set('sortBy', filters.sortBy);
  params.set('sortDir', filters.sortDir);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  return params;
}

export const api = {
  getMarketItems(filters: FilterState, page = 1, pageSize = 50): Promise<MarketItemsResponse> {
    const params = buildMarketQueryParams(filters, page, pageSize);
    return requestJson<MarketItemsResponse>(`/api/market/items?${params.toString()}`);
  },
  getMarketStats(): Promise<MarketStats> {
    return requestJson<MarketStats>('/api/market/stats');
  },
  getMarketGroups(): Promise<{ groups: MarketGroupCount[]; tree: MarketGroupTreeNode[] }> {
    return requestJson<{ groups: MarketGroupCount[]; tree: MarketGroupTreeNode[] }>(
      '/api/market/groups',
    );
  },
  getItemDetail(typeId: number): Promise<ItemDetailResponse> {
    return requestJson<ItemDetailResponse>(`/api/market/items/${typeId}`);
  },
  getSyncStatus(): Promise<SyncStatusResponse> {
    return requestJson<SyncStatusResponse>('/api/sync/status');
  },
  triggerOrderSync(): Promise<{ started: boolean; alreadyRunning: boolean }> {
    return requestJson('/api/sync/orders', { method: 'POST' });
  },
  triggerSdeSync(): Promise<{ started: boolean; alreadyRunning: boolean }> {
    return requestJson('/api/sync/sde', { method: 'POST' });
  },
  triggerHistoryBackfill(batchSize = 150): Promise<{ started: boolean; alreadyRunning: boolean }> {
    return requestJson(`/api/sync/history/backfill?batchSize=${batchSize}`, { method: 'POST' });
  },
  syncItemHistory(
    typeId: number,
    force = false,
  ): Promise<{ typeId: number; daysCount: number; history: HistoryPoint[] }> {
    return requestJson(`/api/sync/history/${typeId}?force=${force ? 'true' : 'false'}`, {
      method: 'POST',
    });
  },
  getWatchlist(): Promise<{ items: WatchlistItem[] }> {
    return requestJson<{ items: WatchlistItem[] }>('/api/watchlist');
  },
  upsertWatchlist(payload: {
    typeId: number;
    note?: string;
    targetBuy?: number | null;
    targetSell?: number | null;
  }): Promise<unknown> {
    return requestJson('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  updateWatchlist(
    typeId: number,
    payload: { note?: string; targetBuy?: number | null; targetSell?: number | null },
  ): Promise<unknown> {
    return requestJson(`/api/watchlist/${typeId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  removeWatchlist(typeId: number): Promise<unknown> {
    return requestJson(`/api/watchlist/${typeId}`, { method: 'DELETE' });
  },
  getPresets(): Promise<{ presets: FilterPreset[] }> {
    return requestJson<{ presets: FilterPreset[] }>('/api/presets');
  },
  savePreset(name: string, filters: Partial<FilterState>): Promise<{ preset: FilterPreset }> {
    return requestJson<{ preset: FilterPreset }>('/api/presets', {
      method: 'POST',
      body: JSON.stringify({ name, filters }),
    });
  },
  deletePreset(id: number): Promise<unknown> {
    return requestJson(`/api/presets/${id}`, { method: 'DELETE' });
  },
  getSettings(): Promise<{ settings: AppSettings }> {
    return requestJson<{ settings: AppSettings }>('/api/settings');
  },
  updateSettings(
    payload: Partial<AppSettings> & { recalculateFromSkills?: boolean },
  ): Promise<{ settings: AppSettings }> {
    return requestJson<{ settings: AppSettings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  getAuthStatus(): Promise<SsoStatusResponse> {
    return requestJson<SsoStatusResponse>('/api/auth/status');
  },
  getAuthLoginUrl(): Promise<{ url: string }> {
    return requestJson<{ url: string }>('/api/auth/login');
  },
  syncCharacter(): Promise<{ jitaOrdersCount: number; characterName: string }> {
    return requestJson('/api/auth/sync', { method: 'POST' });
  },
  logoutAuth(): Promise<unknown> {
    return requestJson('/api/auth/logout', { method: 'POST' });
  },
  getCharacterOrders(): Promise<{
    connected: boolean;
    characterName?: string;
    orders: CharacterOrderItem[];
  }> {
    return requestJson('/api/auth/orders');
  },
};
