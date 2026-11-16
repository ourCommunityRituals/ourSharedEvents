/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own workflow and specs */
/**
 * The launch story smoke's event pages must pass the stg edge, and an answer from
 * the edge must never count as the page (OSE-2022).
 *
 * "T4g: Launch Story Smoke" opened /events/<id>/<slug> with a plain page.goto. A
 * page navigation sends no X-OCR-CI, so from a GitHub runner the edge could answer
 * it (403, cf-mitigated). The test took [200, 403] and then checked nothing, so
 * the step was green with the page unread (main run 43643594754, job 132605565745).
 *
 * Born red (2026-11-16), one fault at a time, each taken out again:
 *   - OCR_CI_EDGE_TOKEN removed from the T4g step              -> "the T4g step…" fails
 *   - CALENDAR_EDGE_STRICT removed from the T4g step           -> "the T4g step…" fails
 *   - `await passStgEdge(page);` removed from either test      -> "…sends the header before its first read" fails
 *   - the old `[200, 403]` check put back                      -> "no event page read takes a 403…" fails
 *   - `noteIfEdgeAnswered` moved below the 200 check           -> "the edge's answer is noted…" fails
 *   - `return;` after the note removed                         -> "the edge's answer is noted…" fails
 *   - noteIfEdgeAnswered made to return null after its note    -> "a noted challenge…" fails
 *   - edgeHeaderSent made to read the environment's token      -> "what was sent is read from the request" fails
 *
 * Two more reads of the same spec, born red 2026-11-16, one fault at a time:
 *   - `throwIfEdgeAnswered(draftPublic, …)` removed, or moved below the 404 check -> "the draft's first read…" fails
 *   - `headers: edgeHeaders()` removed from the scan read                         -> "the scan read sends…" fails
 *   - `[302, 403]` put back                                                       -> "the scan read…: no 403…" fails
 *   - the `return;` after the scan note removed                                   -> "the scan read…: noted…" fails
 *   - the redirect checks put back inside `if (res.status() === 302)`             -> "the scan read…: no 403…" fails
 *   - the poster token written into the note                                      -> "the scan read…: noted…" fails
 * The helper was also run in Chromium against a stand-in edge (403 with
 * cf-mitigated on /events/ unless the header matches): the right token reached
 * the page and the request showed the header; no route, and another token, were
 * each noted with what was really sent, and threw with CALENDAR_EDGE_STRICT=1; a
 * 403 with no cf-mitigated was not taken for the edge.
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const wf = yaml.load(read('.github', 'workflows', 'oursharedevents-ci.yml'));
const SPEC = read('tests', 'e2e', '3-flows', 'launch-story-smoke.spec.ts');
const HELPER = read('tests', 'e2e', 'helpers', 'stg-edge.ts');
const STEP = 'T4g: Launch Story Smoke';

const steps = Object.values(wf.jobs)
  .flatMap((job) => job.steps || [])
  .filter((s) => s.name === STEP);

/** The source of one test of the spec, from its title to the next test. */
function testBody(title) {
  const start = SPEC.indexOf(`  test('${title}'`);
  expect(start, title).toBeGreaterThan(-1);
  const next = SPEC.indexOf('\n  test(', start + 10);
  return SPEC.slice(start, next === -1 ? undefined : next);
}

// The two tests that open an event page in the browser, and the read each makes.
const PAGE_TESTS = [
  {
    title: 'public list card opens the event page with Share and Add to calendar actions',
    read: 'const eventPage = await page.goto(',
    note: 'const challenged = await noteIfEdgeAnswered(eventPage, readablePath);',
    status: 'expect(eventPage?.status(), `the Worker answers ${readablePath}`).toBe(200);',
    first: '[data-testid="event-actions"]',
  },
  {
    title: 'admin draft preview uses the public renderer and can go live to the public page',
    read: 'const live = await page.goto(',
    note: 'const challenged = await noteIfEdgeAnswered(live, livePath);',
    status: 'expect(live?.status(), `the Worker answers ${livePath} after go-live`).toBe(200);',
    first: '[data-testid="event-title"]',
  },
];

