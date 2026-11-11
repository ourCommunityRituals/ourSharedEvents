/**
 * OSE-1761 slice B — the language in the URL path, through the real router.
 *
 *   - /es/events/<id> renders Spanish, with the right lang, canonical, hreflang
 *     links and language switch. An explicit prefix beats Accept-Language; a bare
 *     address still negotiates by header.
 *   - A share link built by a Spanish page keeps the prefix, and /es/e/<code>
 *     lands on the Spanish page and is counted exactly as /e/<code> is.
 *   - Everything else under a prefix, and any prefix that is not a listed
 *     language, gets the ordinary 404: the admin, API, /q, /s and the other
 *     short links cannot be reached through one.
 *   - No response sets a cookie because of language.
 *
 * Born-red: take the prefix block out of the router and every "renders Spanish"
 * test fails; let it match any path and the "ordinary 404" tests fail.
 *
 * OSE-1850 born-red (2026-11-11): with the router's `kind === 'form'` branch
 * taken out, 7 of the form-page cases fail (every screen and language, the
 * event page to form hop, Arabic, HEAD, the write, the archived forward, the
 * staging band). The list-card link and the bare-address header case fail on
 * main's event-list.ts and form-pages.ts instead.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { msg } from '../src/lib/i18n/catalog';
import { injectTestSiteNotice } from '../src/lib/test-site-notice';

const ORIGIN = 'https://t.test';
const KEY = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const JSON_KEY = { ...KEY, 'Content-Type': 'application/json' };
const BROWSER =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const db = () => (env as unknown as TestEnv).DB;

beforeAll(async () => {
  for (const stmt of JSON.parse(
    (env as unknown as TestEnv).TEST_MIGRATION_STATEMENTS
  ) as string[]) {
    try {
      await db().prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
});

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

interface Created {
  id: string;
  slug: string;
  event_code: string | null;
}

/** A live-listed event a week out, with its short code. */
async function publicEvent(title: string): Promise<{ id: string; slug: string; code: string }> {
  const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events`, {
    method: 'POST',
    headers: JSON_KEY,
    body: JSON.stringify({
      title,
      status: 'active',
      is_published: true,
      start_date: day(7),
      end_date: day(8),
    }),
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as Created;
  const links = await SELF.fetch(
    `${ORIGIN}/api/v2/admin/events/${encodeURIComponent(created.id)}/short-links`,
    { method: 'POST', headers: JSON_KEY, body: '{}' }
  );
  const body = (await links.json()) as { code: string };
  return { id: created.id, slug: created.slug, code: body.code };
}

const get = (path: string, headers: Record<string, string> = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, { redirect: 'manual', headers });

const readablePath = (e: { id: string; slug: string }) => `/events/${e.id}/${e.slug}`;

describe('OSE-1761 | the prefix renders the page in that language', () => {
  test('/es/events/<id> is Spanish, with lang, canonical, hreflang and the switch', async () => {
    const e = await publicEvent('Feria de primavera');
    const res = await get(`/es/events/${e.id}/${e.slug}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html lang="es"');
    expect(html).toContain('Compartir este evento');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/es${readablePath(e)}"`);
    expect(html).toContain(`hreflang="en" href="${ORIGIN}${readablePath(e)}"`);
    expect(html).toContain(`hreflang="es" href="${ORIGIN}/es${readablePath(e)}"`);
    expect(html).toContain(`hreflang="x-default" href="${ORIGIN}${readablePath(e)}"`);
    // The switch: a plain link to English, named in Spanish ("Inglés"), in a group named in Spanish.
    expect(html).toContain('aria-label="Idioma"');
    expect(html).toMatch(
      new RegExp(`<a lang="es" hreflang="en"[^>]*href="${readablePath(e)}">Inglés</a>`)
    );
  });

  test('/es/events/<id> without the name is the same Spanish page', async () => {
    const e = await publicEvent('Feria sin nombre');
    const res = await get(`/es/events/${e.id}`);
    expect(res.status).toBe(200);
    expect((await res.text()).includes('<html lang="es"')).toBe(true);
  });

  test('an explicit prefix beats the Accept-Language header', async () => {
    const e = await publicEvent('Prefix beats header');
    const res = await get(`/es${readablePath(e)}`, { 'Accept-Language': 'en-US,en;q=0.9' });
    const html = await res.text();
    expect(html).toContain('<html lang="es"');
    expect(html).toContain('Compartir este evento');
  });

  test('a prefixed address does not vary by header; a bare one does', async () => {
    const e = await publicEvent('Vary check');
    const prefixed = await get(`/es${readablePath(e)}`);
    expect(prefixed.headers.get('Vary')).toBeNull();
    const bare = await get(readablePath(e));
    expect(bare.headers.get('Vary')).toBe('Accept-Language');
    await prefixed.text();
    await bare.text();
  });

  test('a bare address in English offers a plain link to the prefixed page', async () => {
    const e = await publicEvent('Bare English');
    const res = await get(readablePath(e), { 'Accept-Language': 'en' });
    const html = await res.text();
    expect(html).toContain('<html lang="en"');
    expect(html).toContain('Share this event');
    expect(html).toContain('aria-label="Language"');
    expect(html).toMatch(
      new RegExp(`<a lang="es" hreflang="es"[^>]*href="/es${readablePath(e)}">Español</a>`)
    );
    // English canonical is the bare address; the Spanish sibling is named.
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}${readablePath(e)}"`);
    expect(html).toContain(`hreflang="es" href="${ORIGIN}/es${readablePath(e)}"`);
  });

  test('a bare address still negotiates by header, and its canonical names the page it shows', async () => {
    const e = await publicEvent('Bare Spanish header');
    const res = await get(readablePath(e), { 'Accept-Language': 'es-MX,es;q=0.9' });
    const html = await res.text();
    expect(html).toContain('<html lang="es"');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/es${readablePath(e)}"`);
    // The way back to English is a link to the unprefixed address.
    expect(html).toMatch(
      new RegExp(`<a lang="es" hreflang="en"[^>]*href="${readablePath(e)}">Inglés</a>`)
    );
  });

  test('the switch carries the two parameters the page reads, and nothing else', async () => {
    const e = await publicEvent('Switch query');
    const res = await get(
      `${readablePath(e)}?deployment=dep_abc123&type=checkin&utm=x%22%3E%3Cb%3E`
    );
    const html = await res.text();
    expect(html).toContain(`href="/es${readablePath(e)}?type=checkin&amp;deployment=dep_abc123"`);
    // N8 (OSE-1935): the header Language menu carries the same vetted query, on both layouts.
    for (const id of ['language-menu-es', 'site-menu-language-es']) {
      expect(html).toContain(
        `data-testid="${id}" href="/es${readablePath(e)}?type=checkin&amp;deployment=dep_abc123"`
      );
    }
    expect(html).not.toContain('utm=');
  });

  test('a name that is not the event’s own forwards to the right one, keeping the prefix', async () => {
    const e = await publicEvent('Forward keeps prefix');
    const res = await get(`/es/events/${e.id}/not-the-name?deployment=dep_abc123`);
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(`/es${readablePath(e)}?deployment=dep_abc123`);
  });

  test('a HEAD request is answered', async () => {
    const e = await publicEvent('Head request');
    const res = await SELF.fetch(`${ORIGIN}/es${readablePath(e)}`, { method: 'HEAD' });
    expect(res.status).toBe(200);
  });

  test('a draft is the same 404 under a prefix as without one', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v2/admin/events`, {
      method: 'POST',
      headers: JSON_KEY,
      body: JSON.stringify({ title: 'Still a draft' }),
    });
    const draft = (await res.json()) as Created;
    const bare = await get(`/events/${draft.id}`);
    const prefixed = await get(`/es/events/${draft.id}`);
    expect(bare.status).toBe(404);
    expect(prefixed.status).toBe(404);
    await bare.text();
    await prefixed.text();
  });
});

describe('OSE-1761 | a share link keeps the page’s language', () => {
  test('a Spanish page hands out /es/e/<code>; an English page hands out /e/<code>', async () => {
    const e = await publicEvent('Share keeps language');
    const es = await (await get(`/es${readablePath(e)}`)).text();
    const en = await (await get(readablePath(e), { 'Accept-Language': 'en' })).text();
    expect(es).toContain(`data-share-url="${ORIGIN}/es/e/${e.code}"`);
    expect(en).toContain(`data-share-url="${ORIGIN}/e/${e.code}"`);
  });

  test('/es/e/<code> lands on the Spanish page; /e/<code> is unchanged', async () => {
    const e = await publicEvent('Share lands');
    const es = await get(`/es/e/${e.code}`);
    expect(es.status).toBe(302);
    expect(es.headers.get('Location')).toBe(`/es${readablePath(e)}`);
    const en = await get(`/e/${e.code}`);
    expect(en.status).toBe(302);
    expect(en.headers.get('Location')).toBe(readablePath(e));
  });

  test('/es/e/<code> is counted as a share open, exactly as /e/<code> is', async () => {
    const e = await publicEvent('Share counted');
    const opens = async () => {
      const row = await db()
        .prepare(`SELECT COALESCE(SUM(opens), 0) AS n FROM share_opens_daily WHERE event_id = ?`)
        .bind(e.id)
        .first<{ n: number }>();
      return Number(row?.n) || 0;
    };
    const before = await opens();
    await get(`/es/e/${e.code}`, { 'User-Agent': BROWSER });
    expect(await opens()).toBe(before + 1);
    await get(`/e/${e.code}`, { 'User-Agent': BROWSER });
    expect(await opens()).toBe(before + 2);
  });

  test('a wrong code under a prefix is the same 404 as without one', async () => {
    const es = await get('/es/e/ZZZZZZ');
    const en = await get('/e/ZZZZZZ');
    expect(es.status).toBe(en.status);
    expect(es.status).toBe(404);
    await es.text();
    await en.text();
  });
});

describe('OSE-1761 | everything else under a prefix is the ordinary 404', () => {
  test('a prefix that is not a listed language', async () => {
    const e = await publicEvent('Unsupported prefix');
    for (const prefix of ['fr', 'ES', 'Es', 'en', 'es-MX', 'zh-hans', 'espanol', 'xx']) {
      const res = await get(`/${prefix}${readablePath(e)}`);
      expect(res.status, prefix).toBe(404);
      await res.text();
    }
  });

  test('pages that are not on the language layer yet do not exist under a prefix', async () => {
    const e = await publicEvent('Not yet translated');
    const paths = [
      // OSE-1762: `/es/` and `/es/events` are pages now; the landing's other
      // names and the location form are not.
      '/es/home',
      '/es/welcome',
      '/es/landing',
      '/es/about',
      '/es/info',
      '/es/near',
      '/es/events/',
      '/es/display',
      '/es/poster',
      '/es/privacy',
      `/es/events/${e.id}/tv`,
      `/es/events/${e.id}/poster`,
      // OSE-1850: the form screens are pages now (below); a near miss is not.
      `/es/events/${e.id}/Checkin`,
      `/es/events/${e.id}/checkin/`,
      `/es/events/${e.id}/calendar.ics`,
      `/es/forms/${e.id}`,
      `/en/events/${e.id}/checkin`,
      `/es/sponsors/abc`,
      `/es${readablePath(e)}/`,
    ];
    for (const p of paths) {
      const res = await get(p);
      expect(res.status, p).toBe(404);
      await res.text();
    }
  });

  test('admin, API and every short link cannot be reached through a prefix', async () => {
    const e = await publicEvent('No back door');
    const paths = [
      '/es/admin',
      '/es/manage',
      '/es/api/v2/events',
      `/es/api/v2/events/${e.id}`,
      '/es/api/v2/admin/events',
      '/es/health',
      '/es/q/sometoken',
      '/es/s/somecode',
      `/es/p/${e.code}`,
      `/es/r/${e.code}`,
      `/es/c/${e.code}`,
      `/es/tv/${e.code}`,
      '/es/ui.css',
      '/es/robots.txt',
      '/es/sitemap.xml',
    ];
    for (const p of paths) {
      const withKey = await get(p, KEY);
      expect(withKey.status, `${p} (with the admin key)`).toBe(404);
      await withKey.text();
    }
  });

  test('a write is not served under a prefix', async () => {
    const e = await publicEvent('No writes');
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await SELF.fetch(`${ORIGIN}/es${readablePath(e)}`, {
        method,
        headers: JSON_KEY,
        body: method === 'DELETE' ? undefined : '{}',
      });
      expect(res.status, method).toBeGreaterThanOrEqual(400);
      await res.text();
    }
  });
});

describe('OSE-1762 | /es/ and /es/events through the router', () => {
  test('/es/events is the Spanish list: lang, canonical, Spanish card links, no Vary', async () => {
    const e = await publicEvent('Lista en español');
    const res = await get('/es/events', { 'Accept-Language': 'en-US' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Vary')).toBeNull();
    const html = await res.text();
    expect(html).toContain('<html lang="es" dir="ltr">');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/es/events" />`);
    expect(html).toContain('<meta property="og:locale" content="es_US" />');
    expect(html).toContain('Próximos eventos');
    expect(html).toContain(`href="/es${readablePath(e)}"`);
  });

  test('/es/ and /es are the Spanish landing, which may ask for location', async () => {
    for (const path of ['/es/', '/es']) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('Permissions-Policy') ?? '', path).toContain('geolocation=(self)');
      const html = await res.text();
      expect(html, path).toContain('<html lang="es" dir="ltr" data-surface="ose-landing">');
      expect(html, path).toContain('¿Qué pasa cerca de ti?');
      expect(html, path).toContain(`<link rel="canonical" href="${ORIGIN}/es/" />`);
    }
  });

  test('a filter and a zip keep the Spanish address', async () => {
    const list = await (await get('/es/events?when=weekend&q=zz')).text();
    expect(list).toContain('href="/es/events?when=month&amp;q=zz"');
    expect(list).toContain('action="/es/events"');
    const home = await (await get('/es/?zip=60406')).text();
    expect(home).toContain('action="/es/"');
    expect(home).toContain('href="/es/?change=1"');
  });

  test('a bare address negotiates by header and says it varies by it', async () => {
    for (const path of ['/events', '/']) {
      const es = await get(path, { 'Accept-Language': 'es-MX,es;q=0.9' });
      expect(es.headers.get('Vary'), path).toBe('Accept-Language');
      expect(await es.text(), path).toMatch(/<html lang="es"/);
      const en = await get(path);
      expect(await en.text(), path).toMatch(/<html lang="en"/);
    }
  });

  test('a HEAD request is answered', async () => {
    for (const path of ['/es/events', '/es/']) {
      const res = await SELF.fetch(`${ORIGIN}${path}`, { method: 'HEAD' });
      expect(res.status, path).toBe(200);
    }
  });

  test('the location form from the Spanish landing comes back to it', async () => {
    const post = (body: string) =>
      SELF.fetch(`${ORIGIN}/near`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    const es = await post('g=dp3su&lang=es');
    expect(es.status).toBe(303);
    expect(es.headers.get('Location')).toBe('/es/?zip=60469');
    expect(es.headers.get('Set-Cookie')).toBeNull();
    expect((await post('g=u09tv&lang=es')).headers.get('Location')).toBe('/es/?nozip=1');
    // Only a listed language: anything else is the English landing.
    for (const lang of ['en', 'xx', 'ES', 'es-MX', '']) {
      const res = await post(`g=dp3su&lang=${lang}`);
      expect(res.headers.get('Location'), lang).toBe('/?zip=60469');
    }
  });
});

