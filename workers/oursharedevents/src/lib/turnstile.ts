/**
 * Cloudflare Turnstile server-side verification — L4 scale-readiness lever (OSE-1378).
 *
 * DARK BY DEFAULT. `guardTurnstile` is a NO-OP unless `env.TURNSTILE_ENABLED === 'true'`,
 * so wiring it into a mutation handler changes nothing at launch. When activated it
 * enforces the canonical siteverify contract (fail-closed): a single-use token whose
 * `success`, `action`, and `hostname` all check out — anything else → 403.
 *
 * Activation is a separate infra step (create the widget via the CF API, set the
 * `TURNSTILE_SECRET` secret + `TURNSTILE_HOSTNAMES`/`TURNSTILE_SITE_KEY` vars, and ship
 * the client widget — Slice 2). See docs/ops/TURNSTILE-ACTIVATION.md. NEVER flip
 * `TURNSTILE_ENABLED` to 'true' before the client widget renders a token, or every
 * mutation will 403.
 *
 * Hot-path note: siteverify is a plain fetch to `challenges.cloudflare.com` — NOT a
 * model provider — so the LLM-free runtime invariant (COST-101) is unaffected. It only
 * runs when the flag is on, so the dark default adds zero network cost per request.
 */
import { corsHeaders } from './cors';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MS = 10_000;
const MAX_TOKEN_LEN = 2048;

export interface TurnstileEnv {
  /** 'true' activates enforcement. Any other value (incl. undefined) = dark/no-op. */
  TURNSTILE_ENABLED?: string;
  /** siteverify secret — set via `wrangler secret put TURNSTILE_SECRET` at activation. */
  TURNSTILE_SECRET?: string;
  /**
   * Comma-separated frontend hostnames siteverify must echo back in `hostname`.
   * A production value MUST NOT include `localhost`/`127.0.0.1`.
   */
  TURNSTILE_HOSTNAMES?: string;
  /** Public sitekey for the client widget (Slice 2). Non-secret; set at activation. */
  TURNSTILE_SITE_KEY?: string;
}

export interface SiteverifyResult {
  success: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
}

/** True only for the exact string 'true' — every other value is dark/off. */
export function isTurnstileEnabled(env: TurnstileEnv): boolean {
  return env.TURNSTILE_ENABLED === 'true';
}

// ─── Client widget render (Slice 2) ──────────────────────────────────────────
// Pure string builders. A page renders the widget ONLY when enforcement is on
// AND a sitekey is configured; otherwise every builder returns '' (zero markup).

/** Turnstile edge host — added to script-src + frame-src when the widget renders. */
export const TURNSTILE_HOST = 'https://challenges.cloudflare.com';

/** Renderable only when enabled AND a sitekey is configured. */
export function turnstileClientEnabled(env: TurnstileEnv): boolean {
  return isTurnstileEnabled(env) && !!env.TURNSTILE_SITE_KEY?.trim();
}

function escapeTurnstileAttr(v: string): string {
  return v.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c] ?? c
  );
}

/** The async widget loader `<script>` for the page head — '' when off. */
export function turnstileScriptTag(env: TurnstileEnv): string {
  return turnstileClientEnabled(env)
    ? `<script src="${TURNSTILE_HOST}/turnstile/v0/api.js" async defer></script>`
    : '';
}

/** The `.cf-turnstile` widget div for one action — '' when off. */
export function turnstileWidgetHtml(env: TurnstileEnv, action: string): string {
  if (!turnstileClientEnabled(env)) return '';
  const sitekey = escapeTurnstileAttr((env.TURNSTILE_SITE_KEY ?? '').trim());
  return `<div class="cf-turnstile" data-testid="turnstile-widget" data-sitekey="${sitekey}" data-action="${escapeTurnstileAttr(action)}"></div>`;
}

/**
 * Resolve the token from the parsed body field (JSON handlers) or the
 * `cf-turnstile-response` header (bodyless handlers, e.g. check-in). Returns null
 * when neither is a non-empty string.
 */
export function extractTurnstileToken(request: Request, bodyToken?: unknown): string | null {
  if (typeof bodyToken === 'string' && bodyToken.length > 0) return bodyToken;
  const header = request.headers.get('cf-turnstile-response');
  return header && header.length > 0 ? header : null;
}

function parseHostnames(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean)
  );
}

/**
 * Canonical siteverify call. Fail-closed by contract: any network error, non-2xx
 * status, or non-JSON body THROWS (the caller treats a throw as a denial).
 */
export async function siteverify(
  token: string,
  secret: string,
  remoteip?: string
): Promise<SiteverifyResult> {
  const params = new URLSearchParams({ secret, response: token });
  if (remoteip) params.set('remoteip', remoteip);
  const res = await fetch(SITEVERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`siteverify ${res.status}`);
  return (await res.json()) as SiteverifyResult;
}

function deny(request: Request): Response {
  return Response.json(
    {
      ok: false,
      success: false,
      status: 403,
      code: 'TURNSTILE_FAILED',
      error: 'Bot verification failed. Please try again.',
      timestamp: new Date().toISOString(),
    },
    { status: 403, headers: corsHeaders(request) }
  );
}

/**
 * Verify the Turnstile token for a mutation. Returns:
 *   - `null`         → allowed (DARK/disabled, or verification passed)
 *   - 403 `Response` → blocked
 *
 * Fail-closed: when ENABLED, every uncertain path (no secret, no expected hostnames,
 * missing/oversized token, network/parse error, `success:false`, action/hostname
 * mismatch) returns 403. Disabled short-circuits to `null` BEFORE any fetch, so the
 * dark default is a true no-op.
 */
export async function guardTurnstile(
  request: Request,
  env: TurnstileEnv,
  action: string,
  bodyToken?: unknown
): Promise<Response | null> {
  if (!isTurnstileEnabled(env)) return null; // DARK: no-op, no fetch.

  const secret = env.TURNSTILE_SECRET?.trim();
  const expectedHostnames = parseHostnames(env.TURNSTILE_HOSTNAMES);
  const token = extractTurnstileToken(request, bodyToken);

  if (!secret || expectedHostnames.size === 0 || !token || token.length > MAX_TOKEN_LEN) {
    // An activated-but-misconfigured worker must be visible in ops, never silently
    // allow. Missing/oversized token is normal client error and is not logged here.
    if (!secret || expectedHostnames.size === 0) {
      console.log(
        JSON.stringify({
          type: 'TURNSTILE_EVENT',
          action,
          outcome: 'misconfigured',
          reason: !secret ? 'no_secret' : 'no_hostnames',
          timestamp: new Date().toISOString(),
        })
      );
    }
    return deny(request);
  }

  const remoteip = request.headers.get('CF-Connecting-IP') ?? undefined;
  let result: SiteverifyResult;
  try {
    result = await siteverify(token, secret, remoteip);
  } catch {
    return deny(request); // network / non-2xx / non-JSON → fail closed
  }

  if (
    !result.success ||
    result.action !== action ||
    !expectedHostnames.has(result.hostname ?? '')
  ) {
    return deny(request);
  }
  return null;
}
