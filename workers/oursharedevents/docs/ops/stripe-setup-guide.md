# Stripe Setup Guide — sponsor payments (P0, the ~20-minute human step)

**Audience:** you (the operator/founder). **Story:** OSE-743 · **Companion:** `sponsor-payment-runbook.md`

This guide explains **what Stripe is doing for us**, **why the setup looks the way it does**, and
walks the dashboard steps that make P0 _revenue-live_. The runbook is the terse checklist; this is
the "understand it once" version. No code changes here — this is entirely work you do in the Stripe
and Wave dashboards, then you (or I) drop three short reference strings into the repo.

---

## 1. What Stripe is — and what it is NOT (for us)

**Stripe is the merchant-of-record path.** Sponsors pay Stripe; Stripe takes the card/bank details,
runs the charge, and pays out to your bank. We chose this shape on purpose:

- **You never touch card numbers.** Payment happens on Stripe-hosted pages. That keeps us at
  **PCI SAQ-A** — the lightest compliance tier — because no card data ever enters our Worker, our
  D1 database, or this repo.
- **No money-transmitter exposure.** We are selling _our own_ sponsorship service and collecting for
  _ourselves_. We are **not** a marketplace/"payfac" moving money between third parties (that would
  need a money-transmitter legal opinion). Stripe is the processor; OSE is the merchant.
- **Zero code on the money path.** P0 uses **Payment Links** — links you create in the dashboard.
  Nothing in our code charges anyone. (Automating this later is P2's webhook, gated on a legal +
  architecture sign-off — not now.)

> One rule that governs everything below: **the only thing a sponsor can buy is rotation _frequency_.**
> Never create a link that sells a bigger slot, a premium placement, a size, or a "tier" of
> visibility. Placement is uniform for every sponsor. This is invariant #25 and our guard tests fail
> if the repo manifest ever contradicts it.

---

## 2. The shape you're building

Three rotation-frequency tiers → three Payment Links → three rows in the repo manifest:

| Frequency tier | What the sponsor buys       | Manifest row     |
| -------------- | --------------------------- | ---------------- |
| `standard`     | baseline rotation frequency | `link_ref_last6` |
| `frequent`     | more frequent rotation      | `link_ref_last6` |
| `headline`     | most frequent rotation      | `link_ref_last6` |

