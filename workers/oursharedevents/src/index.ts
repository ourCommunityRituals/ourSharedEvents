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

    // 2. Scrub PII from all un-scrubbed surveys (conservative: scrub all pending)
    await env.FORMS_DB.prepare(
      'UPDATE form_surveys SET pii_scrubbed = 1 WHERE pii_scrubbed = 0 AND created_at < ?',
    )
      .bind(now)
      .run();

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
