/**
 * Production route/access alignment gate.
 *
 * This catches the exact "prod host uses staging Access app" failure mode:
 * the Worker can be correctly deployed at `https://oursharedevents.com`, yet
 * Cloudflare Access can still challenge `/admin` with the staging application
 * (`/cdn-cgi/access/login/stg.oursharedevents.com`). That is not a Worker code
 * bug; it is dashboard/config drift at the edge. Make it a hard deploy red.
 *
 * Usage:
 *   BASE_URL=https://oursharedevents.com node scripts/assert-access-routing.mjs
 *
 * Optional:
 *   ADMIN_PATH=/admin
 *   EXPECTED_ACCESS_HOST=oursharedevents.com
 *   METHODS=HEAD,GET
 */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function expectedLoginPath(hostname) {
  return `/cdn-cgi/access/login/${hostname}`;
}

export function classifyAdminAccessResponse(status, location, expectedHostname) {
  if (!REDIRECT_STATUSES.has(Number(status))) {
    return {
      ok: false,
      reason: 'not_redirected_by_cloudflare_access',
      message: `expected a Cloudflare Access redirect, got HTTP ${status}`,
    };
  }

  if (!location) {
    return {
      ok: false,
      reason: 'missing_location',
      message: `HTTP ${status} did not include a Location header`,
    };
  }

  let parsed;
  try {
    parsed = new URL(location);
  } catch {
    return {
      ok: false,
      reason: 'invalid_location',
      message: `redirect Location is not a valid URL: ${location}`,
    };
  }

  const expectedPath = expectedLoginPath(expectedHostname);
  if (parsed.pathname === expectedPath) {
    return { ok: true, reason: 'access_login_for_expected_host', message: 'ok' };
  }

  const match = parsed.pathname.match(/^\/cdn-cgi\/access\/login\/([^/]+)$/);
  if (match) {
    return {
      ok: false,
      reason: 'wrong_access_application_host',
      actualHost: match[1],
      expectedHost: expectedHostname,
      message: `Cloudflare Access challenged with ${match[1]}, expected ${expectedHostname}`,
    };
  }

  return {
    ok: false,
    reason: 'not_access_login_redirect',
    message: `redirect Location is not a Cloudflare Access login URL: ${location}`,
  };
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function runSelfTest() {
  const cases = [
    [
      'prod host redirects to prod Access app',
      302,
      'https://mzdano.cloudflareaccess.com/cdn-cgi/access/login/oursharedevents.com?kid=abc',
      'oursharedevents.com',
      true,
      'access_login_for_expected_host',
    ],
    [
      'prod host redirects to staging Access app (the live defect)',
      302,
      'https://mzdano.cloudflareaccess.com/cdn-cgi/access/login/stg.oursharedevents.com?kid=abc',
      'oursharedevents.com',
      false,
      'wrong_access_application_host',
    ],
    ['worker 401 means Access did not protect the admin route', 401, null, 'oursharedevents.com', false, 'not_redirected_by_cloudflare_access'],
    ['origin timeout means Worker route did not intercept', 522, null, 'oursharedevents.com', false, 'not_redirected_by_cloudflare_access'],
    ['missing Location on redirect is invalid', 302, null, 'oursharedevents.com', false, 'missing_location'],
    ['non-URL Location is invalid', 302, '%%%not-url', 'oursharedevents.com', false, 'invalid_location'],
  ];

  let failed = 0;
  for (const [name, status, location, expectedHost, expectedOk, expectedReason] of cases) {
    const got = classifyAdminAccessResponse(status, location, expectedHost);
    const pass = got.ok === expectedOk && got.reason === expectedReason;
    if (!pass) failed++;
    console.log(
      `${pass ? 'PASS' : 'FAIL'} — ${name} (expected ${expectedOk}/${expectedReason}, got ${got.ok}/${got.reason})`
    );
  }
  if (failed > 0) fail(`\nself-test: ${failed} case(s) failed — Access route classifier is wrong.`);
  console.log(`\nself-test: all ${cases.length} cases passed.`);
}

async function main() {
  const baseUrlRaw = process.env.BASE_URL;
  if (!baseUrlRaw) fail('access-routing: BASE_URL is required.');

  let baseUrl;
  try {
    baseUrl = new URL(baseUrlRaw);
  } catch {
    fail(`access-routing: BASE_URL is not a valid URL: ${baseUrlRaw}`);
  }

  const adminPath = process.env.ADMIN_PATH || '/admin';
  const expectedHost = process.env.EXPECTED_ACCESS_HOST || baseUrl.hostname;
  const methods = (process.env.METHODS || 'HEAD,GET')
    .split(',')
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean);
  const target = new URL(adminPath, baseUrl);

  const failures = [];
  for (const method of methods) {
    let res;
    try {
      res = await fetch(target, {
        method,
        redirect: 'manual',
        headers: {
          Accept: 'text/html',
          'User-Agent': 'OSE route/access alignment gate',
        },
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      failures.push(`method ${method}: could not reach ${target.href} — ${e.message}`);
      continue;
    }

    const location = res.headers.get('location');
    const result = classifyAdminAccessResponse(res.status, location, expectedHost);
    if (!result.ok) {
      failures.push(
        `method ${method}:\n` +
          `  status        : ${res.status}\n` +
          `  location      : ${location ?? '(none)'}\n` +
          `  expected host : ${expectedHost}\n` +
          `  reason        : ${result.reason}\n` +
          `  detail        : ${result.message}`
      );
    }
  }

  if (failures.length === 0) {
    console.log(
      `✅ access-routing: ${target.href} challenges ${methods.join('/')} with the ${expectedHost} Cloudflare Access app.`
    );
    process.exit(0);
  }

  fail(
    `❌ access-routing FAILED for ${target.href}\n` +
      failures.join('\n\n') +
      '\n' +
      `Fix Cloudflare Access so the production hostname is protected by the production Access application, then redeploy/re-run.`
  );
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('assert-access-routing.mjs');

if (isMain) {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
  } else {
    main().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
