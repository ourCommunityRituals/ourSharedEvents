/**
 * The Language menu in the header bar (owner 2026-11-10).
 *
 * The footer switch was the only way to change language, at the bottom of the
 * page. The header now carries a Language menu on its left side: on a wide
 * screen a "Language" button that opens the list of languages; on a phone a
 * menu button whose first option is Language, which opens the same list. The
 * page's own language is marked in the list; the others are plain links, so
 * picking one loads the whole page again in that language.
 *
 * Node-clean render test: the component and the three event renderers are pure
 * functions of their input.
 *
 * Born red: drop the menu from a renderer, mark the wrong language current,
 * link the current language, or remove the phone breakpoint, and a case here fails.
 */
import { describe, it, expect } from 'vitest';
import { LANGUAGE_MENU_CSS, renderLanguageMenu } from '../src/lib/i18n/language-menu';
import { LANGUAGES } from '../src/lib/i18n/languages';
import {
  renderPreEventHtml,
  renderEventLiveHtml,
  renderPostEventHtml,
  type PublicEventRow,
} from '../src/handlers/pages';

const PATH = '/events/abc/spring-fair';

/** The part of the menu a wide screen shows, and the part a phone shows. */
function desktop(html: string): string {
  return html.match(/<details class="ose-langmenu-desktop"[\s\S]*?<\/details>/)?.[0] ?? '';
}
function mobile(html: string): string {
  // The phone menu nests the Language sub-menu, so take it to the outer close.
  return (
    html.match(
      /<details class="ose-langmenu-mobile"[\s\S]*<\/details>\s*<\/div>\s*<\/details>/
    )?.[0] ?? ''
  );
}

describe('renderLanguageMenu | wide screen', () => {
  it('is a button that says Language, in the page language', () => {
    expect(desktop(renderLanguageMenu({ lang: 'en', path: PATH }))).toMatch(
      /<summary[^>]*data-testid="language-menu-button"[^>]*>\s*<span>Language<\/span>/
    );
    expect(desktop(renderLanguageMenu({ lang: 'es', path: PATH }))).toMatch(
      /<summary[^>]*data-testid="language-menu-button"[^>]*>\s*<span>Idioma<\/span>/
    );
  });

  it('lists every language the pages can render, the current one marked and not a link', () => {
    const html = desktop(renderLanguageMenu({ lang: 'en', path: PATH }));
    expect(html.match(/<li>/g)?.length).toBe(LANGUAGES.length);
    expect(html).toMatch(
      /<span class="ose-langmenu-item ose-langmenu-current" aria-current="true" lang="en" data-testid="language-menu-en">/
    );
    expect(html).not.toMatch(/<a [^>]*data-testid="language-menu-en"/);
    expect(html).toContain(
      '<a class="ose-langmenu-item" lang="es" hreflang="es" data-testid="language-menu-es" href="/es/events/abc/spring-fair">'
    );
  });

  it('on a Spanish page marks Español and links English, named in Spanish', () => {
    const html = desktop(renderLanguageMenu({ lang: 'es', path: PATH }));
    expect(html).toMatch(
      /aria-current="true" lang="es" data-testid="language-menu-es">[\s\S]*Español<\/span>/
    );
    expect(html).toContain(
      '<a class="ose-langmenu-item" lang="es" hreflang="en" data-testid="language-menu-en" href="/events/abc/spring-fair">'
    );
    expect(html).toMatch(/Inglés<\/a>/);
  });

  it('marks the current language with a check, not by color alone', () => {
    const html = desktop(renderLanguageMenu({ lang: 'en', path: PATH }));
    expect(html).toMatch(
      /aria-current="true"[^>]*>\s*<span class="ose-langmenu-check" aria-hidden="true">✓<\/span>/
    );
  });
});

describe('renderLanguageMenu | phone', () => {
  it('is a menu button whose first option is Language', () => {
    const html = mobile(renderLanguageMenu({ lang: 'en', path: PATH }));
    expect(html).toMatch(/<summary[^>]*aria-label="Menu"[^>]*data-testid="site-menu-button"/);
    const panel = html.match(/<div class="ose-langmenu-panel"[^>]*>\s*([\s\S]*)/)?.[1] ?? '';
    expect(panel).toMatch(
      /^<details class="ose-langmenu-sub" data-testid="site-menu-language">\s*<summary class="ose-langmenu-row" data-testid="site-menu-language-button"><span>Language<\/span>/
    );
  });

  it('Language opens the same list, the current language marked', () => {
    const html = mobile(renderLanguageMenu({ lang: 'es', path: PATH }));
    expect(html).toMatch(/aria-label="Menú"/);
    expect(html.match(/<li>/g)?.length).toBe(LANGUAGES.length);
    expect(html).toMatch(/aria-current="true" lang="es" data-testid="site-menu-language-es"/);
    expect(html).toContain('data-testid="site-menu-language-en" href="/events/abc/spring-fair">');
  });
});

