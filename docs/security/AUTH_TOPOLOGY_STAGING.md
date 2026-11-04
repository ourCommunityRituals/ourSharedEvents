# Auth Topology — staging surfaces (every page) · OSE-1103

> **Why this doc exists.** A session lost real time to one conflation: `/admin`
> and `/sharedReport` both "fail closed in the smoke", but they are gated at
> **different layers** and cleared by **different tokens**. Reaching for the
> wrong tool (or asserting the wrong layer) produces a test that is invalid as an
> artifact — it passes for the wrong reason or fails at a layer it shouldn't
> touch. This is the authoritative per-page reference so the next person places
> each assertion at the right rung. It is the foundation the OSE-1102 test plan
> hangs off. Related: OSE-865, OSE-1010, OSE-1101, OSE-1102.

## Three gate classes — the whole surface area

Every OSE page falls into exactly one of three auth classes. An unauthenticated
request gets a **different status from a different layer** in each:

| Class                  | Unauth status                    | Which layer answers                            | Cleared by                                                          | The tell                                                           |
| ---------------------- | -------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **A · Public**         | `200`                            | Worker (renders the page)                      | nothing — it's public                                               | `X-Monetization-Inert: true` present                               |
| **B · Worker-token**   | `403`                            | Worker (runs, then refuses)                    | a **worker** HMAC signed-link token                                 | `X-Monetization-Inert: true` present + `403`                       |
| **C · CF Access edge** | `302` → `*.cloudflareaccess.com` | **Cloudflare Access edge** (worker never runs) | a **CF Access service token** (edge), _then_ the worker admin guard | `302` + `WWW-Authenticate: Cloudflare-Access`, **no** inert header |

**The single tell:** if `X-Monetization-Inert: true` is on the response, the
**worker ran** (class A or B). If you get a `302` to `*.cloudflareaccess.com`
with no inert header, the **CF Access edge** stopped it before the worker (class
C). Never assert a class-C worker behavior without first clearing the edge — the
worker never executed.

## Per-page table (verified against staging, 2026-09-01)

| Surface                       | Unauth    | Class              | Notes                                                                    |
| ----------------------------- | --------- | ------------------ | ------------------------------------------------------------------------ |
| `/` (landing)                 | `200`     | A public           |                                                                          |
| `/public` (listing)           | `200`     | A public           |                                                                          |
| `/events/:id` (pre/live/post) | `200`     | A public           | phase-aware render                                                       |
| `/forms/:id` (QR landing)     | `200`     | A public           | stale events forward (event-staleness)                                   |
| `/display` (venue TV)         | `200`     | A public           |                                                                          |
| `/poster`                     | `200`     | A public           |                                                                          |
| `/health`                     | `200`     | A public           | JSON                                                                     |
| `/api/v2/events`              | `200`     | A public           |                                                                          |
| **`/sharedReport`**           | **`403`** | **B worker-token** | worker ran (`X-Monetization-Inert`); wants an HMAC **signed-link** token |
| **`/admin`**                  | **`302`** | **C edge**         | CF Access edge → login; worker never runs                                |
| **`/api/v2/admin/*`**         | **`302`** | **C edge**         | same edge policy as `/admin`                                             |

## The tokens — which clears which gate (do not cross the wires)

### Class C · `/admin` (+ `/api/v2/admin/*`) — TWO gates in series

