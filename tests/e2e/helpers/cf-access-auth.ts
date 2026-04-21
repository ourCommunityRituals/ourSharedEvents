/**
 * CF Access Authentication Helper
 *
 * Injects a CF Access JWT cookie into the browser context so that
 * page.evaluate(() => fetch(...)) calls pass through CF Access.
 *
 * Uses the CF Access service token (CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET)
 * to obtain a CF_Authorization JWT, then injects it as a cookie.
 *
 * Future: When the OCR authorization service is built, this helper swaps
 * to that provider. Same hook, different token source. All tests that
 * import this helper get the new auth automatically.
 *
 * Usage in test files:
 *
 *   import { setupCfAccessAuth } from '../helpers/cf-access-auth';
 *
 *   test.describe('My Admin Tests', () => {
 *     setupCfAccessAuth();
 *     // ... tests using page.evaluate(() => fetch('/api/v2/admin/...'))
 *   });
 */

import { test } from '@playwright/test';

const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';

let cfJwt: string | null = null;

/**
 * Call inside a test.describe() block to inject CF Access auth into
 * every test's browser context. Must be called at the describe level,
 * not inside a test.
 */
export function setupCfAccessAuth() {
  test.beforeAll(async ({ request }) => {
    if (!CF_ACCESS_CLIENT_ID || !CF_ACCESS_CLIENT_SECRET) {
      console.log('CF Access service token not configured — skipping JWT injection');
      return;
    }

    // Hit a lightweight endpoint with service token headers.
    // CF Access responds with a Set-Cookie: CF_Authorization=<jwt>
    const response = await request.get('/health', {
      headers: {
        'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
        'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
      },
    });

    // Extract CF_Authorization JWT from Set-Cookie headers
    const setCookies = response.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
    for (const cookie of setCookies) {
      const match = cookie.value.match(/CF_Authorization=([^;]+)/);
      if (match) {
        cfJwt = match[1];
        console.log('CF Access JWT obtained via service token');
        return;
      }
    }

    console.log('CF Access did not return CF_Authorization cookie — admin tests may fail');
  });

  test.beforeEach(async ({ context }) => {
    if (!cfJwt) return;

    // Inject the JWT cookie into the browser context so page.evaluate
    // fetch calls automatically pass through CF Access.
    const baseUrl = process.env.BASE_URL || 'https://stg.oursharedevents.com';
    const domain = new URL(baseUrl).hostname;

    await context.addCookies([
      {
        name: 'CF_Authorization',
        value: cfJwt,
        domain,
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      },
    ]);
  });
}
