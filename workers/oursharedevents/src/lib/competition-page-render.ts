/**
 * Pure render for the public schedule and standings page of a competition
 * (GET /competitions/:id, OSE-527; phase 1 of the leagues design).
 *
 * No env, no DB: the handler reads the rows and hands them here.
 *
 * Mobile first (owner, 2026-11-26): the first screen carries what a player
 * opens the page for. Top to bottom:
 *   1. the competition's name as the one <h1>, and its kind and dates;
 *   2. "Next up": the next night's matches, each with its time, court and the
 *      two teams, so a team can see when and where it plays before it leaves home;
 *   3. the standings table;
 *   4. every round: its night, its matches and their scores, and who sits out;
 *   5. how the table is ordered.
 *
 * What it never says: anything about a person. A team is its public label; a
 * score is a game's score, not a count of people (design section 5.1), so it
 * shows as it is. No count of players, scans or visitors appears.
 *
 * Every stored value goes through the one escaper. Colours come from /ui.css
 * only; the page's own CSS is layout and stays inside the inline budget.
 */

import { escapeHtml as esc } from './html-escape';
import { injectLegalFooter } from './legal-footer';
import { eventPagePath } from './canonical';
import { formatHumanDate } from './event-datetime';
import {
  FORMAT_LABELS,
  type CompetitionFormat,
  type Ruleset,
  type StandingsRow,
} from './competitions';

export interface PageNight {
  event_id: string;
  /** YYYY-MM-DD in the event's own zone, or '' when the night has no date. */
  day: string;
  /** Link to the night's event page, when that page is public. */
  href: string | null;
}

export interface PageFixture {
  round: number;
  a: string;
  b: string;
  slot_label: string | null;
  slot_time: string | null;
  status: 'scheduled' | 'played' | 'postponed';
  score_a: number | null;
  score_b: number | null;
  night: PageNight | null;
}

export interface CompetitionPageInput {
  name: string;
  format: CompetitionFormat;
  status: 'active' | 'finished';
  starts_on: string | null;
  ends_on: string | null;
  ruleset: Ruleset;
  standings: StandingsRow[];
  fixtures: PageFixture[];
  /** Round → the team that sits out, when the count is odd. */
  byes: Map<number, string>;
  /** Today, YYYY-MM-DD, so "Next up" skips a night already past. */
  today: string;
}

/** Layout only, no colour. Under the 400-character inline budget. */
export const COMPETITION_PAGE_CSS =
  'main{max-width:640px;margin:0 auto;padding:1rem 16px 3rem;overflow-wrap:anywhere}' +
  '.cp-gap{margin-top:1.25rem}.cp-list{list-style:none;padding:0}.cp-list li{padding:.5rem 0}' +
  'table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}' +
  'th,td{padding:.45rem .3rem;text-align:right}th:nth-child(2),td:nth-child(2){text-align:left}';

function shortDay(day: string): string {
  if (!day) return '';
  // "Wednesday, September 3, 2026" → keep it whole: the page is read, not scanned.
  return formatHumanDate(day);
}

export function dateRange(starts: string | null, ends: string | null): string {
  const s = starts ? formatHumanDate(starts) : '';
  const e = ends ? formatHumanDate(ends) : '';
  if (s && e) return `${s} to ${e}`;
  return s ? `From ${s}` : e ? `Until ${e}` : '';
}

/** The round whose matches a team needs next: the first with a match still to play. */
export function nextRound(fixtures: PageFixture[], today: string): number | null {
  const open = fixtures.filter(
    (f) => f.status === 'scheduled' && (!f.night?.day || f.night.day >= today)
  );
  if (!open.length) return null;
  return Math.min(...open.map((f) => f.round));
}

function where(f: PageFixture): string {
  return [f.slot_time, f.slot_label]
    .filter(Boolean)
    .map((v) => esc(v as string))
    .join(' · ');
}

function renderMatch(f: PageFixture): string {
  const a = esc(f.a);
  const b = esc(f.b);
  const place = where(f);
  if (f.status === 'played' && f.score_a !== null && f.score_b !== null) {
    return `<li data-testid="competition-match" data-status="played"><span class="detail-card-main">${a} <strong>${f.score_a}</strong> to <strong>${f.score_b}</strong> ${b}</span></li>`;
  }
  const note = f.status === 'postponed' ? 'Postponed' : place;
  return `<li data-testid="competition-match" data-status="${f.status}"><span class="detail-card-main">${a} vs ${b}</span>${
    note ? `<span class="detail-card-sub"> ${note}</span>` : ''
  }</li>`;
}

function nightLine(night: PageNight | null): string {
  if (!night || !night.day) return 'Night to be set';
  const day = esc(shortDay(night.day));
  return night.href ? `<a href="${esc(night.href)}">${day}</a>` : day;
}

