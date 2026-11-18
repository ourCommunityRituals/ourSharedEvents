/**
 * Derived gate: the Worker never hands a credential back.
 *
 * Whatever a caller sends as a credential (an Access JWT, the admin key, the CI
 * header, a service token, cookies) and whatever the Worker itself holds as a
 * secret (keys, peppers, signing secrets) must not appear in any answer: not in
 * a body, not in a header, not on a 4xx, not on a 5xx. And not in any line the
 * Worker writes to its log while it answers.
 *
 * Method. This gate keeps no list of routes. It reads every address out of
 * `src/router.ts` (helpers/credential-echo.ts), turns each into paths that can
 * be requested, and sends every method to every path through the real Worker
 * entry (`fetch` in src/index.ts). GET goes out twice: bare, and with a query
 * string that fills the parameters routes ask for, a refused signed link among
 * them. The whole sweep is repeated for each of these:
 *   1. refused credentials: made-up values in every credential header, then
 *      the keys alone and the cookies alone (together, the first refusal
 *      answers for all of them and the ones behind it are never reached);
 *   2. the automation key: the test environment's real admin key and CI header;
 *   3. a signed-in admin: an Access JWT for an allowlisted email;
 *   4. a database that fails, quoting the credentials in its error;
 *   5. a request that fails before the router, quoting them too (the 500).
 * Every answer is read whole, headers and body, for each value sent and for the
 * value of every secret binding the environment has (found by name, never
 * listed here). Log lines are read the same way, after redaction, as they would
 * reach Workers Logs.
 *
 * Signed links are a route's product, not a leak, and they are classified, not
 * hidden: SIGNED_LINK_PRODUCTS names each route that mints one and the one
 * place in its answer the link may sit. A signed link anywhere else fails, and
 * each product has a test that sees the link where the table says.
 *
 * A failure names the request, the status, the credential's NAME and where it
 * was found. It never prints a value.
 *
 * Level: W (workers pool, real routes, real D1). The staging layer is the Bruno
 * folder "24. No credential in any answer". The source side is
 * tests/e2e/0-architecture/credential-emission.invariant.spec.ts.
 *
 * @born-red a header echoed into an answer | method: the last 401 of
 *   requireAdmin (src/auth/admin.ts) was made to carry the Authorization value
 *   it refused (`got:` in the body), then the X-OCR-Internal value in a response
 *   header. The first run of this stayed GREEN: every refused request also
 *   carried a forged JWT and was refused earlier, with a 403. Sweep 1b (keys
 *   alone) was added for that, and with it both faults failed, naming the admin
 *   routes and the credential by name; taken out, it passed. The "planted echo"
 *   tests below keep a fault of the same kind in the suite | date: 2026-11-18
 * @born-red an error that repeats a credential | method: run against
 *   lib/unhandled-error-log.ts as it was on main: the UNHANDLED_ERROR line
 *   carried the admin key, the CI header value and the cookie values the
 *   failing request had sent (sweep 5 failed on "log line UNHANDLED_ERROR").
 *   A first version of the fault wrote `authorization=…` beside each value and
 *   stayed green, because the console wrapper masks a value under a header
 *   name; the fault now quotes the bare values | date: 2026-11-18
 * @born-red the fetch error in the maps and geocode lines | method: run against
 *   lib/maps.ts and lib/geo.ts as they were on main, with an upstream error that
 *   names the address it failed on: MAPS_FETCH_ERROR and GEO_FETCH_ERROR carried
 *   the maps key | date: 2026-11-18
 * @born-red redaction installed by the Worker | method: the installLogRedaction()
 *   call taken out of src/index.ts: "the Worker wraps the console" failed, and
 *   so did "a JWT the request never sent is masked" | date: 2026-11-18
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

const fault = vi.hoisted(() => ({
  /** Throw this before the router runs (the Worker's own 500). */
  atRouter: null as null | (() => unknown),
  /** Make GET /health hand back what the caller sent. */
  echo: false,
  lastRequest: null as Request | null,
}));

vi.mock('../src/lib/cors', async (orig) => {
  const real = await orig<typeof import('../src/lib/cors')>();
  return {
    ...real,
    bindCorsEnv: (...args: Parameters<typeof real.bindCorsEnv>) => {
      fault.lastRequest = args[0];
      if (fault.atRouter) throw fault.atRouter();
      return real.bindCorsEnv(...args);
    },
  };
});

vi.mock('../src/handlers/health', async (orig) => {
  const real = await orig<typeof import('../src/handlers/health')>();
  return {
    ...real,
    handleHealth: async (...args: Parameters<typeof real.handleHealth>) => {
      if (!fault.echo || !fault.lastRequest) return real.handleHealth(...args);
      const h = fault.lastRequest.headers;
      return Response.json(
        { ok: true, seen: h.get('Authorization') },
        { headers: { 'X-Seen': h.get('X-OCR-Internal') ?? '' } }
      );
    },
  };
});

