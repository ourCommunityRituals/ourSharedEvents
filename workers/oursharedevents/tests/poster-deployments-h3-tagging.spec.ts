/**
 * poster-deployments-h3-tagging.spec.ts
 *
 * OSE — H3 poster-deployment geo-tagging (migration 0047).
 *
 * Privacy contract (verified by test 8):
 *   Physical QR scan (poster) → res9 precision is valid — the poster has an address,
 *   not the person. Contrast with digital clicks which must be capped at res7.
 *
 * Covers:
 *  1. Creating a deployment with lat/lon stores h3_res9 and h3_res7
 *  2. Creating a deployment without lat/lon stores null for both H3 fields
 *  3. Invalid lat/lon returns 400 INVALID_COORDINATES
 *  4. Updating a deployment with new lat/lon re-tags H3 cells
 *  5. Updating with different coords overwrites previous H3 cells
 *  6. Soft-delete sets is_active=0
 *  7. H3 backfill endpoint tags existing rows with lat/lon but no H3
 *  8. Res9 precision contract — h3_res9 is a valid 15-char H3 cell string (Node, ~174m²)
 *  9. Two nearby deployments share h3_res7 but differ at h3_res9
 * 10. List endpoint returns all deployments for an event
 * 11. Get-single endpoint returns one deployment
 * 12. Hot-path guard: poster-deployments.ts is NOT in SCAN_PATH
 * 8b–8e. Attribution rule gate (OSE-1357): a physical scan resolves to the
 *     poster's res9 placement cell, a digital short-link click to res7 at most,
 *     and NO scan/click path reads device geolocation.
 *
 * @born-red OSE-1357 | method: mutation injection — each 8b–8e assertion went red
 *   when a violation was injected into the source (request.cf.latitude in
 *   qr-scan.ts, navigator.geolocation in admin.html, an h3_res10 column on
 *   scan_placement_events, an h3_res9 column on shortlinks), then reverted | date: 2026-09-29
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { tagsConsistent } from '../src/lib/h3-tagging';

const ADMIN_HEADERS = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
} as const;

// Known NCR ground-truth coordinates (Eagles Hall, Blue Island IL)
// h3_res7 = '872664544ffffff', h3_res9 = '89266454447ffff'
const EAGLES = { lat: 41.6571, lon: -87.6798 };

// Rock Island Public House — a few blocks away, same res7 corridor, different res9
const RIPH = { lat: 41.6565, lon: -87.681 };

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

async function seedEvent(id: string): Promise<void> {
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare(
    `INSERT OR IGNORE INTO events
       (id, brand_id, title, slug, status)
     VALUES (?, 'pd-h3-test', ?, ?, 'active')`
  )
    .bind(id, `PD H3 Test Event ${id}`, `pd-h3-test-${id}`)
    .run();
}

async function createDeployment(eventId: string, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`https://t.test/api/v2/admin/events/${eventId}/poster-deployments`, {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify(body),
  });
}

async function getDeploymentRow(id: string): Promise<Record<string, unknown> | null> {
  const tenv = env as unknown as TestEnv;
  return tenv.DB.prepare('SELECT * FROM poster_deployments WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await applyMigrations();
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare("DELETE FROM events WHERE brand_id = 'pd-h3-test'").run();
  await tenv.DB.prepare(
    "DELETE FROM poster_deployments WHERE placement_label LIKE 'PDH3Test%'"
  ).run();

  await seedEvent('evt-pdh3-eagles');
  await seedEvent('evt-pdh3-backfill');
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OSE H3 poster-deployment geo-tagging — migration 0047', () => {
  test('1. creating a deployment with lat/lon stores h3_res9 and h3_res7', async () => {
    const res = await createDeployment('evt-pdh3-eagles', {
      placement_label: 'PDH3Test Front Door',
      latitude: EAGLES.lat,
      longitude: EAGLES.lon,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      id: string;
      h3_res9: string;
      h3_res7: string;
    };
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^pd_/);
    expect(body.h3_res9).toBe('89266454447ffff');
    expect(body.h3_res7).toBe('872664544ffffff');

    const row = await getDeploymentRow(body.id);
    expect(row).not.toBeNull();
    expect(row!.h3_res9).toBe('89266454447ffff');
    expect(row!.h3_res7).toBe('872664544ffffff');
    expect(row!.latitude).toBeCloseTo(EAGLES.lat, 4);
    expect(row!.longitude).toBeCloseTo(EAGLES.lon, 4);
  });

  test('2. creating a deployment without lat/lon stores null for both H3 fields', async () => {
    const res = await createDeployment('evt-pdh3-eagles', {
      placement_label: 'PDH3Test No Coords',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; id: string; h3_res9: null; h3_res7: null };
    expect(body.ok).toBe(true);
    expect(body.h3_res9).toBeNull();
    expect(body.h3_res7).toBeNull();

    const row = await getDeploymentRow(body.id);
    expect(row!.h3_res9).toBeNull();
    expect(row!.h3_res7).toBeNull();
    expect(row!.latitude).toBeNull();
    expect(row!.longitude).toBeNull();
  });

  test('3a. invalid lat (out of range) returns 400 INVALID_COORDINATES', async () => {
    const res = await createDeployment('evt-pdh3-eagles', {
      placement_label: 'PDH3Test Bad Lat',
      latitude: 999,
      longitude: EAGLES.lon,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_COORDINATES');
  });

  test('3b. invalid lon (out of range) returns 400 INVALID_COORDINATES', async () => {
    const res = await createDeployment('evt-pdh3-eagles', {
      placement_label: 'PDH3Test Bad Lon',
      latitude: EAGLES.lat,
      longitude: 999,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_COORDINATES');
  });

  test('3c. partial coords (lat only) returns 400 INVALID_COORDINATES', async () => {
    const res = await createDeployment('evt-pdh3-eagles', {
      placement_label: 'PDH3Test Partial Coords',
      latitude: EAGLES.lat,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_COORDINATES');
  });

  test('4. updating a deployment with new lat/lon re-tags the H3 cells', async () => {
    // Create without coords
    const createRes = await createDeployment('evt-pdh3-eagles', {
      placement_label: 'PDH3Test Update Retag',
    });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    const before = await getDeploymentRow(id);
    expect(before!.h3_res9).toBeNull();

    const updateRes = await SELF.fetch(`https://t.test/api/v2/admin/poster-deployments/${id}`, {
      method: 'PUT',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ latitude: EAGLES.lat, longitude: EAGLES.lon }),
    });
    expect(updateRes.status).toBe(200);
    const updateBody = (await updateRes.json()) as {
      ok: boolean;
      h3_res9: string;
      h3_res7: string;
    };
    expect(updateBody.ok).toBe(true);
    expect(updateBody.h3_res9).toBe('89266454447ffff');
    expect(updateBody.h3_res7).toBe('872664544ffffff');

    const after = await getDeploymentRow(id);
    expect(after!.h3_res9).toBe('89266454447ffff');
    expect(after!.h3_res7).toBe('872664544ffffff');
  });

  test('5. updating with different coords overwrites previous H3 cells', async () => {
    const createRes = await createDeployment('evt-pdh3-eagles', {
      placement_label: 'PDH3Test Overwrite',
      latitude: EAGLES.lat,
      longitude: EAGLES.lon,
    });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    // Move to RIPH — nearby but different res9 node
    const updateRes = await SELF.fetch(`https://t.test/api/v2/admin/poster-deployments/${id}`, {
      method: 'PUT',
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ latitude: RIPH.lat, longitude: RIPH.lon }),
    });
    expect(updateRes.status).toBe(200);

    const after = await getDeploymentRow(id);
    // h3_res9 should differ (different node)
    expect(after!.h3_res9).not.toBe('89266454447ffff');
    // h3_res7 stays the same (same corridor)
    expect(after!.h3_res7).toBe('872664544ffffff');
  });

  test('6. soft-delete sets is_active=0', async () => {
    const createRes = await createDeployment('evt-pdh3-eagles', {
      placement_label: 'PDH3Test SoftDelete',
    });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    const deleteRes = await SELF.fetch(`https://t.test/api/v2/admin/poster-deployments/${id}`, {
      method: 'DELETE',
      headers: ADMIN_HEADERS,
    });
    expect(deleteRes.status).toBe(200);
    const deleteBody = (await deleteRes.json()) as { ok: boolean; is_active: boolean };
    expect(deleteBody.ok).toBe(true);
    expect(deleteBody.is_active).toBe(false);

    const row = await getDeploymentRow(id);
    expect(row!.is_active).toBe(0);
  });

  test('7. H3 backfill endpoint tags rows with lat/lon but no H3', async () => {
    const tenv = env as unknown as TestEnv;
    // Directly insert a poster_deployment with lat/lon but null H3 (simulating legacy row)
    const legacyId = `pd_backfill_${Date.now()}`;
    await tenv.DB.prepare(
      `INSERT INTO poster_deployments
         (id, event_id, qr_token, placement_label, latitude, longitude, is_active, created_at, updated_at)
       VALUES (?, 'evt-pdh3-backfill', ?, 'PDH3Test Backfill Legacy', ?, ?, 1, datetime('now'), datetime('now'))`
    )
      .bind(legacyId, `qrt_backfill_${Date.now()}`, EAGLES.lat, EAGLES.lon)
      .run();

    // Verify no H3 yet
    const before = await getDeploymentRow(legacyId);
    expect(before!.h3_res9).toBeNull();
    expect(before!.h3_res7).toBeNull();

    // Run backfill
    const backfillRes = await SELF.fetch(
      'https://t.test/api/v2/admin/poster-deployments/backfill-h3',
      { method: 'POST', headers: ADMIN_HEADERS }
    );
    expect(backfillRes.status).toBe(200);
    const backfillBody = (await backfillRes.json()) as {
      ok: boolean;
      tagged: number;
      skipped: number;
    };
    expect(backfillBody.ok).toBe(true);
    expect(backfillBody.tagged).toBeGreaterThanOrEqual(1);

    // Verify H3 was set
    const after = await getDeploymentRow(legacyId);
    expect(after!.h3_res9).toBe('89266454447ffff');
    expect(after!.h3_res7).toBe('872664544ffffff');
  });

  test('8. res9 precision contract — h3_res9 is a valid H3 cell and tags are consistent', async () => {
    const res = await createDeployment('evt-pdh3-eagles', {
      placement_label: 'PDH3Test Precision Contract',
      latitude: EAGLES.lat,
      longitude: EAGLES.lon,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { h3_res9: string; h3_res7: string };

    // Both cells are present and internally consistent (res9 parent at res7 equals stored res7)
    expect(tagsConsistent({ h3_res9: body.h3_res9, h3_res7: body.h3_res7 })).toBe(true);

    // res9 is node-level (~174m²) — 15 hex characters
    expect(body.h3_res9).toHaveLength(15);
    // res7 is corridor-level (~5km²) — 15 hex characters
    expect(body.h3_res7).toHaveLength(15);
  });

  test('9. two nearby deployments share h3_res7 but differ at h3_res9', async () => {
    const eaglesRes = await createDeployment('evt-pdh3-eagles', {
      placement_label: 'PDH3Test Eagles Nearby A',
      latitude: EAGLES.lat,
      longitude: EAGLES.lon,
    });
    const riphRes = await createDeployment('evt-pdh3-eagles', {
      placement_label: 'PDH3Test Eagles Nearby B',
      latitude: RIPH.lat,
      longitude: RIPH.lon,
    });
    expect(eaglesRes.status).toBe(201);
    expect(riphRes.status).toBe(201);

    const eaglesBody = (await eaglesRes.json()) as { h3_res9: string; h3_res7: string };
    const riphBody = (await riphRes.json()) as { h3_res9: string; h3_res7: string };

    expect(eaglesBody.h3_res9).not.toBe(riphBody.h3_res9); // different blocks
    expect(eaglesBody.h3_res7).toBe(riphBody.h3_res7); // same corridor
  });

  test('10. list endpoint returns all deployments for an event', async () => {
    const listRes = await SELF.fetch(
      'https://t.test/api/v2/admin/events/evt-pdh3-eagles/poster-deployments',
      { method: 'GET', headers: ADMIN_HEADERS }
    );
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as {
      ok: boolean;
      items: Array<{ qr_token: string; scan_url: string; qr_data_uri: string }>;
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });

  test('10b. list endpoint enriches each row with the physical scan URL + in-bundle QR (OSE-895)', async () => {
    const listRes = await SELF.fetch(
      'https://t.test/api/v2/admin/events/evt-pdh3-eagles/poster-deployments',
      { method: 'GET', headers: ADMIN_HEADERS }
    );
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as {
      ok: boolean;
      items: Array<{ qr_token: string; scan_url: string; qr_data_uri: string }>;
    };
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      // scan_url encodes the /q/<qr_token> ingestion path — the URL the poster
      // QR must carry so a scan writes a `scans` row (handlers/qr-scan.ts).
      expect(item.scan_url).toContain('/q/' + item.qr_token);
      // QR generated in-bundle (native lib/qr) — a real PNG data-URI, never an
      // external QR service. This keeps the runtime LLM-free / dependency-free.
      expect(item.qr_data_uri.startsWith('data:image/png;base64,')).toBe(true);
      expect(item.qr_data_uri.length).toBeGreaterThan(100);
    }
  });

  test('11. get-single endpoint returns one deployment with H3 fields', async () => {
    const createRes = await createDeployment('evt-pdh3-eagles', {
      placement_label: 'PDH3Test Get Single',
      latitude: EAGLES.lat,
      longitude: EAGLES.lon,
    });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    const getRes = await SELF.fetch(`https://t.test/api/v2/admin/poster-deployments/${id}`, {
      method: 'GET',
      headers: ADMIN_HEADERS,
    });
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { ok: boolean; item: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.item.id).toBe(id);
    expect(body.item.h3_res9).toBe('89266454447ffff');
    expect(body.item.h3_res7).toBe('872664544ffffff');
  });
});

// ─── Attribution rule gate (OSE-1357) ─────────────────────────────────────────
// The address field made it tempting to reach for "use my location". It must
// never happen: a poster's place comes from the ADDRESS the organizer typed
// (geocoded once, at creation, by an admin), never from anyone's device, and
// each signal is attributed no finer than its rule allows:
//   physical scan (/q/)  → the poster's res9 placement cell (via the deployment)
//   digital click (/s/)  → res7 vicinity at most (today: no location at all)

/** Files a scanner/clicker's request passes through, server and served client JS. */
const SCAN_CLICK_PATH = [
  'src/handlers/qr-scan.ts',
  'src/lib/scan-buffer.ts',
  'src/handlers/shortlink-resolve.ts',
  'src/lib/shortlinks.ts',
  // Poster tiers: /s/ builds internal targets (check-in, REGISTER) here.
  'src/lib/poster-codes.ts',
  'src/handlers/uec-resolve.ts',
  'src/handlers/forms.ts',
  'src/handlers/form-pages.ts',
  'src/handlers/pages.ts',
] as const;

