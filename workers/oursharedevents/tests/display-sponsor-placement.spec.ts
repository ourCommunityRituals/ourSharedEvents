/**
 * Display sponsor impression `placement` is bound per source array (FE-14).
 *
 * The display page logs a sponsor impression for every tvTop (banner) and
 * tvSide (sidebar) sponsor. Placement used to be derived as
 * `s.tvTop ? 'tvTop' : 'tvSide'`, but the sponsor objects come from the
 * separate `bundle.surface_sponsors.tvTop` / `.tvSide` arrays and carry NO
 * `.tvTop` property — so the ternary was always falsy and EVERY impression
 * logged `placement: 'tvSide'`, collapsing the banner-vs-sidebar analytics
 * split. The fix binds placement inside each array's own loop.
 *
 * @born-red method: the old render carried `s.tvTop ? 'tvTop' : 'tvSide'` and a
 * flattened `[...tvTop, ...tvSide].forEach`; both assertions below fail against it.
 */
import { describe, test, expect } from 'vitest';
import { handleDisplayPage } from '../src/handlers/pages';

function displayHtml(): Promise<string> {
  return handleDisplayPage({} as never).then((r) => r.text());
}

describe('FE-14 — display sponsor impression placement', () => {
  test('placement is not derived from the (always-absent) s.tvTop flag', async () => {
    const html = await displayHtml();
    expect(
      html.includes("s.tvTop ? 'tvTop' : 'tvSide'"),
      'placement must not be derived from s.tvTop — the sponsor objects never carry it'
    ).toBe(false);
    expect(
      html.includes('[...tvTop, ...tvSide].forEach'),
      'the two arrays must not be flattened before logging — placement is lost'
    ).toBe(false);
  });

  test('each source array logs its own placement (tvTop and tvSide both emitted)', async () => {
    const html = await displayHtml();
    expect(html).toContain("tvTop.forEach(s => logImpression(s, 'tvTop'))");
    expect(html).toContain("tvSide.forEach(s => logImpression(s, 'tvSide'))");
  });
});
