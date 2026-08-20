# GAS/zeventbook MVP reference — RETIRED (OSE-882, X-17)

> **Recorded retirement (Invariant #10 — deprecation is a decision, not a silent delete).**
> These artifacts are kept readable as history. They are **not** a contract of record.

## Supersession

The **v1.0 "FROZEN"** event contract described here — `event.schema.json` requiring
`name`, `startDateISO`, `venue`, `links`, `qr`, `ctas`, `settings`, `createdAtISO`,
`updatedAtISO` — is **retired, superseded by the live D1 schema at migration 61.**

The contract of record for the events payload is the `events` table
(`title`, `slug`, `status`, `description`, `location`, `start_date`, `end_date`,
`created_at`, `updated_at`) plus the response envelope in **ADR-016**
(`{ ok, status:<HTTP#>, item(s) }`). The live structural gate is
`tests/e2e/0-architecture/api-response-schema.invariant.spec.ts`; the runtime
contract is asserted by the Postman/Newman collections.

## Why these were residue (verify-first, 2026-08-20)

All 12 schemas carried `$id: https://zeventbook.com/schemas/…` (NXDOMAIN) and
described shapes the live Worker does **not** emit:

- `event.schema.json` — requires `links`/`qr`/`ctas`/`settings` objects and
  `createdAtISO` that no handler produces.
- `sponsor.schema.json` — encodes `impressionToken`, `tier`, `placement`/named
  slots, i.e. the vocabulary **Invariant #25 retired**. Keeping it as "contract"
  was actively harmful, not neutral.
- the 7 response wrappers — the abandoned `{ ok, value, etag }` envelope (the
  "seventh shape" X-9 / OSE-842 flagged) that zero handlers emit.

## What moved here

- `schemas/` — the 12 `zeventbook.com`-namespaced JSON schemas.
- `helpers/schema-validator.js` — the AJV runtime-validation harness (envelope /
  endpoint validators + jest matchers). **Preserved deliberately** — the harness
  _approach_ is worth harvesting; only its schemas were abandoned. See the
  harvest follow-up.
- `tests/api-schema-validation.contract.test.js` — the only test that loaded the
  validator against these schemas.
- `scripts/` — `test-event-schema.js`, `test-analytics-schema.js`,
  `test-schemas.js`, `check-apis-vs-schemas.js`, `check-schema-fields.js`.

## npm scripts removed (were wired to `npm test` via `check:guards`)

`test:schemas`, `test:schema-validation(:verbose)`, `test:story3.1`,
`test:schemas:event`, `test:schemas:analytics`, `check:guards`,
`check:api-schemas`, `check:schema-fields`, `check:schemas:all`; `test:schemas`
dropped from `ci:contracts` / `ci:e2e:smoke`. Root `npm test` is now `vitest run`.

## Harvest follow-up

The AJV harness in `helpers/schema-validator.js` is a stronger runtime
contract-validation pattern than structural source-reads. The follow-up
re-authors schemas to the **live** ADR-016 / `enrichWithPhase` shapes and points
the validators at real handler responses (`SELF.fetch`) — a runtime contract
gate complementing Postman/Newman.
