-- Migration 0118: brands that contain brands (Part of OSE-1553, OSE-1532).
--
-- WHY. Owner, 2026-11-23: a company's ventures each run their own events as
-- separate brands, and the parent company sees all of them and their roll-up.
-- Until now a brand had no parent: it was only a string on rows.
--
-- WHAT. One row per brand that has a parent: the brand and its parent. A
-- member of a brand also reaches every brand below it (lib/brand-tree.ts).
-- Membership flows down only: a child's members never reach the parent or a
-- sibling. A brand with no row here is a brand with no parent, as before.
--
-- Rows are written by the audited runbook step (as for memberships), and on
-- staging by the CI seed of practice brands. This migration writes none.
--
-- Invariant compliance:
--   #9  — tenant isolation: reach widens only down a tree the platform writes.
--         The platform brand and the public brand are never in the tree.
--   #19 — > 0117, unique prefix, append-only, no table drop.
--   ADR-001 — MAIN DB only. No person column.

CREATE TABLE IF NOT EXISTS brand_parents (
  brand_id        TEXT PRIMARY KEY,
  parent_brand_id TEXT NOT NULL,
  CHECK (brand_id <> parent_brand_id),
  CHECK (brand_id NOT IN ('ose-platform', 'root')),
  CHECK (parent_brand_id NOT IN ('ose-platform', 'root'))
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_brand_parents_parent ON brand_parents (parent_brand_id);
