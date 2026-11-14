/**
 * Crawl policy — /robots.txt and /sitemap.xml.
 *
 * WHAT A CRAWLER MAY FETCH is a data question here, not just an SEO one:
 *
 *   - `/q/<token>` records an anonymous scan row and `/s/<code>` bumps a
 *     shortlink counter. A bot walking those paths writes fake scans into the
 *     NCR accumulation (Invariant #4) and the SharedReport counts built on it.
 *     They are disallowed for every agent, first.
 *   - `/sponsor?t=`, `/sharedReport` and friends are signed-link surfaces;
 *     admin paths sit behind CF Access. Nothing there belongs in an index.
 *
 * THE SITEMAP IS A DISCOVERY SURFACE, so it answers the same question `/events`
 * does and uses the same predicate as `DataProvider.fetchEvents`: brand 'root',
 * `is_published = 1`, `status = 'active'`. An unpublished event stays reachable
 * by its link (OSE-1245) but is never announced — listing it here would undo
 * the host's choice to stay off the map. It deliberately does NOT go through
 * the DataProvider: its mock fallback would put a fixture id in the sitemap.
 *
 * Only production is indexable. Staging and local dev serve `Disallow: /` so a
 * stg.* copy of the site never competes with the real one. Every URL is built
 * from the request's own origin, never a hardcoded host.
 *
 * `Content-Signal` is Cloudflare's content-signals extension to robots.txt:
 * search yes, answering-with-a-link yes, model training no.
 */

import { HARDENING_HEADERS } from './security-headers.js';
import { listedSql } from './publish-grace';
import { notLinkOnlySql } from './attendance-mode';
import { canonicalOrigin, eventPagePath } from './canonical';

export interface CrawlPolicyEnv {
  DB?: D1Database;
  WORKER_ENV?: string;
}

/** Public, indexable pages. Every entry must be a real route in router.ts. */
export const SITEMAP_STATIC_PATHS: readonly string[] = ['/', '/events', '/privacy'];

/**
 * Never crawled, by any agent. Prefix match per RFC 9309, so `/admin` also
 * covers `/admin/…`, and `/report` also covers `/reports`. A prefix that takes a
 * public page by accident is a bug: tests/crawl-policy.spec.ts matches every real
 * public path against these rules.
 */
export const CRAWL_DISALLOW: readonly string[] = [
  '/q/', // scan ingestion — a fetch IS a write (Invariant #4)
  '/s/', // shortlink resolver — a fetch bumps the click counter
  // Event codes (OSE-1684): lookups, never pages to index; /e/ also counts a share.
  '/e/',
  '/p/',
  '/tv/',
  '/r/',
  '/c/',
  '/api/',
  '/admin',
  '/manage',
  '/dashboard',
  '/create',
  '/briefing',
  '/overview',
  '/summary',
  // The token-gated sponsor home is `/sponsor?t=…`. A bare `/sponsor` prefix would
  // also take `/sponsors/:id` (the public card) and `/sponsor-default-logo.svg`, and
  // a crawler that may not fetch a page cannot read its `noindex`. So: the query
  // form and the bare path, nothing broader. `$` anchors the end (RFC 9309).
  '/sponsor?',
  '/sponsor$',
  '/forms/',
  // An event's form screens (OSE-1684), the same pages as /forms/. Exact names:
  // `$` ends the path and `?` takes the ?deployment= form, so an event whose
  // readable name starts with one (/events/<id>/register-night) stays fetchable.
  '/events/*/register$',
  '/events/*/register?',
  '/events/*/checkin$',
  '/events/*/checkin?',
  '/events/*/survey$',
  '/events/*/survey?',
  '/events/*/updates$',
  '/events/*/updates?',
  // OSE-1850: the same screens under a language prefix (/es/events/<id>/checkin).
  // The leading `*` is the prefix; the same `$` / `?` ends keep readable names.
  '/*/events/*/register$',
  '/*/events/*/register?',
  '/*/events/*/checkin$',
  '/*/events/*/checkin?',
  '/*/events/*/survey$',
  '/*/events/*/survey?',
  '/*/events/*/updates$',
  '/*/events/*/updates?',
  '/sharedReport',
  '/report',
  '/analytics',
  '/insights',
  '/stats',
  '/ui-preview',
];

/** Answer engines that fetch a page to cite it — allowed, same limits as search. */
export const AI_SEARCH_AGENTS: readonly string[] = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Applebot',
];

/** Crawlers (or opt-out tokens) that exist to collect training data — blocked. */
export const AI_TRAINING_AGENTS: readonly string[] = [
  'GPTBot',
  'ClaudeBot',
  'anthropic-ai',
  'Google-Extended',
  'Applebot-Extended',
  'meta-externalagent',
  'Amazonbot',
  'Bytespider',
  'CCBot',
];

