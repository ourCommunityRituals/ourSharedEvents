/**
 * QR Code Generator for Cloudflare Workers
 *
 * Generates QR codes as PNG data URIs without external dependencies.
 * Uses a minimal Reed-Solomon QR code implementation.
 *
 * Based on nayuki/QR-Code-generator (public domain)
 * Simplified for Cloudflare Workers environment.
 */

// QR Code constants
const ERROR_CORRECTION_LEVEL = {
  L: 0, // 7% recovery
  M: 1, // 15% recovery
  Q: 2, // 25% recovery
  H: 3  // 30% recovery
};

// Version capacities for alphanumeric mode at different error correction levels
const VERSION_CAPACITY = [
  // L, M, Q, H
  [0, 0, 0, 0],      // Version 0 (unused)
  [25, 20, 16, 10],  // Version 1
  [47, 38, 29, 20],  // Version 2
  [77, 61, 47, 35],  // Version 3
  [114, 90, 67, 50], // Version 4
  [154, 122, 87, 64] // Version 5
];

// Number of error correction codewords per block
const EC_CODEWORDS_PER_BLOCK = [
  // L, M, Q, H
  [0, 0, 0, 0],
  [7, 10, 13, 17],
  [10, 16, 22, 28],
  [15, 26, 18, 22],
  [20, 18, 26, 16],
  [26, 24, 18, 22]
];

// Number of error correction blocks
const NUM_ERROR_CORRECTION_BLOCKS = [
  // L, M, Q, H
  [0, 0, 0, 0],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 2, 2],
  [1, 2, 2, 4],
  [1, 2, 2, 4]
];

/**
 * Encode text to byte array (UTF-8)
 */
function textToBytes(text) {
  return new TextEncoder().encode(text);
}

/**
 * Calculate QR code version needed for data length
 */
function getMinVersion(dataLength, ecLevel) {
  for (let version = 1; version <= 5; version++) {
    if (VERSION_CAPACITY[version][ecLevel] >= dataLength) {
      return version;
    }
  }
  throw new Error('Data too long for QR code');
}

/**
 * Get QR code size (modules) for version
 */
function getSize(version) {
  return 17 + version * 4;
}

/**
 * Generate Reed-Solomon error correction codewords
 */
function reedSolomonComputeDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;

  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < result.length) {
        result[j] ^= result[j + 1];
      }
    }
    root = reedSolomonMultiply(root, 2);
  }

  return result;
}

function reedSolomonComputeRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);

  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;

    for (let j = 0; j < divisor.length; j++) {
      result[j] ^= reedSolomonMultiply(divisor[j], factor);
    }
  }

  return result;
}

function reedSolomonMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/**
 * Create QR code matrix
 */
function createQrCode(data, ecLevel = ERROR_CORRECTION_LEVEL.M) {
  const bytes = typeof data === 'string' ? textToBytes(data) : data;
  const version = getMinVersion(bytes.length, ecLevel);
  const size = getSize(version);

  // Initialize matrix
  const matrix = Array(size).fill(null).map(() => Array(size).fill(null));
  const reserved = Array(size).fill(null).map(() => Array(size).fill(false));

  // Draw finder patterns
  drawFinderPattern(matrix, reserved, 0, 0);
  drawFinderPattern(matrix, reserved, size - 7, 0);
  drawFinderPattern(matrix, reserved, 0, size - 7);

  // Draw alignment pattern (version >= 2)
  if (version >= 2) {
    const alignPos = size - 7;
    drawAlignmentPattern(matrix, reserved, alignPos, alignPos);
  }

  // Draw timing patterns
  drawTimingPatterns(matrix, reserved, size);

  // Reserve format info areas
  reserveFormatInfo(reserved, size);

  // Encode data
  const dataCodewords = encodeData(bytes, version, ecLevel);

  // Add error correction
  const allCodewords = addErrorCorrection(dataCodewords, version, ecLevel);

  // Place data bits
  placeDataBits(matrix, reserved, allCodewords, size);

  // Apply mask (pattern 0)
  applyMask(matrix, reserved, size, 0);

  // Draw format info
  drawFormatInfo(matrix, size, ecLevel, 0);

  return matrix;
}

