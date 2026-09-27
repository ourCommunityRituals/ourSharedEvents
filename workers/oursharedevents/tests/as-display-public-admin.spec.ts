/**
 * AS-3: data-testid on Display (OSE-48)
 * AS-4: data-testid on Public (OSE-49)
 * AS-5: ARIA attributes on Admin (OSE-50)
 * AS-6: ARIA attributes on Public (OSE-51)
 * AS-7: ARIA attributes on Display (OSE-52)
 */

import { describe, test, expect } from 'vitest';
import { handleAdminPage, handleDisplayPage } from '../src/handlers/pages';
import { handleFormPage } from '../src/handlers/form-pages';
import { renderEventList, renderEventListError } from '../src/lib/event-list.js';

function adminHtml(): Promise<string> {
  return handleAdminPage({} as never).text();
}
function displayHtml(): Promise<string> {
  return handleDisplayPage({} as never).then((r) => r.text());
}
async function publicHtml(): Promise<string> {
  const req = new Request('https://t.test/');
  try {
    return await (await handleFormPage(req, {}, '')).text();
  } catch {
    // PUBLIC_HTML is served by the main router; derive from pages export
    return '';
  }
}

// Use the pages module directly for PUBLIC_HTML
import { handlePublicPage } from '../src/handlers/pages';
function pubHtml(): Promise<string> {
  return handlePublicPage({} as never).then((r) => r.text());
}

// ─── AS-3: Display data-testid coverage ──────────────────────────────────────

describe('AS-3: Display page has 10+ data-testid values (OSE-48)', () => {
  const requiredIds = [
    'display-header',
    'display-clock',
    'display-sponsor-sidebar',
    'display-main',
    'display-sponsor-banner',
    'display-ticker',
    'display-featured-card',
    'display-featured-title',
    'display-featured-meta',
    'display-upcoming',
    'display-upcoming-card',
  ];

  for (const id of requiredIds) {
    test(`display page has data-testid="${id}"`, async () => {
      expect(await displayHtml()).toContain(`data-testid="${id}"`);
    });
  }

  test('display page has 10+ distinct data-testid values', async () => {
    const body = await displayHtml();
    const matches = body.match(/data-testid="([^"]+)"/g) ?? [];
    const ids = new Set(matches.map((m) => m.match(/data-testid="([^"]+)"/)?.[1] ?? ''));
    expect(ids.size).toBeGreaterThanOrEqual(10);
  });
});

// ─── AS-7: Display ARIA ───────────────────────────────────────────────────────

describe('AS-7: ARIA attributes on Display page (OSE-52)', () => {
  test('display header has aria-label', async () => {
    const body = await displayHtml();
    expect(body).toMatch(/data-testid="display-header"[^>]*aria-label=/);
  });

  test('display sidebar has aria-label="Side sponsors"', async () => {
    expect(await displayHtml()).toContain('aria-label="Side sponsors"');
  });

  test('display main has aria-live="polite"', async () => {
    const body = await displayHtml();
    expect(body).toMatch(/data-testid="display-main"[^>]*aria-live="polite"/);
  });

  test('display main has aria-atomic="false"', async () => {
    expect(await displayHtml()).toContain('aria-atomic="false"');
  });

  test('display ticker is aria-hidden', async () => {
    expect(await displayHtml()).toMatch(
      /data-testid="display-ticker"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*data-testid="display-ticker"/
    );
  });
});

// ─── AS-4: Public data-testid coverage ───────────────────────────────────────

describe('AS-4: Public page has 15+ data-testid values (OSE-49)', () => {
  // OSE-1243 split this list in two. The public list is server-rendered now, so
  // the page no longer carries every state's markup at once — it carries the
  // state it is actually in. Asserting all of them against one response would
  // mean re-adding dead markup to satisfy a test.
  //
  // `public-loading` is gone outright and is not listed anywhere below: there
  // is no loading state, because nothing loads after the response.
  const alwaysPresent = [
    'public-header',
    'public-main',
    'public-sponsor-banner',
    'public-events-heading',
    'public-events',
    'public-events-count',
    'public-sponsor-card',
    'public-sponsor-name',
  ];

  // Present when the page has events to show. `pubHtml()` passes an empty env,
  // so the DataProvider falls through to its fixture and this is the state it
  // renders — the populated one.
  const whenPopulated = [
    'public-event-card',
    'public-event-info',
    'public-event-name',
    'public-event-meta',
    'public-event-cta',
  ];

  for (const id of [...alwaysPresent, ...whenPopulated]) {
    test(`public page has data-testid="${id}"`, async () => {
      expect(await pubHtml()).toContain(`data-testid="${id}"`);
    });
  }

  // The two state-dependent ids, asserted against the state that produces them.
  // Reached through the renderer rather than the handler because that is where
  // the state is decided; the handler's job is only to pick one.
  test('the empty state carries data-testid="public-events-empty"', () => {
    expect(renderEventList([]).html).toContain('data-testid="public-events-empty"');
  });

  test('the error state carries data-testid="public-error"', () => {
    expect(renderEventListError().html).toContain('data-testid="public-error"');
  });

  test('public page has 15+ distinct data-testid values', async () => {
    const body = await pubHtml();
    const matches = body.match(/data-testid="([^"]+)"/g) ?? [];
    const ids = new Set(matches.map((m) => m.match(/data-testid="([^"]+)"/)?.[1] ?? ''));
    expect(ids.size).toBeGreaterThanOrEqual(15);
  });
});

