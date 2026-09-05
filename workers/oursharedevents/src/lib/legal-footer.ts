/**
 * The legal footer — one surface, five pages (OSE-1232).
 *
 * THE PROBLEM THIS SOLVES
 *   Measured 2026-09-05, three of the seven templates carried a footer and
 *   they had diverged:
 *
 *     admin-signin.html:194   © 2026 · Browse Events · Privacy
 *     landing.html:661        © 2026 · Browse Events
 *     public.html:252         © 2026 · Browse Events
 *     admin.html              (none)
 *     shared-report.html      (none)
 *
 *   Exactly one page in the product linked the privacy policy, and it was the
 *   staff sign-in page — the one surface whose readers are least in need of it.
 *   Legal text that differs per page is not a legal surface; it is four
 *   independent drafts, and adding Terms would have meant editing four files
 *   and remembering the two that had nowhere to put it.
 *
 * HOW IT WORKS
 *   Each participating template carries the marker `<!--OCR_LEGAL_FOOTER-->`.
 *   `injectLegalFooter()` replaces it with the rendered `footer()` partial from
 *   @ocr/ui. A template WITHOUT the marker is returned byte-identical, so the
 *   two surfaces that must not get one — `display` (a TV at ten feet;
 *   `display-consent` already does the contextual job) and `poster` (print
 *   legal rules differ, and it is a physical artifact) — opt out by saying
 *   nothing rather than by a negative check somebody has to maintain.
 *
 *   Same idiom as `injectProvenanceBanner` in lib/demo-banner.ts: a template
 *   substitution at serve time, not a build step.
 *
 * LINKS ARE DATA
 *   `/terms`, `/legal` and `/accessibility` DO NOT EXIST YET — verified against
 *   src/router.ts, which routes `/privacy` and `/privacy-policy` and nothing
 *   else. Shipping a footer link to a 404 is worse than shipping no link. When
 *   those pages land they are added to LEGAL_LINKS below: one array entry each,
 *   no template edits, no partial changes, no new markup on five surfaces.
 */
import { footer, type FooterLink } from '@ocr/ui';

/** The marker a template places where its footer belongs. */
export const FOOTER_MARKER = '<!--OCR_LEGAL_FOOTER-->';

/**
 * Legal destinations, in the order they render.
 *
 * ONLY ADD A ROW WHEN THE ROUTE EXISTS. The test
 * `tests/legal-footer.spec.ts` asserts every href here is routable, so a link
 * added ahead of its page fails CI rather than shipping a dead link into the
 * one place people go looking for their rights.
 */
export const LEGAL_LINKS: ReadonlyArray<{ href: string; label: string; slug: string }> = [
  { href: '/privacy', label: 'Privacy', slug: 'privacy' },
];

/** Surfaces that render the footer. Anything absent here simply has no marker. */
export type FooterSurface = 'landing' | 'public' | 'admin' | 'admin-signin' | 'shared-report';

/**
 * Surfaces whose footer keeps a wayfinding link back to the event listing.
 * `admin` and `shared-report` are excluded on purpose: an operator mid-task and
 * a report being read by a sponsor are not looking for the public index, and
 * the audit's finding was that surfaces are busy on first view.
 */
const BROWSE_SURFACES = new Set<FooterSurface>(['landing', 'public', 'admin-signin']);

/** Test-id prefix for a surface — matches the ids the templates already emitted. */
function prefixFor(surface: FooterSurface): string {
  // `admin-signin` emitted `signin-footer`, not `admin-signin-footer`, and two
  // suites address it. Preserve it rather than rename and chase the callers.
  return surface === 'admin-signin' ? 'signin' : surface;
}

export function footerLinksFor(surface: FooterSurface): FooterLink[] {
  const prefix = prefixFor(surface);
  const links: FooterLink[] = [];
  if (BROWSE_SURFACES.has(surface)) {
    links.push({ href: '/events', label: 'Browse Events', testid: `${prefix}-footer-browse` });
  }
  for (const l of LEGAL_LINKS) {
    links.push({ href: l.href, label: l.label, testid: `${prefix}-footer-${l.slug}` });
  }
  return links;
}

/** Render the footer for a surface. Exported so tests can assert it without a Response. */
export function renderLegalFooter(surface: FooterSurface, year?: number): string {
  return footer({
    surface: prefixFor(surface),
    links: footerLinksFor(surface),
    year,
    // The standing product subtitle (OSE-1230) rides the two public,
    // first-impression surfaces only. On admin and shared-report the reader has
    // already met the promise; repeating it there is noise, not reassurance.
    subtitle: surface === 'landing' || surface === 'public',
  });
}

/**
 * Replace the marker with the rendered footer.
 * A document with no marker is returned unchanged — that is the opt-out.
 */
export function injectLegalFooter(htmlDoc: string, surface: FooterSurface, year?: number): string {
  if (!htmlDoc.includes(FOOTER_MARKER)) return htmlDoc;
  return htmlDoc.split(FOOTER_MARKER).join(renderLegalFooter(surface, year));
}
