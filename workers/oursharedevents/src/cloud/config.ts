/**
 * GCP configuration helpers (OSE-215 / BE-19)
 */

export const GCP_API_URLS = {
  bigqueryInsert: (projectId: string, datasetId: string, tableId: string) =>
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${datasetId}/tables/${tableId}/insertAll`,
  bigqueryQuery: (projectId: string) =>
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`,
} as const;

export const GCP_SCOPES = {
  bigquery: 'https://www.googleapis.com/auth/bigquery.insertdata',
  bigqueryReadonly: 'https://www.googleapis.com/auth/bigquery.readonly',
} as const;

export interface CloudEnv {
  /** RSA private key for WIF JWT signing (wrangler secret) */
  WIF_PRIVATE_KEY_PEM?: string;
  /** JWKS JSON for /.well-known/jwks.json (wrangler var) */
  WIF_PUBLIC_JWKS?: string;
  /** GCP project number (12 digits) */
  GCP_PROJECT_NUMBER?: string;
  /** WIF pool ID */
  WIF_POOL_ID?: string;
  /** WIF provider ID */
  WIF_PROVIDER_ID?: string;
  /** Worker issuer URL */
  WIF_ISSUER?: string;
  /** GCP project ID (for BigQuery API URLs) */
  GCP_PROJECT_ID?: string;
  /** BigQuery dataset ID, defaults to oursharedevents_backup */
  BIGQUERY_DATASET_ID?: string;
}

export function getProjectId(env: CloudEnv): string {
  return env.GCP_PROJECT_ID?.trim() ?? '';
}

export function getDatasetId(env: CloudEnv): string {
  return env.BIGQUERY_DATASET_ID?.trim() ?? 'oursharedevents_backup';
}
