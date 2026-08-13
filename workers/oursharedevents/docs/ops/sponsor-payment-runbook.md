# Sponsor Payment Runbook (P0 — out-of-band)

**Story:** OSE-743 · **Epic:** OSE-742 (Sponsor Payment) · **Status:** operator-executable now

P0 collects sponsor money with **zero code on the money path**. Payments run through
**Stripe Payment Links** (Stripe is merchant-of-record — PCI SAQ-A, no payfac / money
transmitter exposure) and are invoiced/reconciled in **Wave**. The repo holds only two
inert, PII-free artifacts that the later automated path (P1 eligibility gate, P2 webhook)
will reuse verbatim:

| Artifact          | Path                                       | Role                                                             |
| ----------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| Frozen contract   | `tests/fixtures/payment-contract.ts`       | brand-binding key + purchasable dimension + forbidden dimensions |
| Operator manifest | `tests/fixtures/payment-links-manifest.ts` | one row per rotation-frequency tier; you fill `link_ref_last6`   |
| Guard             | `tests/ops/payment-links-guard.spec.ts`    | born-red TL-059 / TL-060 — fails if either artifact drifts       |

## Invariant guardrails (do not cross)

- **#25 sponsor_share_covenant** — the ONLY thing a sponsor can buy is rotation
  **frequency**. Never create a link that sells size, slot, placement, tier, or
  position. Placement is uniform for everyone. The guard fails if any such key
  appears in the manifest.
- **#9 tenant_isolation** — every Payment Link must set metadata **`brand_id`** to
  the sponsoring brand. This is the only field that binds money to a tenant.
- **#8 bounded-PII** — never record a person, email, phone, full URL, or secret in
  the manifest. Record only the link id's **last 6 characters** for reconciliation.
- **#6 monetization-inert** — nothing here touches `src/`. No Stripe SDK, no
  processor dependency. If P0 ever needs code, it is a new story, not this one.

## One-time setup

1. In **Stripe → Payment Links**, create one link per rotation-frequency tier
   (`standard`, `frequent`, `headline`). Set the price to your published rate for
   that cadence.
2. On each link, add metadata key **`brand_id`** (leave the value blank in the
   template; you set it per-sponsor at send time, or create a per-brand copy).
3. Enable **ACH** on the link where available (lower fees); card is the fallback.
4. In **Wave**, create a matching product/service per tier for invoicing and
   bookkeeping. Wave issues the invoice; Stripe collects.

## Per-sponsor flow

1. Confirm the sponsor is **not** community-benefit / free-tier eligible. Free
   sponsors are never billed — they buy no frequency and get no link. (P1
   enforces this in code; in P0 you confirm by policy.)
2. Duplicate the tier's Payment Link (or set metadata) with `brand_id = <the
sponsor's brand id>`.
3. Send the link (or the Wave invoice carrying it). ACH preferred.
4. On payment, record the link id's **last 6 chars** in the manifest row for that
   tier and commit. Reconcile the Stripe payout against the Wave invoice.

## Delinquency

- Wave sends the dunning reminders. A sponsor whose invoice is unpaid stays a
  **draft** — promotion to a live, resolver-visible sponsor is gated in code
  (P1 `promoteSponsorDraft` returns `402 PAYMENT_REQUIRED` for the paid lane).
  No manual placement edits.

## When you edit the manifest

Run the guard before committing:

```
npx vitest run tests/ops/payment-links-guard.spec.ts
```

Green = the manifest still honors #25 / #9 / #8. Red = you introduced a
non-purchasable dimension, a PII/secret key, or a full-URL link reference — fix
the row, don't bypass the test.

## Sign-off (before invoicing at volume)

- [ ] CPA confirms sales-tax / nexus handling for your states.
- [ ] 1099-K threshold understood (Stripe issues it; Wave books it).
- [ ] Refund/chargeback policy written into the sponsor covenant.
