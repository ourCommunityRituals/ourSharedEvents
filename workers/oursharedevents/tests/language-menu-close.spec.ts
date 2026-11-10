/**
 * F5 and F6 (OSE-1935): an open Language menu closes on a tap outside it and on
 * Escape (owner decision D4, 2026-11-10, OSE-1934).
 *
 * Without script a `<details>` menu stays open until its own button is pressed
 * again. The menu now carries a small script: a click outside every open menu
 * closes it, a click inside leaves it alone (F2: tapping the current language
 * does nothing), and Escape closes every open part and puts focus back on the
 * button, so a keyboard user is not lost.
 *
 * The page is built in jsdom with scripts run, the way a browser runs the menu's
 * own inline script. The script is markup-only in what it touches: it sets
 * `details.open` and moves focus; it stores nothing and sends nothing.
 *
 * Born red: drop the script, invert the `contains` test, or forget to close the
 * nested Language list on Escape, and a case here fails.
 */
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderLanguageMenu } from '../src/lib/i18n/language-menu';

function page(nonce?: string): Document {
  const menu = renderLanguageMenu({ lang: 'en', path: '/events/abc/fair', nonce });
  const dom = new JSDOM(
    `<!DOCTYPE html><html lang="en"><body><header>${menu}</header><main><p id="outside">Event text</p></main></body></html>`,
    { runScripts: 'dangerously' }
  );
  return dom.window.document;
}

function el(doc: Document, testid: string): HTMLElement {
  const found = doc.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  if (!found) throw new Error(`missing ${testid}`);
  return found;
}

function click(doc: Document, target: Element): void {
  target.dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true }));
}

function escape(doc: Document): void {
  doc.dispatchEvent(
    new doc.defaultView!.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
}

describe('F5 | a tap outside closes an open menu', () => {
  it('wide screen: the list closes when the page is tapped', () => {
    const doc = page();
    const menu = el(doc, 'language-menu-desktop') as HTMLDetailsElement;
    menu.open = true;
    click(doc, doc.getElementById('outside')!);
    expect(menu.open).toBe(false);
  });

  it('phone: the panel and the Language list inside it both close', () => {
    const doc = page();
    const outer = el(doc, 'site-menu') as HTMLDetailsElement;
    const inner = el(doc, 'site-menu-language') as HTMLDetailsElement;
    outer.open = true;
    inner.open = true;
    click(doc, doc.getElementById('outside')!);
    expect(outer.open).toBe(false);
    expect(inner.open).toBe(false);
  });

  it('F2: a tap inside the menu, on the current language, leaves it open', () => {
    const doc = page();
    const outer = el(doc, 'site-menu') as HTMLDetailsElement;
    const inner = el(doc, 'site-menu-language') as HTMLDetailsElement;
    outer.open = true;
    inner.open = true;
    click(doc, el(doc, 'site-menu-language-en'));
    expect(outer.open).toBe(true);
    expect(inner.open).toBe(true);
  });

  it('a closed menu stays closed and nothing else changes', () => {
    const doc = page();
    click(doc, doc.getElementById('outside')!);
    expect((el(doc, 'language-menu-desktop') as HTMLDetailsElement).open).toBe(false);
    expect((el(doc, 'site-menu') as HTMLDetailsElement).open).toBe(false);
  });
});

describe('F6 | Escape closes an open menu and returns focus to its button', () => {
  it('wide screen', () => {
    const doc = page();
    const menu = el(doc, 'language-menu-desktop') as HTMLDetailsElement;
    menu.open = true;
    el(doc, 'language-menu-es').focus();
    escape(doc);
    expect(menu.open).toBe(false);
    expect(doc.activeElement).toBe(el(doc, 'language-menu-button'));
  });

  it('phone: closes the panel and the nested list, focus on the menu button', () => {
    const doc = page();
    const outer = el(doc, 'site-menu') as HTMLDetailsElement;
    const inner = el(doc, 'site-menu-language') as HTMLDetailsElement;
    outer.open = true;
    inner.open = true;
    escape(doc);
    expect(outer.open).toBe(false);
    expect(inner.open).toBe(false);
    expect(doc.activeElement).toBe(el(doc, 'site-menu-button'));
  });

  it('another key does nothing', () => {
    const doc = page();
    const menu = el(doc, 'language-menu-desktop') as HTMLDetailsElement;
    menu.open = true;
    doc.dispatchEvent(
      new doc.defaultView!.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    expect(menu.open).toBe(true);
  });
});

describe('the closing script under the page CSP', () => {
  it('carries the page nonce when it is given one (event pages)', () => {
    const html = renderLanguageMenu({ lang: 'en', path: '/events/abc', nonce: 'n0nce' });
    expect(html.match(/<script\b[^>]*>/gi)).toEqual(['<script nonce="n0nce">']);
  });

  it('is a bare <script> without one, for html() to nonce (/events, landing)', () => {
    const html = renderLanguageMenu({ lang: 'en', path: '/events' });
    expect(html.match(/<script\b[^>]*>/gi)).toEqual(['<script>']);
  });

  it('escapes a nonce it is handed', () => {
    const html = renderLanguageMenu({ lang: 'en', path: '/events', nonce: '"><b>' });
    expect(html).not.toContain('"><b>');
  });

  it('touches only the menu: no storage, cookie, network or HTML writing', () => {
    const script = renderLanguageMenu({ lang: 'en', path: '/events' }).match(
      /<script>([\s\S]*?)<\/script>/i
    )?.[1];
    expect(script).toBeTruthy();
    expect(script).not.toMatch(
      /cookie|localStorage|sessionStorage|fetch|XMLHttpRequest|sendBeacon|innerHTML|eval/
    );
  });
});
