/**
 * The admin page as the Worker renders it (handleAdminPage), for component
 * specs that drive one part of it in a real browser with no server and no
 * staging. Bundled by esbuild (wrangler's own bundler) the same way
 * render-landing-map.ts bundles the landing.
 */
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WORKER_DIR = resolve(__dirname, '../../../workers/oursharedevents');

interface Bundle {
  handleAdminPage: (env: unknown) => Response;
  serveCss: () => Response;
}

let loaded: Promise<Bundle> | null = null;

function load(): Promise<Bundle> {
  loaded ??= (async () => {
    const req = createRequire(join(WORKER_DIR, 'package.json'));
    const esbuild = req('esbuild') as { build: (options: object) => Promise<unknown> };
    const outfile = join(mkdtempSync(join(tmpdir(), 'ose-component-')), 'admin.cjs');
    await esbuild.build({
      stdin: {
        contents:
          "export { handleAdminPage } from './src/handlers/pages.ts';\n" +
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

/** The admin page's HTML, its Content-Security-Policy header, and the /ui.css it links. */
export async function renderAdmin(): Promise<{ html: string; csp: string; css: string }> {
  const b = await load();
  const res = b.handleAdminPage({});
  return {
    html: await res.text(),
    csp: res.headers.get('Content-Security-Policy') ?? '',
    css: await b.serveCss().text(),
  };
}
