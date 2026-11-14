/**
 * demo-banner.spec.ts — OSE-1012 (demo-provenance banner).
 *
 * Proves the banner is (a) present when the surface serves demo/mock data and
 * (b) STRUCTURALLY ABSENT on real production data — the load-bearing safety
 * property. The banner presence is derived from the same mock-mode signal as
 * the data (createDataProvider → isMockActive), so it cannot be hand-forced on.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DEMO_BANNER_TESTID,
  DEGRADED_BANNER_TESTID,
  demoBannerMarkup,
  degradedBannerMarkup,
  injectDemoBanner,
  injectProvenanceBanner,
  isDemoModeActive,
  resolveSurfaceProvenance,
  emitProvenanceSignal,
} from '../src/lib/demo-banner';
import { handlePublicPage, handleDisplayPage } from '../src/handlers/pages';
import { createDataProvider } from '../src/lib/data-provider';

/** Minimal fake D1 whose config.mock-mode flag returns the given value. */
function fakeDbWithMockFlag(flagValue: number) {
  return {
    prepare() {
      return {
        first: async () => ({ flag_value: flagValue }),
      };
    },
  } as unknown as D1Database;
}

describe('OSE-1012: banner markup', () => {
  it('declares what it is — carries the test-id, the DEMO label, and the honest text', () => {
    const html = demoBannerMarkup();
    expect(html).toContain(`data-testid="${DEMO_BANNER_TESTID}"`);
    expect(html).toContain('>DEMO<');
    expect(html).toContain('not the live site');
    expect(html).toContain('role="status"');
  });
});

// OSE-2031: the demo bar sits on the accent, so its text takes the accent's own
// on-colour. With plain white it read at 2.86:1 on the dark theme's lighter
// accent (axe color-contrast, serious). The degraded bar keeps its fixed slate
// and white, which pass in both themes.
describe('OSE-2031: the banner text colour pairs with its background', () => {
  it('the demo bar uses the accent and its on-colour', () => {
    const html = demoBannerMarkup();
    expect(html).toContain('background:var(--accent,#b45309);color:var(--on-accent,#fff);');
  });

  it('the degraded bar keeps slate and white', () => {
    const html = degradedBannerMarkup();
    expect(html).toContain('background:#334155;color:#fff;');
    expect(html).not.toContain('--on-accent');
  });
});

describe('OSE-1012: injectDemoBanner', () => {
  it('inserts the banner immediately after the opening <body> tag', () => {
    const out = injectDemoBanner('<html><body><main>x</main></body></html>', true);
    expect(out).toContain(`<body><div data-testid="${DEMO_BANNER_TESTID}"`);
  });

  it('handles a <body> that already carries attributes', () => {
    const out = injectDemoBanner('<body data-poster-format="letter"><main></main></body>', true);
    expect(out).toContain('data-poster-format="letter"><div data-testid=');
  });

  it('is a no-op when show=false (real data → document unchanged)', () => {
    const doc = '<html><body><main>x</main></body></html>';
    expect(injectDemoBanner(doc, false)).toBe(doc);
  });
});

describe('OSE-1012: isDemoModeActive — derived, production-blocked', () => {
  it('is FALSE for an empty/degraded env — a missing DB is an outage, not a demo', async () => {
    // Load-bearing: keeps the banner OUT of the many structural/a11y tests that
    // pass {} as a throwaway env, and off real prod that lost its DB binding.
    expect(await isDemoModeActive({})).toBe(false);
    expect(await isDemoModeActive({ WORKER_ENV: 'production' })).toBe(false);
  });

  it('is TRUE in a non-production env with MOCK_MODE requested', async () => {
    expect(
      await isDemoModeActive({ WORKER_ENV: 'staging', MOCK_MODE: '1', DB: fakeDbWithMockFlag(0) })
    ).toBe(true);
  });

  // ── THE SAFETY PROPERTY (DoD negative control) ──────────────────────────────
  it('is FALSE on real production data — DB bound, mock-mode flag OFF', async () => {
    expect(await isDemoModeActive({ WORKER_ENV: 'production', DB: fakeDbWithMockFlag(0) })).toBe(
      false
    );
  });

  it('is TRUE in production ONLY when the mock-mode flag is EXPLICITLY set', async () => {
    expect(await isDemoModeActive({ WORKER_ENV: 'production', DB: fakeDbWithMockFlag(1) })).toBe(
      true
    );
  });

  it('fails closed — never labels data a demo if mock-mode cannot be resolved', async () => {
    const throwingDb = {
      prepare() {
        throw new Error('db unavailable');
      },
    } as unknown as D1Database;
    // production + throwing DB → createDataProvider swallows and defaults to no-mock
    expect(await isDemoModeActive({ WORKER_ENV: 'production', DB: throwingDb })).toBe(false);
  });
});

