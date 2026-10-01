# OSE Worker — Architecture Review (2026-10-01)

**Scope:** `workers/oursharedevents/src` (≈36.5K LOC TS, 35 handlers, 85 lib modules, 1 router).
**Lens:** extended scrum team — BE, FD, Sr Design FE, Sr Automation QA, SRE/SDET, DevOps, **Dr of Security**, Sr Data Scientist.
**Method:** I traced the request lifecycle by hand, ran three parallel read-only sweeps (duplication, performance/scale, security), and **re-verified every finding in this document against source** before writing it down. Items marked _(agent, unverified)_ were not re-checked.

---

## 1. Architectural breakdown

### 1.1 Runtime topology

```
                  ┌──────────────────────── Cloudflare edge ─────────────────────────┐
 Browser / QR ──▶ │ CF Access (admin paths only) ──▶ Worker isolate                  │
                  │                                                                   │
                  │  index.ts  fetch ─┬─ schema-guard (once per isolate)             │
                  │                   ├─ cost-metric instrumentation (D1 proxies)     │
                  │                   ├─ route()  ── router.ts (1,872-line if-chain)  │
                  │                   └─ X-Monetization-Inert header (re-wrap)        │
                  │            scheduled ─ 9 phases in one Promise.all (daily cron)   │
                  │            queue ───── SCAN_QUEUE consumer (dark until bound)     │
                  └──────┬───────────┬──────────┬──────────┬──────────┬───────────────┘
                         │           │          │          │          │
                   D1 "DB"     D1 "FORMS_DB"   KV       R2 uploads   External
                  anonymous     identified   rate-limit, (event media) Google Maps,
                  surface:      PII (enc.),  scan dedup              BigQuery, Linear,
                  events,       registr.,                            sponsor logo hosts
                  sponsors,     surveys,
                  scans, audit  flags, PII audit
```

**The load-bearing structural rule is two-DB isolation.** `DB` holds the anonymous surface and `FORMS_DB` holds identified PII, and no handler may reach across the boundary (gate: `tests/architecture.spec.ts`). The rule is sound, and the code respects it: I found no cross-DB joins.

### 1.2 Request pipeline (`router.ts::route`), in order

1. `bindCorsEnv`: a WeakMap keyed by Request, so it is safe per request.
2. HTTP→HTTPS 308 (loopback exempt).
3. OIDC well-knowns.
4. `guardPublicReadOnly` (OSE-214).
5. CORS preflight.
6. **Public hot paths:** `/q/` (scan), `/s/` (shortlink), default sponsor logo, `/ui.css` (ETag), demo, robots/sitemap, health, UEC.
7. **CF Access JWT pre-flight.** The RSA signature is verified once if the header is present.
8. Admin KV rate limit (production only).
9. **`guardAdminObjectScope`.** One object-level brand guard for `/admin/events/:id/**` and `/admin/poster-deployments/:id`.
10. **≈44 admin routes.** Each repeats `reqId → requireAdmin → _audit(denied) → handler → _audit(outcome)`.
11. Public API, forms (phase gate + flag gate + rate limit), pages.
12. 404.

### 1.3 End-to-end data flows (the five that matter)