const { default: worker } = await import('../src/index');
const { isLogRedactionInstalled } = await import('../src/lib/log-redact');
const { mintSponsorHomeToken } = await import('../src/lib/sponsor-home-auth');
import type { RouterEnv } from '../src/router';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import {
  SAMPLE_ID,
  findLeaks,
  isSecretBindingName,
  pathConstants,
  samplePathsForPattern,
  sweepPaths,
  type Answer,
  type Probe,
  type SignedLinkRule,
} from './helpers/credential-echo';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  ADMIN_KEY: string;
  X_OCR_INTERNAL: string;
  ALLOWED_ADMIN_EMAILS?: string;
  SHARED_REPORT_SIGNING_SECRET: string;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}
const E = env as unknown as TestEnv;
const HOST = 'https://ose.test';
const BRAND = 'brand_default';

// ── The routes, read from the router ─────────────────────────────────────────

const SOURCES = JSON.parse(E.TEST_SOURCE_FILES_JSON) as Record<string, string>;
function routerSource(): string {
  for (const [path, content] of Object.entries(SOURCES)) {
    if (path.replace(/\\/g, '/').endsWith('src/router.ts')) return content;
  }
  throw new Error('src/router.ts not found in TEST_SOURCE_FILES_JSON');
}
const SWEEP = sweepPaths(routerSource(), pathConstants(SOURCES));
// A language prefix is part of the address for the pages on the language layer.
const PATHS = [...SWEEP.paths, ...SWEEP.paths.map((p) => (p === '/' ? '/es' : `/es${p}`))];
const METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * A signed link the Worker refuses (well-formed, wrong signature), sent as the
 * `t` and `token` of the query pass: what a sponsor or report link looks like
 * in an address.
 */
const REFUSED_LINK = `${btoa(
  JSON.stringify({ event_id: SAMPLE_ID, role: 'sponsor', sponsor_id: SAMPLE_ID, exp: 4102444800 })
)
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '')}.${'c0ffee42'.repeat(8)}`;
/** One query string that fills the parameters routes read, so they get past "missing". */
const QUERY =
  `?t=${REFUSED_LINK}&token=${REFUSED_LINK}&eventId=${SAMPLE_ID}&event=${SAMPLE_ID}&venue=Harbor+Hall` +
  `&address=1+Main+St&q=market&where=Springfield&zip=60601&brand=brand_default&surface=display` +
  `&slot=sidebar&format=json&lang=es&limit=5&page=1`;

