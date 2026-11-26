// Every lazy-loaded <img> in the worker's pages carries width and height
// attributes, so the browser reserves its box before the image arrives and
// the page does not jump when it loads (Lighthouse "unsized-images", CLS).
// Owner report 2026-11-26: the audit flagged two images on the check-in page.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../workers/oursharedevents/src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|html)$/.test(name) ? [p] : [];
  });
}

// An <img ...> tag as written in a template, a TS template literal or a JS
// string built with '+': take the text from "<img" to the first closing ">".
function lazyImgTags(src: string): string[] {
  const tags: string[] = [];
  const re = /<img\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = src.indexOf('>', m.index);
    const tag = src.slice(m.index, end + 1);
    if (/loading=\\?["']lazy/.test(tag)) tags.push(tag);
  }
  return tags;
}

// Images sized by their own CSS box (fixed width and height in the page's
// style), which Lighthouse also counts as sized. Listed by test id.
const SIZED_BY_CSS = new Set(['display-upcoming-thumb']);

describe('lazy-loaded images have explicit dimensions', () => {
  it('finds lazy images to check (the scan is not empty)', () => {
    const all = files(ROOT).flatMap((f) => lazyImgTags(readFileSync(f, 'utf8')));
    expect(all.length).toBeGreaterThan(5);
  });

  it('every lazy <img> has width and height attributes', () => {
    const missing: string[] = [];
    for (const f of files(ROOT)) {
      for (const tag of lazyImgTags(readFileSync(f, 'utf8'))) {
        const testId = (tag.match(/data-testid=\\?["']([\w-]+)/) || [])[1];
        if (testId && SIZED_BY_CSS.has(testId)) continue;
        if (!/\bwidth=/.test(tag) || !/\bheight=/.test(tag)) {
          missing.push(`${f.replace(ROOT + '/', '')}: ${tag.slice(0, 120)}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
