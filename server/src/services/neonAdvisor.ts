import { getHubById, resolveHubId, type HubId } from '../config.js';
import { getDb } from '../db/database.js';
import {
  buildItemDto,
  getDescendantMarketGroupIds,
  getGroupScopeLabel,
  loadScannerRows,
  type MarketItemDto,
} from '../routes/market.js';
import {
  hydrateAndValidateNeonPicks,
  parseLlmJsonObject,
  selectNeonCandidates,
  type NeonSessionStyle,
  type NeonTradePick,
} from './neonAdvisorLogic.js';
import {
  getFeeConfig,
  getResolvedLlmConfig,
  type LlmThinkingLevel,
} from './settingsService.js';
import { nextEveTick } from './tradeAnalytics.js';

export interface AskNeonRequest {
  hubId?: HubId;
  budgetIsk?: number | null;
  sessionStyle?: NeonSessionStyle;
  userNote?: string;
  minRoiPct?: number;
  marketGroupId?: number | null;
  marketGroupIds?: number[];
  model?: string;
  thinkingLevel?: LlmThinkingLevel;
}

export interface LlmModelOption {
  id: string;
  displayName: string;
}

export interface NeonBriefingResponse {
  id: number;
  createdAt: string;
  hubId?: HubId;
  hubName?: string;
  provider: 'gemini' | 'openai_compat';
  model: string;
  thinkingLevel?: LlmThinkingLevel;
  scopeLabel: string;
  sessionStyle: NeonSessionStyle;
  budgetIsk: number | null;
  userNote: string;
  minRoiPct: number;
  candidateCount: number;
  sessionSummary: string;
  recommendations: NeonTradePick[];
}

const NEON_SYSTEM_PROMPT = [
  'You are Neon, an elite quantitative EVE Online station-trading advisor.',
  'Given pre-filtered live market candidates from the selected EVE trade hub, choose the TOP 3 trades for this trading session.',
  'Evaluate every pick strictly using the provided metrics:',
  '1) Unit price practicality & net ROI% after broker/tax fees,',
  '2) Order book depth (bidDepthIsk, askDepthIsk, buyOrders/sellOrders),',
  '3) 7-day sales volume (dailyIskVol7d, dailyUnits7d, volTrendPct),',
  '4) Active trader competition (topComp2Pct, updates1h).',
  'CRITICAL RULES:',
  '- Select ONLY typeId values present in the candidates array. Never invent typeIds or prices.',
  '- Return ONLY a valid JSON object matching this schema:',
  '{',
  '  "sessionSummary": "1-2 sentence overview tailored to the user session style and budget",',
  '  "recommendations": [',
  '    {',
  '      "typeId": 12345,',
  '      "headline": "Short punchy 4-7 word angle",',
  '      "rationale": "2-3 concise sentences citing exact profit, depth, volume, and competition numbers",',
  '      "executionPlan": "1-2 sentences on bid/ask sizing, order placement, and relist cadence",',
  '      "riskNote": "1 concise sentence on main market/undercut risk",',
  '      "suggestedQty": 10',
  '    }',
  '  ]',
  '}',
].join('\n');

function serializeCandidateForPrompt(item: MarketItemDto) {
  return {
    typeId: item.typeId,
    name: item.name,
    group: item.rootGroupName,
    bestBid: Math.round(item.bestBid * 100) / 100,
    bestAsk: Math.round(item.bestAsk * 100) / 100,
    netProfitPerUnit: Math.round(item.netProfit * 100) / 100,
    roiPct: Number(item.roiPct.toFixed(1)),
    estDailyProfit: item.estDailyProfit !== null ? Math.round(item.estDailyProfit) : null,
    dailyIskVol7d: item.dailyIskVolume7d !== null ? Math.round(item.dailyIskVolume7d) : null,
    dailyUnits7d:
      item.dailyVolume7d !== null ? Number(item.dailyVolume7d.toFixed(1)) : null,
    bidDepthIsk: Math.round(item.bidDepthIsk),
    askDepthIsk: Math.round(item.askDepthIsk),
    bookDepthIsk: Math.round(item.bookDepthIsk),
    buyOrders: item.buyOrderCount,
    sellOrders: item.sellOrderCount,
    topComp2Pct: item.totalCompetition,
    updates1h: item.recentUpdates1h,
    volTrendPct:
      item.volumeTrendPct !== null ? Number(item.volumeTrendPct.toFixed(1)) : null,
    priceTrendPct:
      item.priceTrendPct !== null ? Number(item.priceTrendPct.toFixed(1)) : null,
    tradeScore: item.tradeScore,
    isTrending: item.isTrending,
  };
}

