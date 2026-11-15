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

  // The Share test reads two event pages for the link each card must match. They
  // went without the header, so a retry of that test met the challenge (403 for
  // /events/map-zoom-c, main run 43668128696). Born red (2026-11-15): with
  // `await passStgEdge(own)` removed, and with `throwIfEdgeAnswered(res, path)`
  // removed, this test fails.
  test("the Share test's reads of the event pages send the header, and name the edge", () => {
    const start = SPEC.indexOf('async function ownPageShare(');
    const body = SPEC.slice(start, SPEC.indexOf('test(', start));
    const page = body.indexOf('const own = await page.context().newPage();');
    const pass = body.indexOf('await passStgEdge(own);');
    const read = body.indexOf('await own.goto(');
    const stop = body.indexOf('throwIfEdgeAnswered(res, path);');
    const status = body.indexOf('expect(res?.status(), path).toBe(200);');
    expect(start).toBeGreaterThan(-1);
    expect(page).toBeGreaterThan(-1);
    expect(pass).toBeGreaterThan(page);
    expect(read).toBeGreaterThan(pass);
    expect(stop).toBeGreaterThan(read);
    expect(status).toBeGreaterThan(stop);
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

/**
 * "Share hands the share sheet that card's own link and title" also proves that
 * pressing Share sends nothing. On stg the edge adds its own page scripts, which
 * call /cdn-cgi/challenge-platform/… and /cdn-cgi/rum after the page loads; the
 * test recorded those and was red in four of eight main runs (43668128696,
 * 43669630533, 43674376427, 43676301628). The test now sets those calls apart,
 * and only those: what counts as the edge's is decided in one place
 * (scripts/ci/edge-read.mjs, edgeOwnRequest; tests/unit/ci/edge-read.test.js).
 *
 * Born red (2026-11-15), one fault at a time, each taken out again:
 *   - the recorder keeps nothing (`requests.push` removed)      -> "every other request…" fails
 *   - the recorder drops any /cdn-cgi/ path by its own pattern   -> "the spec holds no pattern…" fails
 *   - the list is filtered before it is checked                  -> "the whole list…" fails
 *   - the check is made soft                                     -> "the whole list…" fails
 */
describe('the Share test sets apart the edge calls and nothing else', () => {
  const start = SPEC.indexOf('test("Share hands the share sheet that card\'s own link and title"');
  const body = SPEC.slice(start, SPEC.indexOf('test(', start + 10));

  test('the test is there, and records what the page asks for', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("page.on('request', (r) => {");
  });

  test('every other request is kept: one branch for the edge, the rest recorded whole', () => {
    expect(body).toContain('if (edgeOwnRequest(r.url(), origin)) {');
    expect(body).toMatch(
      /\} else \{\s*requests\.push\(`\$\{r\.method\(\)\} \$\{r\.url\(\)\}`\);\s*\}/
    );
    expect(body).toContain('const origin = new URL(BASE_URL).origin;');
  });

  test('the spec holds no pattern of its own for what the edge sends', () => {
    // One list, in edge-read.mjs. A path written here would be a second one.
    const code = body.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/cdn-cgi|challenge-platform|\/rum/);
    expect(code.match(/edgeOwnRequest\(/g)).toHaveLength(1);
  });

  test('the whole list is checked, hard, against nothing', () => {
    const checks = body.match(/expect[.\w]*\(\s*requests\b[^;]*;/g) || [];
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatch(/^expect\(requests, '[^']+'\)\.toEqual\(\[\]\);$/);
    expect(body).not.toMatch(
      /requests\s*\.\s*(filter|splice|slice|pop|shift)\(|requests\.length\s*=/
    );
  });
});
