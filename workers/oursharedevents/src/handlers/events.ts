/**
 * Events API handler.
 *
 * GET /api/v2/events          – list active events for a brand
 * GET /api/v2/events/:id      – single event by ID
 *
 * Data source: Google Sheets EVENTS sheet (Phase 1)
 * D1 Migration (Phase 2): replace sheetsGetValues calls with D1 queries.
 *
 * Sheet column layout (EVENTS sheet, A2:K):
 * A=id  B=brand_id  C=template_id  D=data_json  E=created_at
 * F=slug  G=updated_at  H=status  I=is_default  J=asset_state
 */

import { sheetsGetValues, SheetsReadError, type SheetsEnv } from '../lib/sheets';

// ─── Column indices ────────────────────────────────────────────────────────────

const COL = {
  ID: 0, BRAND_ID: 1, TEMPLATE_ID: 2, DATA_JSON: 3,
  CREATED_AT: 4, SLUG: 5, UPDATED_AT: 6,
  STATUS: 7, IS_DEFAULT: 8, ASSET_STATE: 9,
} as const;

const EVENTS_RANGE = 'EVENTS!A2:K';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface EventsEnv extends SheetsEnv {
  WORKER_ENV?: string;
}

interface EventRow {
  id: string;
  brandId: string;
  templateId?: string;
  slug: string;
  status: string;
  isDefault: boolean;
  assetState?: string;
  createdAt: string;
  updatedAt: string;
  data: Record<string, unknown>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseRow(row: string[]): EventRow | null {
  if (!row || row.length < 4) return null;
  const id = row[COL.ID];
  const dataJson = row[COL.DATA_JSON];
  if (!id || !dataJson) return null;

  try {
    const data = JSON.parse(dataJson) as Record<string, unknown>;
    return {
      id,
      brandId: row[COL.BRAND_ID] || 'root',
      templateId: row[COL.TEMPLATE_ID] || undefined,
      slug: row[COL.SLUG] || '',
      status: row[COL.STATUS] || 'active',
      isDefault: row[COL.IS_DEFAULT] === 'true' || row[COL.IS_DEFAULT] === '1',
      assetState: row[COL.ASSET_STATE] || undefined,
      createdAt: row[COL.CREATED_AT] || '',
      updatedAt: row[COL.UPDATED_AT] || '',
      data,
    };
  } catch {
    console.error(JSON.stringify({ type: 'EVENT_PARSE_ERROR', id }));
    return null;
  }
}

function rowToPublicEvent(r: EventRow): Record<string, unknown> {
  return {
    id: r.id,
    slug: r.slug,
    name: (r.data.name as string) ?? '',
    startDateISO: (r.data.startDateISO as string) ?? '',
    venue: (r.data.venue as string) ?? '',
    assetState: r.assetState,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function rowToFullEvent(r: EventRow): Record<string, unknown> {
  return { ...r.data, id: r.id, brandId: r.brandId, slug: r.slug, assetState: r.assetState, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

function requestId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function errorResponse(code: string, message: string, status: number, rid: string): Response {
  return Response.json({ ok: false, status, code, error: message, requestId: rid, timestamp: new Date().toISOString() }, { status });
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /api/v2/events?brand=root&full=true
 */
export async function handleListEvents(request: Request, env: EventsEnv): Promise<Response> {
  const rid = requestId();
  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand') ?? 'root';
  const includeFull = url.searchParams.get('full') === 'true';

  if (!env.SHEETS_SPREADSHEET_ID) {
    return errorResponse('SHEETS_DB_ID_MISSING', 'SHEETS_SPREADSHEET_ID not configured', 503, rid);
  }

  try {
    const rows = await sheetsGetValues(env, EVENTS_RANGE);

    const items = rows
      .map(parseRow)
      .filter((r): r is EventRow => r !== null && r.brandId === brandId && r.status !== 'archived')
      .sort((a, b) => (b.data.startDateISO as string ?? '').localeCompare(a.data.startDateISO as string ?? ''))
      .map(r => includeFull ? rowToFullEvent(r) : rowToPublicEvent(r));

    return Response.json({ ok: true, status: 200, items }, {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
        'X-Request-Id': rid,
      },
    });
  } catch (err) {
    if (err instanceof SheetsReadError) {
      return errorResponse('SHEETS_READ_FAILED', err.message, 503, rid);
    }
    return errorResponse('INTERNAL_ERROR', 'Failed to list events', 500, rid);
  }
}

/**
 * GET /api/v2/events/:id
 */
export async function handleGetEvent(request: Request, env: EventsEnv, id: string): Promise<Response> {
  const rid = requestId();

  if (!env.SHEETS_SPREADSHEET_ID) {
    return errorResponse('SHEETS_DB_ID_MISSING', 'SHEETS_SPREADSHEET_ID not configured', 503, rid);
  }

  try {
    const rows = await sheetsGetValues(env, EVENTS_RANGE);
    const row = rows.map(parseRow).find(r => r?.id === id);

    if (!row) {
      return errorResponse('NOT_FOUND', `Event not found: ${id}`, 404, rid);
    }

    return Response.json({ ok: true, status: 200, event: rowToFullEvent(row) }, {
      headers: { 'Cache-Control': 'private, max-age=60', 'X-Request-Id': rid },
    });
  } catch (err) {
    if (err instanceof SheetsReadError) {
      return errorResponse('SHEETS_READ_FAILED', err.message, 503, rid);
    }
    return errorResponse('INTERNAL_ERROR', 'Failed to fetch event', 500, rid);
  }
}

/**
 * GET /api/v2/admin/events  (includes archived)
 */
export async function handleAdminListEvents(request: Request, env: EventsEnv): Promise<Response> {
  const rid = requestId();

  if (!env.SHEETS_SPREADSHEET_ID) {
    return errorResponse('SHEETS_DB_ID_MISSING', 'SHEETS_SPREADSHEET_ID not configured', 503, rid);
  }

  const url = new URL(request.url);
  const brandId = url.searchParams.get('brand') ?? 'root';

  try {
    const rows = await sheetsGetValues(env, EVENTS_RANGE);

    const items = rows
      .map(parseRow)
      .filter((r): r is EventRow => r !== null && r.brandId === brandId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(r => ({ ...rowToFullEvent(r), status: r.status, isDefault: r.isDefault }));

    return Response.json({ ok: true, status: 200, items }, {
      headers: { 'X-Request-Id': rid, 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    if (err instanceof SheetsReadError) {
      return errorResponse('SHEETS_READ_FAILED', err.message, 503, rid);
    }
    return errorResponse('INTERNAL_ERROR', 'Failed to list admin events', 500, rid);
  }
}
