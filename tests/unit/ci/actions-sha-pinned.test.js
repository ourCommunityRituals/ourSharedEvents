/**
 * [Claude] Every action a workflow uses is pinned to a full commit SHA.
 *
 * A tag such as `actions/checkout@v7` can be moved to other code by whoever controls
 * the action's repository, and the next run executes it with this repo's token and
 * secrets (the tj-actions/changed-files compromise of March 2025 worked this way). A
 * 40-hex commit SHA cannot be moved. Dependabot (`github-actions` in
 * .github/dependabot.yml) still proposes updates for SHA pins, using the `# vN`
 * comment after the SHA to know which release line it is on.
 *
 * Local actions (`./…`) and `docker://` images are out of scope here.
 *
 * Born red: the detector is run on planted lines below, so it cannot pass vacuously.
 */

const { readdirSync, readFileSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..', '..', '..');
const DIR = join(ROOT, '.github', 'workflows');

const USES = /^\s*(?:-\s+)?uses:\s*['"]?([^'"\s#]+)/;

/** Unpinned `uses:` references in one workflow's text, as "file:line ref". */
function unpinned(file, text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    const m = USES.exec(line);
    if (!m) return;
    const ref = m[1];
    if (ref.startsWith('./') || ref.startsWith('docker://')) return;
    const at = ref.lastIndexOf('@');
    const version = at === -1 ? '' : ref.slice(at + 1);
    if (!/^[0-9a-f]{40}$/.test(version)) out.push(`${file}:${i + 1} ${ref}`);
  });
  return out;
}

describe('workflow actions are pinned to commit SHAs', () => {
  test('detector: tags, branches and short SHAs are caught; full SHAs and local actions pass', () => {
    const planted = [
      '      - uses: actions/checkout@v7',
      '        uses: github/codeql-action/init@v4',
      "      - uses: 'actions/cache@main'",
      '      - uses: actions/setup-node@49933ea',
      '      - uses: some/action',
      '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7',
      '      - uses: ./.github/actions/local',
      '      - uses: docker://alpine:3.20',
    ].join('\n');
    expect(unpinned('x.yml', planted)).toEqual([
      'x.yml:1 actions/checkout@v7',
      'x.yml:2 github/codeql-action/init@v4',
      'x.yml:3 actions/cache@main',
      'x.yml:4 actions/setup-node@49933ea',
      'x.yml:5 some/action',
    ]);
  });

  test('every workflow in .github/workflows', () => {
    const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    const bad = files.flatMap((f) => unpinned(f, readFileSync(join(DIR, f), 'utf8')));
    expect(bad).toEqual([]);
  });
});
