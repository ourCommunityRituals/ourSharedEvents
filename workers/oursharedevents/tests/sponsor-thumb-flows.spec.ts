/**
 * OSE-1955 (feature OSE-1948): the event page's "Supported by" sponsor
 * thumbnails, as flows through the running Worker: the page and the logo proxy
 * read together, the way a browser reads them.
 *
 * The rule itself (owner 2026-11-09): between the header and "What", a sponsor
 * with a logo is thumbnail art only, the compact logo else the header logo,
 * through the same-origin proxy `/api/v2/sponsors/<id>/logo?slot=sidebar`, with
 * the escaped title as alt. A sponsor with no logo is its name, plus its address
 * line when it set one.
 *
 * What is NOT repeated here, because another spec already pins it:
 *   - the exact markup of one item, every branch: tests/sponsor-thumb-render.spec.ts
 *     (node, the Stryker killer spec of OSE-1952);
 *   - one thumbnail per phase strip: tests/public-event-stakeholder-surfaces.spec.ts;
 *   - the proxy alone (validators, redirects, size and time caps, 429 on a miss):
 *     tests/sponsor-logo.spec.ts and tests/sponsor-public-card.spec.ts;
 *   - the switch and the consent matrix over every reader: tests/sponsor-opt-in-gate.spec.ts.
 *
 * What IS here: each flow on OSE-1955 where the page and the proxy must agree.
 * The page names a src; that same src, fetched, answers what the page promised
 * (art) or the page never names it (no art). Upstream fetches are stubbed with a
 * recorder, so a test can say which stored URL the proxy asked for, and that it
 * asked for none.
 *
 * Workers pool: SELF.fetch, D1 and the edge cache.
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { handlePublicEventPage } from '../src/handlers/pages';
import { handleSponsorLogo } from '../src/handlers/sponsors';

const BRAND = 'ose1955';
const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const STRIPS = ['pre-sponsor-strip', 'live-sponsor-strip', 'post-sponsor-thanks'] as const;
// A 1x1 PNG: the proxy checks the content type and the size, not the pixels.
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  ),
  (c) => c.charCodeAt(0)
);

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

async function applyAll(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(m)) continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyAll(tenv().DB, tenv().TEST_MIGRATION_STATEMENTS);
  await applyAll(tenv().FORMS_DB, tenv().TEST_FORMS_MIGRATION_STATEMENTS);
}, 120_000);

// ── upstream recorder ────────────────────────────────────────────────────────

/** Every URL the proxy asked the sponsor's host for, in order. */
let upstream: string[] = [];
let upstreamStatus = 200;

