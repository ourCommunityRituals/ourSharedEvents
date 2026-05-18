# UEC Test Fixtures & Helpers (OSE-325)

Reusable test scaffolding for everything UEC-related in OSE. Fixtures
live here; helper utilities live at `../helpers/uec/`. Together they
let SDET stories (OSE-326 contract suite, OSE-327 E2E, OSE-328 visual
regression, OSE-329 runtime sync) ship without duplicating boilerplate.

## Layout

```
tests/
├── fixtures/uec/
│   ├── README.md              ← this file
│   ├── canonical-codes.ts     ← all 11 codes + curated views (CORE_CODES, EXTENSION_CODES, ALT_PRINT_CODES, CODES_BY_GRADE, getCanonical())
│   ├── invalid-inputs.ts      ← MISSING_INPUTS, NON_CANONICAL_INPUTS, NON_STRING_INPUTS, MALFORMED_HEX
│   ├── edge-cases.ts          ← CASE_VARIATIONS, WHITESPACE_VARIATIONS, MULTI_WORD_LABELS, HYPHENATED_IDS
│   └── tenant-contexts.ts     ← DEFAULT_TENANT, STAGING_TENANT, HYPOTHETICAL_WHITELABEL_TENANT, CURRENT_TENANT
└── helpers/uec/
    ├── index.ts               ← barrel export
    ├── loader.ts              ← loadCanonicalUEC()
    ├── request.ts             ← requestCanonicalQR(), requestQrWithoutCode()
    └── assertions.ts          ← assertUECMapping(), assertRefusalResponse(), assertScanHex()
```

## Quick start — happy path

```ts
import { describe, test } from 'vitest';
import { requestCanonicalQR, assertUECMapping } from './helpers/uec';
import { CORE_CODES } from './fixtures/uec/canonical-codes';

describe('UEC core code happy path', () => {
  for (const code of CORE_CODES) {
    test(`${code.id} resolves canonically`, async () => {
      const res = await requestCanonicalQR(code.id);
      await assertUECMapping(res, code);
    });
  }
});
```

## Quick start — refusal path

```ts
import { describe, test } from 'vitest';
import { requestCanonicalQR, requestQrWithoutCode, assertRefusalResponse } from './helpers/uec';
import { MISSING_INPUTS, NON_CANONICAL_INPUTS } from './fixtures/uec/invalid-inputs';

describe('UEC refusal paths', () => {
  test('no code param → MISSING_CODE', async () => {
    const res = await requestQrWithoutCode();
    await assertRefusalResponse(res, 'MISSING_CODE');
  });

  for (const input of MISSING_INPUTS) {
    test(`empty-shape input "${input}" → MISSING_CODE`, async () => {
      const res = await requestCanonicalQR(input);
      await assertRefusalResponse(res, 'MISSING_CODE', input);
    });
  }

  for (const input of NON_CANONICAL_INPUTS) {
    test(`unknown code "${input}" → INVALID_CODE`, async () => {
      const res = await requestCanonicalQR(input);
      await assertRefusalResponse(res, 'INVALID_CODE', input);
    });
  }
});
```

## Quick start — edge cases

```ts
import { describe, test } from 'vitest';
import { requestCanonicalQR, assertScanHex } from './helpers/uec';
import { CASE_VARIATIONS, WHITESPACE_VARIATIONS } from './fixtures/uec/edge-cases';
import { getCanonical } from './fixtures/uec/canonical-codes';

describe('UEC case + whitespace tolerance', () => {
  for (const { input, expectedId, why } of [...CASE_VARIATIONS, ...WHITESPACE_VARIATIONS]) {
    test(`"${input}" → ${expectedId} (${why})`, async () => {
      const res = await requestCanonicalQR(input);
      await assertScanHex(res, getCanonical(expectedId).scan_hex);
    });
  }
});
```

## Tenant context (today + future)

Today's tests run against `DEFAULT_TENANT` (single-tenant OSE). The
`STAGING_TENANT` and `HYPOTHETICAL_WHITELABEL_TENANT` fixtures
scaffold cross-tenant testing for when:

- Playwright contract tests need to hit `stg.oursharedevents.com`
  instead of the in-process miniflare — use `STAGING_TENANT`
- A white-label customer joins — replace `HYPOTHETICAL_WHITELABEL_TENANT`
  with the real config; existing tests inherit the tenant-aware shape

```ts
import { requestCanonicalQR } from './helpers/uec';
import { STAGING_TENANT } from './fixtures/uec/tenant-contexts';

const res = await requestCanonicalQR('sponsor', { tenant: STAGING_TENANT });
// encoded_url in the response will be https://stg.oursharedevents.com/sponsor
```

## Extending for UEC v1.2+

The fixtures derive from the typed `CODES` import. When the brain
artifact (and via OSE-332's sync pattern, the OSE consumed copy) gains
v1.2 codes, the fixtures grow automatically:

- `ALL_CODES` / `CORE_CODES` / `EXTENSION_CODES` include the new codes
- `CODES_BY_GRADE` re-buckets if new grades are introduced
- `ALT_PRINT_CODES` picks up any new alt-print carve-outs
- Tests that iterate these fixtures inherit v1.2 coverage with zero edits

When adding a NEW fixture category for a v1.2-only concept, follow the
naming + comment pattern in the existing files. Tests should never
import "specific codes by hardcoded id" — always go through
`getCanonical(id)` or a curated view (`CORE_CODES`, etc.) so the brain
remains the single source of truth.

## What these fixtures intentionally do NOT cover

- **Brand-voice copy on errors**: lives in `.claude/brand-voice-guidelines.md`
  §4.2 (friendly-error pattern). `assertRefusalResponse()` guards
  against raw-stack-trace leakage but doesn't enforce the full pattern.
- **WCAG contrast computation**: brain-side, enforced by
  `ocr-docs-brain/tests/level3_unit.py` (OSE-324). OSE tests only
  check that the declared `wcag_grade` flows through correctly.
- **Brain↔OSE drift detection**: `tests/uec-drift-check.spec.ts`
  (OSE-323). Fixtures here load from the OSE consumed copy; drift is
  caught at the layer above.

## Pattern reference

- `tests/uec-substrate-static-gate.spec.ts` (OSE-322) — pure detector
  - synthetic positive tests + real-data gate; same structural pattern
- `tests/architecture.spec.ts` (OSE-205) — broader OSE invariant test
  template (Anonymous ID architecture)

## Story trail

| Story       | Role                                                              |
| ----------- | ----------------------------------------------------------------- |
| OSE-318     | Brain canonical exists (the data these fixtures derive from)      |
| OSE-320     | OSE consumed copy + endpoint (what these helpers request against) |
| **OSE-325** | **This work — fixtures + helpers**                                |
| OSE-326     | Full contract test suite (uses these fixtures)                    |
| OSE-327     | E2E tests (uses these fixtures + Playwright variants)             |
| OSE-328     | Visual regression (uses these fixtures)                           |
| OSE-329     | Runtime sync contract test (uses these fixtures)                  |
