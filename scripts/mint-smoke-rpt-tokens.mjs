#!/usr/bin/env node
/**
 * mint-smoke-rpt-tokens.mjs — re-mint the four T4f "SharedReport Depth Gate"
 * smoke tokens against staging's CURRENT signing secret.
 *
 * WHY THIS EXISTS
 * ---------------
 * T4f (tests/e2e/3-flows/sharedreport-depth.spec.ts) sends four pre-minted
 * bearer tokens (GitHub repo secrets SMOKE_RPT_*) to the staging
 * /api/v2/events/:id/shared-report endpoint. Each must be an HMAC-signed
 * signed-link token minted with the SAME SHARED_REPORT_SIGNING_SECRET the
 * staging Worker holds, and unexpired (mint TTL defaults to 7 days). When the
 * secret is rotated OR the tokens age past their TTL, verifySignedLinkToken()
 * returns null and EVERY token-bearing test gets 401 (fail-closed) — that is
 * the T4f red. This is an infra/secrets condition, not a code defect.
 *
 * MIRROR — KEEP IN SYNC (read this before editing the token logic)
 * ----------------------------------------------------------------
 * The mint/verify primitives below are a VERBATIM mirror of the canonical
 * implementation in:
 *     workers/oursharedevents/src/lib/shared-report-auth.ts
 * They are inlined (not imported) on purpose: the repo's Node baseline is 20
 * (.nvmrc, engines.node ">=20", every CI job pins node-version 20), and Node
 * < 22.6 cannot import a .ts file at runtime. Inlining keeps this runnable on
 * the repo baseline AND on newer Node. The token wire format
 * (`base64url(payload).hex(hmac_sha256)`) is a frozen contract — changing it
 * would break every existing signed link — and re-implementing these
 * primitives in tooling has precedent (tests/red-team/shared-report-theft.spec.ts).
 * If you ever change the canonical minter's payload shape, delimiter, or hash,
 * update this file to match. The mint→verify self-check below is the local
 * tripwire; staging's 401/200 is the authoritative one.
 *
 * SECURITY
 * --------
 * - The signing secret is read from the SHARED_REPORT_SIGNING_SECRET env var
 *   that YOU set in your own terminal. It is NEVER printed or written to disk.
 * - The four minted tokens ARE printed (they are the values you must store as
 *   repo secrets). They are ephemeral smoke-test tokens scoped to a staging
 *   fixture event + a single role/depth — not the master secret. The printed
 *   `gh secret set` commands omit --body so the token is pasted at gh's prompt
 *   (kept out of shell history / argv).
 *
 * USAGE (run in YOUR terminal, from the repo root — NOT in this chat)
 * ------------------------------------------------------------------
 *   # PowerShell:
 *   $env:SHARED_REPORT_SIGNING_SECRET = '<the value staging currently holds>'
 *   node scripts/mint-smoke-rpt-tokens.mjs
 *
 *   # bash:
 *   SHARED_REPORT_SIGNING_SECRET='<value>' node scripts/mint-smoke-rpt-tokens.mjs
 *
 * Optional overrides (env vars, all have sane defaults):
 *   SMOKE_EVENT_POST     event id the admin/local/mid tokens grant (default: evt_smoke_tiers)
 *   SMOKE_EVENT_OTHER    a DIFFERENT event id for the wrong-event token (default: evt_smoke_other)
 *   SMOKE_RPT_SPONSOR_ID sponsor_id claim on the LOCAL token (default: sp_test)
 *   SMOKE_RPT_TTL_DAYS   token lifetime in days (default: 90 — longer than the
 *                        7-day mint default so they don't re-expire mid-launch)
 *   SMOKE_RPT_REPO       GitHub repo for the printed gh commands
 *                        (default: ourCommunityRituals/ourSharedEvents)
 *
 * After running, trigger a FRESH full CI/CD run (not "re-run failed jobs" on a
 * canceled run) → T4f goes green → Stage-2 Security Finale runs.
 *
 * NOTE: the admin/local/mid tokens are scoped to SMOKE_EVENT_POST, which must
 * be a SEEDED post-event fixture in staging's D1. If T4f still returns 401
 * after this, the secret value used here != staging's. If it instead returns
 * non-200 with sections missing, the event fixture isn't seeded.
 *
 * Runtime deps: Node >= 20 only (globalThis.crypto.subtle, btoa/atob,
 * TextEncoder/TextDecoder are all stable in Node 20). No npm install needed.
 */

// ─── Canonical mirror: shared-report-auth.ts primitives (see MIRROR note) ────

const TOKEN_PARTS_DELIMITER = '.';

function base64UrlEncode(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const std = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}

const VALID_ROLES = ['bar_owner', 'sponsor', 'admin'];
const isValidRole = (s) => typeof s === 'string' && VALID_ROLES.includes(s);

async function mintSignedLinkToken(env, eventId, role, ttlSeconds, opts = {}) {
  const secret = env.SHARED_REPORT_SIGNING_SECRET?.trim();
  if (!secret) return null;
  const payload = {
    eventId,
    role,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
    ...(opts.sponsor_id !== undefined ? { sponsor_id: opts.sponsor_id } : {}),
  };
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSha256Hex(payloadB64, secret);
  return `${payloadB64}${TOKEN_PARTS_DELIMITER}${sig}`;
}

