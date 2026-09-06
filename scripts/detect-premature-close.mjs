#!/usr/bin/env node
/**
 * OSE-1250 (Tier 2) — premature-close detector (post-merge safety net).
 *
 * WHY: The PR close-guard (Tier 1) prevents the common case at PR time, but a
 * story can still be marked Done wrongly through paths CI can't see — a manual
 * status change in the Linear UI, a closing keyword typed on a slice PR, or any
 * future gap. The board is an attestation surface (honest-green / governance
 * floor); a false Done is a silent lie. This detector bounds MTTD: it runs on a
 * schedule and FLAGS Done issues that look prematurely closed, so a mistake is
 * caught in ≤1 day instead of whenever someone happens to look.
 *
 * TWO SIGNALS (data-driven, low false-positive):
 *   A. A Done issue that still has ≥1 OPEN child issue (parent closed before its
 *      children — the OSE-946 / epic case).
 *   B. A Done issue whose linked GitHub PR(s) contain NO explicit closing keyword
 *      for its id in the body (i.e. it was auto-closed via branch/title only — the
 *      OSE-1172 / #466 signature). Best-effort: needs GitHub PR bodies.
 * A Done issue with no children and no linked PR is NOT flagged (legit manual
 * completion) — silence there is real, not a gap.
 *
 * The classifier is pure and self-tested (`--self-test`) so the detector's own
 * logic can't silently rot. The network layer is thin and fail-soft.
 *
 * USAGE:
 *   node scripts/detect-premature-close.mjs --self-test
 *   LINEAR_API_KEY=… LINEAR_TEAM_ID=… GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo \
 *     node scripts/detect-premature-close.mjs [--since-days 7]
 *   → exits 1 if any suspect is found (an andon: the scheduled run goes red).
 *     The report is printed to stdout; the workflow tees it into the job summary.
 */

const CLOSING_WORDS = new Set([
  'close',
  'closes',
  'closed',
  'closing',
  'fix',
  'fixes',
  'fixed',
  'fixing',
  'resolve',
  'resolves',
  'resolved',
  'resolving',
  'complete',
  'completes',
  'completed',
  'completing',
  'implement',
  'implements',
  'implemented',
  'implementing',
]);
const WORD_THEN_ID = /\b([A-Za-z]+)\s+([A-Z]+-\d+)\b/gi;
const TERMINAL_CHILD_STATES = new Set(['completed', 'canceled']);

/** True if `body` explicitly closes `identifier` (closing magic word + that id). */
function bodyClosesId(body, identifier) {
  const want = String(identifier).toUpperCase();
  for (const m of String(body ?? '').matchAll(WORD_THEN_ID)) {
    if (CLOSING_WORDS.has(m[1].toLowerCase()) && m[2].toUpperCase() === want) return true;
  }
  return false;
}

/**
 * Pure classifier. `issues` = [{ identifier, title, url, children:[{stateType}],
 * linkedPRs:[{ body }] }]. Returns [{ identifier, title, url, reasons[] }].
 */
export function classify(issues) {
  const suspects = [];
  for (const issue of issues ?? []) {
    const reasons = [];

    const openChildren = (issue.children ?? []).filter(
      (c) => !TERMINAL_CHILD_STATES.has(c.stateType)
    );
    if (openChildren.length > 0) {
      reasons.push(
        `Done but has ${openChildren.length} open child issue(s) — parent closed before its children.`
      );
    }

    const prs = issue.linkedPRs ?? [];
    if (prs.length > 0 && !prs.some((p) => bodyClosesId(p.body, issue.identifier))) {
      reasons.push(
        `Done but no linked PR body explicitly closes ${issue.identifier} — likely auto-closed via branch/title only (OSE-1250).`
      );
    }

    if (reasons.length > 0) {
      suspects.push({ identifier: issue.identifier, title: issue.title, url: issue.url, reasons });
    }
  }
  return suspects;
}

// ── network layer (thin, fail-soft) ───────────────────────────────────────────

async function linearDoneIssues({ apiKey, teamId, sinceDays }) {
  const query = `
    query($teamId: ID!, $since: DateTimeOrDuration) {
      issues(
        first: 100
        filter: { team: { id: { eq: $teamId } }, state: { type: { eq: "completed" } }, completedAt: { gt: $since } }
      ) {
        nodes {
          identifier
          title
          url
          children { nodes { state { type } } }
          attachments { nodes { url } }
        }
      }
    }`;
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { teamId, since: `-P${sinceDays}D` } }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(`Linear API: ${JSON.stringify(json.errors)}`);
  return (json.data?.issues?.nodes ?? []).map((n) => ({
    identifier: n.identifier,
    title: n.title,
    url: n.url,
    children: (n.children?.nodes ?? []).map((c) => ({ stateType: c.state?.type })),
    prUrls: (n.attachments?.nodes ?? [])
      .map((a) => a.url)
      .filter((u) => /github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(u)),
  }));
}

