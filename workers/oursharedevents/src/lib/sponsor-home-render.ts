/**
 * Pure render for the sponsor-home page (/sponsor).
 *
 * Extracted from handlers/sponsor-home.ts (CCR-PR567 re-run items 6 + 8) so the
 * POPULATED page — placement cards, not just the empty shell — can be rendered
 * with NO env, NO DB and NO async. That makes it reachable by:
 *   • the a11y-axe gate (jsdom), which previously could only scan the empty shell
 *     and (falsely) claimed placement-card a11y was covered elsewhere;
 *   • a born-red XSS lock over the sponsor name + attacker-influenced placement
 *     fields (title / location / tier).
 *
 * The one env-bound concern — the sponsor-scoped SharedReport link, which needs
 * an async token mint — is injected as a synchronous `reportLinkFor(eventId)`
 * callback: the handler pre-mints the links, this stays pure. Markup is kept
 * byte-identical to the previous inline render (guarded by sponsor-home.spec.ts).
 */

import SPONSOR_HOME_HTML from '../templates/sponsor-home.html';
import { injectLegalFooter } from './legal-footer';
import { injectMarker } from './inject-marker';
import { escapeHtml as esc } from './html-escape';
import { computeEventPhase } from '../domain/event-phase';
import { parseEventState, canRender } from '../domain/event-state';
import type { FlooredPreEventActivity } from './pre-event-activity';
import type { FlooredCount } from './count-floor';
import type { DiscoverableEvent, SponsorRequestRow } from './sponsor-discovery';

export interface PlacementRow {
  placement_id: string;
  event_id: string;
  tier: string;
  locality_band: number;
  organizer_accepted: number | null;
  sponsor_accepted: number | null;
  placement_active: number;
  title: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  is_published: number;
  timezone?: string | null;
}

