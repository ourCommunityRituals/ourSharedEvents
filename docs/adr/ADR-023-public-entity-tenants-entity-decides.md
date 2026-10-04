# ADR-023: For public-entity tenants, the entity decides what happens to its data

**Status:** Proposed
**Date:** 2026-10-03
**Deciders:** Matthew Zdano (PO)

> **Not legal advice, not contract language.** This records the PO's posture and the
> build-side consequences. The legal mechanics (Illinois FOIA, Local Records Act,
> Michigan FOIA, sponsor disclosure) are unverified and belong to an Illinois
> public-records / government-contracts attorney. Statute references in the source
> discussion were from general knowledge and must be checked before any contract uses them.

## Context

OSE's data doctrine is stewardship: the owner of an organisation's data decides who sees
it, can take all of it with them, and can have it deleted on request. That reads cleanly
for private tenants (a parish, venue, league, chamber, sponsor). It does not read
cleanly when the tenant is a public body (city, library, park district), because public
bodies are usually barred from destroying records outside an approved retention schedule,
and may be required to release records on request.

The first framing considered was OCR declaring the data "public domain" or a "public
record". That was rejected: public domain, public record and open data are three
different things, and OCR cannot create any of them by saying so. The PO's reframe is the
decision below.

Trigger: 2026-10-03 PO discussion of public/private partnerships and the pre-launch
compliance check on `stg.oursharedevents.com`.

## Decision

**For a public-entity tenant, the entity decides.** The public body is the people's
representative. OCR chooses whether to enter the relationship; the entity chooses whether
to renew it. While the contract runs OCR keeps the data safe and acts only on the entity's
lawful written direction. When it ends, the data goes back to the entity.

Working rules:

1. **Lawful direction only.** OCR follows the entity's direction within what the
   entity's own law requires of it (retention schedules, release obligations). OCR does
   not take on liability for the entity's compliance.
2. **A named data steward.** Instructions about the data come from one authorised person
   the tenant names, in writing. OCR keeps a decision log (who directed what, when) so
   a change of staff or administration is not ambiguous.
3. **Never-who is not a data setting.** An entity may publish, restrict, download or
   export its data. It cannot direct OCR to collect identities. Never-who is how the
   system collects, not a toggle, and the contract says so plainly.
4. **Publication tier, if the entity opts in.** Open publication of aggregates is the
   entity's choice. What may leave is a fixed tier: event-level or weekly totals at H3
   res 7 or coarser, never res-9 placement cells; a floor above the report k-floor with
   small cells suppressed; and never fine windows and fine cells together (differencing).
   The full-resolution record stays in the entity's owner tier.
5. **Non-renewal and exit.** The entity receives a complete export in open formats; OCR
   retains nothing unless the entity authorises custody until a retention schedule runs
   out. On OCR change of control, the entity decides whether to accept the successor and
   may require its records be transferred.
6. **Sponsors are told.** Where the host is a public body, sponsorship and aggregate
   reach may be disclosable. This is stated at sponsor signup.

| Tenant                          | Decides                     | Deletion                          | Open publication                |
| ------------------------------- | --------------------------- | --------------------------------- | ------------------------------- |
| Private (parish, venue, league) | The organisation            | On request, honoured              | Only if the owner opts in       |
| Public entity (city, library)   | The entity, via its steward | Only per its retention schedule   | The entity's choice, tier above |
| Public by construction          | Already public              | Event manager removes own listing | Treated as open                 |

## Alternatives Considered

### Alternative A: OCR declares the data "public domain"

**Rejected because:** public domain means no copyright, and a vendor relationship cannot
create it; "public record" is a legal status, and open data is a publishing choice.
Claiming any of them on the public's behalf overpromises.

### Alternative B: One doctrine for everyone (owner may always delete)

**Rejected because:** it can put a public body in breach of its retention law, or have
OCR destroy records it is obliged to keep.

## Consequences

### Positive

- The doctrine splits cleanly: private owners can delete, public bodies decide within
  their law, everyone can leave with their data.
- OCR never has to rule on a city's legal obligations.

### Negative / costs

- Per-tenant governance state (regime, steward, retention hold, decision log) must exist
  before a public partner signs.

### Build-side items this implies (not started; each needs its own story)

- A tenant **regime flag** (private / public-entity).
- A **retention hold** that blocks deletion paths for public-entity tenants.
- A **full export** (CSV + data dictionary, JSON/NDJSON, GeoJSON for H3, README with
  license, provenance, k-floor, resolution, date); export logged as count + timestamp only.
- A **decision log** for steward instructions.

## Repo check (2026-10-03, added after the fact)

The first draft of this ADR came from a discussion that read no code or docs. These
are the repo facts checked afterwards. Each is a read of source, not a runtime check.

- **No regime flag, steward, retention hold or decision log exists** (searched `src/` and
  `docs/`). The build-side items below are all new work, not gaps in something present.
- **No tenant data-export feature exists.** Only `report.export-json` / `export-pdf`
  flags for SharedReport (`docs/features/TIERS.md`) and a manual D1 export in
  `docs/runbooks/DISASTER-RECOVERY.md`.
- **Forms PII is already scrubbed on a schedule** (`DISASTER-RECOVERY.md`: older than
  retention is gone by design). That is a deletion path a public-entity retention hold
  would have to override, so the hold is not a small add-on.
- **IP handling, which the compliance check flagged as its top risk:** `CF-Connecting-IP`
  is read in forms, pages, rate-limit, Turnstile and shared-report handlers, in the code
  I saw for rate limiting and bot checks. Migration 0028 replaced raw
  `subscribers.ip_address` with a peppered hash. `admin_audit_log.ip` exists (masked
  on the brand-scoped read, per CLAUDE.md). `[observability]` is enabled in
  `wrangler.toml`, so Cloudflare Worker logs exist; what they retain, and for how long,
  was **not** checked.
  **Update (same day):** `logAdminAction` now stores the masked network (/24 or /48), never the raw
  IP, and `tests/log-never-who.spec.ts` fails if any `console.*` call in `src/` names an IP, user agent
  or request header. Rows written before this change still hold raw IPs until backfilled or purged. The "never who" wording is therefore **not yet verified** against
  edge and Worker logs.
- Not checked at all: cookies/third-party scripts, k-floor behaviour on 2-3 scan events,
  staging access control, WCAG state (the repo has an a11y gate per CLAUDE.md, not read
  here), privacy page/terms/DMCA existence.

## Open questions

- Does a platform like this count as performing a governmental function for a small
  municipality under Illinois FOIA? (attorney)
- Can a municipality contractually agree to default open publication of aggregates? (attorney)
- How is the deletion promise worded for public bodies under the Local Records Act? (attorney)
- Michigan FOIA for the Sawyer corridor, and whether the template travels to other states. (attorney)

## Related

- ADR-018 declined regulatory regimes; ADR-022 event is the base.
- Compliance-check items still open for staging (log audit of IP/user agent retention,
  privacy page, terms, DMCA agent, WCAG gate) are tracked separately; the "never who"
  promise must be worded to match what the logs actually hold.
