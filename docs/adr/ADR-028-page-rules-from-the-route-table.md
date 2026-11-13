# ADR-028: Check page rules from the route table, not from a remembered list

**Status:** Proposed. The gate described here is built and running (PR 1205); it moves to Accepted
when the owner agrees that a page rule must be enforced this way from now on.
**Date:** 2026-11-13
**Deciders:** Owner (PO). The Sr Design FE and Sr Automation QA roles advise.
**Tickets:** OSE-2030 (the gate), OSE-2031 (the demo sites in the accessibility profile), OSE-2032
(CI/CD testing). Epic OSE-292.

## Context

AGENTS.md invariant 8 says one `<h1>` per page. The check for it was `scanPage` in
`workers/oursharedevents/tests/a11y-axe.spec.ts`, which looks at whatever pages a person passes to
it. The demo sites (`/demo`, `/demo/free`, `/demo/mid`, `/demo/premium` and the unknown-site page)
were never passed. All five were served with no `<h1>` until 2026-11-13. OCR-docs ADR-007 makes the
demo sites the permanent reference installation, so the one place meant to show the platform
working was the place the rule did not hold.

The same thing had happened before: the OSE-1312 landing shipped with no `<h1>` because axe's WCAG
tags do not include that rule, and the correction then was to add an assertion to the same
remembered list.

Adding the demo pages to the list (the first commit of PR 1205) corrects the pages. It does not
change why they were missed. A list a person keeps is complete only on the day it is written.

Two more cases surfaced as soon as the pages were derived instead of remembered:

- `/briefing` serves no `<h1>` at all. It draws its heading with a script, so no check that reads
  served markup could see it, and no browser check opened it.
- The demo sites had never been through the accessibility profile
  (`tests/playwright/a11y-profile.spec.ts`). Run through it, they failed 11 cases: sideways scroll
  at 200% text, four colour-contrast findings and a Label in Name finding (OSE-2031).

## Decision

**A page rule is checked on the pages the router answers, read from `src/router.ts`. It is not
checked on a list someone keeps by hand.**

1. `workers/oursharedevents/tests/helpers/page-surfaces.ts` names every address the router answers
   outside `/api/` and says whether a browser gets an HTML document there.
2. `tests/page-surfaces-route-table.spec.ts` (node project) reads the addresses out of the router
   with the reader `event-address-route-table.spec.ts` already used, and fails when the two differ
   in either direction. A new address fails until someone decides "page or not".
3. `tests/page-surfaces-one-h1.spec.ts` (workers pool) asks the real router for every sample
   address. A declared page must answer HTML with exactly one `<h1>`. A declared non-page must not
   answer HTML, so a page cannot hide under that label.
4. A page that draws its heading with a script is an exception with a named list (today: the
   briefing and its two aliases). The spec fails if another page takes the label, and that page is
   checked in a browser instead.
5. On staging, `tests/ui/smoke/tier1.spec.ts` (T4d) asserts exactly one `<h1>` on every page it
   opens.

The rule itself does not change. Invariant 8 stays as written in AGENTS.md.

## Alternatives Considered

### Alternative A: Keep the remembered list and add the missing pages

Add the demo pages to `scanPage` and stop there.

**Rejected because:** it is what was done after OSE-1312, and the demo sites were still missed. It
depends on every future author remembering a file they have no reason to open.

### Alternative B: Crawl the running site and check every page found

Start from `/` and follow links.

**Rejected because:** it only finds pages that are linked. The demo sites, the short codes and the
admin corner are reached by address, not from the landing. It also needs a running worker, so it
cannot sit in the fast node project.

### Alternative C: A lint rule on the handlers' source

Require every handler that returns HTML to contain one `<h1` in its source text.

**Rejected because:** pages are assembled from several functions and templates, and one page
legitimately holds an `<h1>` inside a script string (the admin print window). Source text is not
the document a visitor gets. The router's own answer is.

### Alternative D: Put the HTML screens under `/api/v2/admin/` in the same list now

**Deferred, not rejected.** Those screens (previews, Logs, Settings) need a seeded event or return
data-dependent documents, and they are covered today by `tests/admin-screens.spec.ts` and the
accessibility profile. Bringing them into the derived list is a follow-up on OSE-2030.

## Consequences

### Positive

- A new page cannot ship without its heading being checked. The author is told by a failing test,
  with the file and the two choices named in the message.
- The list doubles as a plain index of what each address is. There was none outside the router's
  header comment.
- The route reader now lives in one helper (`tests/helpers/route-shapes.ts`) used by both gates.
- The next page rule (touch targets, input text size, landmarks) can reuse the same list instead of
  starting another remembered one.

### Negative

- Every new address needs one more line in a test helper. That is the point, and it is a cost.
- The workers-pool check reads served markup. It cannot see a heading a script draws, so the
  briefing stays an exception until it serves its heading.
- Samples use unknown ids, so most event pages are checked through their error page. The rendered
  event pages are checked for one `<h1>` in `tests/a11y-axe.spec.ts` (jsdom) and in the browser
  layers, not here.

### Neutral

- `/api/` stays out of scope for this gate. JSON is not a page.
- The reader matches the router's current style (`pathname === …`, `startsWith`, path patterns). A
  router rewritten around a route table object would need a new reader. Both gates carry a negative
  control that fails if the reader stops seeing routes.

## Implementation Notes

- Code: `workers/oursharedevents/tests/helpers/page-surfaces.ts`,
  `workers/oursharedevents/tests/helpers/route-shapes.ts`
- CI gates: `workers/oursharedevents/tests/page-surfaces-route-table.spec.ts` (T0 worker tests, node
  project), `workers/oursharedevents/tests/page-surfaces-one-h1.spec.ts` (T0 worker tests, workers
  pool), `tests/playwright/a11y-profile.spec.ts` (Mobile workability, PR code),
  `tests/ui/smoke/tier1.spec.ts` (T4d: Tier-1 UI Smoke)
- Brain invariant: OCR-docs `architectural-invariants.yaml` #14 (design system), AGENTS.md
  invariant 8
- PR: ourSharedEvents 1205

## References

- OCR-docs ADR-007 (the demo sites are the permanent reference installation)
- OSE ADR-002 (static invariant gates)
- `workers/oursharedevents/tests/event-address-route-table.spec.ts` (the first gate that reads the
  route table)
