/**
 * Security alert utility — Linear issue creation + D1 alert logging
 *
 * Used by:
 *   - The scheduled security cron handler (src/index.ts)
 *   - Any future admin endpoint that wants to surface an alert
 *
 * Linear issue fields:
 *   - Title includes severity prefix and affected surface
 *   - Description includes investigation steps, thresholds, and links
 *   - Priority maps: CRITICAL→1 (urgent), HIGH→2, MEDIUM→3, LOW→4
 *
 * The Linear API call is best-effort — a network failure here must never
 * crash the cron job. Errors are logged as structured JSON.
 */

import { errorLabel } from './error-label';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type AlertType =
  | 'auth_failures'
  | 'rate_limit_triggers'
  | 'error_rate_5xx'
  | 'error_rate_4xx'
  | 'secret_leak'
  | 'npm_vulnerability'
  | 'health_check_failure'
  | 'anomaly_composite'
  | 'key_rotation_age';

export interface SecurityAlertPayload {
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  /** Structured detail object — counts, thresholds, sample values */
  details: Record<string, unknown>;
  /** The endpoint or surface that triggered the alert */
  affectedEndpoint?: string;
  /** ISO timestamp of when the anomaly was first detected */
  detectedAt?: string;
}

export interface SecurityAlertEnv {
  /** Main D1 database (security_alerts table lives here) */
  DB: D1Database;
  /** Linear personal API key — if unset, Linear issue creation is skipped */
  LINEAR_API_KEY?: string;
  /** Linear team identifier (e.g. "OUR") */
  LINEAR_TEAM_ID?: string;
  /** "staging" | "production" | "development" */
  WORKER_ENV?: string;
  /** "empty" | "full": which staging site this is (only read when WORKER_ENV is "staging") */
  STAGING_VARIANT?: string;
}

// ─── Priority mapping ─────────────────────────────────────────────────────────

const SEVERITY_TO_LINEAR_PRIORITY: Record<AlertSeverity, number> = {
  CRITICAL: 1, // Urgent
  HIGH: 2, // High
  MEDIUM: 3, // Medium
  LOW: 4, // Low
};

// ─── D1 persistence ───────────────────────────────────────────────────────────

/**
 * Write an alert row to security_alerts in D1.
 * Returns the UUID of the inserted row, or null on failure.
 */
async function persistAlert(
  db: D1Database,
  payload: SecurityAlertPayload,
  env: string
): Promise<string | null> {
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO security_alerts
           (id, type, severity, message, details, env)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        payload.type,
        payload.severity,
        payload.message,
        JSON.stringify(payload.details),
        env
      )
      .run();
    return id;
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'SECURITY_ALERT_PERSIST_ERROR',
        error: errorLabel(err),
        alertType: payload.type,
        timestamp: new Date().toISOString(),
      })
    );
    return null;
  }
}

// ─── Linear issue creation ────────────────────────────────────────────────────

function buildLinearTitle(payload: SecurityAlertPayload): string {
  const prefix = payload.severity === 'CRITICAL' ? '[CRITICAL]' : `[${payload.severity}]`;
  const date = (payload.detectedAt ?? new Date().toISOString()).slice(0, 10);
  return `${prefix}[Security] ${payload.message} — ${date}`;
}

/**
 * The deployment an alert's runbook should point at (OSE-1418). Before this,
 * every runbook said to curl staging, so a production alert sent the on-call
 * to the wrong Worker. Unknown envs name no host rather than guess one.
 */
export function alertTarget(
  workerEnv: string | undefined,
  stagingVariant?: string
): {
  label: string;
  baseUrl: string | null;
  wranglerEnv: string | null;
} {
  if (workerEnv === 'production') {
    return {
      label: 'production',
      baseUrl: 'https://oursharedevents.com',
      wranglerEnv: 'production',
    };
  }
  if (workerEnv === 'staging' && stagingVariant === 'full') {
    return {
      label: 'staging-full',
      baseUrl: 'https://stg-full.oursharedevents.com',
      wranglerEnv: 'staging-full',
    };
  }
  if (workerEnv === 'staging') {
    return { label: 'staging', baseUrl: 'https://stg.oursharedevents.com', wranglerEnv: 'staging' };
  }
  return {
    label: `unknown (WORKER_ENV=${workerEnv ?? 'unset'})`,
    baseUrl: null,
    wranglerEnv: null,
  };
}

export function buildLinearDescription(
  payload: SecurityAlertPayload,
  alertId: string | null,
  workerEnv?: string,
  stagingVariant?: string
): string {
  const detectedAt = payload.detectedAt ?? new Date().toISOString();
  const detailsJson = JSON.stringify(payload.details, null, 2);

  const investigationSteps = buildInvestigationSteps(payload, workerEnv, stagingVariant);

  return `## Security Alert — ${payload.type}

**Environment:** ${alertTarget(workerEnv, stagingVariant).label}
**Severity:** ${payload.severity}
**Detected:** ${detectedAt}
**Alert ID:** ${alertId ?? 'not persisted'}
${payload.affectedEndpoint ? `**Affected Endpoint:** \`${payload.affectedEndpoint}\`` : ''}

