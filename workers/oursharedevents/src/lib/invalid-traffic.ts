// ─── Invalid-traffic (IVT) filtration for the sponsor proof layer ─────────────
//
// OSE-1310. `sponsor_impressions` is not a metrics table — it is the PROOF
// LAYER. Its rows are what a sponsor is shown (and, eventually, billed) against
// via the SharedReport. D3 (CCR 2026-09-14) closed the first hole: a write is
// now refused unless the (event, sponsor) pair is a resolved, brand-matched,
// active placement. That proves the PAIR is real. It does not prove the EVENT
// OF SEEING was real.
//
// What was still writable after D3: anyone who knows one valid (event, sponsor)
// pair — it is public, it renders on a public page — could POST the same beacon
// in a loop and inflate that sponsor's numbers. The only control in front of it
// was `publicReadLimited`, a READ-sized 120/min allowance borrowed from the map
// endpoint. 120 writes/min/IP into a billing-adjacent table is not a control.
//
// This module is the missing filter. Three refusals, all decided at REQUEST
// time:
//
//   1. BOT — a crawler, preview fetcher, or scripted client is not a person who
//      saw a poster. This is the oldest rule in ad measurement: automated
//      traffic is excluded from counts, not counted and apologised for later.
//   2. DUPLICATE — the same caller re-firing the same beacon for the same
//      (event, sponsor, surface, placement) inside a short window is ONE
//      impression. This is the control that actually kills replay inflation:
//      the flood limit caps the RATE, dedup caps the TOTAL.
//   3. FLOOD — a write-sized cadence ceiling, an order of magnitude below the
//      read allowance, for anything that gets past the first two.
//
// ── The hard constraint: this must not become a tracker ──────────────────────
//
// OSE-662 attack 2 fixed the shape of this table: `sponsor_impressions` carries
// ZERO attendee-identifying columns (no ip, ip_hash, ua, anon_id, session,
// device, fingerprint) and `impression-privacy.spec.ts` enforces that against
// the live schema. Bot-and-duplicate detection is exactly the kind of well-meant
// infrastructure that would quietly reintroduce one — "we only keep a device
// hash, and only to dedupe."
//
// So the rule here is absolute: every signal this module reads (IP, User-Agent,
// CF bot score) is read, used to reach a boolean, and DROPPED. Nothing derived
// from a visitor is written to D1. The only thing that outlives the request is a
// SHA-256 KV key with a TTL measured in minutes, which is opaque, un-enumerable,
// and self-deleting — the same primitive `lib/rate-limit.ts` already hashes its
// buckets with, for the same reason.
//
// ── Fails open, deliberately ─────────────────────────────────────────────────
//
// If KV is unbound or throws, traffic is COUNTED. Consistent with
// public-read-limit.ts: the failure mode of a filter that fails closed is that a
// storage blip silently zeroes a sponsor's proof layer, and a missing impression
// is not recoverable after the fact. Over-counting during an outage is visible,
// bounded, and correctable; under-counting is neither. Bot classification is
// header-only and so keeps working regardless.

import { checkRateLimit, clientIp, pepperedKeyHash, type RateLimitEnv } from './rate-limit';

export type InvalidTrafficEnv = Partial<RateLimitEnv>;

/** Why a beacon was not counted. Server-side only — never returned to callers. */
export type IvtReason = 'bot' | 'duplicate' | 'flood';

export interface IvtVerdict {
  /** True when the beacon may be written to the proof layer. */
  counted: boolean;
  reason?: IvtReason;
}

/**
 * Write-sized cadence ceiling: beacons per minute per caller, per event.
 *
 * 20/min is deliberately an order of magnitude under the 120/min READ
 * allowance. A real surface fires one impression per sponsor per render; a page
 * with a full sponsor strip re-rendering every few seconds stays under this. A
 * loop does not.
 */
export const IMPRESSION_WRITE_MAX = 20;

/**
 * Dedup window in seconds for an identical IMPRESSION beacon from the same
 * caller: one hour (OSE-1421). An impression is "this caller was shown this
 * sponsor here", and nothing finer than the hour is ever kept or counted, so one
 * caller adds at most one row per sponsor, surface and placement per hour. It
 * was 300 s, which let one caller add a row every five minutes (12 an hour).
 */
export const IMPRESSION_DEDUP_TTL_SECONDS = 3600;

/**
 * Dedup window for an identical CLICK beacon: unchanged at 300 s, the same as
 * the QR-scan dedup window in `handlers/qr-scan.ts`. The hour window above is
 * for impressions only.
 */
export const CLICK_DEDUP_TTL_SECONDS = 300;

/**
 * User-agent substrings that mark a non-human client.
 *
 * Conservative and lowercase-matched. These are self-declared tokens: a hostile
 * client will simply not send them, which is fine — this rule exists to stop
 * HONEST automation (crawlers, uptime monitors, link previewers, CI) from
 * landing in a sponsor's proof layer, not to defeat an adversary. The adversary
 * is what dedup and the flood ceiling are for.
 */
