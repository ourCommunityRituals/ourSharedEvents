/**
 * Crawl policy — /robots.txt + /sitemap.xml (lib/crawl-policy).
 *
 *   - robots: scan/shortlink writers (/q/, /s/) and admin/API/signed-link
 *     surfaces are disallowed in EVERY allowed group; training crawlers get
 *     `Disallow: /`; Content-Signal says ai-train=no; non-production is
 *     `Disallow: /` with no sitemap line.
 *   - sitemap: well-formed urlset of real routes; lists published + active +
 *     root-brand events only (the /events predicate) — never unpublished,
 *     draft, archived or other-brand; D1 failure degrades to static, not 500.
 *   - every static sitemap path is a route that actually answers 200.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  buildRobotsTxt,
  handleSitemapXml,
  CRAWL_DISALLOW,
  SITEMAP_STATIC_PATHS,
  AI_TRAINING_AGENTS,
} from '../src/lib/crawl-policy';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

async function seedEvent(id: string, brand: string, status: string, isPublished: number) {
  const db = (env as unknown as TestEnv).DB;
  await db.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
  await db
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                           start_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'Eagles Hall', '2026-12-01', datetime('now'), '2026-09-20 10:00:00')`
    )
    .bind(id, brand, `Crawl ${id}`, id, status, isPublished)
    .run();
}

const ORIGIN = 'https://oursharedevents.com';
const prodEnv = () => ({ DB: (env as unknown as TestEnv).DB, WORKER_ENV: 'production' });

/** Split robots.txt into groups: consecutive User-agent lines + their rules. */
function groups(txt: string): { agents: string[]; rules: string[] }[] {
  const out: { agents: string[]; rules: string[] }[] = [];
  let cur: { agents: string[]; rules: string[] } | null = null;
  for (const raw of txt.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('Sitemap:')) continue;
    if (line.startsWith('User-agent:')) {
      if (!cur || cur.rules.length) out.push((cur = { agents: [], rules: [] }));
      cur.agents.push(line.slice('User-agent:'.length).trim());
    } else if (cur) {
      cur.rules.push(line);
    }
  }
  return out;
}

describe('robots.txt (production)', () => {
  const txt = buildRobotsTxt(ORIGIN, true);
  const gs = groups(txt);

  test('every group that allows crawling also disallows the write/private paths', () => {
    const open = gs.filter((g) => !g.rules.includes('Disallow: /'));
    expect(open.length).toBeGreaterThanOrEqual(2);
    for (const g of open) {
      for (const p of CRAWL_DISALLOW) expect(g.rules).toContain(`Disallow: ${p}`);
      expect(g.rules).toContain('Content-Signal: ai-train=no, search=yes, ai-input=yes');
    }
  });

  test('scan ingestion and shortlinks are never crawlable (a fetch is a write)', () => {
    expect(CRAWL_DISALLOW).toContain('/q/');
    expect(CRAWL_DISALLOW).toContain('/s/');
  });

  test('training crawlers are fully blocked, and no agent is in two groups', () => {
    const closed = gs.find((g) => g.rules.includes('Disallow: /'));
    expect(closed?.agents).toEqual([...AI_TRAINING_AGENTS]);
    expect(closed?.rules).toContain('Content-Signal: ai-train=no, search=no, ai-input=no');
    const all = gs.flatMap((g) => g.agents.map((a) => a.toLowerCase()));
    expect(new Set(all).size).toBe(all.length);
  });

  test('points at the sitemap on its own origin', () => {
    expect(txt).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });
});

describe('robots.txt (served)', () => {
  test('non-production is Disallow: / with no sitemap', async () => {
    const res = await SELF.fetch('https://stg.oursharedevents.com/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(groups(body)).toEqual([{ agents: ['*'], rules: ['Disallow: /'] }]);
    expect(body).not.toContain('Sitemap:');
  });
});

describe('sitemap.xml', () => {
  beforeAll(async () => {
    await applyMigrations();
    await seedEvent('crawl-live', 'root', 'active', 1);
    await seedEvent('crawl-unpublished', 'root', 'active', 0);
    await seedEvent('crawl-draft', 'root', 'draft', 1);
    await seedEvent('crawl-archived', 'root', 'archived', 1);
    await seedEvent('crawl-otherbrand', 'crawl-brand-b', 'active', 1);
  });

  test('lists static pages + published active root events only', async () => {
    const res = await handleSitemapXml(new Request(`${ORIGIN}/sitemap.xml`), prodEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const xml = await res.text();
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    for (const p of SITEMAP_STATIC_PATHS) expect(xml).toContain(`<loc>${ORIGIN}${p}</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/events/crawl-live</loc><lastmod>2026-09-20</lastmod>`);
    for (const hidden of [
      'crawl-unpublished',
      'crawl-draft',
      'crawl-archived',
      'crawl-otherbrand',
    ]) {
      expect(xml).not.toContain(hidden);
    }
  });

  test('non-production lists no events', async () => {
    const res = await SELF.fetch('https://stg.oursharedevents.com/sitemap.xml');
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('crawl-live');
  });

  test('a failing DB degrades to the static sitemap, not a 500', async () => {
    const broken = {
      prepare() {
        throw new Error('D1 down');
      },
    } as unknown as D1Database;
    const res = await handleSitemapXml(new Request(`${ORIGIN}/sitemap.xml`), {
      DB: broken,
      WORKER_ENV: 'production',
    });
    expect(res.status).toBe(200);
    expect((await res.text()).match(/<url>/g)?.length).toBe(SITEMAP_STATIC_PATHS.length);
  });

  test('every static sitemap path is a live route', async () => {
    for (const p of SITEMAP_STATIC_PATHS) {
      const res = await SELF.fetch(`https://oursharedevents.com${p}`, {
        headers: { Accept: 'text/html' },
      });
      expect(res.status, p).toBe(200);
    }
  });
});
