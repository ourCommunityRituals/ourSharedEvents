/**
 * OSE-743 (P0) — Sponsor Payment Links manifest (OPERATOR-EDITED).
 *
 * One entry per rotation-frequency tier. The operator creates a Stripe Payment
 * Link per tier in the Stripe dashboard, sets the link's metadata to bind it to
 * the sponsoring brand via the frozen `brand_id` key, then records the link's
 * LAST 6 CHARS here — never the full URL, never a secret. This artifact is
 * PII-FREE BY TYPE: the interface admits only a frequency tier, a non-secret
 * link reference, the frozen brand-binding key, and a non-PII note.
 *
 * Step-by-step: docs/ops/sponsor-payment-runbook.md
 */

import { BRAND_ID_METADATA_KEY, type FrequencyTier } from './payment-contract';

export interface PaymentLinkRecord {
  /** Rotation-frequency tier this link sells — the ONLY purchasable dimension (#25). */
  frequency: FrequencyTier;
  /** Last 6 chars of the Stripe Payment Link id — a non-secret reconciliation reference. */
  link_ref_last6: string | null;
  /** The metadata KEY the link uses to bind a payment to a brand. Frozen to the contract (#9). */
  brand_binding_key: typeof BRAND_ID_METADATA_KEY;
  /** Operator note (non-PII) — e.g. "annual invoice via Wave". */
  note?: string;
}

/**
 * The PAID lane only. A community-benefit / free-tier sponsor buys NO frequency
 * and therefore has NO entry here — it is never routed through a payment link
 * (the eligibility bypass is enforced in code by P1). Placeholders below carry
 * `link_ref_last6: null` until the operator creates the links.
 */
export const PAYMENT_LINKS_MANIFEST: readonly PaymentLinkRecord[] = [
  {
    frequency: 'standard',
    link_ref_last6: null,
    brand_binding_key: BRAND_ID_METADATA_KEY,
    note: 'TODO(ops): create Stripe Payment Link, set brand_id metadata, record last6',
  },
  {
    frequency: 'frequent',
    link_ref_last6: null,
    brand_binding_key: BRAND_ID_METADATA_KEY,
    note: 'TODO(ops): create Stripe Payment Link, set brand_id metadata, record last6',
  },
  {
    frequency: 'headline',
    link_ref_last6: null,
    brand_binding_key: BRAND_ID_METADATA_KEY,
    note: 'TODO(ops): create Stripe Payment Link, set brand_id metadata, record last6',
  },
] as const;