export function humanDate(iso: string | null): string {
  if (!iso) return 'Date to be announced';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  // An unreadable value is treated as no date: the page never prints a stored string as is.
  if (Number.isNaN(d.getTime())) return 'Date to be announced';
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export interface SponsorHomeRenderInput {
  sponsor: { id: string; name: string };
  placements: PlacementRow[];
  /** ISO timestamp the link expires — rendered human-friendly. */
  expiresIso: string;
  /**
   * Resolves the sponsor-scoped SharedReport URL for an event, or null when
   * there is none. The handler pre-mints these (async) so this render is pure.
   * Only consulted for active / archived placements, matching the prior inline
   * behaviour.
   */
  reportLinkFor?: (eventId: string) => string | null;
  /**
   * Poster reach during the pre-event window, already FLOORED (K=5) by the
   * caller — this render never sees a raw scan or tap count. Consulted only for
   * placements the sponsor accepted (their name is only on those posters).
   */
  preEventReachFor?: (eventId: string) => FlooredPreEventActivity | null;
  /** Sponsor discovery: published, upcoming events this sponsor is not on yet. */
  discoverable?: DiscoverableEvent[];
  /** Requests this sponsor has sent that are not switched on (waiting / declined). */
  requests?: SponsorRequestRow[];
}

/** "Your requests" + "Events you could back" (lib/sponsor-discovery). */
function renderDiscovery(discoverable: DiscoverableEvent[], requests: SponsorRequestRow[]): string {
  const parts: string[] = [];
  if (requests.length) {
    const cards = requests.map((r) => {
      const waiting = r.organizer_accepted == null;
      return `<article class="sh-card${waiting ? '' : ' declined'}" data-testid="request-card" data-placement-id="${esc(r.placement_id)}" data-event-id="${esc(r.event_id)}">
        <h2 data-testid="request-title">${esc(r.title)}</h2>
        <p class="sh-when">${esc(humanDate(r.start_date))}</p>
        <p class="sh-meta"><span class="sh-state ${waiting ? 'pending' : 'declined'}" data-testid="request-state">${waiting ? 'Waiting for the organizer' : 'The organizer said no'}</span></p>
      </article>`;
    });
    parts.push(
      `<p class="sh-section-title">Your requests</p><div class="sh-list" data-testid="sponsor-home-requests">${cards.join('')}</div>`
    );
  }
  const cards = discoverable.map(
    (e) => `<article class="sh-card" data-testid="discover-card" data-event-id="${esc(e.id)}">
        <h2 data-testid="discover-title">${esc(e.title)}</h2>
        <p class="sh-when">${esc(humanDate(e.start_date))}</p>
        <p class="sh-meta">${e.location ? esc(e.location) : ''}${Number(e.near) === 1 ? `${e.location ? ' · ' : ''}<span class="sh-state live" data-testid="discover-near">Near you</span>` : ''}</p>
        <p class="sh-why">Asking tells the organizer you would like to back this event. Your name appears only if they say yes.</p>
        <div class="sh-actions"><button type="button" class="btn btn-primary" data-action="sponsor-request" data-event-id="${esc(e.id)}" data-testid="discover-ask">Ask to join</button></div>
        <p class="sh-msg" role="status" aria-live="polite"></p>
      </article>`
  );
  parts.push(
    cards.length
      ? `<p class="sh-section-title">Events you could back</p><div class="sh-list" data-testid="sponsor-home-discover">${cards.join('')}</div>`
      : `<p class="sh-section-title">Events you could back</p><div class="sh-empty" data-testid="sponsor-home-discover-empty">Nothing new to ask about right now. When an organizer publishes an upcoming event, it shows up here.</div>`
  );
  return parts.join('');
}

/** "12" / "fewer than 5" — a floored count as words. */
function floored(f: FlooredCount): string {
  return f.suppressed || f.count == null ? `fewer than ${f.floor}` : String(f.count);
}

/**
 * The sponsor's pre-event reach line: how many posters carry their name, in how
 * many places, and how the posters are being used. Counts only — never who.
 */
export function renderPreEventReach(r: FlooredPreEventActivity): string {
  // Link taps lead: the shared event link (friends and family → the event
  // page, where this sponsor's name shows) is the big driver; posters come
  // second and widen the reach into places.
  const taps = `So far: ${floored(r.clicks)} link taps · ${floored(r.scans)} poster scans.`;
  if (r.posters === 0) {
    return `<p class="sh-why" data-testid="placement-reach">${taps} No posters up yet.</p>`;
  }
  const posters = `${r.posters} poster${r.posters === 1 ? '' : 's'}`;
  const places = r.places > 0 ? ` in ${r.places} place${r.places === 1 ? '' : 's'}` : '';
  return `<p class="sh-why" data-testid="placement-reach">${taps} Your name is on ${posters}${places}.</p>`;
}

/** Build the full /sponsor page HTML (populated or empty). Pure — no env/DB. */
export function renderSponsorHomePage(input: SponsorHomeRenderInput): string {
  const { sponsor, placements, expiresIso, reportLinkFor, preEventReachFor } = input;
  const discovery = renderDiscovery(input.discoverable ?? [], input.requests ?? []);

  let live = 0;
  let upcoming = 0;
  let pending = 0;
  const cards: string[] = [];
  for (const p of placements) {
    const state = parseEventState(p.status);
    const phase = computeEventPhase({
      status: p.status,
      start_date: p.start_date,
      end_date: p.end_date,
    });
    const publicOk = canRender(state, 'public');
    const isPending = p.sponsor_accepted == null;
    const declined = p.sponsor_accepted === 0;
    if (isPending) pending++;
    if (publicOk && phase === 'event') live++;
    if (publicOk && phase === 'pre_event') upcoming++;

    let stateLabel = 'Not yet listed';
    let stateCls = 'done';
    if (state === 'archived' || phase === 'post_event') {
      stateLabel = 'Over';
      stateCls = 'done';
    } else if (publicOk && phase === 'event') {
      stateLabel = 'Live now';
      stateCls = 'live';
    } else if (publicOk) {
      stateLabel = 'Coming up';
      stateCls = 'soon';
    } else {
      stateLabel = 'Organizer still setting up';
      stateCls = 'done';
    }
    const answerLabel = isPending ? 'Please confirm' : declined ? 'Declined' : 'Accepted';
    const answerCls = isPending ? 'pending' : declined ? 'declined' : 'live';

    const links: string[] = [];
    if (publicOk && state === 'active') {
      links.push(
        `<a class="btn btn-secondary" href="/events/${esc(p.event_id)}" data-testid="placement-public-link">Event page</a>`
      );
    }
    // Report: only once there is something to report (active or over). The
    // token is sponsor-scoped so the report shows this sponsor only. The URL is
    // minted by the caller (encoded components + a base64url token — trusted).
    if (state === 'active' || state === 'archived') {
      const reportUrl = reportLinkFor ? reportLinkFor(p.event_id) : null;
      if (reportUrl) {
        links.push(
          `<a class="btn btn-secondary" href="${reportUrl}" data-testid="placement-report-link">Your report</a>`
        );
      }
    }
    const respond =
      `<button type="button" class="btn ${declined ? 'btn-secondary' : 'btn-primary'}" data-action="placement-respond" data-placement-id="${esc(p.placement_id)}" data-accepted="1" data-testid="placement-accept"${!isPending && !declined ? ' hidden' : ''}>Accept</button>` +
      `<button type="button" class="btn btn-secondary" data-action="placement-respond" data-placement-id="${esc(p.placement_id)}" data-accepted="0" data-testid="placement-decline"${declined ? ' hidden' : ''}>Decline</button>`;

    cards.push(
      `<article class="sh-card${isPending ? ' needs-answer' : ''}${declined ? ' declined' : ''}" data-testid="placement-card" data-placement-id="${esc(p.placement_id)}" data-event-id="${esc(p.event_id)}" data-sponsor-accepted="${isPending ? '' : p.sponsor_accepted}" data-was-pending="${isPending ? '1' : '0'}">
        <h2 data-testid="placement-title">${esc(p.title)}</h2>
        <p class="sh-when" data-testid="placement-when">${esc(humanDate(p.start_date))}</p>
        <p class="sh-meta">${p.location ? esc(p.location) + ' · ' : ''}${esc(p.tier)} placement${Number(p.locality_band) === 1 ? ' · local' : ''}</p>
        <p class="sh-meta"><span class="sh-state ${stateCls}" data-testid="placement-event-state">${stateLabel}</span><span class="sh-state ${answerCls}" data-testid="placement-state">${answerLabel}</span></p>
        ${isPending ? `<p class="sh-why" data-testid="placement-why">Accepting shows your name on this event's page, poster, and live screen.</p>` : ''}
        ${(() => {
          // Pre-event window: an accepted, listed, not-yet-started placement
          // shows how far the posters carrying this sponsor's name are reaching.
          if (p.sponsor_accepted !== 1 || !publicOk || phase !== 'pre_event' || !preEventReachFor)
            return '';
          const reach = preEventReachFor(p.event_id);
          return reach ? renderPreEventReach(reach) : '';
        })()}
        <div class="sh-actions">${links.join('')}${respond}</div>
        <p class="sh-msg" role="status" aria-live="polite"></p>
      </article>`
    );
  }

  const list =
    cards.length === 0
      ? `<div class="sh-empty" data-testid="sponsor-home-empty">No placements yet. When an organizer adds you to an event, it shows up here.</div>`
      : `<p class="sh-section-title">Your placements</p><div class="sh-list" data-testid="sponsor-home-list">${cards.join('')}</div>`;

  // injectMarker (not String.replace) so a sponsor name or placement markup
  // carrying a `$` cannot splice the trusted page shell (CCR-PR567 H1).
  let page = injectMarker(SPONSOR_HOME_HTML, '<!--OCR_SPONSOR_ID-->', esc(sponsor.id));
  page = injectMarker(page, '<!--OCR_SPONSOR_NAME-->', esc(sponsor.name));
  page = injectMarker(page, '<!--OCR_COUNT_LIVE-->', String(live));
  page = injectMarker(page, '<!--OCR_COUNT_UPCOMING-->', String(upcoming));
  page = injectMarker(page, '<!--OCR_COUNT_PENDING-->', String(pending));
  page = injectMarker(page, '<!--OCR_SPONSOR_PLACEMENTS-->', list + discovery);
  page = injectMarker(page, '<!--OCR_EXPIRES-->', esc(humanDate(expiresIso)));

  return injectLegalFooter(page, 'public');
}
