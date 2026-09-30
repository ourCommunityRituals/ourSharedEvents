/**
 * Global setup for playwright.mobile.config.ts (the blocking PR phone audit).
 *
 * /sponsor is token-gated: without a minted link the page is the invalid-link
 * screen, so mobile-workability.spec.ts skipped the real sponsor surface on
 * every run (PR #567 left it that way on purpose — "honest skip" beat
 * "measure the 401"). The local worker can mint one itself, so this seeds a
 * live event + sponsor + placement through the admin API and hands the token
 * to the audit via OSE_SPONSOR_HOME_TOKEN — env set here reaches the test
 * workers, and the spec reads it at import time.
 *
 * Runs after the config's webServer is up. An explicit OSE_SPONSOR_HOME_TOKEN
 * from the environment wins, so a caller can still point the audit at a
 * specific sponsor.
 */
import { request, type FullConfig } from '@playwright/test';
import { seedSponsorHome } from './helpers/sponsor-home-seed';

export default async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env.OSE_SPONSOR_HOME_TOKEN) return;
  const baseURL = config.projects[0]?.use?.baseURL;
  const bearer = process.env.OSE_ADMIN_BEARER;
  if (!baseURL || !bearer) return;

  const ctx = await request.newContext({ baseURL });
  try {
    const seeded = await seedSponsorHome(ctx, bearer, 'Audit');
    process.env.OSE_SPONSOR_HOME_TOKEN = seeded.token;
  } finally {
    await ctx.dispose();
  }
}
