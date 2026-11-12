/**
 * The event page as the Worker renders it, with no Worker and no D1 (OSE-1955).
 *
 * The component layer of the sponsor thumbnails needs the real markup and the
 * real CSS in a real browser, but nothing else. This bundles the page renderer
 * (`renderPreEventHtml` in workers/oursharedevents/src/handlers/pages.ts, which
 * carries SPONSOR_LIST_CSS) and `serveCss` from @ocr/ui (the /ui.css the Worker
 * serves, which holds the colour tokens) with esbuild, the bundler wrangler
 * itself uses, and loads `.html` as text as wrangler.toml's Text rule does.
 * The rows are passed in by the spec, so no database is read.
 *
 * Bundled once per Playwright worker into a temp folder; never written into the
 * repository.
 */
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WORKER_DIR = resolve(__dirname, '../../../workers/oursharedevents');

export interface SponsorRow {
  id: string;
  name: string;
  website_url: string | null;
  display_name?: string | null;
  address_line?: string | null;
  has_logo?: number | null;
}

interface Renderer {
  renderPreEventHtml: (
    row: Record<string, unknown>,
    shareUrl: string,
    social: Record<string, unknown>,
    opts: { nonce: string; lang: string }
  ) => string;
  serveCss: () => Response;
}

let loaded: Promise<Renderer> | null = null;

function load(): Promise<Renderer> {
  loaded ??= (async () => {
    const req = createRequire(join(WORKER_DIR, 'package.json'));
    // wrangler's own bundler; installed with the Worker's dependencies.
    const esbuild = req('esbuild') as { build: (options: object) => Promise<unknown> };
    const outfile = join(mkdtempSync(join(tmpdir(), 'ose-component-')), 'render.cjs');
    await esbuild.build({
      stdin: {
        contents:
          "export { renderPreEventHtml } from './src/handlers/pages.ts';\n" +
          "export { serveCss } from '@ocr/ui';\n",
        resolveDir: WORKER_DIR,
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile,
      loader: { '.html': 'text' },
      logLevel: 'error',
    });
    return req(outfile) as Renderer;
  })();
  return loaded;
}

/** An active event, before it starts, with nothing optional filled in. */
function eventRow(): Record<string, unknown> {
  return {
    id: 'evt_component',
    brand_id: 'root',
    title: 'Block Party',
    slug: 'block-party',
    status: 'active',
    description: null,
    location: 'Hall',
    start_date: '2026-10-24',
    end_date: '2026-10-24',
    timezone: 'America/Chicago',
    starts_at: '2026-10-24T23:00:00Z',
    is_published: 1,
  };
}

/** The whole pre-event page, its sponsor strip holding these rows in order. */
export async function renderEventPage(sponsors: SponsorRow[]): Promise<string> {
  const r = await load();
  return r.renderPreEventHtml(
    eventRow(),
    // Not the production host: ADR-021 keeps it out of test code
    // (tests/integration/production-read-only.test.js).
    'http://sponsor-thumbs.component.test/events/evt_component',
    { sponsors, regCount: 0, checkinCount: 0, surveyCount: 0, emailCount: 0 },
    { nonce: 'component', lang: 'en' }
  );
}

/** The stylesheet the Worker serves at /ui.css (@ocr/ui: tokens and base rules). */
export async function uiCss(): Promise<string> {
  const r = await load();
  return r.serveCss().text();
}
