/**
 * OSE-1760 slice A — golden renders for the language layer.
 *
 * The language layer moves today's English and Spanish strings out of inline
 * ternaries and into a catalog. This slice is behavior-preserving, so the proof
 * is a byte-for-byte comparison: the three phase renderers, in both languages,
 * must produce exactly what they produced before the move.
 *
 * The golden files were taken from the pre-change renderers (the commit that
 * adds this spec carries them, before any source change). They use a .golden.txt
 * extension on purpose: the commit hook runs prettier on staged .html, and a
 * reformatted golden would no longer match the renderer's output.
 *
 * Node-clean render test (same seam as calendar-action.spec.ts): imports the
 * exported renderers and asserts their string output. No cloudflare:test.
 *
 * Born-red: change any one string in the catalog, or the Spanish copy of any
 * label, and the matching golden fails.
 */
import { describe, it, expect } from 'vitest';
import {
  renderPreEventHtml,
  renderEventLiveHtml,
  renderPostEventHtml,
  WHAT_LINK_LABELS,
  type PublicEventRow,
} from '../src/handlers/pages';

const SHARE = 'https://oursharedevents.com/events/evt_golden';
const NONCE = 'goldennonce';
const LANGS = ['en', 'es'] as const;

function row(overrides: Partial<PublicEventRow> = {}): PublicEventRow {
  return {
    id: 'evt_golden',
    brand_id: 'root',
    title: 'Parish Spring Fundraiser',
    slug: 'parish-spring-fundraiser',
    status: 'active',
    description: 'A neighborhood fundraiser.',
    location: 'St. Barnabas Hall',
    start_date: '2026-10-24',
    end_date: '2026-10-24',
    timezone: 'America/Chicago',
    starts_at: '2026-10-24T23:00:00Z',
    what_short: 'Come support the cause.',
    who_host: 'The Parish Council',
    why_purpose: null,
    how_details: null,
    where_address: '123 Main St',
    who_story: null,
    who_image_url: null,
    what_video_url: 'https://example.org/video',
    what_url: null,
    what_url_enabled: 0,
    what_url_type: null,
    lat: 41.7,
    lon: -87.7,
    price_cents: null,
    price_model: null,
    price_note: null,
    ...overrides,
  };
}

const dir = './__golden__/language-layer';

describe('OSE-1760 language layer | golden renders (behavior preserved)', () => {
  for (const lang of LANGS) {
    it(`pre-event page, ${lang}`, async () => {
      const html = renderPreEventHtml(row(), SHARE, undefined, { nonce: NONCE, lang });
      await expect(html).toMatchFileSnapshot(`${dir}/pre.${lang}.golden.txt`);
    });

    it(`pre-event admin draft preview (inert controls), ${lang}`, async () => {
      const html = renderPreEventHtml(row(), SHARE, undefined, {
        nonce: NONCE,
        lang,
        preview: true,
      });
      await expect(html).toMatchFileSnapshot(`${dir}/pre-preview.${lang}.golden.txt`);
    });

    it(`live page, ${lang}`, async () => {
      const html = renderEventLiveHtml(row(), SHARE, undefined, { nonce: NONCE, lang });
      await expect(html).toMatchFileSnapshot(`${dir}/live.${lang}.golden.txt`);
    });

    it(`post-event page, ${lang}`, async () => {
      const html = renderPostEventHtml(row(), SHARE, [], undefined, { nonce: NONCE, lang });
      await expect(html).toMatchFileSnapshot(`${dir}/post.${lang}.golden.txt`);
    });

    it(`every WHAT link label, ${lang}`, async () => {
      const lines: string[] = [];
      for (const type of Object.keys(WHAT_LINK_LABELS)) {
        const html = renderPreEventHtml(
          row({ what_url: 'https://example.org/go', what_url_enabled: 1, what_url_type: type }),
          SHARE,
          undefined,
          { nonce: NONCE, lang }
        );
        const m = html.match(/<a class="ose-what-link"[^>]*>([^<]*)<\/a>/);
        lines.push(`${type}: ${m ? m[1] : '(missing)'}`);
      }
      await expect(lines.join('\n') + '\n').toMatchFileSnapshot(
        `${dir}/what-labels.${lang}.golden.txt`
      );
    });
  }
});
