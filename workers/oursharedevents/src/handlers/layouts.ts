// /api/v2/admin/events/:id/layouts — how an event's pages are arranged (OSE-2232).
//
//   GET  → the event's layout for each surface (saved, or the standard skin),
//          the ready-made skins, the region words, and each layout as a skin
//          file (.md) to hand over.
//   PUT  → {"markdown": "<a skin file>"}: read the file (lib/layout-skin-md.ts)
//          and save the layout of every surface it names, in one write.
//          Blocks for another product's pages are passed over (`skipped`). This is the solution
//          engineer's path (a Bruno request carrying a .md file); the admin
//          card saves through the event's own settings write instead. Both are
//          held to lib/layout-skins.ts checkLayout.
//
// Admin only: requireAdmin runs in the router, the admin write guard has
// checked the write (same origin or a key actor, JSON body), and
// guardAdminObjectScope has answered 404 for an event outside the caller's
// brands. A look other than the standard skin needs the brand's skins add-on
// (403 ADDON_REQUIRED without it). The write is audited against the event in the router, with no
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
import { parseSkinFile, skinFile, skinMarkdown } from '../lib/layout-skin-md';
import { ADDON_REQUIRED_WORDS, hasAddon, surfacesNeedingAddon } from '../lib/brand-addons';

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

async function readEvent(
  env: LayoutsEnv,
  eventId: string
): Promise<{ settings_json: string | null; brand_id: string | null } | null> {
  return env.DB.prepare('SELECT settings_json, brand_id FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ settings_json: string | null; brand_id: string | null }>();
}

function describe(settingsJson: string | null) {
  const settings = parseEventSettings(settingsJson);
  const layouts = {} as Record<LayoutSurface, SurfaceLayout>;
  const markdown = {} as Record<LayoutSurface | 'all', string>;
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
  markdown.all = skinFile(layouts);
  return { layouts, markdown, skins, regions };
}

export async function handleAdminLayouts(
  request: Request,
  env: LayoutsEnv,
  eventId: string
): Promise<Response> {
  const event = await readEvent(env, eventId);
  if (!event) return json(request, { ok: false, code: 'NOT_FOUND' }, 404);
  // The standard look is free; any other needs the brand's skins add-on
  // (lib/brand-addons.ts). Without it a page shows the standard skin.
  const entitled = await hasAddon(env.DB, event.brand_id, 'skins');

  if (request.method === 'GET') {
    return json(request, { ok: true, entitled, ...describe(event.settings_json) });
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
  const parsed = parseSkinFile((body as { markdown?: unknown }).markdown);
  if (!parsed.ok) {
    return json(request, { ok: false, code: 'INVALID_SKIN', error: parsed.error }, 400);
  }
  if (!entitled && surfacesNeedingAddon(parsed.layouts).length) {
    return json(request, { ok: false, code: 'ADDON_REQUIRED', error: ADDON_REQUIRED_WORDS }, 403);
  }
  const patch = JSON.stringify({ layouts: parsed.layouts });
  await env.DB.prepare(
    `UPDATE events
        SET settings_json = json_patch(COALESCE(settings_json, '{}'), ?),
            updated_at = ?
      WHERE id = ?`
  )
    .bind(patch, new Date().toISOString(), eventId)
    .run();
  const after = await readEvent(env, eventId);
  return json(request, {
    ok: true,
    entitled,
    saved: Object.keys(parsed.layouts),
    skipped: parsed.skipped,
    ...describe(after?.settings_json ?? null),
  });
}
