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

| #   | Rung                                       | Ticket(s)                                                                                                                     | Status                                                                                  | Evidence                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Print gate                                 | [OSE-286](https://linear.app/oursharedevents/issue/OSE-286)                                                                   | ✅ Done (2026-09-10)                                                                    | PR #507 (+ #509 brain note). `poster-print-gate.spec.ts`, `poster-print.spec.ts` › Print Gate                                                                                                                                                                                         |
| 2a  | Poster payload — one call                  | [OSE-867](https://linear.app/oursharedevents/issue/OSE-867)                                                                   | ✅ Done (2026-10-01)                                                                    | PR #701 (+ #707 staging latency fix). `poster-bundle-payload.spec.ts`, `poster-multi-code-ui.spec.ts` › one data call, `poster-print.spec.ts` › One Data Call; Bruno poster-bundle request green on staging (main run 36795707694)                                                    |
| 2b  | `showQRSection` backing                    | [OSE-869](https://linear.app/oursharedevents/issue/OSE-869)                                                                   | ✅ Done (2026-10-01)                                                                    | PR #701. Migration 0085 `events.settings_json`, `lib/event-settings.ts`; `poster-qr-section-setting.spec.ts`, `poster-multi-code-ui.spec.ts` › OSE-869, `poster-print.spec.ts` › showQRSection (no-gap print). PO accepted the component-tier spec for negative coverage (2026-10-01) |
| 3   | Mobile-viewport coverage                   | [OSE-740](https://linear.app/oursharedevents/issue/OSE-740)                                                                   | ✅ Done (2026-09-23)                                                                    | Mobile workability gate (OSE-1236) — 9th CI gate, blocks on PR code                                                                                                                                                                                                                   |
| 4   | Decode matrix as a permanent CI gate       | [OSE-1127](https://linear.app/oursharedevents/issue/OSE-1127) / [OSE-1128](https://linear.app/oursharedevents/issue/OSE-1128) | ✅ Done (2026-10-01)                                                                    | PR #713 ([OSE-1439](https://linear.app/oursharedevents/issue/OSE-1439)). Meta-gate `tests/e2e/0-architecture/qr-decode-matrix.invariant.spec.ts` in the T0 `invariants` shard over `qr-roundtrip.spec.ts`. Red-proof 26/26; green on main                                             |
| 5   | Capstone: scan → export trace, Eagles cell | [OSE-616](https://linear.app/oursharedevents/issue/OSE-616)                                                                   | 🔄 Slice 1 merged (#720, #726); poster-cell aggregation (OSE-1459) PR open (2026-10-01) | `tests/scan-to-export-trace.spec.ts` (Eagles scan → aggregate → res7 corridor → export, res9 stripped; T0), `scripts/ci/trace-scan-staging.sh` (T4). Registry + definition_version wait on OSE-613 / OSE-603                                                                          |

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
  `events.settings_json` (migration 0085, `REQUIRED_DB_MIGRATION` = 85; renumbered from 0082 as main took 0082 (#694), 0083 (#699) and 0084 (#700)), read
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

### 2026-10-01 — rungs 2a/2b closed, rung 4 (OSE-1439)

- **Rung 2 closed.** #701 and #707 merged. Main run 36795707694 is green end to
  end (T0 → T1 staging deploy → T2 Bruno → T3 E2E smoke → T4 functional), so
  pyramid levels 6–7 ran. OSE-867 had auto-closed at merge (drift tracked in
  OSE-1443); its Done stands on that evidence. OSE-869 closed by the PO, who
  accepted `poster-print.spec.ts` (runs in CI) in place of
  `section-visibility-negative.spec.js` (runs nowhere).
- **Staging T2 latency (#707).** "GET Registrations" took 16.3 s against a 9 s
  budget because PBKDF2 ran once per decrypted name. The derived key is now
  cached per isolate (200 decrypts: 4,265 ms → 30 ms). The unbounded list is
  OSE-1442.
- **Rung 4.** `qr-decode-matrix.invariant.spec.ts` is a meta-gate in the
  `deprecation-lock` pattern. It fails if `qr-roundtrip.spec.ts` is deleted,
  skipped or focused; stops importing jsQR / the real encoder / the
  poster-bundle; stops asserting decoded == encoded; loses any of the 21 locked
  (level, length) cases or stops reaching v1 and v7 at L and M (checked against
  an independent ISO 18004 capacity table); moves into the node project; or if
  CI stops running `npm test` in `worker-d1-schema`, jsqr is uninstalled, or
  the mutation catalog drops below 7 encoder mutants. Wired into the T0
  `invariants` shard (the OSE-350 placement guard fails without it).
- **Red-proof:** 26 weakenings each turned the gate red: skip the sweep,
  `.only`, drop L@150, narrow H, weaken `toBe(url)` to `not.toBeNull()`, swap
  the decoder import, delete the spec, move it to the node pool (by name and by
  glob), add a `tests/qr-*.spec.ts` glob to the workers exclude list, remove the
  real poster-bundle fetch (a comment naming it no longer satisfies the gate),
  drop `npm test` from the shard, drop a mutant, and hide each of the last three
  behind a comment (an inline `// SELF.fetch(...)`, a YAML `# npm test`, a
  commented-out mutant), a double-quoted exclude glob, a commented-out include
  next to a narrowed one, `command: echo npm test`, the retry runner spawning a fixed command, the sweep
  decoding a fixture instead of `generateQrCode(url, …)`, and the root vitest
  config dropping the workers project, an aliased `qrSuite.skip`, a bracket
  `describe['skip']`, the T0 step running `echo skipped` instead of
  `${{ matrix.command }}`, and that step set `continue-on-error`. Restored: 8/8 green. Full structural shard 184/184. The
  glob and comment cases came from Copilot review on the PR; source is now read
  through a comment-stripping lexer, the workflow through js-yaml, and the
  shard command is locked exactly (bare `npm test` or the retry runner, which
  is checked to spawn its argv).
- **Follow-ups filed:** OSE-1440 (rate-limit poster/sponsor bundle), OSE-1441
  (`/poster` picker race), OSE-1442 (registrations paging), OSE-1443 (Done
  definition drift); CI install time folded into OSE-1074.

### 2026-10-01 — rung 5, slice 1 (OSE-616, Part of)

PO rulings this session (to be recorded in an OCR-docs ADR, Proposed):

- **The H3 layer is the geography model.** res9 is for physical places only:
  a poster's placement and live QR scans at the venue during the event.
- **The corridor is the res7 node**, and the corridor id that crosses to
  BigQuery is the res7 cell string (named corridors become registry labels over
  res7 cells later, OSE-613).
- **Shortlink clicks** resolve to their event, located at the event venue's
  res7 (privacy); the click record itself holds no place.
- **Exports** carry res7 or coarser; nothing finer ever crosses.

Delivered in the slice:

- Export `corridor_id` = `COALESCE(e.h3_res7, e.corridor_id)` for the
  anon-id-returns and event-series tables (was `events.corridor_id`, which has
  no writer, so every row said `'unknown'`).
- `lib/export-geography.ts`: every row handed to BigQuery is checked at
  corridor grain. A sub-corridor column or any H3 cell finer than res7 throws;
  the phase fails closed (no watermark advance). Rejected, not trimmed.
- The SharedReport export writes an `export_manifest` row per phase (counts,
  routing, corridor coverage; no row data), closing the OSE-556 gap.
- `tests/scan-to-export-trace.spec.ts` (8 tests, T0): one Eagles scan through
  `/q/` → `scan_aggregates` → `anon_id_returns` → corridor baseline (res7) →
  export (res7 only, res9 absent from the payload) → manifest; plus a `/s/`
  click → event at venue res7; plus a res9-keyed baseline failing closed.
  Red-proof: removing each of the three fixes turns its test red.
- Staging: `trace-eagles-poster.sql` + `scripts/ci/trace-scan-staging.sh` in T4
  scan the Eagles test poster and confirm the scan lands at res9/res7.

Not in this slice: corridor registry + `definition_version` (OSE-613/603);
per-placement scan aggregation (a pre-event poster scan is aggregated at the
venue node, not the poster's); doctrine conflicts the review found (export
sends `anon_id_hash` + `venue_id`; 15-min vs hourly time grain; CF-IPCountry
on scans).

**Next:** merge slice 1, record the H3 ADR, then OSE-613 (registry) and the
per-placement aggregation follow-up; the founder field test (print + phone scan)
closes the project.

**Later the same day:** slice 1 merged as #720 and ADR-011 merged in OCR-docs
(Proposed). Copilot's second review landed after the merge; its five findings
were real and are fixed in a follow-up PR (Part of OSE-616):

- `corridor_id` must be a valid res7-or-coarser H3 cell or `'unknown'`. Legacy
  named ids map to `'unknown'`; anything else fails the phase.
- The event backup (`handlers/bigquery.ts`, a second D1 → BigQuery route) now
  exports the res7 corridor and runs the same row guard.
- BigQuery `insertErrors` inside an HTTP 200 now fail the insert, so the
  watermark holds.
- The return-rate job missed date-only events (the API's only date shape). It
  now checks each event's real end time. The trace test creates its event
  through the API with calendar dates and a timezone.
- `SHARED-REPORT-BIGQUERY-EXPORT.md` describes the res7 corridor id.

### 2026-10-01 — rung 5, poster-cell aggregation (OSE-1459)

#726 merged. PO rulings this session: ADR-011 is **Accepted** (OCR-docs #148);
OSE-1462 (exactly-once BigQuery delivery) waits until something reads BigQuery;
the SharedReport corridor map shows **scans per poster cell**.

- Every scan comes in through a poster (`GET /q/:qr_token`), so every scan has a
  place: its poster's res9. No separate "live scan" rule is needed; a poster at
  the venue is in the venue's cell.
- New place-side rollup `scan_cell_aggregates` (migration 0087): scans per
  (event, hour, poster res9 cell), from `scan_placement_events` ×
  `poster_deployments` only. Doctrine rule 6 keeps it a scan count with no
  poster id and no session value. Recomputed per run in one atomic batch, so a
  corrected poster location never double-counts.
- The corridor map reads it, K-floored per cell. `scan_aggregates` stays
  event-level (distinct hashes, top country, venue cells).
- Trace hop 7: five people scanning a Beverly poster land at Beverly's cell;
  the single Eagles scan stays under the floor and is not counted.
- Review fix: the K-floor applies to each poster-hour before it is added into
  its cell, so one person scanning five posters in one cell does not publish
  that cell (trace hop 8). Gates: NCR structural (no TTL, no placement id, no
  session value, one writer), schema Gate 4, tenant-isolation exemptions.
