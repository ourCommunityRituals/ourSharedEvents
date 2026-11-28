/**
 * demo-bocce.ts — the practice bocce family on the demo site (OSE-2219).
 *
 * Five stand-in brands (Lakeside Bocce Co. and its club, semi-pro league, bar
 * league and broadcast network) show how one parent company runs several
 * ventures on the platform, each with its own look, and sees one "our pull"
 * roll-up above them. The names are stand-ins: the real groups have not agreed
 * to appear (owner, 2026-11-23), so no real name, venue or person is here.
 *
 * Governance honored here, by construction:
 *   • Traffic, never people: every figure is scans or clicks on a code or a
 *     link (a court, a poster, a night, a stream link). No names anywhere.
 *   • Counts publish through `publishCount` (lib/count-floor.ts): under 5 is
 *     withheld and reads "Fewer than 5", from 5 up it rounds down to a
 *     multiple of 5, the same as every published count.
 *   • Sponsors are shown with the two-sided rule stated, and the strip sits
 *     below the title (AGENTS.md invariant 6).
 *   • Mock fixtures only, under the demo banner, rendered by the same page
 *     shell as the other demo sites. No new page CSS: the brand look comes
 *     from `data-brand` and the @ocr/ui brand themes.
 */

import { esc, escUrl } from '@ocr/ui';
import { publishCount } from '../lib/count-floor.js';
import { fewerThan } from '../lib/withheld-words.js';
import { demoHtml, type DemoBrand } from './demo.js';

export type BocceSite = 'co' | 'club' | 'semipro' | 'league' | 'network';

interface Row {
  label: string;
  note?: string;
  scans: number | null;
}

interface BocceSiteConfig {
  slug: BocceSite;
  path: string;
  brand: DemoBrand;
  name: string;
  tab: string;
  tagline: string;
  /** What is on, in order. */
  schedule: Array<[string, string]>;
  /** The table of codes this venture counts on. */
  codesTitle: string;
  codes: Row[];
}

/** The practice season these figures cover. */
const SEASON = 'Sep 1 to Nov 23 (practice numbers)';

const SITES: Record<BocceSite, BocceSiteConfig> = {
  co: {
    slug: 'co',
    path: '/demo/bocce',
    brand: 'lakeside-co',
    name: 'Lakeside Bocce Co.',
    tab: 'Our pull',
    tagline:
      'One company, every venture: leagues, a club, a semi-pro league, tournaments and a broadcast.',
    schedule: [
      ['Every week', 'Bar league nights across the city'],
      ['Wednesdays', 'Club league night'],
      ['Saturdays', 'Semi-pro match night'],
      ['December', 'Holiday tournament, streamed'],
    ],
    codesTitle: 'Scans by venture',
    codes: [],
  },
  club: {
    slug: 'club',
    path: '/demo/bocce/club',
    brand: 'lakeside-club',
    name: 'Lakeside Bocce Club',
    tab: 'Club',
    tagline: 'The clubhouse: five courts, member nights, lessons and private events.',
    schedule: [
      ['Monday', 'Games night'],
      ['Wednesday', 'Club league night'],
      ['Thursday', 'Card night'],
      ['Saturday', 'Beginner class, 11am'],
      ['Sunday', 'Open play'],
    ],
    codesTitle: 'Scans by court',
    codes: [
      { label: 'Court 1', note: 'Indoor', scans: 1612 },
      { label: 'Court 2', note: 'Indoor', scans: 1483 },
      { label: 'Court 3', note: 'Indoor', scans: 1391 },
      { label: 'Court 4', note: 'Backyard', scans: 1124 },
      { label: 'Court 5', note: 'Backyard', scans: 818 },
    ],
  },
  semipro: {
    slug: 'semipro',
    path: '/demo/bocce/semipro',
    brand: 'lakeside-semipro',
    name: 'Lakeside Semi-Pro League',
    tab: 'Semi-pro',
    tagline:
      'The top level of play: rostered teams, a set season and a championship night, streamed.',
    schedule: [
      ['Saturdays', 'Match night at the Club'],
      ['Week 11', 'Playoffs'],
      ['Week 12', 'Championship night'],
    ],
    codesTitle: 'Scans by match night',
    codes: [
      { label: 'Opening night', scans: 412 },
      { label: 'Mid-season', scans: 366 },
      { label: 'Playoffs', scans: 527 },
      { label: 'Championship', scans: null },
    ],
  },
  league: {
    slug: 'league',
    path: '/demo/bocce/league',
    brand: 'lakeside-league',
    name: 'Lakeside Bocce League',
    tab: 'League',
    tagline: 'Easy-entry social leagues at bars and restaurants. Teams of four, one night a week.',
    schedule: [
      ['Monday', 'North side'],
      ['Tuesday', 'South side'],
      ['Wednesday', 'West side'],
      ['Thursday', 'North shore'],
      ['Sunday', 'Near the Club'],
    ],
    codesTitle: 'Scans by league night',
    codes: [
      { label: 'Monday, north side', scans: 1243 },
      { label: 'Tuesday, south side', scans: 1088 },
      { label: 'Wednesday, west side', scans: 961 },
      { label: 'Thursday, north shore', scans: 878 },
      { label: 'Thursday, new bar', scans: 3 },
      { label: 'Sunday, near the Club', scans: 1007 },
    ],
  },
  network: {
    slug: 'network',
    path: '/demo/bocce/network',
    brand: 'lakeside-network',
    name: 'Lakeside Bocce Network',
    tab: 'Network',
    tagline: 'Bocce, live: tournaments and league nights streamed, with the scoreboard on screen.',
    schedule: [
      ['Mondays', 'League night stream'],
      ['Saturdays', 'Semi-pro match night'],
      ['December', 'Holiday tournament'],
    ],
    codesTitle: 'Stream link clicks from our codes',
    codes: [
      { label: 'Tournaments', scans: 1982 },
      { label: 'League playoff nights', scans: 1101 },
      { label: 'Semi-pro nights', scans: 877 },
    ],
  },
};

