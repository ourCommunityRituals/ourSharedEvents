# OCR_STANDARD — Artifact-Integrity Checks

**Status:** Active — applies to every product repo that emits structured output (HTML/JS/CSS/JSON/SQL)
**Date:** 2026-08-25
**Owner:** mzdan
**Triggered by:** OSE-1003 — a form-submission bug that was invisible to ~200 tests because they matched substrings in the emitted output instead of parsing it. Generalized (OSE-1005) into a reusable checker, then into this standard, from an SDET point of view.

---

## The principle: assert integrity, not presence

A worker that serves surfaces **emits structured artifacts** — HTML pages, inline `<script>`/`<style>`, `data-*` JSON, SQL, route tables — by assembling strings. The recurring failure is that tests assert an artifact *contains* a substring (`body.toContain('…')`) but never that it is *valid*. So the API returns 201, the unit suite is green, and **the served artifact is broken**.

> **Artifact-integrity checks parse / validate / execute the generated output — they do not match substrings in it.**

It is the mutation-testing instinct applied structurally: a test that cannot go red on a corrupt artifact is not testing the artifact. This standard names a distinct, cheap pyramid rung that sits **between unit and E2E** in `OCR_STANDARD_perStoryTestPyramid.md` — faster and more localized than a browser E2E, stronger than a string-match unit test.

### The reference failure (why this exists)

OSE-1003: the sponsor-logo `onerror="this.style.display=\'none\'"` sat inside a backtick template literal, where `\'` collapses to a bare `'`. The served JS became a single-quoted string closed early at `display='`, leaving `none'` as an unexpected identifier → a `SyntaxError` that killed the **entire** inline `<script>`. No form could submit in a browser — yet the POST API returned 201 and every `toContain` test passed. The suite was **green ≠ true**.

---

## The method (5 steps)

1. **Enumerate the emission seams** — every place the code assembles a structured string (HTML surfaces, inline `<script>`/`<style>`, `data-*` JSON, SQL, route tables, flag keys, testids).
2. **Pick the strongest feasible oracle per artifact** — *parse it*, don't match it: JS → `new Function` (parse-only), CSS → a CSS parser, HTML → parse5, JSON → `JSON.parse`, SQL → a SQL parser. Cross-reference (referenced ↔ emitted) where the defect is a dangling reference.
3. **Two layers where render is constrained** — **rendered-validity** where the surface renders cheaply (semantic truth); **source-scan** where it cannot (fast, everywhere). One shared detector, two entry points.
4. **Negative-control every checker** — prove it goes red on a known-bad input *before* trusting it. A guard that cannot fail is worse than none.
5. **Gate + author-time** — an always-on CI test **and** a `npm run lint:*` CLI for pre-commit. Introduce to legacy code as a **baselined gate**: record existing violations, fail only on *new* ones, let the baseline shrink.

### The two-layer pattern

- **Layer 1 — rendered validity.** Render the surface, extract the emitted artifact, and *parse* it. Catches **any** error of that artifact class. Constraint: only sees code a test can render (edge/runtime pools may block `eval`, or a surface may need env/DB).
- **Layer 2 — source scan.** Read the source text directly (no render, no import) and flag the *known dangerous pattern*. Reaches every file, fires at author-time. Constraint: pattern-specific, not full validity.

They are complementary, not redundant: Layer 1 is general truth where renderable; Layer 2 is fast coverage everywhere. **KISS boundary:** Layer 2 detects the known pattern; general validity is Layer 1's job via real parsing — do not grow Layer 2 into a hand-rolled parser.

### The negative-control rule (non-negotiable)

