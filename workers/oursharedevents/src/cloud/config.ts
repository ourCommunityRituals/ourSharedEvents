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
  GCP_PROJECT_ID?: string;
  BIGQUERY_DATASET_ID?: string;
  GOOGLE_SA_CLIENT_EMAIL?: string;
  GOOGLE_SA_PRIVATE_KEY_PEM?: string;
}

export function getProjectId(env: CloudEnv): string {
  return env.GCP_PROJECT_ID?.trim() ?? '';
}

export function getDatasetId(env: CloudEnv): string {
  return env.BIGQUERY_DATASET_ID?.trim() ?? 'oursharedevents_backup';
}