---

### Summary

${payload.message}

---

### Alert Details

\`\`\`json
${detailsJson}
\`\`\`

---

### Steps to Investigate

${investigationSteps}

---

### References

- [Cloudflare Workers Dashboard](https://dash.cloudflare.com/)
- [D1 security_alerts table](https://dash.cloudflare.com/) — query \`SELECT * FROM security_alerts WHERE id = '${alertId ?? 'unknown'}'\`
- [security-monitoring.yml workflow](../../.github/workflows/security-monitoring.yml)
`;
}

export function buildInvestigationSteps(
  payload: SecurityAlertPayload,
  workerEnv?: string,
  stagingVariant?: string
): string {
  const target = alertTarget(workerEnv, stagingVariant);
  const wranglerEnv = target.wranglerEnv ?? '<env that raised this alert>';
  const healthUrl = target.baseUrl
    ? `${target.baseUrl}/health`
    : '<base URL of the env that raised this alert>/health';
  switch (payload.type) {
    case 'auth_failures':
      return `1. Query D1: \`SELECT actor, ip, COUNT(*) FROM admin_audit_log WHERE outcome = 'denied' AND created_at > datetime('now', '-24 hours') GROUP BY actor, ip ORDER BY 3 DESC LIMIT 20\`
2. Check if failures cluster around a single IP (brute force) or are distributed (credential stuffing)
3. If brute force: add the IP to Cloudflare WAF block list
4. If credential stuffing: rotate ADMIN_KEY and X_OCR_INTERNAL secrets immediately
5. Review CF Access logs for failed authentication attempts
6. Check \`/api/v2/admin/security/rate-limit-stats\` for rate-limit context (keyed bucket ids, not IPs; addresses are in Cloudflare Security → Events)`;

    case 'rate_limit_triggers':
      return `1. The alert count is buckets tripped when the nightly cron ran (a snapshot, not a daily total). Check \`GET /api/v2/admin/security/rate-limit-stats\` — top-10 buckets rate-limited right now (active 60 s windows; no hourly history — use Cloudflare Security → Events for that). The \`ip\` field is an HMAC bucket id (OSE-1447), never an address
2. Identify if triggers come from one bucket (scraping / DDoS) or many (viral event)
3. For a single abuser: find its address in Cloudflare Dashboard → Security → Events (or Workers logs), then add a WAF → Block rule
4. For a legitimate traffic spike: each limit is a code constant (the max passed to that route's \`checkRateLimit\` call), not an env var. The stats \`limit\` field shows which one tripped; raise it in a PR and redeploy
5. Check which endpoints are hit most by querying the D1 audit log
6. Review KV keys with prefix \`ratelimit:\` for the worst offenders (keyed hashes; they do not reverse to an IP)`;

    case 'error_rate_5xx':
      return `1. Pull recent Worker logs from Cloudflare Dashboard → Workers → Logs
2. Filter for \`"type":"UNHANDLED_ERROR"\` structured log entries
3. Check D1 health: run a simple query against the ${target.label} database via Wrangler CLI
4. Verify D1 migrations are up to date: \`wrangler d1 migrations list DB --env ${wranglerEnv} --remote\`
5. Check if a recent deploy introduced a regression — compare with previous version
6. Roll back if needed: \`wrangler rollback --env ${wranglerEnv}\``;

    case 'error_rate_4xx':
      return `1. A spike in 4xx is often a bot scanning for vulnerabilities or a broken client
2. Check CF WAF analytics for scanning patterns
3. Query D1 admin_audit_log for \`outcome = 'denied'\` entries for auth-related 4xx
4. Review rate-limit KV for IP clustering
5. If 404s are spiking, verify route table hasn't changed (router.ts)`;

    case 'secret_leak':
      return `1. **IMMEDIATELY rotate any secrets identified in the gitleaks report**
2. Treat all identified secrets as fully compromised — revoke first, investigate second
3. Check Cloudflare Workers → Secrets for each binding
4. Rotate: ADMIN_KEY, X_OCR_INTERNAL, FORMS_ENCRYPTION_KEY, LINEAR_API_KEY
5. Search git history: \`git log --all -p --follow -S 'SECRET_VALUE'\`
6. After rotation, add the pattern to \`.gitleaks.toml\` as an allowlist entry with justification`;

    case 'npm_vulnerability':
      return `1. Run \`npm audit\` locally to reproduce
2. Run \`npm audit fix\` for auto-fixable vulnerabilities (check for breaking changes)
3. For manual fixes, review the advisory URL in the npm audit output
4. Pin to a patched version via \`overrides\` in package.json if upstream hasn't released a fix
5. If a CVE cannot be mitigated, document in \`.security-reports/exceptions.md\` with justification
6. Re-run CI to verify the fix`;

    case 'health_check_failure':
      return `1. Check the ${target.label} Worker is deployed: \`curl ${healthUrl}\`
2. Review Cloudflare Access for \`/api/v2/admin/*\` — ensure CF Access policy is active
3. Verify security headers in CF Zone → SSL/TLS → Edge Certificates and Cache → Configuration
4. Check Worker error logs for CSP/header injection issues
5. Re-run the health check manually: \`workflow_dispatch\` on security-monitoring.yml`;

    case 'key_rotation_age':
      return `1. Run the rotation script: \`scripts/rotate-forms-key.sh\` (OSE-580)
2. Set the new key via: \`wrangler secret put FORMS_ENCRYPTION_KEY --env production\`
3. Update FORMS_KEY_ROTATED_AT to today's ISO date: \`wrangler secret put FORMS_KEY_ROTATED_AT --env production\` → value: \`$(date -u +%Y-%m-%dT%H:%M:%SZ)\`
4. Re-encrypt existing PII records if a key version bump is needed: run \`scripts/reencrypt-pii.ts\`
5. Confirm the alert resolves on the next cron tick (SECURITY_CRON_COMPLETE log should show no key_rotation anomaly)
6. Document the rotation date in the ops runbook`;

    default:
      return `1. Review alert details above
2. Check Cloudflare Workers Logs for related errors
3. Query D1 security_alerts for historical context
4. Escalate to on-call if severity is CRITICAL`;
  }
}

