/**
 * Google Cloud Platform Configuration
 *
 * Centralized GCP project configuration for cloud service integrations.
 * All cloud services (BigQuery, Maps, Vertex AI) share the same
 * service account authentication from google/auth.ts.
 *
 * @module cloud/config
 */

// =============================================================================
// Constants
// =============================================================================

/** Default GCP project ID */
export const GCP_PROJECT_ID = 'project-7cc9adcd-ed55-47aa-958';

/** Default GCP region for regional services (Vertex AI, etc.) */
export const GCP_DEFAULT_REGION = 'us-central1';

/** Google Cloud API base URLs */
export const GCP_API_URLS = {
  BIGQUERY: 'https://bigquery.googleapis.com/bigquery/v2',
  MAPS_GEOCODING: 'https://maps.googleapis.com/maps/api/geocode/json',
  MAPS_PLACES: 'https://maps.googleapis.com/maps/api/place',
  MAPS_STATIC: 'https://maps.googleapis.com/maps/api/staticmap',
  VERTEX_AI: 'https://{region}-aiplatform.googleapis.com/v1',
} as const;

/** OAuth scopes for each cloud service */
export const GCP_SCOPES = {
  BIGQUERY: 'https://www.googleapis.com/auth/bigquery',
  MAPS: 'https://www.googleapis.com/auth/cloud-platform',
  VERTEX_AI: 'https://www.googleapis.com/auth/cloud-platform',
} as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Environment bindings for Google Cloud services
 */
export interface CloudEnv {
  /** GCP project ID (defaults to GCP_PROJECT_ID) */
  GCP_PROJECT_ID?: string;
  /** GCP region for regional services (defaults to us-central1) */
  GCP_REGION?: string;
  /** Google Maps API key (for client-side Maps JavaScript API) */
  GOOGLE_MAPS_API_KEY?: string;
  /** BigQuery dataset ID for data backup */
  BIGQUERY_DATASET_ID?: string;
  /** Vertex AI model ID (defaults to gemini-2.0-flash) */
  VERTEX_AI_MODEL_ID?: string;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get effective GCP project ID from env or default
 */
export function getProjectId(env: CloudEnv): string {
  return env.GCP_PROJECT_ID || GCP_PROJECT_ID;
}

/**
 * Get effective GCP region from env or default
 */
export function getRegion(env: CloudEnv): string {
  return env.GCP_REGION || GCP_DEFAULT_REGION;
}

/**
 * Build the Vertex AI API base URL for a specific region
 */
export function getVertexAiBaseUrl(env: CloudEnv): string {
  const region = getRegion(env);
  return GCP_API_URLS.VERTEX_AI.replace('{region}', region);
}
