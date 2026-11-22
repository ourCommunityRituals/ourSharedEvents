-- Migration 0116: a sponsor's kind of business (Part of OSE-2207).
--
-- WHY. The owner chose (2026-11-22, decision card in the thread "Add icon
-- category slider to landing") that in Create Sponsor the icon slider picks the
-- sponsor's kind of business, saved with the sponsor, so attendees can later
-- browse sponsors by kind.
--
-- WHAT. One nullable column on sponsor_business. The allowed values are the list
-- in src/lib/business-kinds.ts, checked by the handler on every write; the
-- column holds no constraint so a kind can be added without a migration.
-- Existing rows read NULL ("not said"). Writes no row.
--
-- The kind is about the business, never a person, and public in the same way
-- the sponsor's name is. MAIN DB only (ADR-001).
--
-- Invariant compliance:
--   #19 — > 0115, unique prefix, append-only, additive (no drop, no rewrite).

ALTER TABLE sponsor_business ADD COLUMN business_kind TEXT;
