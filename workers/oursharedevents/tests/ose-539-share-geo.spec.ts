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
  test('pages.ts has dark mode CSS (prefers-color-scheme: dark)', () => {
    expect(sourceFile('handlers/pages.ts')).toContain('prefers-color-scheme: dark');
  });
  test('pages.ts uses geo: URI scheme for lat/lon', () => {
    expect(sourceFile('handlers/pages.ts')).toContain('geo:');
  });
  test('pages.ts has Spanish share label', () => {
    expect(sourceFile('handlers/pages.ts')).toContain('Compartir este evento');
  });
  test('pages.ts uses Web Share API (navigator.share)', () => {
    expect(sourceFile('handlers/pages.ts')).toContain('navigator.share');
  });
  test('pages.ts has clipboard fallback', () => {
    expect(sourceFile('handlers/pages.ts')).toContain('navigator.clipboard');
  });
  test('pages.ts no longer uses Google Maps search link (replaced by geo: / Apple Maps)', () => {
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

  test('geo-link uses geo: URI when lat/lon present', async () => {
    const id = await createEventWithGeo('Geo Event', 40.7128, -74.006, 'Eagles Hall');
    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('data-testid="geo-link"');
    expect(html).toContain('geo:40.7128,-74.006');
  });

  test('geo-link falls back to Apple Maps when no lat/lon', async () => {
    const id = await createEventWithGeo(
      'Address Only Event',
      undefined,
      undefined,
      '123 Main St Philadelphia PA'
    );
    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('data-testid="geo-link"');
    expect(html).toContain('maps.apple.com');
  });

  test('Spanish share label rendered for Accept-Language: es', async () => {
    const id = await createEventWithGeo('Spanish Event');
    const res = await SELF.fetch(`https://t.test/events/${id}`, {
      headers: { 'Accept-Language': 'es-MX,es;q=0.9' },
    });
    const html = await res.text();
    expect(html).toContain('Compartir este evento');
  });

  test('dark mode CSS present in pre-event page', async () => {
    const id = await createEventWithGeo('Dark Mode Test');
    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain('prefers-color-scheme: dark');
  });

  test('share button has data-share-url attribute with event URL', async () => {
    const id = await createEventWithGeo('URL Attribute Test');
    const res = await SELF.fetch(`https://t.test/events/${id}`);
    const html = await res.text();
    expect(html).toContain(`data-share-url="https://t.test/events/${id}"`);
  });
});
