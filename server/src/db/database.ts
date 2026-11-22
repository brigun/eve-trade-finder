import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, DB_PATH } from '../config.js';

let dbInstance: DatabaseSync | null = null;

export interface PresetSeed {
  name: string;
  filters: Record<string, unknown>;
}

const DEFAULT_SETTINGS: Record<string, string> = {
  broker_fee_pct: '3.0',
  sales_tax_pct: '7.5',
  accounting_level: '0',
  broker_relations_level: '0',
  faction_standing: '0',
  corp_standing: '0',
  auto_sync_enabled: 'true',
  auto_sync_interval_min: '15',
  capture_share_pct: '15',
  esi_client_id: '',
  sso_redirect_uri: 'http://localhost:3001/api/auth/callback',
  llm_provider: 'gemini',
  llm_model: 'gemini-3.8-flash',
  llm_base_url: 'http://localhost:11434/v1',
  llm_thinking_level: 'MEDIUM',
  llm_api_key: '',
};

const DEFAULT_PRESETS: PresetSeed[] = [
  {
    name: 'Balanced Jita Flips',
    filters: {
      minRoiPct: 10,
      minPrice: 100_000,
      maxPrice: 500_000_000,
      priceField: 'buy',
      minDailyIskVolume: 20_000_000,
      minDailyUnits: 5,
      hideAnomalies: true,
      excludeRootGroups: ['Ship SKINs', 'Apparel', 'Blueprints & Reactions'],
      sortBy: 'tradeScore',
      sortDir: 'desc',
    },
  },
  {
    name: 'High-Volume Safe',
    filters: {
      minRoiPct: 10,
      priceField: 'buy',
      minDailyIskVolume: 250_000_000,
      minDailyUnits: 50,
      maxRecentUpdates1h: 15,
      hideAnomalies: true,
      excludeRootGroups: ['Ship SKINs', 'Apparel', 'Blueprints & Reactions'],
      sortBy: 'tradeScore',
      sortDir: 'desc',
    },
  },
  {
    name: 'Trending Breakouts',
    filters: {
      minRoiPct: 10,
      priceField: 'buy',
      trendingOnly: true,
      minDailyIskVolume: 15_000_000,
      hideAnomalies: true,
      excludeRootGroups: ['Ship SKINs', 'Apparel'],
      sortBy: 'tradeScore',
      sortDir: 'desc',
    },
  },
  {
    name: 'Low-Cap Starter (<10M)',
    filters: {
      minRoiPct: 10,
      minPrice: 10_000,
      maxPrice: 10_000_000,
      priceField: 'buy',
      minDailyUnits: 20,
      hideAnomalies: true,
      excludeRootGroups: ['Ship SKINs', 'Apparel', 'Blueprints & Reactions'],
      sortBy: 'tradeScore',
      sortDir: 'desc',
    },
  },
  {
    name: 'Best Ammo Types',
    filters: {
      marketGroupId: 11,
      minRoiPct: 10,
      priceField: 'buy',
      minDailyIskVolume: 10_000_000,
      minDailyUnits: 500,
      hideAnomalies: true,
      requireHistory: true,
      sortBy: 'tradeScore',
      sortDir: 'desc',
    },
  },
  {
    name: 'Best Modules',
    filters: {
      marketGroupId: 9,
      minRoiPct: 10,
      minPrice: 100_000,
      priceField: 'buy',
      minDailyIskVolume: 20_000_000,
      minDailyUnits: 5,
      maxRecentUpdates1h: 18,
      hideAnomalies: true,
      requireHistory: true,
      sortBy: 'tradeScore',
      sortDir: 'desc',
    },
  },
  {
    name: 'Best PI Materials',
    filters: {
      marketGroupId: 1332,
      minRoiPct: 10,
      priceField: 'buy',
      minDailyIskVolume: 10_000_000,
      minDailyUnits: 20,
      hideAnomalies: true,
      requireHistory: true,
      sortBy: 'tradeScore',
      sortDir: 'desc',
    },
  },
  {
    name: 'Best Construction Components',
    filters: {
      marketGroupId: 1035,
      minRoiPct: 10,
      minPrice: 10_000,
      priceField: 'buy',
      minDailyIskVolume: 15_000_000,
      minDailyUnits: 5,
      hideAnomalies: true,
      requireHistory: true,
      sortBy: 'tradeScore',
      sortDir: 'desc',
    },
  },
  {
    name: 'Best PI & Components',
    filters: {
      marketGroupIds: [1332, 1035],
      minRoiPct: 10,
      priceField: 'buy',
      minDailyIskVolume: 10_000_000,
      minDailyUnits: 5,
      hideAnomalies: true,
      requireHistory: true,
      sortBy: 'tradeScore',
      sortDir: 'desc',
    },
  },
];

export function initDatabase(customPath?: string): DatabaseSync {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const targetPath = customPath ?? DB_PATH;
  if (targetPath !== ':memory:') {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new DatabaseSync(targetPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);

  createSchema(db);
  seedDefaults(db);

  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback errors if connection already rolled back
    }
    throw error;
  }
}

