/**
 * OSE-1420 — the code ledger: one server-side answer to "which of this
 * event's codes are live, and why not".
 *
 * The admin cards are a TRUTH surface. A URL or a QR picture is shown ONLY
 * when the server has marked that code live; otherwise the card shows the
 * reason, in the organiser's words. So an admin can trust both directions:
 * anything displayed works right now, and anything missing says why.
 *
 * A code is LIVE when its own validity AND the event's state both hold:
 *   - short link (`/s/:code`, the digital-poster QR): the code has a valid
 *     shape and a valid target, AND the event is `active` and listed
 *     (`is_published = 1`) — the public page 404s otherwise (handlers/pages.ts).
 *     A code with an external https target still needs the event live: a
 *     poster for an unpublished event is the thing this module exists to stop.
 *   - poster deployment (`/q/:token`, the physical scan): `is_active = 1`
 *     (qr-scan.ts redirects an inactive token home), AND the event is live
 *     (form-pages forwards a non-active event away from its form).
 *
 * Decisions are pure functions over rows so they unit-test without a
 * runtime; `buildCodeLedger` is the only D1-touching entry point and it is
 * READ-ONLY — it never mints a short link (contrast handlers/poster-codes.ts,
 * whose GET mints the public slot when nothing is saved; the ledger logs
 * that a code was created, it never creates one).
 */

import { isValidCodeShape, isValidHttpsTarget } from './shortlinks';
import { generateQrCode } from './qr';
import { collectGoLiveEvidence, type GoLiveEvidence } from './go-live-evidence';

export type LedgerLevel = 'info' | 'warn';

export interface LedgerReason {
  level: LedgerLevel;
  /** Stable, machine-readable. The UI keys copy and tests key assertions on it. */
  code: string;
  /** Organiser-readable. Printed on the card verbatim. */
  message: string;
}

export interface LedgerEventRow {
  id: string;
  status: string | null;
  is_published: number | null;
}

export interface LedgerShortlinkRow {
  code: string;
  kind: string | null;
  target_url: string | null;
  created_at?: string | null;
}

export interface LedgerDeploymentRow {
  id: string;
  qr_token: string;
  placement_label: string | null;
  is_active: number;
  created_at?: string | null;
}

export interface LedgerCode {
  kind: 'shortlink' | 'deployment';
  /** shortlink code or deployment id */
  id: string;
  label: string;
  /** The code passes its own checks (shape/target, or is_active). */
  valid: boolean;
  /** valid AND the event is live. Only then are `url`/`qr` present. */
  live: boolean;
  reasons: LedgerReason[];
  /** Present ONLY when live. */
  url?: string;
  /** PNG data URI. Present ONLY when live (and generation succeeded). */
  qr?: string;
  created_at?: string | null;
}

export interface CodeLedger {
  event: { id: string; status: string; is_published: number };
  /** The event-level half of "live". */
  event_live: boolean;
  codes: LedgerCode[];
  /** Event-level and gap-level messages, in display order. */
  log: LedgerReason[];
  evidence: GoLiveEvidence;
}

// ─── Pure decisions ──────────────────────────────────────────────────────────

const EVENT_STATUS_REASON: Record<string, LedgerReason> = {
  draft: {
    level: 'info',
    code: 'EVENT_DRAFT',
    message: 'Draft — links and QR codes switch on when you publish.',
  },
  ready: {
    level: 'info',
    code: 'EVENT_READY',
    message: 'Ready — publish to switch the links and QR codes on.',
  },
  archived: {
    level: 'info',
    code: 'EVENT_ARCHIVED',
    message: 'Archived — links and QR codes are switched off. Reopen to switch them on.',
  },
};

/** The event-level half of liveness, with the reason when it fails. */
export function decideEventLive(ev: LedgerEventRow): { live: boolean; reasons: LedgerReason[] } {
  const status = (ev.status ?? 'draft').toLowerCase();
  if (status !== 'active') {
    const reason = EVENT_STATUS_REASON[status] ?? {
      level: 'warn' as const,
      code: 'EVENT_STATUS_UNKNOWN',
      message: `Status "${status}" is not one the platform knows — nothing is switched on.`,
    };
    return { live: false, reasons: [reason] };
  }
  if (ev.is_published !== 1) {
    return {
      live: false,
      reasons: [
        {
          level: 'warn',
          code: 'EVENT_UNLISTED',
          message:
            'Published but kept off the public map — the event page returns 404, so its links and QR codes are off until it is listed.',
        },
      ],
    };
  }
  return { live: true, reasons: [] };
}

function shortlinkLabel(kind: string | null): string {
  const k = (kind ?? 'public').toLowerCase();
  if (k === 'public' || k === '') return 'Event page link';
  if (k === 'checkin') return 'Check-in link';
  if (k === 'donation') return 'Donate link';
  if (k === 'signup') return 'Sign-up link';
  return `${k.charAt(0).toUpperCase()}${k.slice(1)} link`;
}

