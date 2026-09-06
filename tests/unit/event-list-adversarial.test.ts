/**
 * @vitest-environment jsdom
 */
/**
 * RED TEAM (renderer tier) — adversarial input to the server-rendered event list.
 *
 * WHY THIS EXISTS. OSE-1243 moved the public event list from client-rendered to
 * server-rendered, and that MOVED THE TRUST BOUNDARY. Before, an event title
 * reached the reader as a JSON string that the browser escaped on arrival via
 * textContent. Now it reaches them as HTML the Worker concatenated. The
 * escaping is ours, it happens once, and if it is wrong the payload is served
 * to every visitor of a PUBLIC page — no login, no interaction, no admin
 * surface required. That is a new attack surface, so it gets adversarial
 * coverage rather than the two happy-path escaping assertions the old E2E
 * suite carried.
 *
 * WHY HERE AND NOT IN tests/red-team/. Those suites hit a deployed target and
 * need ADMIN_KEY to plant a payload — and CI does not run them at all (no
 * workflow references the directory; OSE-1244). A corpus test against the
 * renderer runs on every push, needs no staging, and covers far more shapes.
 * The live stored-XSS path is covered separately in
 * tests/red-team/public-list-stored-xss.spec.ts.
 *
 * THREAT MODEL — an attacker controls event fields (title, venue, id) through
 * an organiser account, a CSV import, or a compromised upstream, and wants:
 *   RT-L-001  script execution in the reader's page
 *   RT-L-002  escape from a quoted attribute into a new attribute
 *   RT-L-003  breaking out of the card into surrounding markup
 *   RT-L-004  a javascript: or data: URL in the CTA
 *   RT-L-005  redirecting the CTA to an attacker origin
 *   RT-L-006  smuggling markup through the sr-only live region
 *   RT-L-007  denial of service through pathological input
 */
import { describe, test, expect } from 'vitest';
import { renderEventList } from '../../workers/oursharedevents/src/lib/event-list.js';

/** Payload corpus. Each is placed in every attacker-controlled field in turn. */
const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><script>alert(1)</script>',
  "'><script>alert(1)</script>",
  '" onmouseover="alert(1)',
  "' onmouseover='alert(1)",
  '"><img src=x onerror=alert(1)>',
  '</h3><script>alert(1)</script><h3>',
  '</div></div><script>alert(1)</script>',
  '<svg/onload=alert(1)>',
  '<iframe src="javascript:alert(1)">',
  '<body onload=alert(1)>',
  'javascript:alert(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  '<a href="https://evil.test">x</a>',
  '<!--<script>alert(1)</script>-->',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '&#60;script&#62;alert(1)&#60;/script&#62;',
  '<SCRIPT>alert(1)</SCRIPT>',
  '<ScRiPt>alert(1)</ScRiPt>',
  "\"><style>@import'javascript:alert(1)'</style>",
  '<base href="https://evil.test/">',
  '<form action="https://evil.test"><button>x',
  '<script >alert(1)</script>',
  '<script\\u0000>alert(1)</script>',
  '\\u003cscript\\u003ealert(1)\\u003c/script\\u003e',
];

const FIELDS = ['name', 'venue', 'id'] as const;

