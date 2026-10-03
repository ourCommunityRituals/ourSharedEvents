/**
 * display-config's 304 path is cheap: the ETag is computed from everything
 * except the QR images (a QR is a pure function of its link + fixed options),
 * so a TV's once-a-minute revalidation gets its 304 without a single PNG being
 * generated. Calls the handler directly with a stub DB and counts encoder calls.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const qr = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../src/lib/qr', () => ({
  generateQrCode: (url: string) => {
    qr.calls++;
    return `data:image/png;base64,${Buffer.from(url).toString('base64')}`;
  },
}));

import { handleAdminDisplayConfig, handleDisplayConfig } from '../src/handlers/display-config';

function env(settings: unknown) {
  const row = { id: 'evt-1', status: 'active', settings_json: JSON.stringify(settings) };
  return {
    DB: {
      prepare: () => ({ bind: () => ({ first: async () => row }) }),
    } as unknown as D1Database,
  };
}

const SETTINGS = {
  leagueLinks: {
    schedule: 'https://league.example/schedule',
    standings: 'https://league.example/standings',
  },
};

function get(ifNoneMatch?: string) {
  return new Request('https://t.test/api/v2/events/evt-1/display-config', {
    headers: ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {},
  });
}

beforeEach(() => {
  qr.calls = 0;
});

describe('display-config ETag is computed before any QR is drawn', () => {
  test('a 200 draws one QR per link', async () => {
    const res = await handleDisplayConfig(get(), env(SETTINGS), 'evt-1');
    expect(res.status).toBe(200);
    expect(qr.calls).toBe(2);
    const body = (await res.json()) as { league: Array<{ qr: string }> };
    expect(body.league.map((l) => l.qr.startsWith('data:image/png;base64,'))).toEqual([true, true]);
  });

  test('a matching If-None-Match gets a 304 and draws no QR at all', async () => {
    const first = await handleDisplayConfig(get(), env(SETTINGS), 'evt-1');
    const etag = first.headers.get('ETag')!;
    qr.calls = 0;
    const again = await handleDisplayConfig(get(etag), env(SETTINGS), 'evt-1');
    expect(again.status).toBe(304);
    expect(again.headers.get('ETag')).toBe(etag);
    expect(qr.calls).toBe(0);
  });

  test('changing a link changes the ETag (the QR it implies is covered too)', async () => {
    const a = (await handleDisplayConfig(get(), env(SETTINGS), 'evt-1')).headers.get('ETag')!;
    const changed = {
      leagueLinks: { ...SETTINGS.leagueLinks, schedule: 'https://league.example/s2' },
    };
    const res = await handleDisplayConfig(get(a), env(changed), 'evt-1');
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).not.toBe(a);
  });
});

describe('the admin read carries no QR images', () => {
  test('links come back, no qr field, and the encoder is never called', async () => {
    const res = await handleAdminDisplayConfig(get(), env(SETTINGS), 'evt-1');
    expect(res.status).toBe(200);
    expect(qr.calls).toBe(0);
    const body = (await res.json()) as { league: Array<Record<string, unknown>> };
    expect(body.league.map((l) => l.url)).toEqual([
      'https://league.example/schedule',
      'https://league.example/standings',
    ]);
    for (const l of body.league) expect(l).not.toHaveProperty('qr');
  });
});

describe('the ETag covers the QR colour', () => {
  async function etagWithColour(hex: string): Promise<string> {
    vi.resetModules();
    vi.doMock('../src/lib/uec', () => ({ getCode: () => ({ scan_hex: hex }) }));
    const mod = await import('../src/handlers/display-config');
    const res = await mod.handleDisplayConfig(get(), env(SETTINGS), 'evt-1');
    vi.doUnmock('../src/lib/uec');
    return res.headers.get('ETag')!;
  }

  test('a different UEC colour gives a different ETag (no stale 304)', async () => {
    const a = await etagWithColour('#2A2A3A');
    const b = await etagWithColour('#112233');
    expect(a).toMatch(/^"[0-9a-f]{32}"$/);
    expect(b).not.toBe(a);
  });
});
