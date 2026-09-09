/**
 * demo.ts — Demo Site thin slice (OSE-605 / OSE-607 / OSE-610).
 *
 * The permanent reference installation, first cut: /demo front door + three
 * standing tier sites (/demo/free, /demo/mid, /demo/premium) rendering the SAME
 * mock venue+dataset at three depths. Tab between them and the tier ladder
 * demonstrates itself (Invariant #5, Tier Equity, as a live exhibit).
 *
 * Governance honored here, by construction:
 *   • Not a hardcoded picture of tier gating — each site renders the REAL
 *     per-tier flag set via getFlagsForTier() (the same flag machinery the
 *     platform uses) and the REAL report-depth section map (report-depth.ts).
 *     What changes between tabs is the configuration, not three builds.
 *   • SR-25 respected: this is render-side depth presentation over mock
 *     fixtures. It never touches the SharedReport read API (which is a straight
 *     readout, no field-stripping). The depth shown here mirrors what the
 *     shared-report render surface gates client-side.
 *   • data_class: all rows are demo fixtures (mock-data.ts). The production
 *     data_class enum + brain doctrine (OSE-606) are deferred until this rides
 *     production; local walkthrough needs neither.
 *
 * Thin slice scope: renders over the EXISTING single bocce mock event so the
 * four-flow loop is walkable today. The RIPH multi-league dataset (OSE-608) is
 * the enrichment step once the flow shape is confirmed.
 */

import { esc, escUrl } from '@ocr/ui';
import {
  getEventFixture,
  getFlagsForTier,
  getScanRecords,
  getCheckinFixtures,
  getRegistrationFixtures,
  getSurveyFixtures,
  getPosterDeployments,
  getRiphDataset,
  RIPH_VENUE_NAME,
  type Tier as FlagTier,
} from '../lib/mock-data.js';
import { demoBannerMarkup } from '../lib/demo-banner.js';
import { HARDENING_HEADERS } from '../lib/security-headers.js';
import { DEPTH_SECTIONS, type ReportDepth } from '../lib/report-depth.js';
import { DEMO_LINKS, DEMO_REGISTRY_VERSION, demoTierLinks } from '../lib/demo-registry.js';

// ── Demo tier model — the three site slugs, mapped to the other two vocabularies ──
//
// Three tier vocabularies exist in OSE (see report-depth.ts header). The demo
// site slug is its own fourth surface name; it maps deterministically onto the
// flag-tier vocabulary (free/mid/enterprise) and the report-depth vocabulary
// (local/mid/premium). This is the ONLY place the demo slug is translated.

export type DemoTier = 'free' | 'mid' | 'premium';

interface DemoTierConfig {
  slug: DemoTier;
  label: string;
  flagTier: FlagTier;
  depth: ReportDepth;
  tagline: string;
}

const DEMO_TIERS: Record<DemoTier, DemoTierConfig> = {
  free: {
    slug: 'free',
    label: 'Free · Local',
    flagTier: 'free',
    depth: 'local',
    tagline: 'Proof you were there — headcount and your own logo counts.',
  },
  mid: {
    slug: 'mid',
    label: 'Mid',
    flagTier: 'mid',
    depth: 'mid',
    tagline: 'Optimization — placement breakdown, temporal signal, campaign comparison.',
  },
  premium: {
    slug: 'premium',
    label: 'Premium · Enterprise',
    flagTier: 'enterprise',
    depth: 'premium',
    tagline: 'Intelligence — cross-event comparison + corridor truth + map.',
  },
};

const DEMO_TIER_ORDER: DemoTier[] = ['free', 'mid', 'premium'];

// Human labels for the 17 tier flags, so the read-only flag panel reads clearly.
const FLAG_LABELS: Record<string, string> = {
  'forms.register': 'Registration form',
  'forms.checkin': 'Check-in form',
  'forms.survey': 'Post-event survey',
  'forms.email-signup': 'Email signup',
  'config.self-serve': 'Self-serve configuration',
  'config.event-settings': 'Event settings',
  'analytics.shared-report': 'SharedReport',
  'report.export-json': 'Export JSON',
  'report.advanced-metrics': 'Advanced metrics',
  'report.export-pdf': 'Export PDF',
  'report.custom-window': 'Custom report window',
  'report.portfolio': 'Portfolio reports',
  'assets.file-upload': 'File upload',
  'assets.custom-qr': 'Custom QR codes',
  'branding.white-label': 'White-label branding',
  'branding.custom-domain': 'Custom domain',
  'branding.color-palette': 'Color palette',
};

