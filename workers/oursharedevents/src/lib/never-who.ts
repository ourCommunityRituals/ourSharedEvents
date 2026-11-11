// ─── Never-who disclosure (OSE-1372) ─────────────────────────────────────────
//
// The never-who statement is Invariant #1 surface language: it must be PRESENT
// and TRUE on every anonymous surface. The invariant is about presence and
// wording, not height — and as a full card it was the second-largest thing on a
// phone screen, identical on every page, pushing the events below the fold.
//
// So: one line always visible ("Never who, only how many." + a "How this works"
// trigger), the surface's existing paragraph behind a native <details>. No JS
// (nothing for the CSP nonce to allow), keyboard + screen-reader operable for
// free, collapsed by default everywhere. One partial for landing, /events, and
// the event page in every phase, so the surfaces cannot drift apart again.
//
// The test id sits on the <details> itself: it is always rendered and visible
// (the summary is), so existing `toBeVisible()` assertions keep holding.

import { fmt, msg } from './i18n/catalog';
import { DEFAULT_LANG, type Lang } from './i18n/languages';
import { withLangPrefix } from './i18n/path-prefix';
import { injectMarker } from './inject-marker';

export type NeverWhoSurface = 'landing' | 'events' | 'event';

/** Where the disclosure goes in a static template. */
export const NEVER_WHO_MARKER = '<!--OCR_NEVER_WHO-->';
/** Where its stylesheet goes, inside the template's own <style>. */
export const NEVER_WHO_CSS_MARKER = '/*OCR_NEVER_WHO_CSS*/';

/** The one visible line. Also the standing product subtitle (OSE-1230). */
export const NEVER_WHO_LINE = msg(DEFAULT_LANG, 'neverWho.line');

// Per-surface paragraph, in the page's language (lib/i18n/catalog.ts). Each is
// true of the page it sits on: the landing sets no cookies and asks for location
// only when the person chooses to; an event page was reached by a link that
// counted as one click. The landing's links to /events in the same language.
function body(surface: NeverWhoSurface, lang: Lang): string {
  if (surface === 'landing') {
    return fmt(lang, 'neverWho.landing', { events: withLangPrefix(lang, '/events') });
  }
  return msg(lang, surface === 'events' ? 'neverWho.events' : 'neverWho.event');
}

// Test ids predate this partial and are asserted by unit + E2E suites.
const TESTIDS: Record<NeverWhoSurface, string> = {
  landing: 'landing-privacy',
  events: 'anonymity-affordance',
  event: 'anonymity-affordance',
};

/** Render the disclosure for a surface, in the page's language. Collapsed by default. */
export function renderNeverWho(surface: NeverWhoSurface, lang: Lang = DEFAULT_LANG): string {
  return `<details class="ose-never-who" data-testid="${TESTIDS[surface]}" data-never-who="${surface}">
    <summary class="ose-never-who-summary" data-testid="never-who-summary"><span class="ose-never-who-line">${msg(lang, 'neverWho.line')}</span> <span class="ose-never-who-trigger">${msg(lang, 'neverWho.trigger')}</span></summary>
    <div class="ose-never-who-body" data-testid="never-who-body">
        ${body(surface, lang)}
    </div>
  </details>`;
}

/**
 * Styles for the disclosure, on the shared semantic tokens only (--text,
 * --text-muted, --accent, --border) so it follows the page's theme in both
 * modes and a [data-brand] reaches it. The summary is a 44px tap target
 * (mobile-workability, OSE-1236); the marker is our own chevron so it reads the
 * same in every engine. Closed, it points along the reading direction: ▸ on a
 * left-to-right page, ◂ on a right-to-left one (OSE-1966); open, it points down.
 */
export const NEVER_WHO_CSS = `
    .ose-never-who { margin: 2rem 0 0; border-top: 1px solid var(--border); font-size: 0.95rem; color: var(--text-muted); }
    .ose-never-who-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem; min-height: 44px; padding: 0.5rem 0; cursor: pointer; list-style: none; }
    .ose-never-who-summary::-webkit-details-marker { display: none; }
    .ose-never-who-line { color: var(--text); font-weight: 600; }
    .ose-never-who-trigger { color: var(--accent); font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
    .ose-never-who-trigger::after { content: " \\25B8"; display: inline-block; text-decoration: none; }
    [dir="rtl"] .ose-never-who-trigger::after { content: " \\25C2"; }
    .ose-never-who[open] .ose-never-who-trigger::after { content: " \\25BE"; }
    .ose-never-who-summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
    .ose-never-who-body { padding: 0 0 0.75rem; }
    .ose-never-who-body p { margin: 0 0 0.5rem; }
    .ose-never-who-body a { color: var(--accent); }`;

/** Inject the disclosure + its CSS into a static template (no marker → unchanged). */
export function injectNeverWho(
  html: string,
  surface: NeverWhoSurface,
  lang: Lang = DEFAULT_LANG
): string {
  let out = html;
  if (out.includes(NEVER_WHO_CSS_MARKER))
    out = injectMarker(out, NEVER_WHO_CSS_MARKER, NEVER_WHO_CSS);
  if (out.includes(NEVER_WHO_MARKER))
    out = injectMarker(out, NEVER_WHO_MARKER, renderNeverWho(surface, lang));
  return out;
}
