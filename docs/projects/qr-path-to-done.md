# QR Path to Done — execution record

> **What this file is.** The execution truth for the Linear project
> [QR Path to Done (P-OSE-28)](https://linear.app/oursharedevents/project/qr-path-to-done-ee33d97ba3aa).
> The Linear project page is the tracking truth; this file is updated after every
> session that touches the project, and the two must agree. On divergence, file a
> drift ticket rather than silently editing either side.

**Mission:** printed poster → scannable code → gated forever → traced to export.
Done means all five rungs green, the decode gate blocking in CI, and a physical
poster printed and scanned by a real phone (founder field test).

## Rungs

| #   | Rung                                       | Ticket(s)                                                                                                                     | Status                        | Evidence                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Print gate                                 | [OSE-286](https://linear.app/oursharedevents/issue/OSE-286)                                                                   | ✅ Done (2026-09-10)          | PR #507 (+ #509 brain note). `poster-print-gate.spec.ts`, `poster-print.spec.ts` › Print Gate                                                                                                                                                                            |
| 2a  | Poster payload — one call                  | [OSE-867](https://linear.app/oursharedevents/issue/OSE-867)                                                                   | 🔄 PR open (2026-09-30)       | `poster-bundle-payload.spec.ts` (9), `poster-multi-code-ui.spec.ts` › OSE-867 one data call, `poster-print.spec.ts` › One Data Call (component tier), Bruno `2. Public Events API/GET -api-v2-events-id-poster-bundle.yml`                                               |
| 2b  | `showQRSection` backing                    | [OSE-869](https://linear.app/oursharedevents/issue/OSE-869)                                                                   | 🔄 PR open (2026-09-30)       | Migration 0082 `events.settings_json`, `lib/event-settings.ts`; `poster-qr-section-setting.spec.ts` (13), `poster-multi-code-ui.spec.ts` › OSE-869 (poster both branches + admin switch), `poster-print.spec.ts` › showQRSection (component tier, incl. no-gap in print) |
| 3   | Mobile-viewport coverage                   | [OSE-740](https://linear.app/oursharedevents/issue/OSE-740)                                                                   | ✅ Done (2026-09-23)          | Mobile workability gate (OSE-1236) — 9th CI gate, blocks on PR code                                                                                                                                                                                                      |
| 4   | Decode matrix as a permanent CI gate       | [OSE-1127](https://linear.app/oursharedevents/issue/OSE-1127) / [OSE-1128](https://linear.app/oursharedevents/issue/OSE-1128) | 🟡 Runs today; not yet locked | `qr-roundtrip.spec.ts` (jsQR decode) runs in `T0 Tests (worker-d1-schema)` via `npm test` on every PR. Remaining: a meta-gate so the spec cannot be deleted, skipped or narrowed silently                                                                                |
| 5   | Capstone: scan → export trace, Eagles cell | [OSE-616](https://linear.app/oursharedevents/issue/OSE-616)                                                                   | 📋 Backlog                    | —                                                                                                                                                                                                                                                                        |

Also in the project (filed 2026-09-30, go-live evidence line, worked on its own
branch `claude/verify-qr-evidence-tfqtei`): OSE-1420 (In Progress) and follow-ups
OSE-1425 … OSE-1430.

## Session log

### 2026-09-30 — rung 2a (OSE-867)

- **Server:** `GET /api/v2/events/:id/poster-bundle` now carries `event` (the
  same OSE-1247 public projection + OSE-844 names as `GET /api/v2/events/:id`:
  `name`, `start_date`/`startDateISO`/`starts_at`/`timezone`, `venue` …) and
  `sponsors` (the `sponsor-bundle?surface=poster` posterTop set, no beacon
  tokens — print fires no impressions). The `eventName` duplicate is retired
  (one name per value). Envelope was already settled by OSE-842 (`status: 200`
  numeric, `eventStatus`).
- **Poster:** `/poster?event=<id>` is ONE request (`poster-bundle`) — was three
  (`/api/v2/events` → `sponsor-bundle` → `poster-bundle`). A scoped poster the
  bundle refuses shows "This poster is not available" instead of falling back
  to another event. Unscoped `/poster` still fetches the list for the picker,
  then one bundle call per chosen event.
- **Three-slot decision (AC):** superseded in code by OSE-1357 — the paper
  carries the organizer's saved codes (`slots`, event page first), not the
  GAS `qr.signup/public/display` trio or the four form keys (forms are off the
  poster). Recorded on the ticket for PO/DESIGN sign-off.
- **Born-red:** the new worker spec (7 of 9 red), the JSDOM one-call test and
  the Playwright one-call test were each run against the old code and failed
  before the fix.
- **Local evidence:** workers + node suites 307 files / 4,287 tests green;
  0-architecture structural shard 172/172; Playwright component
  `poster-print.spec.ts` 38/38 (chromium); Bruno request 7/7 against a local
  migrated worker; `/poster?event=` at 390px issues exactly one API call.
- **Not done by this rung:** X-4 route-parity gate (OSE-836, backlog) — the
  Bruno request exists for it to find; production synthetics (no production
  Worker yet).

### 2026-09-30 — rung 2b (OSE-869)

- **PO decision (Matt, 2026-09-30):** the switch is **per event**. New column
  `events.settings_json` (migration 0082, `REQUIRED_DB_MIGRATION` = 82), read
  and validated only in `src/lib/event-settings.ts`. This is the first slice of
  OSE-851 (X-14): its other toggles and the template `default_sections`
  fallback extend that module; they do not get a second home.
- **Absent means on.** Existing events have `{}` and their posters are
  unchanged. Only an explicit `false` hides the grid; unreadable values show it.
- **Write:** `POST`/`PUT /api/v2/admin/events` accept `settings`
  (strict: unknown key or non-boolean → 400 `INVALID_SETTINGS`); PUT is a
  partial merge. **Read:** `poster-bundle` and the admin `poster-codes` GET
  carry the resolved `settings`. Never in the public event projection.
- **Admin:** "Print QR codes on this poster" checkbox in the _Codes on the
  poster_ card; saves on change, reverts and says so on failure.
- **Poster:** off → the whole QR section is removed (absent, not empty); a
  real-browser test measures that no gap is left, on screen and in print. The
  codes are still minted and coloured as before (#3) — visibility only.
- **Test-ID note:** the ticket names `poster-qr-grid`; the live testid for the
  grid is `poster-qr-section` (unchanged, to avoid testid churn).
- **Negative spec:** `tests/e2e/4-negative/section-visibility-negative.spec.js`
  is in no CI tier (OSE-851/OSE-1244); the both-branch poster coverage is in
  the component tier instead, which does run on every PR.
- **Evidence:** full worker suite 308 files / 4,306 tests; 0-architecture
  shard 172/172 (tenant-isolation exemption re-keyed `events.ts:336→341` for
  the new import); `poster-print.spec.ts` 41/41; design check OK; Bruno 8/8;
  a real browser confirmed the poster with the switch off (no QR grid, Print
  enabled).

**Next rung:** 4 — lock the decode matrix so it cannot be deleted, skipped or
narrowed silently (no dependencies).
