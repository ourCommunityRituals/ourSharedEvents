/**
 * The voter page as the Worker renders it (OSE-2129), with no Worker and no D1.
 *
 * Bundles `renderVotePage` (workers/oursharedevents/src/lib/vote-page-render.ts)
 * and `serveCss` from @ocr/ui with esbuild, the bundler wrangler itself uses, as
 * render-landing-map.ts does for the landing. Everything is the shipped code:
 * the page, its one script and its CSS. The spec answers the page's two
 * requests (the open-objects read and the vote) itself.
 *
 * Bundled once per Playwright worker into a temp folder; never written into the
 * repository.
 */
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WORKER_DIR = resolve(__dirname, '../../../workers/oursharedevents');

/** Not the production host: ADR-021 keeps it out of test code. */
export const VOTE_ORIGIN = 'https://vote-page.component.test';

export type VoteResult =
  | { outcome: 'winner'; kind: 'object'; label: string }
  | { outcome: 'winner'; kind: 'team'; labels: string[] }
  | { outcome: 'too_close' };

export interface VotePageOptions {
  votingOn?: boolean;
  result?: VoteResult | null;
  /** 'crowd' renders the Online Pick page (OSE ADR-040 decision 13). */
  channel?: 'room' | 'crowd';
  crowdResult?: { outcome: 'winner'; label: string } | { outcome: 'too_close' } | null;
  sponsors?: {
    id: string;
    name: string;
    display_name: string | null;
    website_url: string | null;
    has_logo: boolean;
  }[];
}

interface Bundle {
  renderVotePage: (input: unknown) => string;
  handleAccessPage: () => Response;
  serveCss: () => Response;
}

let loaded: Promise<Bundle> | null = null;

function load(): Promise<Bundle> {
  loaded ??= (async () => {
    const req = createRequire(join(WORKER_DIR, 'package.json'));
    const esbuild = req('esbuild') as { build: (options: object) => Promise<unknown> };
    const outfile = join(mkdtempSync(join(tmpdir(), 'ose-vote-page-')), 'vote-page.cjs');
    await esbuild.build({
      stdin: {
        contents:
          "export { renderVotePage } from './src/lib/vote-page-render.ts';\n" +
          "export { handleAccessPage } from './src/handlers/vote-access.ts';\n" +
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
    return req(outfile) as Bundle;
  })();
  return loaded;
}

/** The voter page's HTML for event `eventId`, as the Worker would send it. */
export async function renderVote(eventId: string, opts: VotePageOptions = {}): Promise<string> {
  const b = await load();
  return b.renderVotePage({
    event: { id: eventId, title: 'Fist of Five at Eagles Hall', slug: 'fist-of-five' },
    when: 'Saturday, June 6 · 8:00 PM',
    sponsors: opts.sponsors ?? [],
    votingOn: opts.votingOn ?? true,
    result: opts.result ?? null,
    channel: opts.channel ?? 'room',
    crowdResult: opts.crowdResult ?? null,
  });
}

/** The Access Pass page (`GET /access`) as the Worker sends it: its HTML and headers. */
export async function renderAccess(): Promise<{ html: string; headers: Record<string, string> }> {
  const b = await load();
  const res = b.handleAccessPage();
  return { html: await res.text(), headers: Object.fromEntries(res.headers.entries()) };
}

export async function voteUiCss(): Promise<string> {
  const b = await load();
  return b.serveCss().text();
}
