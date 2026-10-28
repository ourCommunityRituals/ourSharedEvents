/**
 * OSE-1754: the /forms/:id page never writes a value from the URL into its
 * scripts unencoded.
 *
 * /forms/<id> is the older address a form QR lands on. Its route takes any
 * segment without a slash, and the path is not decoded, so a raw quote reaches
 * the handler. Before the fix the id went straight into the page's nonced
 * inline script as a quoted string, so a crafted link could close the string
 * and run its own code on the page where attendees type their name and email.
 * The nonce does not help: the code is inside the trusted block.
 *
 * Now an id the form endpoints would refuse (isValidEventId) gets a 404 page
 * with no form, values placed in a script are script-safe JSON, and a
 * ?deployment= value of the wrong shape is dropped.
 *
 * Layer: API (workers pool, SELF.fetch through the router).
 * Format: `OSE-1754 | API | <method + path> (<condition>) | <assertion>`.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const KNOWN_EVENT_ID = 'evt_1754_live';
const UNKNOWN_EVENT_ID = 'evt_1754_not_seeded';

// A quote closes the string the id used to sit in; parentheses and commas are
// not percent-encoded in a path either, so this is valid script once it lands.
const QUOTE_BREAKOUT = "x',alert(1754),'";
const FORM_TYPES = ['register', 'checkin', 'survey', 'email-signup'];

beforeAll(async () => {
  const tenv = env as unknown as TestEnv;
  const tolerated = (msg: string) =>
    msg.includes('duplicate column name') ||
    msg.includes('already exists') ||
    msg.includes('no such column');
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (tolerated(msg)) continue;
      throw e;
    }
  }
  await tenv.DB.prepare(
    "INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, start_date) VALUES (?, 'brand_test', 'Forms escaping check', ?, 'active', '2026-06-01T20:00:00Z')"
  )
    .bind(KNOWN_EVENT_ID, KNOWN_EVENT_ID)
    .run();
});

function formPage(path: string): Promise<Response> {
  return SELF.fetch(`https://test.local${path}`, { headers: { Accept: 'text/html' } });
}

/**
 * Every inline <script> body on the page, joined. The end tag is read the way
 * a browser reads it: any case, with whitespace or attributes before the `>`
 * (`</script >`, `</script foo="x">`), but not `</scripts>`, which does not end
 * the block. Tested below, so the assertions that use it cannot miss a block.
 */
function scriptText(html: string): string {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi)]
    .map((m) => m[1])
    .join('\n');
}

describe('OSE-1754 the scriptText helper reads every form of the script end tag', () => {
  for (const [label, html, body] of [
    ['a plain end tag', '<script>a()</script>', 'a()'],
    ['a space before >', '<script>b()</script >', 'b()'],
    ['a tab before >', '<script>c()</script\t>', 'c()'],
    ['a newline before >', '<script>d()</script\n>', 'd()'],
    ['an attribute', '<script>e()</script foo="bar">', 'e()'],
    ['upper case', '<SCRIPT>f()</SCRIPT>', 'f()'],
    ['mixed case, attributes on both tags', `<script nonce="n1">g()</Script data-x='y' >`, 'g()'],
  ] as const) {
    test(`OSE-1754 | unit | scriptText (${label}) | reads the block`, () => {
      expect(scriptText(`<p>before</p>${html}<p>after</p>`)).toBe(body);
    });
  }

  test('OSE-1754 | unit | scriptText (</scripts> inside a block) | does not end the block there', () => {
    expect(scriptText('<script>h()</scripts>i()</script>')).toBe('h()</scripts>i()');
  });

  test('OSE-1754 | unit | scriptText (two blocks, odd end tags) | reads both', () => {
    expect(scriptText('<script>j()</script ><p>x</p><script>k()</SCRIPT\n>')).toBe('j()\nk()');
  });
});

