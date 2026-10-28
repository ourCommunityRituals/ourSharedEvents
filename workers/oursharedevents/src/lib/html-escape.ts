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

/**
 * A value as JSON for an inline `<script>` body (OSE-1754).
 *
 * `JSON.stringify` alone is not enough there: a string holding `</script>` or
 * `<!--` ends or changes the block, and U+2028 / U+2029 end a line in older
 * engines. Escaping `<`, `>`, `&` and the two separators leaves valid JSON that
 * cannot leave the block. Use this for every value a page places in a script,
 * in place of quoting it by hand.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
