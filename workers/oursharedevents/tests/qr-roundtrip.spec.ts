/**
 * QR round-trip — the poster spine, verified through the front-end contract.
 *
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * src/lib/qr.ts is 463 lines of hand-rolled Reed-Solomon. Before this spec, a
 * mutation campaign (scripts/mutate.mjs) found FOUR encoder mutants that all
 * survived the suite — the grid-size formula, the alignment threshold, the
 * codeword count, and the format bits could each be silently wrong:
 *
 *     SURVIVED  qr-size-formula        17 + 4v -> 17 + 5v
 *     SURVIVED  qr-alignment-threshold version >= 2 -> >= 3
 *     SURVIVED  qr-codeword-adjust     mods -= 25 -> 24
 *     SURVIVED  qr-ec-level-bits       ecLevel << 3 -> << 2
 *
 * The only "QR test" in the suite asserted that a handler file CONTAINS the
 * string '../lib/qr'. That checks an import statement, not a QR code. A poster
 * that does not scan is total revenue loss for that event, discovered by a
 * volunteer in a bar, not by CI.
 *
 * WHAT MAKES THIS FRONT-END VERIFIABLE
 * ─────────────────────────────────────────────────────────────────────────────
 * It asserts the bytes the BROWSER receives, not an internal function's return.
 * The chain under test is the real one:
 *
 *   GET /api/v2/events/:id/poster-bundle   (what poster.html fetches)
 *     -> handler builds the scan URL
 *     -> generateQrCode() encodes it
 *     -> data:image/png;base64 in the JSON the page renders into <img>
 *     -> THIS SPEC decodes that PNG back to pixels
 *     -> jsQR reads the pixels the way a phone camera would
 *     -> assert the decoded string is the URL we meant to encode
 *
 * If a phone could not read it, this fails. That is the whole claim.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import jsQR from 'jsqr';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const EVENT_ID = 'evt_qr_roundtrip_001';

/**
 * Both databases. poster-bundle reads a feature flag from FORMS_DB, so a main-DB-only
 * seed 500s — which is itself worth knowing: the poster surface has a hard dependency
 * on the forms database being reachable.
 */
async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const run = async (db: D1Database, stmts: string[]) => {
    for (const stmt of stmts) {
      try {
        await db.prepare(stmt).run();
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (m.includes('duplicate column') || m.includes('already exists') || m.includes('no such column')) continue;
        throw e;
      }
    }
  };
  await run(tenv.DB, JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]);
  await run(tenv.FORMS_DB, JSON.parse(tenv.TEST_FORMS_MIGRATION_STATEMENTS) as string[]);
}

// ── PNG decode ────────────────────────────────────────────────────────────────
//
// matrixToPng writes the simplest legal PNG: 8-bit greyscale (colour type 0),
// filter byte 0 (None) per scanline, and DEFLATE *stored* (uncompressed) blocks.
// Decoding it needs no library — and doing it by hand keeps this spec dependency
// -light and, more importantly, keeps it honest: it reads the real file format
// rather than trusting a shared helper that could drift alongside the encoder.

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readU32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

/** Concatenate every IDAT payload and read IHDR width/height/colour type. */
function parsePng(png: Uint8Array): { width: number; height: number; idat: Uint8Array } {
  expect(Array.from(png.slice(0, 8)), 'PNG signature').toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  let off = 8;
  let width = 0;
  let height = 0;
  const chunks: Uint8Array[] = [];
  while (off < png.length) {
    const len = readU32(png, off);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = readU32(data, 0);
      height = readU32(data, 4);
      expect(data[8], 'bit depth').toBe(8);
      expect(data[9], 'colour type (0 = greyscale)').toBe(0);
    } else if (type === 'IDAT') {
      chunks.push(data);
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const idat = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { idat.set(c, p); p += c.length; }
  return { width, height, idat };
}

/** Inflate DEFLATE *stored* blocks only — which is all deflateStore() emits. */
function inflateStored(z: Uint8Array): Uint8Array {
  expect(z[0], 'zlib CMF byte').toBe(0x78);
  let off = 2; // skip CMF + FLG
  const parts: Uint8Array[] = [];
  for (;;) {
    const hdr = z[off];
    const final = hdr & 1;
    expect((hdr >> 1) & 3, 'BTYPE must be 0 (stored)').toBe(0);
    off += 1;
    const len = z[off] | (z[off + 1] << 8);
    off += 4; // LEN + NLEN
    parts.push(z.subarray(off, off + len));
    off += len;
    if (final) break;
  }
  const total = parts.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of parts) { out.set(c, p); p += c.length; }
  return out;
}

