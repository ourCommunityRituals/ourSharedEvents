/**
 * A person's phone browser, for tests that open a counted link (/s/, /e/).
 *
 * Counted links do not count link-preview robots, nor a request with no user
 * agent at all (lib/share-count.ts isLinkPreviewAgent), so a test that expects
 * a tap or an open to be counted must say it is a person.
 */
export const PERSON_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export const AS_PERSON: Record<string, string> = { 'User-Agent': PERSON_UA };
