import { getDb, withTransaction } from '../db/database.js';
import type { FeeConfig } from './tradeAnalytics.js';

export interface AppSettings {
  brokerFeePct: number;
  salesTaxPct: number;
  accountingLevel: number;
  brokerRelationsLevel: number;
  factionStanding: number;
  corpStanding: number;
  autoSyncEnabled: boolean;
  autoSyncIntervalMin: number;
  captureSharePct: number;
  esiClientId: string;
  ssoRedirectUri: string;
}

function toNum(val: string | undefined, fallback: number): number {
  if (val === undefined) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export function getAllSettings(): AppSettings {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.key, row.value);
  }

  return {
    brokerFeePct: toNum(map.get('broker_fee_pct'), 3.0),
    salesTaxPct: toNum(map.get('sales_tax_pct'), 7.5),
    accountingLevel: toNum(map.get('accounting_level'), 0),
    brokerRelationsLevel: toNum(map.get('broker_relations_level'), 0),
    factionStanding: toNum(map.get('faction_standing'), 0),
    corpStanding: toNum(map.get('corp_standing'), 0),
    autoSyncEnabled: (map.get('auto_sync_enabled') ?? 'true') === 'true',
    autoSyncIntervalMin: Math.max(5, Math.round(toNum(map.get('auto_sync_interval_min'), 15))),
    captureSharePct: Math.min(100, Math.max(1, toNum(map.get('capture_share_pct'), 15))),
    esiClientId: map.get('esi_client_id') ?? '',
    ssoRedirectUri: map.get('sso_redirect_uri') ?? 'http://localhost:3001/api/auth/callback',
  };
}

export function getFeeConfig(): FeeConfig {
  const s = getAllSettings();
  return {
    brokerFeePct: s.brokerFeePct,
    salesTaxPct: s.salesTaxPct,
    captureSharePct: s.captureSharePct,
  };
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const db = getDb();
  const keyMap: Record<keyof AppSettings, string> = {
    brokerFeePct: 'broker_fee_pct',
    salesTaxPct: 'sales_tax_pct',
    accountingLevel: 'accounting_level',
    brokerRelationsLevel: 'broker_relations_level',
    factionStanding: 'faction_standing',
    corpStanding: 'corp_standing',
    autoSyncEnabled: 'auto_sync_enabled',
    autoSyncIntervalMin: 'auto_sync_interval_min',
    captureSharePct: 'capture_share_pct',
    esiClientId: 'esi_client_id',
    ssoRedirectUri: 'sso_redirect_uri',
  };

  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );

  withTransaction(db, () => {
    for (const [prop, dbKey] of Object.entries(keyMap) as Array<[keyof AppSettings, string]>) {
      const val = partial[prop];
      if (val === undefined) continue;
      if (typeof val === 'number' && !Number.isFinite(val)) continue;
      upsert.run(dbKey, String(val));
    }
  });

  return getAllSettings();
}