// OSE-1850: the owner's report (2026-11-10), "Does not translate to the selected
// language": a reader who picked a language on the event page and tapped into
// check-in got an English page. The event page's form links had no prefix, and
// no form page existed under one.
describe('OSE-1850 | the form pages under a prefix, through the router', () => {
  const SCREENS = ['register', 'checkin', 'survey', 'updates'] as const;
  const DIR = { es: 'ltr', pl: 'ltr', ar: 'rtl' } as const;

  test('every form screen in every language: 200, lang and dir, the menu, no Vary', async () => {
    const e = await publicEvent('Formularios');
    for (const lang of ['es', 'pl', 'ar'] as const) {
      for (const screen of SCREENS) {
        const path = `/${lang}/events/${e.id}/${screen}`;
        const res = await get(path, { 'Accept-Language': 'en-US' });
        expect(res.status, path).toBe(200);
        expect(res.headers.get('Vary'), path).toBeNull();
        const html = await res.text();
        expect(html, path).toContain(`<html lang="${lang}" dir="${DIR[lang]}">`);
        expect(html, path).toContain('data-testid="language-menu"');
        // The menu leads back to the English form at its bare address.
        expect(html, path).toContain(
          `data-testid="language-menu-en" href="/events/${e.id}/${screen}"`
        );
      }
    }
  });

  test('the Spanish event page links to the Spanish form, and that form is Spanish', async () => {
    const e = await publicEvent('Registro en español');
    const page = await (await get(`/es${readablePath(e)}`)).text();
    const href = page.match(/data-testid="event-rsvp" href="([^"]+)"/)?.[1];
    expect(href).toBe(`/es/events/${e.id}/register`);
    const form = await get(href as string);
    expect(form.status).toBe(200);
    const html = await form.text();
    expect(html).toContain('<html lang="es" dir="ltr">');
    expect(html).toContain('Inscríbete en este evento');
    // The second choice, check-in, keeps the language too.
    expect(page).toContain(`href="/es/events/${e.id}/checkin"`);
  });

  test('the Arabic check-in is right to left, with the Arabic words', async () => {
    const e = await publicEvent('Arabic check-in');
    const html = await (await get(`/ar/events/${e.id}/checkin`)).text();
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('تسجيل الحضور');
    expect(html).toContain(`<bdi>Arabic check-in</bdi>`);
  });

  test('the Spanish list card links to the Spanish form', async () => {
    const e = await publicEvent('Tarjeta con registro');
    const html = await (await get('/es/events')).text();
    expect(html).toContain(`href="/es/events/${e.id}/register"`);
    expect(html).not.toContain(`href="/events/${e.id}/register"`);
  });

  test('a bare form address negotiates by header and says it varies by it', async () => {
    const e = await publicEvent('Bare form');
    const res = await get(`/events/${e.id}/checkin`, { 'Accept-Language': 'pl-PL,pl;q=0.9' });
    expect(res.headers.get('Vary')).toBe('Accept-Language');
    expect(await res.text()).toContain('<html lang="pl" dir="ltr">');
    const en = await get(`/events/${e.id}/checkin`);
    expect(await en.text()).toContain('<html lang="en" dir="ltr">');
  });

  test('a HEAD request is answered', async () => {
    const e = await publicEvent('Head form');
    const res = await SELF.fetch(`${ORIGIN}/es/events/${e.id}/checkin`, { method: 'HEAD' });
    expect(res.status).toBe(200);
  });

  test('a write is not served under a prefix: the form posts to the unprefixed API', async () => {
    const e = await publicEvent('Form write');
    const res = await SELF.fetch(`${ORIGIN}/es/events/${e.id}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(404);
    await res.text();
    const page = await (await get(`/es/events/${e.id}/checkin`)).text();
    expect(page).toContain("fetch('/api/v2/events/' + eventId + '/forms/' + formType");
  });

  test('an archived event forwards to the list in the same language', async () => {
    const e = await publicEvent('Archived form');
    await db().prepare(`UPDATE events SET status = 'archived' WHERE id = ?`).bind(e.id).run();
    const res = await get(`/es/events/${e.id}/register`);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${ORIGIN}/es/events`);
  });

  test('the same cookie answer as the bare form: the language adds none', async () => {
    const e = await publicEvent('Form cookies');
    for (const screen of SCREENS) {
      const bare = await get(`/events/${e.id}/${screen}`);
      const prefixed = await get(`/es/events/${e.id}/${screen}`);
      expect(prefixed.headers.get('Set-Cookie'), screen).toBe(bare.headers.get('Set-Cookie'));
      await bare.text();
      await prefixed.text();
    }
  });

  test('the staging "Testing purposes only." band reads in the form page language', async () => {
    const e = await publicEvent('Staging band');
    for (const [lang, headline] of [
      ['es', 'Solo para pruebas.'],
      ['pl', msg('pl', 'testSite.headline')],
      ['ar', msg('ar', 'testSite.headline')],
    ] as const) {
      const res = injectTestSiteNotice(await get(`/${lang}/events/${e.id}/checkin`), {
        WORKER_ENV: 'staging',
      });
      const html = await res.text();
      expect(html, lang).toContain(`<p><strong>${headline}</strong></p>`);
      expect(html, lang).not.toContain('Testing purposes only.');
    }
  });

  test('the identified side stores no language: no FORMS_DB column names one', () => {
    const stmts: string[] = JSON.parse(
      (env as unknown as { TEST_FORMS_MIGRATION_STATEMENTS: string })
        .TEST_FORMS_MIGRATION_STATEMENTS
    );
    expect(stmts.length).toBeGreaterThan(0);
    for (const s of stmts) expect(s).not.toMatch(/\b(lang|language|locale|accept_language)\b/i);
  });
});