const BOT_UA_MARKERS = [
  'bot',
  'crawler',
  'crawl',
  'spider',
  'slurp',
  'curl/',
  'wget',
  'python-requests',
  'python-urllib',
  'go-http-client',
  'java/',
  'okhttp',
  'headlesschrome',
  'phantomjs',
  'puppeteer',
  'playwright',
  'scrapy',
  'axios/',
  'node-fetch',
  'uptime',
  'pingdom',
  'lighthouse',
  'gtmetrix',
];

/**
 * Cloudflare bot score at or below which traffic is treated as automated.
 *
 * CF scores 1–99, where 1 is "certainly a bot" and 99 is "certainly human".
 * 30 is Cloudflare's own documented "likely automated" boundary. The field is
 * only present on accounts with Bot Management; when absent we fall through to
 * the header heuristic rather than guessing.
 */
export const BOT_SCORE_THRESHOLD = 30;

interface CfBotProperties {
  botManagement?: {
    score?: number;
    verifiedBot?: boolean;
  };
}

/**
 * Is this request automated?
 *
 * Reads `request.cf.botManagement` when Cloudflare provides it, and falls back
 * to a User-Agent heuristic. Both inputs are consumed here and discarded — this
 * function returns a boolean and nothing else escapes it.
 */
export function isAutomatedClient(request: Request): boolean {
  const cf = (request as Request & { cf?: CfBotProperties }).cf;
  const bm = cf?.botManagement;

  // A verified bot is a declared, known crawler (Googlebot et al). Never a view.
  if (bm?.verifiedBot === true) return true;
  if (typeof bm?.score === 'number' && bm.score > 0 && bm.score <= BOT_SCORE_THRESHOLD) {
    return true;
  }

  const ua = (request.headers.get('User-Agent') ?? '').toLowerCase();
  // A real browser always sends a User-Agent. An empty one is a scripted client
  // that did not bother to forge one.
  if (ua.trim() === '') return true;
  return BOT_UA_MARKERS.some((marker) => ua.includes(marker));
}

export interface BeaconDescriptor {
  eventId: string;
  sponsorId: string;
  surface: string;
  placement: string;
  /** 'impression' | 'click' — a click after an impression is not a duplicate. */
  kind: string;
}

/**
 * Has this exact beacon already been counted for this caller, in this window?
 *
 * The KV key is a peppered hash of caller + beacon identity (OSE-1447: event
 * and sponsor ids are public, so a bare SHA-256 would reverse to the IP), so the
 * stored key reveals neither the IP nor which sponsor was seen, and it expires
 * on its own.
 */
async function isDuplicateBeacon(
  request: Request,
  env: RateLimitEnv,
  beacon: BeaconDescriptor
): Promise<boolean> {
  const kv = env.RATE_LIMIT_KV;
  const fingerprint = await pepperedKeyHash(
    [
      clientIp(request),
      beacon.eventId,
      beacon.sponsorId,
      beacon.surface,
      beacon.placement,
      beacon.kind,
    ].join('|'),
    env.RATE_LIMIT_KEY_PEPPER
  );
  const key = `ivt:dedup:${fingerprint}`;
  if ((await kv.get(key)) !== null) return true;
  await kv.put(key, '1', {
    expirationTtl:
      beacon.kind === 'impression' ? IMPRESSION_DEDUP_TTL_SECONDS : CLICK_DEDUP_TTL_SECONDS,
  });
  return false;
}

/**
 * Decide whether a sponsor impression/click beacon may enter the proof layer.
 *
 * Order matters: bot classification is free and header-only, so it runs before
 * anything touches KV — a crawler storm costs zero KV operations. Dedup runs
 * before the flood ceiling so that a duplicate is reported as a duplicate
 * rather than consuming cadence budget.
 *
 * Callers must treat a `counted: false` verdict as "return success, write
 * nothing" — see the note on response shape in `handlers/sponsors.ts`.
 */
export async function classifyBeacon(
  request: Request,
  env: InvalidTrafficEnv,
  beacon: BeaconDescriptor
): Promise<IvtVerdict> {
  if (isAutomatedClient(request)) return { counted: false, reason: 'bot' };

  if (!env.RATE_LIMIT_KV) return { counted: true }; // fail open — see the header
  const store = env as RateLimitEnv; // KV checked just above

  try {
    if (await isDuplicateBeacon(request, store, beacon)) {
      return { counted: false, reason: 'duplicate' };
    }
    const flooded = await checkRateLimit(
      store,
      `ivt:${beacon.kind}:${beacon.eventId}:${clientIp(request)}`,
      IMPRESSION_WRITE_MAX
    );
    if (flooded) return { counted: false, reason: 'flood' };
  } catch {
    return { counted: true }; // fail open — see the header
  }

  return { counted: true };
}
