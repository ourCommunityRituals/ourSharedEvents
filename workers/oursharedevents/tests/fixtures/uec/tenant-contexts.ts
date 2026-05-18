/**
 * OSE-325 — UEC tenant-context fixtures.
 *
 * Per OSE-325 AC: "Tenant context variations (default tenant, hypothetical
 * future white-label tenant)." Today OSE is single-tenant; brand_id /
 * multi-tenant patterns exist in some tables but UEC consumption isn't
 * tenant-scoped (UEC is brand-level + canonical-shared). These fixtures
 * scaffold the test surface so when a second OCR substrate (OSM, OW, OA)
 * or a white-label tenant lands, UEC tests already have the shape ready.
 *
 * Design intent:
 *   - Default tenant should always work (no special setup)
 *   - White-label scaffolding shows how future tenant-specific
 *     overrides WOULD be tested (without implementing the overrides yet)
 *   - UEC values are CANONICAL — tenants do NOT override scan_hex /
 *     display_hex / semantics. The tenant context affects WHAT THE QR
 *     RESOLVES TO (the brand-specific page), not the UEC values
 *     themselves.
 */

export interface UecTenantContext {
  /** Tenant short-name (used in admin docs + URL prefixes). */
  tenant_id: string;
  /** Display name for sponsor-facing copy. */
  display_name: string;
  /** Origin used in `encoded_url` of QR responses (host the QR points at). */
  origin: string;
  /** Tier the tenant is on (affects UI gating but NOT UEC values). */
  tier: 'free' | 'pro' | 'enterprise';
  /** Notes — why this fixture exists / what it scaffolds. */
  notes: string;
}

/** Today's default tenant — OSE singular brand. */
export const DEFAULT_TENANT: UecTenantContext = {
  tenant_id: 'default',
  display_name: 'OurSharedEvents',
  origin: 'https://test.local',
  tier: 'free',
  notes: 'Single-tenant baseline — what every UEC test runs against today.',
};

/** Staging tenant for Playwright/contract tests hitting stg.oursharedevents.com. */
export const STAGING_TENANT: UecTenantContext = {
  tenant_id: 'staging',
  display_name: 'OurSharedEvents (staging)',
  origin: 'https://stg.oursharedevents.com',
  tier: 'free',
  notes: 'Production-staging environment used by Playwright FE-layer specs.',
};

/**
 * Hypothetical future white-label tenant. NOT live today. Fixture exists
 * so the moment a white-label customer joins, tests can swap in this
 * context object and exercise: tenant-specific origin, tenant-specific
 * display_name in sponsor-facing copy, tenant-tier gating — WITHOUT
 * changing UEC canonical values (which stay shared).
 */
export const HYPOTHETICAL_WHITELABEL_TENANT: UecTenantContext = {
  tenant_id: 'acme-events',
  display_name: 'Acme Events',
  origin: 'https://events.acme.com',
  tier: 'enterprise',
  notes:
    'NOT live — scaffolding for future white-label. UEC values stay canonical; ' +
    'only the routing layer (origin + display_name) differs. When this lands, ' +
    'replace with the real tenant config and the existing UEC tests inherit ' +
    'the tenant-aware shape automatically.',
};

/** All tenant contexts — for parameterized cross-tenant tests. */
export const ALL_TENANTS: ReadonlyArray<UecTenantContext> = [
  DEFAULT_TENANT,
  STAGING_TENANT,
  HYPOTHETICAL_WHITELABEL_TENANT,
] as const;

/**
 * For tests that need "the tenant my Worker is running under right now,"
 * default to DEFAULT_TENANT (test.local in vitest, replaced by env-specific
 * choice in Playwright).
 */
export const CURRENT_TENANT: UecTenantContext = DEFAULT_TENANT;
