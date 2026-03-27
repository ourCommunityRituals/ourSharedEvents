/**
 * Google Cloud Platform Integrations
 *
 * Barrel file exporting all cloud service integrations:
 * - BigQuery: Data backup for events, analytics, shared reports
 * - Google Maps: Venue geocoding and maps for SharedReports & OurEventRings
 * - Vertex AI: Generative AI for event chat bot creation
 *
 * All services authenticate via the existing Google service account
 * from google/auth.ts.
 *
 * @module cloud
 * @see GCP Project: project-7cc9adcd-ed55-47aa-958
 */

// Cloud Configuration
export {
  GCP_PROJECT_ID,
  GCP_DEFAULT_REGION,
  GCP_API_URLS,
  GCP_SCOPES,
  getProjectId,
  getRegion,
  getVertexAiBaseUrl,
  type CloudEnv,
} from './config';

// BigQuery - Data Backup
export {
  bigQueryInsertRows,
  bigQueryRunQuery,
  backupEvents,
  backupSharedReport,
  isBigQueryConfigured,
  BigQueryError,
  BIGQUERY_ERROR_CODES,
  BACKUP_TABLES,
  type BigQueryEnv,
  type BigQueryErrorCode,
  type BigQueryInsertRow,
  type BigQueryInsertResult,
  type BigQueryQueryResult,
} from './bigquery';

// Google Maps - SharedReports & OurEventRings
export {
  geocodeAddress,
  getPlaceDetails,
  buildStaticMapUrl,
  buildMapsLink,
  getReportLocationData,
  isMapsConfigured,
  MapsError,
  MAPS_ERROR_CODES,
  type MapsEnv,
  type MapsErrorCode,
  type LatLng,
  type GeocodeResult,
  type PlaceDetails,
  type StaticMapOptions,
  type ReportLocationData,
} from './maps';

// Vertex AI - Chat Bot Creation
export {
  generateText,
  chat,
  eventBotRespond,
  isVertexAiConfigured,
  VertexAiError,
  VERTEX_AI_ERROR_CODES,
  type VertexAiEnv,
  type VertexAiErrorCode,
  type ChatMessage,
  type GenerationConfig,
  type GenerationResult,
  type EventBotContext,
} from './vertexai';
