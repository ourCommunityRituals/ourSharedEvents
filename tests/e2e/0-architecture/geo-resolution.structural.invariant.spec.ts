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
// Every public sponsor render path that carries the strict-consent gate (ADR-019).
const PUBLIC_CONSENT_PATHS = [
  RESOLVER,
  join(WORKER_ROOT, 'src', 'handlers', 'pages.ts'),
  join(WORKER_ROOT, 'src', 'handlers', 'sponsors.ts'),
];

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

  test('OSE-INV2 | resolver | acceptance is ASYMMETRIC: organizer permissive, sponsor strict (ADR-019)', () => {
    const src = readFileSync(RESOLVER, 'utf8');
    // ADR-019 "silence != consent" (CCR-PR567 M4). The ORGANIZER side stays
    // PERMISSIVE — they created the placement, so unanswered (NULL) must not
    // hide → COALESCE(...organizer_accepted,1)=1. The SPONSOR side is STRICT —
    // a placement renders publicly only when the sponsor explicitly accepted
    // (= 1); NULL (pending) and 0 (declined) both hide. A permissive COALESCE on
    // the sponsor side would re-open the pre-ADR-019 non-consented-render leak.
    expect(
      src,
      'organizer acceptance must be COALESCE(sp.organizer_accepted, 1) = 1 — organizer silence is consent'
    ).toMatch(/COALESCE\s*\(\s*sp\.organizer_accepted\s*,\s*1\s*\)\s*=\s*1/i);
    expect(
      src,
      'sponsor acceptance must be STRICT sp.sponsor_accepted = 1 (ADR-019: sponsor silence is NOT consent)'
    ).toMatch(/\bsp\.sponsor_accepted\s*=\s*1/i);
    expect(
      src,
      'sponsor side must NOT be COALESCE-permissive — that was the pre-ADR-019 leak'
    ).not.toMatch(/COALESCE\s*\(\s*sp\.sponsor_accepted\s*,\s*1\s*\)/i);
  });

  test('OSE-INV2 | resolver | Path 2 is dark-at-launch (flag-gated) + template-gated + brand-fenced', () => {
    const src = readFileSync(RESOLVER, 'utf8');
    // Path 2 (template+geo auto-match) is OFF by default (ADR-019 dark-at-launch,
    // CCR-PR567 M4): it must be gated on BOTH the geoMatchEnabled flag AND the
    // event's template, so a non-consented template subscriber never renders
    // publicly at launch.
    expect(src, 'Path 2 must be gated on the geoMatchEnabled flag AND event.template_id').toMatch(
      /if\s*\(\s*opts\.geoMatchEnabled\s*&&\s*event\.template_id\s*\)/
    );
    // The subscription join + the template filter are Path 2's core.
    expect(src, 'Path 2 must join sponsor_event_types').toMatch(/JOIN\s+sponsor_event_types/i);
    expect(src, 'Path 2 must filter on the event template via st.template_id = ?').toMatch(
      /st\.template_id\s*=\s*\?/i
    );
    // Tenant fence (INV #9): a template subscriber from another brand must not
    // render on this brand's event — the Path 2 query binds sb.brand_id.
    expect(src, 'Path 2 must fence on sb.brand_id = ? (tenant isolation)').toMatch(
      /sb\.brand_id\s*=\s*\?/i
    );
  });

  test('OSE-INV2 | consent | strict sponsor_accepted = 1 on EVERY public render path; no COALESCE regression (ADR-019)', () => {
    // Strict consent (ADR-019, CCR-PR567 M4) lives in three ungated SQL literals:
    // the resolver Path-1, the public event-page sponsor strip (pages.ts), and the
    // geo/h3 sponsor lookup (sponsors.ts). A COALESCE(...sponsor_accepted,1)
    // reintroduction on ANY of them re-opens the non-consented-render leak — the
    // exact regression the CCR re-run caught. Lock all three by source shape.
    for (const path of PUBLIC_CONSENT_PATHS) {
      const src = readFileSync(path, 'utf8');
      expect(src, `${path} must gate public render on strict sp.sponsor_accepted = 1`).toMatch(
        /\bsp\.sponsor_accepted\s*=\s*1/i
      );
      expect(
        src,
        `${path} must NOT COALESCE the sponsor side permissive — that is the pre-ADR-019 leak`
      ).not.toMatch(/COALESCE\s*\(\s*sp\.sponsor_accepted\s*,\s*1\s*\)/i);
    }
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
