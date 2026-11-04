// Admin API client for the stock build. Talks only to the owner-only staging
// site. The admin key and the Access client secret go in request headers and
// nowhere else: never in a log line, never in a thrown message.

export const STOCK_BASE_URL = 'https://stg-full.oursharedevents.com';

// At most 5 requests per second.
const MIN_GAP_MS = 200;

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

  async function request(method, path, { body, headers } = {}) {
    await pace();
    let res;
    try {
      res = await fetchFn(`${baseUrl}${path}`, { method, headers, body });
    } catch {
      throw new Error(`${method} ${bareApiPath(path)} failed: network error`);
    }
    if (!res.ok) {
      throw new Error(`${method} ${bareApiPath(path)} failed: ${res.status}`);
    }
    return res.json();
  }

  const json = (method, path, payload) =>
    request(method, path, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });

  return {
    post: (path, body) => json('POST', path, body),
    put: (path, body) => json('PUT', path, body),
    get: (path) => json('GET', path),
    // multipart: fetch sets the Content-Type and its boundary itself
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
