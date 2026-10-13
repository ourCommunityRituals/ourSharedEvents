/**
 * Locked sections on the SharedReport page (a sponsor link at local or mid depth).
 *
 * The read handler withholds the sections above a sponsor's depth and names
 * them in `report.upgrade.locked_sections`. The page prints one locked card per
 * name. This file checks that end to end, with nothing typed in by hand:
 *
 *   real read handler  ->  its JSON response  ->  the real page script in jsdom
 *
 * Only the D1 report builder and the audit log are replaced. The token is
 * minted, the depth is resolved and the sections are stripped by the real code,
 * so the list of locked names is whatever the server sends, at every depth that
 * has a rung above it. A section added to the depth matrix is covered here with
 * no edit, and so is one the server stops naming.
 *
 * What is asserted as MET:
 *   - every section the server names gets its own locked card, in the page's
 *     flow, inside the report, and the card says which section it is and which
 *     report has it;
 *   - none of it is a dialog, an overlay or a browser prompt;
 *   - a withheld section's own table or map is not on the page;
 *   - a link with nothing locked shows no locked card;
 *   - a name from the wire is written as text, never as markup.
 *
 * What is pinned as PRESENT BEHAVIOUR, not as the acceptance (last describe):
 * the card is a labelled placeholder, not a blurred preview of the section; its
 * words are "<Section>" and "Available on the <Next> report.", not "upgrade to
 * see <Section>"; a locked section with a card in the top row keeps that card,
 * empty; and a reason about a locked section still reaches a local link. The
 * first two are the owner's to decide, and the tests are there so that a change
 * to any of them is a deliberate one.
 *
 * What this file cannot see: layout. jsdom draws nothing, so a card too wide
 * for a phone, a scrolling box around the cards and a layer over the page all
 * pass here. Those are measured in a browser at 375px by the two sponsor-link
 * tests in tests/playwright/report-counts-journey.spec.ts.
 *
 * Seen red (each fault put into the source, this file run, source restored):
 *   page    the locked block is not rendered              per-depth tests
 *   page    only the first locked name is rendered        "every section"
 *   page    the block sits in a modal dialog              "in the flow", "not a popup"
 *   page    the block is position: fixed                  "in the flow"
 *   page    the card does not name its section            "every section"
 *   page    the card does not say which report has it     "which report"
 *   page    the name is written unescaped (label, attr)   "written as text"
 *   page    an empty list draws the group; the list is    "nothing locked"
 *           not checked to be a list; no `upgrade` at
 *           all is not allowed for
 *   page    the cards are blurred                         "labelled placeholder"
 *   page    a locked map's reason draws no map heading    "OPEN: a reason ..."
 *   server  the response carries no `upgrade`             per-depth tests
 *   server  a sponsor link is not stripped to its depth   per-depth tests
 *   server  a section is named as locked and still sent   "not on the page"
 *   server  reasons about locked sections are not sent    "OPEN: a reason ..."
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../src/lib/shared-report-builder', () => ({
  buildSharedReport: vi.fn(),
}));
vi.mock('../src/lib/audit-log', () => ({
  logReportAccess: vi.fn().mockResolvedValue(undefined),
}));

import REPORT_HTML from '../src/templates/shared-report.html';
import {
  handleGetSharedReport,
  type SharedReportReadEnv,
} from '../src/handlers/shared-report-read';
import { buildSharedReport, type SharedReport } from '../src/lib/shared-report-builder';
import { mintSignedLinkToken, type SignedLinkRole } from '../src/lib/shared-report-auth';
import { DEPTH_SECTIONS, type ReportDepth } from '../src/lib/report-depth';

const EVENT_ID = 'evt_locked';
const SPONSOR_ID = 'sp_own';

const env: SharedReportReadEnv = {
  DB: {} as D1Database, // never read: the builder is replaced
  SHARED_REPORT_SIGNING_SECRET: 'test-signing-secret-locked-sections',
};
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

/** A report with every section filled, shaped as the builder returns it. */
function fullReport(): SharedReport {
  return {
    event_id: EVENT_ID,
    event_title: 'Bocce Night',
    event_start_date: '2026-09-26T23:00:00Z',
    event_end_date: '2026-09-27T03:00:00Z',
    distinct_scanners: 84,
    click_outs: { by_kind: { public: 20 }, total: 20 },
    return_rate: { venue_pct: 31.4, corridor_pct: 50, sample_size: 84 },
    corridor_density: {
      this_event_count: 84,
      baseline_30d: 40,
      baseline_90d: 80,
      density_ratio_30d: 2.1,
      density_ratio_90d: 1.05,
      bucket_dow: 6,
      bucket_hour: 23,
    },
    sponsor_displays: [
      {
        sponsor_id: SPONSOR_ID,
        sponsor_name: 'Corner Bakery',
        sponsor_title: 'Corner Bakery',
        campaign_id: 'camp_1',
        campaign_title: 'Spring Push',
        sponsor_tier: 'gold',
        is_local: false,
        surface: 'poster',
        count: 12,
      },
    ],
    campaign_summary: [
      {
        campaign_id: 'camp_1',
        campaign_title: 'Spring Push',
        total_displays: 12,
        sponsor_count: 1,
        displays_by_surface: { poster: 12 },
      },
    ],
    sponsor_class_breakdown: {
      local: { sponsor_count: 0, total_displays: 0 },
      mid: { sponsor_count: 0, total_displays: 0 },
      premium: { sponsor_count: 1, total_displays: 12 },
    },
    poster_attribution: [
      {
        poster_deployment_id: 'pd_1',
        location: 'Front window',
        h3_res9: '89266454447ffff',
        scan_count: 14,
        first_scan_at: '2026-09-26T23:00:00Z',
        last_scan_at: '2026-09-27T01:00:00Z',
        first_scan_label: 'Sat, Sep 26 · 6 PM CDT',
        last_scan_label: 'Sat, Sep 26 · 8 PM CDT',
      },
    ],
    headcount_trend: {
      series_id: 'srs_1',
      series_name: 'Saturday League',
      instances: [
        { event_id: 'evt_prev', start_date: '2026-09-19T23:00:00Z', distinct_scanners: 61 },
        { event_id: EVENT_ID, start_date: '2026-09-26T23:00:00Z', distinct_scanners: 84 },
      ],
    },
    corridor_map: {
      svg: '<svg viewBox="0 0 10 10" role="img" aria-label="Corridor map"><polygon points="1,1 9,1 5,9" fill="#888"/></svg>',
      suppressed: [],
      cell_count: 1,
      source: 'live',
    },
    _meta: {
      materialized_at: '2026-09-27T04:00:00Z',
      suppression_reasons: [],
      timezone: { zone: 'America/Chicago', source: 'event' },
    },
  };
}

