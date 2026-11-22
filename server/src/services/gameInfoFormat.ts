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

export interface ItemGameInfoDto {
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

export interface RawDogmaAttrValue {
  attribute_id: number;
  value: number;
}

export const SKILL_REQ_ATTRIBUTE_IDS = new Set<number>([
  182, 183, 184, 277, 278, 279, 1285, 1286, 1287, 1288, 1289, 1290,
]);

const SKILL_REQ_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [182, 277],
  [183, 278],
  [184, 279],
  [1285, 1286],
  [1289, 1287],
  [1290, 1288],
];

export const SKILL_ID_ATTRIBUTE_IDS: ReadonlyArray<number> = SKILL_REQ_PAIRS.map(([id]) => id);

const META_GROUP_LABELS: Record<number, string> = {
  1: 'Tech I',
  2: 'Tech II',
  3: 'Storyline',
  4: 'Faction',
  5: 'Officer',
  6: 'Deadspace',
  14: 'Tech III',
  15: 'Abyssal',
  52: 'Structure Faction',
  53: 'Structure Tech II',
  54: 'Structure Tech I',
};

const RENDERABLE_CATEGORIES = new Set<string>([
  'Ship',
  'Drone',
  'Structure',
  'Deployable',
  'Fighter',
]);

export function supportsEveRender(categoryName: string): boolean {
  return RENDERABLE_CATEGORIES.has(categoryName);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });
}

function sameSegmentStyle(a: DescriptionSegment, b: DescriptionSegment): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    a.showInfoTypeId === b.showInfoTypeId &&
    Boolean(a.loreLink) === Boolean(b.loreLink)
  );
}

function appendSegment(target: DescriptionSegment[], seg: DescriptionSegment): void {
  if (!seg.text) return;
  const last = target[target.length - 1];
  if (last && sameSegmentStyle(last, seg)) {
    last.text += seg.text;
  } else {
    target.push({ ...seg });
  }
}

export function parseEveDescription(raw: string): DescriptionSegment[][] {
  if (!raw || !raw.trim()) return [];

  // Remove script and style blocks completely before parsing
  let cleaned = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  // Tokenize HTML tags vs text
  const tokens = cleaned.split(/(<[^>]+>)/g);

  let bold = false;
  let italic = false;
  let showInfoTypeId: number | undefined;
  let loreLink = false;

  const lines: DescriptionSegment[][] = [[]];

  const pushText = (chunk: string) => {
    const decoded = decodeHtmlEntities(chunk);
    const parts = decoded.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        lines.push([]);
      }
      const part = parts[i];
      if (!part) continue;
      const seg: DescriptionSegment = { text: part };
      if (bold) seg.bold = true;
      if (italic) seg.italic = true;
      if (showInfoTypeId !== undefined) seg.showInfoTypeId = showInfoTypeId;
      if (loreLink) seg.loreLink = true;
      appendSegment(lines[lines.length - 1], seg);
    }
  };

  for (const token of tokens) {
    if (!token) continue;
    if (!token.startsWith('<') || !token.endsWith('>')) {
      pushText(token);
      continue;
    }

    const inner = token.slice(1, -1).trim();
    if (!inner) continue;

    const lower = inner.toLowerCase();

    if (lower === 'b' || lower === 'strong') {
      bold = true;
    } else if (lower === '/b' || lower === '/strong') {
      bold = false;
    } else if (lower === 'i' || lower === 'em') {
      italic = true;
    } else if (lower === '/i' || lower === '/em') {
      italic = false;
    } else if (lower.startsWith('a ') || lower === 'a') {
      showInfoTypeId = undefined;
      loreLink = false;
      const hrefMatch = inner.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const hrefVal = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '') : '';
      const showMatch = hrefVal.match(/showinfo:(\d+)(\/\/[^\s"'<>]+)?/i);
      if (showMatch) {
        if (showMatch[2]) {
          loreLink = true;
        } else {
          const parsedId = Number.parseInt(showMatch[1], 10);
          if (Number.isFinite(parsedId) && parsedId > 0) {
            showInfoTypeId = parsedId;
          }
        }
      }
    } else if (lower === '/a') {
      showInfoTypeId = undefined;
      loreLink = false;
    } else if (lower === '/p' || lower === 'p' || lower === 'div' || lower === '/div') {
      if (lines[lines.length - 1].length > 0) {
        lines.push([]);
      }
    }
    // All other tags (<font>, </font>, <url=...>, <color=...>, etc.) are stripped while preserving inner text.
  }

  const paragraphs: DescriptionSegment[][] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    // Trim leading/trailing pure whitespace on each line while keeping segment structure
    const trimmedSegs: DescriptionSegment[] = line.map((s) => ({ ...s }));
    while (trimmedSegs.length > 0) {
      trimmedSegs[0].text = trimmedSegs[0].text.replace(/^\s+/, '');
      if (trimmedSegs[0].text === '') {
        trimmedSegs.shift();
      } else {
        break;
      }
    }
    while (trimmedSegs.length > 0) {
      const lastIdx = trimmedSegs.length - 1;
      trimmedSegs[lastIdx].text = trimmedSegs[lastIdx].text.replace(/\s+$/, '');
      if (trimmedSegs[lastIdx].text === '') {
        trimmedSegs.pop();
      } else {
        break;
      }
    }
    if (trimmedSegs.length > 0) {
      paragraphs.push(trimmedSegs);
    }
  }

  return paragraphs;
}

