/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own workflow and specs */
/**
 * The map link walk on staging must pass the edge, and must say so when it does not.
 *
 * From a GitHub runner the Cloudflare edge answers a read of stg `/events/<id>…`
 * with a managed challenge unless the read carries X-OCR-CI (the stg skip rule,
 * docs/runbooks/RUNBOOK-STG-CI-SKIP-RULE.md). "T4k: Map Zoom, Place Panel and Map
 * Links" follows every map link to its event page, so it was red on main from its
 * first run (43637530383) until its step got the token and its walk sent the header.
 *
 * Born red (2026-11-14), one fault at a time, each taken out again:
 *   - OCR_CI_EDGE_TOKEN removed from the T4k step        -> "the T4k step…" fails
 *   - `await passStgEdge(visitor)` removed from the spec -> "the walk sends…" fails
 *   - `throwIfEdgeAnswered(res, href)` removed           -> "an answer from the edge…" fails
 *   - the origin test in passStgEdge replaced by `() => true` -> "the header goes to the site only" fails
 * The helper itself was run in Chromium against a stand-in edge (403 with
 * cf-mitigated on /events/ unless the header matches): no header, no token and
 * another token each threw by name; the right token reached the page, and a
 * second origin the page loaded an image from never received the header.
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const wf = yaml.load(read('.github', 'workflows', 'oursharedevents-ci.yml'));
const SPEC = read('tests', 'e2e', '3-flows', 'map-place-panel.spec.ts');
const HELPER = read('tests', 'e2e', 'helpers', 'map-zoom-area.ts');
const STEP = 'T4k: Map Zoom, Place Panel and Map Links';

const t4kSteps = Object.values(wf.jobs)
  .flatMap((job) => job.steps || [])
  .filter((s) => s.name === STEP);

describe('the map link walk passes the stg edge', () => {
  test('the T4k step gets the edge token, from the secret', () => {
    expect(t4kSteps).toHaveLength(1);
    expect(t4kSteps[0].run).toContain('tests/e2e/3-flows/map-place-panel.spec.ts');
    expect(t4kSteps[0].env.OCR_CI_EDGE_TOKEN).toBe('${{ secrets.OCR_CI_EDGE_TOKEN }}');
  });

  test('the walk sends the header before it follows a link', () => {
    const page = SPEC.indexOf('const visitor = await context.newPage();');
    const pass = SPEC.indexOf('await passStgEdge(visitor);');
    const follow = SPEC.indexOf('await visitor.goto(');
    expect(page).toBeGreaterThan(-1);
    expect(pass).toBeGreaterThan(page);
    expect(follow).toBeGreaterThan(pass);
  });

  test('an answer from the edge stops the test before the status is read', () => {
    const follow = SPEC.indexOf('await visitor.goto(');
    const stop = SPEC.indexOf('throwIfEdgeAnswered(res, href);');
    const status = SPEC.indexOf('expect.soft(res?.status(), `following ${href}`)');
    expect(stop).toBeGreaterThan(follow);
    expect(status).toBeGreaterThan(stop);
    // A challenge is a failure here: never a skip, a return or a noted pass.
    const body = HELPER.slice(HELPER.indexOf('export function throwIfEdgeAnswered'));
    expect(body).toContain('throw new Error(');
    expect(body).not.toMatch(/test\.skip|noteEdgeChallenge/);
  });

  test('the header goes to the site only', () => {
    const body = HELPER.slice(
      HELPER.indexOf('export async function passStgEdge'),
      HELPER.indexOf('export function throwIfEdgeAnswered')
    );
    expect(body).toContain('(url) => url.origin === origin');
    expect(body).not.toMatch(/setExtraHTTPHeaders|extraHTTPHeaders/);
  });
});