function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_groups (
      market_group_id INTEGER PRIMARY KEY,
      parent_group_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      root_group_id INTEGER,
      root_group_name TEXT
    );

    CREATE TABLE IF NOT EXISTS item_types (
      type_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      market_group_id INTEGER,
      root_group_id INTEGER,
      root_group_name TEXT,
      volume REAL,
      published INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_item_types_name ON item_types(name);
    CREATE INDEX IF NOT EXISTS idx_item_types_root_group ON item_types(root_group_name);

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      orders_fetched INTEGER DEFAULT 0,
      items_updated INTEGER DEFAULT 0,
      detail TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS jita_orders (
      order_id INTEGER PRIMARY KEY,
      type_id INTEGER NOT NULL,
      is_buy_order INTEGER NOT NULL,
      price REAL NOT NULL,
      volume_remain INTEGER NOT NULL,
      volume_total INTEGER NOT NULL,
      min_volume INTEGER NOT NULL,
      duration INTEGER NOT NULL,
      issued TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jita_orders_type_side_price
      ON jita_orders(type_id, is_buy_order, price);

    CREATE TABLE IF NOT EXISTS market_summary (
      type_id INTEGER PRIMARY KEY,
      best_bid REAL,
      best_ask REAL,
      raw_best_bid REAL,
      bid_min_volume INTEGER DEFAULT 1,
      bid_volume INTEGER DEFAULT 0,
      ask_volume INTEGER DEFAULT 0,
      buy_order_count INTEGER DEFAULT 0,
      sell_order_count INTEGER DEFAULT 0,
      top_buy_competition INTEGER DEFAULT 0,
      top_sell_competition INTEGER DEFAULT 0,
      recent_updates_1h INTEGER DEFAULT 0,
      recent_updates_24h INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS market_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at TEXT NOT NULL,
      type_id INTEGER NOT NULL,
      best_bid REAL,
      best_ask REAL,
      buy_order_count INTEGER,
      sell_order_count INTEGER,
      recent_updates_1h INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_market_snapshots_type_time
      ON market_snapshots(type_id, captured_at);

    CREATE TABLE IF NOT EXISTS market_history (
      type_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      average REAL NOT NULL,
      highest REAL NOT NULL,
      lowest REAL NOT NULL,
      order_count INTEGER NOT NULL,
      volume INTEGER NOT NULL,
      PRIMARY KEY (type_id, date)
    );

    CREATE TABLE IF NOT EXISTS history_fetch_log (
      type_id INTEGER PRIMARY KEY,
      fetched_at TEXT NOT NULL,
      status TEXT NOT NULL,
      days_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS history_metrics (
      type_id INTEGER PRIMARY KEY,
      daily_volume_7d REAL DEFAULT 0,
      daily_volume_30d REAL DEFAULT 0,
      daily_isk_volume_7d REAL DEFAULT 0,
      daily_isk_volume_30d REAL DEFAULT 0,
      avg_price_7d REAL DEFAULT 0,
      avg_price_30d REAL DEFAULT 0,
      volume_trend_pct REAL DEFAULT 0,
      price_trend_pct REAL DEFAULT 0,
      active_days_30d INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      type_id INTEGER PRIMARY KEY,
      note TEXT DEFAULT '',
      target_buy REAL,
      target_sell REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS filter_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      filters_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sso_sessions (
      character_id INTEGER PRIMARY KEY,
      character_name TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      scopes TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_orders (
      order_id INTEGER PRIMARY KEY,
      character_id INTEGER NOT NULL,
      type_id INTEGER NOT NULL,
      is_buy_order INTEGER NOT NULL,
      price REAL NOT NULL,
      volume_remain INTEGER NOT NULL,
      volume_total INTEGER NOT NULL,
      issued TEXT NOT NULL,
      escrow REAL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS neon_briefings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      scope_label TEXT NOT NULL,
      session_style TEXT NOT NULL,
      budget_isk REAL,
      user_note TEXT DEFAULT '',
      response_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS item_game_info (
      type_id INTEGER PRIMARY KEY,
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dogma_attributes_cache (
      attribute_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT DEFAULT '',
      unit_id INTEGER,
      high_is_good INTEGER,
      published INTEGER DEFAULT 1,
      stackable INTEGER DEFAULT 1,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS eve_groups_cache (
      group_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      category_name TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
  `);
}

function seedDefaults(db: DatabaseSync): void {
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  withTransaction(db, () => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insertSetting.run(key, value);
    }

    const currProviderRow = db
      .prepare("SELECT value FROM settings WHERE key = 'llm_provider'")
      .get() as { value: string } | undefined;
    const currModelRow = db
      .prepare("SELECT value FROM settings WHERE key = 'llm_model'")
      .get() as { value: string } | undefined;
    if (
      (currProviderRow?.value ?? 'gemini') === 'gemini' &&
      currModelRow?.value === 'gemini-2.5-flash'
    ) {
      db.prepare("UPDATE settings SET value = 'gemini-3.8-flash' WHERE key = 'llm_model'").run();
    }

    const now = new Date().toISOString();
    const insertPreset = db.prepare(
      'INSERT OR IGNORE INTO filter_presets (name, filters_json, created_at, updated_at) VALUES (?, ?, ?, ?)',
    );
    for (const preset of DEFAULT_PRESETS) {
      insertPreset.run(preset.name, JSON.stringify(preset.filters), now, now);
    }

    const legacyDefaults = [
      'Balanced Jita Flips',
      'High-Volume Safe',
      'Trending Breakouts',
      'Low-Cap Starter (<10M)',
    ];
    const getPreset = db.prepare('SELECT id, filters_json FROM filter_presets WHERE name = ?');
    const updatePreset = db.prepare(
      'UPDATE filter_presets SET filters_json = ?, updated_at = ? WHERE id = ?',
    );
    for (const name of legacyDefaults) {
      const existing = getPreset.get(name) as { id: number; filters_json: string } | undefined;
      if (!existing) continue;
      try {
        const parsed = JSON.parse(existing.filters_json) as Record<string, unknown>;
        if (typeof parsed.minRoiPct !== 'number' || parsed.minRoiPct < 10) {
          parsed.minRoiPct = 10;
          updatePreset.run(JSON.stringify(parsed), now, existing.id);
        }
      } catch {
        // ignore malformed custom json
      }
    }
  });
}
