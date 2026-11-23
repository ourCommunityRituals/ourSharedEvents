#!/usr/bin/env node
/**
 * The weekly client test site, test.oursharedevents.com (OSE-2211).
 *
 * Helpers for .github/workflows/client-test-site.yml and client-test-setup.yml.
 * The pure parts are exported for tests/unit/ci/client-test-site.test.js; the
 * CLI parts call the GitHub API (GITHUB_TOKEN) or read wrangler/Cloudflare output
 * that the workflow pipes in. Nothing here prints a secret: it reads ids and
 * names only.
 *
 *   node scripts/ci/client-test-site.mjs pick
 *       Prints the newest main commit whose post-merge staging chain had all four
 *       staging jobs (T1 to T4) succeed. Needs GITHUB_TOKEN and GITHUB_REPOSITORY.
 *       PICK_SHA, when set, narrows the choice to that one commit.
 *
 *   node scripts/ci/client-test-site.mjs resolve-ids <toml> <d1.json> <kv.json>
 *       Writes each "set-by-setup" id in the test site's wrangler file, looked up
 *       by its database name or namespace title. Fails if any is missing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CI_WORKFLOW_FILE = 'oursharedevents-ci.yml';

/** The four staging jobs that must all be green (AGENTS.md, Definition of Done). */
export const STAGING_CHAIN_JOBS = [
  'T1 Deploy → Staging',
  'T2 Contract → Staging (Bruno)',
  'T3 E2E Smoke → Staging (Playwright)',
  'T4 Functional → Staging',
];

/** The placeholder id in workers/oursharedevents/wrangler.client-test.toml. */
export const PLACEHOLDER = 'set-by-setup';

/** The KV namespace title the setup job creates for RATE_LIMIT_KV. */
export const KV_TITLES = { RATE_LIMIT_KV: 'ose-rate-limit-test' };

/** Every name the setup job creates. One list, read by the setup workflow test. */
export const RESOURCES = {
  d1: ['ocr-db-test', 'ocr-forms-db-test'],
  kv: Object.values(KV_TITLES),
  r2: ['ose-uploads-test'],
};

/**
 * True when every staging chain job is present and succeeded.
 * @param {Array<{name: string, conclusion: string|null}>} jobs
 */
export function chainGreen(jobs) {
  return STAGING_CHAIN_JOBS.every((name) =>
    jobs.some((j) => j.name === name && j.conclusion === 'success')
  );
}

/**
 * The newest run whose staging chain is green.
 * @param {Array<{id: number, head_sha: string}>} runs newest first
 * @param {(id: number) => Promise<Array<{name: string, conclusion: string|null}>>} jobsOf
 * @param {(sha: string) => boolean | Promise<boolean>} [eligible] e.g. the commit has the test site's config
 * @returns {Promise<{sha: string, runId: number} | null>}
 */
export async function pickGreenSha(runs, jobsOf, eligible = () => true) {
  for (const run of runs) {
    if (!(await eligible(run.head_sha))) {
      continue;
    }
    if (chainGreen(await jobsOf(run.id))) {
      return { sha: run.head_sha, runId: run.id };
    }
  }
  return null;
}

/**
 * Fill the placeholder ids. Pure: takes the toml text and the two listings.
 * @param {string} toml
 * @param {Array<{name: string, uuid: string}>} d1 `wrangler d1 list --json`
 * @param {Array<{title: string, id: string}>} kv the Cloudflare KV namespace listing
 * @returns {{ text: string, missing: string[] }}
 */
export function resolveIds(toml, d1, kv) {
  const missing = [];
  let text = toml.replace(
    /(database_name = "([^"]+)"\r?\ndatabase_id = )"set-by-setup"/g,
    (whole, head, name) => {
      const db = d1.find((d) => d.name === name);
      if (!db?.uuid) {
        missing.push(`D1 database ${name}`);
        return whole;
      }
      return `${head}"${db.uuid}"`;
    }
  );
  text = text.replace(
    /(binding = "([A-Z_]+)"\r?\nid = )"set-by-setup"/g,
    (whole, head, binding) => {
      const title = KV_TITLES[binding];
      const ns = title && kv.find((n) => n.title === title);
      if (!ns?.id) {
        missing.push(`KV namespace ${title ?? binding}`);
        return whole;
      }
      return `${head}"${ns.id}"`;
    }
  );
  if (new RegExp(`^[a-z_]+ = "${PLACEHOLDER}"`, 'm').test(text) && missing.length === 0) {
    missing.push('an id this script does not know how to look up');
  }
  return { text, missing };
}

async function gh(path) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path}: HTTP ${res.status}`);
  return res.json();
}

async function cliPick() {
  const { workflow_runs: runs } = await gh(
    `/actions/workflows/${CI_WORKFLOW_FILE}/runs?branch=main&event=push&status=completed&per_page=40`
  );
  const jobsOf = async (id) => (await gh(`/actions/runs/${id}/jobs?per_page=100`)).jobs;
  // PICK_SHA (a hand-run update naming a commit) narrows the choice to that one
  // commit; it must still have a green staging chain. A commit from before the
  // test site existed has no config to deploy with.
  const wanted = (process.env.PICK_SHA ?? '').trim().toLowerCase();
  if (wanted && !/^[0-9a-f]{7,40}$/.test(wanted)) {
    console.error('::error::sha must be a commit id (7 to 40 hex characters).');
    process.exit(1);
  }
  const eligible = async (sha) => {
    if (wanted && !sha.startsWith(wanted)) return false;
    try {
      await gh(`/contents/workers/oursharedevents/wrangler.client-test.toml?ref=${sha}`);
      return true;
    } catch {
      return false;
    }
  };
  const picked = await pickGreenSha(runs, jobsOf, eligible);
  if (!picked) {
    console.error(
      wanted
        ? `::error::${wanted} is not among the last 40 main commits with a green staging chain (T1 to T4). Nothing deployed.`
        : '::error::No recent main commit has a green staging chain (T1 to T4). Nothing deployed; the site stays as it is.'
    );
    process.exit(1);
  }
  console.log(`sha=${picked.sha}`);
  console.log(`run_id=${picked.runId}`);
}

// The three paths are the workflow's own files, named in client-test-site.yml.
/* eslint-disable security/detect-non-literal-fs-filename */
function cliResolve([tomlPath, d1Path, kvPath]) {
  const d1 = JSON.parse(readFileSync(d1Path, 'utf8'));
  const kvRaw = JSON.parse(readFileSync(kvPath, 'utf8'));
  const kv = Array.isArray(kvRaw) ? kvRaw : (kvRaw.result ?? []);
  const { text, missing } = resolveIds(readFileSync(tomlPath, 'utf8'), d1, kv);
  if (missing.length) {
    console.error(
      `::error title=The test site is not set up::Missing: ${missing.join(', ')}. Run the "Client test site setup" workflow first (docs/runbooks/RUNBOOK-CLIENT-TEST-SITE.md).`
    );
    process.exit(1);
  }
  writeFileSync(tomlPath, text);
  console.log('Every database and namespace id was found by name.');
}
/* eslint-enable security/detect-non-literal-fs-filename */

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'pick') {
    cliPick().catch((err) => {
      console.error(`::error::${err.message}`);
      process.exit(1);
    });
  } else if (cmd === 'resolve-ids') {
    cliResolve(args);
  } else {
    console.error('usage: client-test-site.mjs pick | resolve-ids <toml> <d1.json> <kv.json>');
    process.exit(2);
  }
}
