/**
 * OSE-1529: organizer entry. The two landing cards and the Worker's sign-in page
 * explain themselves, in plain words, before anyone is sent to a login.
 *
 * Observed on staging (design critiques, 2026-10-02): "Create an event" and "Create
 * a sponsor" both linked to bare /admin and neither said sign-in was needed; the
 * sign-in page said who it was for in one sentence and then offered a "subscribe and
 * we'll be in touch" path that does not exist (the landing collects no contact data).
 *
 * These are copy-and-link contracts, so they assert the rendered pages. Each was
 * seen red against the pre-change templates. Honesty rules that must hold:
 *   - OurSharedEvents never sees a password (Cloudflare Access does the sign-in).
 *   - No contact detail (email, phone) is printed as support: that is PII we do not
 *     publish, and the way out for a locked-out organizer is the person who invited them.
 *   - The page adds no inline script and no inline style attribute (CSP, token budget).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';

async function get(path: string, accept = 'text/html'): Promise<{ status: number; html: string }> {
  const res = await SELF.fetch(`https://t.test${path}`, { headers: { Accept: accept } });
  return { status: res.status, html: await res.text() };
}

/** The element carrying a test id, from its opening tag to the matching close. */
function block(html: string, testid: string): string {
  const open = html.search(new RegExp(`<(\\w+)[^>]*data-testid="${testid}"`));
  if (open < 0) return '';
  const tag = /<(\w+)/.exec(html.slice(open))![1];
  let depth = 0;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = open;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(open, re.lastIndex);
  }
  return html.slice(open);
}

/** Comments in the served templates mention <h1> and <script>; the page itself does not. */
/** Cut every `open ... close` span with a scan, not a regex: an unclosed opener drops the rest. */
const cutSpans = (s: string, open: string, close: string) => {
  let out = '';
  let i = 0;
  for (;;) {
    const a = s.indexOf(open, i);
    if (a < 0) return out + s.slice(i);
    out += s.slice(i, a);
    const b = s.indexOf(close, a + open.length);
    if (b < 0) return out;
    i = b + close.length;
  }
};
const stripComments = (s: string) => cutSpans(cutSpans(s, '<!--', '-->'), '/*', '*/');