async function verifySignedLinkToken(env, token) {
  if (!token) return null;
  const secret = env.SHARED_REPORT_SIGNING_SECRET?.trim();
  if (!secret) return null;

  const parts = token.split(TOKEN_PARTS_DELIMITER);
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = await hmacSha256Hex(payloadB64, secret);
  if (!constantTimeEqual(expectedSig, sig)) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.eventId !== 'string' || payload.eventId.length === 0) return null;
  if (!isValidRole(payload.role)) return null;
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;

  return {
    eventId: payload.eventId,
    role: payload.role,
    exp: payload.exp,
    ...(typeof payload.depth === 'string' ? { depth: payload.depth } : {}),
    ...(typeof payload.sponsor_id === 'string' ? { sponsor_id: payload.sponsor_id } : {}),
  };
}

// ─── Script body ─────────────────────────────────────────────────────────────

// Throw rather than process.exit(): a hard exit while Web Crypto async handles
// are still open trips a libuv assertion on Windows (UV_HANDLE_CLOSING) and
// reports exit 127 instead of 1. main()'s catch sets process.exitCode and lets
// the event loop drain, which exits cleanly with the intended code.
class MintError extends Error {}
function die(msg) {
  throw new MintError(msg);
}

async function main() {
  const secret = (process.env.SHARED_REPORT_SIGNING_SECRET ?? '').trim();
  if (!secret) {
    die(
      'SHARED_REPORT_SIGNING_SECRET is not set.\n' +
        "  Set it to the value staging's Worker currently holds, then re-run.\n" +
        "  PowerShell:  $env:SHARED_REPORT_SIGNING_SECRET = '<value>'\n" +
        "  bash:        export SHARED_REPORT_SIGNING_SECRET='<value>'"
    );
  }

  const POST = (process.env.SMOKE_EVENT_POST ?? 'evt_smoke_tiers').trim();
  const OTHER = (process.env.SMOKE_EVENT_OTHER ?? 'evt_smoke_other').trim();
  const SPONSOR_ID = (process.env.SMOKE_RPT_SPONSOR_ID ?? 'sp_test').trim();
  const REPO = (process.env.SMOKE_RPT_REPO ?? 'ourCommunityRituals/ourSharedEvents').trim();

  const ttlDays = Number(process.env.SMOKE_RPT_TTL_DAYS ?? '90');
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
    die(`SMOKE_RPT_TTL_DAYS must be a positive number, got: ${process.env.SMOKE_RPT_TTL_DAYS}`);
  }
  const ttlSeconds = Math.floor(ttlDays * 24 * 60 * 60);

  if (OTHER === POST) {
    die(`SMOKE_EVENT_OTHER (${OTHER}) must differ from SMOKE_EVENT_POST (${POST}) — the wrong-event token proves the 403 path.`);
  }

  const env = { SHARED_REPORT_SIGNING_SECRET: secret };

  // name → mint args + expected claim shape (matches the T4f spec header exactly)
  const specs = [
    { name: 'SMOKE_RPT_ADMIN_TOKEN', event: POST, role: 'admin', opts: {} },
    { name: 'SMOKE_RPT_LOCAL_TOKEN', event: POST, role: 'sponsor', opts: { depth: 'local', sponsor_id: SPONSOR_ID } },
    { name: 'SMOKE_RPT_MID_TOKEN', event: POST, role: 'sponsor', opts: { depth: 'mid' } },
    { name: 'SMOKE_RPT_OTHER_EVENT_TOKEN', event: OTHER, role: 'admin', opts: {} },
  ];

  const minted = [];
  for (const spec of specs) {
    const token = await mintSignedLinkToken(env, spec.event, spec.role, ttlSeconds, spec.opts);
    if (!token) die(`mint returned null for ${spec.name} — signing secret unusable.`);

    // Round-trip against the SAME secret: proves the token this script emits is
    // exactly what verifySignedLinkToken() (and therefore the Worker) accepts.
    const claim = await verifySignedLinkToken(env, token);
    if (!claim) die(`self-verify FAILED for ${spec.name} — token does not verify against the given secret.`);
    if (claim.eventId !== spec.event) die(`self-verify FAILED for ${spec.name}: eventId ${claim.eventId} != ${spec.event}`);
    if (claim.role !== spec.role) die(`self-verify FAILED for ${spec.name}: role ${claim.role} != ${spec.role}`);
    if (spec.opts.depth !== undefined && claim.depth !== spec.opts.depth) {
      die(`self-verify FAILED for ${spec.name}: depth ${claim.depth} != ${spec.opts.depth}`);
    }
    if (spec.opts.sponsor_id !== undefined && claim.sponsor_id !== spec.opts.sponsor_id) {
      die(`self-verify FAILED for ${spec.name}: sponsor_id ${claim.sponsor_id} != ${spec.opts.sponsor_id}`);
    }

    minted.push({ ...spec, token, exp: claim.exp });
  }

  const expIso = new Date(minted[0].exp * 1000).toISOString();

  // Human summary → stderr (never contains the secret).
  console.error('');
  console.error(`✓ Minted & self-verified ${minted.length} SharedReport smoke tokens.`);
  console.error(`  event (admin/local/mid): ${POST}`);
  console.error(`  event (wrong-event)    : ${OTHER}`);
  console.error(`  sponsor_id (local)     : ${SPONSOR_ID}`);
  console.error(`  TTL                    : ${ttlDays} day(s) → expires ${expIso}`);
  console.error(`  repo                   : ${REPO}`);
  console.error('');
  console.error('  Run each command below, paste the matching token at gh\'s prompt');
  console.error('  (omitting --body keeps the token out of your shell history):');
  console.error('');

  // Tokens + gh commands → stdout (the values you must store).
  for (const m of minted) {
    console.log(`# ${m.name}`);
    console.log(m.token);
    console.log(`gh secret set ${m.name} --repo ${REPO}`);
    console.log('');
  }

  console.error('Then trigger a fresh full CI/CD run on the PR branch — T4f should go green.');
}

main().catch((err) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
