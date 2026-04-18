/**
 * Feature flag system — OSE shim over `@ocr/flags`.
 *
 * Core logic, tier presets, scope precedence, and storage adapters now live
 * in the shared package `@ocr/flags` (runtime binding for the Brain contract
 * at `OCR-docs/ocr-docs-brain/flags-contract.yaml`). This file is a thin shim
 * that preserves OSE's public API and wire shape:
 *
 *   - `FlagRow.enabled` stays numeric (0/1) — OSE admin wire format.
 *   - `scope_id` surfaces as `null` externally when storage uses empty string.
 *   - `TIER_PRESETS[t]` keeps `{ name, description, flags }` with OSE display
 *     strings; only the 17 OSE-active flag keys are exposed through this shim
 *     (events.* and intelligence.* keys exist in the contract but surface
 *     through a later OSE PR when those features ship).
 *   - All function signatures match the pre-carve module exactly.
 *
 * Build dependency: `@ocr/flags` must be built (`pnpm build` in the package
 * dir) before OSE installs, since OSE consumes the package's `dist/`.
 */

import type { D1Database } from '@cloudflare/workers-types';
import {
  isFeatureEnabled as isFeatureEnabledShared,
  resolveFlags as resolveFlagsShared,
  TIER_PRESETS as SHARED_TIER_PRESETS,
  type FlagRow as SharedFlagRow,
  type Scope,
  type Tier as SharedTier,
} from '@ocr/flags';
import { D1Adapter } from '@ocr/flags/adapters/d1';

// ─── OSE active catalog (17 keys) ───────────────────────────────────────
// OSE surfaces only the flags that predate the events.* and intelligence.*
// additions in the contract. Keeping the carve PR a pure refactor means
// admin endpoints, tier seeding, and test expectations all stay at 17.
// When events.* or intelligence.* features ship, update this list + the
// admin UI in a follow-up PR.
export const FLAG_KEYS = {
  // Forms
  FORMS_REGISTER: 'forms.register',
  FORMS_CHECKIN: 'forms.checkin',
  FORMS_SURVEY: 'forms.survey',
  FORMS_EMAIL_SIGNUP: 'forms.email-signup',
  // Config
  CONFIG_SELF_SERVE: 'config.self-serve',
  CONFIG_EVENT_SETTINGS: 'config.event-settings',
  // Analytics / Reports
  ANALYTICS_SHARED_REPORT: 'analytics.shared-report',
  REPORT_EXPORT_JSON: 'report.export-json',
  REPORT_ADVANCED_METRICS: 'report.advanced-metrics',
  REPORT_EXPORT_PDF: 'report.export-pdf',
  REPORT_CUSTOM_WINDOW: 'report.custom-window',
  REPORT_PORTFOLIO: 'report.portfolio',
  // Assets
  ASSETS_FILE_UPLOAD: 'assets.file-upload',
  ASSETS_CUSTOM_QR: 'assets.custom-qr',
  // Branding
  BRANDING_WHITE_LABEL: 'branding.white-label',
  BRANDING_CUSTOM_DOMAIN: 'branding.custom-domain',
  BRANDING_COLOR_PALETTE: 'branding.color-palette',
} as const;

export type FlagKey = (typeof FLAG_KEYS)[keyof typeof FLAG_KEYS];

const ACTIVE_KEYS = Object.values(FLAG_KEYS) as FlagKey[];

/** Legacy alias — forms-only subset */
export const FORM_FLAGS = {
  REGISTRATION: FLAG_KEYS.FORMS_REGISTER,
  CHECKIN: FLAG_KEYS.FORMS_CHECKIN,
  SURVEY: FLAG_KEYS.FORMS_SURVEY,
  EMAIL_SIGNUP: FLAG_KEYS.FORMS_EMAIL_SIGNUP,
} as const;

export const REPORT_FLAGS = {
  VIEW: FLAG_KEYS.ANALYTICS_SHARED_REPORT,
  EXPORT_JSON: FLAG_KEYS.REPORT_EXPORT_JSON,
  ADVANCED_METRICS: FLAG_KEYS.REPORT_ADVANCED_METRICS,
  EXPORT_PDF: FLAG_KEYS.REPORT_EXPORT_PDF,
  CUSTOM_WINDOW: FLAG_KEYS.REPORT_CUSTOM_WINDOW,
  PORTFOLIO: FLAG_KEYS.REPORT_PORTFOLIO,
  WHITE_LABEL: FLAG_KEYS.BRANDING_WHITE_LABEL,
} as const;

// ─── Types ──────────────────────────────────────────────────────────────

export interface FeatureFlagEnv {
  FORMS_DB: D1Database;
}