Each link binds a payment to a sponsoring brand through **one metadata field: `brand_id`**. That
field is how money is tied to the right tenant (invariant #9). It is the _only_ field that matters
for binding — set it, and nothing else clever.

---

## 3. One-time account setup

1. **Create / activate your Stripe account** at dashboard.stripe.com. Complete "Activate payments"
   (business details + bank account for payouts). Until activated you can build everything in
   **Test mode** — the toggle is top-right. Build in Test first; recreate in Live when you're ready.
2. **Turn on ACH (US bank debit).** Settings → Payment methods → enable **ACH Direct Debit**. ACH
   fees are far lower than cards for larger invoices; card stays as the fallback. (Our internal
   policy caps ACH exposure — see the runbook.)
3. **Turn on Invoicing + reminders.** Settings → Invoicing → enable automatic **payment reminders**
   (dunning). This is what chases a late sponsor without you doing it manually.

---

## 4. Create the three tiers

Do this three times — once per frequency tier (`standard`, `frequent`, `headline`):

1. **Product catalog → Add product.** Name it for the tier and the _cadence_ only
   (e.g. "Sponsor rotation — Frequent"). Set your price. **Do not** name it after a slot, size, or
   placement.
2. **Add a Price** — the amount you charge for that cadence. A one-off price is fine for P0
   (recurring subscriptions are a later phase).
3. **Payment Links → Create link → select that product/price.**
4. **On the link, add metadata.** Key: **`brand_id`** (exactly that, lowercase, underscore). In the
   template you can leave the value blank and set it per-sponsor (Step 5), or clone the link per
   brand. The key spelling must be exact — our code and guards expect `brand_id`.
5. Confirm the link's payment methods include **ACH + card**.

You now have three links, each ending in a short id like `plink_1Abers` → the **last 6 chars**
(`1Abers`) are what go in the repo.

---

## 5. Per-sponsor send (each time you sign a sponsor)

1. **Check eligibility first.** If the sponsor is a community-benefit / free-tier org (e.g. a place
   of worship on the free lane), they are **never** billed — they buy no frequency and get no link.
   (P1 enforces this in code; for now you confirm it by policy.)
2. **Set `brand_id`** on the link (or a per-brand clone) to that sponsor's brand id.
3. **Send** the link — directly, or as a **Wave invoice** that carries it. Prefer ACH.
4. **On payment:** record the link id's **last 6 chars** in the matching manifest row and commit
   (or hand me the three strings and I'll commit them). Reconcile the Stripe payout against the Wave
   invoice.

---

## 6. Wave (bookkeeping + invoicing)

Stripe _collects_; **Wave** is where you _invoice and keep the books_.

1. Create a matching product/service in Wave per tier.
2. Issue the sponsor invoice from Wave (embed the Stripe link, or record the Stripe payment against
   the invoice).
3. Each period, **reconcile**: every Stripe payout should match a Wave invoice, and every invoice's
   `brand_id` should map to a real sponsoring brand. An unmatched `brand_id` is the thing to chase.

---

## 7. Delinquency — you don't hand-place anything

A sponsor whose invoice is unpaid stays a **draft**. Our code refuses to promote a draft to a live,
resolver-visible sponsor without eligibility — `promoteSponsorDraft()` returns **`402 PAYMENT_REQUIRED`**
on the paid lane (that's P1). So the enforcement is automatic: no payment → no live placement, and
you never manually toggle visibility. Wave sends the reminders; the gate holds the line.

---

## 8. What to record in the repo (and what NEVER to)

Edit `tests/fixtures/payment-links-manifest.ts`, one row per tier:

**Record:** the frequency tier, and `link_ref_last6` = the last 6 chars of the link id.
**Never record:** a full Payment Link URL, a secret/API key, an email, a phone number, a person's
name, or an amount. The manifest is committed to the repo and scanned in CI — our guard test
(**TL-060**) fails the build if any PII/secret/full-URL appears. Keep it to `brand_id` + last-6.

After editing, run:

```
npx vitest run tests/ops/payment-links-guard.spec.ts
```

Green = you stayed inside #25 (frequency-only) and #8 (no PII). Red = fix the row, don't bypass.

---

## 9. Fees, tax, and the legal edges (get a professional to sign off before volume)

- **Fees:** cards ≈ 2.9% + 30¢; ACH is a small flat/capped fee — steer larger sponsors to ACH.
- **1099-K:** Stripe issues it to you; Wave books it. Know your threshold.
- **Sales tax / nexus:** whether sponsorship is taxable depends on your states — **ask a CPA.**
- **Refunds / chargebacks / dispute policy:** write the terms into the sponsor covenant.
- **Deferred revenue:** if you ever pre-sell a period, that's a bookkeeping treatment — CPA.

These are flagged in the runbook's sign-off checklist too. P0 does not require them to _build_, but
do them before invoicing at scale.

---

## 10. How this connects to the code (so you know what's automated vs. manual)

| Concern                   | P0 (now)                          | Later                                |
| ------------------------- | --------------------------------- | ------------------------------------ |
| Taking payment            | **Manual** — Payment Links + Wave | P2 webhook auto-records              |
| Binding payment → brand   | **Manual** — `brand_id` metadata  | P2 reconciles `brand_id` server-side |
| Free-tier bypass          | **Policy** — you check            | **P1** enforces in code (402 gate)   |
| Delinquent → no placement | **P1 gate** already enforces      | unchanged                            |
| Reminders                 | Wave dunning                      | unchanged                            |

P0's job is to let you collect money **today** with zero platform risk. When you're ready for the
20-minute dashboard pass, this guide + the runbook are the whole procedure.
