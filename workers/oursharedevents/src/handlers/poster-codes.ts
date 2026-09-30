/**
 * Poster codes admin API — OSE-1357 part 2 (lib/poster-codes.ts has the model).
 *
 *   GET /api/v2/admin/events/:id/poster-codes → the poster's codes, in order
 *   PUT /api/v2/admin/events/:id/poster-codes → save { codes: [{ kind, target_url? }] }
 *
 * Both are requireAdmin-gated in the router, and the /admin/events/:id/... path
 * sits under the admin object-scope guard (brand scope, OSE-1080).
 *
 * The response carries each code's short link + a QR picture of that link, the
 * plan's code allotment (a number — never a tier name) and the pickable kinds.
 *
 * FORMS_DB: read ONLY through detectCurrentTier (the global flag set — no form
 * rows, no PII) to size the allotment. Authorised in tests/architecture.spec.ts.
 */

import { corsHeaders } from '../lib/cors';
import { detectCurrentTier } from '../lib/feature-flags';
import { generateQrCode } from '../lib/qr';
import { ensureSlotShortlinks, type SlotShortlink } from '../lib/shortlinks';
import {
  POSTER_CODE_KINDS,
  internalTarget,
  listSavedPosterCodes,
  parsePosterCodes,
  posterCodeKind,
  posterCodeLimit,
  savePosterCodes,
} from '../lib/poster-codes';

export interface PosterCodesEnv {
  DB?: D1Database;
  FORMS_DB?: D1Database;
}

function json(request: Request, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

async function planLimit(env: PosterCodesEnv): Promise<number> {
  if (!env.FORMS_DB) return posterCodeLimit('free');
  try {
    return posterCodeLimit(await detectCurrentTier(env.FORMS_DB));
  } catch {
    return posterCodeLimit('free');
  }
}

/** One code as the admin card shows it. */
export function describeCode(origin: string, eventId: string, s: SlotShortlink) {
  const spec = posterCodeKind(s.kind);
  const url = `${origin}/s/${s.code}`;
  let qr = '';
  try {
    qr = generateQrCode(url, { errorCorrection: 'M', scale: 4 });
  } catch {
    qr = '';
  }
  return {
    kind: s.kind,
    word: spec.word,
    choice: spec.choice,
    tone: spec.tone,
    code: s.code,
    url,
    target_url: spec.target === 'https' ? s.target_url : null,
    // Where a scan lands, for the card to SHOW (text only).
    points_to:
      spec.target === 'https' ? (s.target_url ?? '') : internalTarget(origin, eventId, s.kind),
    qr,
  };
}

async function currentCodes(env: PosterCodesEnv, eventId: string): Promise<SlotShortlink[]> {
  const saved = await listSavedPosterCodes(env, eventId);
  if (saved) return saved;
  // Nothing saved yet: what the poster shows today (event page + typed link).
  const ev = await env
    .DB!.prepare('SELECT what_url, what_url_type, what_url_enabled FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ what_url: string | null; what_url_type: string | null; what_url_enabled: number }>();
  return ensureSlotShortlinks(env, eventId, {
    whatUrl: ev?.what_url ?? null,
    whatUrlType: ev?.what_url_type ?? null,
    whatUrlEnabled: ev?.what_url_enabled ?? 0,
  });
}

async function respond(request: Request, env: PosterCodesEnv, eventId: string, status = 200) {
  const origin = new URL(request.url).origin;
  const codes = (await currentCodes(env, eventId)).map((s) => describeCode(origin, eventId, s));
  return json(
    request,
    {
      ok: true,
      limit: await planLimit(env),
      kinds: POSTER_CODE_KINDS.filter((k) => k.kind !== 'public').map((k) => ({
        kind: k.kind,
        word: k.word,
        choice: k.choice,
        tone: k.tone,
        needs_url: k.target === 'https',
      })),
      codes,
    },
    status
  );
}

async function eventExists(env: PosterCodesEnv, eventId: string): Promise<boolean> {
  const row = await env.DB!.prepare('SELECT id FROM events WHERE id = ?').bind(eventId).first();
  return !!row;
}

export async function handleAdminGetPosterCodes(
  request: Request,
  env: PosterCodesEnv,
  eventId: string
): Promise<Response> {
  if (!env.DB) return json(request, { ok: false, code: 'DB_NOT_CONFIGURED' }, 503);
  if (!(await eventExists(env, eventId))) {
    return json(request, { ok: false, code: 'NOT_FOUND', error: 'Event not found' }, 404);
  }
  return respond(request, env, eventId);
}

export async function handleAdminPutPosterCodes(
  request: Request,
  env: PosterCodesEnv,
  eventId: string
): Promise<Response> {
  if (!env.DB) return json(request, { ok: false, code: 'DB_NOT_CONFIGURED' }, 503);
  if (!(await eventExists(env, eventId))) {
    return json(request, { ok: false, code: 'NOT_FOUND', error: 'Event not found' }, 404);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(request, { ok: false, code: 'INVALID_BODY', error: 'Send JSON.' }, 400);
  }
  const limit = await planLimit(env);
  const parsed = parsePosterCodes(body, limit);
  if (!parsed.ok) {
    const status = parsed.code === 'PLAN_LIMIT' ? 403 : 400;
    return json(
      request,
      { ok: false, code: parsed.code, error: parsed.error, index: parsed.index, limit },
      status
    );
  }
  await savePosterCodes(env, eventId, parsed.codes);
  return respond(request, env, eventId);
}