// ── What is sent ─────────────────────────────────────────────────────────────

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function jwtFor(email: string, sig: string): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ email, iat: now - 10, exp: now + 3600 })}.${sig}`;
}

// Made-up values. Each is long, fixed and unlike anything a handler builds.
const SENT = {
  bearer: 'made-up-bearer-for-the-echo-sweep',
  ocr: 'made-up-ci-header-for-the-echo-sweep',
  clientSecret: 'made-up-client-secret-for-the-echo-sweep',
  session: 'made-up-app-session-for-the-echo-sweep',
  anon: 'anon_made-up-anonymous-id-for-the-echo-sweep',
  refusedJwt: jwtFor('nobody@not-allowlisted.example', 'made-up-signature-of-the-refused-token'),
  cookieJwt: jwtFor('cookie@not-allowlisted.example', 'made-up-signature-of-the-cookie-token'),
};

/** Every piece of a JWT that would be a leak by itself. */
function jwtProbes(name: string, jwt: string): Probe[] {
  const [, payload, sig] = jwt.split('.');
  return [
    { name: `${name} (whole)`, value: jwt },
    { name: `${name} (payload)`, value: payload },
    { name: `${name} (signature)`, value: sig },
  ];
}

const SENT_PROBES: Probe[] = [
  { name: 'Authorization bearer sent', value: SENT.bearer },
  { name: 'X-OCR-Internal sent', value: SENT.ocr },
  { name: 'CF-Access-Client-Secret sent', value: SENT.clientSecret },
  { name: 'Cookie CF_AppSession sent', value: SENT.session },
  {
    name: 'Cookie ose_anon sent',
    value: SENT.anon,
    // The anonymous cookie is re-sent as a cookie by design (invariant 4), on
    // the routes tests/e2e/0-architecture/cookie-setters.invariant.spec.ts allows.
    allowedHeader: { name: 'set-cookie', startsWith: 'ose_anon=' },
  },
  ...jwtProbes('Cf-Access-Jwt-Assertion sent', SENT.refusedJwt),
  ...jwtProbes('Cookie CF_Authorization sent', SENT.cookieJwt),
];

/**
 * The body of every write: the fields routes ask for, so they get past
 * "missing", with the refused signed link where a route takes one in its body.
 */
const WRITE_BODY = JSON.stringify({
  address: '1 Main St, Springfield',
  title: 'Credential Echo Write',
  name: 'Credential Echo',
  role: 'sponsor',
  sponsor_id: SAMPLE_ID,
  event_id: SAMPLE_ID,
  token: REFUSED_LINK,
  t: REFUSED_LINK,
});

/**
 * The refused signed link of the query pass and of the write body. A redirect may carry the caller's
 * own query back to them in `Location` (an alias keeps its query); it may not
 * appear in a body or any other header.
 */
const REFUSED_LINK_PROBE: Probe = {
  name: 'signed link sent in the query or the body (t / token)',
  value: REFUSED_LINK,
  allowedHeader: { name: 'location', startsWith: '' },
};

/** A maps key for the sweep: the test environment has none, so the routes that use one would not run. */
const MAPS_KEY = 'made-up-maps-key-for-the-echo-sweep';
const sweepEnv = (extra: object = {}): RouterEnv =>
  ({ ...(env as object), GOOGLE_MAPS_API_KEY: MAPS_KEY, ...extra }) as unknown as RouterEnv;

/** The value of every secret binding in the environment, found by its name. */
function secretProbes(from: object): Probe[] {
  const out: Probe[] = [];
  for (const [name, value] of Object.entries(from)) {
    if (typeof value !== 'string' || !isSecretBindingName(name)) continue;
    const v = value.trim();
    if (v.length < 12) continue;
    out.push({ name: `secret binding ${name}`, value: v });
    // A multi-line key (a PEM): any one line of it is a leak.
    const lines = v.split(/\r?\n/).filter((l) => l.length >= 40 && !l.startsWith('-----'));
    if (lines.length > 1) {
      lines
        .slice(0, 3)
        .forEach((l, i) => out.push({ name: `secret binding ${name} (line ${i + 1})`, value: l }));
    }
  }
  return out;
}
const SECRET_PROBES = secretProbes(sweepEnv());
const ALL_PROBES = [...SENT_PROBES, REFUSED_LINK_PROBE, ...SECRET_PROBES];

const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin', Origin: HOST };
const COOKIE = `CF_Authorization=${SENT.cookieJwt}; ose_anon=${SENT.anon}; CF_AppSession=${SENT.session}`;

type HeaderSet = Record<string, string>;
const REFUSED: HeaderSet = {
  ...SAME_ORIGIN,
  Authorization: `Bearer ${SENT.bearer}`,
  'X-OCR-Internal': SENT.ocr,
  'Cf-Access-Jwt-Assertion': SENT.refusedJwt,
  'CF-Access-Client-Id': 'ce-client-id.access',
  'CF-Access-Client-Secret': SENT.clientSecret,
  Cookie: COOKIE,
};
/**
 * The same refused values, one kind at a time. Sent together, the first check
 * that refuses (the Access JWT) answers for all of them, and the refusals
 * behind it (the key methods' 401) are never reached.
 */
const REFUSED_KEYS_ONLY: HeaderSet = {
  ...SAME_ORIGIN,
  Authorization: `Bearer ${SENT.bearer}`,
  'X-OCR-Internal': SENT.ocr,
  'CF-Access-Client-Id': 'ce-client-id.access',
  'CF-Access-Client-Secret': SENT.clientSecret,
};
const REFUSED_COOKIE_ONLY: HeaderSet = { ...SAME_ORIGIN, Cookie: COOKIE };
const automationKey = (): HeaderSet => ({
  ...SAME_ORIGIN,
  Authorization: `Bearer ${E.ADMIN_KEY}`,
  'X-OCR-Internal': E.X_OCR_INTERNAL,
  'CF-Access-Client-Secret': SENT.clientSecret,
  Cookie: COOKIE,
});
const ADMIN_EMAIL = (E.ALLOWED_ADMIN_EMAILS ?? '').split(',')[0]?.trim() ?? '';
const SIGNED_IN_JWT = jwtFor(ADMIN_EMAIL, 'made-up-signature-of-the-signed-in-token');
const signedIn = (): HeaderSet => ({
  ...SAME_ORIGIN,
  'Cf-Access-Jwt-Assertion': SIGNED_IN_JWT,
  Cookie: `CF_Authorization=${SIGNED_IN_JWT}; ose_anon=${SENT.anon}; CF_AppSession=${SENT.session}`,
});
const SIGNED_IN_PROBES = jwtProbes('Cf-Access-Jwt-Assertion of the signed-in admin', SIGNED_IN_JWT);

// ── Signed links: classified, not hidden ─────────────────────────────────────

interface SignedLinkProduct extends SignedLinkRule {
  method: string;
  path: RegExp;
  why: string;
}

/**
 * Every route whose answer may carry a signed link this Worker minted, and the
 * one place it may sit. These are bearer credentials the route exists to hand
 * out: to the organizer who asked (the two admin mints), to the sponsor whose
 * page it is, or to the page that must send it back with a beacon. Anything
 * else that carries one fails the sweep.
 */
const SIGNED_LINK_PRODUCTS: readonly SignedLinkProduct[] = [
  {
    method: 'POST',
    path: /^\/api\/v2\/admin\/events\/[^/]+\/shared-report\/mint-link$/,
    jsonFields: ['token'],
    why: 'The organizer asks for a report link; the answer is that link. Admin only, rate-limited, audited (MINT_REPORT_LINK).',
  },
  {
    method: 'POST',
    path: /^\/api\/v2\/admin\/sponsors\/[^/]+\/home-link$/,
    jsonFields: ['url'],
    why: "The organizer asks for a sponsor's page link to send on; the answer is that link. Admin only, rate-limited, audited (MINT_SPONSOR_HOME_LINK).",
  },
  {
    method: 'GET',
    path: /^\/sponsor$/,
    htmlPrefix: /\/sharedReport\?eventId=[^"'&\s]+&(?:amp;)?token=$/,
    why: "The sponsor's own page, opened with their signed link, links to their reports; each report link is signed for that sponsor and that event.",
  },
  {
    method: 'GET',
    path: /^\/api\/v2\/events\/[^/]+\/sponsor-bundle$/,
    jsonFields: ['beacon_token'],
    why: 'Public by design: the display sends it back with an impression or a click so the count can be trusted. It opens nothing and names one sponsor on one event.',
  },
];

function signedLinkRuleFor(method: string, path: string): SignedLinkRule | null {
  return SIGNED_LINK_PRODUCTS.find((p) => p.method === method && p.path.test(path)) ?? null;
}

// ── Sending, reading, and the log ────────────────────────────────────────────

// Read the log as Workers Logs would get it. beforeAll swaps in a console whose
// six levels are bare collectors. This file never installs redaction: the
// Worker does, at its next entry (src/index.ts), on whatever console is current.
// So what the collectors receive is what the Worker's own wrapper let through.
const LEVELS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
const realConsole = globalThis.console;
const collectorConsole = Object.create(realConsole) as Console;
/** Every line written while a sweep ran. */
let logLines: string[] = [];

function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return `${v.name}: ${v.message} ${v.stack ?? ''}`;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}
for (const level of LEVELS) {
  Object.defineProperty(collectorConsole, level, {
    value: (...args: unknown[]) => {
      logLines.push(args.map(asText).join(' '));
    },
    writable: true,
    configurable: true,
  });
}

let ipCounter = 0;
/** A caller of its own for each request, so no rate limit answers for the route. */
function nextIp(): string {
  ipCounter += 1;
  return `198.51.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

