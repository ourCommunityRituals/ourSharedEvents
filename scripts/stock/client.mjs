// Admin API client for the stock build. Talks only to the staging site
// (owner 2026-11-06: one staging site, stg., carries the seed). The admin key and the Access client secret go in request headers and
// nowhere else: never in a log line, never in a thrown message.

export const STOCK_BASE_URL = 'https://stg.oursharedevents.com';

// At most 5 requests per second.
const MIN_GAP_MS = 200;
// Every call has a deadline (CCR 2026-11-07 R-11); an upload of art gets the same.
export const REQUEST_TIMEOUT_MS = 60_000;

// A 502, 503 or 504, or a network error, is tried again (OSE-2082: one 503 from a
// poster create ended the first run after a seven-day outage, run 43533830657).
// Three tries in all, waiting 2 s and then 6 s. Every other answer returns at once:
// a 4xx, a 500, a redirect and a body that is not JSON say something is wrong, and
// a timed-out call already had its 60 s.
export const RETRY_STATUSES = new Set([502, 503, 504]);
export const RETRY_WAITS_MS = [2_000, 6_000];

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The path without its query string: ids only, safe to show in an error.
const bareApiPath = (path) => String(path).split('?')[0];

export function createClient({
  baseUrl,
  adminKey,
  accessClientId,
  accessClientSecret,
  fetch: fetchFn = globalThis.fetch,
  sleep = realSleep,
  now = Date.now,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  if (baseUrl !== STOCK_BASE_URL) {
    throw new Error(`createClient: baseUrl must be ${STOCK_BASE_URL}`);
  }

  let lastAt = null;
  async function pace() {
    if (lastAt !== null) {
      const wait = MIN_GAP_MS - (now() - lastAt);
      if (wait > 0) await sleep(wait);
    }
    lastAt = now();
  }

  const authHeaders = () => ({
    'CF-Access-Client-Id': accessClientId,
    'CF-Access-Client-Secret': accessClientSecret,
    Authorization: `Bearer ${adminKey}`,
  });

  // One try. A thrown error carries `retryable` when the same call may be made again.
  async function once(method, path, { body, headers }) {
    await pace();
    let res;
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      // never follow a redirect: it would carry the Access secret to another host
      res = await fetchFn(`${baseUrl}${path}`, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal,
      });
    } catch {
      const why = signal.aborted ? 'timed out' : 'network error';
      throw Object.assign(new Error(`${method} ${bareApiPath(path)} failed: ${why}`), {
        retryable: !signal.aborted,
      });
    }
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      throw new Error(`${method} ${bareApiPath(path)} failed: redirected (HTTP ${res.status})`);
    }
    if (!res.ok) {
      throw Object.assign(new Error(`${method} ${bareApiPath(path)} failed: ${res.status}`), {
        retryable: RETRY_STATUSES.has(res.status),
      });
    }
    try {
      return await res.json();
    } catch {
      throw new Error(`${method} ${bareApiPath(path)} failed: not JSON`);
    }
  }

  /**
   * A call, tried again on a 502/503/504 or a network error where repeating is safe.
   *
   *   GET, PUT            repeating one changes nothing more: tried again as it is.
   *   POST, idempotent    the caller says the route answers a repeat with the same row.
   *   POST, landed()      a create. A failed create may still have written its row, so
   *                       before the next try `landed()` reads the site. A row it finds
   *                       is the answer and nothing is sent again; null means the row
   *                       is not there, and the create is sent again. If the read
   *                       fails, or cannot tell, the call fails: never a second row.
   *   POST, neither       never tried again.
   *
   * After the last try the error names the method, the path, the last status and
   * the number of tries; nothing else.
   */
  async function request(method, path, { body, headers, idempotent = false, landed } = {}) {
    const repeatable = method === 'GET' || method === 'PUT' || idempotent;
    let tries = 0;
    for (;;) {
      tries += 1;
      let failure;
      try {
        return await once(method, path, { body, headers });
      } catch (err) {
        failure = err;
      }
      const tried = (err) =>
        tries > 1 ? Object.assign(err, { message: `${err.message} (${tries} tries)` }) : err;
      if (!failure.retryable || !(repeatable || landed) || tries > RETRY_WAITS_MS.length) {
        throw tried(failure);
      }
      await sleep(RETRY_WAITS_MS[tries - 1]);
      if (!repeatable) {
        let found;
        try {
          found = await landed();
        } catch (err) {
          // `final`: the read answered, and its answer ends the call (the row is there
          // but cannot be taken over, or more than one row could be it).
          if (err && err.final) throw err;
          throw tried(
            new Error(
              `${failure.message}; not sent again, the read after it failed: ${err.message}`
            )
          );
        }
        if (found !== null && found !== undefined) return found;
      }
    }
  }

  const json = (method, path, payload, opts = {}) =>
    request(method, path, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      ...opts,
    });

  return {
    // opts: { idempotent: true } or { landed: async () => row | null }; see request().
    post: (path, body, opts) => json('POST', path, body, opts),
    put: (path, body) => json('PUT', path, body),
    get: (path) => json('GET', path),
    // multipart: fetch sets the Content-Type and its boundary itself. A POST with
    // no read that could show whether the object landed, so it is never tried again.
    upload(eventId, bytes, contentType) {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: contentType }), 'art');
      return request('POST', `/api/v2/admin/events/${eventId}/uploads`, {
        headers: authHeaders(),
        body: form,
      });
    },
  };
}