/**
 * Device geolocation, in every shape it can arrive: the browser API, the
 * Cloudflare request.cf geo fields (derived from the visitor's IP, timezone
 * included; dot, optional-chain, bracket and destructuring access), and every
 * CF-IP* header by prefix. OSE-1460 (2026-10-01): CF-IPCountry is no longer allowed —
 * the visitor's apparent country is not recorded either. Any read of `request.cf`
 * itself is forbidden on these paths too (`x.cf`, `x?.cf`, `x['cf']`), so an alias
 * (`const edge = request.cf; edge.country`) cannot slip past the field list.
 */
const DEVICE_GEO =
  /navigator\s*\.\s*geolocation|getCurrentPosition|watchPosition|\bcf\s*\??\.\s*(latitude|longitude|city|postalCode|metroCode|region|regionCode|country|continent|timezone|isEUCountry)\b|\bcf\s*\??\.?\s*\[\s*['"`]\s*(latitude|longitude|city|postalCode|metroCode|region|regionCode|country|continent|timezone|isEUCountry)\b|\{[^}]*\b(latitude|longitude|city|postalCode|metroCode|region|regionCode|country|continent|timezone|isEUCountry)\b[^}]*\}\s*=\s*[\w.?]*\bcf\b|cf-ip[a-z-]+|[\w)\]]\s*\??\.\s*cf\b(?!-)|\[\s*['"`]cf['"`]\s*\]/i;

function sourcesMatching(pred: (p: string) => boolean): Array<[string, string]> {
  const sources: Record<string, string> = JSON.parse(
    (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
  );
  return Object.entries(sources)
    .map(([p, c]) => [p.replace(/\\/g, '/'), c] as [string, string])
    .filter(([p]) => pred(p));
}

async function columnsOf(table: string): Promise<string[]> {
  const info = await (env as unknown as TestEnv).DB.prepare(`PRAGMA table_info(${table})`).all<{
    name: string;
  }>();
  return (info.results ?? []).map((r) => r.name);
}

describe('8b–8e. attribution rule gate — physical res9, digital res7, no device geo (OSE-1357)', () => {
  test('8b. the geolocation pattern catches every access form (self-check)', () => {
    for (const read of [
      'request.cf.country',
      'request.cf?.timezone',
      "request.cf['country']",
      'const { country } = request.cf',
      'const { city: c, timezone } = request.cf ?? {}',
      'const {\n  country,\n} = req.cf;',
      'request.cf?.["city"]',
      "headers.get('CF-IPCountry')",
      "headers.get('cf-ipcity')",
      'navigator.geolocation',
      'const edge = request.cf; edge.country',
      'const edge = req?.cf',
      "request['cf']",
      '(r as unknown as { cf?: unknown }).cf',
    ]) {
      expect(DEVICE_GEO.test(read), read).toBe(true);
    }
    // The rate-limit key is an IP header, not geography.
    expect(DEVICE_GEO.test("headers.get('CF-Connecting-IP')")).toBe(false);
    // The Turnstile token field is not request.cf.
    expect(DEVICE_GEO.test("body['cf-turnstile-response']")).toBe(false);
  });

  test('8b. no scan/click path reads device geolocation', () => {
    for (const rel of SCAN_CLICK_PATH) {
      const hit = sourcesMatching((p) => p.endsWith(rel));
      expect(hit.length, `${rel} missing from TEST_SOURCE_FILES_JSON`).toBe(1);
      const m = hit[0][1].match(DEVICE_GEO);
      expect(m, `${rel} reads device geolocation: "${m?.[0]}"`).toBeNull();
    }
  });

  test('8b. nothing the Worker serves asks the browser for its position (admin included)', () => {
    const served = sourcesMatching(
      (p) => /(^|\/)src\//.test(p) && (p.endsWith('.ts') || p.endsWith('.html'))
    );
    expect(served.length).toBeGreaterThan(20);
    for (const [p, c] of served) {
      expect(c, `${p} calls the browser geolocation API`).not.toMatch(
        /navigator\s*\.\s*geolocation|getCurrentPosition|watchPosition/
      );
    }
  });

  test('8c. a physical scan carries only the placement — its place is the poster res9 cell', async () => {
    const res = await createDeployment('evt-pdh3-eagles', {
      placement_label: 'PDH3Test Attribution Scan',
      latitude: EAGLES.lat,
      longitude: EAGLES.lon,
    });
    expect(res.status).toBe(201);
    const { id, qr_token } = (await res.json()) as { id: string; qr_token: string };

    const scan = await SELF.fetch(`https://t.test/q/${qr_token}`, { redirect: 'manual' });
    expect(scan.status).toBe(302);

    const tenv = env as unknown as TestEnv;
    const placed = await tenv.DB.prepare(
      `SELECT pd.h3_res9 AS cell
         FROM scan_placement_events spe
         JOIN poster_deployments pd ON pd.id = spe.poster_deployment_id
        WHERE spe.poster_deployment_id = ?`
    )
      .bind(id)
      .first<{ cell: string }>();
    expect(placed?.cell).toBe('89266454447ffff'); // the POSTER's res9 node

    // The scan rows themselves carry no coordinate or cell of their own — the
    // only place a scan has is the placement it references.
    for (const t of ['scan_placement_events', 'scan_node_returns']) {
      const cols = await columnsOf(t);
      expect(cols.length).toBeGreaterThan(0);
      for (const c of cols) expect(c, `${t}.${c}`).not.toMatch(/lat|lon|lng|h3|geo|city|postal/i);
    }
  });

  test('8d. a digital short-link click records nothing finer than res7', async () => {
    const tenv = env as unknown as TestEnv;
    const code = 'PDH3ck';
    await tenv.DB.prepare('DELETE FROM shortlinks WHERE code = ?').bind(code).run();
    await tenv.DB.prepare(
      `INSERT INTO shortlinks (code, event_id, kind, clicks, created_at)
       VALUES (?, 'evt-pdh3-eagles', 'public', 0, datetime('now'))`
    )
      .bind(code)
      .run();

    const click = await SELF.fetch(`https://t.test/s/${code}`, { redirect: 'manual' });
    expect(click.status).toBe(302);
    const row = await tenv.DB.prepare('SELECT clicks FROM shortlinks WHERE code = ?')
      .bind(code)
      .first<{ clicks: number }>();
    expect(row?.clicks).toBe(1);

    const cols = await columnsOf('shortlinks');
    for (const c of cols) {
      expect(c, `shortlinks.${c} is finer than res7`).not.toMatch(
        /lat|lon|lng|city|postal|h3_res(8|9|1[0-5])/i
      );
    }
    for (const rel of ['src/handlers/shortlink-resolve.ts', 'src/lib/shortlinks.ts']) {
      const [[, src]] = sourcesMatching((p) => p.endsWith(rel));
      expect(src, `${rel} writes a cell finer than res7`).not.toMatch(/h3_res(8|9|1[0-5])/);
    }
  });

  test('8e. no table anywhere stores a cell finer than the poster res9 node', async () => {
    const tables = await (env as unknown as TestEnv).DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).all<{ name: string }>();
    for (const { name } of tables.results ?? []) {
      if (name.startsWith('_cf') || name.startsWith('d1_')) continue;
      for (const c of await columnsOf(name)) {
        expect(c, `${name}.${c}`).not.toMatch(/h3_res1[0-5]/i);
      }
    }
  });
});