Before a checker is trusted, run it against a **real known-bad input** (e.g. the pre-fix commit) and confirm it flags it, then against the fixed input and confirm zero. OSE-1005's detector silently returned **0 flags on genuinely broken source** on its first cut — a regex literal (`/[<>&"']/g`) desynced the scanner. Only the negative control caught it. "It passes on good code" is not evidence a checker works.

---

## Taxonomy — JS defect classes this addresses (by detection oracle)

Grouping by *what catches it* tells you which rung to build.

**A. Parser-catchable in the emitted JS — Layer 1 (`new Function`) catches the whole group at once**
Escaped-quote collapse (`\'`→`'`); a real newline in a `'..'`/`".."` string (interpolated multiline content → "unterminated string"); stray backtick / `${` in emitted text; U+2028 / U+2029 in a string literal (valid JSON, breaks JS); unbalanced brackets from a bad concat (`[object Object]`).

**B. Parses as JS, breaks as HTML — needs a rendered/HTML oracle**
Literal `</script>` inside inline JS (HTML parser closes the tag early — breakage **and** XSS; emit `<\/script>`); un-nonced inline `<script>`/`<style>` (CSP blocks at runtime, invisible to the API); `<!--` / `]]>` sequences.

**C. Source-pattern only — Layer 2 (scan, because render needs env)**
Escaped-quote (source form); unreplaced placeholder shipped literally (`${…}`, `EVENT_ID_PLACEHOLDER`); interpolation without an escaper (`+ var +` into HTML/JS context → XSS + break); `undefined`/`null` interpolated as a literal word; JSON embedded in an HTML attribute not attr-escaped / not `JSON.parse`-able.

**D. Syntax-valid but semantically wrong — NOT artifact-integrity; ESLint / tsc own these**
`==` vs `===`; assignment-in-condition; ASI foot-guns (`return`↵); `var` closure-over-loop-var / `let` TDZ; **floating promise / missing `await`** (a write→read race class); duplicate object keys; `switch` fallthrough; under-escaped `new RegExp('\\d')`. Audit that the rules are *enabled*; don't rebuild them as parse checks.

**E. Invisible-character class**
Smart quotes / non-breaking space / zero-width / BOM / CRLF pasted into code → `Unexpected token`. Cheap dedicated scan.

---

## Reference implementations (OSE)

Two exemplars ship in `ourSharedEvents`; use them as the template for new checkers and for other spokes.

### Exemplar 1 — embedded-JS integrity (OSE-1005)
One shared detector (`tests/_shared/embedded-integrity.js`), two layers:
- **Layer 1** (`tests/unit/rendered-surface-integrity.test.js`): render each surface, `new Function` every inline `<script>` (parse-only) → catches Group A. Forms hard-asserted; unrenderable surfaces log an honest skip and defer to Layer 2.
- **Layer 2** (`tests/unit/embedded-js-source-lint.test.js` + `scripts/lint-embedded-js.js`, `npm run lint:embedded-js`): scan source for the escaped-quote-in-template-literal pattern; a no-deps context state-machine that separates template text from strings, `${}` exprs, comments, and regex literals.
- Negative-controlled: 4 flags on the real pre-fix source, 0 after, 0 across all 36 files.

### Exemplar 2 — testid drift (artifact-integrity #2)
`tests/_shared/testid-inventory.js` cross-references `data-testid`s **referenced** by Playwright specs against testids **emitted** in source. A referenced testid backed nowhere is drift — the OSE-1003 roots 1 & 3 class (a `checkin-button` selector when the element is `checkin-submit`): the E2E then fails, skips, or passes on a fallback selector, invisible until a 14-minute live run. Shipped as a **baselined gate** (`tests/unit/testid-drift.test.js` + `scripts/lint-testids.js`, `npm run lint:testids`): 64 pre-existing drifts recorded as the known backlog; the gate fails on any *new* drift and on any *stale* baseline entry, so the backlog can only shrink.

### Candidate catalog (ranked, build opportunistically)

| # | Check | Catches |
|---|-------|---------|
| ✅ | embedded-JS parse (Layer 1) + escaped-quote scan (Layer 2) | Group A + the OSE-1003 bug |
| ✅ | testid drift | dead / renamed / aspirational selectors (Group: dangling reference) |
| 3 | inline `<style>` CSS parses / braces balanced | silent layout breakage |
| 4 | `${…}` / placeholder leakage in served output | unreplaced template tokens |
| 5 | HTML well-formedness (parse5 over rendered surfaces) | unclosed tags / unbalanced attr quotes |
| 6 | `data-*="${JSON.stringify(x)}"` round-trips (attr-escaped + parseable) | broken embedded state |
| 7 | unescaped interpolation into HTML/JS context | XSS + string-break |
| 8 | CSP: no un-nonced inline `<script>`/`<style>` across all surfaces | runtime CSP block, invisible to API |

---

## Relationship to existing patterns

This standard **names and unifies an instinct the org already had**, rather than inventing one. OSE already ships scattered artifact/drift checks — `csp-nonce.spec.ts`, `flag-seed-parity.spec.ts`, `infra-consistency.test.js`, `uec-drift-check`, `sponsor-allocation-drift-check`. They are all "assert the generated/derived artifact agrees with its source." The standard gives them a common shape (shared detector · two layers · negative control · baselined gate · CI + CLI) and a home in the pyramid.

It composes with:
- `OCR_STANDARD_perStoryTestPyramid.md` — artifact-integrity is a rung between unit and E2E; a story that emits a structured artifact should ship its integrity check.
- `OCR_STANDARD_knowledgeHomes.md` — reconciliation's third leg: this doc promotes the pattern into the brain so every spoke inherits it, instead of each re-discovering it as drift.

## How a spoke inherits it

Any repo that assembles structured output (OSE, OW, OSG, OSM/OA templates) adopts the same shape: a shared detector under `tests/_shared/`, a CI test in the always-on gate, an author-time `npm run lint:*` CLI, negative-controlled, baselined if introduced to existing code. A repo with no emitted artifacts (OSP, docs/governance) records that it carries no such surface and is vacuously compliant.

---

*Owner: Matt · Status: Active · First exemplars: OSE-1005 (embedded-JS), testid-drift.*
