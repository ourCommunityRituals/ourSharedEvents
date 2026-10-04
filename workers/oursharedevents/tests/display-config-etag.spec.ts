/**
 * display-config's 304 path is cheap: the ETag is computed from everything
 * except the QR images (a QR is a pure function of its link + fixed options),
 * so a TV's once-a-minute revalidation gets its 304 without a single PNG being
 * generated. Calls the handler directly with a stub DB and counts encoder calls.
 *
 * OSE-1521: the same holds for the two new QR screens: the event's own page (the
 * featured screen's QR) and the donate link. Changing, adding or clearing either
 * changes the ETag, so a TV never keeps a stale screen behind a 304.
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
const WITH_DONATE = { ...SETTINGS, donateLink: 'https://donate.example/give' };

function get(ifNoneMatch?: string, origin = 'https://t.test') {
  return new Request(`${origin}/api/v2/events/evt-1/display-config`, {
    headers: ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {},
  });
}

beforeEach(() => {
  qr.calls = 0;
});

describe('display-config ETag is computed before any QR is drawn', () => {
  test('a 200 draws one QR per link, plus the event page and the donate link', async () => {
    const res = await handleDisplayConfig(get(), env(WITH_DONATE), 'evt-1');
    expect(res.status).toBe(200);
    // two league links + the donate link + the event page
    expect(qr.calls).toBe(4);
    const body = (await res.json()) as {
      league: Array<{ qr: string }>;
      donate: { url: string; qr: string };
      event_page: { url: string; qr: string };
    };
    expect(body.league.map((l) => l.qr.startsWith('data:image/png;base64,'))).toEqual([true, true]);
    expect(body.donate.qr).toMatch(/^data:image\/png;base64,/);
    expect(body.event_page.qr).toMatch(/^data:image\/png;base64,/);
  });

  test('a matching If-None-Match gets a 304 and draws no QR at all', async () => {
    const first = await handleDisplayConfig(get(), env(WITH_DONATE), 'evt-1');
    const etag = first.headers.get('ETag')!;
    qr.calls = 0;
    const again = await handleDisplayConfig(get(etag), env(WITH_DONATE), 'evt-1');
    expect(again.status).toBe(304);
    expect(again.headers.get('ETag')).toBe(etag);
    expect(await again.text()).toBe('');
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

describe('the donate screen and the event QR change the ETag (OSE-1521)', () => {
  test('adding, changing and clearing the donate link each change it', async () => {
    const none = (await handleDisplayConfig(get(), env(SETTINGS), 'evt-1')).headers.get('ETag')!;
    const added = (await handleDisplayConfig(get(), env(WITH_DONATE), 'evt-1')).headers.get(
      'ETag'
    )!;
    const changed = (
      await handleDisplayConfig(
        get(),
        env({ ...SETTINGS, donateLink: 'https://donate.example/other' }),
        'evt-1'
      )
    ).headers.get('ETag')!;
    expect(added).not.toBe(none);
    expect(changed).not.toBe(added);
    // Old tag against the cleared config: a full 200 without the donate screen.
    const cleared = await handleDisplayConfig(get(added), env(SETTINGS), 'evt-1');
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { donate: unknown }).donate).toBeNull();
  });

  test('a donate link on a stale 304 is impossible: the old ETag never matches the new body', async () => {
    const before = (await handleDisplayConfig(get(), env(SETTINGS), 'evt-1')).headers.get('ETag')!;
    const res = await handleDisplayConfig(get(before), env(WITH_DONATE), 'evt-1');
    expect(res.status).toBe(200);
  });

  test('the event page link follows the host, so a staging TV never carries a production QR', async () => {
    const a = (
      await handleDisplayConfig(get(undefined, 'https://stg.example'), env(SETTINGS), 'evt-1')
    ).headers.get('ETag')!;
    const b = (
      await handleDisplayConfig(get(undefined, 'https://prod.example'), env(SETTINGS), 'evt-1')
    ).headers.get('ETag')!;
    expect(a).not.toBe(b);
  });

  test('the event page link is the public page of that event, on the request host', async () => {
    const res = await handleDisplayConfig(get(), env(SETTINGS), 'evt-1');
    const body = (await res.json()) as { event_page: { url: string } };
    expect(body.event_page.url).toBe('https://t.test/events/evt-1');
  });
});

describe('the admin read carries no QR images', () => {
  test('links come back, no qr field, and the encoder is never called', async () => {
    const res = await handleAdminDisplayConfig(get(), env(WITH_DONATE), 'evt-1');
    expect(res.status).toBe(200);
    expect(qr.calls).toBe(0);
    const body = (await res.json()) as {
      league: Array<Record<string, unknown>>;
      donate: Record<string, unknown>;
    };
    expect(body.league.map((l) => l.url)).toEqual([
      'https://league.example/schedule',
      'https://league.example/standings',
    ]);
    for (const l of body.league) expect(l).not.toHaveProperty('qr');
    expect(body.donate.url).toBe('https://donate.example/give');
    expect(body.donate).not.toHaveProperty('qr');
  });
});

describe('the ETag covers every QR colour', () => {
  /** A UEC registry stand-in where each code id has its own colour. */
  async function etagWithColours(hex: Record<string, string>): Promise<string> {
    vi.resetModules();
    vi.doMock('../src/lib/uec', () => ({
      getCode: (id: string) => ({
        id,
        label: id.toLowerCase(),
        scan_hex: hex[id] ?? '#2A2A3A',
      }),
    }));
    const mod = await import('../src/handlers/display-config');
    const res = await mod.handleDisplayConfig(get(), env(WITH_DONATE), 'evt-1');
    vi.doUnmock('../src/lib/uec');
    return res.headers.get('ETag')!;
  }

  test('a different UEC colour gives a different ETag (no stale 304)', async () => {
    const a = await etagWithColours({});
    const b = await etagWithColours({ LIVE: '#112233' });
    expect(a).toMatch(/^"[0-9a-f]{32}"$/);
    expect(b).not.toBe(a);
  }, 30_000);

  test('the donate colour and the event page colour each change it on their own', async () => {
    const base = await etagWithColours({});
    expect(await etagWithColours({ SHOP: '#112233' })).not.toBe(base);
    expect(await etagWithColours({ UTILITY: '#112233' })).not.toBe(base);
    // Each call re-imports the handler module; allow for a loaded CI machine.
  }, 30_000);
});
