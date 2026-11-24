export type HubId = 'jita' | 'amarr' | 'dodixie' | 'rens' | 'hek' | 'amamake';

export interface TradeHubDefinition {
  id: HubId;
  name: string;
  shortName: string;
  stationName: string;
  stationCode: string;
  stationId: number | null;
  systemId: number;
  regionId: number;
  regionName: string;
  security: number;
  isLowSec: boolean;
  accentColor: string;
}

export const DEFAULT_HUB_ID: HubId = 'jita';

export const TRADE_HUBS: TradeHubDefinition[] = [
  {
    id: 'jita',
    name: 'Jita 4-4',
    shortName: 'Jita',
    stationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    stationCode: 'CNAP 60003760',
    stationId: 60003760,
    systemId: 30000142,
    regionId: 10000002,
    regionName: 'The Forge',
    security: 0.9,
    isLowSec: false,
    accentColor: '#9B7BFF',
  },
  {
    id: 'amarr',
    name: 'Amarr VIII',
    shortName: 'Amarr',
    stationName: 'Amarr VIII (Oris) - Emperor Family Academy',
    stationCode: 'EFA 60008494',
    stationId: 60008494,
    systemId: 30002187,
    regionId: 10000043,
    regionName: 'Domain',
    security: 1.0,
    isLowSec: false,
    accentColor: '#F5B841',
  },
  {
    id: 'dodixie',
    name: 'Dodixie IX-20',
    shortName: 'Dodixie',
    stationName: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
    stationCode: 'FNAP 60011866',
    stationId: 60011866,
    systemId: 30002659,
    regionId: 10000032,
    regionName: 'Sinq Laison',
    security: 0.9,
    isLowSec: false,
    accentColor: '#46E595',
  },
  {
    id: 'rens',
    name: 'Rens VI-8',
    shortName: 'Rens',
    stationName: 'Rens VI - Moon 8 - Brutor Tribe Treasury',
    stationCode: 'BTT 60004588',
    stationId: 60004588,
    systemId: 30002510,
    regionId: 10000030,
    regionName: 'Heimatar',
    security: 0.9,
    isLowSec: false,
    accentColor: '#E07A63',
  },
  {
    id: 'hek',
    name: 'Hek VIII-12',
    shortName: 'Hek',
    stationName: 'Hek VIII - Moon 12 - Boundless Creation Factory',
    stationCode: 'BCF 60005686',
    stationId: 60005686,
    systemId: 30002053,
    regionId: 10000042,
    regionName: 'Metropolis',
    security: 0.5,
    isLowSec: false,
    accentColor: '#60A5FA',
  },
  {
    id: 'amamake',
    name: 'Amamake',
    shortName: 'Amamake',
    stationName: 'Amamake System NPC Stations',
    stationCode: 'SYS 30002537 · LS',
    stationId: null,
    systemId: 30002537,
    regionId: 10000030,
    regionName: 'Heimatar',
    security: 0.4,
    isLowSec: true,
    accentColor: '#FF4D6D',
  },
];

const HUB_BY_ID = new Map<HubId, TradeHubDefinition>(TRADE_HUBS.map((h) => [h.id, h]));

export function isHubId(val: unknown): val is HubId {
  return typeof val === 'string' && HUB_BY_ID.has(val as HubId);
}

export function resolveHubId(raw: unknown): HubId {
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase() as HubId;
    if (HUB_BY_ID.has(normalized)) return normalized;
  }
  return DEFAULT_HUB_ID;
}

export function getHubById(id: HubId): TradeHubDefinition {
  return HUB_BY_ID.get(id) ?? TRADE_HUBS[0];
}

export function getHubsByRegion(regionId: number): TradeHubDefinition[] {
  return TRADE_HUBS.filter((h) => h.regionId === regionId);
}

export function getUniqueHubRegions(): number[] {
  const seen = new Set<number>();
  const regions: number[] = [];
  for (const h of TRADE_HUBS) {
    if (!seen.has(h.regionId)) {
      seen.add(h.regionId);
      regions.push(h.regionId);
    }
  }
  return regions;
}

export function matchOrderToHubs(order: {
  location_id: number;
  system_id?: number;
}): HubId[] {
  const matched: HubId[] = [];
  for (const hub of TRADE_HUBS) {
    if (hub.stationId !== null) {
      if (order.location_id === hub.stationId) {
        matched.push(hub.id);
      }
    } else if (order.system_id === hub.systemId) {
      matched.push(hub.id);
    }
  }
  return matched;
}

export function matchStationToHubId(locationId: number, systemId?: number): HubId | null {
  for (const hub of TRADE_HUBS) {
    if (hub.stationId !== null && locationId === hub.stationId) {
      return hub.id;
    }
  }
  if (systemId !== undefined) {
    for (const hub of TRADE_HUBS) {
      if (hub.stationId === null && systemId === hub.systemId) {
        return hub.id;
      }
    }
  }
  return null;
}

export interface HubRouteInfo {
  jumps: number;
  isLowSecRoute: boolean;
}

// Post-Niarja high-sec gate distances between major empire trade hubs,
// plus shortest routes to/from Amamake (0.4 Low-Sec).
const ROUTE_JUMPS: Record<HubId, Record<HubId, number>> = {
  jita: { jita: 0, amarr: 45, dodixie: 15, rens: 25, hek: 22, amamake: 25 },
  amarr: { jita: 45, amarr: 0, dodixie: 35, rens: 26, hek: 29, amamake: 15 },
  dodixie: { jita: 15, amarr: 35, dodixie: 0, rens: 16, hek: 13, amamake: 17 },
  rens: { jita: 25, amarr: 26, dodixie: 16, rens: 0, hek: 5, amamake: 5 },
  hek: { jita: 22, amarr: 29, dodixie: 13, rens: 5, hek: 0, amamake: 7 },
  amamake: { jita: 25, amarr: 15, dodixie: 17, rens: 5, hek: 7, amamake: 0 },
};

export function getHubRoute(from: HubId, to: HubId): HubRouteInfo {
  if (from === to) {
    return { jumps: 0, isLowSecRoute: getHubById(from).isLowSec };
  }
  const jumps = ROUTE_JUMPS[from]?.[to] ?? 0;
  const isLowSecRoute = getHubById(from).isLowSec || getHubById(to).isLowSec;
  return { jumps, isLowSecRoute };
}
