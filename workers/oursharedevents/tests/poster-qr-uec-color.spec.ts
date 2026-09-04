/**
 * OSE-1200 — the poster prints each QR in its UEC scan_hex, and carries the
 * word + path + consent tier in text beside it.
 *
 *   L1 unit        — generateQrCode({ fgColor }) writes RGB with the hue as its
 *                    dark modules; without fgColor it stays greyscale black.
 *   L2 integration — /poster-bundle: every form-type PNG decodes to the
 *                    canonical scan_hex of its UEC code, and `uec[type]` names
 *                    the word, path and tier label the card prints.
 *   L1 static      — poster.html renders the qr-uec text block.
 *
 * Decoding is done by hand (stored-DEFLATE PNG) exactly like qr-roundtrip.spec
 * so the assertion reads the real bytes a phone would.
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { generateQrCode, parseHexRgb } from '../src/lib/qr';
import { getCode } from '../src/lib/uec';
import { posterUecFor } from '../src/handlers/poster-bundle';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}
const MOCK_ADMIN_KEY = 'test-admin-key-e2e-2026';
const tenv = () => env as unknown as TestEnv;

beforeAll(async () => {
  for (const [db, key] of [
    [tenv().DB, 'TEST_MIGRATION_STATEMENTS'],
    [tenv().FORMS_DB, 'TEST_FORMS_MIGRATION_STATEMENTS'],
  ] as const) {
    const stmts: string[] = JSON.parse(tenv()[key]);
    for (const stmt of stmts) {
      try {
        await db.prepare(stmt).run();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name')) continue;
        throw e;
      }
    }
  }
});

// ── PNG decode (stored DEFLATE, filter 0) ─────────────────────────────────────
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const u32 = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** Returns colour type and the set of distinct dark colours as #RRGGBB. */
function darkColours(dataUri: string): { colourType: number; width: number; dark: Set<string> } {
  const png = b64ToBytes(dataUri.replace(/^data:image\/png;base64,/, ''));
  let off = 8;
  let width = 0;
  let colourType = -1;
  const idat: number[] = [];
  while (off < png.length) {
    const len = u32(png, off);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = u32(data, 0);
      colourType = data[9];
    } else if (type === 'IDAT') idat.push(...data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  // inflate stored blocks
  const z = Uint8Array.from(idat);
  let p = 2;
  const raw: number[] = [];
  for (;;) {
    const hdr = z[p];
    const final = hdr & 1;
    expect((hdr >> 1) & 3, 'stored block').toBe(0);
    p += 1;
    const len = z[p] | (z[p + 1] << 8);
    p += 4;
    for (let i = 0; i < len; i++) raw.push(z[p + i]);
    p += len;
    if (final) break;
  }
  const bpp = colourType === 2 ? 3 : 1;
  const dark = new Set<string>();
  const stride = 1 + width * bpp;
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * stride + 1 + x * bpp;
      const r = raw[i];
      const g = bpp === 3 ? raw[i + 1] : r;
      const b = bpp === 3 ? raw[i + 2] : r;
      if (r + g + b < 3 * 250)
        dark.add(
          '#' +
            [r, g, b]
              .map((v) => v.toString(16).padStart(2, '0'))
              .join('')
              .toUpperCase()
        );
    }
  }
  return { colourType, width, dark };
}

function sourceFile(suffix: string): string {
  const files: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  const key = Object.keys(files).find((k) => k.replace(/\\/g, '/').endsWith(suffix));
  return key ? files[key] : '';
}

const FORM_TYPES = ['register', 'checkin', 'survey', 'email-signup'] as const;
const EXPECTED_CODE: Record<(typeof FORM_TYPES)[number], string> = {
  register: 'ENTER',
  checkin: 'CHECK-IN',
  survey: 'FEEDBACK',
  'email-signup': 'UTILITY',
};

describe('OSE-1200 L1 | generateQrCode fgColor', () => {
  test('without fgColor: greyscale, dark modules are #000000', () => {
    const { colourType, dark } = darkColours(generateQrCode('https://t.test/x'));
    expect(colourType).toBe(0);
    expect([...dark]).toEqual(['#000000']);
  });

  test('with a UEC scan_hex: RGB, dark modules are exactly that hue, background stays white', () => {
    const hex = getCode('SPONSOR')!.scan_hex; // the most valuable pixel in the system
    const { colourType, dark } = darkColours(generateQrCode('https://t.test/x', { fgColor: hex }));
    expect(colourType).toBe(2);
    expect([...dark]).toEqual([hex.toUpperCase()]);
  });

  test('parseHexRgb rejects anything that is not #RRGGBB', () => {
    expect(() => parseHexRgb('red')).toThrow();
    expect(() => parseHexRgb('#12345')).toThrow();
    expect(parseHexRgb('#1A3A8A')).toEqual([0x1a, 0x3a, 0x8a]);
  });

  test('posterUecFor maps every form type to a registry code with word, path, tier label', () => {
    for (const type of FORM_TYPES) {
      const u = posterUecFor(type);
      const code = getCode(EXPECTED_CODE[type])!;
      expect(u.id).toBe(code.id);
      expect(u.scan_hex).toBe(code.scan_hex);
      expect(u.url_path).toBe(code.url_path);
      expect(u.word.length).toBeGreaterThan(0);
      expect(['anonymous', 'identified']).toContain(u.tier);
      expect(u.tier_label).toMatch(/\.$/); // a sentence, in the voice
    }
    expect(posterUecFor('checkin').tier).toBe('anonymous');
  });
});

describe('OSE-1200 L2 | /poster-bundle prints UEC hues', () => {
  test("every form-type PNG decodes to its code's canonical scan_hex, and uec[type] is present", async () => {
    const created = await SELF.fetch('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${MOCK_ADMIN_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'OSE-1200 hue check', status: 'active' }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const res = await SELF.fetch(`https://t.test/api/v2/events/${id}/poster-bundle`);
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as {
      qr: Record<string, string>;
      uec: Record<
        string,
        { id: string; scan_hex: string; url_path: string; word: string; tier_label: string }
      >;
    };
    for (const type of FORM_TYPES) {
      const code = getCode(EXPECTED_CODE[type])!;
      expect(bundle.uec[type], `uec.${type}`).toMatchObject({
        id: code.id,
        scan_hex: code.scan_hex,
        url_path: code.url_path,
      });
      const { colourType, dark } = darkColours(bundle.qr[type]);
      expect(colourType, `${type} PNG must be RGB`).toBe(2);
      expect([...dark], `${type} dark modules must be ${code.scan_hex}`).toEqual([
        code.scan_hex.toUpperCase(),
      ]);
    }
  });
});

describe('OSE-1200 L1 | poster.html carries the non-color channel', () => {
  test('poster renders word, path and tier text per card and stamps data-uec on the frame', () => {
    const html = sourceFile('src/templates/poster.html');
    expect(html).toContain('data-testid="qr-uec-word-');
    expect(html).toContain('data-testid="qr-uec-path-');
    expect(html).toContain('data-testid="qr-uec-tier-');
    expect(html).toContain("card.setAttribute('data-uec'");
    expect(html).toContain('borderTopColor = uec.scan_hex');
  });
});
