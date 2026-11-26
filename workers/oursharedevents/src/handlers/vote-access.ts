/**
 * Redeeming an Access Pass (OSE ADR-040 decision 13).
 *
 *   GET  /access                   a small page. Its script reads the token from
 *                                  the fragment, takes it out of the address bar,
 *                                  and POSTs it below. The token is never in a
 *                                  request line, a Referer or a request log.
 *   POST /api/v2/vote/access       {"token": "…"} → 200 {"ok":true,"event_id","pass"}
 *                                  or one 403 for anything else. Same-origin and
 *                                  JSON only, limited per caller at the route.
 *
 * The page then goes to `/events/:id/vote#t=<pass>`: the same voter page as
 * everyone in the room. A refused token gets one answer whatever the reason
 * (revoked, unknown, set not open, event not live, voting off), so a guess
 * learns nothing about why. Nothing here reads or sets a cookie, and no log
 * line names the token, the pass, the Access Pass id or the event.
 */

import { HARDENING_HEADERS } from '../lib/security-headers';
import { redeemAccessPass, type AccessRedeemEnv } from '../lib/vote-access-pass';
import { votePageResponse } from './vote-page';
import { escapeHtml as esc } from '../lib/html-escape';

const HEADERS = {
  ...HARDENING_HEADERS,
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json',
} as const;

const MAX_BODY = 512;

export const ACCESS_PAGE_WORDS = {
  opening: 'Opening your Access Pass…',
  failed:
    "This Access Pass isn't working right now. Voting may not be open yet, or the pass may have been taken back. Ask the host for help.",
};

function refuse(): Response {
  return new Response(
    JSON.stringify({ ok: false, code: 'ACCESS_PASS_INVALID', error: ACCESS_PAGE_WORDS.failed }),
    { status: 403, headers: HEADERS }
  );
}

function sameOrigin(request: Request): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site !== null) return site.trim().toLowerCase() === 'same-origin';
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/** POST /api/v2/vote/access: one token in, a room pass out, or one refusal. */
export async function handleAccessRedeem(
  request: Request,
  env: AccessRedeemEnv,
  nowMs: number = Date.now()
): Promise<Response> {
  if (request.method !== 'POST') return refuse();
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' || !sameOrigin(request)) return refuse();
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return refuse();
    raw = JSON.parse(text);
  } catch {
    return refuse();
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return refuse();
  const keys = Object.keys(raw as object);
  if (keys.length !== 1 || keys[0] !== 'token') return refuse();
  let out: { eventId: string; pass: string } | null = null;
  try {
    out = await redeemAccessPass(env, (raw as { token: unknown }).token, nowMs);
  } catch {
    out = null;
  }
  if (!out) return refuse();
  return new Response(JSON.stringify({ ok: true, event_id: out.eventId, pass: out.pass }), {
    status: 200,
    headers: HEADERS,
  });
}

/** The page's one script: fragment out of the bar first, then one POST. */
export const ACCESS_PAGE_SCRIPT = `(function () {
  var token = (location.hash || '').slice(1);
  if (location.hash) history.replaceState(null, '', location.pathname);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) token = '';
  document.addEventListener('DOMContentLoaded', function () {
    var status = document.getElementById('access-status');
    function failed() { status.textContent = ${JSON.stringify(ACCESS_PAGE_WORDS.failed)}; }
    if (!token) { failed(); return; }
    fetch('/api/v2/vote/access', {
      method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    }).then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (body) {
        token = '';
        if (body && body.ok && /^[A-Za-z0-9_-]{1,128}$/.test(body.event_id || '') &&
            /^[A-Za-z0-9._~-]{1,1024}$/.test(body.pass || '')) {
          location.replace('/events/' + encodeURIComponent(body.event_id) + '/vote#t=' + body.pass);
          return;
        }
        failed();
      }).catch(failed);
  });
})();`;

/** GET /access: the redeem page. No token, event or pass is in its HTML. */
export function handleAccessPage(): Response {
  return votePageResponse(`<!DOCTYPE html>
<html lang="en" data-surface="ose-access">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <meta name="referrer" content="no-referrer" />
    <script>${ACCESS_PAGE_SCRIPT}</script>
    <title>Access Pass · OurSharedEvents</title>
    <link rel="stylesheet" href="/ui.css" />
  </head>
  <body>
    <main id="main-content" data-testid="access-page" style="max-width:560px;margin:0 auto;padding:1rem 16px">
      <h1 data-testid="access-title">Access Pass</h1>
      <p id="access-status" role="status" aria-live="polite" data-testid="access-status">${esc(ACCESS_PAGE_WORDS.opening)}</p>
    </main>
  </body>
</html>`);
}
