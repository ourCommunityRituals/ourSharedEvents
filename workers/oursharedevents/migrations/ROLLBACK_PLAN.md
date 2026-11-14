# D1 Migration Rollback Plan — OSE

> **Production migrations NEVER run from a developer's local machine.**
> They run ONLY via the `deploy-prod` GitHub Actions workflow with explicit
> approval from a named DevOps gatekeeper.

This document covers all migrations applied to both D1 databases bound to
the OSE Worker:

- `DB` — main / anonymous public surface (highest migration: 0108; the entries below do not cover every migration after 0083, see the note at 0104)
- `FORMS_DB` — identified-user surface (13 migrations: 0001–0013)

> **Three structural restructures land in the 0062–0067 window — read their reverse
> notes before any production rollback:** `0062` split `scans` → `scan_placement_events`
> (WHERE) + `scan_node_returns` (WHO) and **dropped `scans`**; `0064` renamed two
> banned-lexicon columns (`unique_agents`→`distinct_agent_hashes`,
> `impression_token`→`display_token`); `0065–0067` retired the combined `sponsors`
> table into `sponsor_business` (identity) + `sponsor_asset` (creative) +
> `sponsor_placement` (per-event join) and **dropped `sponsors`**. All affected tables
> were 0 rows in every environment at authoring time, so each destructive step's
> mandated posture is **rollback-forward**, not a data-preserving reverse.

> **Rollback posture:** rollback-forward is the primary production recovery
> path. The reverse SQL below is the canonical surgical rollback for DevOps /
> CI use only. SQLite has no reliable `ALTER TABLE ... DROP COLUMN`, so
> column-additive migrations note "rollback-forward" rather than a true reverse.

Companion CI gate: [`tests/migration-smoke.spec.ts`](../tests/migration-smoke.spec.ts)
locks in the canonical post-migration shape (table count, trigger count,
critical index names) on every PR. If you add or drop a migration object,
update both that file and this plan in the same commit.

---

## Migration execution model

Migrations are applied via `wrangler d1 migrations apply` (one file at a
time, in lexical order). The CI pipeline handles this automatically for
both staging and production. Local manual execution:

```bash
# Staging
wrangler d1 migrations apply DB        --env staging --remote
wrangler d1 migrations apply FORMS_DB  --env staging --remote

# Production (CI-only path; do NOT run from a developer laptop)
wrangler d1 migrations apply DB        --env production --remote
wrangler d1 migrations apply FORMS_DB  --env production --remote
```

All migrations use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
or are idempotent ALTERs handled by the migration test helpers (see the
`'duplicate column name'` / `'no such column'` ignore-clauses in
`tests/constraints.spec.ts` and `tests/migration-smoke.spec.ts`).

---

## Staging — put a database back

A staging database is never deleted and made again. D1 Time Travel restores a
database in place, and nothing in Cloudflare's documentation brings a deleted
database back. A new database also gets a new id.

To put a staging database back to an earlier time, use the staging blocks in
[`docs/runbooks/DISASTER-RECOVERY.md`](../../../docs/runbooks/DISASTER-RECOVERY.md)
§6. It is also the drill for production.

---

## Production — what to do when a migration went wrong

In this order:

1. **Roll forward.** Write a new migration that repairs it
   (`docs/runbooks/DISASTER-RECOVERY.md` §5). This is the normal path.
2. **Restore the database to before the migration** with D1 Time Travel
   (`docs/runbooks/DISASTER-RECOVERY.md` §6, break-glass). It loses everything
   written since, and it brings back erased personal data, which that runbook
   then removes again.
3. **Reverse SQL** (Option B below, break-glass). Only when 1 and 2 cannot do it.

Option A, "drop and recreate the production databases", was removed on
2026-10-07 (OSE-1503). No production database is deleted, at any stage.

### Option B — break-glass: surgical reverse-order SQL

The SQL below drops objects in reverse migration order. For a partial reverse
(only the last N migrations), take the relevant sections from the bottom up.
No CI job runs this SQL: it would be run by hand.

**Who may do it:** the founder. Nobody else.

**All of these must be true:**

1. A new migration (roll forward) cannot repair it.
2. A Time Travel restore has been considered and is the worse choice.
3. The current Time Travel bookmark for the database is written down
   (`docs/runbooks/DISASTER-RECOVERY.md` §4). It is the way back.
4. The statements have been run on staging first, and staging still passes
   its checks.

**What is lost:** every row in a dropped table and every value in a dropped
column. The Worker that is live may stop working if it reads what was dropped,
so roll the Worker back first (`docs/runbooks/ROLLBACK.md`).

