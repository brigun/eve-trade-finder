import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkForUpdates,
  clearUpdateCheckCache,
  compareSemver,
  isNewerVersion,
  normalizeVersion,
} from '../updateService.js';

afterEach(() => {
  clearUpdateCheckCache();
});

describe('semver helpers', () => {
  it('normalizes leading v prefix and whitespace', () => {
    assert.equal(normalizeVersion(' v1.2.3 '), '1.2.3');
    assert.equal(normalizeVersion('V2.0.0-beta.1'), '2.0.0-beta.1');
    assert.equal(normalizeVersion('1.1.1'), '1.1.1');
  });

  it('compares major, minor, patch, and prerelease versions accurately', () => {
    assert.equal(compareSemver('1.1.2', '1.1.1'), 1);
    assert.equal(compareSemver('1.2.0', '1.1.9'), 1);
    assert.equal(compareSemver('2.0.0', '1.9.9'), 1);
    assert.equal(compareSemver('1.1.1', '1.1.1'), 0);
    assert.equal(compareSemver('1.1.0', '1.1.1'), -1);

    assert.equal(compareSemver('1.2.0', '1.2.0-beta.1'), 1);
    assert.equal(compareSemver('1.2.0-beta.2', '1.2.0-beta.1'), 1);
    assert.equal(compareSemver('1.2.0-alpha.1', '1.2.0-beta.1'), -1);

    assert.equal(isNewerVersion('v1.1.2', '1.1.1'), true);
    assert.equal(isNewerVersion('v1.1.1', '1.1.1'), false);
    assert.equal(isNewerVersion('v1.1.0', '1.1.1'), false);
    assert.equal(isNewerVersion('invalid', '1.1.1'), false);
  });
});

describe('checkForUpdates', () => {
  it('detects a newer release from GitHub API and sends a User-Agent header', async () => {
    let capturedHeaders: Headers | undefined;
    let capturedUrl = '';

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          tag_name: 'v1.2.0',
          name: 'Release 1.2.0',
          html_url: 'https://github.com/brigun/eve-trade-finder/releases/tag/v1.2.0',
          published_at: '2026-11-25T18:00:00Z',
          body: 'Added update checker.',
          draft: false,
          prerelease: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const res = await checkForUpdates({
      currentVersion: '1.1.1',
      repo: 'brigun/eve-trade-finder',
      fetchFn: mockFetch,
      nowMs: 1_000_000,
    });

    assert.equal(capturedUrl, 'https://api.github.com/repos/brigun/eve-trade-finder/releases/latest');
    assert.ok(capturedHeaders?.get('user-agent')?.startsWith('JitaMonolithTradeTerminal/'));
    assert.equal(res.status, 'ok');
    assert.equal(res.currentVersion, '1.1.1');
    assert.equal(res.latestVersion, '1.2.0');
    assert.equal(res.updateAvailable, true);
    assert.equal(res.releaseName, 'Release 1.2.0');
    assert.equal(res.source, 'github_api');
    assert.equal(res.cached, false);
  });

  it('reports updateAvailable=false when already on latest or newer', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          tag_name: 'v1.1.1',
          html_url: 'https://github.com/brigun/eve-trade-finder/releases/tag/v1.1.1',
          draft: false,
          prerelease: false,
        }),
        { status: 200 },
      );

    const same = await checkForUpdates({ currentVersion: '1.1.1', fetchFn: mockFetch, nowMs: 1_000 });
    assert.equal(same.status, 'ok');
    assert.equal(same.updateAvailable, false);

    const ahead = await checkForUpdates({ currentVersion: '1.2.0', fetchFn: mockFetch, nowMs: 1_000 });
    assert.equal(ahead.status, 'ok');
    assert.equal(ahead.updateAvailable, false);
  });

  it('caches results within TTL and bypasses cache when force=true', async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = async () => {
      callCount += 1;
      return new Response(
        JSON.stringify({
          tag_name: `v1.1.${callCount + 1}`,
          html_url: `https://github.com/brigun/eve-trade-finder/releases/tag/v1.1.${callCount + 1}`,
        }),
        { status: 200 },
      );
    };

    const first = await checkForUpdates({ currentVersion: '1.1.1', fetchFn: mockFetch, nowMs: 10_000 });
    const second = await checkForUpdates({ currentVersion: '1.1.1', fetchFn: mockFetch, nowMs: 20_000 });
    const forced = await checkForUpdates({
      force: true,
      currentVersion: '1.1.1',
      fetchFn: mockFetch,
      nowMs: 25_000,
    });

    assert.equal(callCount, 2);
    assert.equal(first.cached, false);
    assert.equal(first.latestVersion, '1.1.2');
    assert.equal(second.cached, true);
    assert.equal(second.latestVersion, '1.1.2');
    assert.equal(forced.cached, false);
    assert.equal(forced.latestVersion, '1.1.3');
  });

  it('falls back to github.com redirect when REST API is rate-limited (403/429)', async () => {
    const calls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://api.github.com/')) {
        return new Response('rate limit exceeded', { status: 403 });
      }
      return new Response(null, {
        status: 302,
        headers: {
          Location: 'https://github.com/brigun/eve-trade-finder/releases/tag/v1.1.5',
        },
      });
    };

    const res = await checkForUpdates({ currentVersion: '1.1.1', fetchFn: mockFetch, nowMs: 50_000 });

    assert.deepEqual(calls, [
      'https://api.github.com/repos/brigun/eve-trade-finder/releases/latest',
      'https://github.com/brigun/eve-trade-finder/releases/latest',
    ]);
    assert.equal(res.status, 'ok');
    assert.equal(res.source, 'github_redirect');
    assert.equal(res.latestVersion, '1.1.5');
    assert.equal(res.updateAvailable, true);
    assert.equal(res.releaseUrl, 'https://github.com/brigun/eve-trade-finder/releases/tag/v1.1.5');
  });

  it('returns status=error on network failure without caching the error', async () => {
    let attempts = 0;
    const mockFetch: typeof fetch = async () => {
      attempts += 1;
      throw new Error('ENOTFOUND api.github.com');
    };

    const first = await checkForUpdates({ currentVersion: '1.1.1', fetchFn: mockFetch, nowMs: 100_000 });
    const second = await checkForUpdates({ currentVersion: '1.1.1', fetchFn: mockFetch, nowMs: 105_000 });

    assert.equal(attempts, 2);
    assert.equal(first.status, 'error');
    assert.equal(first.updateAvailable, false);
    assert.match(first.error ?? '', /ENOTFOUND/);
    assert.equal(second.status, 'error');
  });
});
