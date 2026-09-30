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
  /** BigQuery flat backup dataset. Only production may use (or default to) oursharedevents_backup. */
  BIGQUERY_DATASET_ID?: string;
  /** Deployment env ('production' | 'staging' | 'development' | 'test'). OSE-1416. */
  WORKER_ENV?: string;
}

/** Production's flat backup dataset. Non-production envs may never resolve it (OSE-1416). */
export const PRODUCTION_BACKUP_DATASET = 'oursharedevents_backup';

/** A BigQuery target that would cross environments. Callers treat it as NOT_CONFIGURED. */
export class CloudConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudConfigError';
  }
}

export function getProjectId(env: CloudEnv): string {
  return env.GCP_PROJECT_ID?.trim() ?? '';
}

/**
 * Resolve the flat backup dataset. Fail closed (OSE-1416): the production
 * default applies only when WORKER_ENV === 'production'; any other env must
 * name its own dataset, and may never name production's.
 */
export function getDatasetId(env: CloudEnv): string {
  const isProduction = env.WORKER_ENV === 'production';
  const configured = env.BIGQUERY_DATASET_ID?.trim();
  const datasetId = configured || (isProduction ? PRODUCTION_BACKUP_DATASET : '');
  if (!datasetId) {
    throw new CloudConfigError(
      `BIGQUERY_DATASET_ID is not set for WORKER_ENV=${env.WORKER_ENV ?? 'unset'}; ` +
        'refusing to fall back to the production dataset'
    );
  }
  if (!isProduction && datasetId === PRODUCTION_BACKUP_DATASET) {
    throw new CloudConfigError(
      `WORKER_ENV=${env.WORKER_ENV ?? 'unset'} may not write to the production dataset ` +
        PRODUCTION_BACKUP_DATASET
    );
  }
  return datasetId;
}