export const BOCCE_SITE_ORDER: BocceSite[] = ['co', 'club', 'semipro', 'league', 'network'];

/** Every bocce demo path, in order. */
export function bocceDemoPaths(): string[] {
  return BOCCE_SITE_ORDER.map((s) => SITES[s].path);
}

/** Tournaments sit under the parent: run by the Club and the League together. */
const TOURNAMENTS: Row = {
  label: 'Tournaments',
  note: 'Run by the Club and the League',
  scans: 2310,
};

const AREAS: Row[] = [
  { label: 'Near the Club', scans: 7114 },
  { label: 'North side', scans: 2231 },
  { label: 'South side', scans: 1758 },
  { label: 'West side', scans: 1419 },
  { label: 'North shore', scans: 1182 },
  { label: 'A new area this season', scans: 4 },
];

const SPONSORS: Row[] = [
  { label: 'Practice Sponsor A', note: 'The Club and the League', scans: 8240 },
  { label: 'Practice Sponsor B', note: 'The Network', scans: 3960 },
  { label: 'Practice Sponsor C', note: 'Tournaments', scans: 2310 },
];

function sumScans(rows: Row[]): number {
  return rows.reduce((t, r) => t + (r.scans ?? 0), 0);
}

/** A count in words as the platform publishes it. */
export function bocceCountText(raw: number | null): string {
  if (raw === null) return 'Not started yet';
  const p = publishCount(raw);
  return p.count === null ? fewerThan() : p.count.toLocaleString('en-US');
}

function ventureRows(): Row[] {
  return [
    ...BOCCE_SITE_ORDER.filter((s) => s !== 'co').map((s) => ({
      label: SITES[s].name,
      note: SITES[s].tab,
      scans: SITES[s].codes.every((c) => c.scans === null) ? null : sumScans(SITES[s].codes),
    })),
    TOURNAMENTS,
  ];
}

function table(id: string, caption: string, head: [string, string], rows: Row[]): string {
  const body = rows
    .map(
      (r) =>
        `<tr><th scope="row">${esc(r.label)}${r.note ? `<br><span class="stat-label">${esc(r.note)}</span>` : ''}</th><td>${esc(
          bocceCountText(r.scans)
        )}</td></tr>`
    )
    .join('');
  // A heading, not a <caption>: the demo's phone layout turns the table into
  // blocks, and a caption there shrinks to one letter per line.
  return `<h3 id="${id}-h">${esc(caption)}</h3>
    <table class="ladder" id="${id}" aria-labelledby="${id}-h">
    <thead><tr><th scope="col">${esc(head[0])}</th><th scope="col">${esc(head[1])}</th></tr></thead>
    <tbody>${body}</tbody></table>`;
}

function familyTabs(active: BocceSite | null): string {
  const tabs = BOCCE_SITE_ORDER.map((s) => {
    const cfg = SITES[s];
    const current = s === active ? ' aria-current="page"' : '';
    return `<a class="demo-tab" href="${escUrl(cfg.path)}"${current}>${esc(cfg.tab)}</a>`;
  }).join('');
  return `<nav class="demo-tabs" aria-label="The bocce family"><a class="demo-tab" href="/demo">← Front door</a>${tabs}</nav>`;
}

function sponsorStrip(): string {
  const names = SPONSORS.map((s) => esc(s.label)).join(' · ');
  return `<p class="demo-note" aria-label="Sponsors">With thanks to ${names}. A sponsor shows only when the sponsor and the organizer have both said yes.</p>`;
}

