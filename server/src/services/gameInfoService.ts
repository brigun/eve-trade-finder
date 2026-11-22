import { getDb } from '../db/database.js';
import { EsiHttpError, esiFetchJson } from './esiClient.js';
import {
  extractMetaInfo,
  extractSkillRequirements,
  formatDogmaValue,
  parseEveDescription,
  SKILL_ID_ATTRIBUTE_IDS,
  SKILL_REQ_ATTRIBUTE_IDS,
  supportsEveRender,
  type GameInfoAttribute,
  type ItemGameInfoDto,
  type RawDogmaAttrValue,
} from './gameInfoFormat.js';
import { resolveUnknownTypeIds } from './sdeSync.js';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTRIBUTES = 60;
const DOGMA_FETCH_CONCURRENCY = 6;

interface EsiTypeDetail {
  type_id: number;
  name: string;
  description?: string;
  published?: boolean;
  group_id: number;
  market_group_id?: number | null;
  radius?: number;
  volume?: number;
  packaged_volume?: number;
  mass?: number;
  capacity?: number;
  portion_size?: number;
  dogma_attributes?: RawDogmaAttrValue[];
}

interface EsiGroupDetail {
  group_id: number;
  name: string;
  category_id: number;
}

interface EsiCategoryDetail {
  category_id: number;
  name: string;
}

interface EsiDogmaAttribute {
  attribute_id: number;
  name?: string;
  display_name?: string;
  description?: string;
  unit_id?: number;
  high_is_good?: boolean;
  published?: boolean;
  stackable?: boolean;
}

interface DogmaAttributeMeta {
  attribute_id: number;
  name: string;
  display_name: string;
  description: string;
  unit_id: number | null;
  high_is_good: number | null;
  published: number;
  stackable: number;
}

interface ResolvedEveGroup {
  groupId: number;
  name: string;
  categoryId: number;
  categoryName: string;
}