| Flow                                           | Path                                                                                                                                                                | Notes                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **QR scan** (busiest write path)               | `/q/<token>` → `qr-scan.ts` → 1 D1 read of `poster_deployments` → KV get+put dedup → `SCAN_QUEUE.send` (or 2 D1 inserts when unbound) → 302 to `/events/:id`        | Never-who: the anon id is a cookie hash, no IP is stored. Every step is awaited before the 302. |
| **Public event page** (where every scan lands) | `/events/:id` → `pages.ts` → `DataProvider.getEvent` (CF-cache SWR) + about 6 parallel D1 reads → template + per-response CSP nonce                                 | `private` cache because the nonce is per response, so every view costs D1 queries.              |
| **Admin mutation**                             | CF Access → JWT pre-flight → object scope → `requireAdmin` (verifies JWT **again**) → handler (`resolveAdminBrandScopeAsync`, a D1 read) → `_audit` via `waitUntil` | Two RSA verifies plus 1–2 membership reads per request.                                         |
| **Forms (PII)**                                | `POST /api/v2/events/:id/forms/*` → event phase gate → flag gate → rate limit → `forms.ts` → AES-GCM encrypt (PBKDF2 key cached per isolate, #707) → `FORMS_DB`     | The cron scrubs and expires.                                                                    |
| **SharedReport**                               | Cron materialises aggregates (`shared-report.ts`) → BigQuery export (dataset per env, OSE-1416) → signed-link read (`shared-report-read.ts`, HMAC)                  | K≥5 floor per bucket (#7).                                                                      |

### 1.4 What is architecturally _good_ (keep it)

- The invariants are enforced by gates, not by prose. That includes 26 structural gates, born-red discipline, and Stryker on the auth and privacy core.
- Tenant isolation fails closed. A scoped miss returns 404, never 403. Brand scope is derived on the server from the verified actor.
- All SQL is parameterised. **No injection was found.** Every dynamic fragment is a constant or a generated `?` list.
- All secret comparisons are constant-time. Audit and export writes use `waitUntil`, and no floating promises were found.
- The global catch in `index.ts` never leaks stack traces.

---

## 2. Critical problem areas

Severity uses the CCR scale. **✅ FIXED** means fixed in this change set with a born-red test.

### 2.1 Correctness and integrity

| #   | Sev                                   | Finding                                                                                                                                                                                                                                                                                                                         | Evidence                                                                                                                                    | Status                                                           |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| C1  | **High** (SOC 2 / OSE-1444)           | **The audit log records failed mutations as successes.** Ten admin mutations wrote `outcome='success'` to the append-only `admin_audit_log` whatever status the handler returned, so a 400, 404, 409 or 503 read as a completed write. This is drift: `UPDATE_EVENT` and `DELETE_EVENT` were already fixed in CCR-PR567 item 7. | `router.ts`: CREATE_EVENT, CREATE_SPONSOR, UPDATE_SPONSOR(_EVENT_TYPES/_AREAS), DELETE_SPONSOR, SET_FLAG, APPLY_TIER, SET/REMOVE_EVENT_FLAG | ✅ FIXED (`_auditOutcome`)                                       |
| C2  | Med                                   | **The audit row cannot be joined to its request.** VERIFY_QR and UNVERIFY_QR were audited under a fresh `crypto.randomUUID()`, not the id that `requireAdmin` put in `X-Request-Id`.                                                                                                                                            | `router.ts` verify/unverify blocks                                                                                                          | ✅ FIXED                                                         |
| C3  | **High** (data loss)                  | **The sponsor replace was not atomic.** `PUT /sponsors/:id/event-types` and `/areas` ran the DELETE as one round trip and the INSERTs as a second batch. A failed insert (for example a duplicate id hitting `UNIQUE`) left the sponsor with **zero** associations.                                                             | `sponsors.ts` `handleSetSponsorEventTypes` / `handleSetSponsorAreas`                                                                        | ✅ FIXED (single `db.batch` = one transaction)                   |
| C4  | **High** (silent wrong data at scale) | **The portfolio rollup breaks above 100 events.** It bound one `?` per brand event. D1 caps a statement at 100 bound parameters, so the query threw, the `catch` returned 0, and the admin strip showed a plausible but wrong portfolio. Verified in miniflare: 120 events returned `activeSponsors = 0`.                       | `portfolio-rollup.ts`                                                                                                                       | ✅ FIXED (held-id IN lists chunked at 90; 3 queries in parallel) |
| C5  | Low                                   | The code contradicts its comment: the shortlink click was documented as not awaited but was awaited, and it cost UPDATE + SELECT.                                                                                                                                                                                               | `shortlink-resolve.ts`, `shortlinks.ts`                                                                                                     | ✅ FIXED (one `UPDATE … RETURNING`, comment corrected)           |
| C6  | Med                                   | Some mutations write **no** audit row on success: poster-deployment create, update and delete; sponsor home-link mint; sponsor-request answer. Only the denied path is audited.                                                                                                                                                 | `router.ts`                                                                                                                                 | Open (recommend audit + test)                                    |

### 2.2 Security (Dr of Security)

| #   | Sev                    | Finding                                                                                                                                                                                                                                                                                                                                                                                     | Evidence                                                                                | Status                                                                                                                                                                     |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | **High**               | **Any brand-scoped operator can change platform-wide feature flags and the tier.** `PUT /api/v2/admin/flags/:key` and `POST /api/v2/admin/flags/apply-tier` are guarded only by `requireAdmin`, with no `_platformOnly`. A global flag affects **every tenant**. This contradicts the `ose-platform` rule that platform-owned routes are key-actor or `ose-platform` member only (PR #722). | `router.ts` flag routes (verified: no `_platformOnly` call)                             | **Open, already tracked** as OSE-1444 S1 (fix in AUD-3). Not changed here: it is an authorization change. Fix: add `_platformOnly(reqId)` to both, plus an invariant test. |
| S2  | Med (config-dependent) | `extractAdminActor` decodes the CF Access JWT **without verifying it**, and that actor feeds brand scope and audit attribution. In a deployed env without `CF_ACCESS_TEAM_DOMAIN`, a key-holder could send a forged JWT and borrow any brand's scope. The router pre-flight also omits `expectedAud`.                                                                                       | `auth/admin.ts`; `router.ts` JWT pre-flight _(agent; pre-flight aud omission verified)_ | Open. Fix: derive the actor from the _verified_ payload only, and pass `expectedAud` in the pre-flight.                                                                    |
| S3  | Med                    | **Public Google Maps proxy with no rate limit.** Each new `?venue=` string is a cache miss that spends the server's API key.                                                                                                                                                                                                                                                                | `router.ts` → `lib/maps.ts` _(agent, unverified)_                                       | Open. Fix: wrap with `publicReadLimited`.                                                                                                                                  |
| S4  | Med                    | Sponsor-draft fields have no length caps and no scheme check on `website_url`. Promotion copies them into `sponsor_business` and bypasses the admin `checkWebsite` rule.                                                                                                                                                                                                                    | `sponsors-draft.ts`, `sponsor-promotion.ts` _(agent, unverified)_                       | Open                                                                                                                                                                       |
| S5  | Low                    | Cross-tenant **read** of flag overrides through `?eventId=`. The object guard only matches ids in the path.                                                                                                                                                                                                                                                                                 | `feature-flags.ts` _(agent)_                                                            | Open                                                                                                                                                                       |

### 2.3 Performance and scalability (SRE/SDET, Sr Data Scientist)

| #   | Sev                  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Evidence                                                                                                                                                                                 |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **High**             | **The KV rate limiter writes on every allowed request.** `checkRateLimit` does get, then `put` (verified). KV allows about 1 write per second per key and is eventually consistent, so a crowd behind one venue NAT will (a) get a lost-update undercount and (b) hit KV write-rate errors. The router's direct calls have **no try/catch**, so that error becomes a **500** at the venue door. `publicReadLimited` already fails open, but the admin, mint and forms call sites do not. | `lib/rate-limit.ts:68-92`                                                                                                                                                                |
| P2  | **High**             | **The busiest public reads are uncached.** `listEvents` skips the cache by design (verified comment). `/api/v2/events`, `/events` and the landing page each pull up to 1000 wide rows from D1 on every hit.                                                                                                                                                                                                                                                                              | `lib/data-provider.ts:260`                                                                                                                                                               |
| P3  | High (as scans grow) | **The nightly materialisation does N+1 writes.** It upserts one row per anon id, per corridor cell and per scan bucket, all inside one `Promise.all` cron invocation, which shares the per-invocation D1 query budget.                                                                                                                                                                                                                                                                   | `lib/shared-report.ts` _(agent)_                                                                                                                                                         |
| P4  | High                 | The SharedReport batch endpoint fans out up to 50 builds of about 15 sequential queries each, roughly 750 queries per request, close to D1's per-invocation limit.                                                                                                                                                                                                                                                                                                                       | `shared-report-read.ts`, `shared-report-builder.ts` _(agent)_                                                                                                                            |
| P5  | Med                  | `requireAdmin` re-ran the full RSA verification already done in the router pre-flight, and brand scope is re-resolved from D1 in each handler. That was 2× crypto plus 1–2 reads per admin request.                                                                                                                                                                                                                                                                                      | `router.ts`, `auth/admin.ts` (verified). **✅ RSA half FIXED: OSE-1463**, a per-request signature memo (claims re-checked every call; Stryker 99.25%). Brand-scope reads are still open. |
| P6  | Med                  | Unbounded admin reads: the registrations list decrypts **every** row (OSE-1442), the surveys and forms export, and the sponsors list (a 4-way JOIN).                                                                                                                                                                                                                                                                                                                                     | `forms.ts`, `sponsors.ts`                                                                                                                                                                |
| P7  | Med                  | Missing indexes: `scan_node_returns(anonymous_id)` (erasure), `form_registrations(attendee_email_hash)`, `email_signups(email_hash)`, `created_at` on the retention tables, and `events(brand_id,status,is_published,start_date)` for the sorted public list.                                                                                                                                                                                                                            | `migrations/` _(agent)_                                                                                                                                                                  |
| P8  | Low-Med              | HMAC keys go through `importKey` on every sign/verify in 4 modules, including once per sponsor on each public sponsor-bundle request. `pii.ts` already shows the cache pattern (#707).                                                                                                                                                                                                                                                                                                   | `beacon-token.ts`, `sponsor-home-auth.ts`, `shared-report-auth.ts`, `sponsor-invite.ts`                                                                                                  |
| P9  | Low-Med              | `h3-js` (≈85% of startup CPU, per STARTUP-COST-2026-09-30) is imported statically by 6 modules, so `/q/` cold starts pay for it.                                                                                                                                                                                                                                                                                                                                                         | already tracked as a pending decision                                                                                                                                                    |

### 2.4 Maintainability (BE, FD, QA)

| #   | Finding                                                                                                                                                                             | Copies                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| M1  | **The router is a 1,872-line linear `if` chain.** Each admin route hand-repeats the reqId, `requireAdmin`, audit and outcome sequence. C1 and C2 are this drift showing up as bugs. | 44 × `requireAdmin(…crypto.randomUUID?.() ?? …)`        |
| M2  | Response envelopes: 15 local helpers in **5 different shapes** (`requestId`/`timestamp`/`error` each sometimes missing).                                                            | `errorResponse` ×7, `rid()` ×7                          |
| M3  | Security primitives are copy-pasted: `constantTimeEqual` ×5, HMAC-hex ×4, base64url ×4, hex ×12. They are byte-identical today, but one diverging fix creates a weak copy.          | `lib/*-auth.ts`, `beacon-token.ts`, `sponsor-invite.ts` |
| M4  | HTML/XML escaping: 8 implementations, even though `lib/html-escape.ts` exists (one copy does not escape `'`).                                                                       | `pages.ts`, `form-pages.ts`, `corridor-map.ts`, …       |
| M5  | Body parsing uses 4 strategies, and 7 sites have **no size cap**. The same failure gets 3 different error codes (`INVALID_BODY`/`INVALID_JSON`/`BAD_REQUEST`).                      | `feature-flags.ts`, `shared-report-read.ts`, …          |
| M6  | SQL predicates are copied: placement-accepted ×6 (despite `SPONSOR_ON_SHOW_SQL`), live-event filter ×9, brand `IN` list ×6.                                                         | see sweep                                               |
| M7  | Pagination parsing is pasted 3× (audit, events, subscribers; one even says "match … exactly").                                                                                      |                                                         |
| M8  | `index.ts` holds business logic: the PII scrub whitelist and 9 lifecycle phases sit beside `fetch`.                                                                                 | `index.ts` 774 lines                                    |
| M9  | Two god files: `pages.ts` (2,465) and `sponsors.ts` (1,839).                                                                                                                        |                                                         |

---

## 3. Refactoring strategy

**Constraint discovered:** **32 test files parse `router.ts` as source text** (audit-literal regexes, route-presence gates, rate-limit gates), and the `0-architecture` invariants read specific lib files (for example `edge-token-verification` requires `function constantTimeEqual` _in_ `sponsor-home-auth.ts`). A big-bang rewrite would turn dozens of gates red at once and hide real regressions in the noise. **Every step below is incremental, behaviour-preserving, and moves its gate in the same PR.**

### Phase A — Correctness first (this change set ✅, plus S1)

1. ✅ C1–C5, each with born-red tests.
2. **S1 (PO decision):** platform-gate the global flag writes. This is one line per route plus an invariant test.
3. C6: audit the success path on the five unaudited mutations.

### Phase B — Shared kernels (low risk, high leverage)

1. **`lib/http.ts`:** one `jsonOk` / `jsonError(code, msg, status, {request, rid})` envelope (always `requestId`, CORS, `X-Request-Id`), one `requestId()`, one `parseJsonBody(request, {maxBytes})`, one `parsePagination(url)`. Migrate handler by handler, and add a ratchet gate that counts local `errorResponse` definitions and lets the count only go down (the same pattern as `.ocr-design-check.json`).
2. **`lib/crypto-util.ts`:** `bytesToHex`, `constantTimeEqual`, `hmacSha256Hex` **with a per-isolate `Promise<CryptoKey>` cache** (never caching a failed import, as #707 does), and `b64url`. Re-export from the modules the gates read, so the gate assertions keep holding, _or_ move each gate's subject to the shared module in the same PR.
3. **SQL fragments:** export `PLACEMENT_ACCEPTED_SQL`, `LIVE_PUBLIC_EVENT_SQL`, and `inList(ids)` (which throws above 90, so C4 cannot recur silently).
4. Route every escape through `lib/html-escape.ts` and every IP read through `clientIp()`.

### Phase C — Router: declarative admin table

Replace the hand-written admin preamble with a small, typed route table:

```ts
type AdminRoute = {
  method: Method;
  pattern: RegExp;
  audit?: string; // literal action — gates can still grep it
  platformOnly?: boolean;
  handler: (ctx: AdminCtx, ...params: string[]) => Promise<Response>;
};
// dispatchAdmin() does: reqId → requireAdmin → audit denied → platformOnly →
// handler → audit _auditOutcome(res) → export manifest (if declared).
```

The outcome rule and the request-id threading then live in **one** function, which closes the C1/C2 class of bug structurally. Migrate one route family per PR (flags → sponsors → poster → events) and keep the action literals in the table so the audit-coverage gates still match them.

### Phase D — Scale (before nationwide; ties into the engine-hardening memory)

1. **P1:** move rate limiting to the **Workers Rate Limiting binding** (or a DO counter). Until then, make every `checkRateLimit` call site fail open the way `publicReadLimited` does, and document the decision.
2. **P2:** edge-cache `listEvents` per brand for 30–60 s and purge on event mutation, as is already done for sponsors.
3. **P3/P4:** chunk `DB.batch()` writes in the cron; use incremental watermarks for `aggregateScanBuckets`; cap the SharedReport batch and batch its reads.
4. **P5:** memoise per request (a WeakMap keyed by Request) the verified JWT payload and the resolved brand scope, so `extractAdminActor` reads the **verified** payload. That fixes S2 and P5 together.
5. **P7:** a single index migration (bump `REQUIRED_DB_MIGRATION`).
6. Split the cron phases across separate triggers so one invocation's D1 limits are not shared by nine jobs.

### Phase E — Decompose the god files

`pages.ts` → `pages/{public-event,display,poster,landing,admin}.ts`; `sponsors.ts` → `sponsors/{admin,public,logo}.ts`; `index.ts` lifecycle → `lib/lifecycle/*.ts`. Move only; add no new behaviour.

---

## 4. Improved code in this change set

| File                                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/router.ts`                                               | `_auditOutcome(res)` added. The 10 unconditional `'success'` audits now derive their outcome. The outcome is computed into a local first, because `event-manager-audit.spec.ts` parses `_audit(...)` calls with a `[^)]*` regex and a nested call would truncate the match. VERIFY_QR and UNVERIFY_QR audit under the request's own id.                                                                                                                                                     |
| `src/handlers/sponsors.ts`                                    | Event-type and area replace run DELETE + INSERTs in one `db.batch` (a transaction).                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/handlers/portfolio-rollup.ts`                            | All three counts (sponsors on DB; registrations and check-ins on FORMS_DB) go through `perEventCounts`. It keeps the **held-id** `IN (?, …)` shape that the INV9 gate recognises, chunked at `IN_LIST_CHUNK = 90`. A failed chunk reports 0, never a partial sum, so the #7 per-bucket floor is preserved. The counts run in parallel. (A `SELECT id FROM events${where}` subquery was tried first; INV9 cannot see an interpolated brand filter, so it was dropped for the held-id shape.) |
| `tests/e2e/0-architecture/tenant-isolation.invariant.spec.ts` | Two INV9 exemptions re-keyed for the line shift (`portfolio-rollup.ts:148→185`, `:165→203`), with shift history, following the file's existing convention. The rationale is unchanged.                                                                                                                                                                                                                                                                                                      |
| `src/lib/shortlinks.ts`                                       | `UPDATE … RETURNING clicks`: one round trip instead of two on the redirect path.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/handlers/shortlink-resolve.ts`                           | The misleading comment is corrected.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `tests/admin-mutation-integrity.spec.ts`                      | New: 6 behavioural tests. **Born-red verified:** all 6 fail on `main`, each for its intended reason, and pass with the fix.                                                                                                                                                                                                                                                                                                                                                                 |

**Preserved behaviour:** response bodies, statuses and routes are unchanged. Only the audit `outcome` values change, and now they are correct.

**Verification:** `tsc --noEmit` is clean. The full worker suite was run; results are in the PR description.
