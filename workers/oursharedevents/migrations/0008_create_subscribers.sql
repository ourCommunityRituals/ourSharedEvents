-- Migration 0008: Create subscribers table for email capture
-- Phase 1 landing page email collection.
-- Unique constraint on email prevents duplicates (idempotent subscribe).

CREATE TABLE IF NOT EXISTS subscribers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  ip_address  TEXT,
  source      TEXT NOT NULL DEFAULT 'landing',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