// ─── AS-6: Public ARIA ────────────────────────────────────────────────────────

describe('AS-6: ARIA attributes on Public page (OSE-51)', () => {
  test('public header has role="banner"', async () => {
    expect(await pubHtml()).toContain('role="banner"');
  });

  test('public header has aria-label', async () => {
    const body = await pubHtml();
    expect(body).toMatch(/data-testid="public-header"[^>]*aria-label=/);
  });

  test('public main has aria-label', async () => {
    const body = await pubHtml();
    expect(body).toMatch(/data-testid="public-main"[^>]*aria-label=/);
  });

  test('public events container has aria-live="polite"', async () => {
    const body = await pubHtml();
    expect(body).toMatch(/data-testid="public-events"[^>]*aria-live="polite"/);
  });

  test('public loading paragraph has role="status"', async () => {
    expect(await pubHtml()).toContain('role="status"');
  });

  test('public sponsor banner has aria-label', async () => {
    const body = await pubHtml();
    expect(body).toMatch(/data-testid="public-sponsor-banner"[^>]*aria-label=/);
  });

  test('public CTA links have aria-label for screen readers', async () => {
    // OSE-1243: this used to assert the literal 'aria-label="Register for',
    // which passed because that string sat in the template's client script —
    // it was true of the SOURCE regardless of what the page rendered. The list
    // is server-rendered now, so the CTA reflects the event's real phase: a
    // past event gets a recap link, and asserting "Register" would fail
    // whenever the fixture aged past its own date (which is exactly how this
    // was found). What the a11y contract actually requires is that whichever
    // CTA renders is labelled.
    expect(await pubHtml()).toMatch(/data-testid="public-event-cta"[^>]*aria-label="[^"]+"/);
  });

  test('both CTA variants are labelled, not just the one the fixture renders', () => {
    const pre = renderEventList([{ id: 'e1', name: 'Bocce Thursday', phase: 'pre_event' }]).html;
    const post = renderEventList([{ id: 'e2', name: 'Game Night', phase: 'post_event' }]).html;
    expect(pre).toContain('aria-label="Register for Bocce Thursday"');
    expect(post).toContain('aria-label="See how Game Night went"');
  });

  test('event cards expose the article role via a semantic <article> (AS-6 role criterion)', () => {
    // AS-6: "Event cards use role='article' or role='region'." The card is a
    // semantic <article>, which conveys role="article" to assistive tech — the
    // WAI-ARIA-preferred native mechanism (a redundant explicit role="article"
    // on <article> is an anti-pattern). This locks the contract: a refactor of
    // the card wrapper to a <div> would silently drop the role and fail here.
    const list = renderEventList([{ id: 'e1', name: 'Bocce Thursday', phase: 'pre_event' }]).html;
    expect(list).toMatch(/<article\b[^>]*\bclass="event-card"/);
    expect(list).toContain('data-testid="public-event-card"');
  });
});

// ─── AS-5: Admin ARIA ─────────────────────────────────────────────────────────

describe('AS-5: ARIA attributes on Admin page (OSE-50)', () => {
  test('admin header has aria-label', async () => {
    const body = await adminHtml();
    expect(body).toMatch(/data-testid="admin-header"[^>]*aria-label=/);
  });

  test('admin main has aria-label', async () => {
    const body = await adminHtml();
    expect(body).toMatch(/data-testid="admin-main"[^>]*aria-label=/);
  });

  test('admin create-event form has aria-label', async () => {
    expect(await adminHtml()).toContain('aria-label="Create new event"');
  });

  test('admin create-title input has aria-required="true"', async () => {
    expect(await adminHtml()).toContain('aria-required="true"');
  });

  test('admin create-msg has role="status" and aria-live="polite"', async () => {
    const body = await adminHtml();
    expect(body).toMatch(/data-testid="create-msg"[^>]*role="status"/);
    expect(body).toMatch(/data-testid="create-msg"[^>]*aria-live="polite"/);
  });

  test('admin sponsor form msg has role="status"', async () => {
    expect(await adminHtml()).toContain('role="status"');
  });
});
