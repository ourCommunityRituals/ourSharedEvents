-- Migration 0107: switch sponsors on for the events whose organizer already
-- chose one (OSE-1900, owner decision 2026-11-09, "sponsors only if the event
-- chose them").
--
-- From this release a sponsor shows only on an event that opted in: the event
-- switch `useSponsors` in events.settings_json, where ABSENT MEANS OFF
-- (src/lib/event-settings.ts, and the gate every sponsor reader uses is in
-- src/lib/sponsor-card.ts). Without this migration every sponsor already on a
-- page would disappear at deploy. An organizer who added or approved a sponsor
-- has already chosen, so those events are switched on here and nobody's sponsor
-- disappears.
--
-- "The organizer already chose" is read from the placement, with the same
-- organizer rule the readers use (ADR-019): the placement is on (is_active = 1)
-- and the organizer accepted it, where silence counts only for a placement the
-- organizer created (not for a sponsor's own request). The sponsor's answer is
-- NOT required: an invite the sponsor has not answered yet is still the
-- organizer's choice, and it shows the day the sponsor accepts. The business
-- must be active and in the event's own brand, because no other placement can
-- ever show.
--
-- What it does not touch:
--   - an event with no such placement: it stays off, like every new event.
--   - an event that already holds the key, true or false: it is left as it is,
--     so running this again changes nothing and an explicit off is never undone.
--   - any other key in settings_json: json_set adds one key and keeps the rest.
--   - sponsor_placement, sponsor_business: no row is written or removed.
-- Settings text that is not a JSON object reads as `{}` everywhere in the
-- Worker (parseEventSettings), so here it is replaced by `{}` plus the key.
--
-- No schema change: no table, column, index or trigger.
--
-- Rollback: revert the Worker. The older Worker does not read the key and its
-- settings reader drops keys it does not know, so the stored key is inert. To
-- remove it as well, see ROLLBACK_PLAN.md, 0107.

UPDATE events
   SET settings_json = json_set(
         CASE WHEN json_valid(settings_json) AND json_type(settings_json) = 'object'
              THEN settings_json ELSE '{}' END,
         '$.useSponsors', json('true'))
 WHERE (CASE WHEN json_valid(settings_json) AND json_type(settings_json) = 'object'
             THEN json_type(settings_json, '$.useSponsors') END) IS NULL
   AND EXISTS (
         SELECT 1
           FROM sponsor_placement sp
           JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
          WHERE sp.event_id = events.id
            AND sp.is_active = 1
            AND sb.is_active = 1
            AND sb.brand_id = events.brand_id
            AND COALESCE(sp.organizer_accepted,
                         CASE WHEN sp.source = 'sponsor_request' THEN 0 ELSE 1 END) = 1
       );
