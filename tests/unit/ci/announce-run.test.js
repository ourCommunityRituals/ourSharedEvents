/**
 * announce-run (scripts/ci/announce-run.mjs): a red off-chain run opens or updates
 * a GitHub issue; the next green run closes it. Written after "Stock data (stg)"
 * failed silently every day from 2026-11-07.
 */
let a;
beforeAll(async () => {
  a = await import('../../../scripts/ci/announce-run.mjs');
});

// Built, not literal: a stand-in, kept out of the committed-secret scan's way.
const TOKEN = ['stand', 'in', 'token'].join('-');
const needs = (o) =>
  JSON.stringify(
    Object.fromEntries(Object.entries(o).map(([k, r]) => [k, { result: r, outputs: {} }]))
  );
const ENV = {
  GITHUB_TOKEN: TOKEN,
  GITHUB_REPOSITORY: 'ourCommunityRituals/ourSharedEvents',
  GITHUB_RUN_ID: '42467253667',
  GITHUB_SERVER_URL: 'https://github.com',
  ANNOUNCE_KEY: 'stock-data-stg',
  ANNOUNCE_TITLE: 'Stock data (stg) is red',
};

/** A fake GitHub API holding issues; records every call. */
function api({ issues = [], failOn = {} } = {}) {
  const calls = [];
  let next = 100;
  const fetch = async (url, init) => {
    const u = new URL(url);
    const route = `${init.method} ${u.pathname.replace('/repos/ourCommunityRituals/ourSharedEvents', '')}`;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ route, body, query: u.search, headers: init.headers });
    const reply = (status, json) => ({
      status,
      text: async () => (json ? JSON.stringify(json) : ''),
    });
    for (const [r, status] of Object.entries(failOn)) {
      if (
        route === r &&
        !(r === 'POST /issues' && body && !body.assignees && failOn.onlyWithAssignee)
      ) {
        return reply(status, { message: 'nope' });
      }
    }
    if (route === 'GET /issues') {
      const label = u.searchParams.get('labels');
      return reply(
        200,
        issues.filter((i) => i.state === 'open' && i.labels.includes(label))
      );
    }
    if (route === 'POST /labels') return reply(201, { name: body.name });
    if (route === 'POST /issues') {
      const issue = { number: next++, state: 'open', body: body.body, labels: body.labels };
      issues.push(issue);
      return reply(201, issue);
    }
    if (/^POST \/issues\/\d+\/comments$/.test(route)) return reply(201, { id: 1 });
    if (/^PATCH \/issues\/\d+$/.test(route)) {
      const n = Number(route.split('/').pop());
      Object.assign(
        issues.find((i) => i.number === n),
        body
      );
      return reply(200, {});
    }
    return reply(404, null);
  };
  return { fetch, calls, issues };
}

const go = (env, gh) =>
  a.announce(env, {
    fetch: gh.fetch,
    write: () => {},
    now: () => new Date('2026-11-08T09:40:00Z'),
  });

describe('verdict', () => {
  test('red when any job failed or was cancelled', () => {
    expect(
      a.verdict(needs({ seed: 'success', build: 'success', 'check-swap': 'failure' })).state
    ).toBe('red');
    expect(
      a.verdict(needs({ seed: 'success', build: 'cancelled', 'check-swap': 'skipped' })).red
    ).toEqual(['build']);
    expect(
      a.verdict(needs({ seed: 'failure', build: 'skipped', 'check-swap': 'skipped' })).state
    ).toBe('red');
  });
  test('green only when every job succeeded', () => {
    expect(a.verdict(needs({ edge: 'success', searches: 'success' })).state).toBe('green');
  });
  test('nothing when jobs were skipped and none failed (a branch dispatch)', () => {
    expect(a.verdict(needs({ seed: 'skipped', build: 'skipped' })).state).toBe('none');
  });
  test('refuses NEEDS that is not a jobs object', () => {
    expect(() => a.verdict('')).toThrow(/NEEDS/);
    expect(() => a.verdict('[]')).toThrow(/NEEDS/);
    expect(() => a.verdict('{}')).toThrow(/NEEDS/);
  });
});

