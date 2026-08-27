/**
 * OSE-1053 — Layer A (Boundary) of the named × anonymous forbidden-join guarantee.
 *
 * THE GUARANTEE (this layer): the OW session identity can never even *reach* the
 * OSE anonymous scan. Two structural facts make it so, and this born-red LOCKS
 * both:
 *   1. `getOrCreateAnonId` reads ONLY the `ose_anon` cookie by name — an OW
 *      session cookie (with N named-profile hints) present on the same request
 *      is structurally ignored.
 *   2. `setAnonCookie` emits a HOST-ONLY cookie (no `Domain=` attribute), so a
 *      browser never shares it with the OW domain (and, symmetrically, never
 *      sends the OW cookie to the OSE host).
 *
 * This is a LOCK, not a fix — the code is already correct on `origin/main`. The
 * spec goes RED the moment either boundary is weakened:
 *   - an OW/session cookie value leaks into the derived anon id, or
 *   - a `Domain=` attribute broadens the anon cookie's scope beyond the OSE host,
 *   - or the anon cookie loses HttpOnly / Secure / SameSite.
 *
 * Sibling layers: OSE-1049 (Blindness — the endpoint ignores a session that
 * *does* arrive) · OSE-923 (Unlinkability — the stored anon row is not
 * re-joinable). Ties OSE-1048 / OCR-43 (hybrid choice contract).
 *
 * Format: `OSE-1053 | UNIT | <description> | <assertion>`.
 */

import { describe, test, expect } from 'vitest';
import { getOrCreateAnonId, setAnonCookie, generateAnonId } from '../src/lib/anonymous-id';

// A realistic OW named session: a session cookie plus multiple named-profile
// hints — the curator / bocce-player / artist personas one person may hold at
// once (the Fist-of-Five team page / DJ page / artist page recipients).
const OW_SESSION_VALUES = [
  'named-session-abc123',
  'dj-mallang',
  'team-fist-of-five-7',
  'artist-jane-doe',
] as const;

const OW_NAMED_COOKIES = [
  `ow_session=${OW_SESSION_VALUES[0]}`,
  `ow_profile_curator=${OW_SESSION_VALUES[1]}`,
  `ow_profile_player=${OW_SESSION_VALUES[2]}`,
  `ow_profile_artist=${OW_SESSION_VALUES[3]}`,
].join('; ');

function reqWithCookie(cookie: string): Request {
  return new Request('https://oursharedevents.com/q/qrt_boundary_probe', {
    headers: { Cookie: cookie, Authorization: 'Bearer ow-named-token' },
  });
}

describe('OSE-1053 Layer A — Boundary: an OW session cannot bleed into the anon scan', () => {
  test('OSE-1053 | UNIT | OW named session + N profile cookies, no ose_anon | anon id is freshly generated, independent of every OW value', () => {
    const { anonId, isNew } = getOrCreateAnonId(reqWithCookie(OW_NAMED_COOKIES));

    // No `ose_anon` by name ⇒ a fresh anonymous id, not derived from anything sent.
    expect(isNew).toBe(true);
    expect(anonId).toMatch(/^anon_/);

    // Integrity: the derived id embeds NONE of the OW session/profile values.
    for (const owValue of OW_SESSION_VALUES) {
      expect(anonId).not.toContain(owValue);
    }
  });

  test('OSE-1053 | UNIT | ose_anon present alongside OW cookies | reads ONLY ose_anon, ignores every OW cookie', () => {
    const existing = 'anon_1111-2222-3333-4444';
    const { anonId, isNew } = getOrCreateAnonId(
      reqWithCookie(`ose_anon=${existing}; ${OW_NAMED_COOKIES}`)
    );

    expect(isNew).toBe(false);
    // Exactly the ose_anon value — the OW cookies are inert on this path.
    expect(anonId).toBe(existing);
  });

  test('OSE-1053 | UNIT | adversarial: an OW cookie whose VALUE looks like an anon id | is NOT adopted (name-scoped read, not value-sniffed)', () => {
    // An attacker-controlled OW profile cookie carrying an `anon_`-shaped value
    // must never be mistaken for the OSE anon cookie.
    const { anonId, isNew } = getOrCreateAnonId(
      reqWithCookie('ow_profile_curator=anon_forged-by-ow; ow_session=named-session-abc123')
    );

    expect(isNew).toBe(true); // no `ose_anon` by NAME ⇒ fresh
    expect(anonId).not.toBe('anon_forged-by-ow');
  });

  test('OSE-1053 | UNIT | setAnonCookie emits a HOST-ONLY cookie | no Domain attribute; HttpOnly + Secure + SameSite=Lax present', () => {
    const res = setAnonCookie(new Response(null, { status: 302 }), generateAnonId());
    const setCookie = res.headers.get('Set-Cookie') ?? '';

    // Parse-and-assert the emitted header (integrity, not toContain-only).
    expect(setCookie).toMatch(/^ose_anon=anon_[A-Za-z0-9_-]+;/);

    // HOST-ONLY: any `Domain=` attribute broadens scope beyond the OSE host and
    // would let the cookie be shared with the OW domain → the boundary is gone.
    expect(setCookie.toLowerCase()).not.toContain('domain=');

    // The protective flags must survive.
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
  });
});
