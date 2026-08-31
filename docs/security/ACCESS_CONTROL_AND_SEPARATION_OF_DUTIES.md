# Access Control & Separation of Duties

> **Status:** Model decided; enforcement tracked under Feature G (OSE-832) and the
> R-series (OSE-841/853/855/857) + R-9 (OSE-1133). This doc is the governance model
> those tickets implement. Related decision: `docs/adr/ADR-006-audit-access-bearer-pattern.md`.

## Purpose

Roles govern **who can do what** _and_ **what a person sees and does on every page**.
This document states the model and its load-bearing rules so implementation across
handlers and surfaces stays consistent.

## Two enforcement dimensions — both server-side

Every role decision has two faces, and **both are enforced at the handler, never only in the UI**:

| Dimension | What it controls                                                                                | How it's enforced                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **DO**    | which actions / controls are available (create, edit, delete, promote, flag flips, role grants) | the control may be hidden for UX, **and** its endpoint independently returns `403` on an unauthorized caller                   |
| **SEE**   | which pages, cards, sections, and **data** appear                                               | the **API tailors the payload to the role** — a role that can't see data never receives it; the server does not send-then-hide |

### Load-bearing rule (Dr. Security)

> **UI role-hiding is cosmetic — never the security boundary.**
> A page renders _from_ the resolved capability set for clarity. The wall is the
> endpoint: every hidden control refuses on its own, and the API omits data a role
> may not see. If a reviewer can reach a capability by un-hiding a button or reading
> a network response, the control has failed.

This applies across **all surfaces**, not just `admin.html`:
`admin` (cards/actions), `sharedReport` (role-scoped depth/data — OSE-577/816; Map
render-by-type — OSE-1132), and `public` / `display` / `poster` (what sections/data
render per viewer).

## Roles resolve from tenant membership

Roles are **capability-tiered** and resolved from the tenant's (brand's) membership,
enforced at the route via the capability matrix (OSE-841) — a new role is a row in one
frozen matrix, not an edit across 40 handlers. Object/tenant scoping composes with this
(OSE-1080). Tiers are defined by Feature G (OSE-832): from a single privilege level to
four, route-enforced.

## Separation of duties — graceful, scaling, solo-OK

**No single person should hold admin rights with zero oversight** — but the control must
never punish a one-person event. Separation of duties is **available and scales with the
tenant**:

| Tenant size                      | What becomes available                                                                                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Solo (small event) = 1 admin** | Valid floor. Fully functional. No co-signer exists, so the **immutable audit log is the oversight substrate even at n=1** — every privileged action is recorded.                                         |
| **≥2 people**                    | A **second Admin** (redundancy, no single point of failure) + **two-person integrity** (four-eyes, approver ≠ actor) _available_ for destructive/high-risk actions. Per-tenant configurable, not forced. |
| **≥3 people**                    | A **read-only Auditor** — sees everything, reads the audit log, **mutates nothing**. The "third who watches."                                                                                            |

Principle in one line: **security available as the opportunity presents itself** —
solo-OK floor, SoD-ready ceiling. Never one admin unwatched _once a second/third person
exists_; never a control that blocks a solo organizer.

## High-risk actions covered by two-person integrity

Where the tenant has ≥2 admins, these warrant approver ≠ actor (and are always audited):

- Delete an event (see below) or a sponsor
- Promote to production
- Covenant / monetization flag flips
- Role / membership grants

## Applied: deleting an event (OSE-982)

Deleting an event is the first concrete destructive operation, and it illustrates the model:

- **Delete = discard a mistake / draft** (the fat-finger or abandoned-half-way scenario).
  A draft has no scans, sponsors, or attendees behind it — nothing to protect.
- **Archive = retire a real event** (`PUT status='archived'`, already exists). An event
  that went `active` and accumulated scan/attendee aggregates is **archived, never deleted** —
  deleting it would destroy the aggregate record the SharedReport/covenant is built on.
- So `DELETE /api/v2/admin/events/:id` is **soft-delete**, **Admin-gated**, **audited**
  (`_audit('DELETE_EVENT', …)`), and **guarded**: it refuses (→ "archive instead") for an
  event that carries real data. Two-person integrity applies where the tenant has ≥2 admins.

Note the _pre-creation_ fat-finger (navigating back through the wizard before finishing)
persists no row and needs no delete — the endpoint exists only for a row already created.

## Enforcement tickets

| Ticket              | Concern                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| OSE-832 (Feature G) | Role tiers: one → four levels, enforced at the route                               |
| OSE-841 (R-2)       | Capability matrix — routes name a capability, not a role string                    |
| OSE-853 (R-6)       | `brand_owner` members.manage — grant roles inside your own brand, audited          |
| OSE-855 (R-7)       | All-surface capability-resolved rendering + server-side refusal (see/do)           |
| OSE-857 (R-8)       | Cross-role red-team — every forbidden route returns 403/404                        |
| **OSE-1133 (R-9)**  | **Separation of duties — two-person rights + read-only Auditor, graceful scaling** |
| OSE-1080            | Object-level owner/brand scoping on read + mutate paths                            |
| OSE-982             | First concrete destructive op (delete event) — honors this model                   |

**Related principle (machine analog):** OSE-622 — agent privilege separation
(builder/reviewer credential split, two-key rule) is the same separation-of-duties
principle applied to automation rather than people.
