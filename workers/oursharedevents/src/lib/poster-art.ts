// ─── Poster art on public surfaces (OSE-1370) ────────────────────────────────
//
// `events.cover_image_url` is written by the admin Poster art card: it uploads
// through POST /api/v2/admin/events/:id/uploads (R2, MIME + 25MB re-validated
// server-side) and PUTs the returned SAME-ORIGIN path,
// `/api/v2/uploads/events/<eventId>/<timestamp>-<name>.<ext>`, served publicly
// by handleGetUploadedFile.
//
// The column itself is only length-checked on write, so every public surface
// re-validates at render time through this one function. The rule is stricter
// than validateLogoUrl on purpose: ONLY our own upload path, ONLY an image
// extension. That means
//   - no scheme can reach an `src` (javascript:, data:, http:, https:),
//   - a visitor's browser never requests art from a third party (never-who: the
//     page loads nothing that could see who is looking), and
//   - og:image is always an absolute URL on our origin.
// An https URL an admin typed by hand is ignored here (the poster print view
// still shows it); the fallback tile renders instead.

const UPLOAD_ART_PATH =
  /^\/api\/v2\/uploads\/events\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9._-]{1,200}\.(?:jpe?g|png|webp|gif)$/i;

/** The same-origin art path, or null when there is no usable art. */
export function posterArtPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 500 || raw.includes('..')) return null;
  return UPLOAD_ART_PATH.test(raw) ? raw : null;
}

/** Absolute art URL on `origin` (for og:image / twitter:image), or null. */
export function posterArtAbsoluteUrl(raw: unknown, origin: string): string | null {
  const path = posterArtPath(raw);
  return path ? `${origin}${path}` : null;
}