const LLM_TIMEOUT_MS = 180_000;

async function callGeminiApi(
  model: string,
  apiKey: string,
  userPrompt: string,
  thinkingLevel?: LlmThinkingLevel,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const runOnce = async (includeThinkingConfig: boolean): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    try {
      const generationConfig: Record<string, unknown> = {
        temperature: 0.3,
        responseMimeType: 'application/json',
      };
      if (includeThinkingConfig && thinkingLevel) {
        generationConfig.thinkingConfig = { thinkingLevel };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: NEON_SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        if (
          res.status === 400 &&
          includeThinkingConfig &&
          /thinkingConfig|thinkingLevel|thinking_level|thinking_config/i.test(errBody)
        ) {
          return await runOnce(false);
        }
        throw new Error(`Gemini API error (${res.status}): ${errBody.slice(0, 260)}`);
      }

      const payload = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string; thought?: boolean }> };
        }>;
      };
      const parts = payload.candidates?.[0]?.content?.parts ?? [];
      const nonThoughtText = parts
        .filter((p) => !p.thought && typeof p.text === 'string')
        .map((p) => p.text)
        .join('\n')
        .trim();
      const text =
        nonThoughtText ||
        parts
          .filter((p) => typeof p.text === 'string')
          .map((p) => p.text)
          .join('\n')
          .trim();

      if (!text) {
        throw new Error('Gemini API returned no text content.');
      }
      return text;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `Neon request timed out after ${LLM_TIMEOUT_MS / 1000}s waiting for ${model}. Try setting Thinking Level to LOW or switching to a faster model (e.g. gemini-3.8-flash).`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  return await runOnce(/^gemini-[34]/i.test(model));
}

