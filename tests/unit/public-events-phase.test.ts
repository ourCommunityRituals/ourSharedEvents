/**
 * @vitest-environment jsdom
 */
/**
 * OSE-1205 — /events is phase-aware. Executes the REAL script from
 * src/templates/public.html in jsdom against a stubbed /api/v2/events, then
 * reads the DOM it produced:
 *   - a post_event item renders a "Wrapped" tag and a recap CTA → /events/:id
 *   - a pre_event item keeps the Register CTA → /forms/:id?type=register
 *   - the sr-only count excludes wrapped events
 *   - an empty list renders the empty state
 * Runs the template's own code, so a regression in the template (not a copy
 * of it) is what turns this red.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TEMPLATE = join(
  __dirname,
  '..',
  '..',
  'workers',
  'oursharedevents',
  'src',
  'templates',
  'public.html'
);

function eventsScript() {
  const html = readFileSync(TEMPLATE, 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const src = scripts.find((s) => s.includes("fetch('/api/v2/events')"));
  if (!src) throw new Error('public.html: events script not found');
  return src;
}

interface Item {
  id: string;
  name: string;
  startDateISO: string;
  venue: string;
  phase: string;
}

async function render(items: Item[]): Promise<HTMLElement> {
  document.body.innerHTML = `
    <p id="events-count" class="sr-only" data-testid="public-events-count"></p>
    <div id="events" data-testid="public-events"><p class="loading">Loading…</p></div>`;
  window.fetch = (async () => ({
    json: async () => ({ ok: true, items }),
  })) as unknown as typeof fetch;
  // The template's script is an async IIFE; run it, then let its awaits settle.
  new Function(eventsScript())();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return document.getElementById('events') as HTMLElement;
}

const wrapped = {
  id: 'evt-wrapped',
  name: 'Community Game Night',
  startDateISO: '2026-05-01',
  venue: 'Beverly Arts Center',
  phase: 'post_event',
};
const upcoming = {
  id: 'evt-next',
  name: 'Bocce Thursday',
  startDateISO: '2026-10-02',
  venue: 'RIPH',
  phase: 'pre_event',
};

describe('OSE-1205 | /events phase-aware cards (template script executed in jsdom)', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = window.fetch;
  });
  afterEach(() => {
    window.fetch = originalFetch;
    document.body.innerHTML = '';
  });

  test('post_event → Wrapped tag + recap CTA to /events/:id, never a registration form', async () => {
    const el = await render([wrapped]);
    const card = el.querySelector('[data-testid="public-event-card"]') as HTMLElement;
    expect(card.getAttribute('data-phase')).toBe('post_event');
    expect(card.querySelector('[data-testid="public-event-wrapped"]')?.textContent).toBe('Wrapped');
    const cta = card.querySelector('[data-testid="public-event-cta"]') as HTMLAnchorElement;
    expect(cta.getAttribute('data-cta')).toBe('recap');
    expect(cta.getAttribute('href')).toBe('/events/evt-wrapped');
    expect(cta.textContent).toBe('See how it went');
    expect(card.innerHTML).not.toContain('type=register');
  });

  test('pre_event → Register CTA to /forms/:id?type=register, no Wrapped tag', async () => {
    const el = await render([upcoming]);
    const card = el.querySelector('[data-testid="public-event-card"]') as HTMLElement;
    expect(card.getAttribute('data-phase')).toBe('pre_event');
    expect(card.querySelector('[data-testid="public-event-wrapped"]')).toBeNull();
    const cta = card.querySelector('[data-testid="public-event-cta"]') as HTMLAnchorElement;
    expect(cta.getAttribute('data-cta')).toBe('register');
    expect(cta.getAttribute('href')).toMatch(/^\/forms\/evt-next\?type=register/);
    expect(cta.textContent).toBe('Register');
  });

  test('the sr-only count excludes wrapped events', async () => {
    await render([wrapped, upcoming]);
    expect(document.getElementById('events-count')?.textContent).toBe('1 upcoming event');
  });

  test('empty list → empty state', async () => {
    const el = await render([]);
    expect(el.querySelector('[data-testid="public-events-empty"]')?.textContent).toBe(
      'No events scheduled.'
    );
  });
});
