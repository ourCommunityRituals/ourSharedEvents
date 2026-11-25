// /api/v2/admin/events/:id/layouts — how an event's pages are arranged (OSE-2232).
//
//   GET  → the event's layout for each surface (saved, or the standard skin),
//          the ready-made skins, the region words, and each layout as a skin
//          file (.md) to hand over.
//   PUT  → {"markdown": "<a skin file>"}: read the file (lib/layout-skin-md.ts)
//          and save its layout for the surface it names. This is the solution
//          engineer's path (a Bruno request carrying a .md file); the admin
//          card saves through the event's own settings write instead. Both are
//          held to lib/layout-skins.ts checkLayout.
//
// Admin only: requireAdmin runs in the router, the admin write guard has
// checked the write (same origin or a key actor, JSON body), and
// guardAdminObjectScope has answered 404 for an event outside the caller's
// brands. The write is audited against the event in the router, with no
// detail. A layout carries region names only: no count, no person, no link.

import { corsHeaders } from '../lib/cors';
import { parseEventSettings, resolveLayout } from '../lib/event-settings';
import {
  LAYOUT_SURFACES,
  REGION_WORDS,
  SKINS,
  SURFACE_REGIONS,
  skinLayout,
  type LayoutSurface,
  type SurfaceLayout,
} from '../lib/layout-skins';
import { parseSkinMarkdown, skinMarkdown } from '../lib/layout-skin-md';

export interface LayoutsEnv {
  DB: D1Database;
}

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

async function readSettings(env: LayoutsEnv, eventId: string): Promise<string | null | undefined> {
  const row = await env.DB.prepare('SELECT settings_json FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ settings_json: string | null }>();
  return row ? row.settings_json : undefined;
}

function describe(settingsJson: string | null) {
  const settings = parseEventSettings(settingsJson);
  const layouts = {} as Record<LayoutSurface, SurfaceLayout>;
  const markdown = {} as Record<LayoutSurface, string>;
  const skins = {} as Record<
    LayoutSurface,
    { name: string; words: string; layout: SurfaceLayout }[]
  >;
  const regions = {} as Record<LayoutSurface, { name: string; words: string }[]>;
  for (const surface of LAYOUT_SURFACES) {
    layouts[surface] = resolveLayout(settings, surface);
    markdown[surface] = skinMarkdown(surface, layouts[surface]);
    skins[surface] = Object.keys(SKINS[surface]).map((name) => ({
      name,
      words: SKINS[surface][name]!.words,
      layout: skinLayout(surface, name)!,
    }));
    regions[surface] = SURFACE_REGIONS[surface].map((name) => ({
      name,
      words: REGION_WORDS[surface][name]!,
    }));
  }
  return { layouts, markdown, skins, regions };
}

export async function handleAdminLayouts(
  request: Request,
  env: LayoutsEnv,
  eventId: string
): Promise<Response> {
  const settingsJson = await readSettings(env, eventId);
  if (settingsJson === undefined) return json(request, { ok: false, code: 'NOT_FOUND' }, 404);

  if (request.method === 'GET') {
    return json(request, { ok: true, ...describe(settingsJson) });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(request, { ok: false, code: 'BAD_REQUEST', error: 'invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(request, { ok: false, code: 'BAD_REQUEST', error: 'body must be an object' }, 400);
  }
  const extra = Object.keys(body).filter((k) => k !== 'markdown');
  if (extra.length) {
    return json(
      request,
      { ok: false, code: 'BAD_REQUEST', error: `${extra[0]} is not read here; send markdown only` },
      400
    );
  }
  const parsed = parseSkinMarkdown((body as { markdown?: unknown }).markdown);
  if (!parsed.ok) {
    return json(request, { ok: false, code: 'INVALID_SKIN', error: parsed.error }, 400);
  }
  const patch = JSON.stringify({ layouts: { [parsed.surface]: parsed.layout } });
  await env.DB.prepare(
    `UPDATE events
        SET settings_json = json_patch(COALESCE(settings_json, '{}'), ?),
            updated_at = ?
      WHERE id = ?`
  )
    .bind(patch, new Date().toISOString(), eventId)
    .run();
  const after = await readSettings(env, eventId);
  return json(request, { ok: true, surface: parsed.surface, ...describe(after ?? null) });
}
