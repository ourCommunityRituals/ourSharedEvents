/**
 * DEV_OPEN_ADMIN bypass — security guard (OSE-681).
 *
 * The local-dev admin bypass lets the dashboard load in a browser on
 * `wrangler dev` (no Cloudflare Access locally). It MUST be impossible for it to
 * open a deployed environment. This suite is the standing proof of that:
 *   - opens only when DEV_OPEN_ADMIN==='true' AND WORKER_ENV is non-prod/staging
 *   - refused on production and staging even with the flag set
 *   - inert when the flag is absent
 */
import { describe, test, expect } from 'vitest';
import { requireAdmin, type AdminEnv } from '../src/auth/admin';

const req = () => new Request('https://example.com/admin', { headers: { Accept: 'text/html' } });
const base: AdminEnv = { ALLOWED_ADMIN_EMAILS: '', ALLOWED_ADMIN_DOMAINS: '' } as AdminEnv;

describe('DEV_OPEN_ADMIN bypass — local only', () => {
  test('opens admin in local dev (flag on, WORKER_ENV undefined)', async () => {
    const deny = await requireAdmin(req(), { ...base, DEV_OPEN_ADMIN: 'true' }, 'rid');
    expect(deny).toBeNull(); // null = allowed
  });

  test('opens admin when WORKER_ENV=development', async () => {
    const deny = await requireAdmin(
      req(),
      { ...base, DEV_OPEN_ADMIN: 'true', WORKER_ENV: 'development' },
      'rid'
    );
    expect(deny).toBeNull();
  });

  test('REFUSED on production even with flag on', async () => {
    const deny = await requireAdmin(
      req(),
      { ...base, DEV_OPEN_ADMIN: 'true', WORKER_ENV: 'production' },
      'rid'
    );
    expect(deny).not.toBeNull();
    expect(deny!.status).toBe(401);
  });

  test('REFUSED on staging even with flag on', async () => {
    const deny = await requireAdmin(
      req(),
      { ...base, DEV_OPEN_ADMIN: 'true', WORKER_ENV: 'staging' },
      'rid'
    );
    expect(deny).not.toBeNull();
    expect(deny!.status).toBe(401);
  });

  test('inert when flag absent (normal auth applies → denied)', async () => {
    const deny = await requireAdmin(req(), { ...base }, 'rid');
    expect(deny).not.toBeNull();
    expect(deny!.status).toBe(401);
  });

  test('inert when flag is any value other than the literal "true"', async () => {
    const deny = await requireAdmin(req(), { ...base, DEV_OPEN_ADMIN: '1' }, 'rid');
    expect(deny).not.toBeNull();
  });
});