// Friendly section names for the depth exhibit.
const SECTION_LABELS: Record<string, string> = {
  unique_gatherings: 'Headcount (unique gatherings)',
  sponsor_impressions: 'Sponsor logo impressions',
  campaign_summary: 'Campaign comparison',
  poster_attribution: 'Poster placement breakdown',
  return_rate: 'Return rate',
  corridor_density: 'Corridor density',
  corridor_map: 'Corridor map (real H3 cells)',
  headcount_trend: 'Headcount trend (cross-event)',
};

// ── Scoped demo styling — role tokens only, no hardcoded palette ─────────────────

const DEMO_STYLE = `<style>
  .demo-wrap { max-width: 960px; margin: 0 auto; padding: 1rem; }
  .demo-hero { padding: 1.5rem 0 0.5rem; }
  .demo-hero h2 { margin: 0 0 0.25rem; }
  .demo-lede { color: var(--text-muted); font-size: 1.05rem; margin: 0 0 1rem; }
  .demo-tabs { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 0.5rem 0 1.5rem; }
  .demo-tab {
    padding: 0.55rem 1rem; border-radius: 0.5rem; text-decoration: none;
    border: 1px solid var(--border); color: var(--text); background: var(--surface);
    font-weight: 600;
  }
  .demo-tab[aria-current="page"] { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .demo-tab:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .demo-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
  .demo-card {
    border: 1px solid var(--border); border-radius: 0.75rem; padding: 1rem;
    background: var(--surface);
  }
  .demo-card h3 { margin: 0 0 0.35rem; font-size: 1rem; }
  .demo-card p { margin: 0 0 0.75rem; color: var(--text-muted); font-size: 0.9rem; }
  .demo-step-num {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.6rem; height: 1.6rem; border-radius: 50%;
    background: var(--accent); color: var(--bg); font-weight: 700; margin-right: 0.5rem;
  }
  .demo-section { margin: 2rem 0; }
  .demo-section > h3 { border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
  .flag-list { list-style: none; padding: 0; margin: 0; display: grid;
    gap: 0.35rem 1rem; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .flag-list li { display: flex; align-items: center; justify-content: space-between;
    padding: 0.4rem 0.6rem; border-radius: 0.4rem; background: var(--surface); border: 1px solid var(--border); }
  .flag-on { color: var(--live); font-weight: 700; }
  .flag-off { color: var(--text-muted); }
  .stat-row { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .stat-card { border: 1px solid var(--border); border-radius: 0.75rem; padding: 1rem; background: var(--surface); }
  .stat-num { font-size: 1.8rem; font-weight: 800; }
  .stat-label { color: var(--text-muted); font-size: 0.85rem; }
  .depth-locked { opacity: 0.55; }
  .depth-badge { font-size: 0.7rem; font-weight: 700; padding: 0.1rem 0.5rem; border-radius: 999px;
    background: var(--border); color: var(--text-muted); margin-left: 0.4rem; }
  .roster-tier { margin: 0.75rem 0; }
  .roster-tier h4 { margin: 0 0 0.35rem; text-transform: capitalize; }
  .roster-tier ul { margin: 0; padding-left: 1.1rem; color: var(--text-muted); }
  .camp-title { font-weight: 700; margin: 0.6rem 0 0.2rem; font-size: 0.9rem; }
  .camp-list { margin: 0 0 0.25rem; padding-left: 1.1rem; color: var(--text-muted); font-size: 0.88rem; }
  .season-list { list-style: none; margin: 0; padding: 0; }
  .season-list li { display: flex; justify-content: space-between; gap: 0.5rem; padding: 0.35rem 0; border-bottom: 1px solid var(--border); font-size: 0.88rem; }
  .season-list li span:last-child { color: var(--text-muted); white-space: nowrap; }
  .fallback-note { margin-top: 0.6rem; padding: 0.6rem 0.85rem; border-left: 3px solid var(--text-muted); background: var(--surface); border-radius: 0 0.4rem 0.4rem 0; color: var(--text-muted); font-size: 0.85rem; }
  .demo-note { color: var(--text-muted); font-size: 0.85rem; margin-top: 0.5rem; }
  .ladder { width: 100%; border-collapse: collapse; margin: 0.5rem 0; }
  .ladder caption { text-align: left; padding: 0 0 0.6rem; color: var(--text-muted); font-size: 0.9rem; }
  .ladder th, .ladder td { text-align: left; padding: 0.65rem 0.75rem; border-bottom: 1px solid var(--border); vertical-align: top; font-size: 0.9rem; }
  .ladder thead th { color: var(--text-muted); font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .ladder tbody th { font-weight: 700; white-space: nowrap; }
  .ladder tr.paid { background: var(--surface); }
  .ladder .map-badge { display: inline-block; font-size: 0.68rem; font-weight: 700; padding: 0.1rem 0.5rem; border-radius: 999px; background: var(--accent); color: var(--bg); margin-left: 0.4rem; }
  .ladder-floor { margin-top: 0.6rem; padding: 0.65rem 0.85rem; border-left: 3px solid var(--accent); background: var(--surface); color: var(--text-muted); font-size: 0.85rem; border-radius: 0 0.4rem 0.4rem 0; }
  @media (max-width: 640px) {
    .ladder, .ladder thead, .ladder tbody, .ladder tr, .ladder th, .ladder td { display: block; }
    .ladder thead { display: none; }
    .ladder tbody th { border-bottom: none; padding-bottom: 0; }
    .ladder tr { border: 1px solid var(--border); border-radius: 0.5rem; margin-bottom: 0.6rem; padding: 0.3rem 0; }
    .ladder td { border-bottom: none; padding-top: 0.15rem; }
  }
</style>`;

