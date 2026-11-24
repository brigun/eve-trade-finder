import type { HubId } from '../types/api.ts';

export interface ClientHubMeta {
  id: HubId;
  name: string;
  shortName: string;
  stationName: string;
  stationCode: string;
  regionName: string;
  security: number;
  isLowSec: boolean;
  accentColor: string;
}

export const HUB_LIST: ClientHubMeta[] = [
  {
    id: 'jita',
    name: 'Jita 4-4',
    shortName: 'Jita',
    stationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    stationCode: 'CNAP 60003760',
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
    regionName: 'Heimatar',
    security: 0.4,
    isLowSec: true,
    accentColor: '#FF4D6D',
  },
];

const HUB_MAP = new Map<HubId, ClientHubMeta>(HUB_LIST.map((h) => [h.id, h]));

export function isValidHubId(val: unknown): val is HubId {
  return typeof val === 'string' && HUB_MAP.has(val as HubId);
}

export function getHubMeta(id: HubId): ClientHubMeta {
  return HUB_MAP.get(id) ?? HUB_LIST[0];
}