async function send(
  method: string,
  pathAndQuery: string,
  headers: HeaderSet,
  withEnv: RouterEnv
): Promise<{ status: number; answer: Answer }> {
  const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const init: RequestInit = {
    method,
    headers: {
      'CF-Connecting-IP': nextIp(),
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(hasBody ? { body: WRITE_BODY } : {}),
    redirect: 'manual',
  };
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${HOST}${pathAndQuery}`, init), withEnv, ctx);
  await waitOnExecutionContext(ctx);
  const body = new TextDecoder().decode(await res.arrayBuffer());
  return { status: res.status, answer: { headers: [...res.headers.entries()], body } };
}

interface SweepResult {
  failures: string[];
  statusClasses: Set<number>;
  requests: number;
  /** The `type` (or `event`) of every log line the sweep read. */
  logTypes: Set<string>;
}

async function sweep(
  headers: () => HeaderSet,
  withEnv: RouterEnv,
  probes: readonly Probe[],
  paths: readonly string[] = PATHS
): Promise<SweepResult> {
  const failures: string[] = [];
  const statusClasses = new Set<number>();
  let requests = 0;
  logLines = [];
  // GET goes out twice: bare, then with the query string (before the writes,
  // so what they change or delete is still there to be read).
  const passes: Array<[string, string]> = [
    ['GET', ''],
    ['GET', QUERY],
    ...METHODS.filter((m) => m !== 'GET').map((m): [string, string] => [m, '']),
  ];
  for (const [method, query] of passes) {
    for (const path of paths) {
      const { status, answer } = await send(method, `${path}${query}`, headers(), withEnv);
      requests += 1;
      statusClasses.add(Math.floor(status / 100));
      for (const leak of findLeaks(answer, probes, signedLinkRuleFor(method, path))) {
        failures.push(
          `${method} ${path}${query ? ' (with query)' : ''} -> ${status}: ${leak.what} in ${leak.where}`
        );
      }
    }
  }
  const leakedInLog = new Set<string>();
  const logTypes = new Set<string>();
  for (const line of logLines) {
    // The line's type says which line; its text is not printed.
    const type = /"(?:type|event)"\s*:\s*"([A-Za-z0-9_]+)"/.exec(line)?.[1] ?? 'untyped line';
    logTypes.add(type);
    for (const leak of findLeaks({ headers: [], body: line }, probes, null)) {
      leakedInLog.add(`log line ${type}: ${leak.what}`);
    }
  }
  failures.push(...leakedInLog);
  return { failures, statusClasses, requests, logTypes };
}

async function applyStatements(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

/** The event and the sponsor the sample id stands for, put back before each sweep. */
async function seed(): Promise<void> {
  await E.DB.prepare(
    // useSponsors: the event chose to have sponsors, so its sponsor resolves.
    `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, start_date, end_date, location, settings_json)
     VALUES (?, ?, 'Credential Echo Event', ?, 'active', '2026-01-01', '2099-01-01', 'Harbor Hall, 1 Main St', '{"useSponsors":true}')`
  )
    .bind(SAMPLE_ID, BRAND, SAMPLE_ID)
    .run();
  await seedSplitSponsor(E.DB, { id: SAMPLE_ID, eventId: SAMPLE_ID, brandId: BRAND });
}

/** A database whose every statement fails, quoting `quoted` the way the D1 client quotes a bound value. */
function failingDatabase(quoted: string): D1Database {
  const fail = async (): Promise<never> => {
    throw new Error(`D1_TYPE_ERROR: Type 'object' not supported for value '${quoted}'`);
  };
  const statement = { bind: () => statement, first: fail, all: fail, run: fail, raw: fail };
  return { prepare: () => statement, batch: fail, exec: fail, dump: fail } as unknown as D1Database;
}

beforeAll(async () => {
  await applyStatements(E.DB, E.TEST_MIGRATION_STATEMENTS);
  await applyStatements(E.FORMS_DB, E.TEST_FORMS_MIGRATION_STATEMENTS);

  globalThis.console = collectorConsole;

  // No request leaves the test. An upstream call fails the way a runtime that
  // names the address would: the error repeats the URL and the headers sent.
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const sent = init?.headers ? JSON.stringify(init.headers) : '';
    throw new TypeError(`Fetch API cannot load: ${url} ${sent}`);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  globalThis.console = realConsole;
});

afterEach(() => {
  fault.atRouter = null;
  fault.echo = false;
});

// ── The reader and the derivation can fail (negative controls) ───────────────

describe('the reader (negative controls on made-up answers)', () => {
  const probe: Probe = { name: 'the key', value: 'made-up-key-for-the-reader' };
  const clean: Answer = { headers: [['content-type', 'application/json']], body: '{"ok":true}' };

  test('a clean answer has no leaks', () => {
    expect(findLeaks(clean, [probe])).toEqual([]);
  });

  test('a value in the body is found, and named, not printed', () => {
    const leaks = findLeaks({ ...clean, body: `{"got":"${probe.value}"}` }, [probe]);
    expect(leaks).toEqual([{ where: 'body', what: 'the key' }]);
    expect(JSON.stringify(leaks)).not.toContain(probe.value);
  });

  test('a value in a response header is found', () => {
    const leaks = findLeaks({ ...clean, headers: [['X-Debug', probe.value]] }, [probe]);
    expect(leaks).toEqual([{ where: 'header x-debug', what: 'the key' }]);
  });

  test('a value is found URL-encoded and HTML-escaped too', () => {
    const odd: Probe = { name: 'odd', value: 'a&b=c"d<e>f/g+h' };
    expect(
      findLeaks({ ...clean, body: `?t=${encodeURIComponent(odd.value)}` }, [odd])
    ).toHaveLength(1);
    expect(findLeaks({ ...clean, body: 'a&amp;b=c&quot;d&lt;e&gt;f/g+h' }, [odd])).toHaveLength(1);
  });

  test('any JWT is a leak, whoever it belongs to', () => {
    const jwt = jwtFor('someone@example.test', 'made-up-signature');
    expect(findLeaks({ ...clean, body: `<p>${jwt}</p>` }, [])).toEqual([
      { where: 'body', what: 'a JWT (eyJ….eyJ….sig)' },
    ]);
    expect(findLeaks({ ...clean, headers: [['x-token', jwt]] }, [])).toHaveLength(1);
  });

  test('a signed link is a leak unless its route is classified, and then only in its place', () => {
    const link = `${b64url({ event_id: 'e', role: 'sponsor', exp: 1 })}.${'ab'.repeat(32)}`;
    const body = JSON.stringify({ ok: true, token: link });
    expect(findLeaks({ ...clean, body }, [])).toHaveLength(1);
    expect(findLeaks({ ...clean, body }, [], { jsonFields: ['token'] })).toEqual([]);
    expect(
      findLeaks({ ...clean, body: JSON.stringify({ debug: link }) }, [], { jsonFields: ['token'] })
    ).toHaveLength(1);
    const page = `<a href="/sharedReport?eventId=e&amp;token=${link}">Your report</a>`;
    const rule = { htmlPrefix: /\/sharedReport\?eventId=[^"'&\s]+&(?:amp;)?token=$/ };
    expect(findLeaks({ ...clean, body: page }, [], rule)).toEqual([]);
    expect(findLeaks({ ...clean, body: `<!-- ${link} -->` }, [], rule)).toHaveLength(1);
  });

  test('the anonymous cookie may come back as its own cookie and nowhere else', () => {
    const anon = SENT_PROBES.find((p) => p.name === 'Cookie ose_anon sent')!;
    const asCookie: Answer = {
      headers: [['set-cookie', `ose_anon=${anon.value}; HttpOnly`]],
      body: '',
    };
    expect(findLeaks(asCookie, [anon])).toEqual([]);
    expect(
      findLeaks({ headers: [['set-cookie', `other=${anon.value}`]], body: '' }, [anon])
    ).toHaveLength(1);
    expect(findLeaks({ headers: [], body: anon.value }, [anon])).toHaveLength(1);
  });
});

describe('the derivation sees the real router', () => {
  test('a planted route is found in every form the router uses', () => {
    const src = [
      "  if (pathname === '/planted-literal' && method === 'GET') {",
      '  if (pathname === PLANTED_CONSTANT) {',
      "  if (pathname.startsWith('/planted-prefix/')) {",
      '  const m = pathname.match(/^\\/planted\\/([^/]+)\\/(one|two)$/);',
    ].join('\n');
    expect(sweepPaths(src, { PLANTED_CONSTANT: '/planted-constant.svg' })).toEqual({
      paths: [
        `/planted-constant.svg`,
        `/planted-literal`,
        `/planted-prefix/${SAMPLE_ID}`,
        `/planted/${SAMPLE_ID}/one`,
        `/planted/${SAMPLE_ID}/two`,
      ],
      unresolved: [],
    });
    // An optional trailing slash is a path without it.
    expect(samplePathsForPattern('^\\/forms\\/([^/]+)\\/?$')).toEqual([`/forms/${SAMPLE_ID}`]);
  });

  test('an address that cannot be turned into a path is reported, not skipped', () => {
    expect(samplePathsForPattern('^\\/things\\/(\\d{4})$')).toBeNull();
    expect(
      sweepPaths('  const m = pathname.match(/^\\/things\\/(\\d{4})$/);').unresolved
    ).toHaveLength(1);
    expect(sweepPaths('  if (pathname === UNKNOWN_CONSTANT) {').unresolved).toEqual([
      'constant UNKNOWN_CONSTANT',
    ]);
  });

  test('every address in the real router became a path', () => {
    expect(SWEEP.unresolved).toEqual([]);
    expect(SWEEP.paths.length).toBeGreaterThanOrEqual(150);
  });

  test('the sweep reaches the routes that matter most here', () => {
    for (const p of [
      '/admin',
      '/health',
      '/sponsor',
      '/sharedReport',
      '/api/v2/admin/events',
      `/api/v2/admin/events/${SAMPLE_ID}/shared-report/mint-link`,
      `/api/v2/admin/sponsors/${SAMPLE_ID}/home-link`,
      `/api/v2/events/${SAMPLE_ID}/shared-report`,
      '/api/v2/events/shared-reports/batch',
      `/api/v2/events/${SAMPLE_ID}/forms/register`,
    ]) {
      expect(SWEEP.paths, p).toContain(p);
    }
  });

  test('the environment has secrets to look for, found by name', () => {
    const names = SECRET_PROBES.map((p) => p.name);
    for (const binding of [
      'ADMIN_KEY',
      'X_OCR_INTERNAL',
      'SHARED_REPORT_SIGNING_SECRET',
      'WKRP_SERVICE_TOKEN',
      'OSE_INTERNAL_BATCH_TOKEN',
      'FORMS_HASH_PEPPER',
      'ANON_ID_HASH_PEPPER',
      'FORMS_ENCRYPTION_KEY',
      'GOOGLE_MAPS_API_KEY',
    ]) {
      expect(names, binding).toContain(`secret binding ${binding}`);
    }
    expect(names.some((n) => n.startsWith('secret binding ALLOW_'))).toBe(false);
  });

  test('the test environment allowlists an admin email to sign in as', () => {
    expect(ADMIN_EMAIL).toMatch(/@/);
  });
});

describe('a planted echo turns the sweep red (the gate can fail)', () => {
  test('GET /health echoing the Authorization header and the CI header is caught', async () => {
    fault.echo = true;
    const planted = await sweep(() => REFUSED, sweepEnv(), ALL_PROBES, ['/health']);
    expect(planted.failures).toContain('GET /health -> 200: Authorization bearer sent in body');
    expect(planted.failures).toContain('GET /health -> 200: X-OCR-Internal sent in header x-seen');
  });

  test('the same route echoing the real admin key is caught by the binding name', async () => {
    fault.echo = true;
    const planted = await sweep(automationKey, sweepEnv(), ALL_PROBES, ['/health']);
    expect(planted.failures).toContain('GET /health -> 200: secret binding ADMIN_KEY in body');
    expect(planted.failures).toContain(
      'GET /health -> 200: secret binding X_OCR_INTERNAL in header x-seen'
    );
    expect(planted.failures.join('\n')).not.toContain(E.ADMIN_KEY);
  });

  test('with the fault off, the same requests are clean', async () => {
    const off = await sweep(() => REFUSED, sweepEnv(), ALL_PROBES, ['/health']);
    expect(off.failures).toEqual([]);
  });
});

// ── The sweeps ───────────────────────────────────────────────────────────────

const SWEEP_TIMEOUT_MS = 300_000;

describe('no answer and no log line carries a credential', () => {
  test('the Worker wraps the console itself (redaction is on by default)', async () => {
    // A console the Worker has never seen, with bare collectors for levels.
    const fresh = Object.create(realConsole) as Console;
    const seen: string[] = [];
    for (const level of LEVELS) {
      Object.defineProperty(fresh, level, {
        value: (...args: unknown[]) => void seen.push(args.map(asText).join(' ')),
        writable: true,
        configurable: true,
      });
    }
    globalThis.console = fresh;
    try {
      expect(isLogRedactionInstalled()).toBe(false);
      await send('GET', '/health', {}, sweepEnv());
      // Nothing in this file installs redaction: the Worker's entry did.
      expect(isLogRedactionInstalled()).toBe(true);
    } finally {
      globalThis.console = collectorConsole;
    }
  });

  test('a JWT the request never sent is masked in the line too (the wrapper, not the by-value removal)', async () => {
    const stray = jwtFor('someone-else@example.test', 'made-up-signature-of-a-stray-token');
    const strayLink = `${b64url({ event_id: 'other', role: 'bar', exp: 4102444800 })}.${'9d'.repeat(32)}`;
    fault.atRouter = () =>
      new Error(`session ${stray} and link ${strayLink} were refused upstream`);
    logLines = [];
    const r = await send('GET', '/health', {}, sweepEnv());
    expect(r.status).toBe(500);
    const line = logLines.find((l) => l.includes('UNHANDLED_ERROR'));
    expect(line).toBeDefined();
    expect(line).toContain('[redacted]');
    expect(line).toContain('were refused upstream');
    const probes = [
      ...jwtProbes('a stray JWT', stray),
      { name: 'a stray signed link', value: strayLink },
    ];
    expect(findLeaks({ headers: [], body: line! }, probes, null)).toEqual([]);
    expect(findLeaks(r.answer, probes, null)).toEqual([]);
  });

  test(
    'sweep 1: refused credentials in every credential header',
    async () => {
      await seed();
      const r = await sweep(() => REFUSED, sweepEnv(), ALL_PROBES);
      expect(r.failures).toEqual([]);
      expect(r.requests).toBe(PATHS.length * (METHODS.length + 1));
      // Refusals were really reached, and so were answers that are not refusals.
      expect([...r.statusClasses]).toEqual(expect.arrayContaining([2, 4]));
      // The public call that carries the maps key upstream was made, failed, and
      // its log line was read (the stubbed fetch names the address it failed on).
      expect([...r.logTypes]).toContain('MAPS_FETCH_ERROR');
    },
    SWEEP_TIMEOUT_MS
  );

  test(
    'sweep 1b: refused keys alone (bearer, CI header, service-token secret; no JWT)',
    async () => {
      await seed();
      const r = await sweep(() => REFUSED_KEYS_ONLY, sweepEnv(), ALL_PROBES);
      expect(r.failures).toEqual([]);
      // The key methods' own refusal was reached: an admin route answered 401.
      const admin = await send('GET', '/api/v2/admin/events', REFUSED_KEYS_ONLY, sweepEnv());
      expect(admin.status).toBe(401);
    },
    SWEEP_TIMEOUT_MS
  );

  test(
    'sweep 1c: refused cookies alone (an Access cookie, a session cookie, the anonymous cookie)',
    async () => {
      await seed();
      const r = await sweep(() => REFUSED_COOKIE_ONLY, sweepEnv(), ALL_PROBES);
      expect(r.failures).toEqual([]);
      expect([...r.statusClasses]).toEqual(expect.arrayContaining([2, 4]));
    },
    SWEEP_TIMEOUT_MS
  );

  test(
    'sweep 2: the automation key (admin key and CI header accepted)',
    async () => {
      await seed();
      const r = await sweep(automationKey, sweepEnv(), ALL_PROBES);
      expect(r.failures).toEqual([]);
      expect([...r.statusClasses]).toEqual(expect.arrayContaining([2, 4, 5]));
      // The admin call that carries the maps key upstream was made, failed, and
      // its log line was read (the stubbed fetch names the address it failed on).
      expect([...r.logTypes]).toContain('GEO_FETCH_ERROR');
    },
    SWEEP_TIMEOUT_MS
  );

  test(
    'sweep 3: a signed-in admin (an Access JWT for an allowlisted email)',
    async () => {
      await seed();
      const r = await sweep(signedIn, sweepEnv(), [...ALL_PROBES, ...SIGNED_IN_PROBES]);
      expect(r.failures).toEqual([]);
      expect([...r.statusClasses]).toEqual(expect.arrayContaining([2, 4]));
    },
    SWEEP_TIMEOUT_MS
  );

  test(
    'sweep 4: a database that fails and quotes the credentials (5xx answers)',
    async () => {
      const quoted = [E.ADMIN_KEY, E.X_OCR_INTERNAL, SENT.clientSecret, SENT.cookieJwt].join(' ');
      const db = failingDatabase(quoted);
      const r = await sweep(automationKey, sweepEnv({ DB: db, FORMS_DB: db }), ALL_PROBES);
      expect(r.failures).toEqual([]);
      expect([...r.statusClasses]).toContain(5);
    },
    SWEEP_TIMEOUT_MS
  );

  test(
    'sweep 5: a failure before the router that repeats what was sent (the 500)',
    async () => {
      // Not a database error: its text is logged after the URL and the
      // credential headers are taken out (lib/unhandled-error-log.ts).
      const sample = PATHS.filter((_, i) => i % 9 === 0);
      for (const [name, headers, extra] of [
        ['refused', () => REFUSED, []],
        ['automation key', automationKey, []],
        ['signed in', signedIn, SIGNED_IN_PROBES],
      ] as const) {
        fault.atRouter = () => {
          // The bare values, with nothing to say what they are: no header name
          // beside them and no `Bearer` before the key. A pattern cannot know
          // the admin key or the CI header value; only removing what this
          // request carried, by value, keeps them out of the line.
          const h = fault.lastRequest!.headers;
          const said = [
            (h.get('Authorization') ?? '').replace(/^Bearer\s+/i, ''),
            h.get('X-OCR-Internal') ?? '',
            h.get('Cf-Access-Jwt-Assertion') ?? '',
            h.get('CF-Access-Client-Secret') ?? '',
            ...(h.get('Cookie') ?? '').split(';').map((pair) => pair.slice(pair.indexOf('=') + 1)),
          ];
          return new Error(`upstream refused the call and said: ${said.join(' | ')}`);
        };
        const r = await sweep(headers, sweepEnv(), [...ALL_PROBES, ...extra], sample);
        expect(r.failures, name).toEqual([]);
        expect([...r.statusClasses], name).toEqual([5]);
        // The failure was logged, so the log was really read.
        expect(
          logLines.some((l) => l.includes('UNHANDLED_ERROR')),
          name
        ).toBe(true);
      }
    },
    SWEEP_TIMEOUT_MS
  );
});

// ── Each signed-link product is seen where the table says ────────────────────

describe('signed links are where their route is classified to put them', () => {
  const LINK = /eyJ[A-Za-z0-9_-]{8,}\.[0-9a-f]{64}/;

  beforeAll(seed);

  test('every product has a reason', () => {
    for (const p of SIGNED_LINK_PRODUCTS) expect(p.why.length, String(p.path)).toBeGreaterThan(40);
  });

  test('POST mint-link answers with the report link under "token"', async () => {
    const path = `/api/v2/admin/events/${SAMPLE_ID}/shared-report/mint-link`;
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`${HOST}${path}`, {
        method: 'POST',
        headers: { ...automationKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'sponsor', sponsor_id: SAMPLE_ID }),
      }),
      sweepEnv(),
      ctx
    );
    await waitOnExecutionContext(ctx);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect((JSON.parse(body) as { token: string }).token).toMatch(LINK);
    const answer = { headers: [...res.headers.entries()], body };
    expect(findLeaks(answer, ALL_PROBES, signedLinkRuleFor('POST', path))).toEqual([]);
    // Without its classification the same answer fails: the rule is what allows it.
    expect(findLeaks(answer, ALL_PROBES, null)).toHaveLength(1);
  });

  test('POST home-link answers with the sponsor link under "url"', async () => {
    const path = `/api/v2/admin/sponsors/${SAMPLE_ID}/home-link`;
    const r = await send('POST', path, automationKey(), sweepEnv());
    expect(r.status).toBe(200);
    expect((JSON.parse(r.answer.body) as { url: string }).url).toMatch(LINK);
    expect(findLeaks(r.answer, ALL_PROBES, signedLinkRuleFor('POST', path))).toEqual([]);
    expect(findLeaks(r.answer, ALL_PROBES, null)).toHaveLength(1);
  });

  test("GET /sponsor links to the sponsor's reports and never repeats the link it was opened with", async () => {
    const opened = (await mintSponsorHomeToken(E, SAMPLE_ID, BRAND))!.token;
    const r = await send('GET', `/sponsor?t=${encodeURIComponent(opened)}`, {}, sweepEnv());
    expect(r.status).toBe(200);
    expect(r.answer.body).toMatch(/\/sharedReport\?eventId=/);
    const probes = [
      ...ALL_PROBES,
      { name: 'the sponsor link the page was opened with', value: opened },
    ];
    expect(findLeaks(r.answer, probes, signedLinkRuleFor('GET', '/sponsor'))).toEqual([]);
    expect(findLeaks(r.answer, probes, null)).toHaveLength(1);
  });

  test('GET sponsor-bundle carries a beacon token under "beacon_token" only', async () => {
    const path = `/api/v2/events/${SAMPLE_ID}/sponsor-bundle`;
    const r = await send('GET', `${path}?surface=display`, {}, sweepEnv());
    expect(r.status).toBe(200);
    expect(r.answer.body).toMatch(LINK);
    expect(findLeaks(r.answer, ALL_PROBES, signedLinkRuleFor('GET', path))).toEqual([]);
    expect(findLeaks(r.answer, ALL_PROBES, null)).toHaveLength(1);
  });

  test('a refused SharedReport read does not repeat the token it refused', async () => {
    const refused = `${b64url({ event_id: SAMPLE_ID, role: 'sponsor', exp: 1 })}.${'0f'.repeat(32)}`;
    const path = `/api/v2/events/${SAMPLE_ID}/shared-report`;
    const r = await send('GET', path, { Authorization: `Bearer ${refused}` }, sweepEnv());
    expect(r.status).toBe(401);
    const probes = [{ name: 'the refused report token', value: refused }];
    expect(findLeaks(r.answer, probes, signedLinkRuleFor('GET', path))).toEqual([]);
  });
});