const text = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x2019;|&rsquo;/g, "'")
    .replace(/&mdash;/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

describe('OSE-1529 | landing create cards', () => {
  let html = '';
  beforeAll(async () => {
    html = stripComments((await get('/')).html);
  });

  it('each card links to its own entry point, not a shared bare /admin', () => {
    const event = /<a[^>]*href="([^"]*)"[^>]*data-testid="door-create-event"/.exec(html);
    const sponsor = /<a[^>]*href="([^"]*)"[^>]*data-testid="door-create-sponsor"/.exec(html);
    expect(event?.[1]).toBe('/admin?start=event');
    expect(sponsor?.[1]).toBe('/admin?start=sponsor');
    expect(event?.[1]).not.toBe(sponsor?.[1]);
  });

  // Owner 2026-10-10: far less text. Each card is one button that says what it
  // does and that it signs you in; the why sits behind "Why sign in?".
  it('each card is one button that says what it does and that it signs you in', () => {
    const ev = block(html, 'door-create-event');
    const sp = block(html, 'door-create-sponsor');
    expect(ev).toMatch(/<span[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*data-testid="door-event-cta"/);
    expect(sp).toMatch(/<span[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*data-testid="door-sponsor-cta"/);
    expect(text(ev)).toBe('Sign in to create an event');
    expect(text(sp)).toBe('Sign in to add a sponsor');
  });

  it('the why is one note behind a native disclosure, collapsed', () => {
    const doors = block(html, 'landing-doors');
    expect(doors).toMatch(/<details class="doors-why">\s*<summary>Why sign in\?<\/summary>/);
    expect(doors).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it('one shared note explains why: email code via Cloudflare Access, no password, never-who', () => {
    const note = text(block(html, 'doors-signin-note'));
    expect(note).toMatch(/Cloudflare Access/);
    expect(note).toMatch(/one-time code/i);
    expect(note).toMatch(/never sees or stores a password/i);
    expect(note).toMatch(/by invitation/i);
    expect(note).toMatch(/attendees never sign in/i);
  });

  it('the note sits inside the doors section, so the map gate that moves the doors moves it too', () => {
    const doors = block(html, 'landing-doors');
    expect(doors).toContain('data-testid="doors-signin-note"');
    expect(html.match(/data-testid="doors-signin-note"/g)?.length).toBe(1);
  });

  // Two scripts, both inline. "Use my location" since 2026-10-10 (its limits:
  // tests/landing-where-unit.spec.ts), and since 2026-11-10 the header Language
  // menu's closer, which only shuts an open menu (tests/language-menu-close.spec.ts).
  // Nothing else runs here.
  it('still exactly one <h1>, two scripts (location button, menu closer), no style attribute', () => {
    expect(html.match(/<h1\b/g)?.length).toBe(1);
    const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi) ?? [];
    expect(scripts.length).toBe(2);
    expect(scripts.filter((s) => s.includes('[data-testid="near-me"]'))).toHaveLength(1);
    expect(scripts.filter((s) => s.includes('.ose-langmenu details[open]'))).toHaveLength(1);
    for (const s of scripts) expect(s).not.toMatch(/<script\b[^>]*\bsrc=/i);
    expect(html).not.toMatch(/\sstyle=/i);
  });

  it('keeps the doors cards free of hex colours (tokens only)', () => {
    expect(block(html, 'landing-doors')).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe('OSE-1529 | sign-in page', () => {
  let res: { status: number; html: string };
  beforeAll(async () => {
    res = await get('/admin');
    res.html = stripComments(res.html);
  });

  it('is still the 401 HTML page with one <h1>', () => {
    expect(res.status).toBe(401);
    expect(res.html.match(/<h1\b/g)?.length).toBe(1);
    expect(res.html).toContain('Admin sign-in required');
  });

  it('says what it is and who it is for', () => {
    const who = text(block(res.html, 'signin-who'));
    expect(who).toMatch(/organizer/i);
    expect(who).toMatch(/by invitation/i);
    expect(who).toMatch(/attendees and visitors never sign in/i);
  });

  it('says what happens next, in order, with no password', () => {
    const next = block(res.html, 'signin-next');
    expect(next).toMatch(/^<ol\b/);
    expect(next.match(/<li\b/g)?.length).toBe(3);
    const t = text(next);
    expect(t).toMatch(/Cloudflare Access/);
    expect(t).toMatch(/email/i);
    expect(t).toMatch(/one-time code/i);
    expect(t).toMatch(/never sees or stores a password/i);
  });

  it('says what to do when locked out or not an organizer, with the way back to browsing', () => {
    const help = block(res.html, 'signin-help');
    const t = text(help);
    expect(t).toMatch(/locked out/i);
    expect(t).toMatch(/latest/i);
    expect(t).toMatch(/invited you/i);
    expect(t).toMatch(/not an organizer/i);
    expect(help).toMatch(/<a[^>]*href="\/events"[^>]*data-testid="signin-browse-events"/);
  });

  it('keeps the sign-in CTA to /admin and the home link, and drops the subscribe promise', () => {
    expect(res.html).toMatch(/<a[^>]*href="\/admin"[^>]*data-testid="signin-cta"/);
    expect(res.html).toMatch(/<a[^>]*href="\/"[^>]*data-testid="signin-request-access"/);
    expect(res.html.toLowerCase()).not.toContain('subscribe');
    expect(res.html).not.toMatch(/we.{1,8}ll be in touch/i);
  });

  it('prints no contact detail as support (no email address, phone, mailto or tel)', () => {
    expect(res.html).not.toMatch(/mailto:|tel:/i);
    expect(res.html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(res.html).not.toMatch(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/);
  });

  it('adds no inline script and no style attribute; stays noindex', () => {
    expect(res.html).not.toMatch(/<script\b/i);
    expect(res.html).not.toMatch(/\sstyle=/i);
    expect(res.html).toMatch(/<meta name="robots" content="noindex"/);
  });
});
