// ─── HTML escaping ─────────────────────────────────────────────────────────────
//
// One escaper, so a surface cannot be safe in one file and unsafe in the file
// next to it. Before this module there were three near-copies (pages.ts twice,
// corridor-map.ts once) plus a fourth inside public.html's client script that
// escaped LESS than the others — it used `div.textContent → innerHTML`, which
// covers `& < >` but NOT `"` or `'`. That copy interpolated into attribute
// values (`data-event-id="${safeId}"`), so a quote in the value would have
// closed the attribute. Server-rendering the list (OSE-1243) retired that copy;
// this module is what replaced it.
//
// `escapeXml` is deliberately NOT here. corridor-map.ts omits `'` on purpose
// for SVG attribute contexts it controls; merging the two would silently widen
// or narrow one of them.

/**
 * Escape a value for interpolation into HTML text OR a quoted attribute value.
 *
 * Escapes all five of `& < > " '`, which makes it safe in both contexts. It is
 * NOT safe for unquoted attributes, `<script>` bodies, or URL positions — use
 * `encodeURIComponent` for the latter.
 */
export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
