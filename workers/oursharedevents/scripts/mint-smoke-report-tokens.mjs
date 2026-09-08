#!/usr/bin/env node
/**
 * Mint the SMOKE_RPT_* SharedReport signed-link tokens for the T4f depth E2E
 * (`tests/e2e/3-flows/sharedreport-depth.spec.ts`). OSE-834 P1 helper.
 *
 * BOUNDARY: this script only PRINTS tokens to stdout. It sets no secret, calls
 * no API, and touches no CI/Doppler/GitHub state. YOU (the owner) run it with the
 * real signing secret in your own shell and store the outputs via Doppler. The
 * agent never mints access tokens or writes auth secrets.
 *
 * It reproduces `mintSignedLinkToken` from `src/lib/shared-report-auth.ts`
 * byte-for-byte: token = base64url(JSON payload) + "." + hex(HMAC-SHA256(payloadB64)).
 * HMAC-SHA256 and base64url are standard, so node:crypto here == Web Crypto in the
 * worker for the same (secret, payload). Match the source if that file changes.
 *
 * Usage (all inputs via env — never hardcode the secret):
 *
 *   SHARED_REPORT_SIGNING_SECRET="$(doppler secrets get SHARED_REPORT_SIGNING_SECRET --plain --config stg)" \
 *   EVENT_ID=evt_smoke_tiers \
 *   node scripts/mint-smoke-report-tokens.mjs
 *
 * Env:
 *   SHARED_REPORT_SIGNING_SECRET  (required, >= 32 chars) — the STAGING secret the
 *                                 worker verifies with. Tokens minted with any other
 *                                 value will 401.
 *   EVENT_ID        target event id (default: SMOKE_EVENT_POST env, else evt_smoke_tiers).
 *                   Must equal the SMOKE_EVENT_POST the T4f workflow step passes.
 *   OTHER_EVENT_ID  a DIFFERENT seeded event (default: evt_smoke_pre) — for the
 *                   cross-event-rejection case.
 *   SPONSOR_ID      sponsor scope for the local token (default: sp_test).
 *   TTL_SECONDS     token lifetime (default: 7 days). Keep short; re-mint on expiry.
 */
import crypto from 'node:crypto';

const secret = (process.env.SHARED_REPORT_SIGNING_SECRET || '').trim();
if (!secret) {
  console.error('ERROR: SHARED_REPORT_SIGNING_SECRET is required (the staging signing secret, >= 32 chars).');
  process.exit(1);
}
if (secret.length < 32) {
  console.error(`ERROR: SHARED_REPORT_SIGNING_SECRET must be >= 32 chars (got ${secret.length}).`);
  process.exit(1);
}

const eventId = process.env.EVENT_ID || process.env.SMOKE_EVENT_POST || 'evt_smoke_tiers';
const otherEventId = process.env.OTHER_EVENT_ID || 'evt_smoke_pre';
const sponsorId = process.env.SPONSOR_ID || 'sp_test';
const ttl = Number(process.env.TTL_SECONDS || 7 * 24 * 60 * 60);
if (!Number.isFinite(ttl) || ttl <= 0) {
  console.error(`ERROR: TTL_SECONDS must be a positive number (got ${process.env.TTL_SECONDS}).`);
  process.exit(1);
}
const exp = Math.floor(Date.now() / 1000) + ttl;

// base64url of the UTF-8 payload, no padding — mirrors base64UrlEncode().
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');

/** claim key order mirrors shared-report-auth.ts: eventId, role, exp, depth?, sponsor_id? */
function mint(eventId_, role, opts = {}) {
  const claim = {
    eventId: eventId_,
    role,
    exp,
    ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
    ...(opts.sponsor_id !== undefined ? { sponsor_id: opts.sponsor_id } : {}),
  };
  const payloadB64 = b64url(JSON.stringify(claim));
  const sig = crypto.createHmac('sha256', secret).update(payloadB64, 'utf8').digest('hex');
  return `${payloadB64}.${sig}`;
}

const tokens = {
  // admin → premium depth (full report)
  SMOKE_RPT_ADMIN_TOKEN: mint(eventId, 'admin'),
  // sponsor @ local, scoped to a sponsor id
  SMOKE_RPT_LOCAL_TOKEN: mint(eventId, 'sponsor', { depth: 'local', sponsor_id: sponsorId }),
  // sponsor @ mid (per the spec's mint contract, no sponsor scope)
  SMOKE_RPT_MID_TOKEN: mint(eventId, 'sponsor', { depth: 'mid' }),
  // a valid token for a DIFFERENT event → must be rejected against EVENT_ID
  SMOKE_RPT_OTHER_EVENT_TOKEN: mint(otherEventId, 'admin'),
};

for (const [name, tok] of Object.entries(tokens)) console.log(`${name}=${tok}`);

// diagnostics go to stderr so `... | ...` piping stdout stays clean
console.error(
  `\n# minted for EVENT_ID="${eventId}", OTHER_EVENT_ID="${otherEventId}", sponsor="${sponsorId}"` +
    `\n# exp=${new Date(exp * 1000).toISOString()} (ttl ${ttl}s) — re-mint before this passes.` +
    `\n# store these via Doppler (staging config); do NOT paste secrets into chat or 'gh secret set'.`
);