describe('OSE-1754 /forms/:id refuses an id the form endpoints would refuse', () => {
  test('OSE-1754 | API | path keeps a raw quote | the test request really carries it', () => {
    // Guards the premise: if the URL parser started encoding quotes, the
    // tests below would pass without testing anything.
    expect(new URL(`https://test.local/forms/${QUOTE_BREAKOUT}`).pathname).toBe(
      `/forms/${QUOTE_BREAKOUT}`
    );
  });

  // @born-red TL-083 | method: deliberate-fixture-break | date: 2026-10-28
  for (const type of FORM_TYPES) {
    test(`OSE-1754 | API | GET /forms/:id?type=${type} (id breaks out of a script string) | 404 page, no form, nothing from the id in a script`, async () => {
      const res = await formPage(`/forms/${QUOTE_BREAKOUT}?type=${type}`);
      expect(res.status).toBe(404);
      expect(res.headers.get('Content-Type') ?? '').toContain('text/html');
      const html = await res.text();
      expect(html).not.toContain('<form');
      expect(html).not.toContain('alert(1754)');
      expect(scriptText(html)).not.toContain("x'");
    });
  }

  test('OSE-1754 | API | GET /forms/:id (id with angle brackets, encoded) | 404 page, no form', async () => {
    const res = await formPage('/forms/%3Cscript%3Ealert(1754)%3C%2Fscript%3E');
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).not.toContain('<form');
    expect(html).not.toContain('alert(1754)');
  });

  test('OSE-1754 | API | GET /forms/:id (id longer than 128 characters) | 404 page, no form', async () => {
    const res = await formPage(`/forms/evt_${'a'.repeat(130)}`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('<form');
  });

  test('OSE-1754 | API | GET /forms/:id (valid id, not seeded) | still renders the form (OSE-1737 decides this, unchanged)', async () => {
    const res = await formPage(`/forms/${UNKNOWN_EVENT_ID}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<form');
  });

  // Every form type, so a revert in any one of the four submitForm sinks shows.
  for (const type of FORM_TYPES) {
    test(`OSE-1754 | API | GET /forms/:id?type=${type} (live event) | the id reaches the script as a JSON string`, async () => {
      const res = await formPage(`/forms/${KNOWN_EVENT_ID}?type=${type}`);
      expect(res.status).toBe(200);
      const scripts = scriptText(await res.text());
      expect(scripts).toContain(`submitForm("${KNOWN_EVENT_ID}"`);
      expect(scripts).not.toContain(`submitForm('${KNOWN_EVENT_ID}'`);
    });
  }

  test('OSE-1754 | API | GET /forms/:id (a long run of junk on the end) | 404 page, refused without a repair', async () => {
    const res = await SELF.fetch(`https://test.local/forms/${KNOWN_EVENT_ID}${'.'.repeat(4000)}a`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('Location')).toBeNull();
  });
});

describe('OSE-1754 /forms/:id fat fingers: a near-miss link still reaches its form', () => {
  const QUERY = '?type=checkin&deployment=pd_1754ok';
  // The repair goes to the event's own address (OSE-1684), never back to /forms/.
  const MEANT = `/events/${KNOWN_EVENT_ID}/checkin?deployment=pd_1754ok`;

  for (const [label, typed] of [
    ['a trailing period (copied out of a sentence)', `${KNOWN_EVENT_ID}.`],
    ['a trailing bracket and comma', `${KNOWN_EVENT_ID}),`],
    ['a trailing typed space', `${KNOWN_EVENT_ID}%20`],
    ['a trailing quote', `${KNOWN_EVENT_ID}'`],
  ] as const) {
    test(`OSE-1754 | API | GET /forms/:id (${label}) | 302 to the form it meant, type and deployment kept`, async () => {
      const res = await SELF.fetch(`https://test.local/forms/${typed}${QUERY}`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe(MEANT);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    });
  }

  test('OSE-1754 | API | GET /forms/:id. (old email type, hostile deployment) | 302 to the updates screen, deployment dropped', async () => {
    const res = await SELF.fetch(
      `https://test.local/forms/${KNOWN_EVENT_ID}.?type=email&deployment=${encodeURIComponent('"><b>')}`,
      { redirect: 'manual' }
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`/events/${KNOWN_EVENT_ID}/updates`);
  });

  test('OSE-1754 | API | GET /forms/:id/ (trailing slash) | renders the form, not a JSON 404', async () => {
    const res = await formPage(`/forms/${KNOWN_EVENT_ID}/?type=register`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<form');
  });

  test('OSE-1754 | API | GET /forms/:id (a typo inside the id) | 404 page, never a guess', async () => {
    const res = await formPage(`/forms/evt_1754.live`);
    expect(res.status).toBe(404);
    expect(res.headers.get('Location')).toBeNull();
  });

  test('OSE-1754 | API | GET /forms/:id (hostile id) | never repaired into a redirect', async () => {
    const res = await SELF.fetch(`https://test.local/forms/${QUOTE_BREAKOUT}`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('Location')).toBeNull();
  });
});

describe('OSE-1754 /forms/:id backing out: every refusal leaves a way back', () => {
  test('OSE-1754 | API | GET /forms/:id (refused id) | the 404 page links to the events list and home', async () => {
    const html = await (await formPage(`/forms/${QUOTE_BREAKOUT}`)).text();
    expect(html).toContain('data-testid="error-cta" href="/events"');
    expect(html).toContain('data-testid="error-brand"');
    expect(html).toContain('This event link doesn&#39;t look right');
  });

  test('OSE-1754 | API | GET /forms/:id (live event) | the form keeps its back button', async () => {
    const html = await (await formPage(`/forms/${KNOWN_EVENT_ID}`)).text();
    expect(html).toContain('data-testid="form-back"');
  });
});

describe('OSE-1754 /forms/:id drops a ?deployment= value of the wrong shape', () => {
  // @born-red TL-083 | method: deliberate-fixture-break | date: 2026-10-28
  test('OSE-1754 | API | GET /forms/:id?deployment=</script>... (live event) | value never reaches the page', async () => {
    const hostile = '</script><script>alert(1754)</script>';
    const res = await formPage(
      `/forms/${KNOWN_EVENT_ID}?type=register&deployment=${encodeURIComponent(hostile)}`
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('alert(1754)');
    expect(html).not.toContain('data-testid="form-deployment-id"');
  });

  test('OSE-1754 | API | GET /forms/:id?deployment=<valid> (live event) | attribution is kept', async () => {
    const res = await formPage(`/forms/${KNOWN_EVENT_ID}?type=register&deployment=pd_1754ok`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-testid="form-deployment-id" value="pd_1754ok"');
    expect(scriptText(html)).toContain('"pd_1754ok"');
  });

  // The register form, not check-in: check-in has no hidden deployment field,
  // so a check-in page would pass this whether or not the value was dropped.
  test('OSE-1754 | API | GET /forms/:id?deployment=<129 characters> (live event) | value is dropped', async () => {
    const res = await formPage(
      `/forms/${KNOWN_EVENT_ID}?type=register&deployment=pd_${'a'.repeat(126)}`
    );
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('data-testid="form-deployment-id"');
  });
});