function drawFinderPattern(matrix, reserved, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= matrix.length || cc < 0 || cc >= matrix.length) continue;

      const inOuter = r === -1 || r === 7 || c === -1 || c === 7;
      const inMiddle = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const onBorder = r === 0 || r === 6 || c === 0 || c === 6;

      matrix[rr][cc] = !inOuter && (onBorder || inInner);
      reserved[rr][cc] = true;
    }
  }
}

function drawAlignmentPattern(matrix, reserved, row, col) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const rr = row + r;
      const cc = col + c;
      if (reserved[rr][cc]) continue;

      const dist = Math.max(Math.abs(r), Math.abs(c));
      matrix[rr][cc] = dist !== 1;
      reserved[rr][cc] = true;
    }
  }
}

function drawTimingPatterns(matrix, reserved, size) {
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = matrix[i][6] = i % 2 === 0;
    reserved[6][i] = reserved[i][6] = true;
  }
}

function reserveFormatInfo(reserved, size) {
  // Around top-left finder
  for (let i = 0; i <= 8; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  // Around top-right finder
  for (let i = size - 8; i < size; i++) {
    reserved[8][i] = true;
  }
  // Around bottom-left finder
  for (let i = size - 7; i < size; i++) {
    reserved[i][8] = true;
  }
}

function encodeData(bytes, version, ecLevel) {
  const totalCodewords = getTotalCodewords(version);
  const ecCodewordsPerBlock = EC_CODEWORDS_PER_BLOCK[version][ecLevel];
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[version][ecLevel];
  const dataCodewords = totalCodewords - ecCodewordsPerBlock * numBlocks;

  // Byte mode indicator (0100) + character count
  const bits = [];

  // Mode indicator
  bits.push(0, 1, 0, 0);

  // Character count (8 bits for version 1-9)
  const count = bytes.length;
  for (let i = 7; i >= 0; i--) {
    bits.push((count >> i) & 1);
  }

  // Data bytes
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1);
    }
  }

  // Terminator
  const terminatorLength = Math.min(4, dataCodewords * 8 - bits.length);
  for (let i = 0; i < terminatorLength; i++) {
    bits.push(0);
  }

  // Pad to byte boundary
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // Pad codewords
  const padBytes = [0xEC, 0x11];
  let padIndex = 0;
  while (bits.length < dataCodewords * 8) {
    for (let i = 7; i >= 0; i--) {
      bits.push((padBytes[padIndex] >> i) & 1);
    }
    padIndex = (padIndex + 1) % 2;
  }

  // Convert to bytes
  const result = new Uint8Array(dataCodewords);
  for (let i = 0; i < dataCodewords; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i * 8 + j];
    }
    result[i] = byte;
  }

  return result;
}

function getTotalCodewords(version) {
  const size = getSize(version);
  let modules = size * size;

  // Subtract finder patterns + separators
  modules -= 3 * 64 + 3 * 15;

  // Subtract timing patterns
  modules -= 2 * (size - 16);

  // Subtract format info
  modules -= 31;

  // Subtract alignment pattern (version >= 2)
  if (version >= 2) {
    modules -= 25;
  }

  return Math.floor(modules / 8);
}

function addErrorCorrection(dataCodewords, version, ecLevel) {
  const ecCodewordsPerBlock = EC_CODEWORDS_PER_BLOCK[version][ecLevel];
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[version][ecLevel];
  const blockSize = Math.floor(dataCodewords.length / numBlocks);

  const divisor = reedSolomonComputeDivisor(ecCodewordsPerBlock);
  const allCodewords = [];

  for (let i = 0; i < numBlocks; i++) {
    const start = i * blockSize;
    const end = start + blockSize;
    const block = dataCodewords.slice(start, end);
    const ec = reedSolomonComputeRemainder(block, divisor);

    for (const byte of block) allCodewords.push(byte);
    for (const byte of ec) allCodewords.push(byte);
  }

  return new Uint8Array(allCodewords);
}

