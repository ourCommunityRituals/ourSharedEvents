/**
 * DESIGN-9: Poster QR + short link gate (OSE-103)
 *
 * Verifies that the poster surface generates real QR data URIs and short-form
 * links for all 4 form types (register, checkin, survey, email-signup).
 *
 * Two-medium model:
 *   Physical: QR codes on printed posters/tabletops → server-generated PNG data URIs
 *   Mobile:   same bundle, same links → delivered as tappable anchor href values
 *   Both are set up simultaneously by the organiser; distinction is delivery medium.
 *
 * Pyramid:
 *   L1 Static     — source files contain loadPosterQR, no old placeholder text,
 *                   router wired, handler imports generateQrCode
 *   L2 Integration — SELF.fetch: poster-bundle returns valid PNG data URIs + links
 *                    for all 4 form types; unknown event → 404
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

// ── Test env ──────────────────────────────────────────────────────────────────

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;
const MOCK_ADMIN_KEY = 'test-admin-key-e2e-2026';

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Setup — apply all migrations ──────────────────────────────────────────────

beforeAll(async () => {
  const mainStmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of mainStmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
  const formsStmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of formsStmts) {
    try {
      await tenv().FORMS_DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function sourceFile(suffix: string): string {
  const files: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  // Normalize path separators so both Windows and posix keys match
  const key = Object.keys(files).find((k) => k.replace(/\\/g, '/').endsWith(suffix));
  return key ? files[key] : '';
}

async function createEvent(title: string): Promise<string> {
  const res = await SELF.fetch('https://t.test/api/v2/admin/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MOCK_ADMIN_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, status: 'active' }),
  });
  expect(res.status).toBe(201);
  const body = await json(res);
  return body.id as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// L1 Static: source file integrity checks
// ─────────────────────────────────────────────────────────────────────────────

describe('DESIGN-9 L1: static source file checks', () => {
  test('poster page has NO old qr-placeholder text (placeholder removed)', () => {
    const pages = sourceFile('handlers/pages.ts');
    expect(pages, 'old placeholder text still present').not.toContain(
      'QR codes available after event setup'
    );
    expect(pages, 'qr-placeholder class still present').not.toContain('qr-placeholder');
  });

  test('poster page has loadPosterQR function calling poster-bundle endpoint', () => {
    const pages = sourceFile('templates/poster.html');
    expect(pages).toContain('loadPosterQR');
    expect(pages).toContain('poster-bundle');
  });

  test('poster page renderPoster() has all 4 QR loading item IDs', () => {
    const pages = sourceFile('templates/poster.html');
    expect(pages).toContain('qr-img-register');
    expect(pages).toContain('qr-img-checkin');
    expect(pages).toContain('qr-img-survey');
    expect(pages).toContain('qr-img-email-signup');
  });

  test('poster page calls loadPosterQR in both init() and picker change handler', () => {
    const pages = sourceFile('templates/poster.html');
    // Count occurrences — must appear at least twice (init + picker listener)
    const count = (pages.match(/loadPosterQR/g) ?? []).length;
    expect(
      count,
      'loadPosterQR should appear ≥3 times (def + 2 call sites)'
    ).toBeGreaterThanOrEqual(3);
  });

  test('router has poster-bundle route wired to handleGetPosterBundle', () => {
    const router = sourceFile('router.ts');
    expect(router).toContain('poster-bundle');
    expect(router).toContain('handleGetPosterBundle');
  });

  test('poster-bundle handler imports generateQrCode and generateSvgQrCode from lib/qr', () => {
    const handler = sourceFile('handlers/poster-bundle.ts');
    expect(handler).toContain('generateQrCode');
    expect(handler).toContain('generateSvgQrCode');
    expect(handler, 'missing import from lib/qr').toContain('../lib/qr');
  });

  test('poster-bundle handler covers all 4 form types', () => {
    const handler = sourceFile('handlers/poster-bundle.ts');
    for (const type of ['register', 'checkin', 'survey', 'email-signup']) {
      expect(handler, `missing form type '${type}'`).toContain(type);
    }
  });

  test('poster-bundle handler includes human-readable labels for all 4 types', () => {
    const handler = sourceFile('handlers/poster-bundle.ts');
    expect(handler).toContain('Registration');
    expect(handler).toContain('Check-in');
    expect(handler).toContain('Survey');
    expect(handler).toContain('Email Signup');
  });

  // OSE-191: UEC QR static checks
  // @born-red TL-006 | method: design-time-negative-assertion | date: 2026-08-03
  test('poster-bundle handler uses getCode() from src/lib/uec (OSE-322 compliance)', () => {
    const handler = sourceFile('handlers/poster-bundle.ts');
    expect(handler, 'getCode import missing — must use UEC API not hex literals').toContain(
      "getCode('ENTER')"
    );
    expect(handler, 'UEC_ENTER_HEX constant missing').toContain('UEC_ENTER_HEX');
    expect(handler, 'must not have raw hex literal — use getCode().scan_hex').not.toContain(
      "'#1A6B2F'"
    );
  });

  test('poster-bundle handler references config.mock-mode flag for UEC QR URL', () => {
    const handler = sourceFile('handlers/poster-bundle.ts');
    expect(handler).toContain('config.mock-mode');
    expect(handler).toContain('uecQr');
  });

  test('qr.ts exports generateSvgQrCode', () => {
    const qr = sourceFile('lib/qr.ts');
    expect(qr).toContain('generateSvgQrCode');
    expect(qr).toContain('fgColor');
    expect(qr).toContain('SvgQrOptions');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L2 Integration: SELF.fetch — poster-bundle endpoint
// ─────────────────────────────────────────────────────────────────────────────

describe('DESIGN-9 L2: poster-bundle endpoint integration', () => {
  test('unknown event → 404 with ok:false', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/events/does-not-exist/poster-bundle');
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.ok).toBe(false);
  });

  test('active event → 200 with ok:true, eventId, eventName, numeric status, eventStatus, qr, links, labels', async () => {
    const eventId = await createEvent('Poster QR Test Event');

    const bundleRes = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/poster-bundle`);
    expect(bundleRes.status).toBe(200);
    const bundle = await json(bundleRes);

    expect(bundle.ok).toBe(true);
    expect(bundle.eventId).toBe(eventId);
    expect(bundle.eventName).toBe('Poster QR Test Event');
    // OSE-842: `status` is the numeric HTTP status (matching the error paths);
    // the event-state string moved to `eventStatus`.
    expect(bundle.status).toBe(200);
    expect(bundle.eventStatus).toBe('active');
    expect(bundle.qr).toBeDefined();
    expect(bundle.links).toBeDefined();
    expect(bundle.labels).toBeDefined();
  });

  test('all 4 form types present in qr, links, and labels', async () => {
    const eventId = await createEvent('Four-Type Bundle Check');

    const bundleRes = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/poster-bundle`);
    const bundle = await json(bundleRes);
    const qr = bundle.qr as Record<string, string>;
    const links = bundle.links as Record<string, string>;
    const labels = bundle.labels as Record<string, string>;

    const FORM_TYPES = ['register', 'checkin', 'survey', 'email-signup'] as const;

    for (const type of FORM_TYPES) {
      // QR is a PNG data URI
      expect(qr[type], `qr.${type} must be a PNG data URI`).toMatch(/^data:image\/png;base64,/);

      // Link contains the event ID and correct type param
      expect(links[type], `links.${type} must contain /forms/<eventId>`).toContain(
        `/forms/${eventId}`
      );
      expect(links[type], `links.${type} must contain type=${type}`).toContain(`type=${type}`);

      // Label is a non-empty string
      expect(typeof labels[type]).toBe('string');
      expect(labels[type].length, `labels.${type} must be non-empty`).toBeGreaterThan(0);
    }
  });

  test('QR data URIs are non-trivial size (>1000 base64 chars each)', async () => {
    const eventId = await createEvent('QR Size Validation');

    const bundleRes = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/poster-bundle`);
    const bundle = await json(bundleRes);
    const qr = bundle.qr as Record<string, string>;

    for (const type of ['register', 'checkin', 'survey', 'email-signup']) {
      const base64 = qr[type].replace('data:image/png;base64,', '');
      expect(base64.length, `qr.${type} base64 is suspiciously small`).toBeGreaterThan(1000);
    }
  });

  test('labels map has correct human-readable values', async () => {
    const eventId = await createEvent('Labels Verification');

    const bundleRes = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/poster-bundle`);
    const bundle = await json(bundleRes);
    const labels = bundle.labels as Record<string, string>;

    expect(labels['register']).toBe('Registration');
    expect(labels['checkin']).toBe('Check-in');
    expect(labels['survey']).toBe('Survey');
    expect(labels['email-signup']).toBe('Email Signup');
  });

  test('links are absolute URLs pointing to /forms/ route', async () => {
    const eventId = await createEvent('Link Format Check');

    const bundleRes = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/poster-bundle`);
    const bundle = await json(bundleRes);
    const links = bundle.links as Record<string, string>;

    for (const type of ['register', 'checkin', 'survey', 'email-signup']) {
      expect(links[type]).toMatch(/^https?:\/\/.+\/forms\/.+\?type=/);
    }
  });

  // OSE-191: UEC QR integration checks
  test('bundle includes uecQr field that is an inline SVG string', async () => {
    const eventId = await createEvent('UEC QR SVG Check');

    const bundleRes = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/poster-bundle`);
    const bundle = await json(bundleRes);

    expect(bundle.uecQr, 'uecQr field missing').toBeDefined();
    const svg = bundle.uecQr as string;
    expect(svg, 'uecQr must start with <svg').toMatch(/^<svg /);
    expect(svg, 'uecQr must close with </svg>').toContain('</svg>');
    expect(svg, 'uecQr must have xmlns attribute').toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  test('uecQr SVG uses UEC ENTER green (#1A6B2F) fill color', async () => {
    const eventId = await createEvent('UEC QR Color Check');

    const bundleRes = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/poster-bundle`);
    const bundle = await json(bundleRes);
    const svg = bundle.uecQr as string;

    expect(svg, 'UEC ENTER hex #1A6B2F not found in SVG').toContain('#1A6B2F');
  });

  test('bundle includes uecEnterHex field matching UEC ENTER scan_hex', async () => {
    const eventId = await createEvent('UEC Hex Field Check');

    const bundleRes = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/poster-bundle`);
    const bundle = await json(bundleRes);

    expect(bundle.uecEnterHex).toBe('#1A6B2F');
  });

  test('uecQr encodes event public page URL (live mode: default off)', async () => {
    const eventId = await createEvent('UEC QR URL Check');

    const bundleRes = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/poster-bundle`);
    const bundle = await json(bundleRes);
    const svg = bundle.uecQr as string;

    // In test env config.mock-mode defaults to 0 (disabled), so the live event URL
    // should be encoded. The SVG rect count should be non-trivial (encoded QR has modules).
    const rectCount = (svg.match(/<rect /g) ?? []).length;
    expect(rectCount, 'SVG has too few rects — QR not properly encoded').toBeGreaterThan(10);
  });
});
