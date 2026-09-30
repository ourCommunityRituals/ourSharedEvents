-- Migration 0085: events.settings_json — per-event section switches (OSE-869 / OSE-851)
--
-- GAS let an organiser turn sections of an event's surfaces on and off. The
-- Worker port dropped every one of those switches. PO decision (2026-09-30):
-- the switches live per event, in this column, read ONLY through
-- src/lib/event-settings.ts. The first key is `showQRSection` (a walk-up event
-- can print a poster with no QR codes); OSE-851's other toggles join it there.
--
-- Additive. NOT NULL DEFAULT '{}' so every existing event reads as "all
-- sections on" — an absent key means on, so no existing poster changes.
-- Carries no identity and is never part of the public event projection.

ALTER TABLE events ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}';
