/**
 * Deeper Dive: the one way a page tucks away an explanation (owner,
 * 2026-11-27). An outlined arrow button labelled "Deeper Dive" opens a small
 * window with a short paragraph. What would make a phone screen busy sits behind
 * it instead. The outline uses the accent, so a user who needs the words to act
 * can see there is more to read.
 *
 * Only for what helps, never for what a user must know to act: a must-know
 * stays on the screen (owner, 2026-11-27).
 *
 * Native <details>, so it needs no script, opens and closes on a tap, Enter or
 * Space, and tells a screen reader it is expanded or collapsed. The button keeps
 * the 48 px tap height of every .btn. Colours come from /ui.css only.
 * `topic` names what it explains for a screen reader; `text` is escaped here.
 */
import { escapeHtml as esc } from './html-escape';

export function deeperDive(topic: string, text: string, testId?: string): string {
  const id = testId ? ` data-testid="${esc(testId)}"` : '';
  return `<details class="deeper-dive"><summary class="btn btn-outline" aria-label="Deeper Dive: ${esc(topic)}">Deeper Dive ›</summary><p class="detail-card-sub"${id}>${esc(text)}</p></details>`;
}
