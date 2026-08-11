-- OSE-606 / OSE-608 — data_class: the third data class beside production/synthetic.
--
-- The demo doctrine (docs/demo/DEMO-DOCTRINE.md, OSE-606): demo rows live in
-- production, labeled at write time, permanently excluded from vintage,
-- reports-for-sale, and the research corpus. One enum, three classes, defined
-- once here:
--
--   data_class: 'production' | 'synthetic' | 'demo'
--
-- Additive + safe: existing rows default to 'production' (they are real). Demo
-- fixtures (mock-data.ts getRiphDataset) are written 'demo'; smoke/QA rows are
-- 'synthetic'. The CHECK constraint makes an unknown class impossible at write
-- time — the write-side complement to the fail-closed pool routing (OSE-677),
-- which withholds any row whose class cannot be resolved rather than leaking it.
--
-- Onboarding-by-relabeling: a founding client's real venue flips 'demo' →
-- 'production' in place; the URL a prospect saw is the URL they receive.

ALTER TABLE events ADD COLUMN data_class TEXT NOT NULL DEFAULT 'production'
  CHECK (data_class IN ('production', 'synthetic', 'demo'));

-- Fast filtering for the export/vintage exclusion of demo + synthetic rows.
CREATE INDEX IF NOT EXISTS idx_events_data_class ON events(data_class);
