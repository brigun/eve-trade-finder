import readline from 'node:readline';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { CCP_SDE_BASE, USER_AGENT } from '../config.js';
import { getDb, withTransaction } from '../db/database.js';
import { esiFetchJson } from './esiClient.js';

export interface SdeSyncProgress {
  running: boolean;
  stage: string;
  itemsLoaded: number;
  groupsLoaded: number;
  lastError: string | null;
}

interface RawSdeMarketGroup {
  _key?: number;
  marketGroupID?: number;
  parentGroupID?: number | null;
  name?: string | { en?: string };
  description?: string | { en?: string };
}

interface RawSdeType {
  _key?: number;
  typeID?: number;
  marketGroupID?: number | null;
  name?: string | { en?: string };
  volume?: number | null;
  published?: boolean | number;
}

interface ParsedTypeRow {
  typeId: number;
  name: string;
  marketGroupId: number | null;
  volume: number | null;
  published: number;
}

const sdeState: SdeSyncProgress = {
  running: false,
  stage: 'idle',
  itemsLoaded: 0,
  groupsLoaded: 0,
  lastError: null,
};

let activeSdePromise: Promise<{ groupsCount: number; itemsCount: number }> | null = null;

export function getSdeProgress(): SdeSyncProgress {
  return { ...sdeState };
}

function extractLocalizedEn(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && 'en' in value) {
    const en = (value as { en?: unknown }).en;
    if (typeof en === 'string') return en.trim();
  }
  return '';
}

function toFiniteInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && Number.isFinite(n) ? n : null;
}