1. **CF Access EDGE.** A headerless request is redirected `302` to
   `https://mzdano.cloudflareaccess.com/...` (the JWT meta shows
   `service_token_status:false, auth_status:NONE`). Cleared by a **CF Access
   service token** — `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers —
   created in the Cloudflare dashboard and referenced by an Access **policy**
   (Service Auth). Token: **`ose-staging-t4-admin`** (bounded 1yr, wired
   2026-08-30). **Nothing in `SHARED_REPORT_SIGNING_SECRET` applies here.**
2. **Worker admin guard** (`src/auth/admin.ts` `requireAdmin`). _Past the edge_,
   the worker checks (Method 1) a CF Access **user** JWT (JWKS-verified + email
   allowlist), (Method 2) `X-OCR-Internal`, (Method 3) `Bearer ADMIN_KEY`. It
   returns **`401`** `{code:UNAUTH}` + `WWW-Authenticate: Bearer` when none pass.
   **Load-bearing nuance (OSE-889):** a valid CF Access **service-token** JWT
   carries _no email_ — the guard does NOT `403` it; it **falls through** to
   Methods 2/3, each of which needs its own secret. So a request that clears the
   edge with the service token but sends **no `Bearer`** falls through all three
   → **`401`**. That is the achievable "unauthenticated `/admin` → 401" case.
   **Exception (OSE-1800):** on staging, a service token whose `common_name` is
   listed in `CI_SERVICE_ACTORS` (with the team domain and the audience pinned)
   is an actor of its own, `svc:<common_name>`, a brand admin of
   `CI_SERVICE_ACTOR_BRAND` only. Unlisted service tokens still fall through.

**Response ladder for `/admin`:**

| What you send                                    | Result                             | From            |
| ------------------------------------------------ | ---------------------------------- | --------------- |
| nothing (headerless)                             | `302` → CF Access login            | edge            |
| CF-Access service token, **no** `Bearer`         | `401` UNAUTH + humane sign-in gate | worker guard    |
| CF-Access service token **+** `Bearer ADMIN_KEY` | `200` dashboard                    | worker (authed) |

### Class B · `/sharedReport` — ONE worker gate

The worker **runs** (`X-Monetization-Inert: true`) and returns **`403`** without
a **worker-level HMAC signed-link token** (`SHARED_REPORT_SIGNING_SECRET`,
`mintSignedLinkToken` in `src/lib/shared-report-auth.ts`). **Nothing in the
Cloudflare dashboard / CF Access applies here** — it is not edge-gated. A valid
minted token → `200` render. (OSE-1101 mints in-test → 200; reconciles unsigned
→ 403.)

### Class A · everything else — public, no token

The worker renders directly; `200` for anyone. No auth artifact needed beyond
the render smoke.

## Scoped contexts for unauth cases

`playwright.ui-smoke.config.ts` sets `use.extraHTTPHeaders = adminExtraHeaders()`
**globally** — every request in the run carries the CF-Access service-token
headers **and** `Authorization: Bearer ADMIN_KEY`. Consequences:

- The manifest's `admin sign-in gate (no auth) → 401` case must not use the
  default project page: the "no auth" request would be fully authenticated →
  returns `200`, not `401`.
- To exercise a genuinely unauthenticated case, use a **scoped context that
  overrides the global headers** — and the override differs by class:
  - **Class C worker-401** (`/admin` no-auth): send the **CF-Access service
    token** (clear the edge) but **omit `Authorization`** → worker `401`.
    A _fully_ headerless context instead hits the edge → `302` (a different,
    infra-layer fact — assert it as its own case, do not conflate).
  - **Class B** (`/sharedReport`): omit the signed-link token → `403`; mint a
    valid one → `200`.

`tests/ui/smoke/tier1.spec.ts` implements the Class C scoped context when a
manifest route declares `edgeAuth: 'cf-access'`, so the admin sign-in gate can
run in the blocking T4d smoke without conflating worker 401 with the CF Access
edge redirect.

## What a VALID test artifact looks like per class (the layered argument)

A test is only a valid artifact if it proves its claim at the **right rung**, so
adjacent rungs corroborate and each SCRUM role can endorse its own layer
(Engineering L1/L2 · DevOps L3/edge · Security L0/S2 · QA/PO T4). Never conflate
the edge with the worker.

- **Class A (public):** L0 route-registration invariant · L2 in-process render
  (SELF.fetch `200` + anchor) · T4 smoke (`200`, anchor visible, zero
  `pageerror`). No auth layer to assert.
- **Class B (`/sharedReport`):** L1 `mint→verify` round-trip (pure, constant-time,
  fail-safe) · L2 in-process `403` unsigned / `200` signed · L3 staging contract ·
  T4 rendered report. The `403` and the `200` are two named cases in one suite.
- **Class C (`/admin`):** L0 route-behind-guard invariant (bypass
  impossible-by-construction) · L1 `requireAdmin` unit (`401` on fall-through) ·
  L2 in-process `401` + humane shell (no edge in miniflare — deterministic) · L3
  staging: **edge `302`** (headerless) **and** **worker `401`** (service-token,
  no Bearer) as _separate_ cases · T4 rendered humane gate · S2 red-team the gate
  (token reuse, edge-skip, IDOR). The edge-`302` is an infra fact asserted at
  L3/T4 only — it is never a worker unit test (the worker did not run).

## Cross-references

- Manifest + smoke: `tests/ui/smoke/ose.routes.ts`, `tests/ui/smoke/tier1.spec.ts`
- Worker admin guard: `src/auth/admin.ts` (`requireAdmin`, OSE-889 fall-through)
- Redirect note in code: `src/router.ts` (`302 → CF Access login`)
- SharedReport token: `src/lib/shared-report-auth.ts` (`mintSignedLinkToken`)
- CF Access service token wiring: `CLOUDFLARE_ACCESS_PRIVILEGED.md`, OSE-1010
- Consuming stories: OSE-865 (Fix #1 admin 200 · Part 3), OSE-1102 (Fix #2
  headerless 401), OSE-1101 (`/sharedReport` signed-link), OSE-1104 (token rotation)
