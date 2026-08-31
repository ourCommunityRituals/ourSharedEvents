/**
 * QR Code Generator for Cloudflare Workers
 *
 * Generates QR codes as PNG data URIs with zero external dependencies.
 * Full Reed-Solomon error correction + minimal PNG encoder (DEFLATE uncompressed).
 *
 * Ported from a prior cloudflare-proxy implementation (built atop
 * nayuki/QR-Code-generator, public domain). Supports byte mode, versions 1-5,
 * EC levels L/M/Q/H.
 *
 * Max URL capacity at version 5 / EC level M: 122 bytes — enough for all OSE
 * form URLs (origin + /forms/ + evt_ ID + ?type=email-signup ≈ 92 chars).
 *
 * DESIGN-9 (OSE-103): Server-side QR generation for poster + mobile ad surfaces.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const EC_LEVEL: Record<string, number> = { L: 0, M: 1, Q: 2, H: 3 };

// Version capacities for byte mode
const VERSION_CAPACITY: number[][] = [
  [0, 0, 0, 0], // Version 0 (unused)
  [17, 14, 11, 7], // Version 1
  [32, 26, 20, 14], // Version 2
  [53, 42, 32, 24], // Version 3
  [78, 62, 46, 34], // Version 4
  [106, 84, 60, 44], // Version 5
  [134, 106, 74, 58], // Version 6
  [154, 122, 86, 64], // Version 7 — buffer for longer URLs
];

const EC_CODEWORDS_PER_BLOCK: number[][] = [
  [0, 0, 0, 0],
  [7, 10, 13, 17],
  [10, 16, 22, 28],
  [15, 26, 18, 22],
  [20, 18, 26, 16],
  [26, 24, 18, 22],
  [18, 16, 24, 28],
  [20, 18, 18, 26],
];

const NUM_EC_BLOCKS: number[][] = [
  [0, 0, 0, 0],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 2, 2],
  [1, 2, 2, 4],
  [1, 2, 2, 4],
  [2, 4, 4, 4],
  [2, 4, 6, 5],
];

// ── Types ─────────────────────────────────────────────────────────────────────

type QrMatrix = (boolean | null)[][];
type QrReserved = boolean[][];

// ── Reed-Solomon ──────────────────────────────────────────────────────────────

function rsMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ (((z >>> 7) & 1) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): Uint8Array {
  const r = new Uint8Array(degree);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = rsMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = rsMul(root, 2);
  }
  return r;
}

function rsRemainder(data: Uint8Array, div: Uint8Array): Uint8Array {
  const r = new Uint8Array(div.length);
  for (let i = 0; i < data.length; i++) {
    const f = data[i] ^ r[0];
    r.copyWithin(0, 1);
    r[r.length - 1] = 0;
    for (let j = 0; j < div.length; j++) r[j] ^= rsMul(div[j], f);
  }
  return r;
}

// ── QR matrix construction ────────────────────────────────────────────────────

function qrSize(version: number): number {
  return 17 + version * 4;
}

function minVersion(len: number, ecLevel: number): number {
  for (let v = 1; v < VERSION_CAPACITY.length; v++) {
    if (VERSION_CAPACITY[v][ecLevel] >= len) return v;
  }
  throw new Error(`Data too long for QR code (${len} bytes)`);
}

function drawFinder(m: QrMatrix, res: QrReserved, r: number, c: number): void {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const rr = r + dr,
        cc = c + dc;
      if (rr < 0 || rr >= m.length || cc < 0 || cc >= m.length) continue;
      const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      const inOuter = dr === -1 || dr === 7 || dc === -1 || dc === 7;
      m[rr][cc] = !inOuter && (onBorder || inInner);
      res[rr][cc] = true;
    }
  }
}

function drawAlignment(m: QrMatrix, res: QrReserved, r: number, c: number): void {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const rr = r + dr,
        cc = c + dc;
      if (res[rr][cc]) continue;
      m[rr][cc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
      res[rr][cc] = true;
    }
  }
}

function drawTiming(m: QrMatrix, res: QrReserved, sz: number): void {
  for (let i = 8; i < sz - 8; i++) {
    m[6][i] = m[i][6] = i % 2 === 0;
    res[6][i] = res[i][6] = true;
  }
}

function reserveFormat(res: QrReserved, sz: number): void {
  for (let i = 0; i <= 8; i++) {
    res[8][i] = true;
    res[i][8] = true;
  }
  for (let i = sz - 8; i < sz; i++) res[8][i] = true;
  for (let i = sz - 7; i < sz; i++) res[i][8] = true;
}

/**
 * Total codewords per version, from the QR specification (ISO/IEC 18004 Table 1).
 *
 * This was previously derived geometrically — subtracting finder, timing, format
 * and alignment modules from sz*sz — and the accounting was wrong for EVERY
 * version: 6 short at v1, 5 short at v2-v6, and 13 OVER at v7, where the
 * alignment-pattern term stops being a constant.
 *
 * That is the capacity the whole data/ECC split is computed from, so every symbol
 * was built against the wrong budget. It is OSE-1127 root cause C, and it sat
 * beneath the other two: fixing the format bits and the block interleaving could
 * never have produced a readable code while this was wrong.
 *
 * A table cannot drift the way a hand-derived formula can, and these are fixed
 * constants in the standard. Indexed by version; index 0 unused.
 */
