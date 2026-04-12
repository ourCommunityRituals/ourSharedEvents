# Test Naming Standard — OCR Org-Level

> Every test has a type. Every test name answers five questions. Every repo follows the same format.

---

## Test type hierarchy

Every test file belongs to exactly one type. The types are ordered from fastest/cheapest to slowest/most expensive.

```
Security         — dependency audits, secret scanning, IAC compliance
Lint             — code style, formatting, static analysis
Unit             — single function or module, isolated, mocked dependencies
Contract         — locks an external-facing shape (schema, API response, enum)
Integration      — multiple modules working together, real DB or service
API              — HTTP request/response against a running endpoint
Front End
  ├── Feature    — single UI component or interaction
  ├── E2E        — full user journey through the application
  └── Flow       — multi-step business process across screens
```

### File naming format

The file name carries the full context. No one should have to open a file to know what it tests.

```
{PRODUCT}_{TYPE}_{What}_{How}_{Why}.test.js
```

| Segment | Answers | Example |
|---------|---------|---------|
| **PRODUCT** | Which repo/product | `OSE`, `OW`, `OSM`, `OCR` |
| **TYPE** | Which test type from the hierarchy | `SECURITY`, `LINT`, `UNIT`, `CONTRACT`, `INTEGRATION`, `API`, `FEATURE`, `E2E`, `FLOW` |
| **What** | What is being tested | `sponsorTierValidation`, `xssEscape`, `posterRender` |
| **How** | How it's being tested (short) | `checkConstraint`, `mockD1`, `liveStaging` |
| **Why** | Why this test exists (short) | `OSE168`, `backwardCompat`, `boundaryOWxOSE` |

#### Examples

```
OSE_UNIT_sponsorTierNormalization_mockCoercion_backwardCompat.test.js
OSE_UNIT_xssEscape_charReplacement_securityBaseline.test.js
OSE_CONTRACT_sponsorSchema_enumValidation_OSE168.test.js
OSE_SECURITY_nodeForgeCVE_versionAudit_OSE166.test.js
OSE_LINT_importOrder_eslintRule_codeStyle.test.js
OSE_INTEGRATION_sponsorInsert_d1CheckConstraint_OSE168.test.js
OSE_API_sponsorEndpoint_getTierResponse_noStandardValues.test.js
OSE_FEATURE_sponsorCard_renderMissingLogo_gracefulDegradation.test.js
OSE_E2E_sponsorDisplay_posterSurface_titleTierAboveFold.test.js
OSE_FLOW_sponsorOnboarding_adminCreateToPreview_fullJourney.test.js
OW_UNIT_sanitizeForExport_stripContributorId_boundaryOWxOSE.test.js
```

The format scales from the simplest lint check to the most complex multi-page flow. Reading just the filename tells you: which product, what layer, what's tested, how, and why.

### Folder structure by type

```
tests/
├── security/          — Security
├── lint/              — Lint
├── unit/              — Unit
│   └── worker/        — Worker-specific unit tests
├── contract/          — Contract
├── integration/       — Integration
├── api/               — API smoke and endpoint tests
├── feature/           — Front End: Feature (single component)
├── e2e/               — Front End: E2E (full user journey)
└── flow/              — Front End: Flow (multi-step business process)
```

---

## The naming format

```
Where — Who — What — How — Why
```

| Part | Answers | Maps to | Required |
|------|---------|---------|----------|
| **Where** | What condition, context, or environment | `describe` (outer) | Always |
| **Who** | What module, function, or component is under test | `describe` (inner) | Always |
| **What** | What behavior or outcome is being verified | `test` title | Always |
| **How** | What input, action, or trigger produces the outcome | `test` title | When the trigger matters |
| **Why** | Why this test exists, if not obvious | `test` title (parenthetical) | When intent matters |

---

## How it maps to code

### `describe` = Where + Who

The outer `describe` sets the **where** (context/condition). The inner `describe` names the **who** (module or feature under test).

```javascript
describe('tier field (current schema)', () => {                    // Where
  describe('normalizeSponsorTier', () => {                          // Who
    test('preserves tier: "gold"', () => { ... });                  // What
  });
});
```

