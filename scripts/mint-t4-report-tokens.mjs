#!/usr/bin/env node
/**
 * mint-t4-report-tokens.mjs — mint the four T4f "SharedReport Depth Gate" tokens
 * at CI run time by calling the DEPLOYED worker (Part of OSE-1389).
 *
 * Replaces the retired offline signer (scripts/mint-smoke-rpt-tokens.mjs), which
 * re-implemented the HMAC signing and required SHARED_REPORT_SIGNING_SECRET in
 * its environment, then stashed 90-day tokens in GitHub secrets that silently
 * desynced from staging's live secret (the OSE-349 token-shadow family).
 *
 * This script signs NOTHING. It POSTs to the worker's admin mint route
 *   POST {BASE_URL}/api/v2/admin/events/:id/shared-report/mint-link
 * so SHARED_REPORT_SIGNING_SECRET never leaves the worker, and the tokens live
 * only ttl_days (default 1) — the CI run, not a 90-day window.
 *
 * Auth: the CF Access service token (CF-Access-Client-Id/Secret) clears the edge
 * and the app-level admin guard accepts Bearer ADMIN_KEY (+ X-OCR-Internal),
 * exactly as the other T4 admin steps authenticate.
 *
 * Outputs (appended to $GITHUB_ENV for the next step; each token also masked in
 * the log via ::add-mask::):
 *   SMOKE_RPT_ADMIN_TOKEN, SMOKE_RPT_LOCAL_TOKEN, SMOKE_RPT_MID_TOKEN,
 *   SMOKE_RPT_OTHER_EVENT_TOKEN, SMOKE_RPT_SPONSOR_ID
 *
 * SMOKE_RPT_SPONSOR_ID is the local token's sponsor — the depth spec's
 * slice-isolation test asserts the sponsor slice is scoped to exactly it.
 */

import fs from 'node:fs';

function die(msg) {
  console.error(`::error::mint-t4-report-tokens: ${msg}`);
  process.exit(1);
}

const BASE_URL = (process.env.BASE_URL ?? '').replace(/\/$/, '');
if (!BASE_URL) die('BASE_URL is required (the deployed staging origin).');

const ADMIN_KEY = process.env.ADMIN_KEY ?? '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL ?? '';
const CF_ID = process.env.CF_ACCESS_CLIENT_ID ?? '';
const CF_SECRET = process.env.CF_ACCESS_CLIENT_SECRET ?? '';
if (!ADMIN_KEY && !X_OCR_INTERNAL) {
  die('need ADMIN_KEY or X_OCR_INTERNAL to authenticate the mint call.');
}

// Seeded fixtures (sponsors-tiers-smoke.sql). The mint route 400s a sponsor_id
// that is not placed on the event, so these MUST be the real seeded ids.
const POST_EVENT = (process.env.SMOKE_EVENT_POST ?? 'evt_smoke_tiers').trim();
const OTHER_EVENT = (process.env.SMOKE_EVENT_OTHER ?? 'evt_smoke_other').trim();
const LOCAL_SPONSOR = (process.env.SMOKE_RPT_LOCAL_SPONSOR_ID ?? 'sp_tiers_local').trim();
const MID_SPONSOR = (process.env.SMOKE_RPT_MID_SPONSOR_ID ?? 'sp_tiers_mid').trim();
const TTL_DAYS = Number(process.env.SMOKE_RPT_TTL_DAYS ?? '1');
if (!Number.isInteger(TTL_DAYS) || TTL_DAYS < 1) die(`SMOKE_RPT_TTL_DAYS must be an integer >= 1, got ${process.env.SMOKE_RPT_TTL_DAYS}`);

if (OTHER_EVENT === POST_EVENT) {
  die(`SMOKE_EVENT_OTHER (${OTHER_EVENT}) must differ from SMOKE_EVENT_POST (${POST_EVENT}) — the wrong-event token proves the 403 path.`);
}

const authHeaders = {
  'Content-Type': 'application/json',
  ...(CF_ID ? { 'CF-Access-Client-Id': CF_ID } : {}),
  ...(CF_SECRET ? { 'CF-Access-Client-Secret': CF_SECRET } : {}),
  ...(ADMIN_KEY ? { Authorization: `Bearer ${ADMIN_KEY}` } : {}),
  ...(X_OCR_INTERNAL ? { 'X-OCR-Internal': X_OCR_INTERNAL } : {}),
};

async function mint(envName, eventId, body) {
  const url = `${BASE_URL}/api/v2/admin/events/${encodeURIComponent(eventId)}/shared-report/mint-link`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ ttl_days: TTL_DAYS, ...body }),
    });
  } catch (e) {
    die(`${envName}: network error minting against ${url} — ${e.message}`);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    die(`${envName}: mint returned non-JSON (HTTP ${res.status}) — ${text.slice(0, 200)}`);
  }
  if (!res.ok || !json.ok || typeof json.token !== 'string') {
    die(`${envName}: mint failed (HTTP ${res.status}, code=${json.code ?? '?'}) — ${json.error ?? text.slice(0, 200)}`);
  }
  return json.token;
}

// The four tokens the depth spec (tests/e2e/3-flows/sharedreport-depth.spec.ts)
// reads by env name. LOCAL/MID use real seeded sponsors on POST_EVENT.
const specs = [
  { name: 'SMOKE_RPT_ADMIN_TOKEN', event: POST_EVENT, body: { role: 'admin' } },
  { name: 'SMOKE_RPT_LOCAL_TOKEN', event: POST_EVENT, body: { role: 'sponsor', depth: 'local', sponsor_id: LOCAL_SPONSOR } },
  { name: 'SMOKE_RPT_MID_TOKEN', event: POST_EVENT, body: { role: 'sponsor', depth: 'mid', sponsor_id: MID_SPONSOR } },
  { name: 'SMOKE_RPT_OTHER_EVENT_TOKEN', event: OTHER_EVENT, body: { role: 'admin' } },
];

// Wrapped in an async main() so there is no top-level await (the scripts/
// eslint parser rejects it; Node runs it fine either way).
async function main() {
  const out = [];
  for (const s of specs) {
    const token = await mint(s.name, s.event, s.body);
    out.push([s.name, token]);
  }
  // The local token's sponsor is what the slice-isolation test asserts against.
  out.push(['SMOKE_RPT_SPONSOR_ID', LOCAL_SPONSOR]);

  const ghEnv = process.env.GITHUB_ENV;
  for (const [name, value] of out) {
    // Mask the token values in the CI log (SMOKE_RPT_SPONSOR_ID is not secret).
    if (name !== 'SMOKE_RPT_SPONSOR_ID') console.log(`::add-mask::${value}`);
    if (ghEnv) fs.appendFileSync(ghEnv, `${name}=${value}\n`);
  }

  console.log(
    ghEnv
      ? `✓ minted ${specs.length} SharedReport tokens (ttl ${TTL_DAYS}d) → $GITHUB_ENV; sponsor=${LOCAL_SPONSOR}`
      : `✓ minted ${specs.length} SharedReport tokens (ttl ${TTL_DAYS}d); GITHUB_ENV unset (local run) — not exported.`
  );
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
