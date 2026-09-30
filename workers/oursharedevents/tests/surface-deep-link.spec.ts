/**
 * OSE-1081 — the surface deep-link addressing contract.
 *
 * THE BREAK. admin.html's `scopedSurfaceUrl()` has always emitted
 * `/poster?event=<id>`, `/display?event=<id>` and `/sharedReport?event=<id>` —
 * but nothing on the receiving end read that param. poster.html and display.html
 * fetched `/api/v2/events` and rendered `items[0]` regardless of the query
 * string, and shared-report.html only ever looked for `?eventId=` / `?id=`. So
 * every event-scoped surface link an organizer copied out of the dashboard
 * silently showed SOME OTHER event: the producer and the consumers had never
 * agreed on a param name.
 *
 * THE CONTRACT this spec pins: `event` is canonical — the admin emits it and
 * every surface consumes it — while shared-report additionally keeps honouring
 * the legacy `eventId` / `id` shapes so links already in the wild keep working.
 *
 * WHY STRUCTURAL, NOT BEHAVIORAL. These are inline `<script>` blocks in worker
 * HTML templates. The pool that runs this suite is workerd — no DOM, no jsdom —
 * and the repo's one jsdom config (vitest.config.a11y.mts) deliberately loads
 * pages with `runScripts: 'outside-only'` so page scripts never execute. There
 * is therefore no harness here that can drive these scripts for real; a true
 * behavioral test needs the Playwright surface tier. So the assertions below are
 * structural — but taken against BOTH the template source AND the bytes the
 * worker actually serves, so a regressed template and a page handler that
 * stopped serving `src/templates/` each go red. Same shape as the L1 half of
 * tests/poster-qr.spec.ts.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import {
  handlePosterPage,
  handleDisplayPage,
  handleSharedReportPage,
  type PagesEnv,
} from '../src/handlers/pages';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;
const pagesEnv = () => env as unknown as PagesEnv;

function sourceFile(suffix: string): string {
  const files: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  // Normalize path separators so both Windows and posix keys match.
  const key = Object.keys(files).find((k) => k.replace(/\\/g, '/').endsWith(suffix));
  return key ? files[key] : '';
}

/** The canonical read, character-for-character as each surface performs it. */
const CANONICAL_READ = "new URLSearchParams(location.search).get('event')";

// ── Producer side: the admin dashboard emits `event` ─────────────────────────

describe('OSE-1081 — the admin emits ?event= for every scoped surface', () => {
  test('scopedSurfaceUrl builds poster / display / sharedReport links on `event`', () => {
    const admin = sourceFile('templates/admin.html');
    expect(admin).toContain("'/poster?event='");
    expect(admin).toContain("'/display?event='");
    expect(admin).toContain("'/sharedReport?event='");
  });
});

// ── Consumer side: poster ─────────────────────────────────────────────────────

describe('OSE-1081 — poster.html honours ?event=', () => {
  test('reads the canonical `event` query param', () => {
    expect(sourceFile('templates/poster.html')).toContain(CANONICAL_READ);
  });

  // OSE-867 superseded the list-and-match shape: a scoped poster no longer
  // fetches the events list at all. The id goes (encoded) into ONE
  // poster-bundle call and the poster renders what that bundle returns, so it
  // can only ever show the event named — or say the poster is unavailable.
  test('fetches the named event directly, encoded into the poster-bundle path', () => {
    const poster = sourceFile('templates/poster.html');
    expect(poster).toContain('loadPosterBundle(wanted, true)');
    expect(poster).toContain(
      "fetch('/api/v2/events/' + encodeURIComponent(eventId) + '/poster-bundle')"
    );
  });

  test('never falls back to some other event when the named one cannot be shown', () => {
    const poster = sourceFile('templates/poster.html');
    const scoped = poster.slice(
      poster.indexOf('if (wanted) {'),
      poster.indexOf('// No event named')
    );
    expect(scoped).toContain('data-testid="poster-error"');
    expect(scoped).toContain('return;');
    expect(scoped, 'scoped path must not fetch the list').not.toContain("fetch('/api/v2/events')");
  });

  test('renders the poster from the bundle event, not from a list index', () => {
    const poster = sourceFile('templates/poster.html');
    expect(poster).toContain('renderPoster(data.event)');
  });

  test('the SERVED poster page carries the param read (not just the file on disk)', async () => {
    const served = await (
      await handlePosterPage(pagesEnv(), new Request('https://t.test/poster?event=evt-1'))
    ).text();
    expect(served).toContain(CANONICAL_READ);
    expect(served).toContain('loadPosterBundle(wanted, true)');
  });
});

