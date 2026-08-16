/**
 * L7 Contract — AI seam governance (COST-102 / OSE-772 / ADR-014)
 *
 * COST-101 shipped the runtime-LLM-free invariant with an allowlist of exactly
 * one file: the dormant AI seam `src/lib/ai-sanitization.ts`. COST-102 ratifies
 * that seam as an architectural contract (ADR-014) and locks it three ways:
 *
 *   1. Allowlist-of-one   — the COST-101 invariant allowlists exactly the seam.
 *   2. CODEOWNERS lock     — the seam, the invariant, and the ADR require an
 *                            explicit security-owner review.
 *   3. This contract test  — asserts all three legs stay wired on every PR.
 *
 * The failure this catches: someone deletes the seam, widens the allowlist,
 * removes the CODEOWNERS lock, or drops the ADR — any of which quietly reopens
 * the door for a per-operation model call to erode the free-forever thesis.
 * Each of those turns this test red.
 *
 * Runs under root `npm test` (vitest) → T0 Gate. No deployed worker needed.
 */

const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..', '..');

const SEAM_REL = 'workers/oursharedevents/src/lib/ai-sanitization.ts';
const INVARIANT_REL = 'tests/e2e/0-architecture/runtime-llm-free.invariant.spec.ts';
const ADR_REL = 'docs/adr/ADR-014-ai-sanitization-sanctioned-seam.md';
const ADR_README_REL = 'docs/adr/README.md';
const CODEOWNERS_REL = '.github/CODEOWNERS';

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('L7 Contract — AI seam governance (COST-102 / ADR-014)', () => {
  describe('Leg 1 — the sanctioned seam exists and is the allowlist-of-one', () => {
    it('the sanctioned AI seam file exists at the canonical path', () => {
      expect(
        existsSync(join(ROOT, SEAM_REL)),
        `The single sanctioned AI seam must exist at ${SEAM_REL}. It is the only ` +
          `place a model call may enter the runtime (ADR-014). Deleting it would ` +
          `force the first AI feature to invent an unreviewed entry.`
      ).toBe(true);
    });

    it('the seam exports the sanitizers the seam is ratified around', () => {
      const seam = read(SEAM_REL);
      expect(seam).toMatch(/export function sanitizeForAI\b/);
      expect(seam).toMatch(/export function sanitizeJsonForAI\b/);
    });

    it('the COST-101 invariant allowlists EXACTLY the seam — no more, no fewer', () => {
      const inv = read(INVARIANT_REL);
      // The allowlist is declared as: new Set(['lib/ai-sanitization.ts'])
      const m = inv.match(/ALLOWLIST\s*=\s*new Set\(\[([^\]]*)\]\)/);
      expect(m, `${INVARIANT_REL} must declare an ALLOWLIST = new Set([...]).`).toBeTruthy();
      const entries = m[1]
        .split(',')
        .map((s) => s.trim().replace(/^['"`]|['"`]$/g, ''))
        .filter(Boolean);
      expect(
        entries,
        `The runtime-LLM-free allowlist must contain EXACTLY the one sanctioned ` +
          `seam. Widening it is a new architectural decision that needs its own ` +
          `ADR (ADR-014 Alternative B was rejected by default). Found: ${JSON.stringify(entries)}`
      ).toEqual(['lib/ai-sanitization.ts']);
    });
  });

  describe('Leg 2 — CODEOWNERS review-lock', () => {
    const codeowners = read(CODEOWNERS_REL);

    it('the seam file is review-locked in CODEOWNERS', () => {
      expect(
        codeowners,
        `${CODEOWNERS_REL} must name ${SEAM_REL} on its own owned line so a change ` +
          `to the seam always requires an explicit security-owner review.`
      ).toMatch(/^\/workers\/oursharedevents\/src\/lib\/ai-sanitization\.ts\s+@\S+/m);
    });

    it('the COST-101 invariant spec is review-locked in CODEOWNERS', () => {
      expect(
        codeowners,
        `${CODEOWNERS_REL} must review-lock ${INVARIANT_REL} — relaxing the cost ` +
          `guard must not merge without a security-owner review.`
      ).toMatch(/^\/tests\/e2e\/0-architecture\/runtime-llm-free\.invariant\.spec\.ts\s+@\S+/m);
    });

    it('ADR-014 itself is review-locked in CODEOWNERS', () => {
      expect(codeowners).toMatch(
        /^\/docs\/adr\/ADR-014-ai-sanitization-sanctioned-seam\.md\s+@\S+/m
      );
    });
  });

  describe('Leg 3 — ADR-014 is Accepted and indexed', () => {
    it('ADR-014 exists and is Accepted', () => {
      expect(
        existsSync(join(ROOT, ADR_REL)),
        `ADR-014 must exist at ${ADR_REL} — it is the long-form "why" behind the ` +
          `allowlist-of-one and the CODEOWNERS lock.`
      ).toBe(true);
      const adr = read(ADR_REL);
      expect(adr).toMatch(/^\*\*Status:\*\*\s*Accepted/m);
    });

    it('ADR-014 names the seam and the COST-101 invariant it ratifies', () => {
      const adr = read(ADR_REL);
      expect(adr).toContain('ai-sanitization.ts');
      expect(adr).toContain('runtime-llm-free.invariant.spec.ts');
      expect(adr).toContain('COST-101');
    });

    it('the ADR index lists ADR-014', () => {
      const readme = read(ADR_README_REL);
      expect(
        readme,
        `${ADR_README_REL} status table must include the ADR-014 row so the index ` +
          `stays in sync (README process step 6).`
      ).toMatch(/\[ADR-014\]\(ADR-014-ai-sanitization-sanctioned-seam\.md\)/);
    });
  });
});