/** One short link's own validity, then its liveness given the event's. */
export function decideShortlink(
  row: LedgerShortlinkRow,
  eventLive: { live: boolean; reasons: LedgerReason[] },
  origin: string
): LedgerCode {
  const reasons: LedgerReason[] = [];
  let valid = true;
  if (!isValidCodeShape(row.code)) {
    valid = false;
    reasons.push({
      level: 'warn',
      code: 'SHORTLINK_INVALID_CODE',
      message:
        'This short link code is malformed and will never resolve. Re-save the poster codes.',
    });
  }
  if (row.target_url !== null && row.target_url !== '' && !isValidHttpsTarget(row.target_url)) {
    valid = false;
    reasons.push({
      level: 'warn',
      code: 'SHORTLINK_INVALID_TARGET',
      message:
        'This short link points at a link that is not https:// — it will not open. Fix the link.',
    });
  }
  const live = valid && eventLive.live;
  if (valid && !eventLive.live) reasons.push(...eventLive.reasons);
  const out: LedgerCode = {
    kind: 'shortlink',
    id: row.code,
    label: shortlinkLabel(row.kind),
    valid,
    live,
    reasons,
    created_at: row.created_at ?? null,
  };
  if (live) {
    out.url = `${origin}/s/${row.code}`;
    try {
      out.qr = generateQrCode(out.url, { errorCorrection: 'M', scale: 4 });
    } catch {
      /* a QR that cannot be drawn is not a reason to hide the link */
    }
  }
  return out;
}

/** One poster deployment's own validity, then its liveness given the event's. */
export function decideDeployment(
  row: LedgerDeploymentRow,
  eventLive: { live: boolean; reasons: LedgerReason[] },
  origin: string
): LedgerCode {
  const reasons: LedgerReason[] = [];
  const valid = row.is_active === 1;
  if (!valid) {
    reasons.push({
      level: 'info',
      code: 'DEPLOYMENT_INACTIVE',
      message: 'Switched off — a scan of this poster goes to the home page, not the event.',
    });
  }
  const live = valid && eventLive.live;
  if (valid && !eventLive.live) reasons.push(...eventLive.reasons);
  const out: LedgerCode = {
    kind: 'deployment',
    id: row.id,
    label: row.placement_label?.trim() ? `Poster QR — ${row.placement_label.trim()}` : 'Poster QR',
    valid,
    live,
    reasons,
    created_at: row.created_at ?? null,
  };
  if (live) {
    out.url = `${origin}/q/${encodeURIComponent(row.qr_token)}`;
    try {
      out.qr = generateQrCode(out.url, { errorCorrection: 'M', scale: 4 });
    } catch {
      /* see above */
    }
  }
  return out;
}

/**
 * The event-level log: status first, then every gap an organiser would
 * otherwise have to infer from an empty card.
 */
export function buildLedgerLog(
  ev: LedgerEventRow,
  eventLive: { live: boolean; reasons: LedgerReason[] },
  shortlinks: LedgerShortlinkRow[],
  deployments: LedgerDeploymentRow[]
): LedgerReason[] {
  const log: LedgerReason[] = [...eventLive.reasons];
  if (eventLive.live) {
    log.push({
      level: 'info',
      code: 'EVENT_LIVE',
      message: 'Published — every code shown below works right now.',
    });
  }
  if (shortlinks.length === 0) {
    log.push({
      level: 'warn',
      code: 'SHORTLINK_NOT_CREATED',
      message:
        'Event page link — not created. Short-link generation failed when the event was created, so no share link or QR exists. Open "Codes on the poster" to create one.',
    });
  }
  const active = deployments.filter((d) => d.is_active === 1).length;
  if (deployments.length === 0) {
    log.push({
      level: 'info',
      code: 'POSTER_NONE',
      message: 'Poster QR — none placed yet. Place a poster to get a scannable code for it.',
    });
  } else if (active === 0) {
    log.push({
      level: 'warn',
      code: 'POSTER_ALL_INACTIVE',
      message: `Poster QR — ${deployments.length} placed, all switched off.`,
    });
  }
  void ev;
  return log;
}

// ─── The one D1 entry point (read-only) ──────────────────────────────────────

export interface CodeLedgerEnv {
  DB: D1Database;
}

/** Null when the event does not exist. Never mints anything. */
export async function buildCodeLedger(
  env: CodeLedgerEnv,
  eventId: string,
  origin: string
): Promise<CodeLedger | null> {
  const ev = await env.DB.prepare('SELECT id, status, is_published FROM events WHERE id = ?')
    .bind(eventId)
    .first<LedgerEventRow>();
  if (!ev) return null;

  const [links, deps, evidence] = await Promise.all([
    env.DB.prepare(
      `SELECT code, COALESCE(NULLIF(kind, ''), 'public') AS kind, target_url, created_at
         FROM shortlinks WHERE event_id = ?
        ORDER BY CASE WHEN kind IS NULL OR kind = 'public' THEN 0 ELSE 1 END, created_at ASC`
    )
      .bind(eventId)
      .all<LedgerShortlinkRow>(),
    env.DB.prepare(
      `SELECT id, qr_token, placement_label, is_active, created_at
         FROM poster_deployments WHERE event_id = ? ORDER BY created_at DESC`
    )
      .bind(eventId)
      .all<LedgerDeploymentRow>(),
    collectGoLiveEvidence(env.DB, eventId),
  ]);
  const shortlinks = links.results ?? [];
  const deployments = deps.results ?? [];

  const eventLive = decideEventLive(ev);
  const codes: LedgerCode[] = [
    ...shortlinks.map((r) => decideShortlink(r, eventLive, origin)),
    ...deployments.map((r) => decideDeployment(r, eventLive, origin)),
  ];

  return {
    event: {
      id: ev.id,
      status: (ev.status ?? 'draft').toLowerCase(),
      is_published: ev.is_published === 1 ? 1 : 0,
    },
    event_live: eventLive.live,
    codes,
    log: buildLedgerLog(ev, eventLive, shortlinks, deployments),
    evidence,
  };
}