// ── Consumer side: display ────────────────────────────────────────────────────

describe('OSE-1081 — display.html honours ?event=', () => {
  test('reads the canonical `event` query param', () => {
    expect(sourceFile('templates/display.html')).toContain(CANONICAL_READ);
  });

  test('features the requested event instead of the destructured items[0]', () => {
    const display = sourceFile('templates/display.html');
    expect(display).toContain('const featured = items[featuredIdx]');
    expect(display, 'loadEvents still hard-features the first item').not.toContain(
      'const [featured, ...rest] = items'
    );
  });

  test('the rest of the board is every OTHER event (nothing is hidden)', () => {
    expect(sourceFile('templates/display.html')).toContain(
      'items.filter((_, i) => i !== featuredIdx)'
    );
  });

  test('sponsors follow the featured event, so the two halves cannot disagree', () => {
    const display = sourceFile('templates/display.html');
    const sponsors = display.slice(display.indexOf('async function loadDisplaySponsors'));
    expect(sponsors).toContain('requestedEventIndex(items)');
    expect(sponsors, 'sponsor lookup still pinned to items[0]').not.toContain(
      'const eventId = items[0].id'
    );
  });

  test('falls back to the first event when the param is absent or unknown', () => {
    expect(sourceFile('templates/display.html')).toContain(
      'Math.max(requestedEventIndex(items), 0)'
    );
  });

  test('the SERVED display page carries the param read', async () => {
    const served = await (await handleDisplayPage(pagesEnv())).text();
    expect(served).toContain(CANONICAL_READ);
    expect(served).toContain('const featured = items[featuredIdx]');
  });
});

// ── Consumer side: shared report (additive — legacy params survive) ───────────

describe('OSE-1081 — shared-report.html accepts `event` WITHOUT dropping legacy params', () => {
  test('signed-link reader takes event first, then eventId, then id', () => {
    expect(sourceFile('templates/shared-report.html')).toContain(
      "params.get('event') || params.get('eventId') || params.get('id') || ''"
    );
  });

  test('JSON export names the event the reader is looking at', () => {
    expect(sourceFile('templates/shared-report.html')).toContain(
      "params.get('event') || params.get('eventId') || params.get('id') || 'all'"
    );
  });

  test('legacy ?eventId= and ?id= links still resolve (this was additive)', () => {
    const report = sourceFile('templates/shared-report.html');
    expect(report).toContain("params.get('eventId')");
    expect(report).toContain("params.get('id')");
    // The /sharedReport/:eventId path form is untouched too.
    expect(report).toContain('location.pathname.match(/^\\/sharedReport\\/([^/?#]+)/)');
  });

  test('the SERVED shared-report page carries the widened read', async () => {
    const served = await (await handleSharedReportPage(pagesEnv())).text();
    expect(served).toContain("params.get('event') || params.get('eventId') || params.get('id')");
  });
});

// ── Security: the attacker-controllable `event` param must stay inert ─────────

