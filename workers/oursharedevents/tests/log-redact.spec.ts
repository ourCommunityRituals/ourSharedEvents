/**
 * Log redaction: what the console wrapper masks, and what it leaves alone.
 *
 * `installLogRedaction()` (src/lib/log-redact.ts) wraps the six console levels
 * so every argument is redacted before it is written. The Worker installs it on
 * its own console (src/index.ts); tests/credential-echo.derived.spec.ts shows
 * that through real requests. This spec is the unit side: a console of
 * collectors is wrapped here, things are logged to it, and the lines are read.
 *
 * Every credential used is made up in this file.
 *
 * Level: W (workers pool, for the runtime's own Request, Headers and Response).
 * No staging layer: Workers Logs cannot be read from a test.
 *
 * @born-red masking | method: two faults in src/lib/log-redact.ts, one at a
 *   time. (1) redact() made to return what it is given: 7 of the 20 cases then written
 *   failed, each on a made-up credential in a line (the cases that call
 *   redactText() directly do not pass through redact()). (2) redactText() made
 *   to mask every line: 15 of those 20 failed, the "left as it came" cases among
 *   them. Between them 16 cases went red. The 4 that neither fault touches
 *   check other things: that redact() does not change its input, that plain
 *   values pass through, that a console never wrapped says so, and the header
 *   list | date: 2026-11-18
 * @born-red the cases added with the vote pass | method: five faults in
 *   src/lib/log-redact.ts, one at a time. A name ending in cookie no longer a
 *   credential key: 4 cases failed. The cookie pattern taken out of the text
 *   rule: 2 failed. A masked piece ending a header value again: "a header value
 *   with a piece already masked" failed. The `eyJ…` rule taken out: 4 failed,
 *   "a vote pass is masked" among them. The cookie header put back on the list
 *   of headers read off a request: "the list … has no cookie header in it"
 *   failed | date: 2026-11-18
 */

import { describe, test, expect } from 'vitest';
import {
  CREDENTIAL_HEADERS,
  REDACTED,
  installLogRedaction,
  isCredentialKey,
  isLogRedactionInstalled,
  redact,
  redactText,
} from '../src/lib/log-redact';

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const JWT = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ email: 'a@example.test', exp: 4102444800 })}.made-up-signature-for-the-redaction-spec`;
const SIGNED_LINK = `${b64url({ event_id: 'e1', role: 'sponsor', exp: 4102444800 })}.${'5a'.repeat(32)}`;
const KEY = 'made-up-admin-key-for-the-redaction-spec';
const OCR = 'made-up-ci-header-for-the-redaction-spec';
const SECRET = 'made-up-client-secret-for-the-redaction-spec';
const COOKIE = `CF_Authorization=${JWT}; CF_AppSession=made-up-session-for-the-redaction-spec`;
const EVERY_VALUE = [JWT, SIGNED_LINK, KEY, OCR, SECRET, 'made-up-session-for-the-redaction-spec'];

function request(): Request {
  return new Request(`https://t.test/api/v2/admin/events?t=${SIGNED_LINK}&page=2`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'X-OCR-Internal': OCR,
      'Cf-Access-Jwt-Assertion': JWT,
      'CF-Access-Client-Id': 'lr-client.access',
      'CF-Access-Client-Secret': SECRET,
      Cookie: COOKIE,
      'Content-Type': 'application/json',
      'Accept-Language': 'es',
    },
  });
}

type Level = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace';
const LEVELS: readonly Level[] = ['log', 'info', 'warn', 'error', 'debug', 'trace'];

/** A console of collectors, wrapped. `lines` is what would be written. */
function wrappedConsole(): { c: Record<Level, (...a: unknown[]) => void>; lines: string[] } {
  const lines: string[] = [];
  const c = {} as Record<Level, (...a: unknown[]) => void>;
  for (const level of LEVELS) {
    c[level] = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
  }
  installLogRedaction(c);
  return { c, lines };
}

function expectClean(text: string): void {
  for (const value of EVERY_VALUE)
    expect(text.includes(value), 'a credential is in the line').toBe(false);
}