interface Upgrade {
  locked_sections: string[];
  next_depth: string | null;
}
type WireReport = Record<string, unknown> & { upgrade?: Upgrade };

/** The body the real read handler returns for a link of this role and depth. */
async function read(
  role: SignedLinkRole,
  claims: { depth?: string; sponsor_id?: string } = {}
): Promise<{ ok: boolean; report: WireReport }> {
  const token = await mintSignedLinkToken(env, EVENT_ID, role, 3600, claims);
  const res = await handleGetSharedReport(
    new Request(`https://ose.test/api/v2/events/${EVENT_ID}/shared-report`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    env,
    EVENT_ID,
    ctx
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { ok: boolean; report: WireReport };
}

interface Page {
  doc: Document;
  win: JSDOM['window'];
  /** Browser prompts and new windows the page asked for while rendering. */
  popups: string[];
}

/** Run the real /sharedReport page in signed-link mode against `body`. */
async function open(body: unknown): Promise<Page> {
  const popups: string[] = [];
  const dom = new JSDOM(REPORT_HTML, {
    url: `https://ose.test/sharedReport?eventId=${EVENT_ID}&token=t0ken`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      const win = w as unknown as Record<string, unknown>;
      for (const name of ['alert', 'confirm', 'prompt', 'open']) {
        win[name] = () => {
          popups.push(name);
          return null;
        };
      }
      const dialog = (
        w as unknown as { HTMLDialogElement?: { prototype: Record<string, unknown> } }
      ).HTMLDialogElement;
      if (dialog) {
        for (const name of ['show', 'showModal']) {
          dialog.prototype[name] = () => {
            popups.push(`dialog.${name}`);
          };
        }
      }
      win.fetch = async (url: string) => {
        const json = (status: number, payload: unknown) =>
          new Response(JSON.stringify(payload), {
            status,
            headers: { 'Content-Type': 'application/json' },
          });
        return String(url).includes('/shared-report') ? json(200, body) : json(401, { ok: false });
      };
    },
  });
  const doc = dom.window.document;
  for (let i = 0; i < 40; i++) {
    if (doc.querySelector('[data-testid="signed-link-report-article"]')) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  expect(
    doc.querySelector('[data-testid="signed-link-report-article"]'),
    'the report rendered'
  ).not.toBeNull();
  return { doc, win: dom.window, popups };
}

const all = (root: ParentNode, testid: string): Element[] => [
  ...root.querySelectorAll(`[data-testid="${testid}"]`),
];
const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
/** `corridor_map` -> `Corridor Map`: how a reader expects a section to be named. */
const spoken = (key: string): string =>
  key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Where each withheld section would be drawn if it were sent. */
const OWN_RENDER: Record<string, string> = {
  poster_attribution: 'signed-link-poster-section',
  headcount_trend: 'signed-link-trend-section',
  corridor_map: 'corridor-map-section',
};

/** The sponsor depths that have a rung above them, read from the server's matrix. */
const DEPTHS_WITH_A_NEXT_RUNG = (Object.keys(DEPTH_SECTIONS) as ReportDepth[]).slice(0, -1);

beforeEach(() => {
  vi.mocked(buildSharedReport).mockResolvedValue({ ok: true, report: fullReport() });
});

describe('the cases under test are the ones the server can send', () => {
  test('a sponsor link at each depth below the top names at least one locked section', async () => {
    expect(DEPTHS_WITH_A_NEXT_RUNG).toEqual(['local', 'mid']);
    for (const depth of DEPTHS_WITH_A_NEXT_RUNG) {
      const { report } = await read('sponsor', { depth, sponsor_id: SPONSOR_ID });
      expect(report.upgrade?.locked_sections.length, `${depth} link`).toBeGreaterThan(0);
    }
  });

  test('between them, those links name every paid section of the report', async () => {
    const named = new Set<string>();
    for (const depth of DEPTHS_WITH_A_NEXT_RUNG) {
      const { report } = await read('sponsor', { depth, sponsor_id: SPONSOR_ID });
      for (const s of report.upgrade!.locked_sections) named.add(s);
    }
    const free = new Set(DEPTH_SECTIONS.local);
    const paid = [
      ...new Set(Object.values(DEPTH_SECTIONS).flatMap((sections) => [...sections])),
    ].filter((s) => !free.has(s));
    expect([...named].sort()).toEqual(paid.sort());
  });
});

describe.each(DEPTHS_WITH_A_NEXT_RUNG)('a sponsor link at %s depth', (depth) => {
  async function page(): Promise<{ p: Page; upgrade: Upgrade; report: WireReport }> {
    const body = await read('sponsor', { depth, sponsor_id: SPONSOR_ID });
    return { p: await open(body), upgrade: body.report.upgrade!, report: body.report };
  }

  test('every section the server names gets one locked card that says which section it is', async () => {
    const { p, upgrade } = await page();
    const cards = all(p.doc, 'signed-link-locked-section');
    expect(cards.map((c) => c.getAttribute('data-section-name'))).toEqual(upgrade.locked_sections);
    for (const name of upgrade.locked_sections) {
      const card = cards.find((c) => c.getAttribute('data-section-name') === name)!;
      const label = all(card, `upgrade-prompt-${name}`);
      expect(label, `${name}: one label`).toHaveLength(1);
      expect(squash(label[0]!.textContent), `${name}: the label names the section`).toBe(
        spoken(name)
      );
    }
  });

  test('each card says which report has the section, and the group is headed by that report', async () => {
    const { p, upgrade } = await page();
    const next = capital(upgrade.next_depth!);
    const group = all(p.doc, 'signed-link-locked-sections');
    expect(group).toHaveLength(1);
    expect(group[0]!.getAttribute('data-next-depth')).toBe(upgrade.next_depth);
    expect(squash(all(group[0]!, 'signed-link-upgrade-next-depth')[0]?.textContent)).toBe(
      `More on the ${next} report`
    );
    for (const card of all(p.doc, 'signed-link-locked-section')) {
      expect(squash(card.querySelector('p')?.textContent)).toBe(`Available on the ${next} report.`);
    }
  });

  test("the cards are in the page's flow, inside the report, after the sponsor's own sections", async () => {
    const { p } = await page();
    const group = all(p.doc, 'signed-link-locked-sections')[0]!;
    const article = p.doc.querySelector('[data-testid="signed-link-report-article"]')!;
    const main = p.doc.querySelector('main[data-testid="report-main"]')!;
    expect(main.contains(article)).toBe(true);
    // A child of the report itself, and the last thing in it: reached by
    // scrolling the report, not laid over it.
    expect(group.parentElement).toBe(article);
    expect(article.lastElementChild).toBe(group);
    expect(all(group, 'signed-link-locked-section').length).toBeGreaterThan(0);
    // Nothing from the cards up to the page takes them out of the flow or hides them.
    const chain: Element[] = [...all(group, 'signed-link-locked-section')];
    for (
      let el: Element | null = group;
      el && el !== p.doc.documentElement;
      el = el.parentElement
    ) {
      chain.push(el);
    }
    for (const el of chain) {
      const style = p.win.getComputedStyle(el);
      expect(['', 'static', 'relative'], `${el.tagName}.${el.className} position`).toContain(
        style.position
      );
      expect(style.display, `${el.tagName}.${el.className} display`).not.toBe('none');
      expect(el.hasAttribute('hidden'), `${el.tagName}.${el.className} hidden`).toBe(false);
    }
  });

  test('none of it is a popup: no dialog, no overlay role, no browser prompt, no new window', async () => {
    const { p } = await page();
    expect(p.popups).toEqual([]);
    const group = all(p.doc, 'signed-link-locked-sections')[0]!;
    expect(
      group.closest('dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]')
    ).toBe(null);
    expect(
      [
        ...p.doc.querySelectorAll(
          'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'
        ),
      ]
        .filter((el) => !el.hasAttribute('hidden'))
        .map((el) => el.outerHTML.slice(0, 80))
    ).toEqual([]);
    // No script hook on the cards that could open one later.
    expect(group.querySelectorAll('[onclick], button')).toHaveLength(0);
  });

  test("a withheld section's own table or map is not on the page, and its key is not in the payload", async () => {
    const { p, upgrade, report } = await page();
    for (const name of upgrade.locked_sections) {
      expect(name in report, `${name} is not sent`).toBe(false);
      const own = OWN_RENDER[name];
      if (own) expect(all(p.doc, own), `${name} is not drawn`).toHaveLength(0);
    }
    // The sponsor's own section, which every depth has, is still there.
    expect(all(p.doc, 'signed-link-sponsor-section')).toHaveLength(1);
  });
});

describe('a link with nothing locked shows no locked card', () => {
  test('an admin link (the full report): every section drawn, no locked group', async () => {
    const body = await read('admin');
    expect('upgrade' in body.report).toBe(false);
    const p = await open(body);
    expect(all(p.doc, 'signed-link-locked-sections')).toHaveLength(0);
    expect(all(p.doc, 'signed-link-locked-section')).toHaveLength(0);
    for (const own of Object.values(OWN_RENDER)) expect(all(p.doc, own), own).toHaveLength(1);
  });

  test.each([
    ['an empty list', { locked_sections: [], next_depth: 'mid' }],
    ['a list that is not a list', { locked_sections: 'corridor_map', next_depth: 'mid' }],
    ['no list', { next_depth: 'mid' }],
  ])('%s from the server draws no locked group', async (_name, upgrade) => {
    const body = await read('sponsor', { depth: 'local', sponsor_id: SPONSOR_ID });
    const p = await open({ ok: true, report: { ...body.report, upgrade } });
    expect(all(p.doc, 'signed-link-locked-sections')).toHaveLength(0);
  });
});

describe('what the wire carries is written as text', () => {
  // Angle brackets and ampersands here. Quote marks in a name or a depth (and in
  // every other value the page writes into an attribute) are covered by
  // shared-report-attribute-escaping.spec.ts.
  test('a section name or depth that looks like markup adds no element and is shown as typed', async () => {
    const body = await read('sponsor', { depth: 'local', sponsor_id: SPONSOR_ID });
    const hostile = '<img src=x onerror=alert(1)>&amp;';
    const p = await open({
      ok: true,
      report: { ...body.report, upgrade: { locked_sections: [hostile], next_depth: hostile } },
    });
    const group = all(p.doc, 'signed-link-locked-sections')[0]!;
    expect(group.querySelectorAll('img')).toHaveLength(0);
    const cards = all(group, 'signed-link-locked-section');
    expect(cards).toHaveLength(1);
    // The attribute holds the name exactly; nothing spilled into a second attribute.
    expect(cards[0]!.getAttribute('data-section-name')).toBe(hostile);
    expect(cards[0]!.getAttributeNames().sort()).toEqual([
      'class',
      'data-section-name',
      'data-testid',
    ]);
    expect(group.getAttribute('data-next-depth')).toBe(hostile);
    expect(group.textContent).toContain('<img');
    expect(p.popups).toEqual([]);
  });
});

/**
 * NOT the acceptance. The story asks for "inline blurred previews" worded
 * "upgrade to see X". The page has neither: these two tests record what it does
 * instead, so that changing it is a decision and not an accident.
 */
describe('present behaviour, pinned until the owner decides the look and the words', () => {
  test('a locked card is a labelled placeholder: no preview of the section, and nothing on the page is blurred', async () => {
    const body = await read('sponsor', { depth: 'local', sponsor_id: SPONSOR_ID });
    const p = await open(body);
    for (const card of all(p.doc, 'signed-link-locked-section')) {
      // A label and one line. No table, drawing, number or picture behind it.
      expect([...card.children].map((c) => c.tagName)).toEqual(['STRONG', 'P']);
      expect(card.querySelectorAll('table, svg, img, canvas, dl')).toHaveLength(0);
      expect(card.className).toBe('upgrade-prompt');
    }
    expect(REPORT_HTML.toLowerCase()).not.toContain('blur(');
  });

  test('the words are "<Section>" and "Available on the <Next> report.", not "upgrade to see"', async () => {
    const body = await read('sponsor', { depth: 'local', sponsor_id: SPONSOR_ID });
    const p = await open(body);
    const group = all(p.doc, 'signed-link-locked-sections')[0]!;
    expect(squash(group.textContent).toLowerCase()).not.toContain('upgrade to see');
    expect(all(group, 'signed-link-locked-section').map((c) => squash(c.textContent))).toEqual(
      body.report.upgrade!.locked_sections.map((s) => `${spoken(s)}Available on the Mid report.`)
    );
  });

  // The locked state is said once, in the group at the end. Where the section
  // itself would sit, nothing says "locked": the two sections that have a card
  // in the top row keep the card, empty.
  test('a locked section with a card in the top row keeps that card, showing a dash and no reason', async () => {
    const body = await read('sponsor', { depth: 'local', sponsor_id: SPONSOR_ID });
    expect(body.report.upgrade!.locked_sections).toEqual(
      expect.arrayContaining(['return_rate', 'corridor_density'])
    );
    const p = await open(body);
    const rate = all(p.doc, 'signed-link-return-rate')[0]!;
    const density = all(p.doc, 'signed-link-corridor-density')[0]!;
    expect(squash(rate.querySelector('dd')?.textContent)).toBe('—');
    expect([...density.querySelectorAll('dd')].map((dd) => squash(dd.textContent))).toEqual([
      '—',
      '—',
      '—',
    ]);
    expect(all(rate, 'report-suppression-note')).toHaveLength(0);
    expect(all(density, 'report-suppression-note')).toHaveLength(0);
    expect(squash(rate.textContent)).not.toMatch(/Mid report|locked/i);
  });

  // OPEN, not accepted. `_meta.suppression_reasons` is sent whole at every
  // depth, so a local link is told why a section it is not sent was withheld,
  // and the page prints that reason: "hidden to keep things anonymous" on the
  // Return Rate card, and a Corridor Scan Map heading with the same line, while
  // the group at the end says both are on the Mid report. Pinned so that
  // closing it (reasons filtered by depth, or the page skipping a locked
  // section) is a visible change here.
  test('OPEN: a reason about a locked section still reaches a local link, and the page prints it', async () => {
    const hidden = 'Hidden to keep things anonymous — not enough data yet.';
    const withReasons = fullReport();
    withReasons._meta.suppression_reasons = [
      {
        field: 'return_rate',
        reason: 'below_min_sample_size',
        detail: 'fewer than 5 distinct attendees',
      },
      {
        field: 'corridor_map',
        reason: 'below_min_sample_size',
        detail: 'some areas not shown — fewer than 5 scans recorded',
      },
    ];
    vi.mocked(buildSharedReport).mockResolvedValue({ ok: true, report: withReasons });

    const body = await read('sponsor', { depth: 'local', sponsor_id: SPONSOR_ID });
    expect(body.report.upgrade!.locked_sections).toEqual(
      expect.arrayContaining(['return_rate', 'corridor_map'])
    );
    const meta = body.report._meta as { suppression_reasons: Array<{ field: string }> };
    expect(meta.suppression_reasons.map((r) => r.field)).toEqual(['return_rate', 'corridor_map']);

    const p = await open(body);
    const rate = all(p.doc, 'signed-link-return-rate')[0]!;
    expect(all(rate, 'report-suppression-note').map((n) => squash(n.textContent))).toEqual([
      hidden,
    ]);
    const map = all(p.doc, 'corridor-map-section');
    expect(map).toHaveLength(1);
    expect(squash(map[0]!.textContent)).toBe(`Corridor Scan Map${hidden}`);
    // The map itself is still not sent and not drawn.
    expect(map[0]!.querySelectorAll('svg')).toHaveLength(0);
    expect(
      all(p.doc, 'signed-link-locked-section').map((c) => c.getAttribute('data-section-name'))
    ).toEqual(body.report.upgrade!.locked_sections);
  });
});
