import crypto from 'node:crypto';
import {
  EVE_SSO_AUTH_URL,
  EVE_SSO_JWKS_URL,
  EVE_SSO_SCOPES,
  EVE_SSO_TOKEN_URL,
  JITA_STATION_ID,
} from '../config.js';
import { getDb, withTransaction } from '../db/database.js';
import { esiFetchJson } from './esiClient.js';
import { getAllSettings, updateSettings } from './settingsService.js';
import { calculateEveFees } from './tradeAnalytics.js';

interface PendingPkce {
  codeVerifier: string;
  createdAt: number;
}

interface SsoSessionRow {
  character_id: number;
  character_name: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scopes: string;
  updated_at: string;
}

interface JwkKey extends crypto.JsonWebKey {
  kid: string;
}

const pendingAuth = new Map<string, PendingPkce>();

function cleanupPendingAuth(): void {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [state, entry] of pendingAuth.entries()) {
    if (entry.createdAt < cutoff) pendingAuth.delete(state);
  }
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Buffer {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

export function buildSsoAuthorizeUrl(): { url: string; state: string } {
  const settings = getAllSettings();
  const clientId = settings.esiClientId.trim();
  if (!clientId) {
    throw new Error('Configure your EVE Developer Client ID in Settings before connecting EVE SSO.');
  }

  cleanupPendingAuth();
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  const codeChallenge = base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = base64UrlEncode(crypto.randomBytes(18));

  pendingAuth.set(state, { codeVerifier, createdAt: Date.now() });

  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: settings.ssoRedirectUri.trim(),
    client_id: clientId,
    scope: EVE_SSO_SCOPES.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  return {
    url: `${EVE_SSO_AUTH_URL}?${params.toString()}`,
    state,
  };
}

async function verifyEveJwt(accessToken: string): Promise<{
  characterId: number;
  characterName: string;
  scopes: string[];
}> {
  const parts = accessToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed EVE SSO JWT token');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(base64UrlDecode(headerB64).toString('utf8')) as {
    kid?: string;
    alg?: string;
  };
  const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as {
    sub?: string;
    name?: string;
    scp?: string | string[];
    iss?: string;
    exp?: number;
  };

  if (payload.iss !== 'login.eveonline.com' && payload.iss !== 'https://login.eveonline.com') {
    throw new Error(`Unexpected EVE SSO issuer: ${payload.iss}`);
  }
  if (payload.exp && payload.exp * 1000 < Date.now() - 60_000) {
    throw new Error('EVE SSO access token is already expired');
  }

  const jwksRes = await fetch(EVE_SSO_JWKS_URL);
  if (!jwksRes.ok) {
    throw new Error(`Failed to fetch EVE JWKS (${jwksRes.status})`);
  }
  const jwks = (await jwksRes.json()) as { keys: JwkKey[] };
  const key = jwks.keys.find((k) => k.kid === header.kid);
  if (!key) {
    throw new Error('Matching EVE SSO JWKS signing key not found');
  }

  const publicKey = crypto.createPublicKey({ key: key as crypto.JsonWebKey, format: 'jwk' });
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const signature = base64UrlDecode(sigB64);

  const alg = header.alg === 'ES256' ? 'sha256' : 'sha256';
  const verified = crypto.verify(
    alg,
    signingInput,
    header.alg === 'ES256' ? { key: publicKey, dsaEncoding: 'ieee-p1363' } : publicKey,
    signature,
  );
  if (!verified) {
    throw new Error('EVE SSO JWT signature verification failed');
  }

  const subParts = (payload.sub ?? '').split(':');
  const characterId = Number(subParts[2]);
  if (!Number.isFinite(characterId) || characterId <= 0) {
    throw new Error(`Invalid EVE character subject: ${payload.sub}`);
  }

  const scopes = Array.isArray(payload.scp)
    ? payload.scp
    : typeof payload.scp === 'string'
      ? payload.scp.split(' ')
      : [];

  return {
    characterId,
    characterName: payload.name ?? `Pilot #${characterId}`,
    scopes,
  };
}

