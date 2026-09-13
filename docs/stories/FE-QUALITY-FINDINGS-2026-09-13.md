# Front-End Quality Findings — 2026-09-13

Consolidated list of FE bugs found in a full-surface audit of the 7 OSE surfaces
(admin, admin-signin, public, landing, display, poster, shared-report) plus the
QR-routed form pages. Each item is verified real (agents' false positives were
triaged out — see the bottom section). Companion to
`EPIC-A11Y-ACCESSIBILITY-AUDIT.md`.

**Method:** 4 parallel surface audits → triage (rejected false positives) →
verify each finding against source → fix genuine bugs as slice PRs, each with a
born-red test.

---

## ✅ Fixed — shipped as PRs

| #     | Surface | Bug                                                                                                                                                                                                                                                                                                                        | Sev     | PR   |
| ----- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- |
| FE-1  | landing | subscribe form missing `autocomplete="email"`, `aria-describedby`, and `aria-invalid` wiring (WCAG 1.3.5 / 4.1.2)                                                                                                                                                                                                          | Med     | #531 |
| FE-2  | poster  | content wrapped in `<div id="main-content">` instead of a real `<main>` landmark (only surface missing it)                                                                                                                                                                                                                 | Med     | #532 |
| FE-3  | admin   | launch wizard had no keyboard escape hatch (no way out before step 2's Back); wizard required inputs missing `aria-required` (WCAG 2.1.2 / 2.4.3)                                                                                                                                                                          | Med     | #533 |
| FE-4  | admin   | repeated action buttons (sponsor Edit/Deactivate, token Copy, poster Delete) announced identically per row with no context (WCAG 4.1.2)                                                                                                                                                                                    | Med     | #534 |
| FE-5  | admin   | **front-door chooser + full dashboard stacked on load** — should be mutually exclusive                                                                                                                                                                                                                                     | High    | #536 |
| FE-6  | infra   | `pii-crypto` tamper test flaked (base64-char flip could be a decode no-op), red-X'ing FE PRs                                                                                                                                                                                                                               | Med     | #535 |
| FE-7  | survey  | rating buttons conveyed the chosen score by colour only — added `aria-pressed` toggled with the fill (WCAG 1.4.1 / 4.1.2)                                                                                                                                                                                                  | Med     | #538 |
| FE-10 | forms   | submit `fetch()` had no timeout — a stalled network left the button disabled forever; added a 15s `AbortController` cap                                                                                                                                                                                                    | Low-Med | #539 |
| FE-12 | landing | logo was a `<span>` (with a dead `.logo:focus-visible` rule) — made it `<a href="/">` so it's a keyboard-reachable link home                                                                                                                                                                                               | Low     | #541 |
| FE-13 | public  | event page sections were in an **inconsistent, illogical order** across phases (pre: What→Who→Why→Where→How-much→How; live reshuffled; sponsor strip mid/low) — reordered to one canonical sequence (What→Where→Who→How-much→CTA→Why→How), sponsor strip → top, CTA raised above Why/How, WHAT falls back to `description` | Med     | #542 |

---

## 🟡 Open — remaining

| #     | Surface / file                      | Item                                                                                                                                                                                                                 | Sev     |
| ----- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| FE-14 | `templates/display.html` (531-538)  | display sponsor `placement` analytics always logs `'tvSide'` — `[...tvTop, ...tvSide]` objects carry no `.tvTop` prop, so the top-banner vs sidebar split is collapsed. Fix: bind placement inside each array's loop | Med     |
| FE-15 | `handlers/form-pages.ts` (305, 349) | form success/strip sponsor logos can't hide on 404 — inline `onerror` is refused by the nonce CSP; use the capture-phase `addEventListener('error')` + `data-hide-on-error` pattern from public/display (OSE-1239)   | Low-Med |

**Post-event journalistic recap (spec-bound, not a bug):** the post-event page is being redesigned as a "report, not your data" recap — highlights, opt-in/named-pole standouts (naming the anonymous room violates never-who), area sponsors, discovery-first return loop, and email demoted to purpose-bound (tournament/RSVP) only. See brain memory `project_report_not_your_data`. Needs a design spec + new data model before code.

---

## ⛔ Investigated & rejected (false positives — NOT bugs)

Recorded so they aren't re-flagged:

- **display clock `aria-live="off"`** — correct: a clock updating every 30s would spam screen readers if announced.
- **form labels/error text `<16px` "triggers iOS zoom"** — wrong: only a focused `<input>` under 16px triggers zoom; static label/error text does not. (Input font-size is already gated by the mobile-workability check.)
- **poster QR `outerHTML` race** — works: `awaitQrImages()` runs in the `finally` block, _after_ the placeholder→`<img>` replacement, so it waits on the new images. The print gate is sound.
- **shared-report table "missing `<caption>`"** — the table already has an `aria-label` accessible name; a caption is optional.
- **checkin double-submit** — safe: the `tapping` guard is set synchronously before the first `await`, so re-entrant taps are blocked (JS is single-threaded).
- **FE-8 public `res.ok` guard** — not a bug: the sponsor-bundle `fetch`/`res.json()` is inside a `try/catch` marked `sponsor loading is non-critical`; a non-JSON error is caught and the banner simply doesn't render. Graceful.
- **FE-9 display `visibilitychange` leak** — not a bug: `loadDisplaySponsors()` is called exactly once; the 5-minute auto-refresh calls `loadEvents`, not it, so the listener is never re-added.
- **FE-11 poster inline `<img>` size** — not a bug: `.qr-img { width/height }` CSS overrides the presentational HTML `width`/`height` attributes, so responsiveness is intact; the inline dims only supply intrinsic size (helps CLS).
- **shared-report cell-count chip when suppressed** — not a leak: `cell_count` is a count of geographic H3 cells (a "how many", not "who"); `shared-report-builder.ts:604-605` explicitly ratifies surfacing it, and the `source==='suppressed'` branch is effectively unreachable (builder emits only `'live' | 'fallback'`).
- **shared-report malformed `<\td>` (~1160)** — read artifact; the emitted markup is correct `</td>`.
- **admin event-name cache / querySelector-savedId** — self-inflicted-only, not user-reachable.
- **admin-signin skip-link** — functional (off-screen absolute → reveal on focus); adequate.

---

_Owner: PO. FE-1…FE-13 resolved (fixed or verified-not-a-bug); FE-12 (#541) + FE-13 (#542) shipped this pass. Open: FE-14 + FE-15 (second-pass audit 2026-09-13, verified, unfixed). Update statuses here as PRs merge; promote open items to Linear as needed._
