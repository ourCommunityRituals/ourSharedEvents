# ADR-010: Templates = Breadth, Tiers = Depth

**Status:** Accepted
**Date:** 2026-04-08
**Decision makers:** Matthew Zdano (PO)

## Context

The legacy zeventbook platform (GAS-based, archived Dec 2025) defined 32 event templates across 8 categories (bar & tavern, leagues, general, schools, community, professional, social, travel). Each template specified default sections, display configs, CTAs, and UI presets.

The current OSE platform has a `template_id` column in the `events` table but no template resolution logic — every event is a generic entity.

Meanwhile, the 3-tier feature flag system (Free/Mid/Enterprise) has been implemented to gate platform capabilities.

The question: how do event templates and feature tiers interact?

## Decision

**Templates and tiers are independent axes.**

- **Templates = breadth.** Every event template is available to every user regardless of tier. A Free user can create a trivia night, a fundraiser, a rec league, a wedding — the full menu. More templates = more reasons to use the platform. Templates define WHAT the event looks like: default sections, display rotation, form presets, CTAs, UI labels.

- **Tiers = depth.** Free/Mid/Enterprise layers features ON TOP of whatever template the user picked. Surveys, exports, white-label, sponsor ROI — those are the paid layers. Tiers define WHAT FEATURES are available, not what kind of event you can create.

**Templates never gate. Tiers gate.**

> **Axis cross-reference (OSE-1293 / F5).** "Templates never gate" governs the
> **template axis only** — it does not conflict with the **legal-clearance axis**
> in [ADR-009](ADR-009-ncr-v2-geographic-hierarchy.md) / [ADR-018](ADR-018-declined-regulatory-regimes.md),
> under which regulated verticals are gated (and declined regimes refused). Three
> independent axes: **templates = breadth** (what an event looks like, never
> gated), **feature-tiers = depth** (Free/Mid/Enterprise features, gated here),
> **legal clearance = which verticals are served at all** (gated by ADR-009/018).
> A template being ungated says nothing about clearance; they are orthogonal.

## Consequences

1. The `event_templates` table stores cosmetic/structural defaults — no `tier` column, no access restrictions.
2. All 32 zeventbook templates (10 MVP + 22 V2) are seeded and available to all users.
3. Template selection happens at event creation time. The chosen template populates default sections, CTAs, and UI presets. The user can override any default.
4. Feature flags (`forms.survey`, `assets.file-upload`, `branding.white-label`, etc.) continue to be resolved by the tier system, independent of template.
5. Brand-level template visibility (which brands see which templates) is preserved as a curation mechanism, not a paywall. A bocce-focused brand shows bocce first, not because other templates are locked, but because the UX is tailored.
6. New templates can be added without touching the tier system. New tier features can be added without touching templates.

## Enforced by invariants

Back-reference added per OSE-1291 / CCR finding F3 (ADR↔invariant traceability),
recorded in the OCR-docs brain `architectural-invariants.yaml`:

- **Invariant #5 — tier_equity.** The tiers=depth axis this ADR establishes
  ("templates never gate, tiers gate") is the axis #5's tier-equity guarantee
  sits on. (#5 also cites ADR-013 covenant and ADR-017 depth enforcement.)

## Template Schema

Each template defines:

| Field                | Type        | Purpose                                                                                   |
| -------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `id`                 | TEXT PK     | Stable identifier (e.g., `bar_night`, `trivia`)                                           |
| `name`               | TEXT        | Display name                                                                              |
| `description`        | TEXT        | One-line description                                                                      |
| `category`           | TEXT        | Grouping (bar_events, leagues, general, schools, community, professional, social, travel) |
| `icon`               | TEXT        | Emoji icon                                                                                |
| `display_order`      | INTEGER     | Sort order within category                                                                |
| `stage`              | TEXT        | `mvp` or `v2` (rollout phase, not access gate)                                            |
| `default_sections`   | TEXT (JSON) | Which sections are on/off by default                                                      |
| `default_ctas`       | TEXT (JSON) | Suggested CTA button labels                                                               |
| `default_ui_presets` | TEXT (JSON) | Audience label, notes label, sponsor strip label                                          |
| `example_name`       | TEXT        | Placeholder event name for the template                                                   |

## Categories (8)

| Category             | ID             | Templates                                                              |
| -------------------- | -------------- | ---------------------------------------------------------------------- |
| Bar & Tavern         | `bar_events`   | bar_night, music_event                                                 |
| Leagues & Sports     | `leagues`      | rec_league, bocce, youth_sports, trivia, darts, bags, pinball          |
| General              | `general`      | custom, fundraiser                                                     |
| Schools & Youth      | `schools`      | school_event, club_activity                                            |
| Community & Faith    | `community`    | community_day, farmers_market, art_show, carnival, church, church_club |
| Professional         | `professional` | school (fundraiser variant), corporate                                 |
| Social & Celebration | `social`       | wedding, photo_gallery, shower, bachelor_party                         |
| Travel & Lodging     | `travel`       | travel_hub                                                             |

## Alternatives Considered

1. **Tier-driven, not type-driven** — Templates irrelevant, tiers are the only axis. Rejected: loses the UX benefit of tailored defaults per event type. A trivia night and a wedding should not start from the same blank slate.

2. **Templates gated by tier** — Some templates only available at higher tiers. Rejected: artificially restricts the platform's appeal. A Free user creating a wedding brings a future Enterprise customer.

3. **Ring-driven event types** — Templates map to NCR ring stages. Rejected: rings describe lifecycle, not event identity. All events go through the same ring stages.