describe('a request object logged through the wrapper', () => {
  test('every level masks every credential header and keeps the rest', () => {
    for (const level of LEVELS) {
      const { c, lines } = wrappedConsole();
      c[level]('request failed', request());
      expect(lines).toHaveLength(1);
      expectClean(lines[0]);
      const logged = JSON.parse(lines[0].slice('request failed '.length)) as {
        method: string;
        path: string;
        headers: Record<string, string>;
      };
      expect(logged.method).toBe('POST');
      // The path only: the query string carried a signed link.
      expect(logged.path).toBe('/api/v2/admin/events');
      for (const name of [
        'authorization',
        'x-ocr-internal',
        'cf-access-jwt-assertion',
        'cf-access-client-secret',
        'cookie',
      ]) {
        expect(logged.headers[name], name).toBe(REDACTED);
      }
      expect(logged.headers['content-type']).toBe('application/json');
      expect(logged.headers['accept-language']).toBe('es');
      expect(logged.headers['cf-access-client-id']).toBe('lr-client.access');
    }
  });

  test('the headers alone, and an object that holds them, are masked the same way', () => {
    const { c, lines } = wrappedConsole();
    c.log(request().headers);
    c.warn({
      type: 'DEBUG',
      req: { headers: Object.fromEntries(request().headers) },
      list: [request()],
    });
    expect(lines).toHaveLength(2);
    lines.forEach(expectClean);
    expect(lines[1]).toContain('"type":"DEBUG"');
  });

  test('a header name is matched whatever its case or separator', () => {
    const out = redact({
      Authorization: `Bearer ${KEY}`,
      'X-OCR-INTERNAL': OCR,
      cf_access_jwt_assertion: JWT,
      CfAccessClientSecret: SECRET,
      'Set-Cookie': COOKIE,
      note: 'kept',
    }) as Record<string, string>;
    expect(Object.values(out).filter((v) => v === REDACTED)).toHaveLength(5);
    expect(out.note).toBe('kept');
  });

  test('a response, a URL, a Map and an error are covered too', () => {
    const res = new Response('x', {
      status: 401,
      headers: { 'Set-Cookie': COOKIE, 'X-Request-Id': 'r1' },
    });
    const text = JSON.stringify(
      redact([
        res,
        new URL(`https://t.test/sponsor?t=${SIGNED_LINK}`),
        new Map([['authorization', `Bearer ${KEY}`]]),
        new Error(`refused ${JWT}`),
      ])
    );
    expectClean(text);
    expect(text).toContain('"status":401');
    expect(text).toContain('/sponsor');
    expect(text).toContain('refused [redacted]');
  });

  test('redact() does not change what it is given', () => {
    const headers = { authorization: `Bearer ${KEY}` };
    const original = { headers, n: 1 };
    redact(original);
    expect(original.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  test('a loop in the object, or great depth, ends instead of throwing', () => {
    const a: Record<string, unknown> = { authorization: KEY };
    a.self = a;
    expect(JSON.stringify(redact(a))).toContain('[circular]');
    let deep: Record<string, unknown> = { cookie: COOKIE };
    for (let i = 0; i < 20; i++) deep = { deep };
    expectClean(JSON.stringify(redact(deep)));
  });
});

describe('text logged through the wrapper', () => {
  test('a JSON line that carries a header pair stays JSON, with the value masked', () => {
    const { c, lines } = wrappedConsole();
    c.error(
      JSON.stringify({
        type: 'UPSTREAM',
        headers: { authorization: `Bearer ${KEY}`, cookie: COOKIE, 'x-ocr-internal': OCR },
        count: 3,
      })
    );
    expectClean(lines[0]);
    const parsed = JSON.parse(lines[0]) as {
      type: string;
      count: number;
      headers: Record<string, string>;
    };
    expect(parsed.type).toBe('UPSTREAM');
    expect(parsed.count).toBe(3);
    expect(parsed.headers.authorization).toBe(REDACTED);
  });

  test('a bare value under a quoted header key is masked as a string, so the line stays JSON', () => {
    const out = redactText('{"type":"X","authorization":null,"my-session-cookie":12345678,"n":1}');
    expect(JSON.parse(out)).toEqual({
      type: 'X',
      authorization: REDACTED,
      'my-session-cookie': REDACTED,
      n: 1,
    });
  });

  test('a header pair inside a JSON string value is masked up to the end of that string', () => {
    const line = JSON.stringify({
      type: 'X',
      error: `sent authorization=Bearer ${KEY} and failed`,
      after: 'kept',
    });
    const out = redactText(line);
    expectClean(out);
    expect((JSON.parse(out) as { after: string }).after).toBe('kept');
  });

  test('a header value with a piece already masked is masked to its end', () => {
    // The unhandled-error line removes some values first; what follows one of
    // them inside the same header value must not be left behind.
    const out = redactText(
      JSON.stringify({ error: `said cookie: a=${REDACTED}; b=made-up-session-value`, n: 1 })
    );
    expect(JSON.parse(out)).toEqual({ error: `said cookie: ${REDACTED}`, n: 1 });
  });

  test('a JWT is masked wherever it is, with no header name beside it', () => {
    const out = redactText(`token ${JWT} was refused`);
    expect(out).toBe(`token ${REDACTED} was refused`);
  });

  test("this Worker's own signed links are masked too", () => {
    const out = redactText(`/sharedReport?eventId=e1&token=${SIGNED_LINK}`);
    expectClean(out);
    expect(out).toContain('/sharedReport?eventId=e1&token=');
  });

  test('a vote pass is masked: its body and its seal, wherever it is written', () => {
    // src/lib/vote-pass.ts: `vp1.` + base64url(JSON) + `.` + base64url(HMAC).
    const body = b64url({ e: 'e1', x: 4102444800, p: 'ab12', k: '5a'.repeat(32) });
    const seal = 'made-up-seal-of-43-characters-for-this-spec';
    const out = redactText(`redirect to /events/e1/vote#t=vp1.${body}.${seal} failed`);
    expect(out).toBe(`redirect to /events/e1/vote#t=vp1.${REDACTED} failed`);
  });

  test('a bearer value is masked without its header name', () => {
    expect(redactText(`upstream said: Bearer ${KEY}`)).toBe(`upstream said: Bearer ${REDACTED}`);
  });

  test('header lines as a raw dump are masked line by line', () => {
    const dump = [
      `Authorization: Bearer ${KEY}`,
      `Cookie: ${COOKIE}`,
      `X-OCR-Internal: ${OCR}`,
      'Accept: */*',
    ].join('\n');
    const out = redactText(dump);
    expectClean(out);
    expect(out).toContain('Accept: */*');
  });
});

describe('what is left as it came', () => {
  test('an ordinary structured line is returned unchanged, the same string', () => {
    const line = JSON.stringify({
      type: 'OPERATION_COST',
      op: 'GET /events/:x',
      wallMs: 12,
      status: 200,
    });
    expect(redactText(line)).toBe(line);
    const { c, lines } = wrappedConsole();
    c.log(line);
    expect(lines).toEqual([line]);
  });

  test('numbers, booleans, null and undefined pass through', () => {
    expect(redact(5)).toBe(5);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });

  test('an error that says nothing secret is logged as the error it is', () => {
    const err = new TypeError('boom');
    expect(redact(err)).toBe(err);
  });

  test('a word that only contains a header name is not a pair', () => {
    const line =
      '{"type":"COOKIE_BANNER_OFF","unauthorization":"n/a","note":"cookies are not used"}';
    expect(redactText(line)).toBe(line);
  });

  test('a limit, stated: a bare secret with no shape and no header name is not recognised', () => {
    // The source gate and the route sweep are what keep these out of a line.
    expect(redactText(`key is ${KEY}`)).toBe(`key is ${KEY}`);
  });
});

describe('installing', () => {
  test('a second install on the same console does not wrap it twice', () => {
    const { c, lines } = wrappedConsole();
    const once = c.log;
    installLogRedaction(c);
    expect(c.log).toBe(once);
    expect(isLogRedactionInstalled(c)).toBe(true);
    c.log(`Bearer ${KEY}`);
    expect(lines).toEqual([`Bearer ${REDACTED}`]);
  });

  test('a console that was never wrapped says so, and a missing level is skipped', () => {
    const bare = { log: () => {} };
    expect(isLogRedactionInstalled(bare)).toBe(false);
    installLogRedaction(bare);
    expect(isLogRedactionInstalled(bare)).toBe(true);
  });

  test('any header whose name ends in cookie is a credential key', () => {
    for (const name of ['Cookie', 'Set-Cookie', 'set_cookie', 'X-Legacy-Cookie']) {
      expect(redact({ [name]: COOKIE }), name).toEqual({ [name]: REDACTED });
    }
    expect(redact({ 'Cookie-Policy': 'none' })).toEqual({ 'Cookie-Policy': 'none' });
  });

  test('every header the ticket lists is a credential key', () => {
    for (const name of [
      'Authorization',
      'Cookie',
      'Cf-Access-Jwt-Assertion',
      'CF-Access-Client-Secret',
      'X-OCR-Internal',
    ]) {
      expect(isCredentialKey(name), name).toBe(true);
    }
  });

  test('the list of headers read off a request has no cookie header in it', () => {
    // lib/unhandled-error-log.ts reads each header on this list from the failed
    // request. Only three files may read a request's cookie (no new reader,
    // owner 2026-11-18; votes-never-who.invariant.spec.ts). A cookie is masked
    // by its name, above, and is not read.
    expect(CREDENTIAL_HEADERS.filter((h) => /cookie/i.test(h))).toEqual([]);
    for (const name of ['authorization', 'cf-access-jwt-assertion', 'x-ocr-internal']) {
      expect(CREDENTIAL_HEADERS, name).toContain(name);
    }
  });
});