function renderNext(input: CompetitionPageInput): string {
  const round = nextRound(input.fixtures, input.today);
  if (round === null) return '';
  const matches = input.fixtures.filter((f) => f.round === round && f.status === 'scheduled');
  const night = matches.find((f) => f.night)?.night ?? null;
  const bye = input.byes.get(round);
  return `<section class="card cp-gap" aria-labelledby="cp-next" data-testid="competition-next">
        <h2 class="section-title" id="cp-next">Next up</h2>
        <p class="detail-card-sub" data-testid="competition-next-night">Round ${round} · ${nightLine(night)}</p>
        <ul class="cp-list">${matches.map(renderMatch).join('')}</ul>${
          bye
            ? `<p class="detail-card-sub" data-testid="competition-next-bye">${esc(bye)} sits out this round.</p>`
            : ''
        }
      </section>`;
}

function renderStandings(input: CompetitionPageInput): string {
  if (!input.standings.length) return '';
  const draws = input.ruleset.draw !== null;
  const head = `<tr><th scope="col">#</th><th scope="col">Team</th><th scope="col"><abbr title="Played">P</abbr></th><th scope="col"><abbr title="Won">W</abbr></th>${
    draws ? '<th scope="col"><abbr title="Drawn">D</abbr></th>' : ''
  }<th scope="col"><abbr title="Lost">L</abbr></th><th scope="col"><abbr title="Score difference">+/-</abbr></th><th scope="col"><abbr title="Points">Pts</abbr></th></tr>`;
  const rows = input.standings
    .map(
      (r) =>
        `<tr data-testid="competition-standing"><td>${r.rank}</td><th scope="row">${esc(r.label)}</th><td>${r.played}</td><td>${r.won}</td>${
          draws ? `<td>${r.drawn}</td>` : ''
        }<td>${r.lost}</td><td>${r.diff > 0 ? `+${r.diff}` : r.diff}</td><td><strong>${r.points}</strong></td></tr>`
    )
    .join('');
  return `<section class="cp-gap" aria-labelledby="cp-table" data-testid="competition-standings">
        <h2 class="section-title" id="cp-table">Standings</h2>
        <table><thead>${head}</thead><tbody>${rows}</tbody></table>
        <p class="detail-card-sub" data-testid="competition-rule">${esc(input.ruleset.says)}</p>
      </section>`;
}

function renderRounds(input: CompetitionPageInput): string {
  const rounds = [...new Set(input.fixtures.map((f) => f.round))].sort((a, b) => a - b);
  if (!rounds.length) return '';
  return `<section class="cp-gap" aria-labelledby="cp-rounds" data-testid="competition-rounds">
        <h2 class="section-title" id="cp-rounds">Schedule and results</h2>
        ${rounds
          .map((round) => {
            const matches = input.fixtures.filter((f) => f.round === round);
            const night = matches.find((f) => f.night)?.night ?? null;
            const bye = input.byes.get(round);
            return `<div class="cp-gap" data-testid="competition-round" data-round="${round}">
          <h3 class="detail-card-label">Round ${round} · ${nightLine(night)}</h3>
          <ul class="cp-list">${matches.map(renderMatch).join('')}</ul>${
            bye ? `<p class="detail-card-sub">${esc(bye)} sits out.</p>` : ''
          }
        </div>`;
          })
          .join('')}
      </section>`;
}

export function renderCompetitionPage(input: CompetitionPageInput): string {
  const name = esc(input.name);
  const kind = FORMAT_LABELS[input.format];
  const range = dateRange(input.starts_on, input.ends_on);
  const sub = [kind, range, input.status === 'finished' ? 'Final' : '']
    .filter(Boolean)
    .map((s) => esc(s))
    .join(' · ');
  const empty =
    !input.fixtures.length && !input.standings.length
      ? `<p class="detail-card-sub cp-gap" data-testid="competition-empty">The schedule is not out yet. Check back soon.</p>`
      : '';
  const page = `<!DOCTYPE html>
<html lang="en" data-surface="ose-competition">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>${name} · Standings</title>
    <link rel="stylesheet" href="/ui.css" />
    <style>${COMPETITION_PAGE_CSS}</style>
  </head>
  <body>
    <header class="header">
      <a class="btn btn-link" href="/" data-testid="competition-home">OurSharedEvents</a>
      <a class="btn btn-link" href="/events" data-testid="competition-events">What's on</a>
    </header>
    <main id="main-content" data-testid="competition-page">
      <h1 data-testid="competition-name">${name}</h1>
      <p class="detail-card-sub" data-testid="competition-when">${sub}</p>
      ${renderNext(input)}
      ${renderStandings(input)}
      ${renderRounds(input)}
      ${empty}
    </main>
    <!--OCR_LEGAL_FOOTER-->
  </body>
</html>`;
  return injectLegalFooter(page, 'public');
}

/** The page a night's own event page could link to. */
export function competitionPagePath(id: string): string {
  return `/competitions/${encodeURIComponent(id)}`;
}

export { eventPagePath };
