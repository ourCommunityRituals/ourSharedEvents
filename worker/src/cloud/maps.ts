/**
 * Google Maps Client for SharedReports & OurEventRings
 *
 * Provides geocoding, place details, and static map generation
 * for event location data in SharedReports and OurEventRings
 * investigations. Supports:
 * - Geocoding event venues for map display in reports
 * - Place details for venue enrichment
 * - Static map URLs for report embedding (email-safe)
 *
 * @module cloud/maps
 */

import { type CloudEnv, GCP_API_URLS } from './config';

// =============================================================================
// Constants
// =============================================================================

/** Default map zoom level for event venues */
const DEFAULT_ZOOM = 15;

/** Default static map size */
const DEFAULT_MAP_SIZE = '600x300';

/** Maps API request timeout (5 seconds) */
const MAPS_REQUEST_TIMEOUT_MS = 5000;

// =============================================================================
// Error Codes
// =============================================================================

export const MAPS_ERROR_CODES = {
  GEOCODE_FAILED: 'MAPS_GEOCODE_FAILED',
  PLACE_LOOKUP_FAILED: 'MAPS_PLACE_LOOKUP_FAILED',
  NOT_CONFIGURED: 'MAPS_NOT_CONFIGURED',
  ZERO_RESULTS: 'MAPS_ZERO_RESULTS',
} as const;

export type MapsErrorCode = typeof MAPS_ERROR_CODES[keyof typeof MAPS_ERROR_CODES];

// =============================================================================
// Types
// =============================================================================

export interface MapsEnv extends CloudEnv {}

export class MapsError extends Error {
  readonly code: MapsErrorCode;

  constructor(code: MapsErrorCode, message: string) {
    super(message);
    this.name = 'MapsError';
    this.code = code;
  }
}

/** Geographic coordinates */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Geocode result for an event venue */
export interface GeocodeResult {
  /** Formatted address from Google */
  formattedAddress: string;
  /** Latitude/longitude */
  location: LatLng;
  /** Google Place ID for further lookups */
  placeId: string;
}

/** Place details for venue enrichment */
export interface PlaceDetails {
  /** Place name */
  name: string;
  /** Formatted address */
  address: string;
  /** Location coordinates */
  location: LatLng;
  /** Google Maps URL for the place */
  mapsUrl: string;
  /** Place types (e.g., bar, restaurant, establishment) */
  types: string[];
  /** Business status */
  businessStatus?: string;
}

/** Static map configuration for report embedding */
export interface StaticMapOptions {
  /** Center coordinates */
  center: LatLng;
  /** Zoom level (default: 15) */
  zoom?: number;
  /** Image size as 'WxH' (default: '600x300') */
  size?: string;
  /** Map type (default: roadmap) */
  maptype?: 'roadmap' | 'satellite' | 'terrain' | 'hybrid';
  /** Whether to add a marker at center (default: true) */
  marker?: boolean;
  /** Marker color (default: red) */
  markerColor?: string;
}

