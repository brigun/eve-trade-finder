import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jita-multihub-test-'));
process.env.JITA_DATA_DIR = tmpDir;

const { initDatabase, getDb } = await import('../../db/database.js');
const { createApp } = await import('../../index.js');

let server: http.Server;
let baseUrl: string;

async function requestJson<T>(
  pathname: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

before(async () => {
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind ephemeral port'));
        return;
      }
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  try {
    getDb().close();
  } catch {
    // ignore if already closed
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Multi-hub SQLite migration and API routes', () => {
  it('migrates legacy single-hub Jita SQLite DB to multi-hub schema without data loss', () => {
    const legacyPath = path.join(tmpDir, 'legacy-jita.db');
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec(`
      CREATE TABLE jita_orders (
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
      CREATE TABLE market_summary (
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
      CREATE TABLE market_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        captured_at TEXT NOT NULL,
        type_id INTEGER NOT NULL,
        best_bid REAL,
        best_ask REAL,
        buy_order_count INTEGER,
        sell_order_count INTEGER,
        recent_updates_1h INTEGER
      );
      CREATE TABLE market_history (
        type_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        average REAL NOT NULL,
        highest REAL NOT NULL,
        lowest REAL NOT NULL,
        order_count INTEGER NOT NULL,
        volume INTEGER NOT NULL,
        PRIMARY KEY (type_id, date)
      );
      CREATE TABLE history_fetch_log (
        type_id INTEGER PRIMARY KEY,
        fetched_at TEXT NOT NULL,
        status TEXT NOT NULL,
        days_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE history_metrics (
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
      CREATE TABLE watchlist (
        type_id INTEGER PRIMARY KEY,
        note TEXT DEFAULT '',
        target_buy REAL,
        target_sell REAL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE character_orders (
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
      CREATE TABLE sync_runs (
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

      INSERT INTO jita_orders VALUES (9001, 34, 0, 5.0, 1000, 1000, 1, 90, '2026-11-24T00:00:00Z');
      INSERT INTO market_summary VALUES (34, 4.2, 5.0, 4.2, 1, 500, 1000, 2, 3, 1, 1, 0, 1, '2026-11-24T00:00:00Z');
      INSERT INTO watchlist VALUES (34, 'Keep Jita target', 4.1, 5.2, '2026-11-24T00:00:00Z');
      INSERT INTO history_metrics VALUES (34, 100, 90, 500, 450, 4.8, 4.7, 11.1, 2.1, 30, '2026-11-24T00:00:00Z');
    `);
    legacy.close();

    const migrated = initDatabase(legacyPath);
    try {
      const orderRow = migrated
        .prepare("SELECT hub_id, location_id, price FROM hub_orders WHERE order_id = 9001")
        .get() as { hub_id: string; location_id: number; price: number };
      assert.equal(orderRow.hub_id, 'jita');
      assert.equal(orderRow.location_id, 60003760);
      assert.equal(orderRow.price, 5.0);

      const watchRow = migrated
        .prepare("SELECT hub_id, note, target_buy, target_sell FROM watchlist WHERE type_id = 34")
        .get() as { hub_id: string; note: string; target_buy: number; target_sell: number };
      assert.equal(watchRow.hub_id, 'jita');
      assert.equal(watchRow.note, 'Keep Jita target');
      assert.equal(watchRow.target_buy, 4.1);
      assert.equal(watchRow.target_sell, 5.2);

      const histRow = migrated
        .prepare("SELECT region_id, daily_volume_7d FROM history_metrics WHERE type_id = 34")
        .get() as { region_id: number; daily_volume_7d: number };
      assert.equal(histRow.region_id, 10000002);
      assert.equal(histRow.daily_volume_7d, 100);
    } finally {
      migrated.close();
    }
  });

  it('isolates scanner items and watchlists per hub and computes cross-hub arbitrage', async () => {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT OR REPLACE INTO item_types (type_id, name, market_group_id, root_group_id, root_group_name, volume, published)
      VALUES (2001, 'Heavy Capacitor Booster II', 9, 9, 'Ship Equipment', 5, 1)
    `).run();

    // Jita: sell at 1,000,000 ISK
    db.prepare(`
      INSERT OR REPLACE INTO market_summary (
        hub_id, type_id, best_bid, best_ask, raw_best_bid, bid_min_volume,
        bid_volume, ask_volume, buy_order_count, sell_order_count,
        top_buy_competition, top_sell_competition, recent_updates_1h, recent_updates_24h, updated_at
      ) VALUES ('jita', 2001, 900000, 1000000, 900000, 1, 40, 100, 3, 4, 1, 1, 0, 2, ?)
    `).run(now);

    // Amarr: buy at 1,400,000 ISK, sell at 1,800,000 ISK (profitable station spread + Jita->Amarr arbitrage)
    db.prepare(`
      INSERT OR REPLACE INTO market_summary (
        hub_id, type_id, best_bid, best_ask, raw_best_bid, bid_min_volume,
        bid_volume, ask_volume, buy_order_count, sell_order_count,
        top_buy_competition, top_sell_competition, recent_updates_1h, recent_updates_24h, updated_at
      ) VALUES ('amarr', 2001, 1400000, 1800000, 1400000, 1, 50, 20, 3, 2, 1, 1, 0, 1, ?)
    `).run(now);

    // Amamake: buy at 1,500,000 ISK
    db.prepare(`
      INSERT OR REPLACE INTO market_summary (
        hub_id, type_id, best_bid, best_ask, raw_best_bid, bid_min_volume,
        bid_volume, ask_volume, buy_order_count, sell_order_count,
        top_buy_competition, top_sell_competition, recent_updates_1h, recent_updates_24h, updated_at
      ) VALUES ('amamake', 2001, 1500000, 1750000, 1500000, 1, 30, 10, 2, 2, 1, 1, 0, 1, ?)
    `).run(now);

    // Per-hub watchlist isolation
    await requestJson('/api/watchlist?hub=amarr', {
      method: 'POST',
      body: JSON.stringify({ typeId: 2001, note: 'Amarr flip', targetBuy: 1_350_000 }),
    });
    const amarrWatch = await requestJson<{ items: Array<{ typeId: number; note: string }> }>(
      '/api/watchlist?hub=amarr',
    );
    const jitaWatch = await requestJson<{ items: Array<{ typeId: number; note: string }> }>(
      '/api/watchlist?hub=jita',
    );
    assert.equal(amarrWatch.body.items.length, 1);
    assert.equal(amarrWatch.body.items[0].note, 'Amarr flip');
    assert.equal(jitaWatch.body.items.some((i) => i.typeId === 2001), false);

    // Per-hub scanner query
    const amarrScan = await requestJson<{ items: Array<{ typeId: number; bestAsk: number }> }>(
      '/api/market/items?hub=amarr&minRoiPct=0&minPrice=0&hideAnomalies=false',
    );
    const amarrItem = amarrScan.body.items.find((i) => i.typeId === 2001);
    assert.ok(amarrItem);
    assert.equal(amarrItem.bestAsk, 1_800_000);

    // Arbitrage route with Amamake included vs hidden
    const allArb = await requestJson<{
      items: Array<{
        typeId: number;
        sourceHubId: string;
        destHubId: string;
        isLowSecRoute: boolean;
        totalNetProfit: number;
      }>;
    }>('/api/arbitrage/opportunities?mode=instant&sourceHub=jita&hideLowSecRoutes=false&hideAnomalies=false');
    assert.ok(allArb.body.items.some((o) => o.destHubId === 'amamake' && o.isLowSecRoute));
    assert.ok(allArb.body.items.some((o) => o.destHubId === 'amarr' && !o.isLowSecRoute));

    const highSecOnly = await requestJson<{
      items: Array<{ destHubId: string; isLowSecRoute: boolean }>;
    }>('/api/arbitrage/opportunities?mode=instant&sourceHub=jita&hideLowSecRoutes=true&hideAnomalies=false');
    assert.equal(highSecOnly.body.items.some((o) => o.destHubId === 'amamake'), false);
    assert.ok(highSecOnly.body.items.some((o) => o.destHubId === 'amarr'));
  });
});
