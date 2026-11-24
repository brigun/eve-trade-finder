import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jita-watchlist-test-'));
process.env.JITA_DATA_DIR = tmpDir;

const { createApp } = await import('../../index.js');
const { getDb } = await import('../../db/database.js');

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

describe('Watchlist routes persistence', () => {
  it('persists targetBuy, targetSell, and note across PATCH and GET', async () => {
    const typeId = 34;

    const createRes = await requestJson<{ typeId: number }>('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify({ typeId }),
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.typeId, typeId);

    const patchRes = await requestJson<{
      typeId: number;
      note: string;
      targetBuy: number | null;
      targetSell: number | null;
    }>(`/api/watchlist/${typeId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        note: 'Accumulate under 5 ISK',
        targetBuy: 4.5,
        targetSell: 6.25,
      }),
    });
    assert.equal(patchRes.status, 200);
    assert.deepEqual(patchRes.body, {
      typeId,
      note: 'Accumulate under 5 ISK',
      targetBuy: 4.5,
      targetSell: 6.25,
    });

    const listRes = await requestJson<{
      items: Array<{
        typeId: number;
        note: string;
        targetBuy: number | null;
        targetSell: number | null;
      }>;
    }>('/api/watchlist');
    assert.equal(listRes.status, 200);
    const saved = listRes.body.items.find((item) => item.typeId === typeId);
    assert.ok(saved);
    assert.equal(saved.note, 'Accumulate under 5 ISK');
    assert.equal(saved.targetBuy, 4.5);
    assert.equal(saved.targetSell, 6.25);
  });

  it('clears a single target price without wiping the other target or note', async () => {
    const typeId = 35;

    await requestJson('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify({
        typeId,
        note: 'Keep this note',
        targetBuy: 100_000,
        targetSell: 150_000,
      }),
    });

    const clearBuyRes = await requestJson<{
      typeId: number;
      note: string;
      targetBuy: number | null;
      targetSell: number | null;
    }>(`/api/watchlist/${typeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ targetBuy: null }),
    });
    assert.equal(clearBuyRes.status, 200);
    assert.equal(clearBuyRes.body.targetBuy, null);
    assert.equal(clearBuyRes.body.targetSell, 150_000);
    assert.equal(clearBuyRes.body.note, 'Keep this note');

    const clearSellRes = await requestJson<{
      typeId: number;
      note: string;
      targetBuy: number | null;
      targetSell: number | null;
    }>(`/api/watchlist/${typeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ targetSell: '' }),
    });
    assert.equal(clearSellRes.status, 200);
    assert.equal(clearSellRes.body.targetBuy, null);
    assert.equal(clearSellRes.body.targetSell, null);
    assert.equal(clearSellRes.body.note, 'Keep this note');
  });

  it('preserves existing targets and note when re-posting POST /api/watchlist with only typeId', async () => {
    const typeId = 36;

    await requestJson('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify({
        typeId,
        note: 'Existing note',
        targetBuy: 250_000,
        targetSell: 325_000,
      }),
    });

    const repostRes = await requestJson<{
      typeId: number;
      note: string;
      targetBuy: number | null;
      targetSell: number | null;
    }>('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify({ typeId }),
    });
    assert.equal(repostRes.status, 201);
    assert.equal(repostRes.body.note, 'Existing note');
    assert.equal(repostRes.body.targetBuy, 250_000);
    assert.equal(repostRes.body.targetSell, 325_000);

    const listRes = await requestJson<{
      items: Array<{
        typeId: number;
        note: string;
        targetBuy: number | null;
        targetSell: number | null;
      }>;
    }>('/api/watchlist');
    const saved = listRes.body.items.find((item) => item.typeId === typeId);
    assert.ok(saved);
    assert.equal(saved.note, 'Existing note');
    assert.equal(saved.targetBuy, 250_000);
    assert.equal(saved.targetSell, 325_000);
  });

  it('rejects negative target prices on PATCH with 400', async () => {
    const typeId = 37;

    await requestJson('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify({ typeId, targetBuy: 500 }),
    });

    const badRes = await requestJson<{ error: string }>(`/api/watchlist/${typeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ targetBuy: -10 }),
    });
    assert.equal(badRes.status, 400);
    assert.match(badRes.body.error, /non-negative/i);
  });
});
