/**
 * OSE-1245 — the create flow ASKS about publication.
 *
 * WHY THIS FILE EXISTS AT ALL. `events.is_published` defaults to 1, at the
 * column and in the API, for backward compatibility. So the default is NOT
 * where the guarantee lives — a default nobody is asked about is exactly how a
 * home address reaches a public map without anyone deciding it should.
 *
 * The guarantee is that the human path always asks and always sends an explicit
 * answer. These tests assert that property against the template itself, because
 * that is where it can silently stop being true: someone tidies the create body,
 * drops a line that "looks like it defaults anyway", and the question becomes
 * decorative while still appearing on screen.
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

describe('the answer is always sent, never omitted', () => {
  test('the wizard body sets is_published unconditionally', () => {
    expect(ADMIN).toContain('body.is_published = wiz.published;');
    // Not inside an `if` — an omitted value publishes by default, so a
    // conditional send is the same bug as not asking.
    const line = ADMIN.slice(
      ADMIN.indexOf('body.is_published = wiz.published;') - 200,
      ADMIN.indexOf('body.is_published = wiz.published;')
    );
    expect(line).not.toMatch(/if\s*\([^)]*\)\s*$/);
  });

  test('the advanced form body reads the checkbox and sends it unconditionally', () => {
    expect(ADMIN).toMatch(
      /body\.is_published\s*=\s*publishedEl\s*\?\s*publishedEl\.checked\s*:\s*true;/
    );
  });

  test('the wizard default matches the card marked selected', () => {
    // A mismatch here means the highlighted card and the value sent disagree —
    // on this question that publishes an address the organizer believes they
    // declined.
    expect(ADMIN).toMatch(/published:\s*true,/);
    const yesCard = ADMIN.slice(
      ADMIN.indexOf('data-option="published"') - 200,
      ADMIN.indexOf('data-option="published"')
    );
    expect(yesCard).toContain('selected');
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
