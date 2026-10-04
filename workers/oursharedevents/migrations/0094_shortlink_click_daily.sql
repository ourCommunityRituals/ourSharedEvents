-- Migration 0094: shortlink_click_daily (OSE-1613) — shortlink clicks by UTC day.
--
-- shortlinks keeps a running total plus the time of the last click, so reach
-- before an event could not be shown week by week. This table adds one counter
-- per link per day. It is an aggregate, never a per-click row: no timestamp
-- finer than the day, no IP, no user agent, no anonymous id, no referrer.
-- The existing shortlinks.clicks total is unchanged.

CREATE TABLE IF NOT EXISTS shortlink_click_daily (
  code   TEXT    NOT NULL,
  day    TEXT    NOT NULL, -- UTC YYYY-MM-DD
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (code, day)
);
