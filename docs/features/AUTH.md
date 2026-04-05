# Authentication

> How admin access is controlled in ourSharedEvents.

---

## Access Model

| Route Type                                       | Auth Required | Method                  |
| ------------------------------------------------ | :-----------: | ----------------------- |
| Public pages (`/`, `/events`)                    |      No       | Open                    |
| Public API (`/api/v2/events`)                    |      No       | Open                    |
| Public forms (`POST /api/v2/events/:id/forms/*`) |      No       | Open                    |
| Form pages (`/forms/:eventId`)                   |      No       | Open                    |
| Admin page (`/admin`)                            |      Yes      | CF Access JWT or Bearer |
| Admin API (`/api/v2/admin/*`)                    |      Yes      | CF Access JWT or Bearer |
| Feature flag admin (`/api/v2/admin/flags/*`)     |      Yes      | CF Access JWT or Bearer |

---

## Authentication Methods

### Primary: Cloudflare Access JWT

In production, admin routes are protected by [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/). The Worker checks for the `Cf-Access-Jwt-Assertion` header and verifies:

- JWT has 3 parts
- `exp` claim exists and is in the future
- `iat` claim exists

### Fallback: Bearer Token

When `ALLOW_ADMIN_KEY_FALLBACK=true`, the Worker also accepts a Bearer token:

```
Authorization: Bearer your-admin-key-here
```

The token is compared against the `ADMIN_KEY` (or legacy `ADMIN_TOKEN`) secret using constant-time comparison to prevent timing attacks.

**Phase 1 note:** The Bearer token is a single shared key. Multi-user auth comes in Phase 3 with Firebase Auth.

---

## Security Features

| Feature                   | Implementation                                           |
| ------------------------- | -------------------------------------------------------- |
| Constant-time comparison  | Prevents timing attacks on token validation              |
| `WWW-Authenticate` header | Returns `Bearer realm="OurSharedEvents Admin"` on 401    |
| Request ID tracking       | Every auth failure includes a unique request ID          |
| HTTPS redirect            | All HTTP requests are 301 redirected to HTTPS            |
| CSP with nonce            | Per-request nonce on all HTML page scripts               |
| CORS allowlist            | Only `oursharedevents.com` and `stg.oursharedevents.com` |

---

## Error Responses

| Scenario                 | HTTP | Response                                          |
| ------------------------ | ---- | ------------------------------------------------- |
| No auth header provided  | 401  | `{ "code": "UNAUTH" }`                            |
| Invalid Bearer token     | 401  | `{ "code": "UNAUTH" }`                            |
| Expired CF Access JWT    | 401  | `{ "code": "UNAUTH" }`                            |
| Bearer fallback disabled | 401  | `{ "code": "UNAUTH" }` (even if token is correct) |

---

## Configuration

| Secret                     | Purpose                                     |
| -------------------------- | ------------------------------------------- |
| `ADMIN_KEY`                | Bearer token for admin API access           |
| `ADMIN_TOKEN`              | Legacy alias for `ADMIN_KEY`                |
| `ALLOW_ADMIN_KEY_FALLBACK` | Set to `"true"` to enable Bearer token auth |