describe('announce', () => {
  const RED = {
    ...ENV,
    NEEDS: needs({ seed: 'success', build: 'success', 'check-swap': 'failure' }),
  };
  const GREEN = {
    ...ENV,
    NEEDS: needs({ seed: 'success', build: 'success', 'check-swap': 'success' }),
  };

  test('a first red run opens one labelled, marked issue naming the run and the failed job', async () => {
    const gh = api();
    const r = await go({ ...RED, ANNOUNCE_HINT: 'Read check-swap.' }, gh);
    expect(r.action).toBe('opened');
    const open = gh.calls.find((c) => c.route === 'POST /issues');
    expect(open.body.title).toBe(ENV.ANNOUNCE_TITLE);
    expect(open.body.labels).toEqual(['ci-red:stock-data-stg']);
    expect(open.body.body).toContain(a.markerFor('stock-data-stg'));
    expect(open.body.body).toContain(
      'https://github.com/ourCommunityRituals/ourSharedEvents/actions/runs/42467253667'
    );
    expect(open.body.body).toContain('Failed: check-swap');
    expect(open.body.body).toContain('Read check-swap.');
  });

  test('a second red run comments on the open issue instead of opening another', async () => {
    const gh = api();
    await go(RED, gh);
    const r = await go(RED, gh);
    expect(r.action).toBe('commented');
    expect(gh.calls.filter((c) => c.route === 'POST /issues')).toHaveLength(1);
    expect(gh.issues.filter((i) => i.state === 'open')).toHaveLength(1);
  });

  test('a green run closes the open issue with a comment', async () => {
    const gh = api();
    await go(RED, gh);
    const r = await go(GREEN, gh);
    expect(r.action).toBe('closed');
    expect(gh.issues[0].state).toBe('closed');
    expect(gh.calls.some((c) => /comments$/.test(c.route) && /Green again/.test(c.body.body))).toBe(
      true
    );
  });

  test('a green run with no open issue does nothing; neither does a branch dispatch', async () => {
    const gh = api();
    expect((await go(GREEN, gh)).action).toBe('none');
    expect((await go({ ...ENV, NEEDS: needs({ seed: 'skipped' }) }, gh)).action).toBe('none');
    expect(gh.calls.filter((c) => c.route !== 'GET /issues')).toHaveLength(0);
  });

  test("an issue with the label but without this key's marker is not taken as this one", async () => {
    const gh = api({
      issues: [
        { number: 7, state: 'open', body: 'someone else', labels: ['ci-red:stock-data-stg'] },
      ],
    });
    const r = await go(RED, gh);
    expect(r.action).toBe('opened');
  });

  test('an assignee the repo refuses still opens the issue, without one', async () => {
    const gh = api({ failOn: { 'POST /issues': 422, onlyWithAssignee: true } });
    const r = await go({ ...RED, ANNOUNCE_ASSIGNEE: 'not-a-collaborator' }, gh);
    expect(r.action).toBe('opened');
    const posts = gh.calls.filter((c) => c.route === 'POST /issues');
    expect(posts[0].body.assignees).toEqual(['not-a-collaborator']);
    expect(posts[1].body.assignees).toBeUndefined();
  });

  test('a failed API call throws, so the announce job is red, never silently green', async () => {
    await expect(go(RED, api({ failOn: { 'GET /issues': 401 } }))).rejects.toThrow(/HTTP 401/);
    await expect(go(RED, api({ failOn: { 'POST /issues': 403 } }))).rejects.toThrow(/HTTP 403/);
  });

  test('the token goes only in the Authorization header, and is never written out', async () => {
    const gh = api();
    const out = [];
    await a.announce(RED, { fetch: gh.fetch, write: (s) => out.push(s) });
    for (const c of gh.calls) {
      expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(JSON.stringify(c.body || {})).not.toContain(TOKEN);
    }
    expect(out.join('')).not.toContain(TOKEN);
  });

  test('refuses a key that is not lower-case words and dashes', async () => {
    await expect(go({ ...RED, ANNOUNCE_KEY: 'Bad Key' }, api())).rejects.toThrow(/ANNOUNCE_KEY/);
  });
});

/**
 * OSE-2082: the issue says why the run is red, in the run's own words
 * (ANNOUNCE_DETAIL: the stock run's edge check reason, or its build error).
 *
 * Born red (each fault injected alone in scripts/ci/announce-run.mjs, then removed):
 *   D1 the detail left out of the red line        -> the first two cases fail
 *   D2 detailLine returns its input unchanged     -> the markup and length cases fail
 */
describe('announce: why the run is red (ANNOUNCE_DETAIL)', () => {
  const RED = {
    ...ENV,
    NEEDS: needs({
      preflight: 'failure',
      seed: 'skipped',
      build: 'skipped',
      'check-swap': 'skipped',
    }),
  };
  const REASON =
    "Stopped before the seed; nothing on stg was loaded or purged. edge-challenged: /s/edge-probe ray=a5711b195919fa42-SEA. Fix: the stg CI skip rule must skip Super Bot Fight Mode on every path. Run scripts/ci/cf-waf-stg-ci-skip.mjs; don't edit the dashboard.";

  test('a new issue carries the path, the Ray ID and the fix', async () => {
    const gh = api();
    await go({ ...RED, ANNOUNCE_DETAIL: REASON }, gh);
    const body = gh.calls.find((c) => c.route === 'POST /issues').body.body;
    expect(body).toContain(`**Why:** ${REASON}`);
  });

  test('a comment on the open issue carries the build error', async () => {
    const gh = api({
      issues: [
        {
          number: 7,
          state: 'open',
          labels: [a.labelFor('stock-data-stg')],
          body: a.markerFor('stock-data-stg'),
        },
      ],
    });
    const error = 'POST /api/v2/admin/events/evt_1/poster-deployments failed: 503 (3 tries)';
    await go({ ...RED, ANNOUNCE_DETAIL: error }, gh);
    const comment = gh.calls.find((c) => c.route === 'POST /issues/7/comments').body.body;
    expect(comment).toContain(`**Why:** ${error}`);
  });

  test('with no detail the issue reads as before', async () => {
    const gh = api();
    await go(RED, gh);
    expect(gh.calls.find((c) => c.route === 'POST /issues').body.body).not.toContain('**Why:**');
  });

  test('the detail is cut to one line of plain characters: no mention, link or markup', () => {
    expect(a.detailLine('one\ntwo\r\n three')).toBe('one two three');
    expect(a.detailLine('@owner see #12 <img src=x> [x](http://e.vil) `code` **b**')).toBe(
      'owner see 12 img src=x x(http://e.vil) code b'
    );
    expect(a.detailLine('')).toBe('');
    expect(a.detailLine(undefined)).toBe('');
  });

  test('the detail is cut at 600 characters', () => {
    expect(a.detailLine('x'.repeat(900))).toBe(`${'x'.repeat(600)}…`);
  });
});
