/**
 * OSE-1952 (feature OSE-1948, owner 2026-11-09): the sponsor-art rule on the
 * event page, held closely enough that Stryker cannot change it unseen.
 *
 * Between the header and "What", each sponsor is one list item:
 *   - with a logo on file (`has_logo`): thumbnail art only, through the
 *     same-origin, consent-gated logo proxy (`?slot=sidebar`), the escaped
 *     title as its alt text, no visible name and no address line;
 *   - without: the escaped title as the link text, and the sponsor's chosen
 *     location as a muted line under it when it set one.
 * Either way the tap goes to the sponsor's https website (rel noopener
 * noreferrer nofollow) or, with no https website, to the sponsor's own card.
 *
 * The rule is `renderSponsorItem` / `renderSponsorList` in src/handlers/pages.ts,
 * mutated as a marker range (stryker.conf.mjs). It is reached here through the
 * exported phase renderers, so the anchor literals stay whole in the source
 * (the click-out invariant, sponsor-signal-never-who, reads them there).
 *
 * Every assertion compares exact markup, so a mutant that changes one attribute,
 * one separator or one branch fails. The `has_logo` SQL is a string Stryker does
 * not mutate; its branches stay pinned by public-event-stakeholder-surfaces.spec.ts.
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
  const start = html.indexOf('<ul class="ose-sponsor-list"');
  expect(start, 'the sponsor list renders').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</ul>', start) + '</ul>'.length);
}

const ITEM_OPEN = '<li class="ose-sponsor-item" data-testid="sponsor-item">';
const LIST_OPEN = '<ul class="ose-sponsor-list" data-testid="sponsor-list">';
const one = (item: string) => `${LIST_OPEN}${ITEM_OPEN}${item}</li></ul>`;
const thumb = (id: string, alt: string) =>
  `<img class="ose-sponsor-thumb" data-testid="sponsor-thumb" src="/api/v2/sponsors/${id}/logo?slot=sidebar" alt="${alt}" loading="lazy" decoding="async">`;
const site = (href: string, inner: string, extra = '') =>
  `<a href="${href}" class="ose-sponsor-link" rel="noopener noreferrer nofollow"${extra}>${inner}</a>`;
const card = (id: string, inner: string, extra = '') =>
  `<a href="/sponsors/${id}" class="ose-sponsor-link" data-testid="sponsor-card-link"${extra}>${inner}</a>`;

function sponsor(over: Partial<Sponsor> = {}): Sponsor {
  return {
    id: 'sp_1',
    name: 'Acme',
    website_url: null,
    display_name: null,
    address_line: null,
    has_logo: 0,
    ...over,
  };
}

describe('OSE-1952 | sponsor art: art or name', () => {
  it('sunny: a logo on file is thumbnail art only, linked to the https website', () => {
    expect(listOf([sponsor({ has_logo: 1, website_url: 'https://acme.example/' })])).toBe(
      one(site('https://acme.example/', thumb('sp_1', 'Acme'), ' data-thumb="1"'))
    );
  });

  it('sunny: no logo on file is the name as the link text, no art', () => {
    expect(listOf([sponsor({ website_url: 'https://acme.example/' })])).toBe(
      one(site('https://acme.example/', 'Acme'))
    );
  });

  for (const hasLogo of [0, null, undefined] as const) {
    it(`rainy: has_logo ${String(hasLogo)} is no art`, () => {
      const list = listOf([sponsor({ has_logo: hasLogo })]);
      expect(list).toBe(one(card('sp_1', 'Acme')));
      expect(list).not.toContain('sponsor-thumb');
    });
  }

  it('edge: any truthy has_logo (SQLite returns 1) is art', () => {
    expect(listOf([sponsor({ has_logo: 1 })])).toBe(
      one(card('sp_1', thumb('sp_1', 'Acme'), ' data-thumb="1"'))
    );
  });
});

describe('OSE-1952 | sponsor art: website or card link', () => {
  it('sunny: an https website is the outbound link, with the rel set', () => {
    const list = listOf([sponsor({ website_url: 'https://acme.example/a?b=1&c=2' })]);
    expect(list).toBe(one(site('https://acme.example/a?b=1&amp;c=2', 'Acme')));
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
      expect(list).toBe(one(card('sp_1', 'Acme')));
      expect(list).not.toContain('rel=');
    });
  }

  it('rainy: a card link with art carries no rel and no website', () => {
    const list = listOf([sponsor({ has_logo: 1, website_url: 'http://acme.example/' })]);
    expect(list).toBe(one(card('sp_1', thumb('sp_1', 'Acme'), ' data-thumb="1"')));
  });
});

describe('OSE-1952 | sponsor art: alt is the escaped title', () => {
  it('sunny: display_name wins over name, in the alt and in the link text', () => {
    expect(listOf([sponsor({ has_logo: 1, display_name: 'Acme Bakery' })])).toBe(
      one(card('sp_1', thumb('sp_1', 'Acme Bakery'), ' data-thumb="1"'))
    );
    expect(listOf([sponsor({ display_name: 'Acme Bakery' })])).toBe(
      one(card('sp_1', 'Acme Bakery'))
    );
  });

  it('rainy: a blank display_name falls back to the name', () => {
    expect(listOf([sponsor({ has_logo: 1, display_name: '   ' })])).toBe(
      one(card('sp_1', thumb('sp_1', 'Acme'), ' data-thumb="1"'))
    );
  });

  it('security: markup in the title is escaped in the alt and in the text', () => {
    const name = `"><script>x('1')</script>&`;
    const escaped = '&quot;&gt;&lt;script&gt;x(&#39;1&#39;)&lt;/script&gt;&amp;';
    expect(listOf([sponsor({ has_logo: 1, name })])).toBe(
      one(card('sp_1', thumb('sp_1', escaped), ' data-thumb="1"'))
    );
    expect(listOf([sponsor({ name })])).toBe(one(card('sp_1', escaped)));
  });

  it('security: a quote in the website cannot leave the href', () => {
    const list = listOf([sponsor({ website_url: 'https://a.example/"onclick="x' })]);
    expect(list).toBe(one(site('https://a.example/&quot;onclick=&quot;x', 'Acme')));
  });
});

describe('OSE-1952 | sponsor art: the id is encoded in the proxy src and card href', () => {
  it("fat-finger: an id with a space, slash, ? and ' stays one path segment", () => {
    const id = "sp 1/../x?y'z";
    // encodeURIComponent leaves ' as is; the escaper then makes it &#39;.
    const enc = 'sp%201%2F..%2Fx%3Fy&#39;z';
    expect(listOf([sponsor({ id, has_logo: 1 })])).toBe(
      one(card(enc, thumb(enc, 'Acme'), ' data-thumb="1"'))
    );
  });
});

describe('OSE-1952 | sponsor art: the address line only without art', () => {
  it('sunny: no art, an address: the name, then the muted location line', () => {
    expect(listOf([sponsor({ address_line: '12 Main St & 3rd' })])).toBe(
      one(
        `<div>${card('sp_1', 'Acme')}<small class="sub-line" data-testid="sponsor-item-address">12 Main St &amp; 3rd</small></div>`
      )
    );
  });

  it('rainy: art and an address: the art only; the location stays on the card', () => {
    const list = listOf([sponsor({ has_logo: 1, address_line: '12 Main St' })]);
    expect(list).toBe(one(card('sp_1', thumb('sp_1', 'Acme'), ' data-thumb="1"')));
    expect(list).not.toContain('sponsor-item-address');
  });

  for (const address of [null, ''] as const) {
    it(`edge: a ${address === null ? 'null' : 'empty'} address adds no line and no wrapper`, () => {
      expect(listOf([sponsor({ address_line: address })])).toBe(one(card('sp_1', 'Acme')));
    });
  }
});

describe('OSE-1952 | sponsor art: the list', () => {
  it('Ad 1 with art and Ad 2 without: one item each, in order, nothing between', () => {
    const list = listOf([
      sponsor({ id: 'a', name: 'Ad One', has_logo: 1, website_url: 'https://one.example/' }),
      sponsor({ id: 'b', name: 'Ad Two' }),
    ]);
    expect(list).toBe(
      `${LIST_OPEN}${ITEM_OPEN}${site('https://one.example/', thumb('a', 'Ad One'), ' data-thumb="1"')}</li>` +
        `${ITEM_OPEN}${card('b', 'Ad Two')}</li></ul>`
    );
  });

  it('every phase renders the same list', () => {
    const sponsors = [sponsor({ has_logo: 1, website_url: 'https://acme.example/' })];
    const expected = one(site('https://acme.example/', thumb('sp_1', 'Acme'), ' data-thumb="1"'));
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
