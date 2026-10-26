/**
 * Which workflow jobs can hand a secret to a branch push (OSE-1695).
 *
 * On a `push`, GitHub runs the workflow file that is on the pushed branch, so anyone with write
 * access can push a branch with an edited workflow and read every repository secret a job on that
 * trigger can see. A job that uses a credential must therefore not be triggered by a push to any
 * branch except main.
 *
 * Pure functions over an already-parsed workflow document, so the rule can be unit-tested and
 * mutation-tested (StrykerJS) without touching the file system. The test that applies it to the
 * real workflows is tests/unit/ci/no-secret-on-branch-push.test.js.
 *
 * The rule is safe by default: every secret is protected unless it is on SAFE_ON_ANY_BRANCH_PUSH.
 * Out of scope: pull_request exposure (scripts/check-pr-secret-exposure.mjs models that), tag
 * pushes, and schedule or manual runs.
 */

/**
 * Secrets that may be used on a push to any branch.
 * GITHUB_TOKEN is minted per run and scoped by the workflow's permissions block.
 * OCR_HUB_READ is a fine-grained, read-only token for the hub repository; that it really cannot
 * write is proven weekly by hub-read-token-check.yml.
 * This list must only ever shrink or stay the same; adding to it needs a reason in review.
 */
export const SAFE_ON_ANY_BRANCH_PUSH = new Set(['GITHUB_TOKEN', 'OCR_HUB_READ']);

/**
 * The branch patterns a push trigger accepts, or null if the workflow has no push trigger.
 * An empty list means a push trigger that names only tags.
 */
export function pushBranchPatterns(doc) {
  // YAML 1.1 parsers turn a bare `on:` key into the boolean true.
  const on = doc.on ?? doc[true];
  if (on === undefined || on === null) return null;
  let push;
  if (typeof on === 'string') push = on === 'push' ? {} : null;
  else if (Array.isArray(on)) push = on.includes('push') ? {} : null;
  else push = 'push' in on ? (on.push ?? {}) : null;
  if (push === null) return null;
  if (Array.isArray(push.branches)) return push.branches;
  if (Array.isArray(push['branches-ignore'])) {
    return ['(every branch except ' + push['branches-ignore'].join(', ') + ')'];
  }
  // No `branches` key: a push to ANY branch still triggers, unless the trigger names only tags.
  if (Array.isArray(push.tags) && !push.paths && !push['paths-ignore']) return [];
  return ['(every branch)'];
}

/** The secrets a job references, by name. */
export function secretsOfJob(job) {
  const text = JSON.stringify(job);
  return [...new Set([...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))];
}

/** One line per job that uses a protected secret in a workflow a branch push can trigger. */
export function exposures(name, doc) {
  const branches = pushBranchPatterns(doc);
  if (!branches) return [];
  const beyondMain = branches.filter((b) => b !== 'main');
  if (beyondMain.length === 0) return [];
  const found = [];
  for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
    const protectedSecrets = secretsOfJob(job).filter((s) => !SAFE_ON_ANY_BRANCH_PUSH.has(s));
    if (protectedSecrets.length > 0) {
      found.push(
        `${name}: job "${jobName}" uses ${protectedSecrets.join(', ')} and a push to ${beyondMain.join(', ')} triggers it`,
      );
    }
  }
  return found;
}
