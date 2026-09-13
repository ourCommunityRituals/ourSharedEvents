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

| #     | Surface | Bug                                                                                                                                               | Sev     | PR            |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------- |
| FE-1  | landing | subscribe form missing `autocomplete="email"`, `aria-describedby`, and `aria-invalid` wiring (WCAG 1.3.5 / 4.1.2)                                 | Med     | #531          |
| FE-2  | poster  | content wrapped in `<div id="main-content">` instead of a real `<main>` landmark (only surface missing it)                                        | Med     | #532          |
| FE-3  | admin   | launch wizard had no keyboard escape hatch (no way out before step 2's Back); wizard required inputs missing `aria-required` (WCAG 2.1.2 / 2.4.3) | Med     | #533          |
| FE-4  | admin   | repeated action buttons (sponsor Edit/Deactivate, token Copy, poster Delete) announced identically per row with no context (WCAG 4.1.2)           | Med     | #534          |
| FE-5  | admin   | **front-door chooser + full dashboard stacked on load** — should be mutually exclusive                                                            | High    | #536          |
| FE-6  | infra   | `pii-crypto` tamper test flaked (base64-char flip could be a decode no-op), red-X'ing FE PRs                                                      | Med     | #535 (merged) |
| FE-7  | survey  | rating buttons conveyed the chosen score by colour only — added `aria-pressed` toggled with the fill (WCAG 1.4.1 / 4.1.2)                         | Med     | #538          |
| FE-10 | forms   | submit `fetch()` had no timeout — a stalled network left the button disabled forever; added a 15s `AbortController` cap                           | Low-Med | #539          |

---

## 🟡 Open — remaining

| #     | Surface / file                  | Item                                                                                                      | Sev |
| ----- | ------------------------------- | --------------------------------------------------------------------------------------------------------- | --- |
| FE-12 | `templates/landing.html` (~561) | logo is a `<span>`, not a link home (`<a href="/">`) — minor and debatable (landing IS `/`); PO to decide | Low |

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

---

_Owner: PO. FE-1…FE-11 resolved (fixed or verified-not-a-bug). Only FE-12 (minor, PO call) remains. Update statuses here as PRs merge; promote open items to Linear as needed._
