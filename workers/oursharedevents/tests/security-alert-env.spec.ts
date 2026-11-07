import { describe, test, expect } from 'vitest';
import {
  alertTarget,
  buildInvestigationSteps,
  buildLinearDescription,
  type SecurityAlertPayload,
} from '../src/lib/security-alert';

/**
 * OSE-1418 — an alert's runbook names the environment that raised it.
 *
 * Before this, the health-check and 5xx runbooks always said to curl staging
 * and roll back `--env staging`, so a production alert would have sent the
 * on-call to the wrong Worker.
 */

const health: SecurityAlertPayload = {
  type: 'health_check_failure',
  severity: 'HIGH',
  message: 'Health check failed',
  details: {},
};
const fiveXx: SecurityAlertPayload = { ...health, type: 'error_rate_5xx', message: '5xx spike' };

describe('OSE-1418 | security alert runbooks are env-aware', () => {
  test('a production health alert points at oursharedevents.com, never stg.', () => {
    const body = buildLinearDescription(health, 'alert-1', 'production');
    expect(body).toContain('curl https://oursharedevents.com/health');
    expect(body).toContain('**Environment:** production');
    expect(body).not.toContain('stg.oursharedevents.com');
  });

  test('a staging health alert points at stg.oursharedevents.com', () => {
    const steps = buildInvestigationSteps(health, 'staging');
    expect(steps).toContain('curl https://stg.oursharedevents.com/health');
  });

  test('a production 5xx alert rolls back production, not staging', () => {
    const steps = buildInvestigationSteps(fiveXx, 'production');
    expect(steps).toContain('wrangler rollback --env production');
    expect(steps).not.toContain('--env staging');
  });

  test('an unknown env names no host rather than guessing staging', () => {
    for (const workerEnv of [undefined, 'development', 'test']) {
      const body = buildLinearDescription(health, null, workerEnv);
      expect(body).not.toContain('stg.oursharedevents.com');
      expect(body).not.toContain('https://oursharedevents.com/health');
      expect(alertTarget(workerEnv).baseUrl).toBeNull();
    }
  });
});
