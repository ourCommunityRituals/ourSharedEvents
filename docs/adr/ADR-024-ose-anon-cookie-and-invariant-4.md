# ADR-024: Reconcile the `ose_anon` cookie with "no cookies on public surfaces"

**Status:** Proposed
**Date:** 2026-10-22
**Deciders:** mzdan (PO). Not decided: this ADR states the facts and a recommendation; the owner chooses.

## Context

Two statements of the owner's rules disagree with each other.

- `AGENTS.md`, invariant 4: "**No cookies on public surfaces.** Geolocation picks what to show and is never stored." The same words are carried in `docs/positioning/BRAND-INFRASTRUCTURE-MAPPING-2026-10-04.md` (brand-wide invariants), and the owner's standing rule is that public pages set no cookies.
- The OCR-docs brain, invariant #1 (`anonymous_id`, `OCR-docs/ocr-docs-brain/architectural-invariants.yaml`), requires an `ose_anon` cookie contract ("HttpOnly, Secure, SameSite=Lax") and calls the cookie value "the only sanctioned correlation key". `docs/adr/ADR-001`, `docs/features/ANONYMOUS-ID.md` and `docs/features/PRIVACY.md` describe the same cookie.

Both cannot be read as true without a qualifier. A buyer, auditor or visitor who reads "no cookies" and then inspects a `Set-Cookie` response header finds a mismatch. For the SOC 2 path the owner wants (OSE-1444), a control that says one thing and a system that does another is an exception the auditor writes down, whichever side is changed.

This ADR was asked for as part of OSE-1730's follow-ups. It changes no code.

### What the code does (read 2026-10-22, `main` at `af8073dd`)

**The cookie.** `workers/oursharedevents/src/lib/anonymous-id.ts`:
`ose_anon=anon_<crypto.randomUUID()>; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000 (1 year); Path=/`. Random, no fallback, no PII. Read from the request `Cookie` header; a new one is minted when absent.

**Where it is set.** Only `setAnonCookie(...)`, and only when `getOrCreateAnonId` says the visitor is new. There are exactly two importing modules:

| Where                                           | Route                                                                                    | When                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| `src/handlers/qr-scan.ts:261`                   | `GET /q/<qr_token>` (a poster or printed QR scan, answered with a 302)                   | First scan by a browser that has no cookie   |
| `src/handlers/forms.ts:325, 468, 518, 573, 603` | The four public form POSTs: register, check-in, survey, email sign-up (two return paths) | First submit by a browser that has no cookie |

**Where it is not set.** No other handler imports `setAnonCookie`. The public event page, `/events`, the landing page, the display (TV), poster pages, event-code redirects (`/e/ /p/ /tv/ /r/ /c/`), shortlinks (`/s/<code>`), maps and the sponsor impression and click beacons set nothing. Existing tests assert this: `public-event-page.spec.ts:651-660` (shortlink hop and event page, `Set-Cookie` null), `landing-where.spec.ts:126,137`, `maps.spec.ts:76`, and the Bruno case "POST sponsor impression with a cookie returns no identity and sets no cookie". The public page script also sends the sponsor beacons with `credentials: 'omit'` (`templates/public.html:195`), so the cookie is not even sent to them (OSE-1164).

**What reads it.** `/q/` (hour dedup, one browser one poster one hour, OSE-1459) and the four form handlers. Nothing else reads the `Cookie` header for identity.

**What is stored.** Not the cookie value, since OSE-1659 (2026-10-09, migration 0095):

- Scan side: `scan_node_returns.anonymous_id` holds a keyed scan id `snk1_…` (HKDF from `ANON_ID_HASH_PEPPER`, `lib/scan-node-key.ts`). The same browser gets the same id at every event, which is what makes "came back to another event" countable (`anon_id_returns`). Retention for those rows is 365 days (`SCAN_RETURNS_RETENTION_DAYS`).
- Forms side: FORMS_DB holds a per-event keyed id `evk1_…` (`lib/event-anon-key.ts`), different at every event and stable inside one, so check-in can recognise the same phone.
- Neither value can be turned back into the cookie, and neither equals the other.

**Drift found while reading.** `docs/features/PRIVACY.md`, `docs/features/ANONYMOUS-ID.md` and `ADR-001` still say the scan side stores the raw `ose_anon` value (ADR-001 line ~110: "pseudonymous ose_anon cookie value"). The code stores the keyed `snk1_` id. This is a separate docs correction (ADR-RECONCILIATION-PROCESS) and is not made here, to keep this change to the one decision.

So the plain reading of the facts is: **public read surfaces set no cookie; two kinds of public write moments do** (a scan, and a form submit), one first-party cookie, once per browser, for a year.

## Options

### A: Remove the cookie

Stop setting `ose_anon`. The invariant then holds as written.

What replaces it, and what is lost:

- Token-in-link (the QR token or a registration link carries the identity of the _placement_, not the browser). A placement token cannot tell two browsers apart, so it cannot dedupe.
- `localStorage` is not a way around it: it is the same kind of device storage, and "no cookies" would be true in letter only.
- Lost: one-browser-one-poster-one-hour dedup (OSE-1459), distinct-browser counts per event-hour (they fall back to a user-agent hash, as migration 0095 already did for old staging rows), the "came back to another event" return count (`anon_id_returns`), erasure of a known browser's scan rows (`data-subject.ts` relies on the key), and check-in recognising the same phone inside one event (the `evk1_` id is derived from the cookie). A per-attendee link would restore check-in only by making the link itself the identifier, which is the identity moment the forms already own.
- Rewrites: `anonymous-id.ts`, both handlers, the keyed-id libraries (`scan-node-key.ts`, `event-anon-key.ts`) and the specs that mention `ose_anon` (about 20 files by grep), plus brain invariant #1.