/** Greyscale PNG -> RGBA, the shape jsQR expects from a camera frame. */
function pngToRgba(dataUri: string): { data: Uint8ClampedArray; width: number; height: number } {
  const b64 = dataUri.replace(/^data:image\/png;base64,/, '');
  const { width, height, idat } = parsePng(b64ToBytes(b64));
  const raw = inflateStored(idat);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width);
    expect(raw[rowStart], `scanline ${y} filter type`).toBe(0);
    for (let x = 0; x < width; x++) {
      const v = raw[rowStart + 1 + x];
      const o = (y * width + x) * 4;
      rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v; rgba[o + 3] = 255;
    }
  }
  return { data: rgba, width, height };
}

/** Decode a data-URI QR the way a phone would. Returns null if unreadable. */
function decodeQr(dataUri: string): string | null {
  const { data, width, height } = pngToRgba(dataUri);
  return jsQR(data, width, height)?.data ?? null;
}

describe('QR round-trip — poster bundle is scannable', () => {
  let bundle: Record<string, unknown>;

  beforeAll(async () => {
    await applyMigrations();
    const tenv = env as unknown as TestEnv;
    await tenv.DB.prepare(
      `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, start_date)
       VALUES (?, 'root', 'QR Round-trip Fixture', 'qr-roundtrip-fixture', 'active', ?)`
    ).bind(EVENT_ID, new Date(Date.now() + 14 * 864e5).toISOString()).run();

    const res = await SELF.fetch(`https://example.com/api/v2/events/${EVENT_ID}/poster-bundle`);
    expect(res.status, 'poster-bundle must serve the surface the poster page fetches').toBe(200);
    bundle = (await res.json()) as Record<string, unknown>;
  });

  test('every emitted QR decodes back to the exact URL it encodes', () => {
    const qr = (bundle.qr ?? {}) as Record<string, string>;
    const links = (bundle.links ?? bundle.urls ?? {}) as Record<string, string>;
    const types = Object.keys(qr);

    expect(types.length, 'poster bundle emitted no QR codes').toBeGreaterThan(0);

    for (const type of types) {
      const decoded = decodeQr(qr[type]);
      expect(decoded, `QR for "${type}" could not be decoded — a phone would fail here`).not.toBeNull();
      const expected = links[type];
      if (expected) {
        expect(decoded, `QR for "${type}" decodes to the wrong target`).toBe(expected);
      } else {
        // No link map published; still assert it is a usable OSE URL, not noise.
        expect(decoded, `QR for "${type}" decoded to a non-URL`).toMatch(/^https?:\/\/[^\s]+$/);
      }
    }
  });

  test('a decoded QR points at a route this Worker actually serves', async () => {
    const qr = (bundle.qr ?? {}) as Record<string, string>;
    const first = Object.keys(qr)[0];
    const decoded = decodeQr(qr[first]);
    expect(decoded).not.toBeNull();

    const path = new URL(decoded!).pathname;
    expect(path, 'decoded QR must target /q/ (scan) or /forms/ (direct)').toMatch(/^\/(q|forms)\//);

    const res = await SELF.fetch(`https://example.com${path}`, { redirect: 'manual' });
    expect([200, 302], `following the decoded QR returned ${res.status}`).toContain(res.status);
  });

  test('the QR carries a quiet zone — the margin a scanner needs', () => {
    const qr = (bundle.qr ?? {}) as Record<string, string>;
    const { data, width } = pngToRgba(qr[Object.keys(qr)[0]]);
    // Top-left pixel is inside the margin and must be white (255).
    expect(data[0], 'no quiet zone: the top-left pixel is dark').toBe(255);
    // A pixel one row in, at the far right, is also margin.
    const o = (width - 1) * 4;
    expect(data[o], 'no quiet zone on the right edge').toBe(255);
  });
});