describe('the launch story smoke passes the stg edge', () => {
  test('the T4g step gets the edge token from the secret, and the strict switch', () => {
    expect(steps).toHaveLength(1);
    expect(steps[0].run).toContain('tests/e2e/3-flows/launch-story-smoke.spec.ts');
    expect(steps[0].env.OCR_CI_EDGE_TOKEN).toBe('${{ secrets.OCR_CI_EDGE_TOKEN }}');
    expect(steps[0].env.CALENDAR_EDGE_STRICT).toBe('${{ vars.CALENDAR_EDGE_STRICT }}');
  });

  test.each(PAGE_TESTS)('"$title" sends the header before its first read', ({ title }) => {
    const body = testBody(title);
    const pass = body.indexOf('await passStgEdge(page);');
    const firstRead = body.indexOf('page.goto(');
    expect(pass).toBeGreaterThan(-1);
    expect(firstRead).toBeGreaterThan(pass);
  });

  test.each(PAGE_TESTS)(
    '"$title": the edge\'s answer is noted and the test stops; the Worker\'s must be 200',
    ({ title, read: readLine, note, status, first }) => {
      const body = testBody(title);
      const at = (text) => body.indexOf(text, body.indexOf(readLine));
      expect(body.indexOf(readLine)).toBeGreaterThan(-1);
      expect(at(note)).toBeGreaterThan(body.indexOf(readLine));
      // Noted, shown on the test, and nothing after it runs.
      const stop = body.slice(at(note) + note.length, at(status));
      expect(stop.replace(/\s+/g, ' ').trim()).toBe(
        "if (challenged) { test.info().annotations.push({ type: 'edge-challenge', description: challenged }); return; }"
      );
      // Then the status, hard, before anything on the page is looked at.
      expect(at(status)).toBeGreaterThan(at(note));
      expect(at(first)).toBeGreaterThan(at(status));
    }
  );

  test.each(PAGE_TESTS)('"$title": no event page read takes a 403 for an answer', ({ title }) => {
    const code = testBody(title).replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/403/);
    expect(code).not.toMatch(/test\.skip|test\.fixme|expect\.soft/);
    // The page checks are not inside a branch on the status.
    expect(code).not.toMatch(/if \([^)]*[sS]tatus[^)]*\)/);
  });
});

describe('the helper notes a challenge and never passes it', () => {
  const start = HELPER.indexOf('export async function noteIfEdgeAnswered');
  const body = HELPER.slice(start);

  test('a noted challenge is handed back to the caller, with what was really sent', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain(
      'if (!res || !edgeChallenged(res.status(), res.headers())) return null;'
    );
    expect(body).toContain(
      'return noteEdgeChallenge(path, process.env, { headerSent: await edgeHeaderSent(res) });'
    );
    expect(body.match(/\breturn\b/g)).toHaveLength(2);
    expect(body).not.toMatch(/test\.skip|catch/);
  });

  test('what was sent is read from the request, not from the environment', () => {
    const sent = HELPER.slice(
      HELPER.indexOf('export async function edgeHeaderSent'),
      HELPER.indexOf('export function throwIfEdgeAnswered')
    );
    expect(sent).toContain('await res.request().allHeaders()');
    expect(sent).not.toMatch(/edgeHeaders|process\.env/);
  });
});

describe('the other two reads of the spec name the edge too', () => {
  test("the draft's first read fails by name when the edge answers, before the 404 check", () => {
    const body = testBody(PAGE_TESTS[1].title);
    const read = body.indexOf('const draftPublic = await page.goto(');
    const stop = body.indexOf('throwIfEdgeAnswered(draftPublic, `/events/${draftEventId}`);');
    const status = body.indexOf(
      "expect(draftPublic?.status(), 'draft is not public before go-live').toBe(404);"
    );
    expect(read).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(read);
    expect(status).toBeGreaterThan(stop);
  });

  const SCAN =
    'poster scan route replays to /events/:id with type and deployment context (OSE-1359)';

  test('the scan read sends the header itself', () => {
    const body = testBody(SCAN).replace(/\s+/g, ' ');
    expect(body).toContain('{ maxRedirects: 0, headers: edgeHeaders() }');
  });

  test('the scan read: an edge answer is noted with what was sent, and the test stops', () => {
    const body = testBody(SCAN)
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s+/g, ' ');
    const note = body.indexOf('if (edgeChallenged(res.status(), res.headers())) {');
    const status = body.indexOf(
      "expect(res.status(), 'the Worker answers the scan route with a redirect').toBe(302);"
    );
    expect(note).toBeGreaterThan(body.indexOf('await request.get('));
    expect(status).toBeGreaterThan(note);
    expect(body.slice(note, status).trim()).toBe(
      "if (edgeChallenged(res.status(), res.headers())) { const challenged = noteEdgeChallenge('/q/token?type=checkin', process.env, { headerSent: Boolean(edgeHeaders()['X-OCR-CI']), }); test.info().annotations.push({ type: 'edge-challenge', description: challenged }); return; }"
    );
    // The poster token is not written anywhere.
    expect(body).not.toMatch(/noteEdgeChallenge\([^)]*qrToken/);
  });

  test('the scan read: no 403 is taken for an answer, and nothing hangs on the status', () => {
    const code = testBody(SCAN).replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/403/);
    expect(code).not.toMatch(/test\.skip|test\.fixme|expect\.soft/);
    expect(code).not.toMatch(/if \([^)]*res\.status\(\) ===/);
  });
});