export async function handleSsoCallback(code: string, state: string): Promise<SsoSessionRow> {
  const pending = pendingAuth.get(state);
  if (!pending) {
    throw new Error('Invalid or expired SSO state parameter. Please initiate login again.');
  }
  pendingAuth.delete(state);

  const settings = getAllSettings();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: settings.esiClientId.trim(),
    code_verifier: pending.codeVerifier,
  });

  const tokenRes = await fetch(EVE_SSO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Host: 'login.eveonline.com',
    },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '');
    throw new Error(`EVE SSO token exchange failed (${tokenRes.status}): ${errText}`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const identity = await verifyEveJwt(tokens.access_token);
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const db = getDb();
  withTransaction(db, () => {
    db.prepare('DELETE FROM sso_sessions').run();
    db.prepare(`
      INSERT INTO sso_sessions (
        character_id, character_name, access_token, refresh_token, expires_at, scopes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      identity.characterId,
      identity.characterName,
      tokens.access_token,
      tokens.refresh_token,
      expiresAt,
      identity.scopes.join(' '),
      nowIso,
    );
  });

  await syncCharacterData();
  return getActiveSession()!;
}

export function getActiveSession(): SsoSessionRow | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM sso_sessions ORDER BY updated_at DESC LIMIT 1')
    .get() as SsoSessionRow | undefined;
  return row ? { ...row } : null;
}

export function disconnectSso(): void {
  const db = getDb();
  withTransaction(db, () => {
    db.prepare('DELETE FROM sso_sessions').run();
    db.prepare('DELETE FROM character_orders').run();
  });
}

async function getValidAccessToken(session: SsoSessionRow): Promise<string> {
  if (Date.parse(session.expires_at) > Date.now() + 60_000) {
    return session.access_token;
  }

  const settings = getAllSettings();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: session.refresh_token,
    client_id: settings.esiClientId.trim(),
  });

  const res = await fetch(EVE_SSO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error('Failed to refresh EVE SSO token; please reconnect your character.');
  }

  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const expiresAt = new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString();
  const db = getDb();
  db.prepare(
    'UPDATE sso_sessions SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ? WHERE character_id = ?',
  ).run(
    tokens.access_token,
    tokens.refresh_token ?? session.refresh_token,
    expiresAt,
    new Date().toISOString(),
    session.character_id,
  );

  return tokens.access_token;
}

export async function syncCharacterData(): Promise<{
  characterId: number;
  characterName: string;
  accountingLevel: number;
  brokerRelationsLevel: number;
  factionStanding: number;
  corpStanding: number;
  jitaOrdersCount: number;
}> {
  const session = getActiveSession();
  if (!session) {
    throw new Error('No active EVE SSO session');
  }

  const token = await getValidAccessToken(session);
  const charId = session.character_id;

  const [skillsRes, standingsRes, ordersRes] = await Promise.all([
    esiFetchJson<{ skills: Array<{ skill_id: number; active_skill_level: number }> }>(
      `/characters/${charId}/skills/`,
      { token },
    ),
    esiFetchJson<Array<{ from_id: number; from_type: string; standing: number }>>(
      `/characters/${charId}/standings/`,
      { token },
    ),
    esiFetchJson<
      Array<{
        order_id: number;
        type_id: number;
        location_id: number;
        is_buy_order?: boolean;
        price: number;
        volume_remain: number;
        volume_total: number;
        issued: string;
        escrow?: number;
      }>
    >(`/characters/${charId}/orders/`, { token }),
  ]);

  const accountingSkill = skillsRes.data.skills?.find((s) => s.skill_id === 16622);
  const brokerSkill = skillsRes.data.skills?.find((s) => s.skill_id === 3446);
  const accountingLevel = accountingSkill?.active_skill_level ?? 0;
  const brokerRelationsLevel = brokerSkill?.active_skill_level ?? 0;

  // Caldari State (500001) & Caldari Navy (1000035) govern Jita 4-4 CNAP station broker fees
  const caldariFaction = standingsRes.data.find(
    (s) => s.from_type === 'faction' && s.from_id === 500001,
  );
  const caldariNavyCorp = standingsRes.data.find(
    (s) => s.from_type === 'npc_corp' && s.from_id === 1000035,
  );

  const factionStanding = Number((caldariFaction?.standing ?? 0).toFixed(2));
  const corpStanding = Number((caldariNavyCorp?.standing ?? 0).toFixed(2));

  const fees = calculateEveFees({
    accountingLevel,
    brokerRelationsLevel,
    factionStanding,
    corpStanding,
  });

  updateSettings({
    accountingLevel,
    brokerRelationsLevel,
    factionStanding,
    corpStanding,
    brokerFeePct: fees.brokerFeePct,
    salesTaxPct: fees.salesTaxPct,
  });

  const jitaCharOrders = (ordersRes.data ?? []).filter((o) => o.location_id === JITA_STATION_ID);
  const db = getDb();
  const nowIso = new Date().toISOString();

  withTransaction(db, () => {
    db.prepare('DELETE FROM character_orders WHERE character_id = ?').run(charId);
    const insert = db.prepare(`
      INSERT INTO character_orders (
        order_id, character_id, type_id, is_buy_order, price, volume_remain, volume_total, issued, escrow, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const o of jitaCharOrders) {
      insert.run(
        o.order_id,
        charId,
        o.type_id,
        o.is_buy_order ? 1 : 0,
        o.price,
        o.volume_remain,
        o.volume_total,
        o.issued,
        o.escrow ?? 0,
        nowIso,
      );
    }
  });

  return {
    characterId: charId,
    characterName: session.character_name,
    accountingLevel,
    brokerRelationsLevel,
    factionStanding,
    corpStanding,
    jitaOrdersCount: jitaCharOrders.length,
  };
}
