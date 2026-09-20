/**
 * OSE-1250 (Tier 1) — PR Linear close-guard.
 *
 * WHY: Linear's GitHub integration auto-transitions a story to Done on PR merge
 * when the issue is linked via a CLOSING channel. There are three linking
 * channels with no hierarchy: (a) the issue id in the BRANCH NAME, (b) the id in
 * the PR TITLE, (c) a magic word + id in the PR BODY. Branch-name and title links
 * are closing links — they fire the on-merge automation regardless of what the
 * body says. This bit us 3× in one day (OSE-1071, OSE-946, OSE-1172/#466): each
 * slice PR carried the parent id in its branch name, so merging a single slice
 * silently marked a multi-part story Done (see Linear OSE-1250).
 *
 * The ONLY per-PR way to link WITHOUT auto-closing is a NON-closing magic word
 * ("part of", "ref", "contributes to", …) in the body AND keeping the id out of
 * the branch name and title (per Linear's own docs).
 *
 * THE RULE this guard enforces:
 *   If the branch name OR the PR title contains an OSE issue id, then the PR body
 *   MUST explicitly declare intent for that SAME id via either:
 *     - a closing magic word (e.g. "Closes OSE-1172"), or
 *     - an explicit slice declaration ("Part of OSE-1172").
 *   This blocks silent/ambiguous links (id in branch/title with no matching body
 *   declaration), while allowing intentional slice PRs.
 *
 * This converts the (thrice-violated) convention into a mechanical gate, and makes
 * true the "traceability gate" the worker CLAUDE.md previously only claimed.
 *
 * USAGE:
 *   PR_BRANCH=… PR_TITLE=… PR_BODY=… node scripts/check-pr-linear-close.mjs
 *     → exit 0 if compliant, exit 1 with an explanation if not.
 *   node scripts/check-pr-linear-close.mjs --self-test
 *     → runs built-in born-red cases; exit 0 if the guard logic is correct.
 */

// Linear's closing magic words (docs: linking that AUTO-CLOSES on merge).
const CLOSING_WORDS = new Set([
  'close', 'closes', 'closed', 'closing',
  'fix', 'fixes', 'fixed', 'fixing',
  'resolve', 'resolves', 'resolved', 'resolving',
  'complete', 'completes', 'completed', 'completing',
  'implement', 'implements', 'implemented', 'implementing',
]);

const ISSUE_ID = /\bOSE-\d+\b/gi;
// The word immediately preceding an id, captured for closing-word membership.
// A LITERAL regex (no interpolation) — set-membership does the closing check.
const WORD_THEN_ID = /\b([A-Za-z]+)\s+(OSE-\d+)\b/gi;
const PART_OF_THEN_ID = /\bpart\s+of\s+(OSE-\d+)\b/gi;

/** Extract the set of OSE ids (upper-cased) found in a string. */
function idsIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(ISSUE_ID)) {
    out.add(m[0].toUpperCase());
  }
  return out;
}

/** Ids in `body` that carry an explicit CLOSING magic word immediately before them. */
function closedIdsIn(body) {
  const out = new Set();
  for (const m of String(body ?? '').matchAll(WORD_THEN_ID)) {
    if (CLOSING_WORDS.has(m[1].toLowerCase())) out.add(m[2].toUpperCase());
  }
  return out;
}

/** Ids in `body` explicitly declared as slices via "Part of OSE-###". */
function partOfIdsIn(body) {
  const out = new Set();
  for (const m of String(body ?? '').matchAll(PART_OF_THEN_ID)) {
    out.add(m[1].toUpperCase());
  }
  return out;
}

/**
 * Pure decision. Returns { ok, violations[] }.
 * A violation = an id present in branch/title that the body does NOT explicitly
 * declare (close OR explicit "Part of").
 */
