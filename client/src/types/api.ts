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
}

export interface MarketStats {
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
    pagesDone: number;
    totalPages: number;
    jitaOrdersCount: number;
    lastError: string | null;
  };
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