describe('OSE-1081 — the event deep-link param is never reflected (XSS-inert)', () => {
  // `event` is attacker-controllable (it rides in on location.search). OSE-1081
  // must keep it a pure SELECTOR — a value compared against server-provided event
  // ids to pick an index, or fed through encodeURIComponent() into a fetch URL —
  // and never let it reach an HTML/inline-script sink. The repo's known failure
  // mode (OSE-R-015) is one unescaped char breaking out of a string context, so
  // these assertions pin that the raw param can never land in innerHTML.
  //
  // Born-red proof (2026-08-28): inserting `el.innerHTML = wanted;` into
  // poster.html (or echoing the query into the served bytes) turns the matching
  // assertion below red; the shipped templates keep them green.

  // A raw-param identifier sitting on the same statement as an innerHTML write is
  // the reflection sink this suite forbids.
  const reflectsIntoMarkup = (src: string, paramVar: string): boolean =>
    new RegExp(`innerHTML[^\\n;]*\\b${paramVar}\\b|\\b${paramVar}\\b[^\\n;]*innerHTML`).test(src);

  test('poster.html uses the `event` param only as an encoded fetch path, never in innerHTML', () => {
    const poster = sourceFile('templates/poster.html');
    // The param is read and only ever sent, encoded, as a path segment (OSE-867).
    expect(poster).toContain(CANONICAL_READ);
    expect(poster).toContain('encodeURIComponent(eventId)');
    // …and the raw param value never reaches a markup sink.
    expect(reflectsIntoMarkup(poster, 'wanted'), 'raw event param reaches innerHTML').toBe(false);
  });

  test('display.html uses the `event` param only as an id-match selector, never in innerHTML', () => {
    const display = sourceFile('templates/display.html');
    expect(display).toContain(CANONICAL_READ);
    expect(display).toMatch(/items\[i\]\.id === wanted/);
    expect(reflectsIntoMarkup(display, 'wanted'), 'raw event param reaches innerHTML').toBe(false);
  });

  test('shared-report.html routes the resolved event id through encodeURIComponent, never innerHTML', () => {
    const report = sourceFile('templates/shared-report.html');
    // The only network use of the id is an encoded path segment.
    expect(report).toContain('encodeURIComponent(eventId)');
    // The resolved id never reaches a markup sink (the download filename is a
    // property assignment on a never-inserted <a>, not innerHTML).
    expect(reflectsIntoMarkup(report, 'eventId'), 'resolved event id reaches innerHTML').toBe(
      false
    );
  });

  test('the SERVED poster page does not reflect an `event` payload into its HTML', async () => {
    const payload = '"></script><script>alert(document.domain)</script>';
    const res = await handlePosterPage(
      pagesEnv(),
      new Request('https://t.test/poster?event=' + encodeURIComponent(payload))
    );
    const body = await res.text();
    // The surface is a static template; the param is resolved client-side, so the
    // attacker string must never appear in the bytes the worker serves.
    expect(body).not.toContain('<script>alert(document.domain)</script>');
    expect(body).not.toContain(payload);
  });
});

// ── The inline scripts must still be intact + noncable ───────────────────────

describe('OSE-1081 — the inline scripts survive the edit', () => {
  // The repo's hard-won lesson (OSE-R-015): one unescaped quote inside these
  // The repo's hard-won lesson (OSE-R-015): one unescaped quote inside these
  // string-concatenated templates kills the ENTIRE inline script — no picker, no
  // QR, no sponsors — and the page still returns 200, so only a parse check
  // catches it. Every <script> must also stay a bare `<script>`/`<script ...>`
  // that pages.ts can rewrite to `<script nonce="…">`; an already-noncedheader
  // or a stray attribute-less rewrite would break CSP.
  for (const name of ['poster', 'display', 'shared-report'] as const) {
    test(`${name}.html inline scripts parse as JavaScript`, () => {
      const html = sourceFile(`templates/${name}.html`);
      const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
      expect(blocks.length, 'expected at least one inline script').toBeGreaterThan(0);
      for (const [, body] of blocks) {
        // Constructing (not running) the function is a full parse of the block.
        expect(() => new Function(body)).not.toThrow();
      }
    });

    test(`${name}.html carries no hard-coded nonce (pages.ts injects it)`, () => {
      expect(sourceFile(`templates/${name}.html`)).not.toContain('nonce=');
    });
  }

  test('the served pages get a CSP nonce on every inline script', async () => {
    const res = await handlePosterPage(pagesEnv(), new Request('https://t.test/poster?event=x'));
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce, 'CSP header must carry a nonce').toBeTruthy();
    const body = await res.text();
    const scriptTags = [...body.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scriptTags.length).toBeGreaterThan(0);
    for (const tag of scriptTags) expect(tag, tag).toContain(`nonce="${nonce}"`);
  });
});
