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
 * The public sponsor card (/sponsors/:id, #699) is the same shape of gap: it
 * renders only a sponsor on show, so without OSE_SPONSOR_CARD_ID the audit
 * skipped it. A second sponsor is seeded and accepts its placement through
 * the sponsor respond endpoint, and its id goes to OSE_SPONSOR_CARD_ID.
 *
 * Runs after the config's webServer is up. An explicit OSE_SPONSOR_HOME_TOKEN
 * or OSE_SPONSOR_CARD_ID from the environment wins, so a caller can still
 * point the audit at a specific sponsor.
 */
import { request, type FullConfig } from '@playwright/test';
import { seedSponsorCard, seedSponsorHome } from './helpers/sponsor-home-seed';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL;
  const bearer = process.env.OSE_ADMIN_BEARER;
  if (!baseURL || !bearer) return;

  const ctx = await request.newContext({ baseURL });
  try {
    if (!process.env.OSE_SPONSOR_HOME_TOKEN) {
      const seeded = await seedSponsorHome(ctx, bearer, 'Audit');
      process.env.OSE_SPONSOR_HOME_TOKEN = seeded.token;
    }
    if (!process.env.OSE_SPONSOR_CARD_ID) {
      const card = await seedSponsorCard(ctx, bearer, 'Audit card');
      process.env.OSE_SPONSOR_CARD_ID = card.sponsorId;
    }
  } finally {
    await ctx.dispose();
  }
}
