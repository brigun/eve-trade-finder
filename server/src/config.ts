import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '../..');
export const DATA_DIR = process.env.JITA_DATA_DIR
  ? path.resolve(process.env.JITA_DATA_DIR)
  : path.join(ROOT_DIR, 'data');
export const DB_PATH = path.join(DATA_DIR, 'jita-terminal.db');
export const CLIENT_DIST_DIR = process.env.JITA_CLIENT_DIST_DIR
  ? path.resolve(process.env.JITA_CLIENT_DIST_DIR)
  : path.join(ROOT_DIR, 'client', 'dist');

export const PORT = Number(process.env.PORT ?? 3001);
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

export const JITA_STATION_ID = 60003760;
export const THE_FORGE_REGION_ID = 10000002;

export const ESI_BASE_URL = 'https://esi.evetech.net/latest';
export const ESI_DATASOURCE = 'tranquility';
export const USER_AGENT =
  process.env.ESI_USER_AGENT ?? 'JitaMonolithTradeTerminal/1.0 (local-eve-trade-finder)';

export const CCP_SDE_BASE = 'https://sde.evetech.net/tranquility/latest';

export const EVE_SSO_AUTH_URL = 'https://login.eveonline.com/v2/oauth/authorize';
export const EVE_SSO_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token';
export const EVE_SSO_JWKS_URL = 'https://login.eveonline.com/oauth/jwks';

export const EVE_SSO_SCOPES = [
  'esi-skills.read_skills.v1',
  'esi-characters.read_standings.v1',
  'esi-markets.read_character_orders.v1',
];

export const EXCLUDED_DEFAULT_GROUPS = ['Ship SKINs', 'Apparel', 'Blueprints & Reactions'];
