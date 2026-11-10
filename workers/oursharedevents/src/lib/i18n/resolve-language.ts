/**
 * Pick the page language from an Accept-Language header (OSE-1760).
 *
 * Reads the header by quality value, not by position: the best-ranked language
 * we render wins, a regional tag matches its base language (`es-MX` to `es`),
 * and anything else falls back to English. It never throws, whatever the header
 * holds, and it keeps no state: the header is read and forgotten, never stored
 * against a visitor (no cookie on a public surface, and never who).
 *
 * Bounded on purpose: the header is untrusted input, so only its first 512
 * characters and first 32 entries are looked at.
 */
import { DEFAULT_LANG, LANGUAGES, type Lang } from './languages';

const MAX_HEADER_LENGTH = 512;
const MAX_ENTRIES = 32;

interface Entry {
  tag: string;
  q: number;
  order: number;
}

function parse(header: string): Entry[] {
  const entries: Entry[] = [];
  const parts = header.slice(0, MAX_HEADER_LENGTH).split(',').slice(0, MAX_ENTRIES);
  parts.forEach((part, order) => {
    const [rawTag, ...params] = part.split(';');
    const tag = rawTag.trim().toLowerCase();
    // Stryker disable next-line ConditionalExpression,LogicalOperator,StringLiteral: equivalent mutants (OSE-1970) — '' and '*' are never in LANGUAGES and match() turns either into null, so an entry kept here is skipped by the lookup instead; this line only saves that work.
    if (!tag || tag === '*') return;
    let q = 1;
    for (const param of params) {
      const p = param.trim();
      if (!/^q\s*=/i.test(p)) continue;
      // A q parameter that is not a plain number is invalid, so the entry is
      // skipped below. It must not fall through to the default of 1.
      const m = p.match(/^q\s*=\s*([0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/i);
      q = m ? Number.parseFloat(m[1]) : Number.NaN;
    }
    // Not acceptable (q=0), or not a number in range: skip the entry.
    if (!Number.isFinite(q) || q <= 0 || q > 1) return;
    entries.push({ tag, q, order });
  });
  // Highest quality first; a tie keeps the order the browser listed them in.
  // Stryker disable next-line ArithmeticOperator: equivalent mutant (OSE-1970) — `a.order + b.order` is positive for every tie, which V8's stable sort reads as "keep b first"; at most 32 entries are sorted, all by binary insertion, so ties keep their listed order either way (checked with 2 to 12 tied tags).
  return entries.sort((a, b) => b.q - a.q || a.order - b.order);
}

/** `zh-hans-cn` is tried as `zh-hans-cn`, `zh-hans`, then `zh`. */
function match(tag: string): Lang | null {
  let candidate = tag;
  for (;;) {
    if ((LANGUAGES as readonly string[]).includes(candidate)) return candidate as Lang;
    const cut = candidate.lastIndexOf('-');
    // Stryker disable next-line EqualityOperator: equivalent mutant (OSE-1970) — at cut 0 the next candidate is '', which is never a language, so stopping one step early returns the same null.
    if (cut < 0) return null;
    candidate = candidate.slice(0, cut);
  }
}

export function resolveLanguage(header: string | null | undefined): Lang {
  if (!header) return DEFAULT_LANG;
  for (const { tag } of parse(header)) {
    const lang = match(tag);
    if (lang) return lang;
  }
  return DEFAULT_LANG;
}
