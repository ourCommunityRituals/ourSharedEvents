/**
 * Typed text inside a right-to-left page (epic OSE-1959, story OSE-1966).
 *
 * An organizer or sponsor types a title, a venue, an address or a host name in
 * whatever language they use, and it shows as typed (OSE-1942 class ST). On an
 * Arabic page, an English title such as "Bocce Night #3!" would have its "!"
 * and "#3" pulled to the wrong end of the line by the page's right-to-left
 * direction. `<bdi>` isolates it: the text inside is ordered by its own first
 * strong letter, and the page around it keeps its direction and alignment.
 *
 * Only a right-to-left page wraps. A left-to-right page renders exactly as it
 * did, byte for byte, so the English, Spanish and Polish goldens hold.
 *
 * The value passed in is already escaped by the caller; `<bdi>` is markup we
 * write and adds nothing a typed value can reach. Never use this inside an
 * attribute (an `alt`, a `<title>`, a meta tag): it is for element content only.
 */
import { DIRECTION, type Lang } from './languages';

export function isolateTyped(lang: Lang, escapedHtml: string): string {
  if (!escapedHtml || DIRECTION[lang] !== 'rtl') return escapedHtml;
  return `<bdi>${escapedHtml}</bdi>`;
}
