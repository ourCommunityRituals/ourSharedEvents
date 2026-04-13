/**
 * Feature flag system — system-wide toggles with 3-tier pricing support.
 *
 * PO: Feature flags control what each tier can access. Free/Mid/Enterprise
 * tiers are code-defined presets. Applying a tier seeds global flag rows.
 * Enterprise gets event-level overrides on top.
 *
 * Lookup order (first match wins):
 *   1. Event-scoped:  scope='event', scope_id=eventId, flag_key=key
 *   2. Global:        scope='global', scope_id IS NULL, flag_key=key
 *   3. Default:       feature is ON (no row = enabled — backwards compatible)
 *
 * Stored in FORMS_DB (the forms-side database).
 */

import { generateId } from './forms-db';

export interface FeatureFlagEnv {
  FORMS_DB: D1Database;
}

// ─── All Known Flag Keys ────────────────────────────────────────────────────

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

/** Legacy alias — forms-only subset */
export const FORM_FLAGS = {
  REGISTRATION: FLAG_KEYS.FORMS_REGISTER,
  CHECKIN: FLAG_KEYS.FORMS_CHECKIN,
  SURVEY: FLAG_KEYS.FORMS_SURVEY,
  EMAIL_SIGNUP: FLAG_KEYS.FORMS_EMAIL_SIGNUP,
} as const;

/**
 * SharedReport feature flag aliases.
 *
 * Tier mapping:
 *   Free:       SHARED_REPORT (basic view) + EXPORT_JSON
 *   Mid:        + ADVANCED_METRICS + EXPORT_PDF + CUSTOM_WINDOW
 *   Enterprise: + PORTFOLIO + WHITE_LABEL (via branding flag)
 */
export const REPORT_FLAGS = {
  VIEW: FLAG_KEYS.ANALYTICS_SHARED_REPORT,
  EXPORT_JSON: FLAG_KEYS.REPORT_EXPORT_JSON,
  ADVANCED_METRICS: FLAG_KEYS.REPORT_ADVANCED_METRICS,
  EXPORT_PDF: FLAG_KEYS.REPORT_EXPORT_PDF,
  CUSTOM_WINDOW: FLAG_KEYS.REPORT_CUSTOM_WINDOW,
  PORTFOLIO: FLAG_KEYS.REPORT_PORTFOLIO,
  WHITE_LABEL: FLAG_KEYS.BRANDING_WHITE_LABEL,
} as const;

// ─── Tier Definitions ───────────────────────────────────────────────────────

export type Tier = 'free' | 'mid' | 'enterprise';

export interface TierPreset {
  name: string;
  description: string;
  flags: Record<FlagKey, boolean>;
}

export const TIER_PRESETS: Record<Tier, TierPreset> = {
  free: {
    name: 'Free',
    description: 'Registration + check-in forms. Basic public page. Admin read-only.',
    flags: {
      'forms.register': true,
      'forms.checkin': true,
      'forms.survey': false,
      'forms.email-signup': false,
      'config.self-serve': false,
      'config.event-settings': false,
      'analytics.shared-report': false,
      'report.export-json': true,
      'report.advanced-metrics': false,
      'report.export-pdf': false,
      'report.custom-window': false,
      'report.portfolio': false,
      'assets.file-upload': false,
      'assets.custom-qr': false,
      'branding.white-label': false,
      'branding.custom-domain': false,
      'branding.color-palette': false,
    },
  },
  mid: {
    name: 'Mid',
    description: 'All 4 form types. Self-serve config. Shared reports with advanced metrics.',
    flags: {
      'forms.register': true,
      'forms.checkin': true,
      'forms.survey': true,
      'forms.email-signup': true,
      'config.self-serve': true,
      'config.event-settings': true,
      'analytics.shared-report': true,
      'report.export-json': true,
      'report.advanced-metrics': true,
      'report.export-pdf': true,
      'report.custom-window': true,
      'report.portfolio': false,
      'assets.file-upload': false,
      'assets.custom-qr': false,
      'branding.white-label': false,
      'branding.custom-domain': false,
      'branding.color-palette': false,
    },
  },
  enterprise: {
    name: 'Enterprise',
    description:
      'File upload, white-label branding, custom domain, portfolio reports, per-event overrides.',
    flags: {
      'forms.register': true,
      'forms.checkin': true,
      'forms.survey': true,
      'forms.email-signup': true,
      'config.self-serve': true,
      'config.event-settings': true,
      'analytics.shared-report': true,
      'report.export-json': true,
      'report.advanced-metrics': true,
      'report.export-pdf': true,
      'report.custom-window': true,
      'report.portfolio': true,
      'assets.file-upload': true,
      'assets.custom-qr': true,
      'branding.white-label': true,
      'branding.custom-domain': true,
      'branding.color-palette': true,
    },
  },
} as const;