describe('OSE-1012: no injection surface (agentic/AppSec — XSS)', () => {
  it('takes NO input — structurally cannot interpolate untrusted data (arity 0)', () => {
    // The load-bearing XSS guarantee: with zero parameters there is no seam for
    // event/sponsor/user data to reach the markup. If a future edit adds an
    // interpolated argument, this breaks — forcing a sanitisation decision.
    expect(demoBannerMarkup.length).toBe(0);
  });

  it('is byte-stable across calls (no dynamic / data-derived content)', () => {
    expect(demoBannerMarkup()).toBe(demoBannerMarkup());
  });

  it('emits exactly one banner element and no <script>', () => {
    const m = demoBannerMarkup();
    expect(m).not.toMatch(/<script/i);
    expect((m.match(/data-testid=/g) ?? []).length).toBe(1);
    // parse-oracle: the whole markup is a single well-formed <div>…</div>
    expect(m.startsWith('<div ')).toBe(true);
    expect(m.trimEnd().endsWith('</div>')).toBe(true);
  });
});

describe('OSE-1012: provenance cannot be spoofed independently of the data signal', () => {
  // Locks the coupling: the banner is derived from the SAME canonical resolver
  // (createDataProvider → isIntentionalMock) the data layer uses to decide
  // intentional mock mode. There is no separate, spoofable path to show/hide it.
  const matrix = [
    {},
    { MOCK_MODE: '1' },
    { WORKER_ENV: 'production', DB: fakeDbWithMockFlag(0) },
    { WORKER_ENV: 'production', DB: fakeDbWithMockFlag(1) },
    { WORKER_ENV: 'staging', MOCK_MODE: '1', DB: fakeDbWithMockFlag(0) },
  ];

  it('banner visibility === createDataProvider().isIntentionalMock for every env', async () => {
    for (const env of matrix) {
      const banner = await isDemoModeActive(env as never);
      const canonical = (await createDataProvider(env as never)).isIntentionalMock;
      expect(banner, `env=${JSON.stringify(env)}`).toBe(canonical);
    }
  });
});

describe('OSE-1012/1013: provenance is a THREE-state machine (broken ≠ live)', () => {
  it("'demo' — operator intentionally in mock mode", async () => {
    expect(await resolveSurfaceProvenance({ MOCK_MODE: '1' } as never)).toBe('demo');
  });

  it("'live' — real production data, no mock", async () => {
    expect(
      await resolveSurfaceProvenance({
        WORKER_ENV: 'production',
        DB: fakeDbWithMockFlag(0),
      } as never)
    ).toBe('live');
  });

  it("'degraded' — DB outage serving mock FALLBACK (a distinct state, not 'live')", async () => {
    const outageEnv = { WORKER_ENV: 'production' } as never; // DB unbound
    expect(await resolveSurfaceProvenance(outageEnv)).toBe('degraded');
    // The data layer IS serving mock here — 'degraded' must be distinguishable
    // from 'live' precisely because they carry different data.
    const dp = await createDataProvider(outageEnv);
    expect(dp.isMockActive).toBe(true);
    expect(dp.isIntentionalMock).toBe(false);
  });

  it('live and degraded are different states with different results', async () => {
    const live = await resolveSurfaceProvenance({
      WORKER_ENV: 'production',
      DB: fakeDbWithMockFlag(0),
    } as never);
    const degraded = await resolveSurfaceProvenance({ WORKER_ENV: 'production' } as never);
    expect(live).not.toBe(degraded);
  });
});

describe('OSE-1013: degraded indicator — honest about the outage, never "DEMO"', () => {
  it('takes NO input — no injection surface (arity 0)', () => {
    expect(degradedBannerMarkup.length).toBe(0);
  });

  it('carries its own test-id and says DATA UNAVAILABLE, not DEMO', () => {
    const m = degradedBannerMarkup();
    expect(m).toContain(`data-testid="${DEGRADED_BANNER_TESTID}"`);
    expect(m).toContain('DATA UNAVAILABLE');
    expect(m).not.toContain('DEMO');
    expect(m).not.toContain('Showcase');
  });

  it('is a DIFFERENT element from the demo banner (mutually exclusive states)', () => {
    expect(DEGRADED_BANNER_TESTID).not.toBe(DEMO_BANNER_TESTID);
  });
});