async function resolveEveGroup(groupId: number): Promise<ResolvedEveGroup> {
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return { groupId: 0, name: 'Unknown Group', categoryId: 0, categoryName: 'Item' };
  }

  const db = getDb();
  const cached = db
    .prepare(
      'SELECT group_id, name, category_id, category_name FROM eve_groups_cache WHERE group_id = ?',
    )
    .get(groupId) as
    | { group_id: number; name: string; category_id: number; category_name: string }
    | undefined;

  if (cached) {
    return {
      groupId: cached.group_id,
      name: cached.name,
      categoryId: cached.category_id,
      categoryName: cached.category_name,
    };
  }

  try {
    const { data: grp } = await esiFetchJson<EsiGroupDetail>(`/universe/groups/${groupId}/`, {
      retries: 1,
      timeoutMs: 10_000,
    });
    let categoryName = 'Item';
    const categoryId = grp?.category_id ?? 0;
    if (categoryId > 0) {
      try {
        const { data: cat } = await esiFetchJson<EsiCategoryDetail>(
          `/universe/categories/${categoryId}/`,
          { retries: 1, timeoutMs: 10_000 },
        );
        if (cat?.name) {
          categoryName = cat.name;
        }
      } catch {
        // Non-fatal fallback to generic category label
      }
    }

    const groupName = grp?.name || 'Unknown Group';
    db.prepare(
      `INSERT OR REPLACE INTO eve_groups_cache (group_id, name, category_id, category_name, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(groupId, groupName, categoryId, categoryName, new Date().toISOString());

    return { groupId, name: groupName, categoryId, categoryName };
  } catch {
    return { groupId, name: 'Unknown Group', categoryId: 0, categoryName: 'Item' };
  }
}

function resolveLocalMarketGroup(
  marketGroupId: number | null,
): { marketGroupPath: string[]; marketGroupDescription: string } {
  if (marketGroupId === null || !Number.isFinite(marketGroupId)) {
    return { marketGroupPath: [], marketGroupDescription: '' };
  }

  const db = getDb();
  const stmt = db.prepare(
    'SELECT market_group_id, parent_group_id, name, description FROM market_groups WHERE market_group_id = ?',
  );

  const path: string[] = [];
  let leafDescription = '';
  let currId: number | null = marketGroupId;
  const seen = new Set<number>();

  while (currId !== null && !seen.has(currId)) {
    seen.add(currId);
    const row = stmt.get(currId) as
      | {
          market_group_id: number;
          parent_group_id: number | null;
          name: string;
          description: string | null;
        }
      | undefined;
    if (!row) break;
    if (seen.size === 1 && row.description) {
      leafDescription = row.description.trim();
    }
    path.unshift(row.name);
    currId = row.parent_group_id;
  }

  return { marketGroupPath: path, marketGroupDescription: leafDescription };
}

async function resolveDogmaAttributes(
  attributeIds: number[],
): Promise<Map<number, DogmaAttributeMeta>> {
  const uniqueIds = Array.from(
    new Set(
      attributeIds.filter(
        (id) => Number.isFinite(id) && id > 0 && !SKILL_REQ_ATTRIBUTE_IDS.has(id),
      ),
    ),
  ).slice(0, MAX_ATTRIBUTES);

  const result = new Map<number, DogmaAttributeMeta>();
  if (uniqueIds.length === 0) return result;

  const db = getDb();
  const selectStmt = db.prepare(
    `SELECT attribute_id, name, display_name, description, unit_id, high_is_good, published, stackable
     FROM dogma_attributes_cache WHERE attribute_id = ?`,
  );

  const missing: number[] = [];
  for (const id of uniqueIds) {
    const cached = selectStmt.get(id) as DogmaAttributeMeta | undefined;
    if (cached) {
      result.set(id, { ...cached });
    } else {
      missing.push(id);
    }
  }

  if (missing.length === 0) return result;

  const upsertStmt = db.prepare(`
    INSERT OR REPLACE INTO dogma_attributes_cache
      (attribute_id, name, display_name, description, unit_id, high_is_good, published, stackable, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const queue = [...missing];
  const workerCount = Math.min(DOGMA_FETCH_CONCURRENCY, queue.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const attrId = queue.shift();
      if (attrId === undefined) break;
      try {
        const { data } = await esiFetchJson<EsiDogmaAttribute>(`/dogma/attributes/${attrId}/`, {
          retries: 1,
          timeoutMs: 10_000,
        });
        if (!data || !Number.isFinite(data.attribute_id)) continue;

        const meta: DogmaAttributeMeta = {
          attribute_id: data.attribute_id,
          name: (data.name ?? '').trim(),
          display_name: (data.display_name ?? data.name ?? '').trim(),
          description: (data.description ?? '').trim(),
          unit_id: typeof data.unit_id === 'number' && Number.isFinite(data.unit_id) ? data.unit_id : null,
          high_is_good:
            typeof data.high_is_good === 'boolean' ? (data.high_is_good ? 1 : 0) : null,
          published: data.published === false ? 0 : 1,
          stackable: data.stackable === false ? 0 : 1,
        };

        upsertStmt.run(
          meta.attribute_id,
          meta.name,
          meta.display_name,
          meta.description,
          meta.unit_id,
          meta.high_is_good,
          meta.published,
          meta.stackable,
          new Date().toISOString(),
        );
        result.set(meta.attribute_id, meta);
      } catch {
        // Individual dogma attribute fetch failures should not break the info modal
      }
    }
  });

  await Promise.allSettled(workers);
  return result;
}

async function resolveTypeNames(typeIds: number[]): Promise<Map<number, string>> {
  const uniqueIds = Array.from(
    new Set(typeIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.round(id))),
  );
  const nameMap = new Map<number, string>();
  if (uniqueIds.length === 0) return nameMap;

  const db = getDb();
  const selectName = db.prepare('SELECT name FROM item_types WHERE type_id = ?');
  const missing: number[] = [];

  for (const id of uniqueIds) {
    const row = selectName.get(id) as { name?: string } | undefined;
    if (row?.name) {
      nameMap.set(id, row.name);
    } else {
      missing.push(id);
    }
  }

  if (missing.length > 0) {
    await resolveUnknownTypeIds(missing);
    for (const id of missing) {
      const row = selectName.get(id) as { name?: string } | undefined;
      if (row?.name) {
        nameMap.set(id, row.name);
      }
    }
  }

  return nameMap;
}