const TOTAL_CODEWORDS: readonly number[] = [0, 26, 44, 70, 100, 134, 172, 196];

function totalCodewords(version: number): number {
  return TOTAL_CODEWORDS[version];
}

function encodeData(bytes: Uint8Array, version: number, ecLevel: number): Uint8Array {
  const ecPerBlock = EC_CODEWORDS_PER_BLOCK[version][ecLevel];
  const nBlocks = NUM_EC_BLOCKS[version][ecLevel];
  const dataCW = totalCodewords(version) - ecPerBlock * nBlocks;

  const bits: number[] = [0, 1, 0, 0]; // byte mode
  const count = bytes.length;
  for (let i = 7; i >= 0; i--) bits.push((count >> i) & 1);
  for (const b of bytes) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  const term = Math.min(4, dataCW * 8 - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const pads = [0xec, 0x11];
  let pi = 0;
  while (bits.length < dataCW * 8) {
    for (let i = 7; i >= 0; i--) bits.push((pads[pi] >> i) & 1);
    pi = (pi + 1) % 2;
  }

  const out = new Uint8Array(dataCW);
  for (let i = 0; i < dataCW; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    out[i] = b;
  }
  return out;
}

/**
 * Split into blocks, compute Reed-Solomon ECC per block, and INTERLEAVE.
 *
 * Two bugs lived here (OSE-1127 root cause B), both invisible whenever the
 * symbol happened to be single-block — which is why short payloads decoded and
 * the product's real 40-60 byte scan URLs did not:
 *
 *   1. NO INTERLEAVING. The old code emitted block0 + its ECC, then block1 + its
 *      ECC, and so on. The spec requires the i-th data codeword of every block in
 *      turn, then the i-th ECC codeword of every block in turn. With one block the
 *      two are identical, so the bug hid completely below the multi-block
 *      threshold.
 *
 *   2. EQUAL-SIZE BLOCK ASSUMPTION. `Math.floor(data.length / nBlocks)` assumes
 *      every block is the same length. The spec uses SHORT and LONG blocks
 *      differing by exactly one data codeword; when the division had a remainder
 *      those extra codewords were silently dropped before ever being encoded.
 *
 * Block geometry per the spec: `numLong = totalData % nBlocks` blocks carry
 * `shortLen + 1` data codewords; the rest carry `shortLen`. Every block gets the
 * same ECC length. Long blocks sort last, so during data interleaving the short
 * blocks simply have nothing to contribute on the final pass.
 */
function addEcc(data: Uint8Array, version: number, ecLevel: number): Uint8Array {
  const ecPerBlock = EC_CODEWORDS_PER_BLOCK[version][ecLevel];
  const nBlocks = NUM_EC_BLOCKS[version][ecLevel];
  const div = rsDivisor(ecPerBlock);

  const shortLen = Math.floor(data.length / nBlocks);
  const numLong = data.length % nBlocks;

  const blocks: Uint8Array[] = [];
  const eccs: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < nBlocks; i++) {
    const len = shortLen + (i >= nBlocks - numLong ? 1 : 0);
    const block = data.slice(offset, offset + len);
    offset += len;
    blocks.push(block);
    eccs.push(rsRemainder(block, div));
  }

  const out: number[] = [];

  // Data codewords, interleaved. Short blocks contribute nothing on the last
  // pass, which is why long blocks are placed at the end.
  const maxLen = shortLen + (numLong > 0 ? 1 : 0);
  for (let i = 0; i < maxLen; i++) {
    for (const block of blocks) {
      if (i < block.length) out.push(block[i]);
    }
  }

  // ECC codewords, interleaved. Every block has exactly ecPerBlock of them.
  for (let i = 0; i < ecPerBlock; i++) {
    for (const ecc of eccs) out.push(ecc[i]);
  }

  return new Uint8Array(out);
}