function scheduleSection(cfg: BocceSiteConfig): string {
  const items = cfg.schedule
    .map(([when, what]) => `<li><span>${esc(when)}</span><span>${esc(what)}</span></li>`)
    .join('');
  return `<section class="demo-section" aria-labelledby="whats-on-h">
    <h2 id="whats-on-h">What's on</h2>
    <ul class="season-list">${items}</ul>
  </section>`;
}

/** Sponsor, event and attendee: the Triangle, run from a phone. */
function phoneSection(): string {
  const steps: Array<[number, string, string, string, string]> = [
    [
      1,
      'Sponsor',
      'A sponsor backs the night. Its name shows only when both sides say yes.',
      '/display',
      'See the venue screen',
    ],
    [
      2,
      'Event',
      'The organizer makes the night and prints one code per court, all from a phone.',
      '/poster',
      'See a poster',
    ],
    [
      3,
      'Players and fans',
      'People scan to see the night, check in and watch the stream. Counted, never tracked.',
      '/',
      'See the public page',
    ],
  ];
  const cards = steps
    .map(
      ([n, title, body, href, cta]) => `<div class="demo-card">
      <h3><span class="demo-step-num" aria-hidden="true">${n}</span>${esc(title)}</h3>
      <p>${esc(body)}</p>
      <a class="demo-tab" href="${escUrl(href)}">${esc(cta)}</a>
    </div>`
    )
    .join('');
  return `<section class="demo-section" aria-labelledby="phone-h">
    <h2 id="phone-h">Run the night from your phone</h2>
    <div class="demo-grid">${cards}</div>
    <p class="demo-note">After the night, one shared report goes to everyone: traffic on each code, never names.
    A player's name and stats appear only on ourWKRP, and only if that player chooses.</p>
  </section>`;
}

function parentBody(cfg: BocceSiteConfig): string {
  const ventures = ventureRows();
  const total = sumScans(ventures);
  return `
  <section class="demo-section" aria-labelledby="pull-h">
    <h2 id="pull-h">Our pull</h2>
    <p class="demo-note">${esc(SEASON)}. Every venture adds up here, and a new one counts from its first night.</p>
    <div class="stat-row">
      <div class="stat-card"><div class="stat-num">${esc(bocceCountText(total))}</div><div class="stat-label">Scans and clicks, all ventures</div></div>
      <div class="stat-card"><div class="stat-num">${ventures.length}</div><div class="stat-label">Ventures</div></div>
    </div>
    ${table('by-venture', cfg.codesTitle, ['Venture', 'Scans'], ventures)}
    ${table('by-area', 'Scans by area (neighbourhood-sized, never an address)', ['Area', 'Scans'], AREAS)}
    ${table('by-sponsor', 'What sponsors reach', ['Sponsor', 'Scans'], SPONSORS)}
  </section>`;
}

function ventureBody(cfg: BocceSiteConfig): string {
  const total = cfg.codes.every((c) => c.scans === null) ? null : sumScans(cfg.codes);
  return `
  <section class="demo-section" aria-labelledby="counts-h">
    <h2 id="counts-h">Our numbers</h2>
    <p class="demo-note">${esc(SEASON)}. Each code is counted on its own, and none of them counts people.</p>
    <div class="stat-row">
      <div class="stat-card"><div class="stat-num">${esc(bocceCountText(total))}</div><div class="stat-label">This season</div></div>
    </div>
    ${table('by-code', cfg.codesTitle, ['Code', 'Scans'], cfg.codes)}
    <p class="demo-note">Part of <a href="/demo/bocce">Lakeside Bocce Co.</a>: this venture adds up into its "our pull" page.</p>
  </section>`;
}

/** GET /demo/bocce and /demo/bocce/:site. */
export function handleBocceDemo(site: string): Response {
  const cfg = SITES[site as BocceSite];
  if (!cfg) {
    const body = `<section class="demo-hero">
      <h1>No such demo site</h1>
      <p class="demo-lede">Try one of the bocce family's sites.</p>
    </section>${familyTabs(null)}`;
    return demoHtml(body, 404);
  }
  const body = `
  <section class="demo-hero">
    <h1>Demo — ${esc(cfg.name)}</h1>
    <p class="demo-lede">${esc(cfg.tagline)}</p>
    ${sponsorStrip()}
  </section>
  ${familyTabs(cfg.slug)}
  ${cfg.slug === 'co' ? parentBody(cfg) : ventureBody(cfg)}
  ${scheduleSection(cfg)}
  ${phoneSection()}`;
  return demoHtml(body, 200, cfg.brand);
}

/**
 * The stand-in name of a practice bocce brand, or null for any other brand.
 * The family report (handlers/family-report.ts) uses it so the Lakeside
 * practice tree reads by name on staging; a real brand reads by its id.
 */
export function bocceBrandName(brand: string): string | null {
  for (const s of BOCCE_SITE_ORDER) if (SITES[s].brand === brand) return SITES[s].name;
  return null;
}
