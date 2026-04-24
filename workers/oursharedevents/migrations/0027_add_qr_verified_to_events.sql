-- Migration 0027: Add qr_verified flag to events (OSE-213 / BE-18)
-- Supports the READY → ACTIVE QR verification flow.
ALTER TABLE events ADD COLUMN qr_verified INTEGER NOT NULL DEFAULT 0;
