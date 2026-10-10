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

import { injectMarker } from './inject-marker';

export type NeverWhoSurface = 'landing' | 'events' | 'event';

/** Where the disclosure goes in a static template. */
export const NEVER_WHO_MARKER = '<!--OCR_NEVER_WHO-->';
/** Where its stylesheet goes, inside the template's own <style>. */
export const NEVER_WHO_CSS_MARKER = '/*OCR_NEVER_WHO_CSS*/';

/** The one visible line. Also the standing product subtitle (OSE-1230). */
export const NEVER_WHO_LINE = 'Never who, only how many.';

// Per-surface paragraph — wording unchanged from the cards they replace; each is
// true of the page it sits on (the landing sets no cookies and asks for
// location only when the person chooses to; an event page was reached by a
// link that counted as one click).
const BODIES: Record<NeverWhoSurface, string> = {
  landing: `<p>
          Attendance is measured <strong>without gathering who you are</strong>, by default. We
          count that people came — where and when — never who they are. This page sets no cookies and
          runs no analytics. If you choose &ldquo;Use my location&rdquo;, it uses only your zip
          area, never your exact spot.
        </p>
        <p>
          Choosing to be named is a feature, not the norm &mdash; nothing names you unless you pick
          it. <a href="/events" data-testid="privacy-more">See what&#x2019;s happening &rarr;</a>
        </p>`,
  events: `<p>
          You're part of the group, anonymously. OurSharedEvents tracks when
          groups gather &mdash; never who you are. Event hosts and sponsors see
          corridors and venues, not people. Nothing about your device, location,
          or identity was collected to display this page.
        </p>`,
  event: `<p>
      You're part of the group, anonymously. OurSharedEvents tracks when
      groups gather &mdash; never who you are. Event hosts and sponsors see
      corridors and venues, not people. The link you followed counted as a
      single click; nothing about your device, location, or identity was
      collected to display this page.
    </p>`,
};

// Test ids predate this partial and are asserted by unit + E2E suites.
const TESTIDS: Record<NeverWhoSurface, string> = {
  landing: 'landing-privacy',
  events: 'anonymity-affordance',
  event: 'anonymity-affordance',
};

/** Render the disclosure for a surface. Collapsed by default. */
export function renderNeverWho(surface: NeverWhoSurface): string {
  return `<details class="ose-never-who" data-testid="${TESTIDS[surface]}" data-never-who="${surface}">
    <summary class="ose-never-who-summary" data-testid="never-who-summary"><span class="ose-never-who-line">${NEVER_WHO_LINE}</span> <span class="ose-never-who-trigger">How this works</span></summary>
    <div class="ose-never-who-body" data-testid="never-who-body">
        ${BODIES[surface]}
    </div>
  </details>`;
}

/**
 * Styles for the disclosure, on the shared semantic tokens only (--text,
 * --text-muted, --accent, --border) so it follows the page's theme in both
 * modes and a [data-brand] reaches it. The summary is a 44px tap target
 * (mobile-workability, OSE-1236); the marker is our own chevron so it reads the
 * same in every engine.
 */
export const NEVER_WHO_CSS = `
    .ose-never-who { margin: 2rem 0 0; border-top: 1px solid var(--border); font-size: 0.95rem; color: var(--text-muted); }
    .ose-never-who-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem; min-height: 44px; padding: 0.5rem 0; cursor: pointer; list-style: none; }
    .ose-never-who-summary::-webkit-details-marker { display: none; }
    .ose-never-who-line { color: var(--text); font-weight: 600; }
    .ose-never-who-trigger { color: var(--accent); font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
    .ose-never-who-trigger::after { content: " \\25B8"; display: inline-block; text-decoration: none; }
    .ose-never-who[open] .ose-never-who-trigger::after { content: " \\25BE"; }
    .ose-never-who-summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
    .ose-never-who-body { padding: 0 0 0.75rem; }
    .ose-never-who-body p { margin: 0 0 0.5rem; }
    .ose-never-who-body a { color: var(--accent); }`;

/** Inject the disclosure + its CSS into a static template (no marker → unchanged). */
export function injectNeverWho(html: string, surface: NeverWhoSurface): string {
  let out = html;
  if (out.includes(NEVER_WHO_CSS_MARKER))
    out = injectMarker(out, NEVER_WHO_CSS_MARKER, NEVER_WHO_CSS);
  if (out.includes(NEVER_WHO_MARKER))
    out = injectMarker(out, NEVER_WHO_MARKER, renderNeverWho(surface));
  return out;
}