const SIGNAL_OPEN = 'Content-Signal: ai-train=no, search=yes, ai-input=yes';
const SIGNAL_CLOSED = 'Content-Signal: ai-train=no, search=no, ai-input=no';
const SITEMAP_MAX_EVENTS = 5000;
/** The public site's brand — the same one `/events` lists (handlePublicPage). */
const SITEMAP_BRAND = 'root';

export function isIndexable(env: CrawlPolicyEnv): boolean {
  return env.WORKER_ENV === 'production';
}

export function buildRobotsTxt(origin: string, indexable: boolean): string {
  if (!indexable) {
    return [
      '# Non-production environment: not for indexing.',
      'User-agent: *',
      'Disallow: /',
      '',
    ].join('\n');
  }
  const disallow = CRAWL_DISALLOW.map((p) => `Disallow: ${p}`);
  // A crawler obeys only the most specific group that names it, so every
  // group repeats the full disallow list rather than inheriting from `*`.
  return [
    '# Search and discovery: allowed',
    'User-agent: *',
    SIGNAL_OPEN,
    ...disallow,
    'Allow: /',
    '',
    '# AI search and answer agents: allowed, same limits',
    ...AI_SEARCH_AGENTS.map((a) => `User-agent: ${a}`),
    SIGNAL_OPEN,
    ...disallow,
    'Allow: /',
    '',
    '# AI training crawlers: blocked',
    ...AI_TRAINING_AGENTS.map((a) => `User-agent: ${a}`),
    SIGNAL_CLOSED,
    'Disallow: /',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

const xmlEscape = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

export function buildSitemapXml(entries: readonly SitemapEntry[]): string {
  const body = entries
    .map(
      (u) =>
        `<url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>\n`;
}

/**
 * Published, active, root-brand events — the `/events` predicate, ids only.
 * An online event is link only (OSE-2012), so it is not in the sitemap either.
 */
async function listSitemapEvents(
  db: D1Database
): Promise<{ id: string; slug: string | null; updated_at: string | null }[]> {
  const { results } = await db
    .prepare(
      `SELECT id, slug, updated_at FROM events
       WHERE is_published = 1 AND brand_id = ? AND status = 'active' AND ${listedSql()}
         AND ${notLinkOnlySql()}
       ORDER BY updated_at DESC
       LIMIT ${SITEMAP_MAX_EVENTS}`
    )
    // Bound, not inlined: the tenant-isolation gate (INV9) requires brand_id = ?.
    .bind(SITEMAP_BRAND)
    .all<{ id: string; slug: string | null; updated_at: string | null }>();
  return results ?? [];
}

function textHeaders(contentType: string, maxAge: number): Headers {
  const h = new Headers({
    'Content-Type': contentType,
    'Cache-Control': `public, max-age=${maxAge}`,
    'X-Content-Type-Options': 'nosniff',
  });
  for (const [k, v] of Object.entries(HARDENING_HEADERS)) h.set(k, v);
  return h;
}

export function handleRobotsTxt(request: Request, env: CrawlPolicyEnv): Response {
  // Production names one host (the zone also routes www.), the same one every
  // page's canonical names, so a crawler on either host is sent to one sitemap.
  const origin = canonicalOrigin(request, env) ?? new URL(request.url).origin;
  return new Response(buildRobotsTxt(origin, isIndexable(env)), {
    status: 200,
    headers: textHeaders('text/plain; charset=utf-8', 86400),
  });
}

export async function handleSitemapXml(request: Request, env: CrawlPolicyEnv): Promise<Response> {
  const origin = canonicalOrigin(request, env) ?? new URL(request.url).origin;
  const entries: SitemapEntry[] = SITEMAP_STATIC_PATHS.map((p) => ({ loc: origin + p }));

  if (isIndexable(env) && env.DB) {
    try {
      for (const e of await listSitemapEvents(env.DB)) {
        const lastmod = e.updated_at?.slice(0, 10);
        entries.push({
          loc: `${origin}${eventPagePath(encodeURIComponent(e.id), e.slug)}`,
          lastmod: lastmod && /^\d{4}-\d{2}-\d{2}$/.test(lastmod) ? lastmod : undefined,
        });
      }
    } catch {
      // A D1 hiccup degrades to the static sitemap; a crawler must never see a 500 here.
    }
  }

  return new Response(buildSitemapXml(entries), {
    status: 200,
    headers: textHeaders('application/xml; charset=utf-8', 3600),
  });
}