function stubUpstream(): void {
  upstream = [];
  upstreamStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      upstream.push(url);
      return upstreamStatus === 200
        ? new Response(PNG, { headers: { 'content-type': 'image/png' } })
        : new Response('nope', { status: upstreamStatus });
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A per-test upstream URL: the proxy's edge cache is keyed by it, so no test reads another's. */
let seq = 0;
const logo = (tag: string) => `https://cdn.ose1955.example/${tag}-${Date.now()}-${++seq}.png`;

// ── seeding ──────────────────────────────────────────────────────────────────

type Phase = 'pre' | 'live' | 'post';
const PHASE_OFFSETS: Record<Phase, [number, number]> = {
  pre: [7, 8],
  live: [-1 / 24, 1 / 24],
  post: [-8, -7],
};
const PHASE_STRIP: Record<Phase, (typeof STRIPS)[number]> = {
  pre: 'pre-sponsor-strip',
  live: 'live-sponsor-strip',
  post: 'post-sponsor-thanks',
};

async function seedEvent(
  id: string,
  opts: { phase?: Phase; settings?: string } = {}
): Promise<void> {
  const [s, e] = PHASE_OFFSETS[opts.phase ?? 'pre'];
  const now = Date.now();
  await tenv().DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date,
                           what_short, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 'Hall', ?, ?, 'A community gathering.', ?, datetime('now'), datetime('now'))`
    )
    .bind(
      id,
      BRAND,
      `Event ${id}`,
      id,
      new Date(now + s * 86400000).toISOString(),
      new Date(now + e * 86400000).toISOString(),
      opts.settings ?? '{"useSponsors":true}'
    )
    .run();
}

interface SponsorSeed {
  id: string;
  name?: string;
  displayName?: string | null;
  addressLine?: string | null;
  website?: string | null;
  header?: string | null;
  compact?: string | null;
  sponsorAccepted?: number;
  organizerAccepted?: number;
  placementActive?: number;
}

async function seedSponsor(eventId: string, s: SponsorSeed): Promise<string> {
  await seedSplitSponsor(tenv().DB, {
    id: s.id,
    eventId,
    name: s.name ?? s.id,
    tier: 'gold',
    websiteUrl: s.website ?? null,
    logoUrl: s.header ?? null,
    compactLogoUrl: s.compact ?? null,
    isActive: s.placementActive ?? 1,
    sponsorAccepted: s.sponsorAccepted ?? 1,
    organizerAccepted: s.organizerAccepted ?? 1,
  });
  if (s.displayName !== undefined || s.addressLine !== undefined) {
    await tenv()
      .DB.prepare('UPDATE sponsor_business SET display_name = ?, address_line = ? WHERE id = ?')
      .bind(s.displayName ?? null, s.addressLine ?? null, s.id)
      .run();
  }
  return s.id;
}

/** A logo row written straight to D1, past the admin validator (a legacy or hand-edited row). */
async function rawAsset(sponsorId: string, format: 'logo' | 'logo_compact', url: string) {
  await tenv()
    .DB.prepare(
      `INSERT INTO sponsor_asset (id, sponsor_business_id, format, url, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(`sa_${sponsorId}_${format}_${++seq}`, sponsorId, format, url)
    .run();
}

// ── reading ──────────────────────────────────────────────────────────────────

async function page(
  eventId: string,
  prefix = ''
): Promise<{ status: number; html: string; res: Response }> {
  const res = await SELF.fetch(`https://t.test${prefix}/events/${eventId}`);
  return { status: res.status, html: await res.text(), res };
}

/** The sponsor section of whichever phase rendered, or '' when there is none. */
function stripOf(html: string): string {
  for (const id of STRIPS) {
    const at = html.indexOf(`data-testid="${id}"`);
    if (at > -1) return html.slice(at, html.indexOf('</section>', at));
  }
  return '';
}

/** The sponsor list items, in page order. */
function items(strip: string): string[] {
  return [...strip.matchAll(/<li class="ose-sponsor-item"[^>]*>([\s\S]*?)<\/li>/g)].map(
    (m) => m[1]
  );
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&#39;': "'",
  '&quot;': '"',
  '&lt;': '<',
  '&gt;': '>',
};

/** Every proxy src the page names, decoded from the HTML attribute in one pass (no double unescape). */
function thumbSrcs(html: string): string[] {
  return [...html.matchAll(/data-testid="sponsor-thumb" src="([^"]*)"/g)].map((m) =>
    m[1].replace(/&(?:amp|#39|quot|lt|gt);/g, (e) => ENTITIES[e])
  );
}

/** A string as a literal inside a RegExp: every metacharacter, the backslash included. */
const reEscape = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');

/** Attribute names an element really has: quoted values removed first, so text inside alt cannot count. */
function handlerAttrs(markup: string): string[] {
  const bare = markup.replace(/="[^"]*"/g, '=""');
  return [...bare.matchAll(/\s(on[a-z]+)\s*=/gi)].map((m) => m[1]);
}

const proxyPath = (id: string) => `/api/v2/sponsors/${encodeURIComponent(id)}/logo?slot=sidebar`;

async function proxy(src: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`https://t.test${src}`, init);
}

// ═════════════════════════════════════════════════════════════════════════════

describe('OSE-1955 happy | the page names art and the proxy serves it', () => {
  test('a logo sponsor: thumbnail, alt is the title, no visible name, rel set; its src serves image/* with nosniff', async () => {
    stubUpstream();
    const ev = 'evt1955_h_one';
    await seedEvent(ev);
    const compact = logo('one-compact');
    await seedSponsor(ev, {
      id: 'sp1955_h_one',
      name: 'Corner Bakery LLC',
      displayName: 'Corner Bakery',
      website: 'https://bakery.example',
      header: logo('one-header'),
      compact,
    });

    const { status, html } = await page(ev);
    expect(status).toBe(200);
    const strip = stripOf(html);
    const [item] = items(strip);
    expect(item).toContain('data-testid="sponsor-thumb"');
    expect(item).toContain('alt="Corner Bakery"');
    expect(item, 'no visible name beside the art').not.toMatch(/>\s*Corner Bakery\s*</);
    expect(item).toContain('href="https://bakery.example"');
    expect(item).toContain('rel="noopener noreferrer nofollow"');
    expect(thumbSrcs(html)).toEqual([proxyPath('sp1955_h_one')]);

    const res = await proxy(thumbSrcs(html)[0]);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^image\//);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(upstream, 'the compact logo wins over the header logo').toEqual([compact]);
  });

  test.each([
    ['compact only', { compact: true, header: false }],
    ['header only (the fallback)', { compact: false, header: true }],
  ])('%s: a thumbnail, and its src serves that logo', async (_label, has) => {
    stubUpstream();
    const ev = `evt1955_h_${has.compact ? 'c' : 'h'}`;
    const sid = `sp1955_h_${has.compact ? 'c' : 'h'}`;
    await seedEvent(ev);
    const url = logo(sid);
    await seedSponsor(ev, {
      id: sid,
      name: 'One Logo Co',
      compact: has.compact ? url : null,
      header: has.header ? url : null,
    });

    const { html } = await page(ev);
    expect(thumbSrcs(html)).toEqual([proxyPath(sid)]);
    const res = await proxy(thumbSrcs(html)[0]);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^image\//);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(upstream).toEqual([url]);
  });

  test('Ad 1 with art beside Ad 2 without: one thumbnail and one name, in sponsor order', async () => {
    stubUpstream();
    const ev = 'evt1955_h_pair';
    await seedEvent(ev);
    await seedSponsor(ev, { id: 'sp1955_pair_a', name: 'Ad One Art', compact: logo('pair-a') });
    await seedSponsor(ev, { id: 'sp1955_pair_b', name: 'Ad Two Name' });

    const list = items(stripOf((await page(ev)).html));
    expect(list).toHaveLength(2);
    expect(list[0]).toContain('alt="Ad One Art"');
    expect(list[0]).not.toContain('>Ad One Art<');
    expect(list[1]).toContain('>Ad Two Name</a>');
    expect(list[1]).not.toContain('sponsor-thumb');
  });

  const PAIRS: Array<[Phase, '' | '/es']> = [
    ['pre', ''],
    ['pre', '/es'],
    ['live', ''],
    ['live', '/es'],
    ['post', ''],
    ['post', '/es'],
  ];
  test.each(PAIRS)(
    'phase %s, language "%s": the same thumbnail and name',
    async (phase, prefix) => {
      const ev = `evt1955_h_${phase}${prefix ? '_es' : ''}`;
      await seedEvent(ev, { phase });
      await seedSponsor(ev, { id: `${ev}_a`, name: 'Phase Art', compact: logo(ev) });
      await seedSponsor(ev, { id: `${ev}_b`, name: 'Phase Name' });

      const { status, html } = await page(ev, prefix);
      expect(status).toBe(200);
      expect(html).toMatch(new RegExp(`<html lang="${prefix ? 'es' : 'en'}"`));
      const at = html.indexOf(`data-testid="${PHASE_STRIP[phase]}"`);
      expect(at, `${PHASE_STRIP[phase]} renders`).toBeGreaterThan(-1);
      const list = items(stripOf(html));
      expect(list).toHaveLength(2);
      // The title is the sponsor's own words: never translated, in either language.
      expect(list[0]).toContain(`src="${proxyPath(`${ev}_a`)}"`);
      expect(list[0]).toContain('alt="Phase Art"');
      expect(list[1]).toContain('>Phase Name</a>');
    }
  );
});

describe('OSE-1955 rainy | a failing logo never breaks the page', () => {
  test.each([
    ['404: the logo was removed after the page was read', 404],
    ['422: a stored URL that fails validation', 422],
    ['502: the sponsor host fails', 502],
  ])(
    '%s: the page stays 200 with the sponsor present, and the proxy answers it',
    async (label, code) => {
      stubUpstream();
      const ev = `evt1955_r_${code}`;
      const sid = `sp1955_r_${code}`;
      await seedEvent(ev);
      await seedSponsor(ev, { id: sid, name: 'Rainy Logo Co' });
      await rawAsset(sid, 'logo_compact', code === 422 ? 'https://127.0.0.1/x.png' : logo(sid));
      if (code === 502) upstreamStatus = 500;

      const { status, html } = await page(ev);
      expect(status, label).toBe(200);
      const [item] = items(stripOf(html));
      // Until OSE-1950 the item is the art with the name as its alt (read out by a
      // screen reader); after it, the name. Either way the sponsor is on the page.
      expect(item).toContain('Rainy Logo Co');
      if (code === 404) {
        await tenv()
          .DB.prepare('DELETE FROM sponsor_asset WHERE sponsor_business_id = ?')
          .bind(sid)
          .run();
      }
      const res = await proxy(proxyPath(sid));
      expect(res.status).toBe(code);
      expect(res.headers.get('set-cookie')).toBeNull();
      if (code === 422) expect(upstream, 'an invalid URL is never fetched').toEqual([]);
    }
  );

  test.each([
    ['an empty logo URL', ''],
    ['no logo row (null)', null],
  ])('%s: the name shows, and the page never names the proxy', async (_label, url) => {
    stubUpstream();
    const ev = `evt1955_r_empty_${url === null ? 'null' : 'blank'}`;
    const sid = `${ev}_sp`;
    await seedEvent(ev);
    await seedSponsor(ev, { id: sid, name: 'Nameplate Hardware', addressLine: '1 Main St' });
    if (url !== null) await rawAsset(sid, 'logo_compact', url);

    const { html } = await page(ev);
    const [item] = items(stripOf(html));
    expect(item).toContain('>Nameplate Hardware</a>');
    expect(item).toContain('data-testid="sponsor-item-address">1 Main St<');
    expect(html).not.toContain(`/api/v2/sponsors/${sid}/logo`);
    expect((await proxy(proxyPath(sid))).status).toBe(404);
    expect(upstream).toEqual([]);
  });

  test.each([
    ['the switch is off', '{"useSponsors":false}'],
    ['the switch was never set', '{}'],
  ])(
    'useSponsors: %s → no sponsor section, and the proxy 404s without fetching',
    async (_l, settings) => {
      stubUpstream();
      const ev = `evt1955_r_off_${settings === '{}' ? 'absent' : 'false'}`;
      const sid = `${ev}_sp`;
      await seedEvent(ev, { settings });
      await seedSponsor(ev, { id: sid, name: 'Switched Off Co', compact: logo(sid) });

      const { status, html } = await page(ev);
      expect(status).toBe(200);
      expect(stripOf(html)).toBe('');
      expect(html).not.toContain('Switched Off Co');
      expect((await proxy(proxyPath(sid))).status).toBe(404);
      expect(upstream).toEqual([]);
    }
  );

  test.each([
    ['the sponsor has not accepted', { sponsorAccepted: 0, organizerAccepted: 1 }],
    ['the organizer has not accepted', { sponsorAccepted: 1, organizerAccepted: 0 }],
  ])('one side only (%s): no thumbnail, and the proxy 404s without fetching', async (_l, c) => {
    stubUpstream();
    const ev = `evt1955_r_one_${c.sponsorAccepted}${c.organizerAccepted}`;
    const sid = `${ev}_sp`;
    await seedEvent(ev);
    await seedSponsor(ev, { id: sid, name: 'Half Agreed Co', compact: logo(sid), ...c });

    const { html } = await page(ev);
    expect(html).not.toContain('Half Agreed Co');
    expect(html).not.toContain('data-testid="sponsor-thumb"');
    expect((await proxy(proxyPath(sid))).status).toBe(404);
    expect(upstream).toEqual([]);
  });

  test('the sponsor read fails: the page renders with no sponsor section, and nothing else is lost', async () => {
    const ev = 'evt1955_r_dbfail';
    await seedEvent(ev);
    await seedSponsor(ev, { id: `${ev}_sp`, name: 'Unreadable Co', compact: logo(ev) });
    const real = tenv().DB;
    // Only the sponsor-list query fails (the one that computes has_logo), and it
    // fails the way D1 fails: the statement rejects when it runs. Every other read
    // on the page goes to the real database.
    const rejected = () => Promise.reject(new Error('D1_ERROR: injected sponsor read failure'));
    const broken = { all: rejected, first: rejected, run: rejected, raw: rejected };
    const failing = new Proxy(real, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) =>
            sql.includes('AS has_logo') ? { ...broken, bind: () => broken } : target.prepare(sql);
        }
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const res = await handlePublicEventPage(
      new Request(`https://t.test/events/${ev}`),
      { ...(env as unknown as Record<string, unknown>), DB: failing } as never,
      ev
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(stripOf(html)).toBe('');
    expect(html).not.toContain('Unreadable Co');
    expect(html).toContain('data-testid="event-title"');
  });
});

describe('OSE-1955 edge', () => {
  test('the thumbnail box: 64 px tall, at most 160 px wide, contained (never cropped), a 44 px target', async () => {
    const ev = 'evt1955_e_box';
    await seedEvent(ev);
    await seedSponsor(ev, { id: `${ev}_sp`, name: 'Box Co', compact: logo(ev) });
    const { html } = await page(ev);
    const css = (sel: string) => {
      const m = html.match(new RegExp(`${reEscape(sel)}\\s*\\{([^}]*)\\}`));
      expect(m, `${sel} is styled`).not.toBeNull();
      return m![1];
    };
    const thumb = css('.ose-sponsor-thumb');
    expect(thumb).toMatch(/height:\s*64px/);
    expect(thumb).toMatch(/width:\s*auto/);
    expect(thumb).toMatch(/max-width:\s*160px/);
    expect(thumb).toMatch(/object-fit:\s*contain/);
    expect(css('.ose-sponsor-link[data-thumb]')).toMatch(/min-height:\s*44px/);
    expect(css('.ose-sponsor-item')).toMatch(/min-height:\s*44px/);
    // A name is a tap target too (AGENTS.md invariant 8): the link itself, not
    // only its row, is at least 44 px tall. The browser measures it in T4j.
    const nameLink = css('.ose-sponsor-link');
    expect(nameLink).toMatch(/display:\s*inline-flex/);
    expect(nameLink).toMatch(/min-height:\s*44px/);
  });

  test('the sponsor-list styles use tokens only: no raw colour', async () => {
    const ev = 'evt1955_e_tokens';
    await seedEvent(ev);
    await seedSponsor(ev, { id: `${ev}_sp`, name: 'Token Co', compact: logo(ev) });
    const { html } = await page(ev);
    const rules = [...html.matchAll(/\.ose-sponsor-[\w-]+(?:\[[^\]]*\])?\s*\{[^}]*\}/g)].map(
      (m) => m[0]
    );
    expect(rules.length).toBeGreaterThanOrEqual(4);
    for (const r of rules) {
      expect(r, r).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    }
  });

  test('ten sponsors: ten items in order, art and names mixed, one list', async () => {
    const ev = 'evt1955_e_ten';
    await seedEvent(ev);
    for (let i = 0; i < 10; i++) {
      await seedSponsor(ev, {
        id: `sp1955_ten_${i}`,
        name: `Ten Sponsor ${i}`,
        compact: i % 2 === 0 ? logo(`ten-${i}`) : null,
      });
    }
    const { html } = await page(ev);
    const list = items(stripOf(html));
    expect(list).toHaveLength(10);
    list.forEach((item, i) => {
      expect(item).toContain(`Ten Sponsor ${i}`);
      expect(item.includes('sponsor-thumb'), `item ${i}`).toBe(i % 2 === 0);
    });
    expect(html.match(/data-testid="sponsor-list"/g)).toHaveLength(1);
  });

  test('display_name wins over name in the alt; a long title is carried whole, escaped', async () => {
    const ev = 'evt1955_e_title';
    await seedEvent(ev);
    const long = `The Very Long & Proud Neighbourhood Co-operative ${'Bakery '.repeat(25)}`.trim();
    await seedSponsor(ev, {
      id: `${ev}_a`,
      name: 'Legal Name LLC',
      displayName: 'Shown Name',
      compact: logo(`${ev}-a`),
    });
    await seedSponsor(ev, { id: `${ev}_b`, name: long, compact: logo(`${ev}-b`) });
    const list = items(stripOf((await page(ev)).html));
    expect(list[0]).toContain('alt="Shown Name"');
    expect(list[0]).not.toContain('Legal Name LLC');
    expect(list[1]).toContain(`alt="${long.replace(/&/g, '&amp;')}"`);
  });

  // The router hands the proxy the path segment as it arrived (still encoded), so
  // an id that needs encoding finds no sponsor: the proxy fails closed (404, no
  // fetch). Generated ids (`sp_` + base36) need no encoding, so no real sponsor
  // meets this; the mismatch is recorded on OSE-1955 as a follow-up.
  test('a sponsor id that needs encoding: the src is well formed, and the proxy fails closed', async () => {
    stubUpstream();
    const ev = 'evt1955_e_enc';
    const sid = "sp 1955+a&b'c";
    await seedEvent(ev);
    await seedSponsor(ev, { id: sid, name: 'Encoded Co', compact: logo('enc') });

    const { html } = await page(ev);
    const [src] = thumbSrcs(html);
    expect(src).toBe(proxyPath(sid));
    expect(src).toBe("/api/v2/sponsors/sp%201955%2Ba%26b'c/logo?slot=sidebar");
    expect(html, 'the & is an entity inside the attribute').toContain(
      '%26b&#39;c/logo?slot=sidebar'
    );
    const res = await proxy(src);
    expect(res.status).toBe(404);
    expect(upstream).toEqual([]);
    expect((await page(ev)).status).toBe(200);
  });
});

