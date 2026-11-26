/**
 * OSE-1952 (feature OSE-1948), reworked for the owner's 2026-11-26 rulings: the
 * event page's "Supported by" is a row of banners, one per sponsor, all equal.
 * Held closely enough that Stryker cannot change the rule unseen.
 *
 * Between the header and "What", each sponsor is one block of the hub's sponsor
 * panel (@ocr/ui `.sponsor-panel-block`) holding one 3:1 banner: the sponsor's
 * configured top-banner art, its wide logo (`has_wide_logo`, the proxy's
 * default slot), else its square logo (`has_logo`, `?slot=sidebar`), else the name
 * set in type. The art is the visual for people who do not read; its alt is
 * the sponsor's name, so the name is always read out. No short text and no
 * location on the event page: they stay on the sponsor's own card.
 * The tap goes to the sponsor's https website (rel noopener noreferrer nofollow)
 * or, with no https website, to the sponsor's own card.
 *
 * The rule is `renderSponsorItem` / `renderSponsorList` in src/handlers/pages.ts,
 * reached here through the exported phase renderers, so the anchor literals stay
 * whole in the source (the click-out invariant, sponsor-signal-never-who, reads
 * them there). Every assertion compares exact markup.
 *
 * Node-clean: no cloudflare:test, no D1.
 */
import { describe, it, expect } from 'vitest';
import {
  renderPreEventHtml,
  renderEventLiveHtml,
  renderPostEventHtml,
  type PublicEventRow,
} from '../src/handlers/pages';

type Social = NonNullable<Parameters<typeof renderPreEventHtml>[2]>;
type Sponsor = Social['sponsors'][number];

const SHARE = 'https://oursharedevents.com/events/evt_thumb';

function row(): PublicEventRow {
  return {
    id: 'evt_thumb',
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
    what_short: null,
    who_host: null,
    why_purpose: null,
    how_details: null,
    where_address: null,
    who_story: null,
    who_image_url: null,
    what_video_url: null,
    what_url: null,
    what_url_enabled: 0,
    what_url_type: null,
    lat: null,
    lon: null,
    price_cents: null,
    price_model: null,
    price_note: null,
    is_published: 1,
    event_type_id: null,
    event_type_name: null,
  } as PublicEventRow;
}

function social(sponsors: Sponsor[]): Social {
  return { sponsors, regCount: 0, checkinCount: 0, surveyCount: 0, emailCount: 0 };
}

/** The rendered <ul> of the pre-event strip, exactly as the page carries it. */
function listOf(sponsors: Sponsor[]): string {
  const html = renderPreEventHtml(row(), SHARE, social(sponsors), { nonce: 'n', lang: 'en' });
  const start = html.indexOf('<ul class="sponsor-panel ose-sponsor-list"');
  expect(start, 'the sponsor list renders').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</ul>', start) + '</ul>'.length);
}

const ITEM_OPEN = '<li class="sponsor-panel-block" data-testid="sponsor-item">';
const LIST_OPEN = '<ul class="sponsor-panel ose-sponsor-list" data-testid="sponsor-list">';
const one = (item: string) => `${LIST_OPEN}${ITEM_OPEN}${item}</li></ul>`;
const nameSpan = (name: string) =>
  `<span class="sponsor-panel-name" data-testid="sponsor-name">${name}</span>`;