function placeBits(m: QrMatrix, res: QrReserved, cw: Uint8Array, sz: number): void {
  let bit = 0;
  const total = cw.length * 8;
  for (let right = sz - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < sz; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const row = ((right + 1) & 2) === 0 ? sz - 1 - vert : vert;
        if (!res[row][col] && bit < total) {
          m[row][col] = ((cw[Math.floor(bit / 8)] >> (7 - (bit % 8))) & 1) === 1;
          bit++;
        }
      }
    }
  }
}

function applyMask(m: QrMatrix, res: QrReserved, sz: number): void {
  // Mask pattern 0: (row + col) % 2 === 0
  for (let r = 0; r < sz; r++) {
    for (let c = 0; c < sz; c++) {
      if (!res[r][c] && (r + c) % 2 === 0) m[r][c] = !m[r][c];
    }
  }
}

/**
 * Format-information EC indicator.
 *
 * EC_LEVEL is the TABLE INDEX order (L=0 M=1 Q=2 H=3), correct for indexing
 * VERSION_CAPACITY / EC_CODEWORDS_PER_BLOCK / NUM_EC_BLOCKS. The QR spec's
 * format-info field uses a DIFFERENT encoding: L=01 M=00 Q=11 H=10.
 *
 * Feeding the table index straight into the format bits made every symbol
 * declare the wrong EC level. A decoder reads format info FIRST, derives the
 * wrong data/ECC split from it, and gives up — which is why the codes rendered
 * perfectly and scanned as nothing. (OSE-1127 root cause A.)
 */
const EC_FORMAT_INDICATOR: readonly number[] = [1, 0, 3, 2];

