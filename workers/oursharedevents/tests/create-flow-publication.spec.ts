/**
 * OSE-1245 — the create flow ASKS about publication.
 *
 * WHY THIS FILE EXISTS AT ALL. A default nobody is asked about is exactly how a
 * home address reaches a public map without anyone deciding it should. The
 * guarantee is that the human path asks, and never guesses: it sends the
 * organizer's answer, or sends nothing (OSE-1560: the API then keeps the event
 * OFF the map). These tests assert that against the template itself, because
 * that is where it can silently stop being true: someone tidies the create body
 * and the question becomes decorative while still appearing on screen.
 */
import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

/**
 * Read through TEST_SOURCE_FILES_JSON rather than node:fs — the workers pool
 * has no filesystem at test time, which is the same reason every other
 * source-shape gate in this directory uses this seam.
 */
function adminTemplate(): string {
  const files = JSON.parse((env as unknown as TestEnv).TEST_SOURCE_FILES_JSON) as Record<
    string,
    string
  >;
  const key = Object.keys(files).find((k) => k.endsWith('templates/admin.html'));
  if (!key) throw new Error('admin.html not found in TEST_SOURCE_FILES_JSON');
  return files[key]!;
}

const ADMIN = adminTemplate();

describe('both create paths ask the question', () => {
  test('the wizard offers an explicit publish and an explicit do-not-publish', () => {
    expect(ADMIN).toContain('data-testid="wizard-publish-yes"');
    expect(ADMIN).toContain('data-testid="wizard-publish-no"');
  });

  test('the advanced form carries the control and its consequence', () => {
    expect(ADMIN).toContain('data-testid="create-published"');
    expect(ADMIN).toContain('data-testid="create-published-hint"');
  });

  test('the copy names the address, not just "publish"', () => {
    // Anchored on the full data-testid: the CSS rules for these classes appear
    // earlier in the file, so a bare substring search reads the stylesheet.
    // "List this publicly" tells an operator nothing about what is exposed.
    // Both surfaces must say that the location becomes visible.
    const wizardYes = ADMIN.slice(ADMIN.indexOf('data-testid="wizard-publish-yes"'));
    expect(wizardYes.slice(0, 400)).toMatch(/address/i);
    const hint = ADMIN.slice(ADMIN.indexOf('data-testid="create-published-hint"'));
    expect(hint.slice(0, 400)).toMatch(/venue|address/i);
  });

  test('the wizard says the choice is not fully reversible', () => {
    // §6.2c: the toggle is symmetric, the act is not. This has to be said once,
    // before the first publish, or the interface is quietly misleading.
    const note = ADMIN.slice(ADMIN.indexOf('data-testid="wizard-publish-note"'));
    expect(note.slice(0, 500)).toMatch(/copied|cannot be undone|already public/i);
  });

  test('both surfaces say the invite links keep working when unpublished', () => {
    // Otherwise "keep it off the map" reads as "cancel my event", and nobody
    // picks it — the option has to be safe to choose.
    const wizardNo = ADMIN.slice(ADMIN.indexOf('data-testid="wizard-publish-no"'));
    expect(wizardNo.slice(0, 400)).toMatch(/links|codes|invite/i);
    const hint = ADMIN.slice(ADMIN.indexOf('data-testid="create-published-hint"'));
    expect(hint.slice(0, 400)).toMatch(/links|codes/i);
  });
});

describe('the answer is sent as the organizer made it, and omitted when they did not', () => {
  // OSE-1560 (PO, 2026-10-03): a new event is OFF the map, and the API keeps
  // that default (and remembers that nobody chose) when the field is omitted.
  // The old rule here, "always send an explicit value", existed because the
  // default was ON; with the default off, an omitted value is the safe one and
  // a guessed value is the risk. The behaviour is run in
  // tests/admin-map-setting.spec.ts; these pin the markup it relies on.
  test('the wizard body sends is_published only once a card was clicked', () => {
    expect(ADMIN).toContain('if (wiz.publishedChosen) body.is_published = wiz.published;');
  });

  test('the advanced form body sends the checkbox only once it was touched', () => {
    expect(ADMIN).toMatch(
      /if \(publishedEl && publishedEl\.dataset\.chosen === '1'\) body\.is_published = publishedEl\.checked;/
    );
  });

  test('the wizard default matches the card marked selected: off', () => {
    // A mismatch here means the highlighted card and the value sent disagree —
    // on this question that publishes an address the organizer believes they
    // declined.
    expect(ADMIN).toMatch(/published:\s*false,/);
    const noCard = ADMIN.slice(
      ADMIN.indexOf('data-option="unpublished"') - 200,
      ADMIN.indexOf('data-option="unpublished"')
    );
    expect(noCard).toContain('selected');
    const yesCard = ADMIN.slice(
      ADMIN.indexOf('data-option="published"') - 200,
      ADMIN.indexOf('data-option="published"')
    );
    expect(yesCard).not.toContain('selected');
  });
});

describe('the publish cards are not sign-up cards', () => {
  test('they carry their own class', () => {
    // First written reusing `.wizard-signup-option` to inherit styling, which
    // silently made them a third sign-up option: the sign-up handler would have
    // set `wiz.signup` from them, and each grid's `.selected` sweep would have
    // cleared the other's.
    expect(ADMIN).toContain('class="wizard-publish-option selected"');
    expect(ADMIN).toContain('class="wizard-publish-option"');
  });

  test('they have their own handler that sets published, not signup', () => {
    const handler = ADMIN.slice(ADMIN.indexOf("querySelectorAll('.wizard-publish-option')"));
    expect(handler.slice(0, 400)).toContain('wiz.published');
    expect(handler.slice(0, 400)).not.toContain('wiz.signup');
  });

  test('the sign-up handler cannot reach the publish cards', () => {
    const handler = ADMIN.slice(ADMIN.indexOf("querySelectorAll('.wizard-signup-option')"));
    expect(handler.slice(0, 400)).not.toContain('wizard-publish-option');
  });
});