export function toRomanNumeral(level: number): string {
  const rounded = Math.round(level);
  switch (rounded) {
    case 1:
      return 'I';
    case 2:
      return 'II';
    case 3:
      return 'III';
    case 4:
      return 'IV';
    case 5:
      return 'V';
    default:
      return String(rounded);
  }
}

export function extractSkillRequirements(
  dogmaAttributes: RawDogmaAttrValue[],
  resolveTypeName: (typeId: number) => string | null,
): GameInfoSkillReq[] {
  const valMap = new Map<number, number>();
  for (const attr of dogmaAttributes) {
    valMap.set(attr.attribute_id, attr.value);
  }

  const seenSkillIds = new Set<number>();
  const skills: GameInfoSkillReq[] = [];

  for (const [skillAttrId, levelAttrId] of SKILL_REQ_PAIRS) {
    const rawSkillId = valMap.get(skillAttrId);
    if (rawSkillId === undefined || !Number.isFinite(rawSkillId) || rawSkillId <= 0) continue;
    const skillTypeId = Math.round(rawSkillId);
    if (seenSkillIds.has(skillTypeId)) continue;
    seenSkillIds.add(skillTypeId);

    const rawLevel = valMap.get(levelAttrId);
    const level =
      rawLevel !== undefined && Number.isFinite(rawLevel) && rawLevel >= 1
        ? Math.min(5, Math.max(1, Math.round(rawLevel)))
        : 1;

    skills.push({
      skillTypeId,
      skillName: resolveTypeName(skillTypeId) ?? `Skill #${skillTypeId}`,
      level,
      levelRoman: toRomanNumeral(level),
    });
  }

  return skills;
}

export function extractMetaInfo(dogmaAttributes: RawDogmaAttrValue[]): {
  metaLevel: number | null;
  techLevel: number | null;
  metaGroupLabel: string | null;
} {
  const valMap = new Map<number, number>();
  for (const attr of dogmaAttributes) {
    valMap.set(attr.attribute_id, attr.value);
  }

  const rawMetaLevel = valMap.get(633);
  const metaLevel =
    rawMetaLevel !== undefined && Number.isFinite(rawMetaLevel) ? Math.round(rawMetaLevel) : null;

  const rawTechLevel = valMap.get(422);
  const techLevel =
    rawTechLevel !== undefined && Number.isFinite(rawTechLevel) ? Math.round(rawTechLevel) : null;

  const rawMetaGroup = valMap.get(1692);
  let metaGroupLabel: string | null = null;
  if (rawMetaGroup !== undefined && Number.isFinite(rawMetaGroup)) {
    metaGroupLabel = META_GROUP_LABELS[Math.round(rawMetaGroup)] ?? null;
  }

  if (!metaGroupLabel && techLevel !== null) {
    if (techLevel === 2) metaGroupLabel = 'Tech II';
    else if (techLevel === 3) metaGroupLabel = 'Tech III';
  }

  return { metaLevel, techLevel, metaGroupLabel };
}