export type Tier = SharedTier;

export interface TierPreset {
  name: string;
  description: string;
  flags: Record<FlagKey, boolean>;
}

/** OSE wire-format FlagRow: `enabled` is 0/1; global rows expose `scope_id: null`. */
export interface FlagRow {
  id: string;
  scope: string;
  scope_id: string | null;
  flag_key: string;
  enabled: number;
  updated_at: string;
}

// ─── Tier presets (OSE display + filtered flag set) ─────────────────────

function filteredPreset(src: Readonly<Record<string, boolean>>): Record<FlagKey, boolean> {
  const out = {} as Record<FlagKey, boolean>;
  for (const k of ACTIVE_KEYS) out[k] = src[k] ?? false;
  return out;
}

export const TIER_PRESETS: Record<Tier, TierPreset> = {
  free: {
    name: 'Free',
    description: 'Registration + check-in forms. Basic public page. Admin read-only.',
    flags: filteredPreset(SHARED_TIER_PRESETS.free),
  },
  mid: {
    name: 'Mid',
    description: 'All 4 form types. Self-serve config. Shared reports with advanced metrics.',
    flags: filteredPreset(SHARED_TIER_PRESETS.mid),
  },
  enterprise: {
    name: 'Enterprise',
    description:
      'File upload, white-label branding, custom domain, portfolio reports, per-event overrides.',
    flags: filteredPreset(SHARED_TIER_PRESETS.enterprise),
  },
} as const;

// ─── Internals ──────────────────────────────────────────────────────────

function adapter(db: D1Database): D1Adapter {
  return new D1Adapter(db);
}

function toOseRow(r: SharedFlagRow): FlagRow {
  return {
    id: r.id,
    scope: r.scope,
    scope_id: r.scope_id === '' ? null : r.scope_id,
    flag_key: r.flag_key,
    enabled: r.enabled ? 1 : 0,
    updated_at: r.updated_at,
  };
}

// ─── Public API (signatures preserved verbatim) ─────────────────────────

export async function isFeatureEnabled(
  db: D1Database,
  flagKey: string,
  eventId?: string
): Promise<boolean> {
  try {
    return await isFeatureEnabledShared(adapter(db), flagKey, eventId);
  } catch {
    return true; // pre-migration fail-open
  }
}

export async function listFlags(
  db: D1Database,
  opts?: { scope?: Scope; eventId?: string }
): Promise<FlagRow[]> {
  const rows = await adapter(db).listFlags(opts);
  const filtered = rows.filter((r) => ACTIVE_KEYS.includes(r.flag_key as FlagKey));
  return filtered.map(toOseRow);
}

export async function setFlag(
  db: D1Database,
  flagKey: string,
  enabled: boolean,
  scope: Scope = 'global',
  scopeId?: string
): Promise<void> {
  await adapter(db).setFlag(flagKey, enabled, scope, scopeId);
}

export async function applyTier(
  db: D1Database,
  tier: Tier
): Promise<{ tier: string; applied: number }> {
  const preset: Record<string, boolean> = {};
  for (const k of ACTIVE_KEYS) preset[k] = TIER_PRESETS[tier].flags[k];
  const res = await adapter(db).batchApplyTier(tier, preset);
  return { tier, applied: res.applied };
}

export async function setEventFlag(
  db: D1Database,
  eventId: string,
  flagKey: string,
  enabled: boolean
): Promise<void> {
  await adapter(db).setFlag(flagKey, enabled, 'event', eventId);
}

export async function removeEventFlag(
  db: D1Database,
  eventId: string,
  flagKey: string
): Promise<boolean> {
  return adapter(db).removeEventFlag(eventId, flagKey);
}

export async function resolveFlags(
  db: D1Database,
  eventId?: string
): Promise<Record<string, boolean>> {
  try {
    const all = await resolveFlagsShared(adapter(db), eventId);
    const out: Record<string, boolean> = {};
    for (const k of ACTIVE_KEYS) out[k] = all[k];
    return out;
  } catch {
    const out: Record<string, boolean> = {};
    for (const k of ACTIVE_KEYS) out[k] = true;
    return out;
  }
}

export async function detectCurrentTier(db: D1Database): Promise<Tier> {
  // Match against OSE's filtered presets (17 keys), not the full contract.
  const resolved = await resolveFlags(db);
  const ordered: Tier[] = ['enterprise', 'mid', 'free'];
  for (const tier of ordered) {
    const preset = TIER_PRESETS[tier].flags;
    if (ACTIVE_KEYS.every((k) => resolved[k] === preset[k])) return tier;
  }
  return 'free';
}
