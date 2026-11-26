// /api/v2/admin/addons — turn a brand's paid add-on on or off (OSE-2232).
//
//   GET  ?brand_id=<id>                      → {ok, brand_id, addons: {skins: bool}}
//   PUT  {"brand_id", "addon": "skins", "on"} → the same answer after the write
//
// Platform only: the router runs requireAdmin, then _platformOnly (a key actor
// or the platform brand), and audits every PUT, refusals included. A brand
// cannot turn on its own add-on. Turning one off keeps the event's saved
// layout; its pages show the standard skin until it is on again.

import { corsHeaders } from '../lib/cors';
import { ADDONS, isAddon } from '../lib/brand-addons';

export interface BrandAddonsEnv {
  DB: D1Database;
}

const BRAND_ID = /^[A-Za-z0-9_-]{1,64}$/;

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    },
  });
}

async function read(env: BrandAddonsEnv, brandId: string): Promise<Record<string, boolean>> {
  const rows = await env.DB.prepare('SELECT addon FROM brand_addons WHERE brand_id = ?')
    .bind(brandId)
    .all<{ addon: string }>();
  const on = new Set((rows.results ?? []).map((r) => r.addon));
  return Object.fromEntries(ADDONS.map((a) => [a, on.has(a)]));
}

export async function handleAdminAddons(request: Request, env: BrandAddonsEnv): Promise<Response> {
  const bad = (error: string) => json(request, { ok: false, code: 'BAD_REQUEST', error }, 400);
  if (request.method === 'GET') {
    const brandId = new URL(request.url).searchParams.get('brand_id') ?? '';
    if (!BRAND_ID.test(brandId)) return bad('brand_id is required');
    return json(request, { ok: true, brand_id: brandId, addons: await read(env, brandId) });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad('invalid JSON body');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return bad('body must be an object');
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !['brand_id', 'addon', 'on'].includes(k));
  if (extra.length) return bad(`${extra[0]} is not read here`);
  if (typeof b.brand_id !== 'string' || !BRAND_ID.test(b.brand_id))
    return bad('brand_id is required');
  if (!isAddon(b.addon)) return bad(`addon must be one of: ${ADDONS.join(', ')}`);
  if (typeof b.on !== 'boolean') return bad('on must be true or false');
  if (b.on) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO brand_addons (brand_id, addon, granted_at, granted_by)
       VALUES (?, ?, ?, 'platform')`
    )
      .bind(b.brand_id, b.addon, new Date().toISOString())
      .run();
  } else {
    await env.DB.prepare('DELETE FROM brand_addons WHERE brand_id = ? AND addon = ?')
      .bind(b.brand_id, b.addon)
      .run();
  }
  return json(request, { ok: true, brand_id: b.brand_id, addons: await read(env, b.brand_id) });
}
