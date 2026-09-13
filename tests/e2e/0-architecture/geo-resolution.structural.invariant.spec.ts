/**
 * INVARIANT 2: Hyper-Local Geo-Resolution — STRUCTURAL code-shape lock (L0)
 *
 * This is the PR-gating structural complement to geo-resolution.invariant.spec.ts.
 * That sibling is a live-worker (runtime) spec — it drives a deployed worker and
 * therefore runs ONLY in T4 Functional, skipping on PRs. So invariant #2 was
 * `status: live` in the brain with NO PR-gating enforcement of its load-bearing
 * code shape. A refactor of the resolver could silently break corridor-level
 * matching and every PR check would stay green until a deploy. (OSE-1298 / F9.)
 *
 * This spec reads the source via node:fs and asserts the resolution engine's
 * load-bearing shape. It needs NO deployed worker, so it runs in the T0 Gate
 * `invariants` shard on every PR + push. It does NOT replace the runtime spec —
 * it adds the structural gate alongside it.
 *
 * Brain Invariant #2 (hyper_local_geo_resolution):
 *   - status: live · brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *
 * What #2 guarantees (the shape asserted here):
 *   - Path 1 (Direct):     an active placement with sp.event_id = eventId resolves.
 *   - Path 2 (Template+Geo): a business subscribed to the event's template_id AND
 *                            in a matching area (zip OR radius) resolves.
 *   - Two-sided acceptance:  a REJECTED placement (accepted = 0) is hidden (0068).
 *   - Business lifecycle:    both paths require the business itself is_active = 1.
 *   - Deduplication:         the same sponsor via both paths appears once.
 *
 * Source of truth (asserted here):
 *   - workers/oursharedevents/src/lib/sponsor-resolver.ts
 *   - migrations/0019_create_sponsor_event_types.sql  (template subscription join)
 *   - migrations/0020_create_sponsor_areas.sql         (hyperlocal geo targeting)
 *   - migrations/0021_add_geo_to_events.sql            (events carry zip/lat/lon)
 *
 * Pattern reference: tenant-isolation.invariant.spec.ts (same readFileSync L0
 * structural approach).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKER_ROOT = join(REPO_ROOT, 'workers', 'oursharedevents');
const MIGRATIONS_DIR = join(WORKER_ROOT, 'migrations');
const RESOLVER = join(WORKER_ROOT, 'src', 'lib', 'sponsor-resolver.ts');

test.describe('Invariant 2: Hyper-Local Geo-Resolution — structural code-shape lock', () => {
  // ── Schema atoms the resolution engine reads ────────────────────────────────

  test('OSE-INV2 | schema | 0019 creates sponsor_event_types with sponsor_id + template_id', () => {
    const migration = join(MIGRATIONS_DIR, '0019_create_sponsor_event_types.sql');
    expect(existsSync(migration), '0019_create_sponsor_event_types.sql must exist').toBe(true);
    const sql = readFileSync(migration, 'utf8');
    // The template-subscription join table is Path 2's left edge: without it a
    // business cannot say "sponsor every event of this template".
    expect(sql, '0019 must create sponsor_event_types').toMatch(
      /CREATE TABLE[^;]*sponsor_event_types/i
    );
    expect(sql, 'sponsor_event_types must carry sponsor_id').toMatch(
      /sponsor_id\s+TEXT\s+NOT\s+NULL/i
    );
    expect(sql, 'sponsor_event_types must carry template_id').toMatch(
      /template_id\s+TEXT\s+NOT\s+NULL/i
    );
    // A sponsor subscribes to a template once — the resolver relies on this.
    expect(sql, 'sponsor_event_types must be unique per (sponsor_id, template_id)').toMatch(
      /UNIQUE\s*\(\s*sponsor_id\s*,\s*template_id\s*\)/i
    );
  });

  test('OSE-INV2 | schema | 0020 creates sponsor_areas with zip OR lat/lon+radius', () => {
    const migration = join(MIGRATIONS_DIR, '0020_create_sponsor_areas.sql');
    expect(existsSync(migration), '0020_create_sponsor_areas.sql must exist').toBe(true);
    const sql = readFileSync(migration, 'utf8');
    expect(sql, '0020 must create sponsor_areas').toMatch(/CREATE TABLE[^;]*sponsor_areas/i);
    // The two geo-match dimensions the resolver evaluates: zip equality OR a
    // lat/lon centre with a radius. Both columns must exist for both paths to work.
    expect(sql, 'sponsor_areas must carry zip_code').toMatch(/\bzip_code\b/i);
    expect(sql, 'sponsor_areas must carry lat').toMatch(/\blat\b/i);
    expect(sql, 'sponsor_areas must carry lon').toMatch(/\blon\b/i);
    expect(sql, 'sponsor_areas must carry radius_miles (the radius-match dimension)').toMatch(
      /\bradius_miles\b/i
    );
  });

  test('OSE-INV2 | schema | 0021 adds zip_code + lat + lon to events', () => {
    const migration = join(MIGRATIONS_DIR, '0021_add_geo_to_events.sql');
    expect(existsSync(migration), '0021_add_geo_to_events.sql must exist').toBe(true);
    const sql = readFileSync(migration, 'utf8');
    // An event with no geo can't be matched against a sponsor_area. These three
    // ALTERs are what let the resolver compare event ⨯ area.
    expect(sql, '0021 must add zip_code to events').toMatch(
      /ALTER\s+TABLE\s+events\s+ADD\s+COLUMN\s+zip_code/i
    );
    expect(sql, '0021 must add lat to events').toMatch(
      /ALTER\s+TABLE\s+events\s+ADD\s+COLUMN\s+lat/i
    );
    expect(sql, '0021 must add lon to events').toMatch(
      /ALTER\s+TABLE\s+events\s+ADD\s+COLUMN\s+lon/i
    );
  });

  // ── Resolver code shape — the two resolution paths + their guards ────────────

  test('OSE-INV2 | resolver | file exists and exports resolveSponsorsForEvent', () => {
    expect(existsSync(RESOLVER), 'sponsor-resolver.ts must exist').toBe(true);
    const src = readFileSync(RESOLVER, 'utf8');
    expect(
      src,
      'the resolver must export resolveSponsorsForEvent — the single #2 entry point'
    ).toMatch(/export\s+async\s+function\s+resolveSponsorsForEvent\s*\(/);
  });

  test('OSE-INV2 | resolver | Path 1 Direct binds sp.event_id = ? and requires both sides active', () => {
    const src = readFileSync(RESOLVER, 'utf8');
    // Direct path: a placement whose event_id IS this event, always included.
    expect(
      src,
      'direct path must scope placements to this event via `sp.event_id = ?` — ' +
        'without it every event would resolve every direct placement'
    ).toMatch(/WHERE\s+sp\.event_id\s*=\s*\?/i);
    // Both the placement and the underlying business must be active — soft-
    // deleting a business must remove it from Path 1 (0068 lifecycle).
    expect(src, 'direct path must require sp.is_active = 1').toMatch(/sp\.is_active\s*=\s*1/i);
    expect(src, 'direct path must require sb.is_active = 1 (business lifecycle, 0068)').toMatch(
      /sb\.is_active\s*=\s*1/i
    );
  });

  test('OSE-INV2 | resolver | Path 1 consent-trace: organizer permissive, sponsor STRICT (OSE-1301 supersedes 0068)', () => {
    const src = readFileSync(RESOLVER, 'utf8');
    // OSE-1301 reconciliation (ratified 2026-09-13): "silence never becomes
    // consent." The two acceptance columns encode two DIFFERENT acts, so the
    // Path-1 (direct) query gives them different defaults:
    //   ORGANIZER — creating the placement IS the pick (leg 1); silence is
    //     permissive, so the guard COALESCEs to 1. Only an explicit reject (0) hides.
    //   SPONSOR — must confirm its own appearance (leg 3); silence is NOT consent,
    //     so the guard is a STRICT `= 1`. An unconfirmed (NULL) placement does NOT
    //     render. This SUPERSEDES the old permissive COALESCE(sp.sponsor_accepted,1)=1
    //     rule this test used to lock — that flip is the whole point of OSE-1301.
    expect(
      src,
      'organizer acceptance must stay COALESCE(sp.organizer_accepted, 1) = 1 — the organizer pick is implied by creation'
    ).toMatch(/COALESCE\s*\(\s*sp\.organizer_accepted\s*,\s*1\s*\)\s*=\s*1/i);
    expect(
      src,
      'sponsor acceptance must be STRICT `sp.sponsor_accepted = 1` (no COALESCE) — OSE-1301: silence is not consent'
    ).toMatch(/(?<!COALESCE\s*\(\s*)\bsp\.sponsor_accepted\s*=\s*1/i);
    expect(
      src,
      'the old permissive COALESCE(sp.sponsor_accepted, 1) must be GONE from Path 1 — it is the defect OSE-1301 corrects'
    ).not.toMatch(/COALESCE\s*\(\s*sp\.sponsor_accepted\s*,\s*1\s*\)/i);
  });

  test('OSE-INV2 | resolver | Path 2 Template+Geo is gated on template_id and joins sponsor_event_types', () => {
    const src = readFileSync(RESOLVER, 'utf8');
    // Path 2 only runs when the event has a template — a template-less event
    // resolves direct placements only.
    expect(src, 'Path 2 must be gated on event.template_id').toMatch(
      /if\s*\(\s*event\.template_id\s*\)/
    );
    // The subscription join + the template filter are Path 2's core.
    expect(src, 'Path 2 must join sponsor_event_types').toMatch(/JOIN\s+sponsor_event_types/i);
    expect(src, 'Path 2 must filter on the event template via st.template_id = ?').toMatch(
      /st\.template_id\s*=\s*\?/i
    );
  });

  test('OSE-INV2 | resolver | geo match evaluates zip equality OR haversine radius', () => {
    const src = readFileSync(RESOLVER, 'utf8');
    // The area filter is "zip match OR within radius". Both dimensions must be
    // present — dropping either narrows or widens corridor matching silently.
    expect(src, 'geo match must compare area.zip_code to event.zip_code').toMatch(
      /area\.zip_code\s*===?\s*event\.zip_code/
    );
    expect(src, 'the resolver must compute a haversine distance for radius matching').toMatch(
      /haversineDistanceMiles\s*\(/
    );
    expect(src, 'radius match must compare the distance against radius_miles').toMatch(
      /<=\s*\(?\s*area\.radius_miles/i
    );
  });

  test('OSE-INV2 | resolver | results are deduplicated by sponsor id (both paths → one row)', () => {
    const src = readFileSync(RESOLVER, 'utf8');
    // A sponsor that qualifies via BOTH the direct and template+geo paths must
    // appear once. The dedup is a Set keyed by sponsor id over the concatenated
    // path results.
    expect(src, 'the resolver must maintain a seen-set for dedup').toMatch(
      /new\s+Set<string>\s*\(/
    );
    expect(src, 'the resolver must skip sponsors already seen (dedup across both paths)').toMatch(
      /seen\.has\s*\(\s*s\.id\s*\)/
    );
  });
});
