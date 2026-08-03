/** Escape untrusted text for safe interpolation into HTML. */
export function esc(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape a value destined for an href/src attribute; blocks javascript: URLs. */
export function escUrl(input: unknown): string {
  const s = String(input ?? '').trim();
  if (/^javascript:/i.test(s) || /^data:/i.test(s)) return '#';
  return esc(s);
}