const img = (src: string, name: string) =>
  `<img data-testid="sponsor-thumb" src="${src}" alt="${name}" width="600" height="200" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
const frame = (art: string) =>
  `<span class="sponsor-panel-header ose-sponsor-art" data-testid="sponsor-art">${art}</span>`;
/** The banner: the wide logo, else the square logo, else the name, in one 3:1 frame. */
const withHeader = (id: string, name: string) => frame(img(`/api/v2/sponsors/${id}/logo`, name));
const withLogo = (id: string, name: string) =>
  frame(img(`/api/v2/sponsors/${id}/logo?slot=sidebar`, name));
const nameOnly = (name: string) =>
  `<span class="sponsor-panel-header ose-sponsor-art" data-testid="sponsor-art">${nameSpan(name)}</span>`;
const site = (href: string, inner: string) =>
  `<a href="${href}" class="sponsor-panel-main" rel="noopener noreferrer nofollow">${inner}</a>`;
const card = (id: string, inner: string) =>
  `<a href="/sponsors/${id}" class="sponsor-panel-main" data-testid="sponsor-card-link">${inner}</a>`;
function sponsor(over: Partial<Sponsor> = {}): Sponsor {
  return {
    id: 'sp_1',
    name: 'Acme',
    website_url: null,
    display_name: null,
    address_line: null,
    has_logo: 0,
    has_wide_logo: 0,
    ...over,
  };
}

describe('sponsor banner: the art', () => {
  it('sunny: the wide logo (top banner) is the banner, even with a square logo on file', () => {
    expect(
      listOf([sponsor({ has_wide_logo: 1, has_logo: 1, website_url: 'https://acme.example/' })])
    ).toBe(one(site('https://acme.example/', withHeader('sp_1', 'Acme'))));
  });

  it('sunny: a wide logo alone is the banner', () => {
    expect(listOf([sponsor({ has_wide_logo: 1 })])).toBe(
      one(card('sp_1', withHeader('sp_1', 'Acme')))
    );
  });

  it('sunny: no wide logo, a square logo: it sits whole in the 3:1 frame', () => {
    expect(listOf([sponsor({ has_logo: 1, website_url: 'https://acme.example/' })])).toBe(
      one(site('https://acme.example/', withLogo('sp_1', 'Acme')))
    );
  });

  for (const v of [0, null, undefined] as const) {
    it(`rainy: no art at all (has_logo and has_wide_logo ${String(v)}): the name is the art, once`, () => {
      const list = listOf([sponsor({ has_logo: v, has_wide_logo: v })]);
      expect(list).toBe(one(card('sp_1', nameOnly('Acme'))));
      expect(list).not.toContain('sponsor-thumb');
      expect(list).not.toContain('/logo');
      expect(list.match(/data-testid="sponsor-name"/g)).toHaveLength(1);
    });
  }

  it('edge: any truthy flag (SQLite returns 1) is art', () => {
    expect(listOf([sponsor({ has_logo: 1 })])).toBe(one(card('sp_1', withLogo('sp_1', 'Acme'))));
  });

  it('the name is always there: the alt of every image, or the text when there is no art', () => {
    const list = listOf([
      sponsor({ id: 'a', has_wide_logo: 1, has_logo: 1 }),
      sponsor({ id: 'b', has_logo: 1 }),
      sponsor({ id: 'c' }),
    ]);
    expect(list.match(/<img [^>]*alt="Acme"/g)).toHaveLength(2);
    expect(list).not.toContain('alt=""');
    expect(list.match(/data-testid="sponsor-name">Acme</g)).toHaveLength(1);
  });
});

describe('sponsor card: website or card link', () => {
  it('sunny: an https website is the outbound link, with the rel set', () => {
    const list = listOf([sponsor({ website_url: 'https://acme.example/a?b=1&c=2' })]);
    expect(list).toBe(one(site('https://acme.example/a?b=1&amp;c=2', nameOnly('Acme'))));
  });

  for (const [label, url] of [
    ['null', null],
    ['empty', ''],
    ['plain http', 'http://acme.example/'],
    ['javascript:', 'javascript:alert(1)'],
    ['https only in the middle', 'x https://acme.example/'],
    ['ends in https://', 'acme.example/https://'],
  ] as const) {
    it(`rainy: a ${label} website opens the sponsor card, never an outbound link`, () => {
      const list = listOf([sponsor({ website_url: url })]);
      expect(list).toBe(one(card('sp_1', nameOnly('Acme'))));
      expect(list).not.toContain('rel=');
    });
  }

  it('rainy: a card link with art carries no rel and no website', () => {
    const list = listOf([sponsor({ has_logo: 1, website_url: 'http://acme.example/' })]);
    expect(list).toBe(one(card('sp_1', withLogo('sp_1', 'Acme'))));
  });
});

describe('sponsor card: the title', () => {
  it('sunny: display_name wins over name', () => {
    expect(listOf([sponsor({ has_logo: 1, display_name: 'Acme Bakery' })])).toBe(
      one(card('sp_1', withLogo('sp_1', 'Acme Bakery')))
    );
    expect(listOf([sponsor({ display_name: 'Acme Bakery' })])).toBe(
      one(card('sp_1', nameOnly('Acme Bakery')))
    );
  });

  it('rainy: a blank display_name falls back to the name', () => {
    expect(listOf([sponsor({ display_name: '   ' })])).toBe(one(card('sp_1', nameOnly('Acme'))));
  });

  it('security: markup in the title is escaped, in the alt and in the text', () => {
    const name = `"><script>x('1')</script>&`;
    const escaped = '&quot;&gt;&lt;script&gt;x(&#39;1&#39;)&lt;/script&gt;&amp;';
    expect(listOf([sponsor({ has_logo: 1, name })])).toBe(
      one(card('sp_1', withLogo('sp_1', escaped)))
    );
    expect(listOf([sponsor({ has_wide_logo: 1, name })])).toBe(
      one(card('sp_1', withHeader('sp_1', escaped)))
    );
    expect(listOf([sponsor({ name })])).toBe(one(card('sp_1', nameOnly(escaped))));
  });

  it('security: a quote in the website cannot leave the href', () => {
    const list = listOf([sponsor({ website_url: 'https://a.example/"onclick="x' })]);
    expect(list).toBe(one(site('https://a.example/&quot;onclick=&quot;x', nameOnly('Acme'))));
  });
});

