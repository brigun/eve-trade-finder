import { APP_VERSION, GITHUB_REPO, UPDATE_USER_AGENT } from '../config.js';

export interface UpdateCheckResult {
  status: 'ok' | 'error';
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseName: string | null;
  releaseUrl: string;
  publishedAt: string | null;
  releaseNotes: string | null;
  checkedAt: string;
  cached: boolean;
  source: 'github_api' | 'github_redirect' | 'none';
  error?: string;
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

interface GitHubLatestReleasePayload {
  tag_name?: string;
  name?: string | null;
  html_url?: string;
  published_at?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RELEASE_NOTES_LENGTH = 600;

interface CacheEntry {
  expiresAt: number;
  result: UpdateCheckResult;
}

const updateCache = new Map<string, CacheEntry>();

export function clearUpdateCheckCache(): void {
  updateCache.clear();
}

export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '');
}

function parseSemver(raw: string): ParsedSemver | null {
  const normalized = normalizeVersion(raw);
  if (!normalized) return null;
  const withoutBuild = normalized.split('+', 1)[0];
  const dashIdx = withoutBuild.indexOf('-');
  const corePart = dashIdx === -1 ? withoutBuild : withoutBuild.slice(0, dashIdx);
  const prePart = dashIdx === -1 ? '' : withoutBuild.slice(dashIdx + 1);

  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(corePart);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: prePart ? prePart.split('.').filter(Boolean) : [],
  };
}

function comparePrereleaseIdentifiers(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  // A stable version (no prerelease) is greater than a prerelease.
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const left = a[i];
    const right = b[i];
    if (left === right) continue;

    const leftNum = /^\d+$/.test(left) ? Number(left) : null;
    const rightNum = /^\d+$/.test(right) ? Number(right) : null;
    if (leftNum !== null && rightNum !== null) {
      return leftNum < rightNum ? -1 : 1;
    }
    if (leftNum !== null) return -1;
    if (rightNum !== null) return 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

export function compareSemver(a: string, b: string): number {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (!parsedA || !parsedB) return 0;

  if (parsedA.major !== parsedB.major) return parsedA.major < parsedB.major ? -1 : 1;
  if (parsedA.minor !== parsedB.minor) return parsedA.minor < parsedB.minor ? -1 : 1;
  if (parsedA.patch !== parsedB.patch) return parsedA.patch < parsedB.patch ? -1 : 1;

  return comparePrereleaseIdentifiers(parsedA.prerelease, parsedB.prerelease);
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}

function trimReleaseNotes(body: string | null | undefined): string | null {
  if (typeof body !== 'string') return null;
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (trimmed.length <= MAX_RELEASE_NOTES_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_RELEASE_NOTES_LENGTH - 1).trimEnd()}…`;
}

async function checkViaRedirect(
  repo: string,
  currentVersion: string,
  defaultReleasesUrl: string,
  checkedAt: string,
  fetchFn: typeof fetch,
): Promise<UpdateCheckResult | null> {
  try {
    const res = await fetchFn(`https://github.com/${repo}/releases/latest`, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': UPDATE_USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const location = res.headers.get('location');
    if (!location) return null;

    const match = /\/releases\/tag\/([^/?#]+)/.exec(location);
    if (!match) return null;

    const tag = decodeURIComponent(match[1]);
    const latestVersion = normalizeVersion(tag);
    if (!parseSemver(latestVersion)) return null;

    return {
      status: 'ok',
      currentVersion,
      latestVersion,
      updateAvailable: isNewerVersion(latestVersion, currentVersion),
      releaseName: null,
      releaseUrl: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`,
      publishedAt: null,
      releaseNotes: null,
      checkedAt,
      cached: false,
      source: 'github_redirect',
    };
  } catch {
    return null;
  }
}

export async function checkForUpdates(options?: {
  force?: boolean;
  currentVersion?: string;
  repo?: string;
  fetchFn?: typeof fetch;
  nowMs?: number;
}): Promise<UpdateCheckResult> {
  const repo = options?.repo?.trim() || GITHUB_REPO;
  const currentVersion = normalizeVersion(options?.currentVersion || APP_VERSION) || '0.0.0';
  const fetchFn = options?.fetchFn ?? fetch;
  const nowMs = options?.nowMs ?? Date.now();
  const checkedAt = new Date(nowMs).toISOString();
  const defaultReleasesUrl = `https://github.com/${repo}/releases`;
  const cacheKey = `${repo}::${currentVersion}`;

  if (!options?.force) {
    const cached = updateCache.get(cacheKey);
    if (cached && cached.expiresAt > nowMs) {
      return { ...cached.result, cached: true };
    }
  }

  try {
    const res = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': UPDATE_USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.status === 404) {
      const result: UpdateCheckResult = {
        status: 'ok',
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseName: null,
        releaseUrl: defaultReleasesUrl,
        publishedAt: null,
        releaseNotes: null,
        checkedAt,
        cached: false,
        source: 'github_api',
      };
      updateCache.set(cacheKey, { expiresAt: nowMs + CACHE_TTL_MS, result });
      return result;
    }

    if (res.status === 403 || res.status === 429) {
      const fallback = await checkViaRedirect(
        repo,
        currentVersion,
        defaultReleasesUrl,
        checkedAt,
        fetchFn,
      );
      if (fallback) {
        updateCache.set(cacheKey, { expiresAt: nowMs + CACHE_TTL_MS, result: fallback });
        return fallback;
      }
      return {
        status: 'error',
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseName: null,
        releaseUrl: defaultReleasesUrl,
        publishedAt: null,
        releaseNotes: null,
        checkedAt,
        cached: false,
        source: 'none',
        error: `GitHub API rate-limited (HTTP ${res.status})`,
      };
    }

    if (!res.ok) {
      return {
        status: 'error',
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseName: null,
        releaseUrl: defaultReleasesUrl,
        publishedAt: null,
        releaseNotes: null,
        checkedAt,
        cached: false,
        source: 'none',
        error: `GitHub returned HTTP ${res.status}`,
      };
    }

    const payload = (await res.json()) as GitHubLatestReleasePayload;
    if (payload.draft || payload.prerelease || !payload.tag_name) {
      const result: UpdateCheckResult = {
        status: 'ok',
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseName: null,
        releaseUrl: payload.html_url || defaultReleasesUrl,
        publishedAt: payload.published_at ?? null,
        releaseNotes: null,
        checkedAt,
        cached: false,
        source: 'github_api',
      };
      updateCache.set(cacheKey, { expiresAt: nowMs + CACHE_TTL_MS, result });
      return result;
    }

    const latestVersion = normalizeVersion(payload.tag_name);
    const result: UpdateCheckResult = {
      status: 'ok',
      currentVersion,
      latestVersion,
      updateAvailable: isNewerVersion(latestVersion, currentVersion),
      releaseName: payload.name?.trim() || null,
      releaseUrl: payload.html_url || defaultReleasesUrl,
      publishedAt: payload.published_at ?? null,
      releaseNotes: trimReleaseNotes(payload.body),
      checkedAt,
      cached: false,
      source: 'github_api',
    };
    updateCache.set(cacheKey, { expiresAt: nowMs + CACHE_TTL_MS, result });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'error',
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      releaseName: null,
      releaseUrl: defaultReleasesUrl,
      publishedAt: null,
      releaseNotes: null,
      checkedAt,
      cached: false,
      source: 'none',
      error: message || 'Unable to reach GitHub releases',
    };
  }
}
