// PMTiles range reads from R2, same origin.
//
// A PMTiles archive is one file; the browser library asks for byte ranges of it
// (header + directories first, then one range per tile). This handler answers
// those ranges from an R2 object and nothing else:
//
//   - only keys on the allowlist are served (no path reaches R2 from the URL);
//   - a request without a single closed `bytes=a-b` range is refused, so nobody
//     can pull the whole archive through the Worker;
//   - a range larger than MAX_RANGE_BYTES is refused;
//   - the response is pinned to the object's ETag, so a swapped archive can
//     never be stitched together with ranges cached from the old one.
//
// No lat/lon, no viewer location and no identity is read here: the only inputs
// are an allowlisted file name and a byte range.

export interface TilesEnv {
  MAP_TILES: R2Bucket;
}

/** Largest single range answered. The library's first read is 16 KiB; leaf
 * directories and z15 tiles in a dense metro stay well under this. */
export const MAX_RANGE_BYTES = 4 * 1024 * 1024;

/** Archive names the route will serve. The name carries the build date, so a
 * new build is a new URL and the long cache lifetime below is safe. */
export const TILE_ARCHIVES: ReadonlySet<string> = new Set(['chicago-region.pmtiles']);

const RANGE_RE = /^bytes=(\d+)-(\d+)$/;

function refuse(status: number, code: string, extra?: Record<string, string>): Response {
  return Response.json(
    { ok: false, code },
    { status, headers: { 'Cache-Control': 'no-store', ...extra } }
  );
}

export function parseRange(header: string | null): { offset: number; length: number } | null {
  const m = RANGE_RE.exec(header ?? '');
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
  return { offset: start, length: end - start + 1 };
}

export async function handleTileRange(
  request: Request,
  env: TilesEnv,
  name: string
): Promise<Response> {
  if (request.method !== 'GET') return refuse(405, 'METHOD_NOT_ALLOWED', { Allow: 'GET' });
  if (!TILE_ARCHIVES.has(name)) return refuse(404, 'NOT_FOUND');

  const range = parseRange(request.headers.get('Range'));
  if (!range) return refuse(416, 'RANGE_REQUIRED');
  if (range.length > MAX_RANGE_BYTES) return refuse(416, 'RANGE_TOO_LARGE');

  // `If-Match` lets the library detect an archive that changed under it.
  const ifMatch = request.headers.get('If-Match');
  let object: R2ObjectBody | R2Object | null;
  try {
    object = await env.MAP_TILES.get(name, {
      range,
      onlyIf: ifMatch ? { etagMatches: ifMatch.replace(/"/g, '') } : undefined,
    });
  } catch {
    // R2 throws on a range that starts past the end of the object.
    return refuse(416, 'RANGE_NOT_SATISFIABLE');
  }
  if (!object) return refuse(404, 'NOT_FOUND');
  if (!('body' in object)) return refuse(412, 'ARCHIVE_CHANGED');
  if (range.offset >= object.size) {
    return refuse(416, 'RANGE_NOT_SATISFIABLE', { 'Content-Range': `bytes */${object.size}` });
  }

  const end = Math.min(range.offset + range.length, object.size) - 1;
  return new Response(object.body, {
    status: 206,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Range': `bytes ${range.offset}-${end}/${object.size}`,
      'Content-Length': String(end - range.offset + 1),
      'Accept-Ranges': 'bytes',
      ETag: object.httpEtag,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}