> **STOP.** Say this aloud before running any statement below: "I am dropping
> `<object>` from `<database-name>` in `<environment>`. Its rows will be gone.
> I have the bookmark, and I ran this on staging first."

#### B.1 — `DB` (main database)

```sql
-- 0108: events.attendance_mode ('in_person', 'online' or 'both'; OSE-2012).
-- Additive: NOT NULL with the default 'in_person', and a CHECK on the three
-- values. No row is rewritten. THE ROLLBACK IS: revert the Worker and LEAVE THE
-- COLUMN. The older Worker does not read it, and its creates get the default.
--
-- What the older Worker does NOT know: an event saved as 'online' while the
-- newer Worker was live. The older Worker lists it on /events, the landing page
-- and the sitemap like any other event (it still has no place and no map cell).
-- If that matters before the newer Worker returns, unlist those events first:
--   UPDATE events SET is_published = 0 WHERE attendance_mode = 'online';
--
-- Surgical reverse, only if the column itself must go (the CHECK goes with it):
ALTER TABLE events DROP COLUMN attendance_mode;

-- 0107: switches sponsors on (`useSponsors: true` in events.settings_json) for
-- events whose organizer had already chosen a sponsor (OSE-1900). Data only: no
-- table, column, index or trigger. THE ROLLBACK IS: revert the Worker and LEAVE
-- THE KEY. The older Worker does not read it and its settings reader drops keys
-- it does not know, so sponsors show as they did before the gate existed.
--
-- Surgical reverse, only if the key itself must go. It removes the switch from
-- EVERY event, including the ones an organizer turned on or off by hand after
-- the deploy, and those choices cannot be told apart from the backfill
-- afterwards. If the newer Worker is deployed again, run migration 0107's
-- UPDATE again by hand first, or every sponsor is hidden until its organizer
-- turns sponsors on:
UPDATE events SET settings_json = json_remove(settings_json, '$.useSponsors')
 WHERE json_valid(settings_json) AND json_type(settings_json, '$.useSponsors') IS NOT NULL;

-- 0106: events.place_kind (business or address), how the zoomed map marks an
-- event's place (epic OSE-1880). Additive, nullable; a nightly job fills it.
-- THE ROLLBACK IS: revert the Worker and LEAVE THE COLUMN. The older Worker has
-- no zoomed map and reads no place_kind; a kind already filled stays in the
-- row, unused, until the newer Worker returns.
--
-- Surgical reverse, only if the column itself must go:
ALTER TABLE events DROP COLUMN place_kind;

-- 0105: sponsor_business.header_image_url + header_text, the sponsor's header
-- block on the digital poster (OSE-1826). Additive, nullable, no backfill. THE
-- ROLLBACK IS: revert the Worker and LEAVE THE COLUMNS. The older Worker reads
-- neither column, so the poster shows the logo and name as before; any header a
-- sponsor saved stays in the row, unused, until the newer Worker returns.

-- 0104: events.venue_canonical_id + events.event_correlation_id, each with an
-- index (OSE-1615). Additive. THE ROLLBACK IS: revert the Worker and LEAVE THE
-- COLUMNS. The older Worker reads neither column and runs unchanged.
--
-- One thing the older Worker does not do: clear the keys when it edits a venue,
-- a type or a start. A row it edits in that window keeps the key of the row as
-- it was. Nothing reads the keys yet, and the nightly check of the newer Worker
-- (runSpineKeyCheck) computes rows again and replaces a key that no longer
-- matches, at most 200 a night: one night when fewer than 200 rows are waiting
-- (edited rows and rows with no key yet, together) and the table has at most
-- 5,000 events; more nights otherwise. To have no wrong key
-- at all in the meantime, the owner can clear every key before redeploying.
-- The check then fills them back in at 200 a night, so for a while events
-- have no key rather than a wrong one:
--   UPDATE events SET venue_canonical_id = NULL, event_correlation_id = NULL;
--
-- Surgical reverse, only if the columns themselves must go:
DROP INDEX IF EXISTS idx_events_event_correlation;
DROP INDEX IF EXISTS idx_events_venue_canonical;
ALTER TABLE events DROP COLUMN event_correlation_id;
ALTER TABLE events DROP COLUMN venue_canonical_id;

-- NOTE (2026-10-12): a search of this file finds no entry for migrations 0093 to
-- 0103, nor for 0084, 0085 and 0087. They are not written here, because they
-- were not read for this change. docs/runbooks/PRODUCTION-MIGRATION-PLAN.md
-- says what each of 0078 to 0104 does and which of them change rows.

-- 0092: index on anon_id_returns(pepper_epoch) (OSE-1460 review). Drop it before
-- rolling back 0091.
DROP INDEX IF EXISTS idx_anon_id_returns_pepper_epoch;

-- 0091: anon_id_returns.pepper_epoch (OSE-1460). Additive column; SQLite
-- 3.35+ can drop it. Rolling back means the export again mixes peppers after a
-- rotation, so roll the Worker back first.
ALTER TABLE anon_id_returns DROP COLUMN pepper_epoch;

-- 0090: anon_id_returns indexes for the returns export (rolling window + watermark probe).
DROP INDEX IF EXISTS idx_anon_id_returns_last_seen;
DROP INDEX IF EXISTS idx_anon_id_returns_computed_at;

-- 0089: clear the visitor's IP country (OSE-1460). Data-only: sets
-- scan_node_returns.country_code and scan_aggregates.top_country to NULL. Not
-- reversible and not meant to be: the values are deliberately gone. The partial
-- index can be dropped:
DROP INDEX IF EXISTS idx_snr_country_nonnull;

-- 0088: admin_audit_log.brand_id (AUD-3 Phase B, OSE-1447). Additive column +
-- index. Never DROP the table (append-only, deprecation-lock). To roll back,
-- drop the index and leave the nullable column: the writer tolerates either.
DROP INDEX IF EXISTS idx_admin_audit_log_brand_created;

-- 0086: remove 0013's test-event-001 where nothing references it (OSE-1419).
-- Data-only, no schema change. Rollback is not needed and not wanted: the row
-- is a test fixture, and production should not hold it. To put it back on a
-- non-production database, apply tests/ui/smoke/fixtures/test-event-001.sql.

-- 0083: sponsor public card (OSE-1316/1317 follow-up). Additive: four nullable
-- columns on sponsor_business (display_name, address_line, contact_phone,
-- contact_email). Rollback-forward. If the columns must go, first null them
-- (they are public business details, cleared on sponsor deactivation anyway):
-- UPDATE sponsor_business SET display_name = NULL, address_line = NULL,
--        contact_phone = NULL, contact_email = NULL;
-- ALTER TABLE sponsor_business DROP COLUMN contact_email;   -- optional, additive
-- ALTER TABLE sponsor_business DROP COLUMN contact_phone;   -- optional, additive
-- ALTER TABLE sponsor_business DROP COLUMN address_line;    -- optional, additive
-- ALTER TABLE sponsor_business DROP COLUMN display_name;    -- optional, additive
-- NB: reverting the Worker below this migration is safe (older code never reads
-- these columns); dropping them while this Worker is deployed is not.

-- 0082: poster_deployments.placement_type (OSE-1357 poster tiers). Additive
-- categorical column (venue|community) + a backfill of rows whose address is
-- the event's own. Reverse (safe to leave; nothing else depends on it):
-- ALTER TABLE poster_deployments DROP COLUMN placement_type;   -- optional, additive

-- 0081: sponsor_business.tier + sponsor_asset rebuild (CHECK += logo_compact).
-- tier is additive (rollback-forward). The rebuild copied every row; to undo it,
-- rebuild again with the 0080-era CHECK after deleting 'logo_compact' rows.
-- ALTER TABLE sponsor_business DROP COLUMN tier;             -- optional, additive

-- 0080: shortlinks.poster_position. Additive, rollback-forward.
-- ALTER TABLE shortlinks DROP COLUMN poster_position;        -- optional, additive

-- 0079: poster_deployments.address. Additive, rollback-forward.
-- ALTER TABLE poster_deployments DROP COLUMN address;        -- optional, additive

-- 0078: events.starts_at (OSE-1313). Additive, rollback-forward; start_date
-- remains the date-only fallback every reader already handles.
-- ALTER TABLE events DROP COLUMN starts_at;                  -- optional, additive

-- 0077: node_hierarchy.legal_clearance_tier disambiguation (OSE-1221 — schema
-- guard `check-column-type-collisions.mjs`, OSE-802). Pure RENAME COLUMN, no
-- data change (dead column: not read/written by any src/ code; the growth-wave
-- model it belonged to was superseded by ADR-018 — see ADR-009's 2026-09-10
-- note). Reverse renames it back:
ALTER TABLE node_hierarchy RENAME COLUMN node_hierarchy_legal_tier_label TO legal_clearance_tier;

-- 0076: event-type categories (OSE-1344). Additive: a lookup TABLE + a nullable
-- column + one index. Reverse (category_code is additive and safe to leave):
DROP INDEX IF EXISTS idx_event_type_registry_category;
DROP TABLE IF EXISTS event_type_category_registry;
-- ALTER TABLE event_type_registry DROP COLUMN category_code;   -- optional, additive

-- 0075: events.created_by + status/created_by indexes (Epic TRIANGLE). Additive.
DROP INDEX IF EXISTS idx_events_created_by;
DROP INDEX IF EXISTS idx_events_status_updated;
-- ALTER TABLE events DROP COLUMN created_by;   -- optional, additive

-- 0074: events.what_url_enabled + what_url_type (OSE-1319). Additive columns.
-- ALTER TABLE events DROP COLUMN what_url_type;     -- optional, additive
-- ALTER TABLE events DROP COLUMN what_url_enabled;  -- optional, additive

-- 0073: shortlinks.target_url + kind + idx_shortlinks_event_kind (QR upgrade).
DROP INDEX IF EXISTS idx_shortlinks_event_kind;
-- ALTER TABLE shortlinks DROP COLUMN kind;         -- optional, additive
-- ALTER TABLE shortlinks DROP COLUMN target_url;   -- optional, additive

-- 0072: events.what_url (OSE-1319). Additive column.
-- ALTER TABLE events DROP COLUMN what_url;   -- optional, additive

-- 0071: subscribers email encrypted at rest (Anonymous Contract A-5). NOT a pure
-- add — a TABLE SWAP that DROPS plaintext `email` for email_hash + email_encrypted.
-- A reverse recreates the pre-0071 plaintext-email shape (0008 + 0028), which is a
-- DOCTRINE DOWNGRADE (re-exposes PII at rest) and cannot recover plaintext from the
-- ciphertext. subscribers = 0 prod rows, so the MANDATED posture is ROLLBACK-FORWARD,
-- never this reverse. Do NOT reverse on a populated table.

-- 0070: events.is_published (the "listed" half of publication) + index. Additive.
DROP INDEX IF EXISTS idx_events_published_brand_h;
-- ALTER TABLE events DROP COLUMN is_published;   -- optional, additive

-- 0069: events map-lookup index (OSE-1242).
DROP INDEX IF EXISTS idx_events_brand_h;

-- 0068: sponsor lifecycle + two-sided acceptance (sponsor_business.is_active +
-- index; sponsor_placement.organizer_accepted / sponsor_accepted). Additive.
DROP INDEX IF EXISTS idx_sponsor_business_active;
-- ALTER TABLE sponsor_placement DROP COLUMN sponsor_accepted;    -- optional, additive
-- ALTER TABLE sponsor_placement DROP COLUMN organizer_accepted;  -- optional, additive
-- ALTER TABLE sponsor_business DROP COLUMN is_active;            -- optional, additive

-- 0067: sponsor_placement (per-event attachment) + FK-repoint of the child tables
-- off the retired `sponsors` onto sponsor_business (OSE-799 A2). DESTRUCTIVE and
-- non-trivially reversible: 0067 DROPPED `sponsors` and recreated
-- sponsor_event_types / sponsor_areas / sponsor_impressions with FKs pointing at
-- sponsor_business (0065). A true reverse must recreate the pre-0065 `sponsors`
-- table (see 0002 + its later ALTERs) and repoint those three children back at it.
-- sponsors + all children = 0 rows in every environment, so the MANDATED posture is
-- ROLLBACK-FORWARD (a corrective migration), never this reverse. Surgical drop of the
-- 0067-introduced attachment object only:
DROP INDEX IF EXISTS idx_sponsor_placement_locality;
DROP INDEX IF EXISTS idx_sponsor_placement_business;
DROP INDEX IF EXISTS idx_sponsor_placement_event;
DROP TABLE IF EXISTS sponsor_placement;

-- 0066: sponsor_asset (durable creative — one row per canonical format, OSE-799 A2)
DROP INDEX IF EXISTS idx_sponsor_asset_business;
DROP TABLE IF EXISTS sponsor_asset;

-- 0065: sponsor_business (durable sponsor identity, OSE-799 A2). sponsor_asset (0066)
-- and the 0067-repointed children FK-reference this table — drop 0066/0067 first
-- (above); a full restore of the pre-0065 `sponsors` FK target is rollback-forward.
DROP INDEX IF EXISTS idx_sponsor_business_h3_res7;
DROP INDEX IF EXISTS idx_sponsor_business_brand;
DROP TABLE IF EXISTS sponsor_business;

-- 0064: honesty-lexicon column RENAMEs (OSE-801). Reversible — RENAME COLUMN back
-- (both tables 0 rows). Applies to the schema state BEFORE 0065–0067 (while `sponsors`
-- still exists). In a full 0067→0062 rollback the `sponsors` recreate (rollback-forward)
-- restores the pre-rename identifiers, so this line becomes a no-op there.
ALTER TABLE sponsors        RENAME COLUMN display_token TO impression_token;
ALTER TABLE scan_aggregates RENAME COLUMN distinct_agent_hashes TO unique_agents;

-- 0063: SEED community_gathering template + its type mappings + max_clearance_tier
-- recompute (OSE-800 / A3) — DATA-ONLY, no new table/index. Removes only what 0063
-- added (the community_gathering template + its mappings). The 5 forms 0063 also mapped
-- to EXISTING templates (bar_night / music_event / rec_league) used INSERT OR IGNORE, so
-- some may have pre-existed via 0057 — leave them (rollback-forward for an exact pre-0063
-- state). The recompute is the same reusable statement 0057/0063 use.
DELETE FROM template_event_types WHERE template_id = 'community_gathering';
DELETE FROM event_templates WHERE id = 'community_gathering';
UPDATE event_templates SET max_clearance_tier = (
  SELECT MAX(r.legal_clearance_tier)
  FROM template_event_types t
  JOIN event_type_registry r ON t.uec_code = r.uec_code
  WHERE t.template_id = event_templates.id
);

-- 0062: split scan path → scan_placement_events (WHERE) + scan_node_returns (WHO);
-- DROPPED `scans` + idx_scans_anonymous (doctrine rule 6 — the recombined table is
-- deliberately retired). scans = 0 rows at authoring, so restoring the pre-split `scans`
-- (from 0004 + 0016's anonymous_id ALTER) is ROLLBACK-FORWARD. Surgical drop of the
-- 0062-introduced split tables:
DROP INDEX IF EXISTS idx_snr_event_bucket;
DROP TABLE IF EXISTS scan_node_returns;
DROP INDEX IF EXISTS idx_spe_event_poster;
DROP TABLE IF EXISTS scan_placement_events;

-- 0061: sponsor eligibility columns on sponsor_business_draft (OSE-744 / P1)
-- Metadata-only ADD COLUMN (nullable/defaulted), no count-gate change. SQLite
-- DROP COLUMN unreliable -> rollback-forward (a corrective migration), never a
-- destructive reverse on this table.

-- 0060: SEED business_type_category_map (OSE-731 Sponsor Onboarding) — data-only
DELETE FROM business_type_category_map;

-- 0059: business_type_category_map schema (OSE-730 Sponsor Onboarding)
DROP INDEX IF EXISTS idx_business_type_category_map_bt;
DROP TABLE IF EXISTS business_type_category_map;

-- 0058: category_registry create + seed (OSE-729 Sponsor Onboarding)
DROP TABLE IF EXISTS category_registry;

-- 0057: SEED template_event_types + recompute max_clearance_tier (OSE-728) — data-only
DELETE FROM template_event_types;
UPDATE event_templates SET max_clearance_tier = NULL;

-- 0056: template_event_types join + event_templates.max_clearance_tier (OSE-727)
DROP INDEX IF EXISTS idx_template_event_types_uec;
DROP INDEX IF EXISTS idx_template_event_types_template;
DROP TABLE IF EXISTS template_event_types;
-- event_templates.max_clearance_tier: rollback-forward (SQLite DROP COLUMN
-- unreliable on this seeded table); set to NULL via a corrective migration.

-- 0055: sponsors ADD 12 four-format asset columns (OSE-726 Sponsor Onboarding)
-- SQLite has no reliable ALTER TABLE ... DROP COLUMN on a LOAD_BEARING table
-- (a true reverse needs the recreate-and-copy dance). Primary posture is
-- ROLLBACK-FORWARD: land a corrective migration rather than dropping columns.
-- If a destructive reverse is truly required (pre-launch only), recreate the
-- sponsors table without these 12 columns — DevOps sign-off mandatory.

-- 0054: sponsor_asset_draft (OSE-725 Sponsor Onboarding — per-format render inputs)
DROP INDEX IF EXISTS idx_sponsor_asset_draft_token;
DROP TABLE IF EXISTS sponsor_asset_draft;

-- 0053: sponsor_business_draft (OSE-724 Sponsor Onboarding — resolver-invisible draft)
DROP INDEX IF EXISTS idx_sponsor_business_draft_status;
DROP INDEX IF EXISTS idx_sponsor_business_draft_event;
DROP INDEX IF EXISTS idx_sponsor_business_draft_brand;
DROP TABLE IF EXISTS sponsor_business_draft;

-- 0029–0052: reverse SQL tracked incrementally as each migration lands; the
-- primary production posture for these is rollback-forward (see header note).
-- Pre-0029 canonical reverse SQL continues below.

-- 0028: Replace ip_address with ip_hash on subscribers
ALTER TABLE subscribers ADD COLUMN ip_address TEXT;
ALTER TABLE subscribers DROP COLUMN ip_hash;

-- 0027: qr_verified column
ALTER TABLE events DROP COLUMN qr_verified;

-- 0026: admin_audit_log
DROP INDEX IF EXISTS idx_admin_audit_log_resource;
DROP INDEX IF EXISTS idx_admin_audit_log_actor;
DROP INDEX IF EXISTS idx_admin_audit_log_created_at;
DROP TABLE IF EXISTS admin_audit_log;

-- 0025: event state machine — no-op (only SELECT 1)

-- 0024: seed phase1 event types — data-only (TRUNCATE event_type_registry to roll back)
DELETE FROM event_type_registry WHERE event_phase = 1;

-- 0023: regulatory schema
DROP INDEX IF EXISTS idx_corridor_regulatory_status_corridor;
DROP TABLE IF EXISTS corridor_regulatory_status;
DROP INDEX IF EXISTS idx_event_type_registry_uec;
DROP INDEX IF EXISTS idx_event_type_registry_phase;
DROP TABLE IF EXISTS event_type_registry;

-- 0022: sponsor_impressions
DROP INDEX IF EXISTS idx_sponsor_impressions_event;
DROP INDEX IF EXISTS idx_sponsor_impressions_sponsor;
DROP TABLE IF EXISTS sponsor_impressions;

-- 0021: geo on events
ALTER TABLE events DROP COLUMN lon;
ALTER TABLE events DROP COLUMN lat;
ALTER TABLE events DROP COLUMN zip_code;

-- 0020: sponsor_areas
DROP INDEX IF EXISTS idx_sponsor_areas_zip;
DROP INDEX IF EXISTS idx_sponsor_areas_sponsor;
DROP TABLE IF EXISTS sponsor_areas;

-- 0019: sponsor_event_types
DROP INDEX IF EXISTS idx_sponsor_event_types_template;
DROP INDEX IF EXISTS idx_sponsor_event_types_sponsor;
DROP TABLE IF EXISTS sponsor_event_types;

-- 0018: sponsors tier default — data-only fix; rollback restores prior default
-- (refer to git history of 0018 for the prior DEFAULT value)

-- 0017: template_id on events
ALTER TABLE events DROP COLUMN template_id;

-- 0016: anonymous_id on scans
DROP INDEX IF EXISTS idx_scans_anonymous;
ALTER TABLE scans DROP COLUMN anonymous_id;

-- 0015: seed event templates — data-only (DELETE from event_templates to roll back)
DELETE FROM event_templates;

-- 0014: event_templates
DROP INDEX IF EXISTS idx_event_templates_category;
DROP TABLE IF EXISTS event_templates;

-- 0013: seed test event — data-only. 0086 already deletes test-event-001 wherever
-- nothing references it (OSE-1419); nothing further to reverse.

-- 0012: ring emergence support — index-only ADDs on corridors and node_hierarchy
DROP INDEX IF EXISTS idx_node_hierarchy_ring_role;
-- idx_corridors_signal_class is recreated by 0010, leave in place
DROP INDEX IF EXISTS idx_corridors_temporal;
DROP INDEX IF EXISTS idx_corridors_directionality;

-- 0011: corridor growth model — index/column ADDs on corridors and node_hierarchy
DROP INDEX IF EXISTS idx_node_hierarchy_legal_tier;
DROP INDEX IF EXISTS idx_corridors_growth_pattern;
DROP INDEX IF EXISTS idx_corridors_parent;
-- (ALTER TABLE column ADDs from 0011 must be dropped explicitly — see 0011 source)

-- 0010: NCR v2 hierarchy
DROP INDEX IF EXISTS idx_corridors_signal_class;
DROP INDEX IF EXISTS idx_corridors_status;
DROP INDEX IF EXISTS idx_corridors_brand;
DROP INDEX IF EXISTS idx_node_hierarchy_parent;
DROP INDEX IF EXISTS idx_node_hierarchy_brand_level;
DROP TABLE IF EXISTS corridors;
DROP TABLE IF EXISTS node_hierarchy;

-- 0009: drop form tables from main DB — already a destructive migration;
-- rolling back would require recreating checkins + registrations in DB,
-- which contradicts the architecture invariant 1 (Anonymous ID / two-DB
-- isolation). Do NOT roll this back without explicit architectural review.

-- 0008: subscribers (post-0028 the schema is email/source/ip_hash/created_at)
DROP TABLE IF EXISTS subscribers;

-- 0007: original indexes
DROP INDEX IF EXISTS idx_scan_aggregates_event_date;
DROP INDEX IF EXISTS idx_registrations_source_placement;
DROP INDEX IF EXISTS idx_registrations_event_id;
DROP INDEX IF EXISTS idx_checkins_event_id;
DROP INDEX IF EXISTS idx_scans_poster_deployment;
DROP INDEX IF EXISTS idx_scans_event_bucket;
DROP INDEX IF EXISTS idx_poster_deployments_qr_token;
DROP INDEX IF EXISTS idx_poster_deployments_event_id;
DROP INDEX IF EXISTS idx_sponsors_event_id;
DROP INDEX IF EXISTS idx_events_slug;
DROP INDEX IF EXISTS idx_events_brand_status;

-- 0006: scan_aggregates
DROP TABLE IF EXISTS scan_aggregates;

-- 0005: checkins + registrations
-- These were already dropped by 0009; if you reached this step you skipped 0009.
DROP TABLE IF EXISTS registrations;
DROP TABLE IF EXISTS checkins;

-- 0004: scans
DROP TABLE IF EXISTS scans;

-- 0003: poster_deployments
DROP TABLE IF EXISTS poster_deployments;

-- 0002: sponsors
DROP TABLE IF EXISTS sponsors;

-- 0001: events
DROP TABLE IF EXISTS events;
```