async function streamJsonlLines<T>(
  url: string,
  onRecord: (record: T) => void,
  timeoutMs = 120_000,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let rl: readline.Interface | null = null;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/x-ndjson, text/plain, */*',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} downloading ${url}`);
    }
    if (!res.body) {
      throw new Error(`Empty response body downloading ${url}`);
    }

    const nodeStream = Readable.fromWeb(res.body as unknown as NodeWebReadableStream);
    rl = readline.createInterface({ input: nodeStream, crlfDelay: Infinity });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      onRecord(JSON.parse(trimmed) as T);
    }
  } finally {
    clearTimeout(timer);
    rl?.close();
  }
}

export function isSdePopulated(): boolean {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM item_types').get() as
    | { cnt: number }
    | undefined;
  return (row?.cnt ?? 0) > 100;
}

export async function syncSdeData(): Promise<{ groupsCount: number; itemsCount: number }> {
  if (activeSdePromise) return activeSdePromise;

  activeSdePromise = (async () => {
    const db = getDb();
    const startedAt = new Date().toISOString();
    const runInfo = db
      .prepare('INSERT INTO sync_runs (kind, status, started_at, detail) VALUES (?, ?, ?, ?)')
      .run('sde', 'running', startedAt, 'Streaming CCP official SDE (sde.evetech.net)');
    const runId = Number(runInfo.lastInsertRowid);

    sdeState.running = true;
    sdeState.stage = 'downloading_groups';
    sdeState.itemsLoaded = 0;
    sdeState.groupsLoaded = 0;
    sdeState.lastError = null;

    try {
      const groupMap = new Map<
        number,
        { id: number; parentId: number | null; name: string; description: string }
      >();

      await streamJsonlLines<RawSdeMarketGroup>(
        `${CCP_SDE_BASE}/marketGroups.jsonl`,
        (obj) => {
          const id = toFiniteInt(obj.marketGroupID ?? obj._key);
          if (id === null) return;
          const name = extractLocalizedEn(obj.name);
          if (!name) return;

          groupMap.set(id, {
            id,
            parentId: toFiniteInt(obj.parentGroupID),
            name,
            description: extractLocalizedEn(obj.description),
          });
        },
      );
      sdeState.groupsLoaded = groupMap.size;

      const rootCache = new Map<number, { rootId: number; rootName: string }>();
      const resolveRoot = (groupId: number): { rootId: number; rootName: string } => {
        const cached = rootCache.get(groupId);
        if (cached) return cached;

        let curr = groupMap.get(groupId);
        const visited = new Set<number>();
        while (curr && curr.parentId !== null && groupMap.has(curr.parentId)) {
          if (visited.has(curr.id)) break;
          visited.add(curr.id);
          curr = groupMap.get(curr.parentId);
        }

        const resolved = curr
          ? { rootId: curr.id, rootName: curr.name }
          : { rootId: groupId, rootName: 'Unknown' };
        rootCache.set(groupId, resolved);
        return resolved;
      };

      sdeState.stage = 'downloading_types';
      const parsedTypes: ParsedTypeRow[] = [];

      await streamJsonlLines<RawSdeType>(
        `${CCP_SDE_BASE}/types.jsonl`,
        (obj) => {
          const typeId = toFiniteInt(obj.typeID ?? obj._key);
          if (typeId === null) return;

          const published = obj.published === true || obj.published === 1 ? 1 : 0;
          const marketGroupId = toFiniteInt(obj.marketGroupID);
          if (published === 0 && marketGroupId === null) return;

          const name = extractLocalizedEn(obj.name);
          if (!name) return;

          const volume =
            typeof obj.volume === 'number' && Number.isFinite(obj.volume) ? obj.volume : null;

          parsedTypes.push({ typeId, name, marketGroupId, volume, published });
          if (parsedTypes.length % 1000 === 0) {
            sdeState.itemsLoaded = parsedTypes.length;
          }
        },
        120_000,
      );

      sdeState.stage = 'persisting';
      let groupsCount = 0;
      let itemsCount = 0;

      withTransaction(db, () => {
        const upsertGroup = db.prepare(`
          INSERT INTO market_groups (market_group_id, parent_group_id, name, description, root_group_id, root_group_name)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(market_group_id) DO UPDATE SET
            parent_group_id = excluded.parent_group_id,
            name = excluded.name,
            description = excluded.description,
            root_group_id = excluded.root_group_id,
            root_group_name = excluded.root_group_name
        `);

        for (const g of groupMap.values()) {
          const root = resolveRoot(g.id);
          upsertGroup.run(g.id, g.parentId, g.name, g.description, root.rootId, root.rootName);
          groupsCount++;
        }

        const upsertItem = db.prepare(`
          INSERT INTO item_types (type_id, name, market_group_id, root_group_id, root_group_name, volume, published)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(type_id) DO UPDATE SET
            name = excluded.name,
            market_group_id = excluded.market_group_id,
            root_group_id = excluded.root_group_id,
            root_group_name = excluded.root_group_name,
            volume = excluded.volume,
            published = excluded.published
        `);

        for (const r of parsedTypes) {
          const root = r.marketGroupId !== null ? resolveRoot(r.marketGroupId) : null;
          upsertItem.run(
            r.typeId,
            r.name,
            r.marketGroupId,
            root ? root.rootId : null,
            root ? root.rootName : null,
            r.volume,
            r.published,
          );
          itemsCount++;
        }
      });

      sdeState.groupsLoaded = groupsCount;
      sdeState.itemsLoaded = itemsCount;
      sdeState.stage = 'idle';

      db.prepare(
        'UPDATE sync_runs SET status = ?, finished_at = ?, items_updated = ?, detail = ? WHERE id = ?',
      ).run(
        'completed',
        new Date().toISOString(),
        itemsCount,
        `Loaded ${groupsCount} market groups and ${itemsCount} item types from CCP official SDE (sde.evetech.net)`,
        runId,
      );

      return { groupsCount, itemsCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sdeState.lastError = message;
      sdeState.stage = 'error';
      db.prepare(
        'UPDATE sync_runs SET status = ?, finished_at = ?, error_message = ? WHERE id = ?',
      ).run('failed', new Date().toISOString(), message, runId);
      throw error;
    } finally {
      sdeState.running = false;
      activeSdePromise = null;
    }
  })();

  return activeSdePromise;
}

export async function resolveUnknownTypeIds(typeIds: number[]): Promise<number> {
  if (typeIds.length === 0) return 0;

  const db = getDb();
  const existingStmt = db.prepare('SELECT type_id FROM item_types WHERE type_id = ?');
  const missing: number[] = [];

  for (const id of typeIds) {
    if (!existingStmt.get(id)) {
      missing.push(id);
    }
  }

  if (missing.length === 0) return 0;

  let resolvedCount = 0;
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO item_types (type_id, name, market_group_id, root_group_id, root_group_name, volume, published)
    VALUES (?, ?, NULL, NULL, 'Uncategorized', NULL, 1)
  `);

  for (let i = 0; i < missing.length; i += 500) {
    const chunk = missing.slice(i, i + 500);
    try {
      const { data } = await esiFetchJson<Array<{ id: number; name: string; category: string }>>(
        '/universe/names/',
        { method: 'POST', body: chunk, retries: 1 },
      );

      if (Array.isArray(data) && data.length > 0) {
        withTransaction(db, () => {
          for (const entry of data) {
            if (entry.category === 'inventory_type' && entry.name) {
              insertStmt.run(entry.id, entry.name);
              resolvedCount++;
            }
          }
        });
      }
    } catch {
      // Non-fatal fallback: items without SDE entries fall back gracefully to Type #ID in queries
    }
  }

  return resolvedCount;
}
