# ADR-006: Audit access architecture — dedicated bearer pattern for CI-vs-human credential separation

**Status:** Accepted
**Date:** 2026-05-16
**Deciders:** mzdan + Co-Architect (per OSE-302)

## Context

Invariant 14 (mobile workability) ships an audit suite at `tests/playwright/mobile-workability.spec.ts` that loads every customer-facing OSE surface at 375×812 and asserts five concrete contracts. Three of those surfaces require admin authentication: `/admin`, `/sharedReport` (in admin mode), and any future admin-only surface.

The first full validation cycle (OSE audit run 25951483089, 2026-05-16 03:23Z) revealed that the `OSE_ADMIN_BEARER` repo secret was empty in CI. The audit's unauthenticated request to `/admin` failed → Cloudflare Bot Management intercepted with a 403 challenge → the audit's Playwright runner measured the Cloudflare challenge page's UI, not OSE's admin dashboard. Symptom: 4 contract failures on `/admin` (touch targets, font-size, primary CTA missing, viewport meta blocks pinch-zoom). The viewport-meta failure reported `'initial-scale=1, maximum-scale=1, user-scalable=no, width=device-width'` — confirmed via repo-wide grep to NOT be any OSE handler's output; it's Cloudflare's challenge-page meta.

This exposed a class question: **how should automated audits access authenticated staging surfaces?** Three options were considered, and the founder selected Option A per OSE-302.

## Decision

**Use a dedicated audit bearer pattern.** A repo secret `OSE_ADMIN_BEARER` holds a bearer credential that the CI audit jobs read at runtime. The credential is set by the secret-value-holder (the founder) outside of source control. The audit workflow reads it via `${{ secrets.OSE_ADMIN_BEARER }}` and passes it as an `Authorization: Bearer …` header on admin-surface requests.

The bearer is **scope-limited in usage discipline** (read-only HTML rendering of admin surfaces; never used for mutation endpoints in audit code paths) and **rotated quarterly** per the playbook in the Implementation Notes section.

The audit treats this credential as a first-class CI consumer of the admin API, not a borrowed copy of the founder's working bearer.

## Alternatives Considered

### Alternative A: Dedicated audit bearer (CHOSEN)

A `OSE_ADMIN_BEARER` repo secret (or `OSE_ADMIN_AUDIT_BEARER` if a separate-scope bearer is later minted), set by the founder, consumed by the CI audit workflow as an `Authorization` header.

**Selected because:** simplest path that tests against production-shape auth, decouples audit-access from founder-access (rotation, blast radius are scoped), and doesn't require Cloudflare WAF maintenance. Matches the existing workflow's design intent (the secret name was already wired in).

### Alternative B: IP allowlist self-hosted runners on Cloudflare

Add a Cloudflare WAF rule allowlisting the BLOODRAVEN runner IPs so the Bot Management challenge is bypassed for audit traffic.

**Rejected because:** still need a bearer for the admin auth itself (this only bypasses the CF challenge layer, not the `requireAdmin` middleware). Self-hosted runner IPs can change with hardware rotation or network reconfiguration, requiring ongoing WAF rule maintenance. Adds a Cloudflare-side dependency that's separate from the OSE codebase, making the audit's access path harder to reason about.

### Alternative C: Move audit to local dev-server (wrangler dev)

Spin up wrangler dev + the admin handler + seeded fixtures per audit run. Audit measures code-as-shipped from the local Worker runtime, not staging-as-deployed.

**Rejected because:** misses any CDN- or Cloudflare-side rendering differences (response headers, edge transforms, bot challenge interactions). Tests the code's intent, not the customer's actual experience. Requires the audit to manage its own fixture seeding, which would create a new class of fixture-drift between the audit's seed data and the canonical migration set. The audit's primary value is "what does a phone-shaped customer see when they hit staging today" — Option C answers a different question.

## Consequences

### Positive

- `/admin`, `/sharedReport`, and future admin-surface audits measure the real OSE admin dashboard, not the Cloudflare challenge page.
- Credential lifecycle (rotation, revocation) is decoupled from the founder's daily-driver bearer. Rotating the audit bearer doesn't disrupt founder workflow; rotating the founder's bearer doesn't break CI.
- The pattern generalizes: any future audit that needs authenticated access (a11y audit, security headers audit, performance audit) can adopt the same secret name + workflow shape with zero architectural re-derivation.
- Audit traffic is distinguishable in `admin_audit_log` by the bearer it presents — a future refinement can log `principal=ci-audit` on requests that authenticate with this specific token, separating audit traffic from human admin traffic in observability dashboards.

### Negative

