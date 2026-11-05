// The owner's photographs, committed under stock/art/ (owner 2026-11-05), as
// posts the build can pick from. No Instagram call and no token: the full
// staging site has art even before the Meta app is set up.
//
// stock/art/library.json lists each photo: { id, file, caption, hashtags }.
// stock/art-tags.json maps a hashtag to the event categories it fits, so
// pickArt chooses among them exactly as it does for Instagram posts.

import { join } from 'node:path';

const SAFE_FILE = /^[a-z0-9-]+\.jpg$/;

/**
 * The library's photos as posts: { id, caption, hashtags, file }. Throws on a
 * malformed library or a listed file that is missing, so a bad commit fails
 * the build loudly instead of quietly loading events without art.
 */
export function localPosts(fs, artDir) {
  const lib = JSON.parse(fs.readFileSync(join(artDir, 'library.json'), 'utf8'));
  if (!lib || !Array.isArray(lib.photos)) throw new Error('stock/art/library.json: no photos list');
  const seen = new Set();
  return lib.photos.map((p, i) => {
    const where = `stock/art/library.json photo ${i}`;
    if (!p || typeof p.id !== 'string' || !p.id) throw new Error(`${where}: no id`);
    if (seen.has(p.id)) throw new Error(`${where}: duplicate id ${p.id}`);
    seen.add(p.id);
    if (typeof p.file !== 'string' || !SAFE_FILE.test(p.file))
      throw new Error(`${where}: file must be a plain lower-case .jpg name`);
    const file = join(artDir, p.file);
    if (!fs.existsSync(file)) throw new Error(`${where}: ${p.file} is missing`);
    if (p.orientation !== 'landscape' && p.orientation !== 'portrait')
      throw new Error(`${where}: orientation must be landscape or portrait`);
    const hashtags = Array.isArray(p.hashtags)
      ? p.hashtags.map((h) => String(h).toLowerCase())
      : [];
    return {
      id: p.id,
      caption: String(p.caption || ''),
      hashtags,
      file,
      // Nothing in the app picks by it yet: one cover per event, cropped square
      // on cards. Recorded for a portrait slot (poster art) to choose from later.
      orientation: p.orientation,
    };
  });
}
