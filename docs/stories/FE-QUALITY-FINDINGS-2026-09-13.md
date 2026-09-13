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

| #    | Surface | Bug                                                                                                                                               | Sev  | PR            |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------- |
| FE-1 | landing | subscribe form missing `autocomplete="email"`, `aria-describedby`, and `aria-invalid` wiring (WCAG 1.3.5 / 4.1.2)                                 | Med  | #531          |
| FE-2 | poster  | content wrapped in `<div id="main-content">` instead of a real `<main>` landmark (only surface missing it)                                        | Med  | #532          |
| FE-3 | admin   | launch wizard had no keyboard escape hatch (no way out before step 2's Back); wizard required inputs missing `aria-required` (WCAG 2.1.2 / 2.4.3) | Med  | #533          |
| FE-4 | admin   | repeated action buttons (sponsor Edit/Deactivate, token Copy, poster Delete) announced identically per row with no context (WCAG 4.1.2)           | Med  | #534          |
| FE-5 | admin   | **front-door chooser + full dashboard stacked on load** — should be mutually exclusive                                                            | High | #536          |
| FE-6 | infra   | `pii-crypto` tamper test flaked (base64-char flip could be a decode no-op), red-X'ing FE PRs                                                      | Med  | #535 (merged) |

---

## 🟠 Open — verified real, not yet fixed

| #     | Surface / file                                    | Bug                                                                                                                                   | Sev     |
| ----- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| FE-7  | survey form — `handlers/form-pages.ts` (~443–452) | rating buttons lack `aria-pressed`; comments field lacks `aria-invalid` toggle on validation error                                    | Med     |
| FE-8  | `templates/public.html` (~269)                    | sponsor-bundle `fetch` calls `res.json()` without an `res.ok` guard — confirm it degrades gracefully (non-critical banner)            | Low-Med |
| FE-9  | `templates/display.html` (~527)                   | `visibilitychange` listener registered inside `loadDisplaySponsors()` can stack if it re-runs — verify re-run path, then hoist/dedupe | Med     |
| FE-10 | `handlers/form-pages.ts` (~225–275)               | form submit has no `AbortController`/timeout — a stalled network leaves the button disabled indefinitely                              | Low-Med |
| FE-11 | `templates/poster.html` (~799)                    | inline `width="120" height="120"` on the QR `<img>` can override responsive CSS on some browsers                                      | Low     |
| FE-12 | `templates/landing.html` (~561)                   | logo is a `<span>`, not a link home (`<a href="/">`) — minor; confirm intended                                                        | Low     |

---

## ⛔ Investigated & rejected (false positives — NOT bugs)

Recorded so they aren't re-flagged:

- **display clock `aria-live="off"`** — correct: a clock updating every 30s would spam screen readers if announced.
- **form labels/error text `<16px` "triggers iOS zoom"** — wrong: only a focused `<input>` under 16px triggers zoom; static label/error text does not. (Input font-size is already gated by the mobile-workability check.)
- **poster QR `outerHTML` race** — works: `awaitQrImages()` runs in the `finally` block, _after_ the placeholder→`<img>` replacement, so it waits on the new images. The print gate is sound.
- **shared-report table "missing `<caption>`"** — the table already has an `aria-label` accessible name; a caption is optional.
- **checkin double-submit** — safe: the `tapping` guard is set synchronously before the first `await`, so re-entrant taps are blocked (JS is single-threaded).

---

_Owner: PO. Next up: FE-7 (survey-form a11y). Update statuses here as PRs merge; promote open items to Linear as needed._
