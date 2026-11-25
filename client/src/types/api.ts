export type HubId = 'jita' | 'amarr' | 'dodixie' | 'rens' | 'hek' | 'amamake';

export interface TradeHubFreshness {
  hubId: HubId;
  name: string;
  shortName: string;
  stationName: string;
  stationCode: string;
  regionId: number;
  regionName: string;
  security: number;
  isLowSec: boolean;
  accentColor: string;
  lastSyncedAt: string | null;
  twoSidedItems: number;
  totalOrders: number;
}

export type ArbitrageMode = 'instant' | 'relist' | 'buy_to_buy' | 'buy_to_sell';

export interface ArbitrageFilterState {
  q: string;
  mode: ArbitrageMode;
  sourceHub: HubId | 'any';
  destHub: HubId | 'any';
  minRoiPct: number | null;
  maxRoiPct: number | null;
  minUnitProfit: number | null;
  minTotalProfit: number | null;
  minBuyPrice: number | null;
  maxBuyPrice: number | null;
  maxCargoM3: number | null;
  minIskPerM3: number | null;
  maxJumps: number | null;
  hideLowSecRoutes: boolean;
  minAvailableUnits: number | null;
  hideAnomalies: boolean;
  excludeRootGroups: string[];
  marketGroupId: number | null;
  marketGroupIds: number[];
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

export interface ArbitrageOpportunity {
  typeId: number;
  name: string;
  marketGroupId: number | null;
  rootGroupName: string;
  itemVolume: number | null;
  mode: ArbitrageMode;
  sourceHubId: HubId;
  sourceHubName: string;
  destHubId: HubId;
  destHubName: string;
  sourceBid: number | null;
  sourceAsk: number | null;
  destBid: number | null;
  destAsk: number | null;
  buyPrice: number;
  sellPrice: number;
  unitBuyCost: number;
  unitSellProceeds: number;
  unitNetProfit: number;
  roiPct: number;
  availableUnits: number;
  haulUnits: number;
  fitsCargo: boolean;
  totalBuyCost: number;
  totalNetProfit: number;
  totalVolumeM3: number | null;
  iskPerM3: number | null;
  jumps: number;
  isLowSecRoute: boolean;
  iskPerJump: number;
  destDailyVolume7d: number | null;
  hasAnomaly: boolean;
  anomalies: AnomalyFlag[];
}

export interface ArbitrageResponse {
  items: ArbitrageOpportunity[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  mode: ArbitrageMode;
  fees: FeeConfig;
  summaryStats: {
    totalMatched: number;
    bestHaulProfit: number;
    medianRoiPct: number;
    avgRoiPct: number;
    syncedHubsCount: number;
  };
  hubs: TradeHubFreshness[];
}

export interface FeeConfig {
  brokerFeePct: number;
  salesTaxPct: number;
  captureSharePct: number;
}

export interface AnomalyFlag {
  code:
    | 'MIN_VOL_TRAP'
    | 'INFLATED_ASK'
    | 'DEPRESSED_BID'
    | 'EXTREME_MARGIN'
    | 'LOW_HISTORY'
    | 'SINGLE_SELLER';
  severity: 'high' | 'medium';
  label: string;
  reason: string;
}

export interface MarketItem {
  typeId: number;
  name: string;
  marketGroupId: number | null;
  rootGroupName: string;
  itemVolume: number | null;
  bestBid: number;
  bestAsk: number;
  rawBestBid: number;
  bidMinVolume: number;
  bidVolume: number;
  askVolume: number;
  buyOrderCount: number;
  sellOrderCount: number;
  topBuyCompetition: number;
  topSellCompetition: number;
  totalCompetition: number;
  recentUpdates1h: number;
  recentUpdates24h: number;
  buyCost: number;
  sellProceeds: number;
  spreadIsk: number;
  netProfit: number;
  roiPct: number;
  netMarginPct: number;
  estDailyProfit: number | null;
  bidDepthIsk: number;
  askDepthIsk: number;
  bookDepthIsk: number;
  tradeScore: number;
  scoreBreakdown: ScoreBreakdown;
  hasHistory: boolean;
  dailyVolume7d: number | null;
  dailyVolume30d: number | null;
  dailyIskVolume7d: number | null;
  avgPrice7d: number | null;
  avgPrice30d: number | null;
  volumeTrendPct: number | null;
  priceTrendPct: number | null;
  activeDays30d: number | null;
  isTrending: boolean;
  hasAnomaly: boolean;
  hasCriticalAnomaly: boolean;
  anomalies: AnomalyFlag[];
  isWatchlisted: boolean;
  hasCharacterOrder: boolean;
  updatedAt: string;
}

export interface ScoreBreakdown {
  profitScore: number;
  salesVolumeScore: number;
  bookDepthScore: number;
  competitionScore: number;
  momentumBonus: number;
  riskPenalty: number;
}

export interface RecommendedTradesResponse {
  top: MarketItem | null;
  runnersUp: MarketItem[];
  scopeLabel: string;
  minRoiPct: number;
  evaluatedCount: number;
  fallbackUsed: boolean;
  fees: FeeConfig;
}

export type FilterKey =
  | 'marketGroup'
  | 'includeRootGroups'
  | 'excludeRootGroups'
  | 'watchlistOnly'
  | 'requireHistory'
  | 'trendingOnly'
  | 'hideAnomalies'
  | 'minRoiPct'
  | 'maxRoiPct'
  | 'minPrice'
  | 'maxPrice'
  | 'minNetProfit'
  | 'minDailyIskVolume'
  | 'minDailyUnits'
  | 'maxCompetition'
  | 'maxRecentUpdates1h'
  | 'twoSidedBook';

export interface FilterFailure {
  key: FilterKey;
  label: string;
  reason: string;
  excludedGroup?: string;
}

export interface LookupMarketItem extends MarketItem {
  failedFilters: FilterFailure[];
}

export interface MarketItemsResponse {
  items: MarketItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  fees: FeeConfig;
  summaryStats: {
    totalMatched: number;
    avgRoiPct: number;
    trendingInMatchCount: number;
  };
  filteredOutMatches: LookupMarketItem[];
  filteredOutTotal: number;
  excludedByQuickExcludesCount?: number;
  excludedByQuickExcludeGroups?: string[];
}

export interface MarketStats {
  hubId?: HubId;
  hubName?: string;
  totalJitaItems: number;
  twoSidedItems: number;
  totalJitaOrders: number;
  historyFetchedTotal: number;
  historyCoveredItems: number;
  historyCoveragePct: number;
  trendingItemsCount: number;
  watchlistCount: number;
  sdeItemCount: number;
  lastOrderSyncAt: string | null;
  fees: FeeConfig;
}

export interface MarketGroupCount {
  name: string;
  itemCount: number;
}

export interface MarketGroupTreeNode {
  id: number;
  parentId: number | null;
  name: string;
  itemCount: number;
  path: string[];
  children: MarketGroupTreeNode[];
}

export interface JitaOrderRow {
  order_id: number;
  type_id: number;
  is_buy_order: number;
  price: number;
  volume_remain: number;
  volume_total: number;
  min_volume: number;
  duration: number;
  issued: string;
}

export interface HistoryPoint {
  date: string;
  average: number;
  highest: number;
  lowest: number;
  order_count: number;
  volume: number;
}

export interface ItemDetailResponse {
  hubId?: HubId;
  hubName?: string;
  item: MarketItem;
  groupPath: string[];
  fees: FeeConfig;
  sellOrders: JitaOrderRow[];
  buyOrders: JitaOrderRow[];
  history: HistoryPoint[];
  historyMeta: { fetched_at: string; status: string; days_count: number } | null;
  snapshots: Array<{
    captured_at: string;
    best_bid: number | null;
    best_ask: number | null;
    buy_order_count: number | null;
    sell_order_count: number | null;
    recent_updates_1h: number | null;
  }>;
  watchlist: {
    type_id: number;
    note: string;
    target_buy: number | null;
    target_sell: number | null;
    created_at: string;
  } | null;
  characterOrders: Array<{
    order_id: number;
    is_buy_order: number;
    price: number;
    volume_remain: number;
    volume_total: number;
  }>;
}

export interface SyncRunRow {
  id: number;
  kind: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  orders_fetched: number;
  items_updated: number;
  detail: string | null;
  error_message: string | null;
}

export interface SyncStatusResponse {
  sdePopulated: boolean;
  orderSync: {
    running: boolean;
    stage: string;
    syncScope?: HubId | 'all' | null;
    currentHubId?: HubId | null;
    hubsDone?: number;
    totalHubs?: number;
    pagesDone: number;
    totalPages: number;
    jitaOrdersCount: number;
    ordersCount?: number;
    lastError: string | null;
  };
  hubs?: TradeHubFreshness[];
  historyBackfill: {
    running: boolean;
    done: number;
    total: number;
    lastError: string | null;
  };
  sdeSync: {
    running: boolean;
    stage: string;
    itemsLoaded: number;
    groupsLoaded: number;
    lastError: string | null;
  };
  esiRate: {
    errorLimitRemain: number;
    errorLimitResetSec: number;
    lastUpdated: string | null;
  };
  scheduler: {
    enabled: boolean;
    intervalMin: number;
    nextScheduledAt: string | null;
  };
  recentRuns: SyncRunRow[];
}

export interface FilterState {
  q: string;
  minRoiPct: number | null;
  maxRoiPct: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  priceField: 'buy' | 'sell';
  minNetProfit: number | null;
  minDailyIskVolume: number | null;
  minDailyUnits: number | null;
  maxCompetition: number | null;
  maxRecentUpdates1h: number | null;
  includeRootGroups: string[];
  excludeRootGroups: string[];
  marketGroupId: number | null;
  marketGroupIds: number[];
  trendingOnly: boolean;
  hideAnomalies: boolean;
  watchlistOnly: boolean;
  requireHistory: boolean;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

export interface FilterPreset {
  id: number;
  name: string;
  filters: Partial<FilterState>;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistItem {
  typeId: number;
  name: string;
  rootGroupName: string;
  note: string;
  targetBuy: number | null;
  targetSell: number | null;
  createdAt: string;
  bestBid: number | null;
  bestAsk: number | null;
  netProfit: number;
  roiPct: number;
  estDailyProfit: number | null;
  dailyIskVolume7d: number | null;
  volumeTrendPct: number | null;
  isTrending: boolean;
  hasAnomaly: boolean;
  anomalies: AnomalyFlag[];
}

export interface AppSettings {
  brokerFeePct: number;
  salesTaxPct: number;
  accountingLevel: number;
  brokerRelationsLevel: number;
  factionStanding: number;
  corpStanding: number;
  autoSyncEnabled: boolean;
  autoSyncIntervalMin: number;
  autoSyncScope: 'active' | 'all';
  activeHub: HubId;
  captureSharePct: number;
  esiClientId: string;
  ssoRedirectUri: string;
  llmProvider: 'gemini' | 'openai_compat';
  llmModel: string;
  llmBaseUrl: string;
  llmThinkingLevel: LlmThinkingLevel;
  llmApiKeyConfigured: boolean;
  llmApiKeySource: 'env' | 'settings' | 'none';
}

export type LlmThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type NeonSessionStyle = 'quick_flip' | 'balanced' | 'overnight';

export interface NeonTradePick {
  rank: number;
  typeId: number;
  headline: string;
  rationale: string;
  executionPlan: string;
  riskNote: string;
  suggestedQty: number;
  estimatedCapitalIsk: number;
  estimatedNetProfitIsk: number;
  outbidBuyPrice: number;
  undercutSellPrice: number;
  item: MarketItem;
}

export interface NeonBriefingResponse {
  id: number;
  createdAt: string;
  provider: 'gemini' | 'openai_compat';
  model: string;
  scopeLabel: string;
  sessionStyle: NeonSessionStyle;
  budgetIsk: number | null;
  userNote: string;
  minRoiPct: number;
  candidateCount: number;
  sessionSummary: string;
  recommendations: NeonTradePick[];
}

export interface NeonAdvisorStatus {
  provider: 'gemini' | 'openai_compat';
  model: string;
  baseUrl: string;
  thinkingLevel: LlmThinkingLevel;
  configured: boolean;
  keySource: 'env' | 'settings' | 'none';
}

export interface LlmModelOption {
  id: string;
  displayName: string;
}

export interface LlmModelsResponse {
  provider: 'gemini' | 'openai_compat';
  activeModel: string;
  source: 'live' | 'fallback';
  models: LlmModelOption[];
}

export interface SsoStatusResponse {
  connected: boolean;
  characterId?: number;
  characterName?: string;
  scopes?: string[];
  expiresAt?: string;
  updatedAt?: string;
  clientIdConfigured: boolean;
  redirectUri: string;
  jitaOrdersCount: number;
}

export interface CharacterOrderItem {
  orderId: number;
  hubId: HubId;
  hubName: string;
  locationId?: number | null;
  typeId: number;
  itemName: string;
  rootGroupName: string;
  isBuyOrder: boolean;
  price: number;
  volumeRemain: number;
  volumeTotal: number;
  issued: string;
  escrow: number;
  updatedAt: string;
  marketBestPrice: number | null;
  status: 'BEST' | 'UNDERCUT' | 'OUTBID' | 'NO_MARKET';
  deltaIsk: number;
  suggestedRelistPrice: number | null;
}

export interface DescriptionSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  showInfoTypeId?: number;
  loreLink?: boolean;
}

export interface GameInfoSkillReq {
  skillTypeId: number;
  skillName: string;
  level: number;
  levelRoman: string;
}

export interface GameInfoAttribute {
  attributeId: number;
  name: string;
  displayName: string;
  description: string;
  rawValue: number;
  formattedValue: string;
  unitId: number | null;
}

export interface ItemGameInfo {
  typeId: number;
  name: string;
  groupId: number;
  groupName: string;
  categoryId: number;
  categoryName: string;
  marketGroupPath: string[];
  marketGroupDescription: string;
  descriptionRaw: string;
  descriptionParagraphs: DescriptionSegment[][];
  metaLevel: number | null;
  techLevel: number | null;
  metaGroupLabel: string | null;
  volume: number | null;
  packagedVolume: number | null;
  mass: number | null;
  capacity: number | null;
  portionSize: number | null;
  radius: number | null;
  published: boolean;
  supportsRender: boolean;
  requiredSkills: GameInfoSkillReq[];
  attributes: GameInfoAttribute[];
  fetchedAt: string;
  cached: boolean;
}