#### B.2 — `FORMS_DB` (identified-user database)

```sql
-- 0013: seed mock/demo mode operational flags (OSE-190 / MOCK-1b-ii) — DATA-ONLY,
-- two feature_flags rows, no new table/index. Both default OFF; production is guarded
-- separately (WORKER_ENV=production). Reverse deletes exactly the seeded rows by id.
DELETE FROM feature_flags WHERE id IN ('seed-config-mock-mode', 'seed-config-mock-sponsor-count');

-- 0012: add consent_type
ALTER TABLE form_registrations DROP COLUMN consent_type;
ALTER TABLE email_signups      DROP COLUMN consent_type;

-- 0011: seed regulatory flags — data-only (DELETE rows added by 0011)
DELETE FROM feature_flags WHERE flag_key LIKE 'regulatory.%';

-- 0010: consent tracking — column ADDs on form_registrations/email_signups
ALTER TABLE form_registrations DROP COLUMN consent_text_version;
ALTER TABLE form_registrations DROP COLUMN consent_at;
ALTER TABLE email_signups      DROP COLUMN consent_text_version;
ALTER TABLE email_signups      DROP COLUMN consent_at;

-- 0009: pii_audit_log
DROP TABLE IF EXISTS pii_audit_log;

-- 0008: anonymous_id on form_registrations / checkin_counts / form_surveys
ALTER TABLE checkin_counts       DROP COLUMN last_anonymous_id;
ALTER TABLE form_registrations   DROP COLUMN anonymous_id;
ALTER TABLE form_surveys         DROP COLUMN anonymous_id;

-- 0007: seed free-tier flags — data-only (DELETE seed rows from feature_flags)
DELETE FROM feature_flags WHERE scope = 'global';

-- 0006: feature_flags (form_config table)
DROP TABLE IF EXISTS feature_flags;

-- 0005: forms indexes
DROP INDEX IF EXISTS idx_email_signups_retention;
DROP INDEX IF EXISTS idx_email_signups_event;
DROP INDEX IF EXISTS idx_form_surveys_event;
DROP INDEX IF EXISTS idx_checkin_counts_event;
DROP INDEX IF EXISTS idx_form_registrations_expires;
DROP INDEX IF EXISTS idx_form_registrations_event;

-- 0004: email_signups
DROP TABLE IF EXISTS email_signups;

-- 0003: form_surveys
DROP TABLE IF EXISTS form_surveys;

-- 0002: checkin_counts
DROP TABLE IF EXISTS checkin_counts;

-- 0001: form_registrations
DROP TABLE IF EXISTS form_registrations;
```