### B: Keep the cookie and narrow invariant 4 so it is true

Reword the rule to what the code does, name the cookie, and gate the claim.

Proposed wording (illustrative; the owner and the CCR process settle the final text): "No cookies on public read surfaces. The only cookie is `ose_anon`: random, first-party, HttpOnly, Secure, SameSite=Lax, one year, set only when a browser first scans a `/q/` link or first submits a public form, never stored as received (keyed before it is written), never sent to sponsor beacons."

- Adds a structural gate: a test that fails if any module other than `qr-scan.ts` and `forms.ts` imports `setAnonCookie`, and that `Set-Cookie` is absent on every other public route. The route-level asserts above already cover part of this; the import list would cover the rest and is born red on an injected fault.
- Cost: `AGENTS.md`, `CLAUDE.md` and the brain wording change. Per `AGENTS.md`, changes to those files need 5+ CCR loops with a human gate after every loop. The PO's public statements ("no cookies", `OCR_VISION`) change too, which is a product-positioning decision as much as an engineering one.

### C: Keep it, but cut it back first, then do B

Reduce what the cookie does so the narrowed rule in B is smaller and easier to defend:

- Do not set it on `/q/` scan redirects. A scan would count with the user-agent hash and the hour bucket only; the cookie would appear only at the form moment (the identity moment, where `evk1_` needs it). Loses scan-side returns and OSE-1459's browser-level dedup.
- And/or shorten `Max-Age` (for example 30 days, or per visit) so it is tied to a purpose rather than a year. Loses cross-event return counts beyond the window.
- Then adopt B's wording for what remains.

Each cut is a product trade-off against the "returning visitor" and distinct-browser numbers that NCR and the sponsor reports use.

## Recommendation

**B, now; C as a separate measured follow-up.** Reasons:

1. The rule must say what the system does before anything else. B makes the written invariant true in one change and gives it a gate that can fail, which is what a SOC 2 auditor tests. A leaves the product without the counts it sells.
2. The never-who guarantee does not rest on the absence of the cookie. It rests on what is stored: since OSE-1659 neither database holds the cookie value, the two keyed ids cannot be joined, and public beacons never receive the cookie. B keeps those properties and puts the cookie's real shape into the rule.
3. The pyramid: backyard hosts want no banner and no friction (a first-party cookie that is never read by a public page and is only set on a scan or form submit fits that); bar, partnership and enterprise buyers want a statement they can check. B gives both with one sentence and one test. A is the only option that removes the sentence, and it removes the counts with it.

Open questions that need the owner (and, for the legal ones, counsel) before this is Accepted:

- Is a first-party, strictly pseudonymous cookie set on a scan or form submit acceptable under the owner's "no cookies" promise once the promise is worded? (A positioning decision.)
- Whether any regime the product declines or serves (ADR-018) treats this cookie as needing notice or consent. This ADR makes no legal finding.
- Whether C's cuts are wanted regardless of B.

## Consequences

### If B is accepted

- Positive: the invariant, the brain and the code agree; the claim is gated; no change to counts, tests, or stored data.
- Negative: the product can no longer say "no cookies" without the qualifier; docs and public copy that say it must be reworded (PRIVACY, ANONYMOUS-ID, OCR_VISION); a CCR run with a human gate after every loop is required for the `AGENTS.md` and `CLAUDE.md` edits.
- Never-who: unchanged. Public pages do not receive or store the cookie; stored ids are keyed.
- SOC 2: the control description matches the system; the test list is the evidence. Retention of cookie-derived rows stays bounded (365 days).

### If A is accepted

- The invariant holds as written, but dedup, return counts, erasure of known browsers and phone recognition at check-in go, and about 20 specs and the brain invariant #1 are rewritten. Larger blast radius than the claim it fixes.

### If C is accepted (first)

- Smaller cookie, smaller wording, fewer metrics. Needs a measurement of which reports use scan-side returns before cutting.

### Neutral, in all cases

- Docs drift noted above (raw cookie value stored on the scan side) is corrected separately.

## Verification (evidence for this ADR)

- `workers/oursharedevents/src/lib/anonymous-id.ts` (cookie contract); `src/handlers/qr-scan.ts` (168, 261); `src/handlers/forms.ts` (237, 325, 435, 468, 493, 518, 542, 573, 603); `rg "setAnonCookie|getOrCreateAnonId" src` lists no other caller.
- `src/lib/scan-node-key.ts`, `src/lib/event-anon-key.ts`, `migrations/0095_scan_node_returns_clear_raw_anon_id.sql`, `src/lib/scan-returns-retention.ts`.
- `tests/public-event-page.spec.ts:651-660`, `tests/landing-where.spec.ts:126,137`, `tests/maps.spec.ts:76`, `tests/qr-scan.spec.ts:196-216`, `tests/e2e/0-architecture/anonymous-id.invariant.spec.ts`.

## References

- `AGENTS.md` invariants 1 and 4; ADR-001 (anonymous identity architecture); ADR-018 (declined regulatory regimes); ADR-RECONCILIATION-PROCESS; OSE-1659 (keyed scan id); OSE-1659/OSE-1351 (retention); OSE-1164 (sponsor beacons omit credentials); OSE-1444 (SOC 2 epic).
