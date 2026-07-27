-- Attendee-arc phase fixtures (OSE-455 / ose-client-ready package).
-- Apply before running T4 Functional attendee-arc smoke:
--   wrangler d1 execute DB --env staging --remote --file tests/ui/smoke/fixtures/smoke-events.sql
--
-- Dates are relative so the fixtures never rot. Venue matched (Eagles Hall)
-- so the post-event page's next-event query finds the pre-event row.
--
-- CI env: SMOKE_EVENT_PRE=evt_smoke_pre SMOKE_EVENT_LIVE=evt_smoke_live SMOKE_EVENT_POST=evt_smoke_post
INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, location, where_address,
  what_short, who_host, why_purpose, start_date, end_date)
VALUES
 ('evt_smoke_pre',  'ose', 'Smoke Bocce (Upcoming)', 'smoke-pre',  'active', 'Eagles Hall', '2427 Grove St',
  'Four tables, one patio', 'OSG', 'The corridor gathers',
  datetime('now','+2 days'), datetime('now','+2 days','+4 hours')),
 ('evt_smoke_live', 'ose', 'Smoke Bocce (Tonight)',  'smoke-live', 'active', 'Eagles Hall', '2427 Grove St',
  'Four tables, one patio', 'OSG', 'The corridor gathers',
  datetime('now','-1 hour'), datetime('now','+3 hours')),
 ('evt_smoke_post', 'ose', 'Smoke Bocce (Last Week)','smoke-post', 'active', 'Eagles Hall', '2427 Grove St',
  'Four tables, one patio', 'OSG', 'The corridor gathers',
  datetime('now','-7 days'), datetime('now','-7 days','+4 hours'));
