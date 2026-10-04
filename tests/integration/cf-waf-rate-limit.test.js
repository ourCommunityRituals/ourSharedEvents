// vitest globals: true (vitest.config.ts). The script is ESM, so it is loaded with import().
let buildRule, expressionFor, redactRule, removeRule, mergeRules, LIMIT_REQUESTS, PERIOD_SECONDS;
beforeAll(async () => {
  ({
    buildRule,
    expressionFor,
    redactRule,
    removeRule,
    mergeRules,
    LIMIT_REQUESTS,
    PERIOD_SECONDS,
  } = await import('../../scripts/ci/cf-waf-rate-limit.mjs'));
});

test('the rule enforces the PO bar: 60 per 10 s, blocked with a 429', () => {
  const r = buildRule();
  expect(r.ratelimit.requests_per_period).toBe(LIMIT_REQUESTS);
  expect(r.ratelimit.period).toBe(PERIOD_SECONDS);
  expect(r.action).toBe('block');
  expect(r.action_parameters.response.status_code).toBe(429);
  // 60 per 10 s leaves a 5-a-second user (50 per window) unblocked.
  expect(LIMIT_REQUESTS).toBeGreaterThan(5 * PERIOD_SECONDS);
});

test('merge keeps other rules and replaces only our own', () => {
  const other = { ref: 'someone-else', expression: 'true', action: 'block' };
  const stale = { ...buildRule(), ratelimit: { requests_per_period: 9999 } };
  const merged = mergeRules([other, stale]);
  expect(merged).toHaveLength(2);
  expect(merged[0]).toEqual(other);
  expect(merged[1].ratelimit.requests_per_period).toBe(LIMIT_REQUESTS);
  expect(mergeRules(undefined)).toHaveLength(1);
});

test('the CI exemption is a secret header match, and the token never prints', () => {
  const token = 'ci-edge-token-0123456789abcdef';
  const rule = buildRule(token);
  expect(rule.expression).toContain('not any(http.request.headers["x-ocr-ci"][*]');
  expect(rule.expression).toContain(token);
  expect(JSON.stringify(redactRule(rule, token))).not.toContain(token);
  expect(buildRule().expression).not.toContain('x-ocr-ci');
});

test('a token that could break out of the expression is refused', () => {
  expect(() => expressionFor('x" or true or "')).toThrow();
});

test('rollback removes only our rule', () => {
  const other = { ref: 'someone-else', expression: 'true', action: 'block' };
  expect(removeRule([other, buildRule()])).toEqual([other]);
  expect(removeRule(undefined)).toEqual([]);
});