### `test` = What + How + Why

The `test` title states the **what** (expected outcome), the **how** (what input or action), and the **why** (when non-obvious).

```javascript
// What + How — straightforward
test('returns "primary" when no tier field is present', () => { ... });

// What + How + Why — legacy behavior needs explanation
test('coerces isPrimary: true → "title" via boolean mapping (intentional coercion)', () => { ... });

// What + Why — the how is obvious from the describe context
test('rejects "standard" as invalid tier (OSE-168)', () => { ... });
```

---

## The Why tag

The **Why** prevents false flags a year later. Use it when:

- The test exercises **legacy or deprecated** behavior intentionally
- The test exists because of a **specific bug** (reference the issue)
- The test validates a **boundary rule** that isn't obvious from the code
- The test covers an **architectural constraint** from another product

### Why tag patterns

| Pattern | When to use | Example |
|---------|-------------|---------|
| `(intentional coercion)` | Testing legacy field → new field mapping | `coerces isPrimary: true → "title" (intentional coercion)` |
| `(OSE-168)` | Test exists because of a specific bug fix | `rejects "standard" as invalid tier (OSE-168)` |
| `(boundary: OW ✕ OSE)` | Test enforces a cross-product boundary | `strips contributor PII from export (boundary: OW ✕ OSE)` |
| `(backward compat)` | Test ensures old inputs still work | `resolves legacy img field to logoUrl (backward compat)` |
| `(regression)` | Test prevents a known regression | `handles null sponsor array without throw (regression)` |
| `(contract)` | Test locks an external-facing contract | `tier enum matches sponsor.schema.json (contract)` |

---

## Naming rules

1. **Test names are sentences.** Plain English. No abbreviations unless universally understood.

2. **Describe blocks nest: Where → Who.** Context first, then the thing under test.

3. **No `it should` prefix.** Use `test()` not `it()`. Start with a verb: `returns`, `rejects`, `coerces`, `preserves`, `handles`, `strips`, `resolves`.

4. **Why tags go in parentheses at the end.** They're metadata, not the main assertion.

5. **One assertion concept per test.** Multiple `expect` calls are fine if they verify the same concept. Don't test two unrelated behaviors in one test.

6. **File names match the module.** `sponsor-tier-normalization.test.js` tests `normalizeSponsorTier`. No ambiguity.

---

## Examples by test type

### Security

```javascript
describe('dependency audit', () => {
  describe('node-forge', () => {
    test('resolves to version ≥ 1.3.1 — no known CVE (OSE-166)', () => {
      expect(installedVersion('node-forge')).toSatisfy(v => semver.gte(v, '1.3.1'));
    });
  });
});
```

### Unit

```javascript
describe('privacy bucketing', () => {
  describe('bucketTimestamp', () => {
    test('returns hour-bucketed string when given valid ISO timestamp (intentional — no exact timestamps)', () => {
      expect(bucketTimestamp('2026-04-09T14:37:00Z')).toBe('2026-04-09T14:00:00Z');
    });
  });
});
```

### Unit — legacy coercion

```javascript
describe('legacy isPrimary → tier coercion (intentional — tests backward compat)', () => {
  describe('normalizeSponsorTier', () => {
    test('coerces isPrimary: true → "title" (intentional coercion)', () => {
      expect(normalizeSponsorTier({ isPrimary: true })).toBe('title');
    });

    test('coerces isPrimary: 0 (falsy) → "primary" (intentional coercion)', () => {
      expect(normalizeSponsorTier({ isPrimary: 0 })).toBe('primary');
    });
  });
});
```

### Contract

```javascript
describe('sponsor schema validation', () => {
  describe('tier enum', () => {
    test('matches sponsor.schema.json — six valid tiers (contract)', () => {
      const validTiers = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'];
      expect(SCHEMA.properties.tier.enum).toEqual(validTiers);
    });

    test('rejects "standard" as tier value (OSE-168)', () => {
      expect(() => validate({ tier: 'standard' })).toThrow();
    });
  });
});
```

### Integration