function placeDataBits(matrix, reserved, codewords, size) {
  let bitIndex = 0;
  const totalBits = codewords.length * 8;

  // Zigzag pattern
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // Skip timing column

    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vert : vert;

        if (!reserved[row][col] && bitIndex < totalBits) {
          const byteIndex = Math.floor(bitIndex / 8);
          const bitPos = 7 - (bitIndex % 8);
          matrix[row][col] = ((codewords[byteIndex] >> bitPos) & 1) === 1;
          bitIndex++;
        }
      }
    }
  }
}

function applyMask(matrix, reserved, size, mask) {
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (reserved[row][col]) continue;

      let invert = false;
      switch (mask) {
        case 0: invert = (row + col) % 2 === 0; break;
        case 1: invert = row % 2 === 0; break;
        case 2: invert = col % 3 === 0; break;
        case 3: invert = (row + col) % 3 === 0; break;
        case 4: invert = (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0; break;
        case 5: invert = (row * col) % 2 + (row * col) % 3 === 0; break;
        case 6: invert = ((row * col) % 2 + (row * col) % 3) % 2 === 0; break;
        case 7: invert = ((row + col) % 2 + (row * col) % 3) % 2 === 0; break;
      }

      if (invert) {
        matrix[row][col] = !matrix[row][col];
      }
    }
  }
}

function drawFormatInfo(matrix, size, ecLevel, mask) {
  const formatBits = getFormatBits(ecLevel, mask);

  // Around top-left
  for (let i = 0; i <= 5; i++) {
    matrix[8][i] = ((formatBits >> (14 - i)) & 1) === 1;
  }
  matrix[8][7] = ((formatBits >> 8) & 1) === 1;
  matrix[8][8] = ((formatBits >> 7) & 1) === 1;
  matrix[7][8] = ((formatBits >> 6) & 1) === 1;
  for (let i = 0; i <= 5; i++) {
    matrix[5 - i][8] = ((formatBits >> i) & 1) === 1;
  }

  // Around top-right and bottom-left
  for (let i = 0; i <= 7; i++) {
    matrix[8][size - 1 - i] = ((formatBits >> i) & 1) === 1;
  }
  for (let i = 0; i <= 6; i++) {
    matrix[size - 1 - i][8] = ((formatBits >> (14 - i)) & 1) === 1;
  }
  matrix[size - 8][8] = true; // Dark module
}

function getFormatBits(ecLevel, mask) {
  const data = (ecLevel << 3) | mask;
  let rem = data;

  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  }

  const bits = ((data << 10) | rem) ^ 0x5412;
  return bits;
}

/**
 * Convert QR matrix to PNG data URI
 */
function matrixToPng(matrix, scale = 4, margin = 2) {
  const size = matrix.length;
  const imageSize = (size + margin * 2) * scale;

  // Create raw pixel data
  const pixels = new Uint8Array(imageSize * imageSize);

  for (let y = 0; y < imageSize; y++) {
    for (let x = 0; x < imageSize; x++) {
      const qrY = Math.floor(y / scale) - margin;
      const qrX = Math.floor(x / scale) - margin;

      let isBlack = false;
      if (qrY >= 0 && qrY < size && qrX >= 0 && qrX < size) {
        isBlack = matrix[qrY][qrX];
      }

      pixels[y * imageSize + x] = isBlack ? 0 : 255;
    }
  }

  // Encode as PNG
  return encodePng(pixels, imageSize, imageSize);
}

/**
 * Minimal PNG encoder for grayscale images
 */
function encodePng(pixels, width, height) {
  // PNG signature
  const signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

  // IHDR chunk
  const ihdr = createChunk('IHDR', [
    ...intToBytes(width, 4),
    ...intToBytes(height, 4),
    8,  // Bit depth
    0,  // Color type (grayscale)
    0,  // Compression method
    0,  // Filter method
    0   // Interlace method
  ]);

  // IDAT chunk (image data)
  const rawData = new Uint8Array(height * (1 + width));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width)] = 0; // Filter byte (none)
    for (let x = 0; x < width; x++) {
      rawData[y * (1 + width) + 1 + x] = pixels[y * width + x];
    }
  }

  const compressed = deflate(rawData);
  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', []);

  // Combine all chunks
  const png = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let offset = 0;

  png.set(signature, offset); offset += signature.length;
  png.set(ihdr, offset); offset += ihdr.length;
  png.set(idat, offset); offset += idat.length;
  png.set(iend, offset);

  // Convert to base64
  let binary = '';
  for (let i = 0; i < png.length; i++) {
    binary += String.fromCharCode(png[i]);
  }

  return 'data:image/png;base64,' + btoa(binary);
}