function formatNum(value: number, maxFractionDigits = 2): string {
  if (!Number.isFinite(value)) return '0';
  // Clean floating point noise like 10.0000000001
  const rounded = Number(value.toFixed(Math.max(maxFractionDigits, 3)));
  return rounded.toLocaleString('en-US', {
    maximumFractionDigits: maxFractionDigits,
  });
}

export function formatDogmaValue(
  value: number,
  unitId: number | null,
  resolveTypeName?: (typeId: number) => string | null,
): string {
  if (!Number.isFinite(value)) return String(value);

  switch (unitId) {
    case 1:
      return `${formatNum(value, 2)} m`;
    case 2:
      return `${formatNum(value, 2)} kg`;
    case 3:
    case 123:
      return `${formatNum(value, 2)} s`;
    case 8:
      return `${formatNum(value, 2)} m²`;
    case 9:
      return `${formatNum(value, 3)} m³`;
    case 10:
    case 11:
      return `${formatNum(value, 2)} m/s`;
    case 101: {
      if (Math.abs(value) >= 1000) {
        return `${formatNum(value / 1000, 2)} s`;
      }
      return `${formatNum(value, 2)} ms`;
    }
    case 102:
      return `${formatNum(value, 2)} mm`;
    case 104:
      return `${formatNum(value, 2)}x`;
    case 105:
    case 121:
    case 124:
    case 127:
      return `${formatNum(value, 2)}%`;
    case 106:
      return `${formatNum(value, 2)} tf`;
    case 107:
      return `${formatNum(value, 2)} MW`;
    case 108:
    case 111:
      return `${formatNum((1 - value) * 100, 2)}%`;
    case 109: {
      const pct = (value - 1) * 100;
      const sign = pct >= 0 ? '+' : '';
      return `${sign}${formatNum(pct, 2)}%`;
    }
    case 112:
      return `${formatNum(value, 3)} rad/sec`;
    case 113:
      return `${formatNum(value, 2)} HP`;
    case 114:
      return `${formatNum(value, 2)} GJ`;
    case 116: {
      const tid = Math.round(value);
      return resolveTypeName?.(tid) ?? `Type #${tid}`;
    }
    case 117: {
      const sz = Math.round(value);
      if (sz === 1) return 'Small';
      if (sz === 2) return 'Medium';
      if (sz === 3) return 'Large';
      if (sz === 4) return 'X-Large';
      return formatNum(value, 0);
    }
    case 118:
    case 138:
      return `${formatNum(value, 2)} units`;
    case 120:
      return `${formatNum(value, 2)} pts`;
    case 122:
      return `${formatNum(value, 0)} slots`;
    case 125:
      return `${formatNum(value, 2)} N`;
    case 126:
      return `${formatNum(value, 2)} ly`;
    case 128:
      return `${formatNum(value, 2)} Mbit/sec`;
    case 129:
      return `${formatNum(value, 2)} hr`;
    case 133:
      return `${formatNum(value, 2)} ISK`;
    case 134:
      return `${formatNum(value, 2)} m³/s`;
    case 135:
      return `${formatNum(value, 2)} AU/s`;
    case 136:
      return `Slot ${Math.round(value)}`;
    case 137:
      return value !== 0 ? 'Yes' : 'No';
    case 139:
      return `+${formatNum(value, 2)}`;
    case 140:
      return `Level ${Math.round(value)}`;
    case 141:
      return `${formatNum(value, 0)} hardpoints`;
    default:
      return formatNum(value, 3);
  }
}
