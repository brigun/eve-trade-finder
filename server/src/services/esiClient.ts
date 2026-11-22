import { ESI_BASE_URL, ESI_DATASOURCE, USER_AGENT } from '../config.js';

export interface EsiRateState {
  errorLimitRemain: number;
  errorLimitResetSec: number;
  lastUpdated: string | null;
}

export class EsiHttpError extends Error {
  status: number;
  url: string;
  body: string;

  constructor(status: number, url: string, body: string) {
    super(`ESI HTTP ${status} for ${url}: ${body.slice(0, 200)}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

const rateState: EsiRateState = {
  errorLimitRemain: 100,
  errorLimitResetSec: 60,
  lastUpdated: null,
};

export function getEsiRateState(): EsiRateState {
  return { ...rateState };
}

function updateRateHeaders(headers: Headers): void {
  const remainRaw = headers.get('x-esi-error-limit-remain');
  const resetRaw = headers.get('x-esi-error-limit-reset');
  if (remainRaw !== null) {
    const parsed = Number(remainRaw);
    if (Number.isFinite(parsed)) rateState.errorLimitRemain = parsed;
  }
  if (resetRaw !== null) {
    const parsed = Number(resetRaw);
    if (Number.isFinite(parsed)) rateState.errorLimitResetSec = parsed;
  }
  rateState.lastUpdated = new Date().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface EsiFetchResult<T> {
  data: T;
  headers: Headers;
  status: number;
}

export async function esiFetchJson<T>(
  pathOrUrl: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    token?: string;
    retries?: number;
    allowNotFound?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<EsiFetchResult<T>> {
  const {
    method = 'GET',
    body,
    token,
    retries = 3,
    allowNotFound = false,
    timeoutMs = 20_000,
  } = options;

  let url = pathOrUrl.startsWith('http') ? pathOrUrl : `${ESI_BASE_URL}${pathOrUrl}`;
  if (!url.includes('datasource=')) {
    url += (url.includes('?') ? '&' : '?') + `datasource=${ESI_DATASOURCE}`;
  }

  let attempt = 0;
  while (true) {
    if (rateState.errorLimitRemain < 12) {
      throw new Error(
        `ESI error limit critically low (${rateState.errorLimitRemain} remaining; resets in ${rateState.errorLimitResetSec}s)`,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);
      updateRateHeaders(response.headers);

      if (response.status === 404 && allowNotFound) {
        return {
          data: [] as unknown as T,
          headers: response.headers,
          status: 404,
        };
      }

      if (response.status === 420) {
        const waitSec = Math.min(60, Math.max(5, rateState.errorLimitResetSec));
        throw new Error(`ESI 420 rate-limited; retry after ${waitSec}s`);
      }

      if (response.ok) {
        const text = await response.text();
        const parsed = (text ? JSON.parse(text) : null) as T;
        return { data: parsed, headers: response.headers, status: response.status };
      }

      const errBody = await response.text().catch(() => '');
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < retries) {
        attempt++;
        const retryAfter = Number(response.headers.get('retry-after') ?? 0);
        const delayMs = retryAfter > 0 ? retryAfter * 1000 : 400 * Math.pow(2, attempt);
        await sleep(delayMs);
        continue;
      }

      throw new EsiHttpError(response.status, url, errBody);
    } catch (err) {
      clearTimeout(timer);
      const isAbortOrNet =
        err instanceof Error &&
        (err.name === 'AbortError' || err.name === 'TypeError' || /fetch failed/i.test(err.message));

      if (isAbortOrNet && attempt < retries) {
        attempt++;
        await sleep(400 * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
}

export async function fetchTextWithTimeout(url: string, timeoutMs = 45_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} downloading ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