describe('renderLanguageMenu | safety', () => {
  it('opens and switches as plain markup: no form, button, handler attribute or cookie', () => {
    // One script closes an open menu on an outside tap or Escape (owner D4,
    // 2026-11-10; behavior in language-menu-close.spec.ts). Opening and
    // switching never need it: <details> and plain links do both.
    const html = renderLanguageMenu({ lang: 'en', path: PATH });
    expect(html.match(/<script\b/gi)?.length).toBe(1);
    const markup = html.replace(/<script>[\s\S]*?<\/script>/i, '');
    expect(markup).not.toMatch(/<script|<form|<button|onclick|cookie/i);
  });

  it('carries the query it is given, escaped, onto every link', () => {
    const html = renderLanguageMenu({ lang: 'en', path: '/events', query: '?when=week&q=x' });
    expect(html.match(/href="\/es\/events\?when=week&amp;q=x"/g)?.length).toBe(2);
  });

  it('escapes a path it is handed', () => {
    const html = renderLanguageMenu({ lang: 'en', path: '/events/"><script>x</script>' });
    // The menu's own closing script is the only <script>; the hostile one is text.
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;x&lt;/script&gt;');
  });

  it('N4: escapes a hostile query, so no tag or attribute breaks out of the href', () => {
    const html = renderLanguageMenu({
      lang: 'en',
      path: '/events',
      query: '?q="><img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<img');
    expect(
      html.match(/href="\/es\/events\?q=&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;"/g)?.length
    ).toBe(2);
  });

  it('is not a second "Language" landmark beside the footer switch', () => {
    expect(renderLanguageMenu({ lang: 'en', path: PATH })).not.toMatch(/<nav/);
  });
});

describe('LANGUAGE_MENU_CSS', () => {
  it('shows the button on a wide screen and the menu button on a phone', () => {
    expect(LANGUAGE_MENU_CSS).toMatch(/\.ose-langmenu-mobile \{[^}]*display: none/);
    expect(LANGUAGE_MENU_CSS).toMatch(
      /@media \(max-width: 640px\) \{[^@]*\.ose-langmenu-desktop \{ display: none; \}[^@]*\.ose-langmenu-mobile \{ display: block; \}/
    );
  });

  it('keeps targets at 48 px and text at 16 px', () => {
    for (const sel of ['.ose-langmenu-button', '.ose-langmenu-item', '.ose-langmenu-row']) {
      const rule = LANGUAGE_MENU_CSS.match(new RegExp(`\\${sel} \\{[^}]*\\}`))?.[0] ?? '';
      expect(rule, sel).toMatch(/min-height: 48px/);
      expect(rule, sel).toMatch(/font-size: 1rem/);
    }
  });

  it('F3: spaces the languages by the 12 px tap gap, so a mis-tap does not pick the neighbour', () => {
    expect(LANGUAGE_MENU_CSS).toMatch(/\.ose-langmenu-list \{[^}]*gap: 0\.75rem/);
  });

  it('takes every color from a token', () => {
    expect(LANGUAGE_MENU_CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});

// ── The event pages ─────────────────────────────────────────────────────────

function row(overrides: Partial<PublicEventRow> = {}): PublicEventRow {
  return {
    id: 'evt_menu',
    brand_id: 'root',
    title: 'Spring Fair',
    slug: 'spring-fair',
    status: 'active',
    description: 'A fair.',
    location: 'The Hall',
    start_date: '2099-10-24',
    end_date: '2099-10-24',
    timezone: 'America/Chicago',
    starts_at: '2099-10-24T23:00:00Z',
    what_short: 'Come.',
    who_host: null,
    why_purpose: null,
    how_details: null,
    where_address: null,
    who_story: null,
    who_image_url: null,
    what_video_url: null,
    what_url: null,
    what_url_enabled: 0,
    what_url_type: null,
    lat: null,
    lon: null,
    price_cents: null,
    price_model: null,
    price_note: null,
    ...overrides,
  };
}

const SHARE = 'https://oursharedevents.com/events/evt_menu';

describe('the event pages carry the menu at the top, left', () => {
  const pages = {
    pre: (lang: 'en' | 'es') => renderPreEventHtml(row(), SHARE, undefined, { nonce: 'n', lang }),
    live: (lang: 'en' | 'es') => renderEventLiveHtml(row(), SHARE, undefined, { nonce: 'n', lang }),
    post: (lang: 'en' | 'es') =>
      renderPostEventHtml(row(), SHARE, [], undefined, { nonce: 'n', lang }),
  };

  for (const [phase, render] of Object.entries(pages)) {
    it(`${phase}: the menu comes before the title, first in its bar, with its styles`, () => {
      const html = render('es');
      const menuAt = html.indexOf('data-testid="language-menu"');
      expect(menuAt, 'menu present').toBeGreaterThan(-1);
      expect(menuAt, 'above the h1').toBeLessThan(html.indexOf('<h1'));
      expect(html).toMatch(
        /data-testid="event-topbar"[^>]*>\s*<div class="ose-langmenu" data-testid="language-menu">/
      );
      expect(html).toContain('.ose-langmenu-mobile { display: block; }');
      expect(html).toMatch(/aria-current="true" lang="es" data-testid="language-menu-es"/);
      expect(html).toContain('href="/events/evt_menu/spring-fair"');
      // F5/F6: the closing script carries this page's CSP nonce.
      expect(html).toMatch(/data-testid="event-topbar"[\s\S]*?<script nonce="n">[\s\S]*?Escape/);
    });
  }

  it('an admin draft preview has no public address, so it shows no menu', () => {
    const html = renderPreEventHtml(row(), SHARE, undefined, {
      nonce: 'n',
      lang: 'en',
      preview: true,
    });
    expect(html).not.toContain('data-testid="language-menu"');
  });
});