function toOptionalFinite(val: unknown): number | null {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

export async function getItemGameInfo(typeId: number, force = false): Promise<ItemGameInfoDto> {
  const db = getDb();
  const cachedRow = db
    .prepare('SELECT payload_json, fetched_at FROM item_game_info WHERE type_id = ?')
    .get(typeId) as { payload_json: string; fetched_at: string } | undefined;

  if (cachedRow && !force) {
    const ageMs = Date.now() - Date.parse(cachedRow.fetched_at);
    if (Number.isFinite(ageMs) && ageMs < CACHE_TTL_MS) {
      try {
        const parsed = JSON.parse(cachedRow.payload_json) as ItemGameInfoDto;
        return { ...parsed, cached: true };
      } catch {
        // Ignore corrupted cache JSON and re-fetch
      }
    }
  }

  let typeData: EsiTypeDetail;
  try {
    const { data } = await esiFetchJson<EsiTypeDetail>(`/universe/types/${typeId}/`, {
      retries: 2,
      timeoutMs: 15_000,
    });
    typeData = data;
  } catch (err) {
    if (!(err instanceof EsiHttpError && err.status === 404) && cachedRow) {
      try {
        const parsed = JSON.parse(cachedRow.payload_json) as ItemGameInfoDto;
        return { ...parsed, cached: true };
      } catch {
        // fall through and rethrow original error
      }
    }
    throw err;
  }

  const localItemRow = db
    .prepare('SELECT market_group_id FROM item_types WHERE type_id = ?')
    .get(typeId) as { market_group_id: number | null } | undefined;

  const effectiveMarketGroupId =
    typeof typeData.market_group_id === 'number' && Number.isFinite(typeData.market_group_id)
      ? typeData.market_group_id
      : (localItemRow?.market_group_id ?? null);

  const dogmaAttrs = Array.isArray(typeData.dogma_attributes) ? typeData.dogma_attributes : [];

  const [groupInfo, dogmaMetaMap] = await Promise.all([
    resolveEveGroup(typeData.group_id),
    resolveDogmaAttributes(dogmaAttrs.map((a) => a.attribute_id)),
  ]);

  const { marketGroupPath, marketGroupDescription } = resolveLocalMarketGroup(effectiveMarketGroupId);

  // Collect all type IDs referenced in required skills or unit_id 116 attributes
  const referencedTypeIds: number[] = [];
  for (const attr of dogmaAttrs) {
    if (SKILL_ID_ATTRIBUTE_IDS.includes(attr.attribute_id) && attr.value > 0) {
      referencedTypeIds.push(Math.round(attr.value));
    }
    const meta = dogmaMetaMap.get(attr.attribute_id);
    if (meta?.unit_id === 116 && attr.value > 0) {
      referencedTypeIds.push(Math.round(attr.value));
    }
  }

  const typeNameMap = await resolveTypeNames(referencedTypeIds);
  const resolveTypeName = (id: number): string | null => typeNameMap.get(id) ?? null;

  const requiredSkills = extractSkillRequirements(dogmaAttrs, resolveTypeName);
  const { metaLevel, techLevel, metaGroupLabel } = extractMetaInfo(dogmaAttrs);

  const attributes: GameInfoAttribute[] = [];
  for (const attr of dogmaAttrs) {
    if (SKILL_REQ_ATTRIBUTE_IDS.has(attr.attribute_id)) continue;
    const meta = dogmaMetaMap.get(attr.attribute_id);
    if (!meta || meta.published !== 1) continue;
    const label = (meta.display_name || meta.name).trim();
    if (!label) continue;

    attributes.push({
      attributeId: attr.attribute_id,
      name: meta.name,
      displayName: label,
      description: meta.description,
      rawValue: attr.value,
      formattedValue: formatDogmaValue(attr.value, meta.unit_id, resolveTypeName),
      unitId: meta.unit_id,
    });
  }

  attributes.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const descriptionRaw = typeof typeData.description === 'string' ? typeData.description : '';
  const fetchedAt = new Date().toISOString();

  const dto: ItemGameInfoDto = {
    typeId: typeData.type_id ?? typeId,
    name: typeData.name ?? `Type #${typeId}`,
    groupId: groupInfo.groupId,
    groupName: groupInfo.name,
    categoryId: groupInfo.categoryId,
    categoryName: groupInfo.categoryName,
    marketGroupPath,
    marketGroupDescription,
    descriptionRaw,
    descriptionParagraphs: parseEveDescription(descriptionRaw),
    metaLevel,
    techLevel,
    metaGroupLabel,
    volume: toOptionalFinite(typeData.volume),
    packagedVolume: toOptionalFinite(typeData.packaged_volume),
    mass: toOptionalFinite(typeData.mass),
    capacity: toOptionalFinite(typeData.capacity),
    portionSize: toOptionalFinite(typeData.portion_size),
    radius: toOptionalFinite(typeData.radius),
    published: typeData.published !== false,
    supportsRender: supportsEveRender(groupInfo.categoryName),
    requiredSkills,
    attributes,
    fetchedAt,
    cached: false,
  };

  db.prepare(
    'INSERT OR REPLACE INTO item_game_info (type_id, payload_json, fetched_at) VALUES (?, ?, ?)',
  ).run(typeId, JSON.stringify(dto), fetchedAt);

  return dto;
}
