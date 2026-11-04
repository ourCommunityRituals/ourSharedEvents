// Owner art from Instagram (Creator account, official Graph API, never scraped).
// The token is never logged and never put in an error message.

const MEDIA_URL = 'https://graph.instagram.com/me/media';
const FIELDS = 'id,caption,media_type,media_url,timestamp';
const KEEP = new Set(['IMAGE', 'CAROUSEL_ALBUM']);
const TOKEN_LIFE_DAYS = 60;
const TOKEN_WARN_DAY = 50;
const MAX_PAGES = 50;

/** Strip any access_token value from a URL before it is logged. */
export function redactUrl(url) {
  return String(url).replace(/(access_token=)[^&#\s]*/gi, '$1REDACTED');
}

export function extractHashtags(caption) {
  const out = new Set();
  for (const m of String(caption || '').matchAll(/#([\p{L}\p{N}_]+)/gu))
    out.add(m[1].toLowerCase());
  return [...out];
}

function captionWords(caption) {
  return new Set(
    String(caption || '')
      .toLowerCase()
      .replace(/#/g, ' ')
      .split(/[^\p{L}\p{N}_]+/u)
      .filter(Boolean)
  );
}

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * List the owner's image posts. A 400 or 401 returns [] and sets listPosts.warning.
 */
export async function listPosts({ token, fetch: fetchFn = globalThis.fetch } = {}) {
  listPosts.warning = null;
  const posts = [];
  let url = `${MEDIA_URL}?fields=${FIELDS}&access_token=${encodeURIComponent(token || '')}`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res = await fetchFn(url);
    if (res.status === 400 || res.status === 401) {
      listPosts.warning = `Instagram rejected the token (HTTP ${res.status}); no art this run. Refresh the token.`;
      return [];
    }
    if (!res.ok) throw new Error(`Instagram media request failed (HTTP ${res.status})`);
    const body = await res.json();
    for (const p of body.data || []) {
      if (!KEEP.has(p.media_type) || !p.media_url) continue;
      posts.push({
        id: String(p.id),
        caption: p.caption || '',
        hashtags: extractHashtags(p.caption),
        mediaUrl: p.media_url,
      });
    }
    url = body.paging && body.paging.next ? body.paging.next : null;
  }
  return posts;
}

/**
 * Pick a post for a find by event type, or null. Deterministic: candidates are
 * sorted by id, then indexed by fnv1a(venue|starts_at).
 * artTags maps a lowercase hashtag or caption word to a type id or category code
 * (string or array). typeCategory (optional) maps type id -> category code.
 */
export function pickArt(find, posts, artTags, typeCategory) {
  const tags = (artTags && artTags.tags) || {};
  const wanted = new Set([String(find.event_type_id)]);
  const category = typeCategory && typeCategory.get(find.event_type_id);
  if (category) wanted.add(String(category));
  const candidates = (posts || []).filter((post) => {
    const keys = new Set([...(post.hashtags || []), ...captionWords(post.caption)]);
    for (const k of keys) {
      if (!Object.hasOwn(tags, k)) continue;
      const v = tags[k];
      if ((Array.isArray(v) ? v : [v]).some((x) => wanted.has(String(x)))) return true;
    }
    return false;
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return candidates[fnv1a(`${find.venue}|${find.starts_at}`) % candidates.length];
}

/** Warn from day 50 of the 60-day long-lived token. Dates are YYYY-MM-DD. */
export function tokenWarning(issuedDate, today) {
  const days = Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${issuedDate}T00:00:00Z`)) / 86400000
  );
  if (Number.isNaN(days) || days < TOKEN_WARN_DAY) return null;
  if (days >= TOKEN_LIFE_DAYS)
    return `Instagram token issued ${issuedDate} has expired (day ${days} of ${TOKEN_LIFE_DAYS}). Refresh it now.`;
  return `Instagram token issued ${issuedDate} is at day ${days} of ${TOKEN_LIFE_DAYS}; refresh it within ${TOKEN_LIFE_DAYS - days} days.`;
}
