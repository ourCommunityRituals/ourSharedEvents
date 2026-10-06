/**
 * No Playwright run records a trace (OSE-1470).
 *
 * A trace stores every request's headers and cookies: CF-Access-Client-Secret,
 * Authorization: Bearer <ADMIN_KEY>, X-OCR-Internal and the minted
 * CF_Authorization cookie. CI uploads test output as artifacts, so a trace is a
 * downloadable copy of those credentials. Auth reaches a request from config
 * headers, from a spec, or from a cookie, so the rule is not "configs with auth
 * headers": it is every config, every spec and every command line. Derives its
 * subjects from the tree, so a new config or workflow is covered without
 * editing this.
 */

const { readFileSync, readdirSync, statSync } = require('fs');
const { join, sep } = require('path');

const ROOT = join(__dirname, '..', '..');
const CONFIGS = readdirSync(ROOT).filter((f) =>
  /^playwright(\..+)?\.config\.(ts|js|mjs|cjs)$/.test(f)
);

// Comments describe traces; only code may set one.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const traceValues = (src) =>
  [...stripComments(src).matchAll(/\btrace\s*:\s*([^,\n}]+)/g)].map((m) => m[1].trim());

const walk = (dir, keep, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep.test(name)) out.push(p);
  }
  return out;
};
const rel = (p) =>
  p
    .slice(ROOT.length + 1)
    .split(sep)
    .join('/');

const SPECS = walk(join(ROOT, 'tests'), /\.(spec|test|setup)\.(ts|js|mjs)$/).filter(
  (p) => p !== __filename
);
const WORKFLOWS = walk(join(ROOT, '.github', 'workflows'), /\.ya?ml$/);

// `--trace off` and `--trace=off` are the only allowed forms.
const TRACE_FLAG_ON = /--trace(?![=\s]+off\b)/;

describe('Playwright records no trace', () => {
  it('finds its subjects (not vacuous)', () => {
    expect(CONFIGS.length).toBeGreaterThanOrEqual(5);
    expect(SPECS.length).toBeGreaterThan(50);
    expect(WORKFLOWS.length).toBeGreaterThan(5);
  });

  it.each(CONFIGS)("%s sets trace: 'off' and nothing else", (file) => {
    const values = traceValues(readFileSync(join(ROOT, file), 'utf-8'));
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter((v) => v !== "'off'")).toEqual([]);
  });

  it('no spec turns tracing on', () => {
    const offenders = SPECS.filter((p) =>
      traceValues(readFileSync(p, 'utf-8')).some((v) => /^['"`{]/.test(v) && v !== "'off'")
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it('no workflow or npm script passes --trace', () => {
    const scripts = Object.entries(
      JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).scripts
    )
      .filter(([, cmd]) => TRACE_FLAG_ON.test(cmd))
      .map(([name]) => `package.json:${name}`);
    const workflows = WORKFLOWS.filter((p) =>
      readFileSync(p, 'utf-8')
        .split('\n')
        .some((line) => !/^\s*#/.test(line) && TRACE_FLAG_ON.test(line))
    ).map(rel);
    expect([...scripts, ...workflows]).toEqual([]);
  });
});