function formatBits(ecLevel: number): number {
  const data = (EC_FORMAT_INDICATOR[ecLevel] << 3) | 0; // mask 0
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(m: QrMatrix, sz: number, ecLevel: number): void {
  const fb = formatBits(ecLevel);
  for (let i = 0; i <= 5; i++) m[8][i] = ((fb >> (14 - i)) & 1) === 1;
  m[8][7] = ((fb >> 8) & 1) === 1;
  m[8][8] = ((fb >> 7) & 1) === 1;
  m[7][8] = ((fb >> 6) & 1) === 1;
  for (let i = 0; i <= 5; i++) m[5 - i][8] = ((fb >> i) & 1) === 1;
  for (let i = 0; i <= 7; i++) m[8][sz - 1 - i] = ((fb >> i) & 1) === 1;
  for (let i = 0; i <= 6; i++) m[sz - 1 - i][8] = ((fb >> (14 - i)) & 1) === 1;
  m[sz - 8][8] = true; // dark module
}

function buildMatrix(data: string, ecLevel: number): QrMatrix {
  const bytes = new TextEncoder().encode(data);
  const version = minVersion(bytes.length, ecLevel);
  const sz = qrSize(version);
  const m: QrMatrix = Array.from({ length: sz }, () => Array(sz).fill(null));
  const res: QrReserved = Array.from({ length: sz }, () => Array(sz).fill(false));

  drawFinder(m, res, 0, 0);
  drawFinder(m, res, sz - 7, 0);
  drawFinder(m, res, 0, sz - 7);
  if (version >= 2) drawAlignment(m, res, sz - 7, sz - 7);
  drawTiming(m, res, sz);
  reserveFormat(res, sz);

  const dataCW = encodeData(bytes, version, ecLevel);
  const allCW = addEcc(dataCW, version, ecLevel);
  placeBits(m, res, allCW, sz);
  applyMask(m, res, sz);
  drawFormat(m, sz, ecLevel);

  return m;
}

// ── PNG encoder ───────────────────────────────────────────────────────────────

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of data) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: number[]): Uint8Array {
  const len = data.length;
  const chunk = new Uint8Array(12 + len);
  chunk[0] = (len >>> 24) & 0xff;
  chunk[1] = (len >>> 16) & 0xff;
  chunk[2] = (len >>> 8) & 0xff;
  chunk[3] = len & 0xff;
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  for (let i = 0; i < len; i++) chunk[8 + i] = data[i];
  const crcSrc = new Uint8Array(4 + len);
  crcSrc.set(chunk.slice(4, 8 + len));
  const crc = crc32(crcSrc);
  chunk[8 + len] = (crc >>> 24) & 0xff;
  chunk[8 + len + 1] = (crc >>> 16) & 0xff;
  chunk[8 + len + 2] = (crc >>> 8) & 0xff;
  chunk[8 + len + 3] = crc & 0xff;
  return chunk;
}

function intToBytes(n: number, len: number): number[] {
  const out: number[] = [];
  for (let i = len - 1; i >= 0; i--) out.push((n >>> (i * 8)) & 0xff);
  return out;
}

