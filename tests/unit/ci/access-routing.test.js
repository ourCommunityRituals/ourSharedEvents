/**
 * Route/access alignment gate unit coverage.
 *
 * Pins the production-specific defect found during the launch rehearsal:
 * `https://oursharedevents.com/admin` was served by the prod Worker, but
 * Cloudflare Access challenged with the staging application path
 * `/cdn-cgi/access/login/stg.oursharedevents.com`.
 */

let classifyAdminAccessResponse;
let expectedLoginPath;

beforeAll(async () => {
  ({ classifyAdminAccessResponse, expectedLoginPath } =
    await import('../../../scripts/assert-access-routing.mjs'));
});

describe('access-routing gate', () => {
  test('constructs the expected Access login path for a hostname', () => {
    expect(expectedLoginPath('oursharedevents.com')).toBe(
      '/cdn-cgi/access/login/oursharedevents.com'
    );
  });

  test('accepts a prod Access challenge for the prod hostname', () => {
    const result = classifyAdminAccessResponse(
      302,
      'https://mzdano.cloudflareaccess.com/cdn-cgi/access/login/oursharedevents.com?kid=abc',
      'oursharedevents.com'
    );
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('access_login_for_expected_host');
  });

  test('rejects prod redirecting to the staging Access application', () => {
    const result = classifyAdminAccessResponse(
      302,
      'https://mzdano.cloudflareaccess.com/cdn-cgi/access/login/stg.oursharedevents.com?kid=abc',
      'oursharedevents.com'
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_access_application_host');
    expect(result.actualHost).toBe('stg.oursharedevents.com');
  });

  test('fails closed if Access does not challenge /admin', () => {
    expect(classifyAdminAccessResponse(401, null, 'oursharedevents.com').reason).toBe(
      'not_redirected_by_cloudflare_access'
    );
    expect(classifyAdminAccessResponse(522, null, 'oursharedevents.com').reason).toBe(
      'not_redirected_by_cloudflare_access'
    );
  });

  test('fails closed on malformed redirect state', () => {
    expect(classifyAdminAccessResponse(302, null, 'oursharedevents.com').reason).toBe(
      'missing_location'
    );
    expect(classifyAdminAccessResponse(302, '%%%not-url', 'oursharedevents.com').reason).toBe(
      'invalid_location'
    );
    expect(
      classifyAdminAccessResponse(302, 'https://example.com/not-access', 'oursharedevents.com')
        .reason
    ).toBe('not_access_login_redirect');
  });
});
