/**
 * OSE-539: Share affordance + universal geo link on public event pages.
 *
 * L1 Static: source file checks (share-btn, geo-link, dark mode CSS present)
 * L2 Integration: SELF.fetch — share button and geo link rendered correctly
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;
const MOCK_ADMIN_KEY = 'test-admin-key-e2e-2026';

function sourceFile(suffix: string): string {
  const files: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  const key = Object.keys(files).find((k) => k.replace(/\\/g, '/').endsWith(suffix));
  return key ? files[key] : '';
}

beforeAll(async () => {
  const mainStmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of mainStmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
  const formsStmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of formsStmts) {
    try {
      await tenv().FORMS_DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
});

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function createEventWithGeo(
  title: string,
  lat?: number,
  lon?: number,
  location?: string
): Promise<string> {
  // Set start_date 7 days in the future so the event is always in pre_event phase.
  // Events without start_date fall into 'event' (live) phase per event-phase.ts
  // no_dates_status_active rule, which uses a different geo-link testid.
  // API only accepts YYYY-MM-DD date format (ISO_DATE_PATTERN).
  const futureStart = toDateOnly(new Date(Date.now() + 7 * 86400000));
  const futureEnd = toDateOnly(new Date(Date.now() + 8 * 86400000));
  const res = await SELF.fetch('https://t.test/api/v2/admin/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${MOCK_ADMIN_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      status: 'active',
      // OSE-1560: a new event is off the map unless asked.
      is_published: true,
      start_date: futureStart,
      end_date: futureEnd,
      lat: lat ?? null,
      lon: lon ?? null,
      location: location ?? null,
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as Record<string, unknown>;
  return body.id as string;
}

// L1 Static
describe('OSE-539 L1: static source checks', () => {
  test('pages.ts has share-btn testid', () => {
    expect(sourceFile('handlers/pages.ts')).toContain('share-btn');
  });
  test('pages.ts has geo-link testid', () => {
    expect(sourceFile('handlers/pages.ts')).toContain('geo-link');
  });
  test('pages.ts wires dark mode via the /ui.css role-token stylesheet (OSE-655 A2)', () => {
    // OSE-655 A2 migration: dark mode moved from an inline
    // `prefers-color-scheme: dark` block to the @ocr/ui role tokens served at
    // /ui.css (per-mode light/dark values). pages.ts links that stylesheet; the
    // dark support is covered by tests/public-surface-swappable.spec.ts.
    expect(sourceFile('handlers/pages.ts')).toContain('/ui.css');
  });
  test('pages.ts builds the directions via the extracted renderGeoLink helper (OSE-660)', () => {
    // OSE-660: the directions builder lives in src/lib/geo-link.ts, where it is
    // unit-tested. Owner 2026-10-11: it offers Google Maps and Apple Maps.
    expect(sourceFile('handlers/pages.ts')).toContain('renderGeoLink');
    expect(sourceFile('lib/geo-link.ts')).toContain('https://www.google.com/maps/search/');
    expect(sourceFile('lib/geo-link.ts')).toContain('https://maps.apple.com/');
  });
  // OSE-1760: the label moved out of an inline ternary into the language catalog.
  // Same intent (a Spanish share label exists and the page uses it), one level down.
  test('the catalog has the Spanish share label, and pages.ts reads it', () => {
    expect(sourceFile('lib/i18n/catalog.ts')).toContain('Compartir este evento');
    expect(sourceFile('handlers/pages.ts')).toContain("msg(lang, 'share.label')");
  });
  test('pages.ts uses Web Share API (navigator.share)', () => {
    expect(sourceFile('handlers/pages.ts')).toContain('navigator.share');
  });
  test('pages.ts has clipboard fallback', () => {
    expect(sourceFile('handlers/pages.ts')).toContain('navigator.clipboard');
  });
  test('pages.ts does not hardcode the old Google Maps addresses (geo-link.ts builds them)', () => {
    // The old hardcoded gmaps search link should be gone
    expect(sourceFile('handlers/pages.ts')).not.toContain('maps.google.com/maps/search');
    expect(sourceFile('handlers/pages.ts')).not.toContain('maps.google.com/dir');
  });
});

// L2 Integration
describe('OSE-539 L2: pre-event phase', () => {
  test('share button renders in pre-event page', async () => {
    const id = await createEventWithGeo('Share Test Event');
    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('data-testid="share-btn"');
    expect(html).toContain('Share this event');
  });

  test('directions offer Google Maps and Apple Maps at the coordinates when lat/lon present', async () => {
    const id = await createEventWithGeo('Geo Event', 40.7128, -74.006, 'Eagles Hall');
    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('data-testid="geo-link"');
    expect(html).toContain('https://www.google.com/maps/search/?api=1&amp;query=40.7128%2C-74.006');
    expect(html).toContain('https://maps.apple.com/?ll=40.7128,-74.006');
  });

  test('directions search the address on both maps when no lat/lon', async () => {
    const id = await createEventWithGeo(
      'Address Only Event',
      undefined,
      undefined,
      '123 Main St Philadelphia PA'
    );
    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('data-testid="geo-link"');
    expect(html).toContain('https://maps.apple.com/?q=123%20Main%20St');
    expect(html).toContain('https://www.google.com/maps/search/?api=1&amp;query=123%20Main%20St');
  });

  test('Spanish share label rendered for Accept-Language: es', async () => {
    const id = await createEventWithGeo('Spanish Event');
    const res = await SELF.fetch(`https://t.test/events/${id}`, {
      headers: { 'Accept-Language': 'es-MX,es;q=0.9' },
    });
    const html = await res.text();
    expect(html).toContain('Compartir este evento');
  });

  test('pre-event page carries dark-capable theming via the /ui.css role tokens', async () => {
    const id = await createEventWithGeo('Dark Mode Test');
    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    // OSE-655 A2: dark support ships through the linked @ocr/ui stylesheet
    // (role tokens with per-mode values), not an inline prefers-color-scheme block.
    expect(html).toContain('/ui.css');
  });

  test('share button has data-share-url attribute with event URL', async () => {
    const id = await createEventWithGeo('URL Attribute Test');
    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    // OSE-1684: Share hands out the event's short /e/<code> link, so each open
    // counts as a share (what + when, never who). Six characters, no look-alikes.
    expect(html).toMatch(/data-share-url="https:\/\/t\.test\/e\/[A-HJKMNP-Z2-9]{6}"/);
  });
});
