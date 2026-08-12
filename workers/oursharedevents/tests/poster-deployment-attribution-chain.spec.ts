/**
 * OSE-627 / INT-03 — wire poster_deployment_id through QR URL → form page →
 * scan write, so poster_attribution stops reporting scan_count=0 for every
 * deployment.
 *
 * Three links, three assertions:
 *   1. poster-bundle.ts formUrl embeds `?deployment=<id>` (source gate).
 *   2. form-pages.ts reads `?deployment=` and injects it as a hidden field AND
 *      posts it as `sourcePlacementId` (functional — drive handleFormPage).
 *   3. forms.ts persists `sourcePlacementId` into
 *      form_registrations.source_placement_id (source gate on the INSERT).
 *
 * The form-layer link is exercised for real; the bundle-emit and DB-write links
 * are asserted structurally (their runtime paths need poster + D1 fixtures that
 * their own suites already cover — here we lock the wiring shape).
 */

import { env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import { handleFormPage } from '../src/handlers/form-pages';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

function sourceOf(suffix: string): string {
  const files = JSON.parse((env as unknown as TestEnv).TEST_SOURCE_FILES_JSON) as Record<
    string,
    string
  >;
  const key = Object.keys(files).find((k) => k.replace(/\\/g, '/').endsWith(suffix));
  if (!key) throw new Error(`${suffix} not found in TEST_SOURCE_FILES_JSON`);
  return files[key];
}

const DEPLOY_ID = 'depl_abc123';

describe('OSE-627 | form-layer reads ?deployment= and threads sourcePlacementId', () => {
  async function render(type: string): Promise<string> {
    const req = new Request(`https://t.test/forms/evt_attr?type=${type}&deployment=${DEPLOY_ID}`);
    return (await handleFormPage(req, {}, 'evt_attr')).text();
  }

  test('register form injects the deployment id as a hidden field', async () => {
    const html = await render('register');
    expect(html).toContain('data-testid="form-deployment-id"');
    expect(html).toContain(DEPLOY_ID);
  });

  test('register submit body carries sourcePlacementId = deployment id', async () => {
    const html = await render('register');
    // handleRegister posts { ..., sourcePlacementId: "depl_abc123" }
    expect(html).toContain(`sourcePlacementId: ${JSON.stringify(DEPLOY_ID)}`);
  });

  test('email-signup form also threads the deployment id', async () => {
    const html = await render('email-signup');
    expect(html).toContain('data-testid="form-deployment-id"');
    expect(html).toContain(`sourcePlacementId: ${JSON.stringify(DEPLOY_ID)}`);
  });

  test('with no deployment param, sourcePlacementId is null (no attribution leaked)', async () => {
    const req = new Request('https://t.test/forms/evt_attr?type=register');
    const html = await (await handleFormPage(req, {}, 'evt_attr')).text();
    expect(html).toContain('sourcePlacementId: null');
    expect(html).not.toContain('data-testid="form-deployment-id"');
  });
});

describe('OSE-627 | bundle + DB-write wiring (source gates)', () => {
  test('poster-bundle formUrl embeds ?deployment=<id>', () => {
    const s = sourceOf('handlers/poster-bundle.ts');
    expect(s).toContain('deployment=${encodeURIComponent(deploymentId)}');
  });

  test('forms.ts reads sourcePlacementId from the request body', () => {
    const s = sourceOf('handlers/forms.ts');
    expect(s).toContain('body!.sourcePlacementId');
  });

  test('forms.ts persists source_placement_id into form_registrations', () => {
    const s = sourceOf('handlers/forms.ts');
    expect(s).toContain('source_placement_id');
    // The INSERT column list must include source_placement_id.
    expect(s).toMatch(/INSERT INTO form_registrations[^)]*source_placement_id/s);
  });
});