// ── Response helper — no scripts on these pages, so a tight CSP with no nonce ─────

function demoHtml(body: string, status = 200): Response {
  const doc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>ourSharedEvents — Demo</title>
<link rel="stylesheet" href="/ui.css">
${DEMO_STYLE}
</head>
<body>
${demoBannerMarkup()}
<main id="main-content" class="demo-wrap">${body}</main>
</body>
</html>`;
  return new Response(doc, {
    status,
    headers: {
      ...HARDENING_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    },
  });
}

// ── Shared fragments ─────────────────────────────────────────────────────────────

function tierTabs(active: DemoTier | null): string {
  const tabs = DEMO_TIER_ORDER.map((t) => {
    const cfg = DEMO_TIERS[t];
    const current = t === active ? ' aria-current="page"' : '';
    return `<a class="demo-tab" href="/demo/${cfg.slug}"${current}>${esc(cfg.label)}</a>`;
  }).join('');
  const index = active ? `<a class="demo-tab" href="/demo">← Front door</a>` : '';
  return `<nav class="demo-tabs" aria-label="Demo tiers">${index}${tabs}</nav>`;
}

/**
 * The 15-minute script rendered as page structure — the meeting IS the page.
 *
 * The Report step points at the in-page depth exhibit on a tier site (never a
 * dead-end), or at the free site from the front door. The other three steps
 * link to the live public surfaces (they render the mock event in mock mode).
 */
function fourFlowLoop(activeTier: DemoTier | null): string {
  const reportHref = activeTier ? '#depth-h' : '/demo/free';
  const steps = [
    {
      n: 1,
      title: 'Sponsor',
      body: 'A neighborhood business buys a placement. Its logo enters the rotation.',
      href: '/display',
      cta: 'See the venue display',
    },
    {
      n: 2,
      title: 'Create',
      body: 'The organizer stands up the event and generates the QR + short link.',
      href: '/poster',
      cta: 'See the poster',
    },
    {
      n: 3,
      title: 'Attend',
      body: 'An attendee scans the QR at the table — their scan becomes a live row.',
      href: '/',
      cta: 'Open the event page',
    },
    {
      n: 4,
      title: 'Report',
      body: 'The SharedReport renders the proof, at the depth this tier bought.',
      href: reportHref,
      cta: activeTier ? 'See the report at this depth ↓' : 'Open the SharedReport',
    },
  ];
  const cards = steps
    .map(
      (s) => `<div class="demo-card">
      <h3><span class="demo-step-num" aria-hidden="true">${s.n}</span>${esc(s.title)}</h3>
      <p>${esc(s.body)}</p>
      <a class="demo-tab" href="${escUrl(s.href)}">${esc(s.cta)} →</a>
    </div>`
    )
    .join('');
  return `<section class="demo-section" aria-labelledby="loop-h">
    <h3 id="loop-h">The four-flow loop</h3>
    <div class="demo-grid">${cards}</div>
    <p class="demo-note">These surfaces render the demo dataset when the worker runs with mock mode on
    (<code>MOCK_MODE=1</code> on <code>wrangler dev</code>). Sponsor → Create → Attend → Report — the whole
    circulation, at zero stakes.</p>
  </section>`;
}

/**
 * The reconciled tier layout — one-glance explainer (OSE-682).
 * Two axes made legible: the value ladder (free smoke-test → paid map) and the
 * governance floor (paid reaches furthest, but the local floor excludes no one).
 */
function tierLadder(): string {
  return `<section class="demo-section" aria-labelledby="ladder-h">
    <h3 id="ladder-h">One platform, three depths</h3>
    <table class="ladder">
      <caption>Everyone gets a real SharedReport. Paid unlocks the map; Premium reaches furthest — floored so no one is excluded.</caption>
      <thead>
        <tr>
          <th scope="col">Tier</th>
          <th scope="col">What it is</th>
          <th scope="col">The question it answers</th>
          <th scope="col">What you get</th>
        </tr>
      </thead>
      <tbody>
        <tr class="tier-free">
          <th scope="row">Free · Local</th>
          <td>Smoke test — honest &amp; complete</td>
          <td>&ldquo;Did it work?&rdquo;</td>
          <td>Headcount + your own logo impressions &rarr; establish local presence</td>
        </tr>
        <tr class="paid">
          <th scope="row">Mid <span class="map-badge">+ the map</span></th>
          <td>The map + utilization</td>
          <td>&ldquo;Where &amp; when?&rdquo;</td>
          <td>Your corridor map + placement + timing + campaigns &rarr; act on the signal</td>
        </tr>
        <tr class="paid">
          <th scope="row">Premium</th>
          <td>Reach furthest + governance</td>
          <td>&ldquo;Most reach, fairly?&rdquo;</td>
          <td>Everything in Mid + a couple extras + top share of voice</td>
        </tr>
      </tbody>
    </table>
    <p class="ladder-floor"><strong>The floor holds:</strong> paid funds the operation and subsidizes the free tier; the local guarantee (&ge;30% share, never zeroed) means reaching furthest never means excluding anyone. Upgrade is pulled by real value &mdash; never pushed by making free worse.</p>
  </section>`;
}

// ── /demo — the front door ───────────────────────────────────────────────────────

// Canonical link registry, rendered as the "address book" (OSE-610). Same list
// the CI gate checks — published and checked URLs can never diverge.
function linkRegistry(): string {
  const rows = DEMO_LINKS.map(
    (l) =>
      `<li><a class="demo-tab" href="${escUrl(l.path)}"><code>${esc(l.path)}</code></a> — ${esc(
        l.title
      )}: ${esc(l.description)}</li>`
  ).join('');
  return `<section class="demo-section" aria-labelledby="registry-h">
    <h3 id="registry-h">Canonical link registry <span class="depth-badge">v${esc(DEMO_REGISTRY_VERSION)}</span></h3>
    <p class="demo-note">The one address book. Every outward reference points here, and the CI gate
    (OSE-609) checks these exact paths — one list, never two. Slugs are permanent (Invariant #18 spirit).</p>
    <ul>${rows}</ul>
  </section>`;
}

export function handleDemoIndex(): Response {
  // Trio cards are built FROM the registry, so the published links and the
  // registry are the same list by construction (OSE-610).
  const cards = demoTierLinks()
    .map((link) => {
      const cfg = DEMO_TIERS[link.tier];
      return `<div class="demo-card">
      <h3>${esc(cfg.label)}</h3>
      <p>${esc(cfg.tagline)}</p>
      <a class="demo-tab" href="${escUrl(link.path)}" aria-label="Open the ${esc(cfg.label)} demo site">Enter →</a>
    </div>`;
    })
    .join('');

  const body = `
  <section class="demo-hero">
    <h2>The demo site</h2>
    <p class="demo-lede">Same night, same numbers — three depths. Tab between them.</p>
  </section>
  ${tierTabs(null)}
  ${tierLadder()}
  <section class="demo-section" aria-labelledby="trio-h">
    <h3 id="trio-h">Three standing sites, one dataset</h3>
    <div class="demo-grid">${cards}</div>
    <p class="demo-note">The differences you see between the three are the platform's real feature flags
    rendering at three tier configurations — one platform being configured, not three versions.
    Flags change; the numbers underneath do not (Invariant #5, Tier Equity).</p>
  </section>
  ${fourFlowLoop(null)}
  ${linkRegistry()}`;
  return demoHtml(body);
}

// ── /demo/:tier — a standing tier site ───────────────────────────────────────────

function flagPanel(flagTier: FlagTier): string {
  const flags = getFlagsForTier(flagTier);
  const items = Object.keys(FLAG_LABELS)
    .map((key) => {
      const on = flags[key] === true;
      const state = on ? '<span class="flag-on">On</span>' : '<span class="flag-off">Off</span>';
      return `<li><span>${esc(FLAG_LABELS[key])}</span>${state}</li>`;
    })
    .join('');
  return `<section class="demo-section" aria-labelledby="flags-h">
    <h3 id="flags-h">Configuration driving this render</h3>
    <p class="demo-note">Read-only. This is the live flag set for this tier — the same
    <code>/api/v2/admin/flags</code> machinery, not a hardcoded list.</p>
    <ul class="flag-list">${items}</ul>
  </section>`;
}

/** Depth exhibit — real aggregate stats from the mock snapshot, gated by depth. */
function depthExhibit(depth: ReportDepth): string {
  const scans = getScanRecords();
  const checkins = getCheckinFixtures();
  const registrations = getRegistrationFixtures();
  const surveys = getSurveyFixtures();
  const posters = getPosterDeployments();
  const event = getEventFixture();

  const uniqueScanners = new Set(scans.map((s) => s.anon_id)).size;
  const avgRating = surveys.reduce((a, s) => a + s.rating, 0) / Math.max(1, surveys.length);
  const returnRate = Math.round((checkins.length / Math.max(1, registrations.length)) * 100);

  const allowed = new Set(DEPTH_SECTIONS[depth]);
  const has = (section: string) => allowed.has(section);

  // Stat cards, each tagged with the depth that unlocks it. Locked cards render
  // dimmed with the tier that would reveal them — the upgrade hint, visible.
  const cards: string[] = [];

  // local depth (always present)
  cards.push(statCard('Headcount', String(uniqueScanners), 'unique gatherings', true, 'free'));
  cards.push(
    statCard('Your logo impressions', String(scans.length), 'rotation counts', true, 'free')
  );

  // mid depth
  cards.push(
    statCard(
      'Placement breakdown',
      `${posters.length} sites`,
      'poster attribution',
      has('poster_attribution'),
      'mid'
    )
  );
  cards.push(
    statCard(
      'Return rate',
      `${returnRate}%`,
      'check-ins ÷ registrations',
      has('return_rate'),
      'mid'
    )
  );
  cards.push(
    statCard(
      'Campaign comparison',
      'Enabled',
      'grouped by tier class',
      has('campaign_summary'),
      'mid'
    )
  );

  // paid value line: the visible map unlocks at Mid (OSE-682) — "paid gets the map"
  cards.push(
    statCard(
      'Corridor map',
      event.h3_res9 ? '1 cell' : '—',
      'your corridor · real H3 geography',
      has('corridor_map'),
      'mid'
    )
  );
  // premium depth: deeper — cross-event / cross-corridor
  cards.push(
    statCard(
      'Cross-event trend',
      'Enabled',
      'headcount across the season',
      has('headcount_trend'),
      'premium'
    )
  );

  const sectionList = DEPTH_SECTIONS[depth]
    .filter((s) => SECTION_LABELS[s])
    .map((s) => `<li>${esc(SECTION_LABELS[s])}</li>`)
    .join('');

  return `<section class="demo-section" aria-labelledby="depth-h">
    <h3 id="depth-h">What this depth shows</h3>
    <p class="demo-note">Same materialized signal underneath (avg survey rating ${avgRating.toFixed(1)}★
    across ${surveys.length} responses). Dimmed cards are sections a deeper tier unlocks —
    the numbers already exist; the tier decides what renders.</p>
    <div class="stat-row">${cards.join('')}</div>
    <p class="demo-note">Sections at this depth: <span>${sectionList ? '' : 'headcount + own logo only'}</span></p>
    <ul>${sectionList}</ul>
  </section>`;
}

function statCard(
  label: string,
  value: string,
  sub: string,
  unlocked: boolean,
  unlockTier: DemoTier
): string {
  const cls = unlocked ? 'stat-card' : 'stat-card depth-locked';
  const badge = unlocked
    ? ''
    : `<span class="depth-badge">${esc(DEMO_TIERS[unlockTier].label)}</span>`;
  const shown = unlocked ? esc(value) : '—';
  return `<div class="${cls}">
    <div class="stat-num">${shown}</div>
    <div class="stat-label">${esc(label)}${badge}</div>
    <div class="stat-label">${esc(sub)}</div>
  </div>`;
}

/** Sponsor roster grouped by display tier — the composition that makes tiers visible. */
// Sponsors by campaign, grouped by tier class — the 15-minute script's opening view.
function sponsorRoster(): string {
  const { campaigns, sponsors } = getRiphDataset();
  const tierLabels: Record<'premium' | 'mid' | 'local', string> = {
    premium: 'Premium',
    mid: 'Mid',
    local: 'Local',
  };

  const groups = (['premium', 'mid', 'local'] as const)
    .map((tier) => {
      const tierCampaigns = campaigns.filter((c) => c.tier === tier);
      if (tierCampaigns.length === 0) return '';
      const campBlocks = tierCampaigns
        .map((c) => {
          const members = sponsors.filter((s) => s.campaign_id === c.id);
          const items = members
            .map((s) => `<li>${esc(s.name)} — ${esc(s.event_type)}</li>`)
            .join('');
          return `<p class="camp-title">${esc(c.title)}</p><ul class="camp-list">${items}</ul>`;
        })
        .join('');
      const n = tierCampaigns.length;
      return `<div class="demo-card">
        <h3>${esc(tierLabels[tier])} class · ${n} campaign${n > 1 ? 's' : ''}</h3>
        ${campBlocks}
      </div>`;
    })
    .join('');

  return `<section class="demo-section" aria-labelledby="roster-h">
    <h3 id="roster-h">Sponsors — by campaign, grouped by tier</h3>
    <p class="demo-note">The 15-minute script's opening view: the RIPH property's sponsors grouped by
    campaign within each tier class. Premium renders as a class (two campaigns), not a lone example.</p>
    <div class="demo-grid">${groups}</div>
  </section>`;
}

// The RIPH season — four recurring containers across a mock season, with the honesty feature visible.
function seasonSection(): string {
  const { leagues, events, ladderBuckets } = getRiphDataset();
  const leagueBlocks = leagues
    .map((lg) => {
      const insts = events.filter((e) => e.league_id === lg.id);
      const items = insts
        .map(
          (e) =>
            `<li><span>${esc(e.title)}</span><span>${e.headcount} attended · ${esc(e.start_date)}</span></li>`
        )
        .join('');
      return `<div class="demo-card">
        <h3>${esc(lg.name)}</h3>
        <ul class="season-list">${items}</ul>
      </div>`;
    })
    .join('');

  const fb = ladderBuckets.find((b) => b.suppressed);
  const fbNote = fb
    ? `<p class="fallback-note"><strong>Honesty feature on display:</strong> one ${esc(
        fb.hour_bucket.slice(11, 16)
      )} bucket had only ${fb.count} scans — below the K&ge;5 floor — so it renders as
      &ldquo;${esc(fb.label)}&rdquo; instead of a raw count. The night's total still shows;
      only the fine grain is withheld. A demo that never shows this hides the platform's honesty.</p>`
    : '';

  return `<section class="demo-section" aria-labelledby="season-h">
    <h3 id="season-h">The RIPH season — four recurring containers</h3>
    <p class="demo-note">One venue, four recurring containers (trivia · bocce · pinball · cigar social club)
    across a mock season — consolidated so a sponsor's reach rolls up ACROSS them. Headcounts vary and
    climb, so the ladder shows real states — not a flat demo.</p>
    <div class="demo-grid">${leagueBlocks}</div>
    ${fbNote}
  </section>`;
}

export function handleDemoSite(tier: string): Response {
  const cfg = DEMO_TIERS[tier as DemoTier];
  if (!cfg) {
    const body = `<section class="demo-hero">
      <h2>No such demo site</h2>
      <p class="demo-lede">Try one of the three standing sites.</p>
    </section>${tierTabs(null)}`;
    return demoHtml(body, 404);
  }

  const body = `
  <section class="demo-hero">
    <h2>Demo — ${esc(cfg.label)}</h2>
    <p class="demo-lede">${esc(cfg.tagline)}</p>
    <p class="demo-note">Venue: ${esc(RIPH_VENUE_NAME)} · one property, four recurring containers</p>
  </section>
  ${tierTabs(cfg.slug)}
  ${fourFlowLoop(cfg.slug)}
  ${depthExhibit(cfg.depth)}
  ${seasonSection()}
  ${sponsorRoster()}
  ${flagPanel(cfg.flagTier)}`;
  return demoHtml(body);
}
