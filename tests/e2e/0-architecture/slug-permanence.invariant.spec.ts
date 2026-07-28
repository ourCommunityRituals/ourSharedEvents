/**
 * INVARIANT 18: QR Code URL / Slug Permanence
 *
 * Brain Invariant #18 (slug_permanence):
 *   - status: live (structural gate is the enforcement mechanism)
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *
 * Every event slug is printed on physical posters as part of a QR code URL.
 * Once a poster is deployed, the QR code is permanent — the URL it encodes
 * cannot be changed without silently breaking every scanned or memorised link.
 * The slug must be write-once: set at event creation, never modifiable.
 *
 * If the slug were mutable:
 *   - A live poster URL returns 404 on the next event lookup
 *   - Check-in scans at the door fail silently (attendees can't check in)
 *   - ShortCodes linked to the old slug break
 *   - The NCR scan pipeline loses its accumulation anchor
 *
 * What this spec locks:
 *   (a) No migration modifies the slug column on the events table (ALTER TABLE,
 *       RENAME COLUMN, DROP COLUMN slug — any structural mutation)
 *   (b) The UPDATE event handler's allowedFields does NOT include 'slug'
 *       (the write-once gate at the API layer)
 *   (c) No raw `UPDATE events SET ... slug` literal appears in any handler
 *       (belt-and-suspenders: catches a direct SQL mutation that bypasses
 *       the allowedFields guard)
 *   (d) The CREATE handler does include slug in the INSERT column list
 *       (proves slug is set at creation — the only sanctioned write)
 *   (e) A UNIQUE index or constraint on slug exists (prevents slug reuse
 *       across events, which would make QR destination ambiguous)
 *
 * Pattern reference: tenant-isolation.invariant.spec.ts (same L0 structural
 * approach reading migrations and handler source via node:fs).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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
const HANDLERS_DIR = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'handlers');

test.describe('Invariant 18: QR Code URL / Slug Permanence — structural code-shape lock', () => {
  test('OSE-INV18 | poster | schema | no migration performs a structural mutation of the slug column', () => {
    const sqlFiles = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of sqlFiles) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      // ALTER TABLE events ... slug covers: ADD COLUMN slug (would be fine only
      // if it's the initial definition, which is in 0001_create_events.sql and
      // is CREATE TABLE not ALTER TABLE), RENAME COLUMN slug, DROP COLUMN slug,
      // MODIFY COLUMN slug (SQLite syntax: ALTER TABLE t RENAME COLUMN old TO new).
      //
      // 0001_create_events.sql uses CREATE TABLE, not ALTER TABLE — so no
      // migration should ever touch the slug column via ALTER TABLE.
      const slugAlter = /ALTER\s+TABLE\s+events\b[^;]*\bslug\b/i.test(sql);
      expect(
        slugAlter,
        `migration ${file} contains an ALTER TABLE events ... slug statement — ` +
          'the slug column is write-once; any structural mutation breaks printed QR code URLs'
      ).toBe(false);
    }
  });

  test('OSE-INV18 | poster | api | slug is NOT in the UPDATE handler allowedFields (write-once gate)', () => {
    expect(existsSync(EVENTS_HANDLER), 'handlers/events.ts must exist').toBe(true);
    const src = readFileSync(EVENTS_HANDLER, 'utf8');

    // Find the allowedFields block in handleUpdateEvent. The block lists every
    // field that PATCH /api/v2/admin/events/:id is permitted to modify.
    // slug must never appear here — it is set at CREATE and is immutable after.
    //
    // Strategy: extract the allowedFields object literal and assert 'slug' is
    // not a key. We match from "allowedFields" to the closing "};" pattern.
    const match = src.match(/const allowedFields[^=]*=\s*\{([^}]+)\}/s);
    expect(
      match,
      'handleUpdateEvent must declare an allowedFields object — ' +
        'this is the API-layer write gate that prevents unauthorized field mutations'
    ).toBeTruthy();

    const allowedBlock = match![1];
    // 'slug': or slug: would make slug mutable via the PATCH endpoint
    expect(
      allowedBlock,
      "allowedFields must NOT include 'slug' — " +
        'the slug is printed on physical posters and must never be changed after event creation'
    ).not.toMatch(/\bslug\b/);
  });

  test('OSE-INV18 | poster | api | no handler contains a raw UPDATE events SET ... slug literal', () => {
    const handlerFiles = readdirSync(HANDLERS_DIR)
      .filter((f) => f.endsWith('.ts'))
      .sort();

    for (const file of handlerFiles) {
      const src = readFileSync(join(HANDLERS_DIR, file), 'utf8');
      // Catches any direct `UPDATE events SET ... slug = ?` SQL literal that
      // would bypass the allowedFields guard. Template literals, string
      // concatenation, and `prepare()` calls are all covered by this regex.
      const hasSlugUpdate = /UPDATE\s+events\s+SET[^;]*\bslug\s*=/i.test(src);
      expect(
        hasSlugUpdate,
        `handlers/${file} contains a raw UPDATE events SET ... slug = statement — ` +
          'slug is write-once; use the allowedFields pattern in handleUpdateEvent and omit slug'
      ).toBe(false);
    }
  });

  test('OSE-INV18 | poster | api | CREATE handler includes slug in the INSERT column list (write happens at creation)', () => {
    const src = readFileSync(EVENTS_HANDLER, 'utf8');
    // Positive assertion: slug IS set at creation. If slug disappeared from
    // the INSERT, every new event would have a NULL slug, breaking all QR URLs
    // from day one. This test catches the opposite failure: slug was removed
    // from the INSERT by mistake.
    expect(
      src,
      'INSERT INTO events must include slug in the column list — ' +
        'slug is set once at event creation; its absence from INSERT would leave it NULL'
    ).toMatch(/INSERT\s+INTO\s+events\s*\([^)]*slug/i);
  });

  test('OSE-INV18 | poster | schema | a UNIQUE constraint or index on slug exists to prevent ambiguous QR destinations', () => {
    // Check all migration files for a UNIQUE index on slug. The index can be:
    //   - CREATE UNIQUE INDEX ... ON events (slug, ...)
    //   - UNIQUE (slug) inside CREATE TABLE events
    const sqlFiles = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let foundUnique = false;
    for (const file of sqlFiles) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      // Covers both forms:
      //   CREATE UNIQUE INDEX ... ON events(slug) — slug after UNIQUE
      //   slug TEXT NOT NULL UNIQUE — UNIQUE after slug (inline column constraint)
      if (/UNIQUE[^;]*\bslug\b|\bslug\b[^;\n]*\bUNIQUE\b/i.test(sql)) {
        foundUnique = true;
        break;
      }
    }
    expect(
      foundUnique,
      'migrations must define a UNIQUE constraint or index on the events.slug column — ' +
        'without uniqueness, two events could share a slug making the QR destination ambiguous'
    ).toBe(true);
  });
});