// ── fat-finger: what an admin types as a logo ───────────────────────────────

type Json = Record<string, unknown>;

async function adminCreate(payload: Json): Promise<{ status: number; body: Json }> {
  const res = await SELF.fetch('https://t.test/api/v2/admin/sponsors', {
    method: 'POST',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as Json };
}

async function adminUpdate(id: string, payload: Json): Promise<{ status: number; body: Json }> {
  const res = await SELF.fetch(`https://t.test/api/v2/admin/sponsors/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as Json };
}

async function onShowViaAdmin(ev: string, payload: Json): Promise<string> {
  const { status, body } = await adminCreate({ tier: 'gold', event_id: ev, ...payload });
  expect(status, JSON.stringify(body)).toBe(201);
  const id = String(body.id);
  await tenv()
    .DB.prepare('UPDATE sponsor_placement SET sponsor_accepted = 1 WHERE sponsor_business_id = ?')
    .bind(id)
    .run();
  return id;
}

async function assets(id: string): Promise<Array<{ format: string; url: string }>> {
  const r = await tenv()
    .DB.prepare(
      'SELECT format, url FROM sponsor_asset WHERE sponsor_business_id = ? ORDER BY format'
    )
    .bind(id)
    .all<{ format: string; url: string }>();
  return r.results ?? [];
}

describe('OSE-1955 fat-finger | a logo typed by an admin', () => {
  const FAT = 'evt1955_fat';
  beforeAll(async () => {
    await tenv()
      .DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, start_date, end_date, settings_json)
         VALUES (?, ?, 'Fat Finger Night', ?, 'active', date('now','+7 days'), date('now','+8 days'),
                 '{"useSponsors":true}') ON CONFLICT(id) DO NOTHING`
      )
      .bind(FAT, BRAND, FAT)
      .run();
  });

  // Each value, its outcome at write (400 = refused) and, when stored, at the proxy.
  // A stored value is never shown: the page names only the same-origin proxy.
  const CASES: Array<[string, string, 400 | 200, number | null]> = [
    ['leading and trailing spaces', '  https://cdn.ose1955.example/spaces.png  ', 200, 200],
    [
      'an http: URL (the Worker fetches it, the browser never does)',
      'http://cdn.ose1955.example/plain.png',
      200,
      200,
    ],
    ['a data: URI', 'data:image/png;base64,iVBORw0KGgo=', 400, null],
    ['javascript:', 'javascript:alert(1)', 400, null],
    ['an uppercase scheme', 'HTTPS://CDN.OSE1955.EXAMPLE/UPPER.PNG', 200, 200],
    ['a URL over 500 characters', `https://cdn.ose1955.example/${'a'.repeat(480)}.png`, 400, null],
    ['a URL with credentials', 'https://user:secret@cdn.ose1955.example/creds.png', 400, null],
    ['a private host', 'https://10.0.0.1/inside.png', 400, null],
    ['whitespace only', '   ', 400, null],
  ];

  test.each(CASES)('%s', async (label, value, write, served) => {
    stubUpstream();
    const id = await onShowViaAdmin(FAT, { name: `Fat ${label}` });
    const res = await adminUpdate(id, { sidebar_logo_url: value });
    expect(res.status, JSON.stringify(res.body)).toBe(write);

    const stored = await assets(id);
    if (write === 400) {
      expect(stored, 'a refused value writes no row').toEqual([]);
      expect(
        res.body.code ?? (res.body.error as Json | undefined)?.code ?? JSON.stringify(res.body)
      ).toMatch(/INVALID_SIDEBAR_LOGO_URL/);
    }

    const { status, html } = await page(FAT);
    expect(status, 'no value breaks the page').toBe(200);
    expect(html).toContain(`Fat ${label}`.replace(/&/g, '&amp;'));
    const shown = value.trim().toLowerCase().slice(0, 40);
    if (shown)
      expect(html.toLowerCase(), 'the stored value never reaches the page').not.toContain(shown);
    expect(html).not.toContain('secret@');

    const proxied = await proxy(proxyPath(id));
    if (served === null) {
      expect(proxied.status, 'nothing stored, nothing served').toBe(404);
      expect(upstream).toEqual([]);
    } else {
      expect(proxied.status).toBe(served);
    }
  });

  test('a credentials URL stored before the write check is never fetched: 422, and the page stands', async () => {
    stubUpstream();
    const id = await onShowViaAdmin(FAT, { name: 'Old Creds Co' });
    await rawAsset(id, 'logo_compact', 'https://user:secret@cdn.ose1955.example/old.png');
    const { status, html } = await page(FAT);
    expect(status).toBe(200);
    expect(html).not.toContain('secret');
    expect((await proxy(proxyPath(id))).status).toBe(422);
    expect(upstream, 'the pair is never sent').toEqual([]);
  });

  test('clearing the compact logo leaves the header; clearing both brings back the name', async () => {
    stubUpstream();
    const header = logo('fat-header');
    const compact = logo('fat-compact');
    const id = await onShowViaAdmin(FAT, {
      name: 'Clearing Co',
      logo_url: header,
      sidebar_logo_url: compact,
    });
    const itemFor = async () =>
      items(stripOf((await page(FAT)).html)).find((i) => i.includes('Clearing Co')) ?? '';

    expect(await itemFor()).toContain('data-testid="sponsor-thumb"');
    expect((await proxy(proxyPath(id))).status).toBe(200);
    expect(upstream.at(-1)).toBe(compact);

    expect((await adminUpdate(id, { sidebar_logo_url: '' })).status).toBe(200);
    expect(await itemFor()).toContain('data-testid="sponsor-thumb"');
    expect((await proxy(proxyPath(id))).status).toBe(200);
    expect(upstream.at(-1), 'the header logo is the fallback').toBe(header);

    expect((await adminUpdate(id, { logo_url: null })).status).toBe(200);
    const item = await itemFor();
    expect(item).not.toContain('sponsor-thumb');
    expect(item).toContain('>Clearing Co</a>');
    expect((await proxy(proxyPath(id))).status).toBe(404);
  });

  test('saving the same logo twice is idempotent: one row, the same page', async () => {
    const url = logo('fat-twice');
    const id = await onShowViaAdmin(FAT, { name: 'Twice Co' });
    expect((await adminUpdate(id, { sidebar_logo_url: url })).status).toBe(200);
    const first = await assets(id);
    const firstItem = items(stripOf((await page(FAT)).html)).find((i) => i.includes('Twice Co'));
    expect((await adminUpdate(id, { sidebar_logo_url: url })).status).toBe(200);
    expect(await assets(id)).toEqual(first);
    expect(first).toEqual([{ format: 'logo_compact', url }]);
    expect(items(stripOf((await page(FAT)).html)).find((i) => i.includes('Twice Co'))).toBe(
      firstItem
    );
  });
});