```javascript
describe('D1 sponsor insert', () => {
  describe('sponsors table', () => {
    test('defaults tier to "primary" when not specified (OSE-168)', () => {
      const row = await db.prepare('INSERT INTO sponsors (id, event_id, name) VALUES (?, ?, ?) RETURNING tier')
        .bind('sp-test', 'evt-1', 'Test').first();
      expect(row.tier).toBe('primary');
    });

    test('rejects tier "standard" via CHECK constraint (OSE-168)', () => {
      await expect(db.prepare('INSERT INTO sponsors (id, event_id, name, tier) VALUES (?, ?, ?, ?)')
        .bind('sp-bad', 'evt-1', 'Bad', 'standard').run()).rejects.toThrow('CHECK');
    });
  });
});
```

### API

```javascript
describe('GET /api/v2/events/:id/sponsors', () => {
  describe('sponsor response shape', () => {
    test('returns sponsors with valid tier field — no "standard" values (OSE-168)', async () => {
      const res = await fetch(`${BASE}/api/v2/events/test-event-001/sponsors`);
      const data = await res.json();
      const validTiers = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'];
      data.sponsors.forEach(s => expect(validTiers).toContain(s.tier));
    });
  });
});
```

### Front End — Feature

```javascript
describe('sponsor card component', () => {
  describe('renderCard', () => {
    test('renders name in sp-name div when logoUrl is missing', () => {
      const html = renderCard({ id: 'sp1', name: 'Test' }, false);
      expect(html).toContain('class="sp-name"');
      expect(html).toContain('Test');
      expect(html).not.toContain('src=');
    });
  });
});
```

### Front End — E2E

```javascript
describe('sponsor display on event page', () => {
  describe('poster surface', () => {
    test('renders title-tier sponsor logo above fold', async ({ page }) => {
      await page.goto('/events/test-event-001');
      const logo = page.locator('[data-testid="sponsor-logo-title"]');
      await expect(logo).toBeVisible();
    });
  });
});
```

### Front End — Flow

```javascript
describe('sponsor onboarding flow', () => {
  describe('admin creates sponsor → assigns to event → views on poster', () => {
    test('new sponsor appears on poster preview within 5 seconds', async ({ page }) => {
      await createSponsor(page, { name: 'Flow Test', tier: 'gold' });
      await assignToEvent(page, 'test-event-001');
      await page.goto('/events/test-event-001/poster');
      await expect(page.locator('text=Flow Test')).toBeVisible({ timeout: 5000 });
    });
  });
});
```

### Boundary test (cross-product)

```javascript
describe('OW → OSE export boundary (boundary: OW ✕ OSE)', () => {
  describe('sanitizeForExport', () => {
    test('strips contributor_id from response — no named identity crosses to OSE', () => {
      const result = sanitizeForExport(musicData);
      expect(result).not.toHaveProperty('contributor_id');
    });

    test('preserves aggregate track count — anonymous data passes through', () => {
      const result = sanitizeForExport(musicData);
      expect(result.trackCount).toBe(12);
    });
  });
});
```

---

## CI output reads like a report

When tests run, the output tells the full story:

```
normalizeSponsorTier
  tier field (current schema)
    ✓ preserves tier: "gold"
    ✓ rejects "standard" as invalid tier (OSE-168)
    ✓ tier takes precedence over legacy isPrimary (intentional coercion)
  legacy isPrimary → tier coercion (intentional — tests backward compat)
    ✓ coerces isPrimary: true → "title" (intentional coercion)
    ✓ coerces isPrimary: 0 (falsy) → "primary" (intentional coercion)

sanitizeForExport
  OW → OSE export boundary (boundary: OW ✕ OSE)
    ✓ strips contributor_id from response — no named identity crosses to OSE
    ✓ preserves aggregate track count — anonymous data passes through
```

No guessing. No false flags. Anyone reading the output — a new dev, a sync agent, or you a year from now — knows what's being tested, how, and why.

---

## Adoption

Every product repo follows this standard. The test type hierarchy determines folder structure and file suffixes. The Where-Who-What-How-Why format determines every `describe` and `test` name. The Why tag is what pays dividends over time.

---

*Last updated: April 9 2026*
*Owner: Matt*
*Status: ACTIVE*
