#!/usr/bin/env node
// CI failure triage: fixed rules, no model ("classify_ci" in
// docs/ccr-archive/CCR-CLAUDE-USAGE-OPTIMIZATION-2026-10-11.md).
//
// A failed pipeline run usually shows several red jobs, and most of them are
// red only because something upstream failed (a gate summary, the reconciler).
// This names the root job, says what kind of failure it is and what to do
// next, so nobody has to read the logs to find that out.
//
//   node scripts/ci/classify-ci-failure.mjs --run-id 38178407459 [--repo owner/name] [--json]
//   node scripts/ci/classify-ci-failure.mjs --file failed-jobs.json [--json]
//
// --file takes [{ job, step, messages: [..] }] (failed jobs only). --run-id
// builds that list with gh: the failed jobs, each one's first failed step and
// its failure annotations. Read-only.
//
// Rules were written from the nine failed runs of 2026-10-11 and 12 and the
// flakes recorded in docs/brain/ROLE-STATE.md. An unmatched failure is
// "unknown": it is never guessed at.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// kind: 'cascade' is never a root cause. Order matters: first match wins.
// Each rule sees { job, step, text } where text is the annotations joined.
export const RULES = [
  {
    cls: 'cascade',
    why: 'a gate summary: red only because one of its parts failed or was cancelled',
    next: 'Ignore this job; fix the root job below.',
    test: (f) => /(sub-gates|functional legs|sections?) failed or were cancelled/i.test(f.text),
  },
  {
    cls: 'cascade',
    why: 'the gate-execution reconciler: an expected gate did not run to success',
    next: 'Ignore this job when another job is the root; if it is alone, a gate was skipped.',
    test: (f) => /Gate-execution reconciler/i.test(f.job),
  },
  {
    cls: 'secret-scan',
    why: 'the committed-secret gate found a string it does not know',
    next: 'Remove the secret-shaped literal, or mark a non-secret line with "# pragma: allowlist secret". Do not re-baseline from Windows (it under-detects).',
    test: (f) => /detect-secrets|gitleaks/i.test(f.step) || /detect-secrets found secret/i.test(f.text),
  },
  {
    cls: 'ratchet',
    why: 'a ratchet that may only shrink went up',
    next: 'Remove the new skip, continue-on-error or orphan spec. Do not raise the baseline.',
    test: (f) => /> baseline \d+/.test(f.text) || /may only shrink|baseline raised/i.test(f.text),
  },
  {
    cls: 'infra',
    why: 'network, runner or third-party trouble, not this change',
    next: 'Re-run the failed jobs once. If it repeats, treat it as real.',
    test: (f) =>
      /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|Temporary failure resolving|archive\.ubuntu\.com|Could not connect to|503 Service Unavailable|502 Bad Gateway|runner has received a shutdown signal|No space left on device|lost communication with the server|cf-mitigated|Just a moment\.\.\./i.test(
        f.text,
      ),
  },
  {
    cls: 'staging-setup',
    why: 'a staging fixture or seed step failed before any test ran',
    next: 'Check staging state and the seed step; the tests after it did not run ("No test report files were found" is the symptom).',
    test: (f) => /^Seed /i.test(f.step) || /No test report files were found/i.test(f.text),
  },
  {
    cls: 'lint',
    why: 'a lint or static check failed',
    next: 'Run the named check locally and fix what it reports.',
    test: (f) => /^Lint\b|eslint|typecheck|tsc\b/i.test(f.step),
  },
  {
    cls: 'test',
    why: 'a test failed',
    next: 'Open this job, read the failing test names, and reproduce locally (npm test, npm run test:arch, or the Playwright spec named).',
    test: (f) =>
      /Run T0 test section|vitest|Playwright|Bruno|Journey|Smoke|T[0-9][a-z]?:|invariants?/i.test(f.step) ||
      /^T[0-9] (Tests|Smoke|Contract|Functional) \(/.test(f.job),
  },
];

// Higher needs attention first. Cascade is never the headline.
const RANK = { 'secret-scan': 6, ratchet: 5, test: 4, lint: 4, unknown: 3, 'staging-setup': 2, infra: 1, cascade: 0 };

export function classify(failed) {
  const jobs = failed.map((raw) => {
    const f = { job: String(raw.job ?? ''), step: String(raw.step ?? ''), text: (raw.messages ?? []).join('\n') };
    const rule = RULES.find((r) => r.test(f));
    return rule
      ? { job: f.job, step: f.step, class: rule.cls, why: rule.why, next: rule.next }
      : { job: f.job, step: f.step, class: 'unknown', why: 'no rule matches', next: 'Read this job\'s log; if it is a new kind of failure, add a rule.' };
  });
  const roots = jobs.filter((j) => j.class !== 'cascade');
  // A run whose only red jobs are cascades has lost its root (cancelled or skipped upstream).
  const headline = roots.length ? roots.reduce((a, b) => (RANK[b.class] > RANK[a.class] ? b : a)) : null;
  return {
    class: headline ? headline.class : jobs.length ? 'cascade-only' : 'none',
    root: headline ? headline.job : null,
    roots,
    cascades: jobs.filter((j) => j.class === 'cascade').map((j) => j.job),
  };
}

function fromRun(runId, repo) {
  const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' });
  const repoArgs = repo ? ['-R', repo] : [];
  const jobs = JSON.parse(gh(['run', 'view', String(runId), ...repoArgs, '--json', 'jobs'])).jobs.filter(
    (j) => j.conclusion === 'failure',
  );
  const slug = repo || JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
  return jobs.map((j) => {
    let messages = [];
    try {
      messages = JSON.parse(gh(['api', `repos/${slug}/check-runs/${j.databaseId}/annotations`]))
        .filter((a) => a.annotation_level === 'failure')
        .map((a) => a.message);
    } catch {
      // Annotations are a refinement; the job and step names still classify.
    }
    const step = (j.steps || []).find((s) => s.conclusion === 'failure');
    return { job: j.name, step: step ? step.name : '', messages };
  });
}

function render(r) {
  if (r.class === 'none') return 'No failed jobs.\n';
  const lines = [];
  if (r.class === 'cascade-only') {
    lines.push('Only gate summaries are red: the root job was cancelled or skipped. Look for a cancelled or skipped job upstream.');
  } else {
    lines.push(`Root: ${r.root}  [${r.class}]`);
    for (const j of r.roots) {
      lines.push(`  - ${j.job}${j.step ? ` > ${j.step}` : ''}`);
      lines.push(`    ${j.class}: ${j.why}`);
      lines.push(`    Next: ${j.next}`);
    }
  }
  if (r.cascades.length) lines.push(`Ignore (red only as a consequence): ${r.cascades.join('; ')}`);
  return lines.join('\n') + '\n';
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/ci/classify-ci-failure.mjs')) {
  const argv = process.argv.slice(2);
  const at = (flag) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);
  let failed;
  if (at('--file')) failed = JSON.parse(readFileSync(at('--file'), 'utf8'));
  else if (at('--run-id')) failed = fromRun(at('--run-id'), at('--repo'));
  else {
    process.stderr.write('usage: classify-ci-failure.mjs --run-id <id> [--repo owner/name] | --file <failed-jobs.json>  [--json]\n');
    process.exit(2);
  }
  const result = classify(failed);
  process.stdout.write(argv.includes('--json') ? JSON.stringify(result, null, 2) + '\n' : render(result));
}
