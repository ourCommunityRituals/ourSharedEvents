#!/usr/bin/env node
/**
 * The decisions of the street-map archive load
 * (.github/workflows/street-map-archive-load.yml, docs/runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md).
 *
 * The workflow cuts the United States archive on a runner, checks it and loads
 * it into the staging bucket. Each point where it may stop is a pure function
 * here, so each is tested on the fault that must stop a run
 * (tests/unit/ci/street-map-archive-load.test.js). Every one fails closed: what
 * it cannot read counts as a problem, never as a pass.
 *
 *   names    the build, key and bucket the workflow names are the ones wrangler.toml binds
 *   private  the bucket has no r2.dev URL and no custom domain (wrangler's two reads)
 *   fits     the size `pmtiles extract --dry-run` reports fits the runner's free disk
 *   absent   the bucket does not hold the key yet (an object is never overwritten)
 *   loaded   the bucket lists the key at the byte size in the check record
 *   summary  size and SHA-256 from the check record, for the job summary
 *
 * It reads files and environment variables only. It holds no credential, calls
 * no network and uploads nothing: the workflow's own steps do that.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WRANGLER_PATH = 'workers/oursharedevents/wrangler.toml';

/** The archive is the United States subset of one dated Protomaps build. */
const KEY = /^us-(\d{8})\.pmtiles$/;

/**
 * The names wrangler.toml binds: the staging bucket and the archive key both
 * environment blocks read. A name it cannot find is undefined.
 */
export function boundNames(tomlText) {
  const stgAt = tomlText.search(/^\[env\.staging\]/m);
  const prodAt = tomlText.search(/^\[env\.production\]/m);
  if (stgAt === -1 || prodAt === -1 || prodAt < stgAt) return {};
  const stg = tomlText.slice(stgAt, prodAt);
  const prod = tomlText.slice(prodAt);
  const key = /^MAP_TILES_ARCHIVE = "([^"]*)"\r?$/m;
  return {
    bucket:
      /^\[\[env\.staging\.r2_buckets\]\]\r?\nbinding = "MAP_TILES"\r?\nbucket_name = "([^"]*)"/m.exec(
        stg
      )?.[1],
    key: key.exec(stg)?.[1],
    productionKey: key.exec(prod)?.[1],
  };
}

/**
 * What does not agree between the names the workflow carries and wrangler.toml,
 * as sentences. `named` is { build, key, bucket } from the workflow's env.
 */
export function nameProblems(named, tomlText) {
  const out = [];
  const bound = boundNames(tomlText);
  if (bound.bucket === undefined) return ['wrangler.toml: staging has no MAP_TILES bucket_name'];
  if (bound.key === undefined) return ['wrangler.toml: staging has no MAP_TILES_ARCHIVE'];
  const build = KEY.exec(named.key ?? '')?.[1];
  if (!build) out.push(`the key "${named.key}" is not us-YYYYMMDD.pmtiles`);
  else if (build !== named.build) {
    out.push(`the key "${named.key}" is not cut from build "${named.build}"`);
  }
  if (named.key !== bound.key) {
    out.push(`the workflow loads "${named.key}", the Worker reads "${bound.key}"`);
  }
  if (bound.productionKey !== bound.key) {
    out.push(
      `wrangler.toml reads "${bound.key}" on staging and "${bound.productionKey}" on production`
    );
  }
  if (named.bucket !== bound.bucket) {
    out.push(`the workflow loads into "${named.bucket}", staging binds "${bound.bucket}"`);
  }
  if (!/-staging$/.test(named.bucket ?? '')) {
    out.push(`"${named.bucket}" is not a staging bucket: this workflow loads staging only`);
  }
  return out;
}

/** wrangler 4.158.0, src/r2/public-dev-url.ts and src/r2/domain.ts: the two answers that mean private. */
export const DEV_URL_OFF = 'Public access via the r2.dev URL is disabled.';
export const NO_DOMAINS = 'There are no custom domains connected to this bucket.';

/**
 * What is wrong with the bucket's two privacy reads, as sentences. Only the
 * exact sentence wrangler prints for "off" passes; an error, an empty answer or
 * a reworded one is a problem.
 */
export function privacyProblems(devUrlOutput, domainListOutput) {
  const out = [];
  if (!String(devUrlOutput ?? '').includes(DEV_URL_OFF)) {
    out.push(`the r2.dev public URL is not reported off (expected "${DEV_URL_OFF}")`);
  }
  if (!String(domainListOutput ?? '').includes(NO_DOMAINS)) {
    out.push(`a custom domain is connected, or the list was not read (expected "${NO_DOMAINS}")`);
  }
  return out;
}