function createChunk(type, data) {
  const length = data.length;
  const chunk = new Uint8Array(12 + length);

  // Length (4 bytes)
  chunk[0] = (length >> 24) & 0xFF;
  chunk[1] = (length >> 16) & 0xFF;
  chunk[2] = (length >> 8) & 0xFF;
  chunk[3] = length & 0xFF;

  // Type (4 bytes)
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i);
  }

  // Data
  for (let i = 0; i < length; i++) {
    chunk[8 + i] = data[i];
  }

  // CRC32
  const crcData = new Uint8Array(4 + length);
  crcData.set(chunk.slice(4, 8 + length));
  const crc = crc32(crcData);

  chunk[8 + length] = (crc >> 24) & 0xFF;
  chunk[8 + length + 1] = (crc >> 16) & 0xFF;
  chunk[8 + length + 2] = (crc >> 8) & 0xFF;
  chunk[8 + length + 3] = crc & 0xFF;

  return chunk;
}

function intToBytes(n, length) {
  const bytes = [];
  for (let i = length - 1; i >= 0; i--) {
    bytes.push((n >> (i * 8)) & 0xFF);
  }
  return bytes;
}

// CRC32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c;
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Simple DEFLATE compression (uncompressed blocks)
 * For simplicity, uses stored blocks which work but aren't optimal
 */
function deflate(data) {
  const maxBlockSize = 65535;
  const blocks = [];

  for (let i = 0; i < data.length; i += maxBlockSize) {
    const block = data.slice(i, Math.min(i + maxBlockSize, data.length));
    const isLast = i + maxBlockSize >= data.length;

    // Block header
    blocks.push(isLast ? 0x01 : 0x00); // BFINAL + BTYPE (stored)

    // Length and complement
    const len = block.length;
    blocks.push(len & 0xFF);
    blocks.push((len >> 8) & 0xFF);
    blocks.push((~len) & 0xFF);
    blocks.push((~len >> 8) & 0xFF);

    // Data
    for (const byte of block) {
      blocks.push(byte);
    }
  }

  // Adler-32 checksum
  let s1 = 1, s2 = 0;
  for (const byte of data) {
    s1 = (s1 + byte) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const adler = (s2 << 16) | s1;

  // Zlib wrapper
  const result = new Uint8Array(2 + blocks.length + 4);
  result[0] = 0x78; // CMF
  result[1] = 0x01; // FLG
  result.set(blocks, 2);
  result[result.length - 4] = (adler >> 24) & 0xFF;
  result[result.length - 3] = (adler >> 16) & 0xFF;
  result[result.length - 2] = (adler >> 8) & 0xFF;
  result[result.length - 1] = adler & 0xFF;

  return result;
}

/**
 * Generate QR code as PNG data URI
 *
 * @param {string} data - Data to encode
 * @param {Object} options - Options
 * @param {number} [options.scale=4] - Module size in pixels
 * @param {number} [options.margin=2] - Quiet zone in modules
 * @param {'L'|'M'|'Q'|'H'} [options.errorCorrection='M'] - Error correction level
 * @returns {string} PNG data URI
 */
export function generateQrCode(data, options = {}) {
  const {
    scale = 4,
    margin = 2,
    errorCorrection = 'M'
  } = options;

  const ecLevel = ERROR_CORRECTION_LEVEL[errorCorrection] ?? ERROR_CORRECTION_LEVEL.M;
  const matrix = createQrCode(data, ecLevel);

  return matrixToPng(matrix, scale, margin);
}

/**
 * Generate QR codes for an event
 *
 * @param {Object} event - Event with links
 * @returns {{public: string, signup: string}} QR code data URIs
 */
export function generateEventQrCodes(event) {
  if (!event.links) {
    throw new Error('Event must have links');
  }

  return {
    public: generateQrCode(event.links.publicUrl, { errorCorrection: 'M' }),
    signup: generateQrCode(event.links.signupUrl, { errorCorrection: 'M' })
  };
}
