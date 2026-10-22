# Current instrumentation architecture: ourSharedEvents (2026-10-04)

- **SDK:** none. Measurement is handwritten SQL inside the Cloudflare Worker.
- **Where calls run:** server side only, in the Worker. Browser templates send `fetch` beacons to Worker routes for sponsor impressions and clicks. Scans, clicks and check-ins are recorded inside the request handler.
- **Routing:** scans go to a Cloudflare Queue (`enqueueOrWriteScan`), with direct-to-D1 fallback when the queue is missing or fails; the consumer retries up to 3 times, then dead-letters. Beacons, counters and form writes go straight to D1.
- **Identity:** an anonymous id cookie (`lib/anonymous-id.ts`), with no identify or group calls. Admin actors are recorded in `admin_audit_log`, separate from measurement.
- **Storage and export:** D1 (`DB` and `FORMS_DB`), with materializers to aggregate tables. BigQuery datasets are per environment; any environment other than production refuses to write the production dataset (OSE-1416).
- **Config:** `BIGQUERY_DATASET_ID` per env in wrangler.toml; the scan queue binding; `PUBLISH_GRACE_MINUTES`, `DRAFT_EXPIRY_DAYS`.
- **Error handling:** non-blocking. Shortlink increments swallow D1 errors and log `SHORTLINK_CLICK_LOG_ERROR` so the redirect always works. The scan producer never throws on a queue outage. Report-access logging runs in `ctx.waitUntil`.
- **Flush:** no client SDK, so nothing to flush. The queue handles delivery.
- **Worth keeping:** split scan rows, queue with fallback, the beacon fraud filter, the res-7 attribution, and fail-closed environment isolation.
