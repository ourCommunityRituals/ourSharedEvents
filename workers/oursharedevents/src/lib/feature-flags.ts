/**
 * Feature flag system — system-wide toggles for any feature.
 *
 * PO: Feature flags allow turning features on/off without deploys.
 * Convention: dot-notation keys (forms.register, forms.checkin, etc.)
 *
 * Lookup order (first match wins):
 *   1. Event-scoped:  scope='event', scope_id=eventId, flag_key=key
 *   2. Global:        scope='global', scope_id=NULL, flag_key=key
 *   3. Default:       feature is ON (no row = enabled)
 *
 * Stored in FORMS_DB (the forms-side database).
 */

export interface FeatureFlagEnv {
  FORMS_DB: D1Database;
}

/**
 * Check if a feature flag is enabled.
 * Returns true if the feature is enabled (default if no config exists).
 */
export async function isFeatureEnabled(
  db: D1Database,
  flagKey: string,
  eventId?: string,
): Promise<boolean> {
  try {
    // 1. Check event-scoped flag first
    if (eventId) {
      const eventFlag = await db.prepare(
        "SELECT enabled FROM feature_flags WHERE flag_key = ? AND scope = 'event' AND scope_id = ?",
      )
        .bind(flagKey, eventId)
        .first<{ enabled: number }>();

      if (eventFlag) return eventFlag.enabled === 1;
    }

    // 2. Check global flag
    const globalFlag = await db.prepare(
      "SELECT enabled FROM feature_flags WHERE flag_key = ? AND scope = 'global'",
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

/** Well-known flag keys for the form system */
export const FORM_FLAGS = {
  REGISTRATION: 'forms.register',
  CHECKIN: 'forms.checkin',
  SURVEY: 'forms.survey',
  EMAIL_SIGNUP: 'forms.email-signup',
} as const;
