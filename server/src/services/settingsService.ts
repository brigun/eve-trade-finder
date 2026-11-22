import { getDb, withTransaction } from '../db/database.js';
import type { FeeConfig } from './tradeAnalytics.js';

export type LlmProvider = 'gemini' | 'openai_compat';
export type LlmThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH';

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
  llmProvider: LlmProvider;
  llmModel: string;
  llmBaseUrl: string;
  llmThinkingLevel: LlmThinkingLevel;
  llmApiKeyConfigured: boolean;
  llmApiKeySource: 'env' | 'settings' | 'none';
}

export type SettingsUpdatePatch = Partial<
  Omit<AppSettings, 'llmApiKeyConfigured' | 'llmApiKeySource'>
> & {
  llmApiKey?: string;
  clearLlmApiKey?: boolean;
};

export interface ResolvedLlmConfig {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  thinkingLevel: LlmThinkingLevel;
  apiKey: string;
  keySource: 'env' | 'settings' | 'none';
}

function toNum(val: string | undefined, fallback: number): number {
  if (val === undefined) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function readSettingsMap(): Map<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.key, row.value);
  }
  return map;
}

export function getResolvedLlmConfig(existingMap?: Map<string, string>): ResolvedLlmConfig {
  const map = existingMap ?? readSettingsMap();
  const rawProvider = map.get('llm_provider');
  const provider: LlmProvider = rawProvider === 'openai_compat' ? 'openai_compat' : 'gemini';

  const defaultModel = provider === 'gemini' ? 'gemini-3.8-flash' : 'llama3.2';
  const model = (map.get('llm_model') ?? '').trim() || defaultModel;
  const baseUrl = (map.get('llm_base_url') ?? '').trim() || 'http://localhost:11434/v1';
  const rawThinking = (map.get('llm_thinking_level') ?? 'MEDIUM').toUpperCase();
  const thinkingLevel: LlmThinkingLevel =
    rawThinking === 'LOW' || rawThinking === 'HIGH' ? rawThinking : 'MEDIUM';

  const savedKey = (map.get('llm_api_key') ?? '').trim();
  if (savedKey) {
    return { provider, model, baseUrl, thinkingLevel, apiKey: savedKey, keySource: 'settings' };
  }

  const envKey =
    provider === 'gemini'
      ? (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim()
      : (process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '').trim();

  if (envKey) {
    return { provider, model, baseUrl, thinkingLevel, apiKey: envKey, keySource: 'env' };
  }

  return { provider, model, baseUrl, thinkingLevel, apiKey: '', keySource: 'none' };
}

export function getAllSettings(): AppSettings {
  const map = readSettingsMap();
  const llm = getResolvedLlmConfig(map);

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
    llmProvider: llm.provider,
    llmModel: llm.model,
    llmBaseUrl: llm.baseUrl,
    llmThinkingLevel: llm.thinkingLevel,
    llmApiKeyConfigured: Boolean(llm.apiKey),
    llmApiKeySource: llm.keySource,
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

export function updateSettings(partial: SettingsUpdatePatch): AppSettings {
  const db = getDb();
  const keyMap: Record<
    Exclude<keyof SettingsUpdatePatch, 'llmApiKey' | 'clearLlmApiKey'>,
    string
  > = {
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
    llmProvider: 'llm_provider',
    llmModel: 'llm_model',
    llmBaseUrl: 'llm_base_url',
    llmThinkingLevel: 'llm_thinking_level',
  };

  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );

  withTransaction(db, () => {
    for (const [prop, dbKey] of Object.entries(keyMap) as Array<
      [keyof typeof keyMap, string]
    >) {
      const val = partial[prop];
      if (val === undefined) continue;
      if (typeof val === 'number' && !Number.isFinite(val)) continue;
      upsert.run(dbKey, String(val));
    }

    if (partial.clearLlmApiKey) {
      upsert.run('llm_api_key', '');
    } else if (typeof partial.llmApiKey === 'string' && partial.llmApiKey.trim()) {
      upsert.run('llm_api_key', partial.llmApiKey.trim());
    }
  });

  return getAllSettings();
}
