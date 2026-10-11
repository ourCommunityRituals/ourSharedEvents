/**
 * The picture on an event card (owner 2026-10-11): the event's poster art
 * when it has one, else the OSE default image.
 *
 * Poster art is the image an organizer uploads in admin's "Poster art" card
 * (OSE-1319). It is stored in R2 and served same-origin at /api/v2/uploads/…,
 * and events.cover_image_url points at it. The pages' CSP is img-src 'self'
 * data:, so only a path of that shape is shown. Anything else in the column
 * (it is free text, capped at 500 characters) gets the default, so a pasted
 * outside address never reaches the page.
 *
 * The default is the Ring (Ads → Pre-Events → Events → Post-Events →
 * SharedReports), on the same light tile as the default sponsor image, so it
 * reads on dark and light pages alike.
 */

export const EVENT_DEFAULT_THUMB_PATH = '/event-default-thumb.svg';

/** The R2 upload path admin's poster-art card stores, and nothing else. */
const UPLOAD_PATH = /^\/api\/v2\/uploads\/[A-Za-z0-9._/-]+$/;

/** The card's image: the poster art, or the default when there is none. */
export function eventThumbSrc(coverImageUrl: unknown): string {
  if (
    typeof coverImageUrl === 'string' &&
    UPLOAD_PATH.test(coverImageUrl) &&
    // A "." or ".." segment would let the browser climb out of /uploads/.
    !/(^|\/)\.{1,2}(\/|$)/.test(coverImageUrl)
  ) {
    return coverImageUrl;
  }
  return EVENT_DEFAULT_THUMB_PATH;
}

// Five stages, clockwise from 12 o'clock, on a ring of radius 70 around
// (120, 120). The Events stage is the larger dot.
const RING_DOTS: Array<[number, number, number, string]> = [
  [120, 50, 13, 'hsl(32 80% 50%)'], // Ads
  [186.6, 98.4, 13, 'hsl(205 65% 45%)'], // Pre-Events
  [161.1, 176.6, 17, 'hsl(222 25% 35%)'], // Events
  [78.9, 176.6, 13, 'hsl(150 45% 38%)'], // Post-Events
  [53.4, 98.4, 13, 'hsl(280 35% 48%)'], // SharedReports
];

export const EVENT_DEFAULT_THUMB_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">' +
  '<title>OurSharedEvents event</title>' +
  '<rect x="4" y="4" width="232" height="232" rx="36" fill="hsl(40 30% 97%)" ' +
  'stroke="hsl(222 15% 80%)" stroke-width="4"/>' +
  '<circle cx="120" cy="120" r="70" fill="none" stroke="hsl(222 15% 70%)" stroke-width="8"/>' +
  RING_DOTS.map(([x, y, r, fill]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join(
    ''
  ) +
  '</svg>';

/** Serve the default image. Same-origin, cached a day, locked down like the sponsor default. */
export function eventDefaultThumbResponse(): Response {
  return new Response(EVENT_DEFAULT_THUMB_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

/**
 * Swaps a card picture that fails to load (an upload that is gone) to the
 * default. It runs once at the end of the page, after the cards, so it also
 * catches a picture that failed before it ran. The default is a fixed path,
 * never read from the page. It is added by the page (injectEventThumbSwap),
 * never by the card list, so the list markup stays free of script.
 */
export const EVENT_THUMB_SWAP_SCRIPT =
  "<script>(function(){var d='" +
  EVENT_DEFAULT_THUMB_PATH +
  "';function s(i){if(i.getAttribute('src')!==d)i.setAttribute('src',d);}" +
  "document.querySelectorAll('img.event-thumb').forEach(function(i){if(i.complete&&i.naturalWidth===0)s(i);else i.addEventListener('error',function(){s(i);});});})();</script>";

/** Adds the swap script before </body> on a page that shows event cards. */
export function injectEventThumbSwap(html: string): string {
  const at = html.lastIndexOf('</body>');
  return at < 0 ? html : html.slice(0, at) + EVENT_THUMB_SWAP_SCRIPT + html.slice(at);
}
