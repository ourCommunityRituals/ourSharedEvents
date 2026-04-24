/**
 * Google Maps Static API helper — OSE-217
 *
 * Auth: simple API key (no WIF). Key is server-side only; never exposed to
 * the browser. The Worker proxies the image bytes back to the client so the
 * key never appears in any rendered HTML.
 *
 * GCP prerequisites (done 2026-04-23):
 *   - maps-backend.googleapis.com enabled on project-7cc9adcd-ed55-47aa-958
 *   - GOOGLE_MAPS_API_KEY secret pushed to staging
 *   - Key restricted to maps-backend.googleapis.com only
 */

export interface MapsEnv {
  GOOGLE_MAPS_API_KEY?: string;
}

export interface StaticMapOptions {
  width?: number;
  height?: number;
  zoom?: number;
  maptype?: 'roadmap' | 'satellite' | 'terrain' | 'hybrid';
}

/** Returns true only when the Maps API key is present and non-empty. */
export function isGoogleMapsConfigured(env: MapsEnv): boolean {
  return typeof env.GOOGLE_MAPS_API_KEY === 'string' && env.GOOGLE_MAPS_API_KEY.trim().length > 0;
}

/**
 * Fetches a Static Maps image from Google and returns it as a proxied Response.
 * The API key is injected server-side; it never reaches the browser.
 *
 * Returns:
 *   - 200 image/png  — success
 *   - 400            — venue param missing or > 200 chars
 *   - 503            — GOOGLE_MAPS_API_KEY not configured
 *   - 502            — Google returned a non-200 status
 */
export async function fetchStaticMapImage(
  env: MapsEnv,
  venue: string,
  opts: StaticMapOptions = {}
): Promise<Response> {
  if (!isGoogleMapsConfigured(env)) {
    return Response.json(
      { ok: false, code: 'MAPS_NOT_CONFIGURED', error: 'Google Maps API key not set' },
      { status: 503 }
    );
  }

  const trimmed = venue.trim();
  if (!trimmed) {
    return Response.json(
      { ok: false, code: 'INVALID_VENUE', error: 'venue param is required' },
      { status: 400 }
    );
  }
  if (trimmed.length > 200) {
    return Response.json(
      { ok: false, code: 'VENUE_TOO_LONG', error: 'venue must be 200 chars or fewer' },
      { status: 400 }
    );
  }

  const { width = 240, height = 160, zoom = 15, maptype = 'roadmap' } = opts;

  const params = new URLSearchParams({
    center: trimmed,
    zoom: String(zoom),
    size: `${width}x${height}`,
    maptype,
    markers: `color:red|${trimmed}`,
    key: env.GOOGLE_MAPS_API_KEY!,
  });

  const googleUrl = `https://maps.googleapis.com/maps/api/staticmap?${params}`;

  let upstream: Response;
  try {
    upstream = await fetch(googleUrl);
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'MAPS_FETCH_ERROR',
        venue: trimmed,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      })
    );
    return Response.json(
      { ok: false, code: 'MAPS_UPSTREAM_ERROR', error: 'Failed to reach Google Maps' },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    console.warn(
      JSON.stringify({
        type: 'MAPS_UPSTREAM_STATUS',
        venue: trimmed,
        status: upstream.status,
        timestamp: new Date().toISOString(),
      })
    );
    return Response.json(
      { ok: false, code: 'MAPS_UPSTREAM_STATUS', error: `Google Maps returned ${upstream.status}` },
      { status: 502 }
    );
  }

  // Proxy the image bytes; strip any Google-set cookies or auth headers.
  const contentType = upstream.headers.get('content-type') ?? 'image/png';
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
