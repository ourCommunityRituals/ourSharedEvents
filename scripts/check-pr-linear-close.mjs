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
 *   MUST contain an explicit CLOSING magic word for that SAME id (e.g.
 *   "Closes OSE-1172"). That makes the auto-close INTENTIONAL and declared.
 *   A slice PR avoids the failure by using an id-free branch/title and referencing
 *   the story only via a non-closing word in the body ("Part of OSE-1172").
 *
 * This converts the (thrice-violated) convention into a mechanical gate, and makes
 * true the "traceability gate" the worker CLAUDE.md previously only claimed.
 *
 * FOURTH CHANNEL — COMMIT MESSAGES (OSE-1443): a closing magic word in a commit
 * message on the PR can also close on merge. A squash merge copies every commit
 * message into the commit that lands on main, so editing the PR body to
 * "Part of" does not undo a "Closes OSE-###" left in a commit. #701's squash
 * commit carried "Closes OSE-867" and "Closes OSE-869" this way. (OSE-869 did
 * not close, so the body prose below is the likelier trigger for OSE-867 —
 * this check is defence in depth.) The rule: any id a commit message closes
 * must be closed in the PR body too. If the PR is a slice, reword the commit.
 *
 * CONTRADICTION IN THE BODY (OSE-1443): Linear reads magic words anywhere in the
 * body, prose included. #701's body said "Part of OSE-867" and also, in a
 * checklist heading, "before closing OSE-867 / OSE-869". "closing" is a magic
 * word and sat directly before OSE-867 only, and OSE-867 was the one that closed.
 * The guard counted that prose as a declared close. Now an id that the body
 * marks with BOTH a non-closing word ("Part of") and a closing word fails.
 *
 * USAGE:
 *   PR_BRANCH=… PR_TITLE=… PR_BODY=… [PR_COMMITS=…] node scripts/check-pr-linear-close.mjs
 *     (PR_COMMITS = the PR's commit messages, concatenated; optional)
 *     → exit 0 if compliant, exit 1 with an explanation if not.
 *   node scripts/check-pr-linear-close.mjs --self-test
 *     → runs built-in born-red cases; exit 0 if the guard logic is correct.
 */

import { appendFileSync } from 'node:fs';

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

// Linear's non-closing magic words (link only). Two-word forms are matched whole.
const NON_CLOSING_THEN_ID = /\b(?:part\s+of|refs?|references|contributes\s+to|towards|related\s+to)\s+(OSE-\d+)\b/gi;

/** Ids in `body` that carry a NON-closing magic word immediately before them. */
function sliceIdsIn(body) {
  const out = new Set();
  for (const m of String(body ?? '').matchAll(NON_CLOSING_THEN_ID)) {
    out.add(m[1].toUpperCase());
  }
  return out;
}

/**
 * Pure decision. Returns { ok, violations[], commitViolations[], bodyContradictions[] }.
 * A violation = an id that will auto-close on merge but that the body does NOT
 * explicitly close: `violations` come from the branch/title, `commitViolations`
 * from a closing word in a commit message. Those are exactly the ids Linear
 * will auto-close on merge without the author having declared it.
 * `bodyContradictions` = ids the body calls a slice ("Part of") AND closes
 * (a closing word, often in prose) — Linear honours the close.
 */
export function evaluate({ branch, title, body, commits }) {
  const declaredClosed = closedIdsIn(body);
  const sliceIds = sliceIdsIn(body);
  const bodyContradictions = [...declaredClosed].filter((id) => sliceIds.has(id));
  const undeclared = (ids) => [...ids].filter((id) => !declaredClosed.has(id));
  // No id in branch/title → no branch/title channel; a body-only
  // "Part of OSE-###" links without closing — allowed.
  const violations = undeclared(new Set([...idsIn(branch), ...idsIn(title)]));
  const commitViolations = undeclared(closedIdsIn(commits));
  return {
    ok: violations.length === 0 && commitViolations.length === 0 && bodyContradictions.length === 0,
    violations,
    commitViolations,
    bodyContradictions,
    // What was examined, so a green run's log shows it actually looked.
    seen: {
      branchTitleIds: [...new Set([...idsIn(branch), ...idsIn(title)])],
      closedInBody: [...declaredClosed],
      sliceInBody: [...sliceIds],
      closedInCommits: [...closedIdsIn(commits)],
      bodyChars: String(body ?? '').length,
      commitChars: String(commits ?? '').length,
    },
  };
}

/** One-line record of what the guard examined; printed on pass AND fail. */
export function evidenceLine({ seen }) {
  const list = (a) => (a.length ? a.join(',') : '-');
  return (
    `examined: body ${seen.bodyChars} chars, commits ${seen.commitChars} chars | ` +
    `branch/title ids: ${list(seen.branchTitleIds)} | closed in body: ${list(seen.closedInBody)} | ` +
    `Part of in body: ${list(seen.sliceInBody)} | closed in commits: ${list(seen.closedInCommits)}`
  );
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function runSelfTest() {
  const cases = [
    // [name, input, expectedOk]
    ['slice PR: id-free branch + Part of (the fix)', { branch: 'ci/sponsor-slice-isolation', title: 'sponsor-slice isolation', body: 'Part of OSE-1172' }, true],
    ['completing PR: id in branch + Closes', { branch: 'ci/ose-1172-done', title: 'finish OSE-1172', body: 'Closes OSE-1172' }, true],
    ['THE BUG (#466): id in branch, body only Refs', { branch: 'ci/ose-1172-sponsor-slice-isolation', title: 'slice 1', body: 'Refs OSE-1172' }, false],
    ['id in title only, no closing word', { branch: 'ci/whatever', title: 'work on OSE-946', body: 'Part of OSE-946' }, false],
    ['id in branch, wrong id closed in body', { branch: 'ci/ose-1172-x', title: 't', body: 'Closes OSE-9999' }, false],
    ['no Linear id anywhere', { branch: 'ci/typo-fix', title: 'fix typo', body: 'just a docs fix' }, true],
    ['multi-id branch, only one closed', { branch: 'ci/ose-1-and-ose-2', title: 't', body: 'Closes OSE-1' }, false],
    ['case-insensitive: lower branch + upper Closes', { branch: 'ci/ose-1172-x', title: 't', body: 'closes OSE-1172' }, true],
    ['THE BUG (#701): body Part of, commit Closes', { branch: 'claude/funny-hypatia', title: 'feat(poster): one call', body: 'Part of OSE-867', commits: 'feat(poster): one call\n\nCloses OSE-867' }, false],
    ['commit Closes, body Closes the same id', { branch: 'ci/x', title: 't', body: 'Closes OSE-867', commits: 'feat: x\n\nCloses OSE-867' }, true],
    ['commit only Part of', { branch: 'ci/x', title: 't', body: 'Part of OSE-867', commits: 'feat: x\n\nPart of OSE-867' }, true],
    ['commit Fixes an id the body never mentions', { branch: 'ci/x', title: 't', body: 'docs', commits: 'fix: y\n\nFixes OSE-42' }, false],
    ['THE BUG (#701 body): Part of + "before closing" prose', { branch: 'ci/x', title: 't', body: '**After merge, before closing OSE-867 / OSE-869:**\n\nPart of OSE-867\nPart of OSE-869' }, false],
    ['body Part of one id, Closes a different id', { branch: 'ci/x', title: 't', body: 'Part of OSE-1\nCloses OSE-2' }, true],
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
    const result = evaluate({
      branch: process.env.PR_BRANCH,
      title: process.env.PR_TITLE,
      body: process.env.PR_BODY,
      commits: process.env.PR_COMMITS,
    });
    const { ok, violations, commitViolations, bodyContradictions } = result;
    // In CI the workflow always supplies commits; an empty value means the
    // fetch silently returned nothing, so refuse to pass without looking.
    if (process.env.GITHUB_ACTIONS === 'true' && !process.env.PR_COMMITS) {
      fail('❌ Linear close-guard: PR_COMMITS is empty in CI — commit messages were not examined. Refusing to pass blind.');
    }
    console.log(evidenceLine(result));
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### Linear close-guard: ${ok ? '✅ pass' : '❌ fail'}\n\n\`${evidenceLine(result)}\`\n`
      );
    }
    if (ok) {
      console.log('✅ Linear close-guard: no undeclared auto-close. (Slice PR uses an id-free branch/title/commits + "Part of OSE-###", or completing PR declares "Closes OSE-###".)');
      process.exit(0);
    }
    let msg = `❌ Linear close-guard FAILED.\n`;
    if (violations.length > 0) {
      msg +=
        `\nThese OSE ids appear in the branch name or PR title, so Linear WILL auto-transition them to Done on merge — but the PR body does not explicitly declare the close:\n` +
        violations.map((v) => `  • ${v}`).join('\n') +
        `\n\nFix ONE of:\n` +
        `  1. If this PR COMPLETES the story: add "Closes ${violations[0]}" to the PR body (the auto-close is then intentional).\n` +
        `  2. If this PR is a SLICE of a multi-part story: rename the branch to NOT contain the id, remove the id from the title, and reference the story with a non-closing word in the body, e.g. "Part of ${violations[0]}". Then it links for traceability without auto-closing.\n\n` +
        `Why: Linear closes on branch-name/title id independently of the body (OSE-1250). A slice PR that names its branch after the parent silently marks a multi-part story Done.\n`;
    }
    if (commitViolations.length > 0) {
      msg +=
        `\nA commit message on this PR closes these OSE ids (e.g. "Closes ${commitViolations[0]}"), but the PR body does not:\n` +
        commitViolations.map((v) => `  • ${v}`).join('\n') +
        `\n\nFix ONE of:\n` +
        `  1. If this PR COMPLETES the story: add "Closes ${commitViolations[0]}" to the PR body.\n` +
        `  2. If this PR is a SLICE: reword the commit (git rebase, then change "Closes" to "Part of ${commitViolations[0]}") and force-push. Editing only the PR body is not enough.\n\n` +
        `Why: a squash merge copies every commit message into the commit on main, and Linear may close on a magic word there regardless of the PR body (OSE-1443).\n`;
    }
    if (bodyContradictions.length > 0) {
      msg +=
        `\nThe PR body says "Part of" these OSE ids, but also puts a closing word (close/fix/resolve/complete/implement…) right before them, often in prose:\n` +
        bodyContradictions.map((v) => `  • ${v}`).join('\n') +
        `\n\nLinear honours the closing word, so merging closes the story. Reword the prose so no closing word sits directly before the id (e.g. "before ${bodyContradictions[0]} is closed"), or drop "Part of" if this PR really completes it.\n\n` +
        `Why: #701's body said "Part of OSE-867" and "before closing OSE-867 / OSE-869"; OSE-867 closed on merge (OSE-1443).\n`;
    }
    fail(msg);
  }
}