async function callOpenAiCompatApi(
  baseUrl: string,
  model: string,
  apiKey: string,
  userPrompt: string,
): Promise<string> {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: NEON_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`LLM endpoint error (${res.status}): ${errBody.slice(0, 260)}`);
    }

    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content ?? '';
    if (!text) {
      throw new Error('LLM endpoint returned empty choice content.');
    }
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        `Neon request timed out after ${LLM_TIMEOUT_MS / 1000}s waiting for ${model}. Try a faster model or check your local LLM endpoint.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const CURATED_GEMINI_MODELS: LlmModelOption[] = [
  { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.6-flash', displayName: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite' },
  { id: 'gemini-3-pro-preview', displayName: 'Gemini 3 Pro Preview' },
  { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
];

const CURATED_COMPAT_MODELS: LlmModelOption[] = [
  { id: 'llama3.2', displayName: 'llama3.2 (Ollama)' },
  { id: 'qwen2.5:14b', displayName: 'qwen2.5:14b (Ollama)' },
  { id: 'mistral', displayName: 'mistral (Ollama)' },
];

function ensureActiveModelInList(
  list: LlmModelOption[],
  activeModel: string,
): LlmModelOption[] {
  if (!activeModel || list.some((m) => m.id === activeModel)) return list;
  return [{ id: activeModel, displayName: activeModel }, ...list];
}

export async function listAvailableLlmModels(): Promise<{
  provider: 'gemini' | 'openai_compat';
  activeModel: string;
  source: 'live' | 'fallback';
  models: LlmModelOption[];
}> {
  const cfg = getResolvedLlmConfig();

  if (cfg.provider === 'gemini') {
    if (!cfg.apiKey) {
      return {
        provider: cfg.provider,
        activeModel: cfg.model,
        source: 'fallback',
        models: ensureActiveModelInList(CURATED_GEMINI_MODELS, cfg.model),
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
        {
          headers: { 'x-goog-api-key': cfg.apiKey },
          signal: controller.signal,
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as {
        models?: Array<{
          name?: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
        }>;
      };

      const live = (payload.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => {
          const id = (m.name ?? '').replace(/^models\//, '').trim();
          return { id, displayName: (m.displayName ?? id).trim() };
        })
        .filter(
          (m) =>
            m.id.length > 0 &&
            !m.id.includes('embedding') &&
            !m.id.includes('tts') &&
            !m.id.includes('image'),
        )
        .sort((a, b) => b.id.localeCompare(a.id));

      if (live.length > 0) {
        return {
          provider: cfg.provider,
          activeModel: cfg.model,
          source: 'live',
          models: ensureActiveModelInList(live, cfg.model),
        };
      }
    } catch {
      // fall through to curated list
    } finally {
      clearTimeout(timer);
    }

    return {
      provider: cfg.provider,
      activeModel: cfg.model,
      source: 'fallback',
      models: ensureActiveModelInList(CURATED_GEMINI_MODELS, cfg.model),
    };
  }

  // OpenAI-compatible / Local Ollama discovery
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const endpoint = `${cfg.baseUrl.replace(/\/+$/, '')}/models`;
    const headers: Record<string, string> = {};
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    const res = await fetch(endpoint, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as { data?: Array<{ id?: string }> };
    const live = (payload.data ?? [])
      .map((m) => (m.id ?? '').trim())
      .filter(Boolean)
      .map((id) => ({ id, displayName: id }));

    if (live.length > 0) {
      return {
        provider: cfg.provider,
        activeModel: cfg.model,
        source: 'live',
        models: ensureActiveModelInList(live, cfg.model),
      };
    }
  } catch {
    // fall through to curated compat list
  } finally {
    clearTimeout(timer);
  }

  return {
    provider: cfg.provider,
    activeModel: cfg.model,
    source: 'fallback',
    models: ensureActiveModelInList(CURATED_COMPAT_MODELS, cfg.model),
  };
}

export function getNeonAdvisorStatus() {
  const cfg = getResolvedLlmConfig();
  return {
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    thinkingLevel: cfg.thinkingLevel,
    configured: cfg.provider === 'openai_compat' ? Boolean(cfg.baseUrl) : Boolean(cfg.apiKey),
    keySource: cfg.keySource,
  };
}

export function getLatestNeonBriefing(): NeonBriefingResponse | null {
  const db = getDb();
  const row = db
    .prepare('SELECT response_json FROM neon_briefings ORDER BY id DESC LIMIT 1')
    .get() as { response_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.response_json) as NeonBriefingResponse;
  } catch {
    return null;
  }
}

export async function consultNeon(req: AskNeonRequest): Promise<NeonBriefingResponse> {
  const llm = getResolvedLlmConfig();
  if (llm.provider === 'gemini' && !llm.apiKey) {
    throw new Error(
      'Gemini API key is not configured. Add your Gemini API key in Settings (or switch LLM Provider to Local Ollama / OpenAI-Compatible).',
    );
  }

  const db = getDb();
  const fees = getFeeConfig();
  const hub = getHubById(resolveHubId(req.hubId));
  const rawRows = loadScannerRows(hub.id);
  if (rawRows.length === 0) {
    throw new Error(`No ${hub.name} market data synced yet. Click Sync ${hub.shortName} first.`);
  }

  const targetGroupIds = [
    ...(req.marketGroupId !== undefined && req.marketGroupId !== null && req.marketGroupId > 0
      ? [Math.floor(req.marketGroupId)]
      : []),
    ...(Array.isArray(req.marketGroupIds)
      ? req.marketGroupIds.filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.floor(n))
      : []),
  ];

  const allowedGroupIds =
    targetGroupIds.length > 0 ? getDescendantMarketGroupIds(db, targetGroupIds) : null;

  const scopedDtos: MarketItemDto[] = [];
  for (const row of rawRows) {
    const dto = buildItemDto(row, fees);
    if (allowedGroupIds !== null) {
      if (dto.marketGroupId === null || !allowedGroupIds.has(dto.marketGroupId)) continue;
    }
    scopedDtos.push(dto);
  }

  const minRoiPct =
    typeof req.minRoiPct === 'number' && Number.isFinite(req.minRoiPct) ? req.minRoiPct : 10;
  const budgetIsk =
    typeof req.budgetIsk === 'number' && Number.isFinite(req.budgetIsk) && req.budgetIsk > 0
      ? req.budgetIsk
      : null;
  const sessionStyle: NeonSessionStyle =
    req.sessionStyle === 'quick_flip' || req.sessionStyle === 'overnight'
      ? req.sessionStyle
      : 'balanced';
  const userNote = typeof req.userNote === 'string' ? req.userNote.trim().slice(0, 300) : '';

  const candidates = selectNeonCandidates(scopedDtos, {
    minRoiPct,
    budgetIsk,
    sessionStyle,
    explicitGroupFilter: targetGroupIds.length > 0,
    limit: 15,
  });

  if (candidates.length === 0) {
    throw new Error(
      `No ${hub.name} items matched your current segment, budget, and minimum ROI constraints.`,
    );
  }

  const scopeLabel = getGroupScopeLabel(db, targetGroupIds, hub.id);
  const userPrompt = JSON.stringify({
    sessionContext: {
      hubId: hub.id,
      hubName: hub.name,
      station: hub.stationName,
      region: hub.regionName,
      security: hub.security,
      scopeLabel,
      sessionStyle,
      budgetIsk,
      minRoiPct,
      brokerFeePct: fees.brokerFeePct,
      salesTaxPct: fees.salesTaxPct,
      userNote: userNote || null,
    },
    candidates: candidates.map(serializeCandidateForPrompt),
  });

  const effectiveModel = req.model?.trim() || llm.model;
  const effectiveThinkingLevel = req.thinkingLevel ?? llm.thinkingLevel;

  const rawText =
    llm.provider === 'gemini'
      ? await callGeminiApi(effectiveModel, llm.apiKey, userPrompt, effectiveThinkingLevel)
      : await callOpenAiCompatApi(llm.baseUrl, effectiveModel, llm.apiKey, userPrompt);

  const parsed = parseLlmJsonObject(rawText);
  const hydrated = hydrateAndValidateNeonPicks(parsed, candidates, {
    budgetIsk,
    tickFn: nextEveTick,
  });

  const createdAt = new Date().toISOString();
  const briefingWithoutId = {
    createdAt,
    hubId: hub.id,
    hubName: hub.name,
    provider: llm.provider,
    model: effectiveModel,
    thinkingLevel: effectiveThinkingLevel,
    scopeLabel,
    sessionStyle,
    budgetIsk,
    userNote,
    minRoiPct,
    candidateCount: candidates.length,
    sessionSummary: hydrated.sessionSummary,
    recommendations: hydrated.recommendations,
  };

  const insertRes = db
    .prepare(`
      INSERT INTO neon_briefings (
        created_at, provider, model, scope_label, session_style, budget_isk, user_note, response_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      createdAt,
      llm.provider,
      effectiveModel,
      scopeLabel,
      sessionStyle,
      budgetIsk,
      userNote,
      JSON.stringify(briefingWithoutId),
    );

  const id = Number(insertRes.lastInsertRowid);
  const fullBriefing: NeonBriefingResponse = { id, ...briefingWithoutId };
  db.prepare('UPDATE neon_briefings SET response_json = ? WHERE id = ?').run(
    JSON.stringify(fullBriefing),
    id,
  );
  db.prepare(
    'DELETE FROM neon_briefings WHERE id NOT IN (SELECT id FROM neon_briefings ORDER BY id DESC LIMIT 20)',
  ).run();

  return fullBriefing;
}
