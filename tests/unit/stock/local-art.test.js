// The owner's photographs as the full staging site's art (owner 2026-11-05).
//
// @born-red local-art | method: (1) an EXIF segment put back into one photo,
//   (2) the "court" tag dropped from art-tags.json (the seed's REC events lost
//   their photo), (3) a listed photo file renamed, (4) storefront-curb marked
//   landscape — each turned a test red |
//   date: 2026-11-05
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const ART = path.join(ROOT, 'stock/art');

let localPosts;
let pickArt;
beforeAll(async () => {
  ({ localPosts } = await import('../../../scripts/stock/local-art.mjs'));
  ({ pickArt } = await import('../../../scripts/stock/instagram.mjs'));
});

const json = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// JPEG segments that carry metadata: APP1 (EXIF, XMP), APP3-APP15 (IPTC and
// others), COM. Read up to the start of scan; the image data follows it.
function metadataSegments(bytes) {
  const found = [];
  let i = 2;
  while (i < bytes.length - 3 && bytes[i] === 0xff) {
    const m = bytes[i + 1];
    if (m === 0xda) break;
    if (m === 0xe1 || (m >= 0xe3 && m <= 0xef) || m === 0xfe) found.push(m.toString(16));
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  return found;
}

// Width and height from the JPEG's start-of-frame segment (SOF0-SOF2).
function jpegSize(bytes) {
  let i = 2;
  while (i < bytes.length - 9 && bytes[i] === 0xff) {
    const m = bytes[i + 1];
    if (m >= 0xc0 && m <= 0xc2) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  throw new Error('no start-of-frame segment');
}

describe('the committed photo library', () => {
  test('lists the owner’s six photos, each file present', () => {
    const posts = localPosts(fs, ART);
    expect(posts.map((p) => p.id)).toEqual([
      'blue-island-mural',
      'court-reflection',
      'city-sidewalk',
      'passenger-seat',
      'holiday-train',
      'storefront-curb',
    ]);
    for (const p of posts) expect(fs.existsSync(p.file), p.id).toBe(true);
  });

  test('each photo’s orientation is what its pixels say; storefront-curb is the portrait one', () => {
    const posts = localPosts(fs, ART);
    for (const p of posts) {
      const { width, height } = jpegSize(fs.readFileSync(p.file));
      expect(p.orientation, p.id).toBe(height > width ? 'portrait' : 'landscape');
    }
    expect(posts.filter((p) => p.orientation === 'portrait').map((p) => p.id)).toEqual([
      'storefront-curb',
    ]);
  });

  test('every photo is a JPEG with its metadata stripped (no EXIF, XMP, IPTC or comments)', () => {
    for (const p of localPosts(fs, ART)) {
      const bytes = fs.readFileSync(p.file);
      expect([bytes[0], bytes[1]], p.id).toEqual([0xff, 0xd8]);
      expect(metadataSegments(bytes), p.id).toEqual([]);
    }
  });

  test('every hashtag a photo carries is mapped in stock/art-tags.json', () => {
    const tags = json('stock/art-tags.json').tags;
    for (const p of localPosts(fs, ART)) {
      for (const h of p.hashtags) expect(Object.hasOwn(tags, h), `${p.id} #${h}`).toBe(true);
    }
  });

  test('every event in the fixed seed gets a photo', () => {
    const posts = localPosts(fs, ART);
    const artTags = json('stock/art-tags.json');
    const seed = json('stock/seed/seed.json');
    // A type id is etr-<category>-<name>; the category code is that middle part
    // (workers/oursharedevents/migrations/0076_event_type_categories.sql).
    const typeCategory = new Map(
      seed.events.map((e) => [e.event_type_id, e.event_type_id.split('-')[1].toUpperCase()])
    );
    const without = seed.events
      .filter(
        (e) => !pickArt({ ...e, starts_at: String(e.offsetDays) }, posts, artTags, typeCategory)
      )
      .map((e) => e.event_type_id);
    expect(without).toEqual([]);
  });
});

describe('localPosts refuses a bad library', () => {
  const fakeFs = (library, files = []) => ({
    readFileSync: () => JSON.stringify(library),
    existsSync: (p) => files.some((f) => p.endsWith(f)),
  });

  test('a listed file that is missing', () => {
    const lib = { photos: [{ id: 'a', file: 'a.jpg', hashtags: [] }] };
    expect(() => localPosts(fakeFs(lib), '/art')).toThrow(/a\.jpg is missing/);
  });

  test('a duplicate id', () => {
    const lib = {
      photos: [
        { id: 'a', file: 'a.jpg', orientation: 'landscape' },
        { id: 'a', file: 'b.jpg', orientation: 'landscape' },
      ],
    };
    expect(() => localPosts(fakeFs(lib, ['a.jpg', 'b.jpg']), '/art')).toThrow(/duplicate id a/);
  });

  test('an orientation that is neither landscape nor portrait', () => {
    const lib = { photos: [{ id: 'a', file: 'a.jpg', orientation: 'square' }] };
    expect(() => localPosts(fakeFs(lib, ['a.jpg']), '/art')).toThrow(/landscape or portrait/);
  });

  test('a file name that could leave the folder', () => {
    const lib = { photos: [{ id: 'a', file: '../secret.jpg' }] };
    expect(() => localPosts(fakeFs(lib, ['secret.jpg']), '/art')).toThrow(/plain lower-case/);
  });
});