- A long-lived bearer credential lives in CI secrets — a credential-lifecycle concern. Mitigated by quarterly rotation discipline (Implementation Notes) and the planned scope-limiting (read-only HTML render, no mutations) at the auth-middleware layer when that work is prioritized.
- If the secret is unset (the failure mode that triggered this ADR), the audit silently measures the wrong surface (Cloudflare challenge page) instead of failing loudly. A small DevOps follow-on should add a `gh secret list`-style precondition check to the audit workflow that emits `::error::OSE_ADMIN_BEARER unset — audit cannot validate authenticated surfaces` before any test runs.
- Quarterly rotation requires a documented playbook (below) and human discipline to execute. Adding it to the founder's quarterly review checklist is the proposed insurance.

### Neutral

- The current implementation reuses the founder's staging admin bearer rather than a scope-limited audit-specific bearer. The scope-limiting (audit bearer recognized by `requireAdmin` middleware as having read-only HTML access only, no mutation endpoints) is a deliberate follow-on, not blocking this ADR's acceptance. The pattern is correct; the bearer's scope can tighten without changing the architecture.
- The secret name is `OSE_ADMIN_BEARER` (reusing the existing workflow wiring) rather than `OSE_ADMIN_AUDIT_BEARER`. If a separate scope-limited bearer is minted later, the rename happens then; deferring the rename keeps this ADR's footprint to "set the existing secret to a real value" rather than "touch the workflow + the secret + the rename."

## Implementation Notes

**One-shot setup (founder action — only secret-value holder):**

```bash
gh secret set OSE_ADMIN_BEARER --repo OurCommunityRituals/ourSharedEvents
# Paste the staging admin bearer when prompted
```

After the secret is set, the next `workflow_dispatch` of `mobile-workability-audit.yml` consumes it automatically.

**Verification:**

1. Re-trigger the audit via `gh workflow run mobile-workability-audit.yml --repo OurCommunityRituals/ourSharedEvents --ref main`.
2. Inspect the failed test output (if any). The viewport meta reported for `/admin` should now be OSE's `'width=device-width, initial-scale=1.0'`, NOT Cloudflare's `'maximum-scale=1, user-scalable=no, width=device-width'`.
3. If `/admin` contracts are now green, the audit-access architecture is working.

**Rotation playbook (quarterly):**

1. Mint a new staging admin bearer via the existing admin-token issuance flow (TBD — separate story when that flow exists; today the bearer is the staging-env `ADMIN_KEY` env var).
2. Update the repo secret: `gh secret set OSE_ADMIN_BEARER --repo OurCommunityRituals/ourSharedEvents` (paste new value).
3. Update Cloudflare worker env `ADMIN_KEY` to match (via `wrangler secret put ADMIN_KEY --env staging`).
4. Trigger one audit dispatch as smoke; confirm `/admin` contracts still pass.
5. Old bearer becomes invalid immediately; no grace period needed for a CI-only consumer.

**Files realizing the decision:**

- CI workflow: `.github/workflows/mobile-workability-audit.yml` (line 64 reads `OSE_ADMIN_BEARER`)
- Audit spec: `tests/playwright/mobile-workability.spec.ts` (lines 30, 109, 115 wire the bearer into per-surface `authHeader`)
- Brain invariant: `OCR-docs/ocr-docs-brain/architectural-invariants.yaml` invariant 14 (the contract the audit enforces)
- Refined standard: `OCR-docs/docs/standards/OCR_STANDARD_mobileWorkability.md` (the rule set being measured)

## References

- [OSE-302](https://linear.app/oursharedevents/issue/OSE-302) — Linear story that scoped this decision
- [OSE-292](https://linear.app/oursharedevents/issue/OSE-292) — Parent mobile-workability epic
- [OCR-42](https://linear.app/oursharedevents/issue/OCR-42) — Sibling refinement that landed simultaneously (refines the standard the audit enforces)
- ADR-001 — Anonymous-identity architecture (precedent for treating CI-side consumers as distinct from human consumers)
- ADR-002 — Static-invariant gates (precedent for CI as a first-class architectural surface)
- WCAG 2.5.5 Target Size (Level AAA) — the standard the audit measures against
- Brain invariant 14 (mobile_workability) — the contract this audit enforces

## Revisit Criteria

- **If a second authenticated-surface audit is added** (a11y, performance, security-headers) and they need different scopes, the "one shared bearer" pattern starts breaking down. At that point, mint separate scope-limited bearers per audit class.
- **If staging starts seeing real human admin traffic from CI ranges** (false-positive incident reports), the `principal=ci-audit` logging refinement becomes urgent — file a follow-on at that point.
- **If the staging admin bearer changes shape** (e.g., moves from static token to short-lived OIDC token), the rotation playbook above becomes obsolete and the ADR needs a Superseded-by replacement.
- **If invariant 14 is promoted to live** (OCR-40 closes) and a regression in `/admin` audit ever maps back to "bearer drift between rotations," tighten the rotation cadence from quarterly to monthly.
