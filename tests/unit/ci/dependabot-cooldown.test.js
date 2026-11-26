/**
 * [Claude] Every Dependabot update waits at least 7 days after a release (CCR F5).
 *
 * A compromised or broken package release is usually caught and pulled within
 * days. Without a cooldown, Dependabot proposes it within hours and a busy
 * reviewer can merge it before anyone upstream notices. Security updates are
 * not delayed: GitHub applies cooldown to version updates only.
 *
 * Born red: the detector is run on planted configs below.
 */
const { readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const MIN_DAYS = 7;

/** Update entries without a cooldown of at least MIN_DAYS, as "ecosystem directory". */
function missingCooldown(doc) {
  return (doc?.updates ?? [])
    .filter((u) => !(Number(u?.cooldown?.['default-days']) >= MIN_DAYS))
    .map((u) => `${u['package-ecosystem']} ${u.directory}`);
}

describe('Dependabot cooldown', () => {
  test('detector: no cooldown and a short one are caught; 7 days passes', () => {
    const planted = {
      updates: [
        { 'package-ecosystem': 'npm', directory: '/' },
        { 'package-ecosystem': 'npm', directory: '/w', cooldown: { 'default-days': 2 } },
        { 'package-ecosystem': 'github-actions', directory: '/', cooldown: { 'default-days': 7 } },
      ],
    };
    expect(missingCooldown(planted)).toEqual(['npm /', 'npm /w']);
  });

  test('every update in .github/dependabot.yml', () => {
    const doc = yaml.load(readFileSync(join(ROOT, '.github', 'dependabot.yml'), 'utf8'));
    expect(doc.updates.length).toBeGreaterThan(0);
    expect(missingCooldown(doc)).toEqual([]);
  });
});