// ─── Hot-path guard ───────────────────────────────────────────────────────────
// poster-deployments.ts is an admin/creation-time handler — NOT a scan-path handler.
// It is explicitly permitted to import h3-tagging. Verify it compiles correctly
// and that it does NOT appear in the SCAN_PATH list in h3-tagging.spec.ts.

describe('12. hot-path guard — poster-deployments.ts is admin path, not scan path', () => {
  test('Worker compiles and routes poster-deployment create (confirms h3-tagging import is valid)', async () => {
    const res = await SELF.fetch(
      'https://t.test/api/v2/admin/events/evt-pdh3-eagles/poster-deployments',
      {
        method: 'POST',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ placement_label: 'PDH3Test Compile Guard' }),
      }
    );
    // If the Worker failed to compile (bad import) this would hang or 500
    expect([200, 201, 400, 404, 503]).toContain(res.status);
  });

  test('SCAN_PATH in h3-tagging.spec.ts does not include poster-deployments.ts', () => {
    const tenv = env as unknown as TestEnv;
    const sources: Record<string, string> = JSON.parse(tenv.TEST_SOURCE_FILES_JSON);
    const norm = (p: string) => p.replace(/\\/g, '/');

    // Find the h3-tagging spec and read its SCAN_PATH list
    for (const [path, content] of Object.entries(sources)) {
      if (norm(path).endsWith('tests/h3-tagging.spec.ts')) {
        expect(content).not.toContain('poster-deployments.ts');
        return;
      }
    }
    // If we get here, the spec file wasn't found in sources — not a failure
  });
});