describe('sponsor card: the id is encoded in the proxy src and card href', () => {
  it("fat-finger: an id with a space, slash, ? and ' stays one path segment", () => {
    const id = "sp 1/../x?y'z";
    // encodeURIComponent leaves ' as is; the escaper then makes it &#39;.
    const enc = 'sp%201%2F..%2Fx%3Fy&#39;z';
    expect(listOf([sponsor({ id, has_logo: 1, has_wide_logo: 1 })])).toBe(
      one(card(enc, withHeader(enc, 'Acme')))
    );
  });
});

describe('sponsor banner: no text or location on the event page', () => {
  it('a set location and short text add nothing: every banner stays the same size', () => {
    const plain = listOf([sponsor({ has_logo: 1 })]);
    const full = listOf([
      {
        ...sponsor({ has_logo: 1, address_line: '12 Main St' }),
        header_text: 'Fresh bread',
      } as Sponsor,
    ]);
    expect(full).toBe(plain);
    expect(full).not.toContain('12 Main St');
    expect(full).not.toContain('Fresh bread');
  });
});

describe('sponsor card: the list', () => {
  it('three sponsors, three kinds of art: one banner each, in order, nothing between', () => {
    const list = listOf([
      sponsor({
        id: 'a',
        name: 'Ad One',
        has_wide_logo: 1,
        website_url: 'https://one.example/',
      }),
      sponsor({ id: 'b', name: 'Ad Two', has_logo: 1 }),
      sponsor({ id: 'c', name: 'Ad Three' }),
    ]);
    expect(list).toBe(
      `${LIST_OPEN}${ITEM_OPEN}${site('https://one.example/', withHeader('a', 'Ad One'))}</li>` +
        `${ITEM_OPEN}${card('b', withLogo('b', 'Ad Two'))}</li>` +
        `${ITEM_OPEN}${card('c', nameOnly('Ad Three'))}</li></ul>`
    );
  });

  it('never tier-shaped: a tier on the row changes nothing', () => {
    const plain = listOf([sponsor({ has_logo: 1 })]);
    const tiered = listOf([{ ...sponsor({ has_logo: 1 }), tier: 'platinum' } as Sponsor]);
    expect(tiered).toBe(plain);
  });

  it('every phase renders the same list', () => {
    const sponsors = [sponsor({ has_logo: 1, website_url: 'https://acme.example/' })];
    const expected = one(site('https://acme.example/', withLogo('sp_1', 'Acme')));
    const opts = { nonce: 'n', lang: 'en' as const };
    for (const html of [
      renderEventLiveHtml(row(), SHARE, social(sponsors), opts),
      renderPostEventHtml(row(), SHARE, [], social(sponsors), opts),
    ]) {
      expect(html).toContain(expected);
    }
  });

  it('no sponsors: no list at all', () => {
    const html = renderPreEventHtml(row(), SHARE, social([]), { nonce: 'n', lang: 'en' });
    // The class name is always in the page's CSS; the list's test id is not.
    expect(html).not.toContain('data-testid="sponsor-list"');
    expect(html).not.toContain('data-testid="sponsor-item"');
  });
});