async function githubPrBody(prUrl, token) {
  const m = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  const [, owner, repo, num] = m;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ose-premature-close-detector',
    },
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.body ?? '';
}

async function enrichWithPrBodies(issues, token) {
  if (!token) return issues.map((i) => ({ ...i, linkedPRs: [] })); // Signal B skipped
  for (const issue of issues) {
    const bodies = [];
    for (const url of issue.prUrls ?? []) {
      try {
        const body = await githubPrBody(url, token);
        if (body !== null) bodies.push({ body });
      } catch {
        /* fail-soft: skip this PR */
      }
    }
    issue.linkedPRs = bodies;
  }
  return issues;
}

function report(suspects, { sinceDays, signalBSkipped }) {
  const lines = [];
  lines.push('# Premature-close detector (OSE-1250 Tier 2)');
  lines.push('');
  lines.push(`Window: Done issues completed in the last ${sinceDays} day(s).`);
  if (signalBSkipped) lines.push('> Signal B (PR-body closing check) SKIPPED — no GITHUB_TOKEN.');
  lines.push('');
  if (suspects.length === 0) {
    lines.push('✅ No prematurely-closed issues detected.');
  } else {
    lines.push(`🔴 ${suspects.length} suspected premature close(s):`);
    lines.push('');
    for (const s of suspects) {
      lines.push(`- **${s.identifier}** — ${s.title}`);
      for (const r of s.reasons) lines.push(`  - ${r}`);
      if (s.url) lines.push(`  - ${s.url}`);
    }
  }
  console.log(lines.join('\n'));
}

function runSelfTest() {
  const cases = [
    [
      'A: Done with an open child → suspect',
      [
        {
          identifier: 'OSE-946',
          title: 'epic',
          children: [{ stateType: 'started' }],
          linkedPRs: [],
        },
      ],
      1,
    ],
    [
      'clean: Done, children done, PR closes it',
      [
        {
          identifier: 'OSE-1',
          title: 't',
          children: [{ stateType: 'completed' }],
          linkedPRs: [{ body: 'Closes OSE-1' }],
        },
      ],
      0,
    ],
    [
      'B: Done, PR body only "Part of" → suspect',
      [
        {
          identifier: 'OSE-1172',
          title: 't',
          children: [],
          linkedPRs: [{ body: 'Part of OSE-1172' }],
        },
      ],
      1,
    ],
    [
      'clean: Done, no children, no linked PR (manual)',
      [{ identifier: 'OSE-2', title: 't', children: [], linkedPRs: [] }],
      0,
    ],
    [
      'clean: one of several PRs closes it',
      [
        {
          identifier: 'OSE-3',
          title: 't',
          children: [],
          linkedPRs: [{ body: 'Part of OSE-3' }, { body: 'Closes OSE-3' }],
        },
      ],
      0,
    ],
    [
      'B: closing word but wrong id → suspect',
      [{ identifier: 'OSE-4', title: 't', children: [], linkedPRs: [{ body: 'Closes OSE-999' }] }],
      1,
    ],
    [
      'A+B both → still one suspect entry',
      [
        {
          identifier: 'OSE-5',
          title: 't',
          children: [{ stateType: 'backlog' }],
          linkedPRs: [{ body: 'Refs OSE-5' }],
        },
      ],
      1,
    ],
  ];
  let failed = 0;
  for (const [name, input, expectedCount] of cases) {
    const got = classify(input).length;
    const pass = got === expectedCount;
    if (!pass) failed++;
    console.log(
      `${pass ? 'PASS' : 'FAIL'} — ${name} (expected ${expectedCount} suspect(s), got ${got})`
    );
  }
  if (failed > 0) {
    console.error(`\nself-test: ${failed} case(s) failed.`);
    process.exit(1);
  }
  console.log(`\nself-test: all ${cases.length} cases passed.`);
}

// ── entrypoint ────────────────────────────────────────────────────────────────
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('detect-premature-close.mjs');
if (isMain) {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
  } else {
    (async () => {
      const sinceIdx = process.argv.indexOf('--since-days');
      const sinceDays = sinceIdx !== -1 ? Number(process.argv[sinceIdx + 1]) : 7;
      const apiKey = process.env.LINEAR_API_KEY;
      const teamId = process.env.LINEAR_TEAM_ID;
      const token = process.env.GITHUB_TOKEN;
      if (!apiKey || !teamId) {
        console.log('LINEAR_API_KEY or LINEAR_TEAM_ID not set — skipping detector (no-op).');
        process.exit(0);
      }
      const raw = await linearDoneIssues({ apiKey, teamId, sinceDays });
      const enriched = await enrichWithPrBodies(raw, token);
      const suspects = classify(enriched);
      report(suspects, { sinceDays, signalBSkipped: !token });
      process.exit(suspects.length > 0 ? 1 : 0);
    })();
  }
}