export function evaluate({ branch, title, body }) {
  const triggering = new Set([...idsIn(branch), ...idsIn(title)]);
  if (triggering.size === 0) {
    // No id in branch/title → no branch/title auto-close channel is active.
    // (A body-only "Part of OSE-###" links without closing — allowed.)
    return { ok: true, violations: [] };
  }
  const declaredClosed = closedIdsIn(body);
  const declaredPartOf = partOfIdsIn(body);
  const violations = [...triggering].filter(
    (id) => !declaredClosed.has(id) && !declaredPartOf.has(id)
  );
  return { ok: violations.length === 0, violations };
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function runSelfTest() {
  const cases = [
    // [name, input, expectedOk]
    ['slice PR: id-free branch + Part of (the fix)', { branch: 'ci/sponsor-slice-isolation', title: 'sponsor-slice isolation', body: 'Part of OSE-1172' }, true],
    ['slice PR: id in branch + Part of same id', { branch: 'ci/ose-1172-sponsor-slice-isolation', title: 'slice 1', body: 'Part of OSE-1172' }, true],
    ['completing PR: id in branch + Closes', { branch: 'ci/ose-1172-done', title: 'finish OSE-1172', body: 'Closes OSE-1172' }, true],
    ['THE BUG (#466): id in branch, body only Refs', { branch: 'ci/ose-1172-sponsor-slice-isolation', title: 'slice 1', body: 'Refs OSE-1172' }, false],
    ['id in title only + Part of same id', { branch: 'ci/whatever', title: 'work on OSE-946', body: 'Part of OSE-946' }, true],
    ['id in title only, no declaration', { branch: 'ci/whatever', title: 'work on OSE-946', body: 'notes only' }, false],
    ['id in branch, wrong id closed in body', { branch: 'ci/ose-1172-x', title: 't', body: 'Closes OSE-9999' }, false],
    ['no Linear id anywhere', { branch: 'ci/typo-fix', title: 'fix typo', body: 'just a docs fix' }, true],
    ['multi-id branch, only one closed', { branch: 'ci/ose-1-and-ose-2', title: 't', body: 'Closes OSE-1' }, false],
    ['case-insensitive: lower branch + upper Closes', { branch: 'ci/ose-1172-x', title: 't', body: 'closes OSE-1172' }, true],
  ];
  let failed = 0;
  for (const [name, input, expectedOk] of cases) {
    const got = evaluate(input).ok;
    const pass = got === expectedOk;
    if (!pass) failed++;
    console.log(`${pass ? 'PASS' : 'FAIL'} — ${name} (expected ok=${expectedOk}, got ok=${got})`);
  }
  if (failed > 0) fail(`\nself-test: ${failed} case(s) failed — guard logic is wrong.`);
  console.log(`\nself-test: all ${cases.length} cases passed.`);
}

// ── entrypoint ────────────────────────────────────────────────────────────────
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-pr-linear-close.mjs');
if (isMain) {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
  } else {
    const { ok, violations } = evaluate({
      branch: process.env.PR_BRANCH,
      title: process.env.PR_TITLE,
      body: process.env.PR_BODY,
    });
    if (ok) {
      console.log('✅ Linear close-guard: no undeclared story intent. (When branch/title contains OSE-###, body explicitly declares either "Part of OSE-###" or "Closes OSE-###".)');
      process.exit(0);
    }
    fail(
      `❌ Linear close-guard FAILED.\n\n` +
        `These OSE ids appear in the branch name or PR title, but the PR body does not explicitly declare story intent for them (expected "Part of OSE-###" or "Closes OSE-###"):\n` +
        violations.map((v) => `  • ${v}`).join('\n') +
        `\n\nFix ONE of:\n` +
        `  1. If this PR COMPLETES the story: add "Closes ${violations[0]}" to the PR body.\n` +
        `  2. If this PR is a SLICE of a multi-part story: add "Part of ${violations[0]}" to the PR body.\n\n` +
        `Why: ids in branch/title without a matching body declaration are ambiguous and have caused wrong lifecycle transitions in practice (OSE-1250).`
    );
  }
}