/** Parse rendered output into a real DOM — the HTML parser is the oracle. */
function dom(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

function renderWith(field: string, payload: string): HTMLElement {
  return dom(
    renderEventList([
      {
        id: 'evt_safe',
        name: 'Safe Name',
        venue: 'Safe Venue',
        startDateISO: '2026-10-02T18:00:00Z',
        phase: 'pre_event',
        [field]: payload,
      },
    ]).html
  );
}

describe('RT-L-001 | no payload in any field produces an executable element', () => {
  for (const field of FIELDS) {
    test(field + ': no script, iframe, svg, base, form or style is ever constructed', () => {
      for (const payload of PAYLOADS) {
        const el = renderWith(field, payload);
        const dangerous = el.querySelectorAll(
          'script, iframe, object, embed, svg, base, form, style, link, meta'
        );
        expect(dangerous.length, field + ' <- ' + payload).toBe(0);
      }
    });
  }
});

describe('RT-L-002 | no payload introduces an event-handler attribute', () => {
  for (const field of FIELDS) {
    test(field + ': no on* attribute appears on any node', () => {
      for (const payload of PAYLOADS) {
        const el = renderWith(field, payload);
        const handlers = [...el.querySelectorAll('*')].flatMap((n) =>
          n.getAttributeNames().filter((a) => a.toLowerCase().startsWith('on'))
        );
        expect(handlers, field + ' <- ' + payload).toEqual([]);
      }
    });
  }
});

describe('RT-L-003 | the card structure is not escapable', () => {
  for (const field of FIELDS) {
    test(field + ': exactly one card, with its expected children intact', () => {
      for (const payload of PAYLOADS) {
        const el = renderWith(field, payload);
        expect(
          el.querySelectorAll('[data-testid="public-event-card"]').length,
          field + ' <- ' + payload
        ).toBe(1);
        expect(el.querySelectorAll('[data-testid="public-event-name"]').length).toBe(1);
        expect(el.querySelectorAll('[data-testid="public-event-cta"]').length).toBe(1);
      }
    });
  }
});

describe('RT-L-004 / RT-L-005 | the CTA href stays on our origin and our scheme', () => {
  for (const field of FIELDS) {
    test(field + ': href resolves to a same-origin /forms/ or /events/ path', () => {
      for (const payload of PAYLOADS) {
        const el = renderWith(field, payload);
        const href =
          el.querySelector('[data-testid="public-event-cta"]')?.getAttribute('href') ?? '';
        // Resolved against a base: an injected absolute URL changes the origin
        // and a javascript:/data: payload changes the protocol. Both caught.
        const url = new URL(href, 'https://ose.test');
        expect(url.origin, field + ' <- ' + payload).toBe('https://ose.test');
        expect(url.protocol).toBe('https:');
        expect(url.pathname.startsWith('/forms/') || url.pathname.startsWith('/events/')).toBe(
          true
        );
      }
    });
  }
});

describe('RT-L-006 | the sr-only count region carries no markup', () => {
  test('the count is a plain phrase regardless of the events behind it', () => {
    for (const payload of PAYLOADS) {
      const { countText } = renderEventList([
        { id: 'a', name: payload, venue: payload, phase: 'pre_event' },
      ]);
      // The count is derived from a length, never from content. It is injected
      // into an aria-live region, so assert that stays true.
      expect(countText, payload).toMatch(/^\d+ upcoming events?$/);
    }
  });
});

describe('RT-L-007 | pathological input does not hang or crash the renderer', () => {
  test('a 100k-character name renders in bounded time', () => {
    const started = Date.now();
    const { html } = renderEventList([{ id: 'a', name: 'A'.repeat(100000), phase: 'pre_event' }]);
    expect(html).toContain('public-event-card');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('a name of only escapable characters does not blow up quadratically', () => {
    const started = Date.now();
    renderEventList([{ id: 'a', name: '<&">\''.repeat(20000), phase: 'pre_event' }]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('500 events render without error', () => {
    const items = Array.from({ length: 500 }, (_, i) => ({
      id: 'e' + i,
      name: 'Event ' + i,
      phase: 'pre_event',
    }));
    const { html, upcoming } = renderEventList(items);
    expect(upcoming).toBe(500);
    expect(dom(html).querySelectorAll('[data-testid="public-event-card"]').length).toBe(500);
  });

  test('deeply nested markup in a field does not nest in the output', () => {
    const el = renderWith('name', '<div>'.repeat(5000));
    expect(el.querySelectorAll('div [data-testid="public-event-name"]').length).toBeLessThan(3);
  });
});
