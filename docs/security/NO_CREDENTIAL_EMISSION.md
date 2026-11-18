# The Worker Never Emits a Credential (OSE-1475)

What the OSE Worker may not put in an answer or a log line, what checks it, and
the decision on signed links and the `Referer` header.

## The rule

A credential the Worker receives (an Access JWT, the admin key, the CI header, a
service token, a cookie) or holds (a key, a pepper, a signing secret) is
compared, verified or hashed. It is never written into an answer, body or
header, and never into a log line. Workers Logs are on, so a log line is kept
by a third party.

## What enforces it

Three layers. Each was watched failing on an injected fault before it was
trusted (the `@born-red` notes in each file say how).

| Layer        | Where                                                                              | What it does                                                                                                                                                                                                                                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source gate  | `tests/e2e/0-architecture/credential-emission.invariant.spec.ts` (T0 `invariants`) | Reads every file under `workers/oursharedevents/src`. A credential request header (`Authorization`, `Cookie`, `Cf-Access-Jwt-Assertion`, `CF-Access-Client-Secret`, `X-OCR-Internal`), the request's headers taken whole, or a secret binding (`env.NAME`) may not reach `console.*`, a `Response`, a response header, or a helper that writes one. |
| Runtime gate | `workers/oursharedevents/tests/credential-echo.derived.spec.ts` (workers pool)     | Sends every method to every route in the router: with refused credentials, with accepted ones, with a database that fails and with a router that fails. No answer and no log line may carry a credential that was sent or the value of a secret binding.                                                                                            |
| Redaction    | `workers/oursharedevents/src/lib/log-redact.ts`, installed in `src/index.ts`       | Every console line is redacted before it is written: a value under a credential header name, any `Bearer` value, any `eyJ…` run (a JWT or one of this Worker's signed links). The unhandled-error line also removes, by value, what the failing request carried in its credential headers.                                                          |

On staging the Bruno folder `bruno/ose-api/24. No credential in any answer
(OSE-1475)` asks four routes and reads the answers the same way.

### Limits

- Redaction recognises a credential by its header name or its shape. A secret
  with neither (the admin key written as a bare string under some other key) is
  not recognised by it. The two gates are what keep such a line from being
  written.
- Workers Logs cannot be read from a test. Redaction is proven in the workers
  pool, not on staging.
- The source gate reads text, not types. A credential that travels through an
  object field set far from where it is written out is not seen there; the
  runtime gate reads every answer for it.

## Signed links: classified, not hidden

Some answers carry a signed link on purpose. It is the route's product. The
list is fixed, in `SIGNED_LINK_PRODUCTS` (runtime gate) and `MINT_SITES`
(source gate), and a signed link anywhere else fails:

| Route                                                   | Where the link sits                 | Who gets it                                                    |
| ------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `POST /api/v2/admin/events/:id/shared-report/mint-link` | `token` in the JSON answer          | The organizer who asked. Admin only, rate-limited, audited.    |
| `POST /api/v2/admin/sponsors/:id/home-link`             | `url` in the JSON answer            | The organizer who asked. Admin only, rate-limited, audited.    |
| `GET /sponsor` (opened with the sponsor's own link)     | The page's links to `/sharedReport` | That sponsor: each link is signed for them and one event.      |
| `GET /api/v2/events/:id/sponsor-bundle`                 | `beacon_token` per sponsor          | Public by design. Sent back with an impression. Opens nothing. |

The anonymous `ose_anon` cookie is not a sign-in. It is sent back as its own
cookie on `/q` and the forms routes (AGENTS.md invariant 4) and nowhere else.

## Signed links and the `Referer` header (decision)

A sponsor's page (`/sponsor?t=…`) and a SharedReport (`/sharedReport?…&token=…`)
are opened with a signed link: a bearer credential in the address.

- **Decision.** Both pages, and every answer of `/sponsor` (the refusal and the
  rate-limit answer too), are sent with `Referrer-Policy: no-referrer`. The
  address is never sent on in a `Referer` header, whatever is in it. Every other
  page keeps `strict-origin-when-cross-origin`. A working link's page is also
  sent `Cache-Control: no-store`, and the sponsor page takes the token out of
  the address bar once it has read it.
- **Gate.** `workers/oursharedevents/tests/signed-link-page-headers.spec.ts`,
  and on staging the Bruno request for a refused sponsor link.
- **Logs.** No log line carries the request URL or its query string
  (`log-redaction.invariant.spec.ts`, `unhandled-error-log.spec.ts`). Redaction
  masks a signed link by its shape if one is ever written.
- **A redirect keeps the caller's own query.** The page aliases (`/calendar`,
  `/schedule`, `/event/:id` and the like) answer 301 with the query string
  still on the `Location`. That hands the caller back what the caller sent and
  nothing else, so it is allowed, and only in `Location`.
- **Not covered.** The link stays in browser history (measured under OSE-1501).
  Only an exchange for a cookie session removes that. It is not built.
