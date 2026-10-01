-- Migration 0088: stop holding the visitor's country (OSE-1460, PO decision 2026-10-01).
--
-- scan_node_returns.country_code came from the CF-IPCountry request header: where
-- the visitor's IP (or their VPN) appeared to be, not where the event was. The
-- product never consults a request's apparent location (QR-AND-SHORTLINKS.md),
-- so the scan path no longer reads that header (handlers/qr-scan.ts) and the
-- nightly roll-up no longer computes scan_aggregates.top_country.
--
-- This clears what was recorded before. The columns stay (nullable) so older
-- queued scan messages and rollback stay simple; nothing writes a value again.
-- Idempotent: a re-run matches no rows.

UPDATE scan_node_returns SET country_code = NULL WHERE country_code IS NOT NULL;

UPDATE scan_aggregates SET top_country = NULL WHERE top_country IS NOT NULL;