describe('OSE-1761 | no cookie because of language', () => {
  test('no response sets a cookie: prefixed page, bare page, switch target, share redirect', async () => {
    const e = await publicEvent('No cookies');
    const responses = [
      await get(`/es${readablePath(e)}`),
      await get(readablePath(e), { 'Accept-Language': 'es' }),
      await get(readablePath(e), { 'Accept-Language': 'en' }),
      await get(`/es/e/${e.code}`),
      await get('/es/events'),
    ];
    for (const res of responses) {
      expect(res.headers.get('Set-Cookie')).toBeNull();
      await res.text();
    }
  });

  test('the page source reads no cookie to decide a language', async () => {
    const files: Record<string, string> = JSON.parse(
      (env as unknown as { TEST_SOURCE_FILES_JSON: string }).TEST_SOURCE_FILES_JSON
    );
    for (const suffix of [
      'lib/i18n/path-prefix.ts',
      'lib/i18n/language-switch.ts',
      'lib/i18n/resolve-language.ts',
    ]) {
      const key = Object.keys(files).find((k) => k.replace(/\\/g, '/').endsWith(suffix));
      const src = key ? files[key] : '';
      expect(src.length, suffix).toBeGreaterThan(0);
      expect(src, suffix).not.toMatch(/Set-Cookie|document\.cookie|headers\.get\(['"]Cookie/i);
    }
  });
});
