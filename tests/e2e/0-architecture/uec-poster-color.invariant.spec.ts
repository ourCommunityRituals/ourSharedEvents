/**
 * INVARIANT #3 (poster leg): the poster prints UEC hues, and never color alone.
 *
 * uec-codes.invariant.spec.ts locks the canonical hex values in the registry.
 * OSE-1200 found the poster ignoring them: every printed QR was #000000 on a
 * grey card. This structural spec locks the WIRING, so a refactor that drops
 * `fgColor` from the poster bundle, or removes the word / path / tier text
 * from the card, turns CI red before it reaches a wall.
 *
 * Structural: reads source from disk, no worker (T0 Gate invariants shard).
 * Behaviour (decoded PNG pixels equal scan_hex) is proven in
 * workers/oursharedevents/tests/poster-qr-uec-color.spec.ts.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC = join(REPO_ROOT, 'workers', 'oursharedevents', 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

test.describe('INVARIANT #3 | UEC hues on the poster (OSE-1200)', () => {
  test('the QR encoder accepts a foreground hue on the PNG path', () => {
    const qr = read('lib/qr.ts');
    expect(qr).toMatch(/fgColor\?: string/);
    expect(qr).toMatch(/export function parseHexRgb/);
  });

  test('poster-bundle maps every form type to a registry code and prints it in scan_hex', () => {
    const src = read('handlers/poster-bundle.ts');
    for (const type of ['register', 'checkin', 'survey', "'email-signup'"]) {
      expect(src, `FORM_UEC must map ${type}`).toMatch(
        new RegExp(`${type}:\\s*\\{\\s*code:\\s*'[A-Z-]+'`)
      );
    }
    expect(src).toMatch(/generateQrCode\([^)]*fgColor:\s*code\.scan_hex/);
    expect(src).toMatch(/uec\[type\]\s*=\s*code/);
    expect(src).toMatch(/\buec,\s*\n/); // in the response
  });

  test('the poster card carries the non-color channel: word, path, consent tier, data-uec', () => {
    const html = read('templates/poster.html');
    for (const needle of [
      'data-testid="qr-uec-word-',
      'data-testid="qr-uec-path-',
      'data-testid="qr-uec-tier-',
      "card.setAttribute('data-uec'",
      'borderTopColor = uec.scan_hex',
    ]) {
      expect(html, `poster.html must contain ${needle}`).toContain(needle);
    }
  });
});
