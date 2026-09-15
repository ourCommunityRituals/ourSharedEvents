/**
 * INVARIANT #3 (poster leg): the poster never relies on color alone, and the
 * UEC-hue capability stays wired.
 *
 * uec-codes.invariant.spec.ts locks the canonical hex values in the registry.
 * OSE-1200 found the poster ignoring them: every printed QR was #000000 on a
 * grey card. This structural spec locks the WIRING so it cannot silently rot.
 *
 * OSE-1319 (P2): the Reg / Walk-in / Survey / Feedback QRs — and their
 * consent-tier UEC coloring — LEFT the poster for the FORMS_DB system (see
 * brain memory `qs-flywheel-vs-forms`). The poster now carries only anonymous
 * /q+/s destination slots, which have no consent tier to color-code. So the
 * "non-color channel on the poster" requirement is now met by the slots' TEXT
 * channel — a visible label + the printed /s shortlink under every QR — and the
 * UEC-hue capability itself is guarded where it still lives: the encoder
 * (lib/qr.ts) and the bundle (poster-bundle.ts), ready for wherever the form QRs
 * are next rendered.
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

  test('the poster carries a non-color (text) channel on every slot — form-UEC left the poster in P2', () => {
    const html = read('templates/poster.html');
    // OSE-1319/P2: the poster's anonymous /q+/s slots are identified by TEXT,
    // never color — a visible label + the printed /s shortlink under each QR.
    for (const needle of [
      'data-testid="poster-qr-slot-label-',
      'data-testid="qr-slot-code-',
      'class="qr-slot-code"',
    ]) {
      expect(html, `poster.html must carry the slot text channel: ${needle}`).toContain(needle);
    }
    // the form-QR consent-tier color framing is gone from the poster — it moved
    // with the forms to the FORMS_DB system.
    expect(html).not.toContain("card.setAttribute('data-uec'");
  });
});