function deflateStore(data: Uint8Array): Uint8Array {
  const maxBlock = 65535;
  const blocks: number[] = [];
  for (let i = 0; i < data.length; i += maxBlock) {
    const block = data.slice(i, Math.min(i + maxBlock, data.length));
    const isLast = i + maxBlock >= data.length;
    blocks.push(isLast ? 0x01 : 0x00);
    blocks.push(block.length & 0xff, (block.length >> 8) & 0xff);
    blocks.push(~block.length & 0xff, (~block.length >> 8) & 0xff);
    for (const b of block) blocks.push(b);
  }
  let s1 = 1,
    s2 = 0;
  for (const b of data) {
    s1 = (s1 + b) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const adler = (s2 << 16) | s1;
  const out = new Uint8Array(2 + blocks.length + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  out.set(blocks, 2);
  out[out.length - 4] = (adler >>> 24) & 0xff;
  out[out.length - 3] = (adler >>> 16) & 0xff;
  out[out.length - 2] = (adler >>> 8) & 0xff;
  out[out.length - 1] = adler & 0xff;
  return out;
}

function matrixToPng(m: QrMatrix, scale: number, margin: number): string {
  const sz = m.length;
  const imgSz = (sz + margin * 2) * scale;
  const pixels = new Uint8Array(imgSz * imgSz);
  for (let y = 0; y < imgSz; y++) {
    for (let x = 0; x < imgSz; x++) {
      const qy = Math.floor(y / scale) - margin;
      const qx = Math.floor(x / scale) - margin;
      pixels[y * imgSz + x] = qy >= 0 && qy < sz && qx >= 0 && qx < sz && m[qy][qx] ? 0 : 255;
    }
  }

  const rawData = new Uint8Array(imgSz * (1 + imgSz));
  for (let y = 0; y < imgSz; y++) {
    rawData[y * (1 + imgSz)] = 0; // filter byte
    for (let x = 0; x < imgSz; x++) rawData[y * (1 + imgSz) + 1 + x] = pixels[y * imgSz + x];
  }

  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = pngChunk('IHDR', [...intToBytes(imgSz, 4), ...intToBytes(imgSz, 4), 8, 0, 0, 0, 0]);
  const idat = pngChunk('IDAT', [...deflateStore(rawData)]);
  const iend = pngChunk('IEND', []);

  const png = new Uint8Array(sig.length + ihdr.length + idat.length + iend.length);
  let off = 0;
  png.set(sig, off);
  off += sig.length;
  png.set(ihdr, off);
  off += ihdr.length;
  png.set(idat, off);
  off += idat.length;
  png.set(iend, off);

  let bin = '';
  for (let i = 0; i < png.length; i++) bin += String.fromCharCode(png[i]);
  return 'data:image/png;base64,' + btoa(bin);
}

// ── SVG encoder ───────────────────────────────────────────────────────────────

function matrixToSvg(m: QrMatrix, scale: number, margin: number, fg: string, bg: string): string {
  const sz = m.length;
  const totalSz = (sz + margin * 2) * scale;
  const rects: string[] = [];
  for (let y = 0; y < sz; y++) {
    for (let x = 0; x < sz; x++) {
      if (m[y][x]) {
        const px = (x + margin) * scale;
        const py = (y + margin) * scale;
        rects.push(`<rect x="${px}" y="${py}" width="${scale}" height="${scale}" fill="${fg}"/>`);
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalSz}" height="${totalSz}" ` +
    `viewBox="0 0 ${totalSz} ${totalSz}">` +
    `<rect width="${totalSz}" height="${totalSz}" fill="${bg}"/>` +
    rects.join('') +
    `</svg>`
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface QrOptions {
  /** Module scale in pixels (default 4) */
  scale?: number;
  /** Quiet-zone size in modules (default 2) */
  margin?: number;
  /** Error correction level (default 'M') */
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';
}

export interface SvgQrOptions {
  /** Foreground (module) color. Default: '#000000' */
  fgColor?: string;
  /** Background color. Default: '#FFFFFF' */
  bgColor?: string;
  /** Module size in pixels (default 4) */
  scale?: number;
  /** Quiet-zone size in modules (default 2) */
  margin?: number;
  /** Error correction level (default 'M') */
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';
}

/**
 * Generate a QR code as a PNG data URI.
 *
 * @param data - String to encode (URL, text, etc.)
 * @param opts - Scale, margin, error correction level
 * @returns `data:image/png;base64,...` string
 * @throws If data is too long for version 7 / chosen EC level
 */
export function generateQrCode(data: string, opts: QrOptions = {}): string {
  const { scale = 4, margin = 2, errorCorrection = 'M' } = opts;
  const ecLevel = EC_LEVEL[errorCorrection] ?? EC_LEVEL.M;
  const matrix = buildMatrix(data, ecLevel);
  return matrixToPng(matrix, scale, margin);
}

/**
 * Generate a QR code as an inline SVG string with custom colors.
 *
 * Preferred for UEC poster use: SVG scales infinitely and supports WCAG-validated
 * UEC semantic colors (see src/lib/uec/uec-codes.ts `scan_hex` values).
 *
 * @param data - String to encode (URL, text, etc.)
 * @param opts - Colors, scale, margin, error correction level
 * @returns Inline `<svg>...</svg>` string (not a data URI)
 * @throws If data is too long for version 7 / chosen EC level
 */
export function generateSvgQrCode(data: string, opts: SvgQrOptions = {}): string {
  const {
    fgColor = '#000000',
    bgColor = '#FFFFFF',
    scale = 4,
    margin = 2,
    errorCorrection = 'M',
  } = opts;
  const ecLevel = EC_LEVEL[errorCorrection] ?? EC_LEVEL.M;
  const matrix = buildMatrix(data, ecLevel);
  return matrixToSvg(matrix, scale, margin, fgColor, bgColor);
}