/**
 * Create a Linear issue for a security alert.
 * Returns the Linear issue URL, or null if creation fails or is skipped.
 */
async function createLinearIssue(
  payload: SecurityAlertPayload,
  alertId: string | null,
  env: SecurityAlertEnv
): Promise<string | null> {
  const apiKey = env.LINEAR_API_KEY?.trim();
  const teamId = env.LINEAR_TEAM_ID?.trim();

  if (!apiKey || !teamId) {
    console.log(
      JSON.stringify({
        type: 'LINEAR_SKIP',
        reason: 'LINEAR_API_KEY or LINEAR_TEAM_ID not configured',
        alertType: payload.type,
      })
    );
    return null;
  }

  const title = buildLinearTitle(payload);
  const description = buildLinearDescription(payload, alertId, env.WORKER_ENV, env.STAGING_VARIANT);
  const priority = SEVERITY_TO_LINEAR_PRIORITY[payload.severity];

  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          url
        }
      }
    }
  `;

  const variables = {
    input: {
      teamId,
      title,
      description,
      priority,
    },
  };

  try {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    if (!response.ok) {
      throw new Error(`Linear API HTTP ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      data?: {
        issueCreate?: {
          success: boolean;
          issue?: { id: string; identifier: string; url: string };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (data.errors?.length) {
      throw new Error(`Linear GraphQL errors: ${data.errors.map((e) => e.message).join(', ')}`);
    }

    const result = data.data?.issueCreate;
    if (!result?.success || !result.issue) {
      throw new Error('Linear issueCreate returned success=false');
    }

    console.log(
      JSON.stringify({
        type: 'LINEAR_ISSUE_CREATED',
        issueId: result.issue.id,
        identifier: result.issue.identifier,
        url: result.issue.url,
        alertType: payload.type,
        severity: payload.severity,
        timestamp: new Date().toISOString(),
      })
    );

    return result.issue.url;
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'LINEAR_ISSUE_ERROR',
        error: errorLabel(err),
        alertType: payload.type,
        timestamp: new Date().toISOString(),
      })
    );
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RaiseAlertResult {
  alertId: string | null;
  linearUrl: string | null;
}

/**
 * Raise a security alert:
 *   1. Persist to D1 security_alerts
 *   2. Create a Linear issue (best-effort)
 *
 * Returns the D1 alert ID and the Linear issue URL (both may be null on error).
 * Never throws — all errors are swallowed and logged.
 */
export async function raiseSecurityAlert(
  payload: SecurityAlertPayload,
  env: SecurityAlertEnv
): Promise<RaiseAlertResult> {
  const workerEnv = env.WORKER_ENV ?? 'unknown';

  // Step 1: Persist to D1
  const alertId = await persistAlert(env.DB, payload, workerEnv);

  // Step 2: Create Linear issue (best-effort)
  const linearUrl = await createLinearIssue(payload, alertId, env);

  console.log(
    JSON.stringify({
      type: 'SECURITY_ALERT_RAISED',
      alertId,
      linearUrl,
      alertType: payload.type,
      severity: payload.severity,
      message: payload.message,
      env: workerEnv,
      timestamp: new Date().toISOString(),
    })
  );

  return { alertId, linearUrl };
}

/**
 * Resolve an open alert by setting resolved_at.
 * Idempotent — safe to call if already resolved.
 */
export async function resolveSecurityAlert(db: D1Database, alertId: string): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE security_alerts SET resolved_at = datetime('now') WHERE id = ? AND resolved_at IS NULL`
      )
      .bind(alertId)
      .run();
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'SECURITY_ALERT_RESOLVE_ERROR',
        error: errorLabel(err),
        alertId,
        timestamp: new Date().toISOString(),
      })
    );
  }
}