---

---

## Retention policies per table (PII lifecycle)

The scheduled lifecycle job runs daily. It lives in `src/index.ts`:

| Function               | Touches       | What it does                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runFormDataLifecycle` | FORMS_DB only | Deletes expired `form_registrations`, scrubs `form_surveys` PII via the whitelist, deletes `email_signups` past `retention_expires_at`, and (phase 4, OSE-1661) deletes `subscribers` older than 1 to 90 days (`SUBSCRIBERS_RETENTION_DAYS`, default 90; it cannot switch the sweep off). Audits to `pii_audit_log`. Bounded by the `forms-security` S4 isolation gate. |

### Operator knobs

| Env var                                | Default | Effect                                                                                                                      |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `SUBSCRIBERS_RETENTION_DAYS`           | unset   | Defaults to 365 days, so the cron enforces a bounded retention window instead of leaving PII uncapped.                      |
| `SUBSCRIBERS_RETENTION_DAYS=N` (N > 0) | —       | Cron deletes rows where `created_at < datetime('now', '-N days')`. Audits each run.                                         |
| `SUBSCRIBERS_RETENTION_DAYS<=0`        | —       | Cron logs `SUBSCRIBERS_RETENTION_NOOP` and disables the automatic sweep for that run; right-to-erase still works on demand. |

Set via `wrangler secret put` or `[vars]` in `wrangler.toml` per env:

```bash
wrangler secret put SUBSCRIBERS_RETENTION_DAYS --env staging   # interactive value entry
```

### Cross-DB no-raw-IP invariant

`tests/pii-invariant.spec.ts` asserts on every PR that no table in either
binding carries a column whose name is a raw network identifier (`ip_address`,
`client_ip`, `remote_addr`, `x_forwarded_for`, `cf_connecting_ip`, etc.).
The hashed escape hatch (`*_hash`) is allowed. Adding any forbidden column
name fails CI; the right fix is to use a peppered hash like
`hashIpForSubscribe` from OSE-207, not to weaken the gate.

---

## Post-migration smoke test

The authoritative gate is `tests/migration-smoke.spec.ts`, run on every PR
as part of T0 Gate. It asserts:

| What                          | Expected (as of 0067 / forms 0013)                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `DB` tables                   | exactly 35, names match canonical set                                                                                                     |
| `FORMS_DB` tables             | exactly 6, names match canonical set                                                                                                      |
| `DB` triggers                 | 0 (state-machine moved to app layer per 0025)                                                                                             |
| `FORMS_DB` triggers           | 0                                                                                                                                         |
| Critical `DB` indexes present | `idx_events_brand_status`, `idx_events_slug`, `idx_poster_deployments_qr_token`, `idx_spe_event_poster`, `idx_admin_audit_log_created_at` |

> The table/trigger counts and the critical-index-presence list above are asserted
> authoritatively by `tests/migration-smoke.spec.ts` on every PR — that test, not this
> table, is the source of truth. `idx_spe_event_poster` replaced `idx_scans_anonymous`
> when 0062 split the scan path. Total index counts (below) are observability only, not
> gated.

For manual verification against a live D1:

```bash
# All tables in DB
wrangler d1 execute DB --env <env> --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name;"