// ─── Core Lookup ────────────────────────────────────────────────────────────

/**
 * Check if a feature flag is enabled.
 * Returns true if the feature is enabled (default if no config exists).
 */
export async function isFeatureEnabled(
  db: D1Database,
  flagKey: string,
  eventId?: string
): Promise<boolean> {
  try {
    // 1. Check event-scoped flag first
    if (eventId) {
      const eventFlag = await db
        .prepare(
          "SELECT enabled FROM feature_flags WHERE flag_key = ? AND scope = 'event' AND scope_id = ?"
        )
        .bind(flagKey, eventId)
        .first<{ enabled: number }>();

      if (eventFlag) return eventFlag.enabled === 1;
    }

    // 2. Check global flag (scope_id may be NULL from seed migration or '' from setFlag)
    const globalFlag = await db
      .prepare(
        "SELECT enabled FROM feature_flags WHERE flag_key = ? AND scope = 'global' AND (scope_id IS NULL OR scope_id = '')"
      )
      .bind(flagKey)
      .first<{ enabled: number }>();

    if (globalFlag) return globalFlag.enabled === 1;

    // 3. Default: feature is ON
    return true;
  } catch {
    // If feature_flags table doesn't exist yet (pre-migration), allow everything
    return true;
  }
}

// ─── Admin Helpers ──────────────────────────────────────────────────────────

export interface FlagRow {
  id: string;
  scope: string;
  scope_id: string | null;
  flag_key: string;
  enabled: number;
  updated_at: string;
}

/**
 * List all feature flags. Optionally filter by scope or event.
 */
export async function listFlags(
  db: D1Database,
  opts?: { scope?: 'global' | 'event'; eventId?: string }
): Promise<FlagRow[]> {
  let query = 'SELECT * FROM feature_flags';
  const params: string[] = [];

  if (opts?.scope === 'event' && opts.eventId) {
    query += " WHERE scope = 'event' AND scope_id = ?";
    params.push(opts.eventId);
  } else if (opts?.scope === 'global') {
    query += " WHERE scope = 'global'";
  }

  query += ' ORDER BY flag_key, scope, scope_id';

  const stmt = params.length > 0 ? db.prepare(query).bind(...params) : db.prepare(query);

  const result = await stmt.all<FlagRow>();
  return result.results;
}

/**
 * Set a single flag. Upserts based on (scope, scope_id, flag_key).
 *
 * NOTE: Global flags use scope_id = '' (empty string), not NULL.
 * SQLite treats each NULL as unique in UNIQUE constraints, so
 * ON CONFLICT won't fire with NULL. Empty string is deterministic.
 */
export async function setFlag(
  db: D1Database,
  flagKey: string,
  enabled: boolean,
  scope: 'global' | 'event' = 'global',
  scopeId?: string
): Promise<void> {
  // Use '' for global scope_id — SQLite NULL != NULL in UNIQUE constraints
  const resolvedScopeId = scopeId ?? '';
  const id = generateId();
  await db
    .prepare(
      `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(scope, scope_id, flag_key)
     DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`
    )
    .bind(id, scope, resolvedScopeId, flagKey, enabled ? 1 : 0)
    .run();
}