const UNIT = { B: 1, kB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, PB: 1e15, EB: 1e18 };

/**
 * The archive size `pmtiles extract --dry-run` prints, or null. go-pmtiles
 * v1.31.2 (pmtiles/extract.go) ends with
 *   "Extract transferred 22 GB (overfetch 0.05) for an archive size of 21 GB"
 * where the size is the tile data alone, rounded by go-humanize: one decimal
 * below 10 of a unit, a whole number above. `upperBytes` is the largest size
 * that rounds to what was printed.
 */
export function parseDryRunSize(log) {
  const all = [
    ...String(log ?? '').matchAll(
      /for an archive size of (\d+)(\.\d)? ?(B|kB|MB|GB|TB|PB|EB)\s*$/gm
    ),
  ];
  const m = all.at(-1);
  if (!m) return null;
  const unit = UNIT[m[3]];
  const text = `${m[1]}${m[2] ?? ''} ${m[3]}`;
  // Whole numbers throughout: 9.4 + 0.05 is not 9.45 in floating point, and a
  // byte count must not depend on which way that error falls.
  const hundredths = Number(m[1]) * 100 + Number(m[2]?.slice(1) ?? 0) * 10;
  if (unit === 1) {
    // Bytes are printed exactly, and never with a decimal.
    return m[2] ? null : { text, bytes: hundredths / 100, upperBytes: hundredths / 100 };
  }
  // One decimal was rounded at the next digit (0.05); a whole number was rounded
  // twice, to a tenth and then to a unit (0.55).
  const slack = m[2] ? 5 : 55;
  return {
    text,
    bytes: hundredths * (unit / 100),
    upperBytes: (hundredths + slack) * (unit / 100),
  };
}

/**
 * Whether the cut fits. Needed: the largest size the dry run can mean, plus the
 * larger of 1 GB and 5% for what it leaves out (the new directories, the
 * metadata, the check record).
 */
export function diskVerdict(size, freeBytes) {
  const free = Number(freeBytes);
  if (!size) return { fits: false, reason: 'the dry run printed no archive size' };
  if (!Number.isFinite(free) || free <= 0) {
    return { fits: false, reason: `the free disk was not read ("${freeBytes}")` };
  }
  const need = size.upperBytes + Math.max(1e9, Math.ceil(size.upperBytes * 0.05));
  return {
    fits: free >= need,
    need,
    free,
    reason:
      free >= need
        ? `the cut needs ${gb(need)} and the runner has ${gb(free)} free`
        : `the cut needs ${gb(need)} and the runner has ${gb(free)} free: it does not fit this runner`,
  };
}

const gb = (bytes) => `${(bytes / 1e9).toFixed(1)} GB`;

/**
 * The object `rclone lsjson` lists under `key`, or null. Throws when the
 * listing is not a JSON array: a listing that cannot be read is not an empty one.
 */
export function listedObject(lsjsonText, key) {
  const list = JSON.parse(lsjsonText);
  if (!Array.isArray(list)) throw new Error('the bucket listing is not a list');
  const found = list.find((o) => o && o.Path === key && o.IsDir !== true);
  return found ? { size: found.Size } : null;
}

/** Why the key may not be uploaded, as sentences: an object is never overwritten. */
export function overwriteProblems(lsjsonText, key) {
  let found;
  try {
    found = listedObject(lsjsonText, key);
  } catch (e) {
    return [
      `the bucket listing could not be read (${e.message}), so the key is not known to be free`,
    ];
  }
  return found
    ? [
        `the bucket already holds "${key}" (${found.size} bytes). An object is never overwritten: cut another build under its own dated key, or have the owner remove the object first`,
      ]
    : [];
}

