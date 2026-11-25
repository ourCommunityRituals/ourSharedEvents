-- Migration 0121: paid add-ons a brand has been given (Part of OSE-2232).
--
-- WHY. Owner, 2026-11-25: "I want the base skin as what I use and sell so
-- everyone can use without the skin, then sell the skin and reasonable extra
-- service." The standard look is free for every brand. Any other look, a
-- ready-made skin or a custom one, is an add-on the platform turns on for a
-- brand. No billing yet: a row here is the switch.
--
-- WHAT.
--   brand_addons  one row per brand and add-on that is on. No row = off.
--                 Only a platform key actor writes it, through an audited
--                 route (PUT /api/v2/admin/addons). 'skins' is the only add-on.
--
-- Invariant compliance:
--   #1  — no person column: a brand id, an add-on name, when, and the actor
--         kind that granted it.
--   #5  — security is never tier-gated: this gates a look, never audit,
--         roles, isolation or retention.
--   #19 — > 0120, unique prefix, append-only, no table drop.
--   ADR-001 — MAIN DB only.

CREATE TABLE IF NOT EXISTS brand_addons (
  brand_id   TEXT NOT NULL,
  addon      TEXT NOT NULL CHECK (addon IN ('skins')),
  granted_at TEXT NOT NULL,
  granted_by TEXT NOT NULL CHECK (granted_by IN ('platform')),
  PRIMARY KEY (brand_id, addon)
) WITHOUT ROWID;