# All tables in FORMS_DB
wrangler d1 execute FORMS_DB --env <env> --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name;"

# All triggers across both DBs (expected: empty)
wrangler d1 execute DB        --env <env> --remote --command \
  "SELECT name FROM sqlite_master WHERE type='trigger';"
wrangler d1 execute FORMS_DB  --env <env> --remote --command \
  "SELECT name FROM sqlite_master WHERE type='trigger';"

# Custom indexes only (idx_* prefix)
wrangler d1 execute DB        --env <env> --remote --command \
  "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name;"
wrangler d1 execute FORMS_DB  --env <env> --remote --command \
  "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name;"
```

The CI smoke test emits a JSON observability line per run:

```
{"type":"OSE_209_MIGRATION_SMOKE","db":{"tables":35,"indexes":66,"triggers":0},"forms_db":{"tables":6,"indexes":12,"triggers":0},"timestamp":"..."}
```

Grep CI logs for `OSE_209_MIGRATION_SMOKE` to confirm the run executed
and read the live count.

---

## Adding a new migration — checklist

When you add migration `NNNN_*.sql` to either `migrations/` or `migrations-forms/`:

1. The migration SQL itself must be idempotent (`IF NOT EXISTS` / `IF EXISTS` clauses).
2. Update `tests/migration-smoke.spec.ts` `DB_TABLES` or `FORMS_DB_TABLES` constants if a new table is added.
3. Update `.github/workflows/oursharedevents-ci.yml` `EXPECTED_DB` / `EXPECTED_FORMS` shell variables — in **both** the T1 Deploy → Staging and T1 Deploy → Production blocks. These run against the live D1 post-`wrangler d1 migrations apply` and must agree with the miniflare-based smoke test (#2).
4. Update `tests/constraints.spec.ts` table/index counts if those change.
5. Add a "## NNNN" entry to the relevant section (B.1 or B.2) of this file with the reverse SQL.
6. Run `npx vitest run tests/migration-smoke.spec.ts tests/constraints.spec.ts` locally — both must pass.
7. Document data-loss implications in the PR description if the migration drops a column or table.
