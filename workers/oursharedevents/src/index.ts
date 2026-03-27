/**
 * OurSharedEvents – Cloudflare Worker entry point
 *
 * Deploy staging:    cd workers/oursharedevents && npm run deploy:staging
 * Deploy production: cd workers/oursharedevents && npm run deploy:prod
 * Local dev:         cd workers/oursharedevents && npm run dev
 */

import { route, type RouterEnv } from './router';

export type { RouterEnv as Env };

export default {
  async fetch(request: Request, env: RouterEnv, _ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env);
    } catch (err) {
      console.error(JSON.stringify({
        type: 'UNHANDLED_ERROR',
        error: err instanceof Error ? err.message : String(err),
        url: request.url,
        timestamp: new Date().toISOString(),
      }));

      return Response.json(
        { ok: false, status: 500, error: 'Internal server error' },
        { status: 500 },
      );
    }
  },

  async scheduled(_event: ScheduledEvent, env: RouterEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runFormDataLifecycle(env));
  },
};

/**
 * PII field patterns — keys in survey responses that commonly contain personal data.
 * Values for these keys are replaced with "[SCRUBBED]".
 */
const PII_KEY_PATTERNS = /^(name|email|e-?mail|phone|address|comment|comments|feedback|message|notes|contact)$/i;

/**
 * Scrub PII from survey responses JSON. Preserves rating/numeric data,
 * replaces string values for PII-pattern keys with "[SCRUBBED]".
 */
function scrubSurveyPii(responsesJson: string): string {
  try {
    const data = JSON.parse(responsesJson) as Record<string, unknown>;
    const scrubbed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (PII_KEY_PATTERNS.test(key) && typeof value === 'string') {
        scrubbed[key] = '[SCRUBBED]';
      } else {
        scrubbed[key] = value;
      }
    }
    return JSON.stringify(scrubbed);
  } catch {
    return '{}';
  }
}

/**
 * Scheduled data lifecycle job — runs daily via cron trigger.
 *
 * 1. Delete registrations for ended events (expires_at passed)
 * 2. Scrub PII from surveys for ended events
 * 3. Delete email signups past retention window
 */
async function runFormDataLifecycle(env: RouterEnv): Promise<void> {
  const now = new Date().toISOString();

  try {
    // 1. Delete expired registrations
    await env.FORMS_DB.prepare(
      'DELETE FROM form_registrations WHERE expires_at IS NOT NULL AND expires_at < ?',
    )
      .bind(now)
      .run();

    // 2. Scrub PII from surveys: NULL out responses that could contain PII,
    //    keep only the structure. Then flip the flag so admin can read them.
    //    responses_json is preserved (behavioral data) but we strip any
    //    free-text keys that commonly contain PII (name, email, comment, phone).
    //    The safest approach: replace responses_json with a scrubbed version.
    const unscrubbed = await env.FORMS_DB.prepare(
      'SELECT id, responses_json FROM form_surveys WHERE pii_scrubbed = 0 AND created_at < ?',
    )
      .bind(now)
      .all();

    for (const row of unscrubbed.results) {
      const scrubbed = scrubSurveyPii(row.responses_json as string);
      await env.FORMS_DB.prepare(
        'UPDATE form_surveys SET responses_json = ?, pii_scrubbed = 1 WHERE id = ?',
      )
        .bind(scrubbed, row.id as string)
        .run();
    }

    // 3. Delete email signups past retention window
    await env.FORMS_DB.prepare(
      'DELETE FROM email_signups WHERE retention_expires_at < ?',
    )
      .bind(now)
      .run();

    console.log(JSON.stringify({ type: 'LIFECYCLE_COMPLETE', timestamp: now }));
  } catch (err) {
    console.error(JSON.stringify({
      type: 'LIFECYCLE_ERROR',
      error: err instanceof Error ? err.message : String(err),
      timestamp: now,
    }));
  }
}