/** Location data for SharedReport venue display */
export interface ReportLocationData {
  /** Geocoded venue location */
  geocode: GeocodeResult;
  /** Static map image URL for email embedding */
  staticMapUrl: string;
  /** Google Maps link for the venue */
  mapsLink: string;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if Google Maps is configured
 */
export function isMapsConfigured(env: MapsEnv): boolean {
  return !!env.GOOGLE_MAPS_API_KEY;
}

/**
 * Geocode an event venue address
 *
 * Converts a venue address string to coordinates for map display
 * in SharedReports and OurEventRings investigations.
 *
 * @param env - Worker environment with Maps API key
 * @param address - Venue address to geocode
 * @returns Geocode result with coordinates and place ID
 * @throws {MapsError} If geocoding fails or returns zero results
 */
export async function geocodeAddress(
  env: MapsEnv,
  address: string
): Promise<GeocodeResult> {
  if (!isMapsConfigured(env)) {
    throw new MapsError(
      MAPS_ERROR_CODES.NOT_CONFIGURED,
      'GOOGLE_MAPS_API_KEY not configured'
    );
  }

  const params = new URLSearchParams({
    address,
    key: env.GOOGLE_MAPS_API_KEY!,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MAPS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${GCP_API_URLS.MAPS_GEOCODING}?${params}`,
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new MapsError(
        MAPS_ERROR_CODES.GEOCODE_FAILED,
        `Geocoding API error: HTTP ${response.status}`
      );
    }

    interface GeoResponse {
      status: string;
      results: Array<{
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
        place_id: string;
      }>;
    }

    const data = await response.json() as GeoResponse;

    if (data.status === 'ZERO_RESULTS' || data.results.length === 0) {
      throw new MapsError(
        MAPS_ERROR_CODES.ZERO_RESULTS,
        `No results for address: ${address}`
      );
    }

    if (data.status !== 'OK') {
      throw new MapsError(
        MAPS_ERROR_CODES.GEOCODE_FAILED,
        `Geocoding failed with status: ${data.status}`
      );
    }

    const result = data.results[0];
    return {
      formattedAddress: result.formatted_address,
      location: {
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
      },
      placeId: result.place_id,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof MapsError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      throw new MapsError(
        MAPS_ERROR_CODES.GEOCODE_FAILED,
        `Geocoding request timed out after ${MAPS_REQUEST_TIMEOUT_MS}ms`
      );
    }

    throw new MapsError(
      MAPS_ERROR_CODES.GEOCODE_FAILED,
      'Geocoding network error'
    );
  }
}

/**
 * Get place details by Place ID
 *
 * Enriches event venue data with business details for
 * SharedReports and OurEventRings investigations.
 *
 * @param env - Worker environment with Maps API key
 * @param placeId - Google Place ID from geocoding
 * @returns Place details with name, address, types
 * @throws {MapsError} If place lookup fails
 */
export async function getPlaceDetails(
  env: MapsEnv,
  placeId: string
): Promise<PlaceDetails> {
  if (!isMapsConfigured(env)) {
    throw new MapsError(
      MAPS_ERROR_CODES.NOT_CONFIGURED,
      'GOOGLE_MAPS_API_KEY not configured'
    );
  }

  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'name,formatted_address,geometry,url,types,business_status',
    key: env.GOOGLE_MAPS_API_KEY!,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MAPS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${GCP_API_URLS.MAPS_PLACES}/details/json?${params}`,
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new MapsError(
        MAPS_ERROR_CODES.PLACE_LOOKUP_FAILED,
        `Place Details API error: HTTP ${response.status}`
      );
    }

    interface PlaceResponse {
      status: string;
      result: {
        name: string;
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
        url: string;
        types: string[];
        business_status?: string;
      };
    }

    const data = await response.json() as PlaceResponse;

    if (data.status !== 'OK') {
      throw new MapsError(
        MAPS_ERROR_CODES.PLACE_LOOKUP_FAILED,
        `Place Details failed with status: ${data.status}`
      );
    }

    return {
      name: data.result.name,
      address: data.result.formatted_address,
      location: {
        lat: data.result.geometry.location.lat,
        lng: data.result.geometry.location.lng,
      },
      mapsUrl: data.result.url,
      types: data.result.types || [],
      businessStatus: data.result.business_status,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof MapsError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      throw new MapsError(
        MAPS_ERROR_CODES.PLACE_LOOKUP_FAILED,
        `Place Details request timed out after ${MAPS_REQUEST_TIMEOUT_MS}ms`
      );
    }

    throw new MapsError(
      MAPS_ERROR_CODES.PLACE_LOOKUP_FAILED,
      'Place Details network error'
    );
  }
}

/**
 * Generate a static map URL for report embedding
 *
 * Creates an embeddable static map image URL suitable for
 * SharedReport emails and display pages. No API call needed —
 * returns a URL that renders on demand.
 *
 * @param env - Worker environment with Maps API key
 * @param options - Static map configuration
 * @returns Static map image URL
 * @throws {MapsError} If Maps API key is not configured
 */
export function buildStaticMapUrl(
  env: MapsEnv,
  options: StaticMapOptions
): string {
  if (!isMapsConfigured(env)) {
    throw new MapsError(
      MAPS_ERROR_CODES.NOT_CONFIGURED,
      'GOOGLE_MAPS_API_KEY not configured'
    );
  }

  const { center, zoom = DEFAULT_ZOOM, size = DEFAULT_MAP_SIZE, maptype = 'roadmap', marker = true, markerColor = 'red' } = options;

  const params = new URLSearchParams({
    center: `${center.lat},${center.lng}`,
    zoom: String(zoom),
    size,
    maptype,
    key: env.GOOGLE_MAPS_API_KEY!,
  });

  if (marker) {
    params.set('markers', `color:${markerColor}|${center.lat},${center.lng}`);
  }

  return `${GCP_API_URLS.MAPS_STATIC}?${params}`;
}

/**
 * Build a Google Maps link for a location
 *
 * @param location - Coordinates
 * @param label - Optional label for the pin
 * @returns Google Maps URL
 */
export function buildMapsLink(location: LatLng, label?: string): string {
  const q = label
    ? encodeURIComponent(label)
    : `${location.lat},${location.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/**
 * Get full location data for a SharedReport venue
 *
 * Combines geocoding + static map + maps link into a single
 * result suitable for embedding in SharedReport bundles.
 *
 * @param env - Worker environment
 * @param venueAddress - Event venue address
 * @returns Complete location data for report embedding
 * @throws {MapsError} If geocoding or map generation fails
 */
export async function getReportLocationData(
  env: MapsEnv,
  venueAddress: string
): Promise<ReportLocationData> {
  const geocode = await geocodeAddress(env, venueAddress);

  const staticMapUrl = buildStaticMapUrl(env, {
    center: geocode.location,
    marker: true,
    markerColor: 'red',
  });

  const mapsLink = buildMapsLink(geocode.location, venueAddress);

  return {
    geocode,
    staticMapUrl,
    mapsLink,
  };
}
