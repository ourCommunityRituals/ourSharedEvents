/**
 * INVARIANT 9: Tenant Isolation
 *
 * Every multi-tenant table must carry brand_id TEXT NOT NULL. Every public
 * query that returns a list of records must scope that list to a single brand.
 * No cross-tenant data leakage through list endpoints.
 *
 * Brain Invariant #9 (tenant_isolation):
 *   - status: partial → live once this spec is in the T0 shard (2026-07-26)
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *
 * Dual-key isolation pattern:
 *   Each tenant entity is identified by both a content ID (UUID) and a brand_id
 *   (lowercase slug). The events table is the primary multi-tenant table. The
 *   NCR tables (node_hierarchy, corridors) also carry brand_id. This pattern
 *   ensures that even if an ID were guessed, the record cannot be used in a
 *   cross-brand context (the brand_id is visible in every projected row).
 *
 * Pyramid coverage for this invariant:
 *   L0 STATIC (this file)   — schema shape: brand_id on multi-tenant tables;
 *                             public list queries use WHERE brand_id = ?;
 *                             INSERT enforces brand_id column
 *   T4 (planned)            — runtime cross-brand isolation spec against
 *                             staging: two brand slugs, verify brand A cannot
 *                             read brand B events from the public list endpoint
 *
 * Design note — single-event GET by ID (handleGetEvent):
 *   The GET /api/v2/events/:id endpoint fetches by WHERE id = ? (UUID) only.
 *   The UUID is unguessable, so cross-brand leakage requires knowing another
 *   brand's event UUIDs. This is an accepted risk at the current OSE phase
 *   (single-brand deployments, no adversarial multi-tenancy). The T4 runtime
 *   spec should verify that the response includes brand_id in the payload so
 *   consumers can detect and reject off-brand responses.
 *
 * Pattern reference: aggregate-only.invariant.spec.ts (same readFileSync
 * L0 structural approach using Playwright with Node fs access).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'workers', 'oursharedevents', 'migrations');
const EVENTS_HANDLER = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'handlers',
  'events.ts'
);
const ROUTER = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'router.ts');

test.describe('Invariant 9: Tenant Isolation — structural code-shape lock', () => {
  test('OSE-INV9 | security | schema | migration 0001 defines brand_id TEXT NOT NULL on events', () => {
    const migration = join(MIGRATIONS_DIR, '0001_create_events.sql');
    expect(existsSync(migration), '0001_create_events.sql must exist').toBe(true);
    const sql = readFileSync(migration, 'utf8');
    expect(
      sql,
      '0001_create_events.sql must define brand_id TEXT NOT NULL — ' +
        'the events table is the primary multi-tenant surface'
    ).toMatch(/brand_id\s+TEXT\s+NOT\s+NULL/i);
  });

  test('OSE-INV9 | security | schema | migration 0007 creates composite index on (brand_id, status)', () => {
    const migration = join(MIGRATIONS_DIR, '0007_create_indexes.sql');
    expect(existsSync(migration), '0007_create_indexes.sql must exist').toBe(true);
    const sql = readFileSync(migration, 'utf8');
    // Composite index on (brand_id, status) is the performance gate for the
    // WHERE brand_id = ? AND status = 'active' query pattern.
    expect(
      sql,
      '0007 must create a composite index on (brand_id, status) — ' +
        'without this index, tenant-scoped public list queries do full table scans'
    ).toMatch(/ON\s+events\s*\(\s*brand_id\s*,\s*status\s*\)/i);
  });

  test('OSE-INV9 | security | schema | migration 0010 carries brand_id on NCR node_hierarchy', () => {
    const migration = join(MIGRATIONS_DIR, '0010_create_ncr_v2_hierarchy.sql');
    expect(existsSync(migration), '0010_create_ncr_v2_hierarchy.sql must exist').toBe(true);
    const sql = readFileSync(migration, 'utf8');
    // NCR tables must be tenant-isolated so reports are brand-scoped.
    const lines = sql.split('\n');
    let inNodeHierarchy = false;
    let foundBrandId = false;
    for (const line of lines) {
      if (/CREATE TABLE.*node_hierarchy/i.test(line)) inNodeHierarchy = true;
      if (inNodeHierarchy && /^\s*\)/i.test(line)) inNodeHierarchy = false;
      if (inNodeHierarchy && /brand_id\s+TEXT\s+NOT\s+NULL/i.test(line)) {
        foundBrandId = true;
        break;
      }
    }
    expect(
      foundBrandId,
      'node_hierarchy table in 0010 must define brand_id TEXT NOT NULL — ' +
        'NCR tables are multi-tenant and must carry tenant scope'
    ).toBe(true);
  });

  test('OSE-INV9 | security | schema | migration 0010 carries brand_id on NCR corridors', () => {
    const migration = join(MIGRATIONS_DIR, '0010_create_ncr_v2_hierarchy.sql');
    const sql = readFileSync(migration, 'utf8');
    const lines = sql.split('\n');
    let inCorridors = false;
    let foundBrandId = false;
    for (const line of lines) {
      if (/CREATE TABLE.*\bcorridors\b/i.test(line)) inCorridors = true;
      if (inCorridors && /^\s*\)/i.test(line)) inCorridors = false;
      if (inCorridors && /brand_id\s+TEXT\s+NOT\s+NULL/i.test(line)) {
        foundBrandId = true;
        break;
      }
    }
    expect(
      foundBrandId,
      'corridors table in 0010 must define brand_id TEXT NOT NULL — ' +
        'corridor data is brand-scoped to prevent cross-tenant report leakage'
    ).toBe(true);
  });

  test('OSE-INV9 | security | query | public list (handleListEvents) uses WHERE brand_id = ? filter', () => {
    expect(existsSync(EVENTS_HANDLER), 'handlers/events.ts must exist').toBe(true);
    const src = readFileSync(EVENTS_HANDLER, 'utf8');
    // The canonical public list query scopes by both brand AND status.
    // This is the primary cross-tenant isolation gate for public surfaces.
    expect(
      src,
      'handleListEvents must use WHERE brand_id = ? — ' +
        'the public list is the highest-traffic surface; without this filter every tenant sees every brand'
    ).toMatch(/WHERE\s+brand_id\s*=\s*\?\s+AND\s+status\s*=\s*'active'/i);
  });

  test('OSE-INV9 | security | insert | CREATE event includes brand_id in column list', () => {
    const src = readFileSync(EVENTS_HANDLER, 'utf8');
    // Every new event row must have a brand_id — the NOT NULL constraint in
    // the migration is the database-level gate; this test asserts that the
    // INSERT statement in code includes brand_id explicitly.
    expect(
      src,
      'INSERT INTO events must name brand_id in the column list — ' +
        'if brand_id were omitted, the insert would fail the NOT NULL constraint at runtime only'
    ).toMatch(/INSERT\s+INTO\s+events\s*\([^)]*brand_id/i);
  });

  test('OSE-INV9 | security | brand_id | brand_id is validated (lowercase alphanumeric) before INSERT', () => {
    const src = readFileSync(EVENTS_HANDLER, 'utf8');
    // Input validation is the entry-point gate — malformed brand IDs (XSS
    // payloads, path traversal attempts) are rejected before they reach D1.
    expect(
      src,
      'events.ts must validate brand_id format — ' +
        'accepting arbitrary brand IDs would allow injection via the tenant key'
    ).toMatch(/brand_id.*must be.*alphanumeric|alphanumeric.*brand_id/i);
  });

  // ── Admin HTTP-Layer Isolation ──────────────────────────────────────────────
  // The data-layer isolation tests above assert brand_id scoping in queries.
  // These tests assert the HTTP-layer complement: every admin route in router.ts
  // must call requireAdmin before executing any handler logic. A route added to
  // the /admin or /api/v2/admin namespace without the guard silently bypasses
  // authentication — exposing event management, PII audit logs, and sponsor data
  // to unauthenticated callers. Closing both layers (data + HTTP) is what makes
  // the tenant isolation contract complete.

  test('OSE-INV9 | security | auth | router.ts imports requireAdmin from auth module', () => {
    expect(existsSync(ROUTER), 'workers/oursharedevents/src/router.ts must exist').toBe(true);
    const src = readFileSync(ROUTER, 'utf8');
    expect(
      src,
      'router.ts must import requireAdmin — the absence of this import means no admin route has an auth guard'
    ).toMatch(/import\s*\{[^}]*requireAdmin[^}]*\}\s*from/);
  });

  test('OSE-INV9 | security | auth | every admin route calls requireAdmin within 20 lines of the route definition', () => {
    const src = readFileSync(ROUTER, 'utf8');
    const lines = src.split('\n');

    // Admin route definitions: lines that define a pathname check for /admin or /api/v2/admin.
    // Covers both exact matches (pathname === '/admin') and regex patterns
    // (const adminXMatch = pathname.match(/^\/api\/v2\/admin/)).
    const adminRoutePattern =
      /pathname\s*(?:===|\.match\s*\()\s*(?:'|"|\/).*\/admin|const\s+admin\w+Match\s*=\s*pathname\.match/;

    const adminRouteLines: number[] = [];
    const requireAdminLines: number[] = [];

    lines.forEach((line, i) => {
      if (adminRoutePattern.test(line)) adminRouteLines.push(i);
      if (/requireAdmin\s*\(/.test(line)) requireAdminLines.push(i);
    });

    expect(
      adminRouteLines.length,
      'expected at least 10 admin route definitions in router.ts — if this fails the pattern matcher needs updating'
    ).toBeGreaterThan(9);

    // For each admin route definition, assert requireAdmin appears within 20 lines.
    // 20 lines is enough for any single-method handler block; multi-method blocks
    // (like adminEventMatch) have requireAdmin inside each method branch, always
    // within 20 lines of the outer pathname.match check.
    for (const routeLine of adminRouteLines) {
      const hasAuth = requireAdminLines.some((n) => n > routeLine && n <= routeLine + 20);
      expect(
        hasAuth,
        `admin route at line ${routeLine + 1} (${lines[routeLine].trim()}) does not call requireAdmin within the next 20 lines — ` +
          'every /admin and /api/v2/admin route MUST call requireAdmin before any handler logic'
      ).toBe(true);
    }
  });
});
