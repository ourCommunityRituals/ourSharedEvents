/**
 * GET /competitions/:id — a competition's public schedule and standings
 * (OSE-527; phase 1 of the leagues design).
 *
 * Open to anyone with the link, no sign-in, no cookie read or set, nothing
 * stored. Rate-limited at the route. Only a competition that has started or
 * finished is public: a draft, an unknown id and an id that cannot be one all
 * answer the same 404, so a probe learns nothing from which one it hit.
 *
 * A night links to its event page only when that event page is itself public;
 * a night that is not shows its date and nothing more. The page reads the
 * competition tables and `events` (a night's date and whether it is public),
 * and nothing about a person.
 */

import { html, renderErrorPage } from './pages';
import { canRender, parseEventState } from '../domain/event-state';
import { readCompetition, readEntries, readFixtures } from './competitions';
import { byesOf, computeStandings, rulesetOf } from '../lib/competitions';
import { eventPagePath } from '../lib/canonical';
import { zonedDatePart } from '../lib/event-datetime';
import {
  renderCompetitionPage,
  type PageFixture,
  type PageNight,
} from '../lib/competition-page-render';

export interface CompetitionPageEnv {
  DB?: D1Database;
}

export function competitionNotFound(): Response {
  return renderErrorPage(
    404,
    "We couldn't find that league",
    "It may not have started yet, or the link may be wrong. See what's coming up next.",
    '/events',
    'Browse upcoming events'
  );
}

function unavailable(): Response {
  return renderErrorPage(
    503,
    "We're having trouble loading this league",
    'Our event service is briefly unavailable. Try again in a minute.',
    '/events',
    'Browse upcoming events'
  );
}

interface NightRow {
  id: string;
  slug: string | null;
  status: string | null;
  start_date: string | null;
  starts_at: string | null;
  timezone: string | null;
}

async function readNights(db: D1Database, ids: string[]): Promise<Map<string, PageNight>> {
  const out = new Map<string, PageNight>();
  // D1 allows 100 bound values in one statement: read in slices.
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    const rs = await db
      .prepare(
        `SELECT id, slug, status, start_date, starts_at, timezone FROM events
          WHERE id IN (${slice.map(() => '?').join(', ')})`
      )
      .bind(...slice)
      .all<NightRow>();
    for (const r of rs.results ?? []) {
      const day = r.starts_at ? zonedDatePart(r.starts_at, r.timezone) : (r.start_date ?? '');
      const open = canRender(parseEventState(r.status ?? ''), 'public');
      out.set(r.id, {
        event_id: r.id,
        day: /^\d{4}-\d{2}-\d{2}/.exec(day)?.[0] ?? '',
        href: open ? eventPagePath(encodeURIComponent(r.id), r.slug) : null,
      });
    }
  }
  return out;
}

export async function handleCompetitionPage(
  _request: Request,
  env: CompetitionPageEnv,
  rawId: string
): Promise<Response> {
  if (!env.DB) return unavailable();
  if (!/^cmp_[0-9a-f]{32}$/.test(rawId)) return competitionNotFound();
  const db = env.DB;
  try {
    const c = await readCompetition(db, rawId);
    if (!c || (c.status !== 'active' && c.status !== 'finished')) return competitionNotFound();
    const entries = await readEntries(db, c.id);
    const fixtures = await readFixtures(db, c.id);
    const ruleset = rulesetOf(c.ruleset);
    const labels = new Map(entries.map((e) => [e.id, e.label]));
    const nights = await readNights(db, [
      ...new Set(fixtures.map((f) => f.event_id).filter((v): v is string => !!v)),
    ]);
    const pageFixtures: PageFixture[] = fixtures.map((f) => ({
      round: f.round,
      a: labels.get(f.entry_a) ?? 'Team',
      b: labels.get(f.entry_b) ?? 'Team',
      slot_label: f.slot_label,
      slot_time: f.slot_time,
      status: f.status,
      // Only a counted score is shown; a disputed or provisional one waits.
      score_a: f.state === 'confirmed' || f.state === 'final' ? f.score_a : null,
      score_b: f.state === 'confirmed' || f.state === 'final' ? f.score_b : null,
      night: f.event_id ? (nights.get(f.event_id) ?? null) : null,
    }));
    // Who sits out a round: the teams in play that the round does not use.
    const active = entries.filter((e) => e.is_active === 1).map((e) => e.id);
    const byeIds = byesOf(
      active,
      fixtures.map((f) => ({ round: f.round, a: f.entry_a, b: f.entry_b }))
    );
    const byes = new Map(
      [...byeIds].map(([round, id]) => [round, labels.get(id) ?? 'A team'] as [number, string])
    );
    const res = html(
      renderCompetitionPage({
        name: c.name,
        format: c.format,
        status: c.status,
        starts_on: c.starts_on,
        ends_on: c.ends_on,
        ruleset,
        standings: computeStandings(entries, fixtures, ruleset),
        fixtures: pageFixtures,
        byes,
        today: new Date().toISOString().slice(0, 10),
      })
    );
    // Short and private: a score can be entered at any minute of a league night.
    res.headers.set('Cache-Control', 'private, max-age=30');
    res.headers.set('X-Robots-Tag', 'noindex');
    return res;
  } catch {
    return unavailable();
  }
}