/**
 * Apply a tier preset — upserts all global flags to match the tier.
 * Does NOT touch event-scoped overrides (enterprise stays intact).
 *
 * Uses db.batch() to collapse all upserts into a single round-trip.
 */
export async function applyTier(
  db: D1Database,
  tier: Tier
): Promise<{ tier: string; applied: number }> {
  const preset = TIER_PRESETS[tier];
  const entries = Object.entries(preset.flags) as [FlagKey, boolean][];

  const statements = entries.map(([key, enabled]) => {
    const id = generateId();
    return db
      .prepare(
        `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
       VALUES (?, 'global', '', ?, ?, datetime('now'))
       ON CONFLICT(scope, scope_id, flag_key)
       DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`
      )
      .bind(id, key, enabled ? 1 : 0);
  });

  await db.batch(statements);
  return { tier, applied: entries.length };
}

/**
 * Set a flag at the event level (enterprise feature).
 */
export async function setEventFlag(
  db: D1Database,
  eventId: string,
  flagKey: string,
  enabled: boolean
): Promise<void> {
  await setFlag(db, flagKey, enabled, 'event', eventId);
}

/**
 * Remove an event-level override (reverts to global/default behavior).
 */
export async function removeEventFlag(
  db: D1Database,
  eventId: string,
  flagKey: string
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM feature_flags WHERE scope = 'event' AND scope_id = ? AND flag_key = ?")
    .bind(eventId, flagKey)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Get the resolved state of all flags for a given event.
 * Applies the full lookup hierarchy: event > global > default ON.
 *
 * Uses a single D1 query instead of N per-flag queries.
 * Resolution hierarchy is applied in application code after the fetch.
 */
export async function resolveFlags(
  db: D1Database,
  eventId?: string
): Promise<Record<string, boolean>> {
  try {
    // Single query: fetch all global rows + event-scoped rows (if eventId given)
    let rows: FlagRow[];
    if (eventId) {
      const result = await db
        .prepare(
          `SELECT scope, scope_id, flag_key, enabled FROM feature_flags
         WHERE (scope = 'global' AND (scope_id IS NULL OR scope_id = ''))
            OR (scope = 'event' AND scope_id = ?)`
        )
        .bind(eventId)
        .all<FlagRow>();
      rows = result.results;
    } else {
      const result = await db
        .prepare(
          `SELECT scope, scope_id, flag_key, enabled FROM feature_flags
         WHERE scope = 'global' AND (scope_id IS NULL OR scope_id = '')`
        )
        .all<FlagRow>();
      rows = result.results;
    }

    // Build lookup maps
    const eventMap = new Map<string, boolean>();
    const globalMap = new Map<string, boolean>();
    for (const row of rows) {
      if (row.scope === 'event') {
        eventMap.set(row.flag_key, row.enabled === 1);
      } else {
        globalMap.set(row.flag_key, row.enabled === 1);
      }
    }

    // Resolve: event → global → default ON
    const resolved: Record<string, boolean> = {};
    for (const key of Object.values(FLAG_KEYS)) {
      if (eventMap.has(key)) {
        resolved[key] = eventMap.get(key)!;
      } else if (globalMap.has(key)) {
        resolved[key] = globalMap.get(key)!;
      } else {
        resolved[key] = true; // default ON
      }
    }
    return resolved;
  } catch {
    // Pre-migration fallback: allow everything
    const resolved: Record<string, boolean> = {};
    for (const key of Object.values(FLAG_KEYS)) resolved[key] = true;
    return resolved;
  }
}

/**
 * Detect which tier best matches the current global flags.
 * Returns the highest tier whose flags are all satisfied.
 */
export async function detectCurrentTier(db: D1Database): Promise<Tier> {
  const globalFlags = await resolveFlags(db);

  // Check from highest tier down
  const tiers: Tier[] = ['enterprise', 'mid', 'free'];
  for (const tier of tiers) {
    const preset = TIER_PRESETS[tier];
    const match = (Object.entries(preset.flags) as [FlagKey, boolean][]).every(
      ([key, expected]) => globalFlags[key] === expected
    );
    if (match) return tier;
  }

  return 'free'; // fallback
}
