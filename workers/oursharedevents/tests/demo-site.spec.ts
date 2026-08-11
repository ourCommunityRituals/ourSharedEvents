/**
 * demo-site.spec.ts — OSE-605 thin slice render smoke.
 *
 * Proves the /demo front door + three tier sites render valid HTML with the
 * flag-driven depth exhibit. Depth is render-side (SR-25 respected).
 */
import { describe, it, expect } from 'vitest';
import { handleDemoIndex, handleDemoSite } from '../src/handlers/demo';

async function text(res: Response): Promise<string> {
  return await res.text();
}

describe('demo site — front door', () => {
  it('renders the trio and the four-flow loop', async () => {
    const res = handleDemoIndex();
    expect(res.status).toBe(200);
    const html = await text(res);
    expect(html).toContain('Same night, same numbers');
    // three standing sites linked
    expect(html).toContain('/demo/free');
    expect(html).toContain('/demo/mid');
    expect(html).toContain('/demo/premium');
    // reconciled tier layout (OSE-682) present: everyone gets a report; map is paid
    expect(html).toContain('Everyone gets a real SharedReport');
    expect(html).toContain('+ the map');
    expect(html).toContain('The floor holds');
    // four-flow loop present
    expect(html).toContain('The four-flow loop');
    for (const step of ['Sponsor', 'Create', 'Attend', 'Report']) {
      expect(html).toContain(step);
    }
    // tight CSP, no inline scripts
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
  });
});

describe('demo site — three depths, same data', () => {
  it('free depth shows headcount but locks premium sections', async () => {
    const html = await text(handleDemoSite('free'));
    expect(html).toContain('Free · Local');
    expect(html).toContain('Headcount');
    // premium-only sections rendered but dimmed (upgrade hint visible)
    expect(html).toContain('depth-locked');
    expect(html).toContain('Corridor map');
  });

  it('premium depth unlocks corridor map + cross-event trend', async () => {
    const html = await text(handleDemoSite('premium'));
    expect(html).toContain('Premium · Enterprise');
    expect(html).toContain('Corridor map');
    expect(html).toContain('Cross-event trend');
    // premium flags on: white-label + portfolio should read "On"
    expect(html).toContain('White-label branding');
  });

  it('renders the RIPH multi-league dataset (OSE-608): season, campaign roster, honesty feature', async () => {
    const html = await text(handleDemoSite('mid'));
    // three leagues across a season
    expect(html).toContain('The RIPH season — three leagues');
    expect(html).toContain('RIPH Bocce League');
    // sponsors by campaign, grouped by tier — Premium as a class of 2
    expect(html).toContain('by campaign, grouped by tier');
    expect(html).toContain('Premium class · 2 campaigns');
    // the K-anon honesty feature is visible, not hidden
    expect(html).toContain('Honesty feature on display');
  });

  it('flag panel reflects the REAL per-tier flag set (not hardcoded)', async () => {
    const free = await text(handleDemoSite('free'));
    const premium = await text(handleDemoSite('premium'));
    // SharedReport is off at free, on at premium — the config drives the render
    const freeOn = (free.match(/flag-on/g) ?? []).length;
    const premiumOn = (premium.match(/flag-on/g) ?? []).length;
    expect(premiumOn).toBeGreaterThan(freeOn);
  });

  it('unknown tier returns a branded 404', async () => {
    const res = handleDemoSite('platinum');
    expect(res.status).toBe(404);
    expect(await text(res)).toContain('No such demo site');
  });
});