/** Why the load is not confirmed, as sentences. `record` is the check's `.check.json`. */
export function loadProblems(lsjsonText, record, key) {
  const out = [];
  if (!record || record.pass !== true) out.push('the check record does not say the file passed');
  if (record?.file !== key) out.push(`the check record is for "${record?.file}", not "${key}"`);
  if (!Number.isSafeInteger(record?.bytes) || record.bytes <= 0) {
    out.push(`the check record has no byte size ("${record?.bytes}")`);
  }
  if (!/^[0-9a-f]{64}$/.test(record?.sha256 ?? '')) out.push('the check record has no SHA-256');
  let found;
  try {
    found = listedObject(lsjsonText, key);
  } catch (e) {
    return [...out, `the bucket listing could not be read (${e.message})`];
  }
  if (!found) out.push(`the bucket does not list "${key}"`);
  else if (found.size !== record?.bytes) {
    out.push(
      `the bucket lists "${key}" at ${found.size} bytes; the check record says ${record?.bytes}: the upload stopped early, or another file is under this name`
    );
  }
  return out;
}

/** Size and SHA-256 from the check record, as job-summary Markdown. */
export function summaryMarkdown(record, { bucket, build, state }) {
  return [
    `### Street-map archive: ${state}`,
    '',
    '| What | Value |',
    '| --- | --- |',
    `| Object key | \`${record.file}\` |`,
    `| Bucket | \`${bucket}\` |`,
    `| Protomaps build | \`${build}\` |`,
    `| Bytes | \`${record.bytes}\` (${gb(record.bytes)}) |`,
    `| SHA-256 | \`${record.sha256}\` |`,
    `| Check | ${record.pass === true ? 'PASS' : 'PROBLEMS'} |`,
    `| Reader commit | \`${record.readerCommit ?? 'unknown'}\` |`,
    '',
  ].join('\n');
}

// ─── Command line (the workflow's steps) ─────────────────────────────────────

function say(markdown) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

/** Print each problem as a workflow error and return the exit code. */
function stop(problems, ok) {
  for (const p of problems) console.log(`::error::${p}`);
  if (problems.length === 0) console.log(ok);
  return problems.length === 0 ? 0 : 1;
}

function named() {
  return {
    build: process.env.PROTOMAPS_BUILD,
    key: process.env.ARCHIVE_KEY,
    bucket: process.env.BUCKET,
  };
}

const COMMANDS = {
  names() {
    const n = named();
    return stop(
      nameProblems(n, readFileSync(join(ROOT, WRANGLER_PATH), 'utf8')),
      `Build ${n.build}, key ${n.key}, bucket ${n.bucket}: the names wrangler.toml binds.`
    );
  },
  private([devUrl, domains]) {
    return stop(
      privacyProblems(readFileSync(devUrl, 'utf8'), readFileSync(domains, 'utf8')),
      `${named().bucket} has no r2.dev URL and no custom domain.`
    );
  },
  fits([log, free]) {
    const size = parseDryRunSize(readFileSync(log, 'utf8'));
    const verdict = diskVerdict(size, free);
    say(
      [
        '### Street-map archive: size before the cut',
        '',
        `- \`pmtiles extract --dry-run\` reports an archive of **${size?.text ?? 'unknown size'}** (tile data, rounded) for build \`${named().build}\`.`,
        `- ${verdict.reason}.`,
        '',
      ].join('\n')
    );
    return stop(verdict.fits ? [] : [verdict.reason], 'The cut fits.');
  },
  absent([listing]) {
    const key = named().key;
    return stop(
      overwriteProblems(readFileSync(listing, 'utf8'), key),
      `${named().bucket} does not hold ${key} yet.`
    );
  },
  loaded([listing, recordFile]) {
    const n = named();
    const record = JSON.parse(readFileSync(recordFile, 'utf8'));
    const problems = loadProblems(readFileSync(listing, 'utf8'), record, n.key);
    if (problems.length === 0) {
      say(summaryMarkdown(record, { ...n, state: 'loaded, and listed at the checked size' }));
    }
    return stop(problems, `${n.bucket} lists ${n.key} at ${record.bytes} bytes.`);
  },
  summary([recordFile]) {
    const record = JSON.parse(readFileSync(recordFile, 'utf8'));
    say(summaryMarkdown(record, { ...named(), state: 'checked, not loaded yet' }));
    return 0;
  },
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [command, ...args] = process.argv.slice(2);
  if (!Object.hasOwn(COMMANDS, command ?? '')) {
    console.error(
      `Usage: node scripts/ci/street-map-archive-load.mjs <${Object.keys(COMMANDS).join('|')}> [files]`
    );
    process.exitCode = 1;
  } else {
    try {
      process.exitCode = COMMANDS[command](args);
    } catch (e) {
      // A file that is missing or is not JSON is a stop, not a pass.
      console.log(`::error::${command}: ${e.message}`);
      process.exitCode = 1;
    }
  }
}
