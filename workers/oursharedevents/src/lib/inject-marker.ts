// ─── Literal marker injection ───────────────────────────────────────────────
//
// One injector, so a surface cannot be splice-safe in one file and splice-prone
// in the file next to it — the sibling of `html-escape.ts`'s "one escaper" rule.
//
// `html.replace(marker, stringValue)` interprets `$&`, `` $` ``, `$'`, `$$`, and
// `$n` inside a *string* replacement. Because `escapeHtml` does not touch `$` or
// backtick, a value carrying a `$` — an escaped user query `/events?q=$\``, an
// event named "$5 Bocce", a sponsor name — would splice the trusted surrounding
// markup into the output (CCR-PR567 H1: reflected markup-integrity break on the
// public discovery surface). A function replacer returns its string verbatim,
// closing that class for every marker-based injector. `injectLegalFooter` uses
// `split/join` for the same reason; this is the single-occurrence sibling.

/**
 * Replace the first occurrence of a literal `marker` with `value`, inserting
 * `value` verbatim (never as a String.replace replacement pattern). A document
 * without the marker is returned unchanged.
 */
export function injectMarker(html: string, marker: string, value: string): string {
  return html.replace(marker, () => value);
}
