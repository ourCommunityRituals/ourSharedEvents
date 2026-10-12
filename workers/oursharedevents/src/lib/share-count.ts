// ─── Share opens: what and when, never who (OSE-1684) ───────────────────────
//
// Owner 2026-10-09: a shared short link is measured ("anything that is being
// shared"), and the measure is "never who, only when" — and what. One number
// per event × screen × phase × UTC day (migration 0096, share_opens_daily),
// incremented in place. Nothing about the person is read or kept: no IP, no
// cookie, no device, no referrer. The user agent is looked at only to decide
// whether this was a link-preview robot, and is not stored.

/** The shared screens that are counted. The TV's /tv/ is typed, not shared. */
export type ShareScreen = 'event' | 'poster' | 'register' | 'checkin';

/**
 * Chat and social apps fetch a link the moment it is pasted, to draw its
 * preview card. That fetch is not a person opening the link, so it is not
 * counted; the link still answers it as usual. Also any agent with a versioned
 * bot token (Googlebot/2.1, bingbot/2.0) or that calls itself a crawler or
 * spider. A bare "bot" is not matched: a phone brand (CUBOT) carries it.
 * Pinterest's robots are Pinterestbot and Pinterest/0.x; a bare "pinterest"
 * would also match a person tapping a link inside the Pinterest app, whose
 * browser carries "Pinterest/iOS" (2026-10-10).
 */
const LINK_PREVIEW_AGENT =
  /facebookexternalhit|facebot|twitterbot|slackbot|slack-imgproxy|whatsapp|telegrambot|discordbot|linkedinbot|skypeuripreview|pinterestbot|pinterest\/0\.|redditbot|embedly|iframely|vkshare|google-pagerenderer|googleother|applebot|mastodon|bluesky|bot\/|crawler|spider/i;

export function isLinkPreviewAgent(userAgent: string | null): boolean {
  // No user agent at all is not a browser a person is holding.
  if (!userAgent || !userAgent.trim()) return true;
  return LINK_PREVIEW_AGENT.test(userAgent);
}

/**
 * Was this request made by a link-preview robot (or with no user agent)?
 *
 * The one place a counted link reads the browser name (ADR-001, amended
 * 2026-10-10): it is read here, reduced to yes or no, and dropped. Handlers call
 * this with the request and never read the header themselves; nothing derived
 * from it is stored or logged. tests/anonymity-gate.spec.ts holds every
 * User-Agent read in src/ to the named readers.
 */
export function isLinkPreviewRequest(request: Request): boolean {
  return isLinkPreviewAgent(request.headers.get('User-Agent'));
}

/** Add one open. Throws on a database failure; the caller never blocks on it. */
export async function recordShareOpen(
  db: D1Database,
  open: { eventId: string; screen: ShareScreen; phase: string; day: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO share_opens_daily (event_id, screen, phase, day, opens)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT (event_id, screen, phase, day) DO UPDATE SET opens = opens + 1`
    )
    .bind(open.eventId, open.screen, open.phase, open.day)
    .run();
}