describe('OSE-1955 security', () => {
  test.each([
    [
      'a quote and a tag in the name',
      { name: 'Evil"><script>alert(1)</script>', displayName: null },
    ],
    ['an onerror in display_name', { name: 'Plain', displayName: 'x" onerror="alert(1)' }],
    ['a single quote and an ampersand', { name: "O'Brien & Sons", displayName: null }],
  ])('%s: escaped inside alt, no tag and no handler reaches the page', async (_l, t) => {
    const ev = `evt1955_s_xss_${t.name.length}_${(t.displayName ?? '').length}`;
    await seedEvent(ev);
    await seedSponsor(ev, {
      id: `${ev}_sp`,
      name: t.name,
      displayName: t.displayName,
      compact: logo(ev),
    });
    const { html } = await page(ev);
    const [item] = items(stripOf(html));
    const title = t.displayName ?? t.name;
    const escaped = title
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    expect(item).toContain(`alt="${escaped}"`);
    expect(html).not.toContain('<script>alert(1)');
    expect(handlerAttrs(item)).toEqual([]);
    // One img, one alt: an attribute broken out of alt would add a second.
    expect(item.match(/<img /g)).toHaveLength(1);
    expect(item.match(/ alt="/g)).toHaveLength(1);
  });

  test('the stored logo URL never appears; the CSP keeps img-src to self and data:; no inline handler in the strip', async () => {
    const ev = 'evt1955_s_csp';
    await seedEvent(ev);
    const url = 'https://secret-cdn.ose1955.example/private-path/logo.png';
    await seedSponsor(ev, { id: `${ev}_sp`, name: 'Hidden Host Co', header: url });
    const { res, html } = await page(ev);
    expect(html).not.toContain('secret-cdn');
    expect(html).not.toContain('private-path');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/(^|;)\s*img-src 'self' data:\s*(;|$)/);
    expect(csp, 'no inline script can run a handler').not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(handlerAttrs(stripOf(html))).toEqual([]);
  });

  test('every outbound sponsor link carries noreferrer; card links stay on the site', async () => {
    const ev = 'evt1955_s_rel';
    await seedEvent(ev);
    await seedSponsor(ev, {
      id: `${ev}_a`,
      name: 'Out Art',
      website: 'https://a.example',
      compact: logo(ev),
    });
    await seedSponsor(ev, { id: `${ev}_b`, name: 'Out Name', website: 'https://b.example' });
    await seedSponsor(ev, {
      id: `${ev}_c`,
      name: 'Js Site',
      website: 'javascript:alert(1)',
      compact: logo(`${ev}c`),
    });
    await seedSponsor(ev, { id: `${ev}_d`, name: 'Http Site', website: 'http://d.example' });
    const strip = stripOf((await page(ev)).html);
    const anchors = [...strip.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
    expect(anchors).toHaveLength(4);
    for (const a of anchors) {
      const href = a.match(/href="([^"]*)"/)![1];
      if (/^https?:/i.test(href)) {
        expect(href, 'only https goes out').toMatch(/^https:\/\//);
        expect(a).toMatch(/rel="[^"]*\bnoreferrer\b/);
      } else {
        expect(href).toMatch(/^\/sponsors\//);
      }
    }
    expect(strip).not.toContain('javascript:');
    expect(strip).not.toContain('http://d.example');
  });

  test('the proxy serves only a sponsor on show: an inactive business or placement is a 404, with no fetch', async () => {
    stubUpstream();
    const ev = 'evt1955_s_onshow';
    await seedEvent(ev);
    await seedSponsor(ev, { id: `${ev}_biz`, name: 'Closed Biz', compact: logo(`${ev}b`) });
    await seedSponsor(ev, {
      id: `${ev}_pl`,
      name: 'Pulled Placement',
      compact: logo(`${ev}p`),
      placementActive: 0,
    });
    await tenv()
      .DB.prepare('UPDATE sponsor_business SET is_active = 0 WHERE id = ?')
      .bind(`${ev}_biz`)
      .run();
    const { html } = await page(ev);
    expect(stripOf(html)).toBe('');
    for (const id of [`${ev}_biz`, `${ev}_pl`, 'sp1955_unknown']) {
      expect((await proxy(proxyPath(id))).status, id).toBe(404);
    }
    expect(upstream).toEqual([]);
  });

  test('the proxy sets no cookie and reads no identity: the same bytes with and without a cookie and a caller IP', async () => {
    stubUpstream();
    const ev = 'evt1955_s_anon';
    await seedEvent(ev);
    const url = logo(ev);
    await seedSponsor(ev, { id: `${ev}_sp`, name: 'Anon Co', compact: url });
    const plain = await proxy(proxyPath(`${ev}_sp`));
    const who = await proxy(proxyPath(`${ev}_sp`), {
      headers: { Cookie: 'ose_anon=abc; session=xyz', 'CF-Connecting-IP': '203.0.113.77' },
    });
    expect(plain.status).toBe(200);
    expect(who.status).toBe(200);
    for (const r of [plain, who]) {
      expect(r.headers.get('set-cookie')).toBeNull();
      expect(r.headers.get('vary') ?? '').not.toMatch(/cookie/i);
    }
    expect(new Uint8Array(await who.arrayBuffer())).toEqual(
      new Uint8Array(await plain.arrayBuffer())
    );
    const pageRes = (await page(ev)).res;
    expect(pageRes.headers.get('set-cookie'), 'the event page sets no cookie').toBeNull();
  });

  test('edge-cached by upstream URL: two sponsors sharing one logo cost one fetch; a cached hit is not rate-limited', async () => {
    stubUpstream();
    const ev = 'evt1955_s_cache';
    await seedEvent(ev);
    const url = logo('shared');
    await seedSponsor(ev, { id: `${ev}_a`, name: 'Shared A', compact: url });
    await seedSponsor(ev, { id: `${ev}_b`, name: 'Shared B', compact: url });
    expect((await proxy(proxyPath(`${ev}_a`))).status).toBe(200);
    expect((await proxy(proxyPath(`${ev}_b`))).status).toBe(200);
    expect(upstream).toEqual([url]);

    const OVER_LIMIT_KV = {
      get: async () => JSON.stringify({ count: 1_000_000, resetAt: Date.now() + 60_000 }),
      put: async () => {},
    } as unknown as KVNamespace;
    const limited = {
      ...(env as unknown as Record<string, unknown>),
      RATE_LIMIT_KV: OVER_LIMIT_KV,
    } as never;
    const req = (id: string) =>
      new Request(`https://t.test${proxyPath(id)}`, {
        headers: { 'CF-Connecting-IP': '203.0.113.78' },
      });
    expect((await handleSponsorLogo(req(`${ev}_a`), limited, `${ev}_a`)).status, 'a hit').toBe(200);
    await seedSponsor(ev, { id: `${ev}_c`, name: 'Cold C', compact: logo('cold') });
    expect((await handleSponsorLogo(req(`${ev}_c`), limited, `${ev}_c`)).status, 'a miss').toBe(
      429
    );
    expect(upstream).toEqual([url]);
  });

  test('never-who: a logo fetch writes nothing, to either database', async () => {
    stubUpstream();
    const ev = 'evt1955_s_nevwho';
    await seedEvent(ev);
    await seedSponsor(ev, { id: `${ev}_sp`, name: 'Quiet Co', compact: logo(ev) });
    await page(ev);
    const snapshot = async () => {
      const out: Record<string, number> = {};
      for (const [name, db] of [
        ['DB', tenv().DB],
        ['FORMS_DB', tenv().FORMS_DB],
      ] as const) {
        const tables = await db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table'
               AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'`
          )
          .all<{ name: string }>();
        for (const t of tables.results ?? []) {
          const c = await db
            .prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`)
            .first<{ n: number }>();
          out[`${name}.${t.name}`] = c?.n ?? 0;
        }
      }
      return out;
    };
    const before = await snapshot();
    for (let i = 0; i < 3; i++) {
      expect(
        (await proxy(proxyPath(`${ev}_sp`), { headers: { 'CF-Connecting-IP': `203.0.113.${i}` } }))
          .status
      ).toBe(200);
    }
    expect(await snapshot()).toEqual(before);
  });
});
