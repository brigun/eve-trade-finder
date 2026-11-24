import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jita-sso-default-'));
process.env.JITA_DATA_DIR = tmpDir;

const { DEFAULT_EVE_SSO_CLIENT_ID, DEFAULT_EVE_SSO_REDIRECT_URI } = await import(
  '../../config.js'
);
const { getDb, initDatabase } = await import('../../db/database.js');
const { getAllSettings, updateSettings } = await import('../settingsService.js');
const { buildSsoAuthorizeUrl } = await import('../ssoService.js');

initDatabase();

after(() => {
  try {
    getDb().close();
  } catch {
    // ignore if already closed
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Built-in EVE Online SSO defaults', () => {
  it('initializes fresh DB with built-in PKCE client ID and localhost redirect URI', () => {
    const settings = getAllSettings();
    assert.equal(settings.esiClientId, DEFAULT_EVE_SSO_CLIENT_ID);
    assert.equal(settings.esiClientId, '0b1029fe56a541b9afca04a071fbff95');
    assert.equal(settings.ssoRedirectUri, 'http://localhost:3001/api/auth/callback');
  });

  it('builds EVE SSO authorization URL out of the box with PKCE S256', () => {
    const { url, state } = buildSsoAuthorizeUrl();
    assert.ok(state.length > 0);

    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, 'https://login.eveonline.com/v2/oauth/authorize');
    assert.equal(parsed.searchParams.get('client_id'), '0b1029fe56a541b9afca04a071fbff95');
    assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(parsed.searchParams.get('redirect_uri'), 'http://localhost:3001/api/auth/callback');
  });

  it('supports overriding with a custom Client ID and resetting cleanly back to built-in', () => {
    const custom = updateSettings({ esiClientId: 'custom-client-id-123' });
    assert.equal(custom.esiClientId, 'custom-client-id-123');

    const reset = updateSettings({ esiClientId: '', ssoRedirectUri: '' });
    assert.equal(reset.esiClientId, DEFAULT_EVE_SSO_CLIENT_ID);
    assert.equal(reset.ssoRedirectUri, DEFAULT_EVE_SSO_REDIRECT_URI);
  });

  it('backfills empty esi_client_id and sso_redirect_uri rows when upgrading an existing DB', () => {
    const legacyDbPath = path.join(tmpDir, 'legacy.db');
    const firstHandle = initDatabase(legacyDbPath);
    firstHandle
      .prepare("UPDATE settings SET value = '' WHERE key IN ('esi_client_id', 'sso_redirect_uri')")
      .run();
    firstHandle.close();

    const upgradedHandle: DatabaseSync = initDatabase(legacyDbPath);
    try {
      const rows = upgradedHandle
        .prepare("SELECT key, value FROM settings WHERE key IN ('esi_client_id', 'sso_redirect_uri')")
        .all() as Array<{ key: string; value: string }>;
      const map = new Map(rows.map((r) => [r.key, r.value]));
      assert.equal(map.get('esi_client_id'), DEFAULT_EVE_SSO_CLIENT_ID);
      assert.equal(map.get('sso_redirect_uri'), DEFAULT_EVE_SSO_REDIRECT_URI);
    } finally {
      upgradedHandle.close();
    }
  });
});