describe('OSE-1013: operator signal — clearly know when a surface is not live', () => {
  it("'live' is silent — no ops noise for the healthy default", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    emitProvenanceSignal('live', 'public');
    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    warn.mockRestore();
    info.mockRestore();
  });

  it("'degraded' emits a WARN-level PROVENANCE_EVENT (alertable)", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    emitProvenanceSignal('degraded', 'display');
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0] as string;
    expect(line).toContain('PROVENANCE_EVENT');
    const payload = JSON.parse(line.replace('PROVENANCE_EVENT ', ''));
    expect(payload).toEqual({ provenance: 'degraded', surface: 'display' });
    warn.mockRestore();
  });

  it("'demo' emits an INFO-level signal (dashboard, not alert)", () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    emitProvenanceSignal('demo', 'poster');
    expect(info).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });

  it('the signal is NEVER-WHO — payload carries only state + surface, no identity', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    emitProvenanceSignal('degraded', 'sharedReport');
    const payload = JSON.parse((warn.mock.calls[0][0] as string).replace('PROVENANCE_EVENT ', ''));
    expect(Object.keys(payload).sort()).toEqual(['provenance', 'surface']);
    for (const forbidden of ['id', 'user', 'anon_id', 'slug', 'token', 'ip', 'email']) {
      expect(payload).not.toHaveProperty(forbidden);
    }
    warn.mockRestore();
  });
});

describe('OSE-1012: served surfaces carry the banner iff serving demo data', () => {
  const MOCK_ENV = { MOCK_MODE: '1' } as never; // non-prod + intentional mock
  const PROD_ENV = { WORKER_ENV: 'production', DB: fakeDbWithMockFlag(0) } as never;

  it('public page includes the banner in mock mode', async () => {
    const body = await (await handlePublicPage(MOCK_ENV)).text();
    expect(body).toContain(`data-testid="${DEMO_BANNER_TESTID}"`);
  });

  it('public page OMITS the banner on real production data (safety property)', async () => {
    const body = await (await handlePublicPage(PROD_ENV)).text();
    expect(body).not.toContain(`data-testid="${DEMO_BANNER_TESTID}"`);
  });

  it('display page includes the banner in mock mode', async () => {
    const body = await (await handleDisplayPage(MOCK_ENV)).text();
    expect(body).toContain(`data-testid="${DEMO_BANNER_TESTID}"`);
  });

  it('display page OMITS the banner on real production data', async () => {
    const body = await (await handleDisplayPage(PROD_ENV)).text();
    expect(body).not.toContain(`data-testid="${DEMO_BANNER_TESTID}"`);
  });

  it('display page in a DB outage shows the degraded indicator, NOT the demo banner', async () => {
    const body = await (await handleDisplayPage({ WORKER_ENV: 'production' } as never)).text();
    expect(body).toContain(`data-testid="${DEGRADED_BANNER_TESTID}"`);
    expect(body).not.toContain(`data-testid="${DEMO_BANNER_TESTID}"`);
  });
});

// CodeQL js/polynomial-redos (main, since 2026-10-10): the injector used
// /(<body[^>]*>)/i, which rescans to the end from every "<body" with no ">"
// after it. It now finds the first "<body" and the first ">" after it.
describe('injectProvenanceBanner: same placement, linear time', () => {
  const mark = (doc: string) => injectProvenanceBanner(doc, 'demo');
  const banner = demoBannerMarkup();

  it('goes straight after the opening body tag, attributes and case kept', () => {
    expect(mark('<html><BODY class="a" data-x=1><main>x</main></BODY></html>')).toBe(
      `<html><BODY class="a" data-x=1>${banner}<main>x</main></BODY></html>`
    );
  });

  it('a document with no body tag, or one never closed, is returned unchanged', () => {
    expect(mark('<p>no body here</p>')).toBe('<p>no body here</p>');
    expect(mark('<html><body')).toBe('<html><body');
  });

  it('only the first body tag gets the banner', () => {
    expect(mark('<body><body>')).toBe(`<body>${banner}<body>`);
  });

  it('many unclosed "<body" do not take quadratic time', () => {
    const hostile = '<body'.repeat(20_000); // 100 KB; the old regex took ~0.8 s locally
    const t0 = performance.now();
    expect(mark(hostile)).toBe(hostile);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
