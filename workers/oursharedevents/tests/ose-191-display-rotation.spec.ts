/**
 * OSE-191: Display Rotation + UEC QR — Static gates
 *
 * Verifies that display.html uses the count-based cadence step function
 * (1→none, ≤5→30s, ≤10→20s, ≤15→15s) and implements tab visibility
 * pause/resume instead of the old fixed rotationMs backend value.
 *
 * These are pure string checks against the source files — no Worker spin-up needed.
 *
 * Pyramid level: L1 Static
 */

import { env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

function sourceFile(suffix: string): string {
  const files: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  const key = Object.keys(files).find((k) => k.replace(/\\/g, '/').endsWith(suffix));
  return key ? files[key] : '';
}

describe('OSE-191 L1: display rotation count-based cadence', () => {
  test('display.html has count-based rotMs variable (not fixed rotationMs)', () => {
    const html = sourceFile('templates/display.html');
    expect(html, 'old fixed setInterval(showNext, ms) pattern still present').not.toMatch(
      /const ms = bundle\.rotation_config/
    );
    expect(html, 'rotMs count-based cadence variable missing').toContain('rotMs');
  });

  test('display.html cadence thresholds: 30000, 20000, 15000 (≤5, ≤10, ≤15 sponsors)', () => {
    const html = sourceFile('templates/display.html');
    expect(html).toContain('30000');
    expect(html).toContain('20000');
    expect(html).toContain('15000');
  });

  test('display.html: 1-sponsor case produces no rotation (rotMs = 0)', () => {
    const html = sourceFile('templates/display.html');
    // The count-based step assigns 0 when total <= 1
    expect(html).toMatch(/total\s*<=\s*1\s*\?\s*0/);
  });

  test('display.html has visibilitychange listener for pause/resume', () => {
    const html = sourceFile('templates/display.html');
    expect(html).toContain('visibilitychange');
    expect(html).toContain('document.hidden');
  });

  test('display.html stopRot/startRot functions clear and restart interval', () => {
    const html = sourceFile('templates/display.html');
    expect(html).toContain('clearInterval');
    expect(html, 'startRot function missing').toContain('startRot');
    expect(html, 'stopRot function missing').toContain('stopRot');
  });

  test('display.html no longer calls setInterval unconditionally at init', () => {
    const html = sourceFile('templates/display.html');
    // Old pattern: bare `setInterval(showNext, ms)` without a guard
    // New pattern: setInterval is inside startRot() which checks rotMs > 0
    expect(html).not.toMatch(/^\s*setInterval\(showNext,/m);
  });
});
