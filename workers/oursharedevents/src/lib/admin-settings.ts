/**
 * Settings screen data (read only, first slice).
 *
 * One pure builder, so the page can only say what the code does: every number
 * below is imported from the module that enforces it (the count floor, the
 * retention windows, the listing delay, the draft archive, the TV default), and
 * `tests/admin-settings.spec.ts` pins each one.
 *
 * Four sections:
 *   defaults  what every NEW event starts from today. Platform-wide for now:
 *             there is no brand-level storage yet, so nothing here is editable
 *             and the page says so rather than showing a switch that does nothing.
 *   plan      what the plan includes, Enterprise items named not hidden. SHOWS the
 *             plan; changing it stays a platform-key action (apply-tier).
 *   timings   platform timings, resolved the way the cron and the publish path
 *             resolve them.
 *   fixed     what no setting can change, in plain words.
 *
 * SECURITY IS NEVER TIER-GATED. The `fixed` list takes no tier input at all, so it
 * is identical on free, mid and enterprise by construction, and no plan item is an
 * audit, role, isolation or retention switch (the spec asserts both).
 *
 * Never-who: nothing here names a person, an id or a secret.
 */

import { CORRIDOR_MAP_MIN_COUNT } from './shared-report';
import { resolveDraftExpiryDays } from './draft-expiry';
import { resolvePublishGraceMinutes } from './publish-grace';
import { PLATFORM_HOME_TZ } from './event-datetime';
import { DWELL_DEFAULT_SECONDS, DISPLAY_PANES } from './event-settings';
import { NEVER_WHO_LINE } from './never-who';
import { REGISTRATION_TTL_DAYS, EMAIL_RETENTION_DAYS } from './retention-windows';
import { FLAG_KEYS, TIER_PRESETS, type Tier } from './feature-flags';

export interface AdminSettingsEnv {
  PUBLISH_GRACE_MINUTES?: string;
  DRAFT_EXPIRY_DAYS?: string;
}

export interface SettingsDefaultItem {
  key: string;
  label: string;
  value: string;
  /** 'platform' = a platform constant; 'plan' = follows the plan. */
  source: 'platform' | 'plan';
}

export interface SettingsPlanItem {
  key: string;
  label: string;
  included: boolean;
  lowest_tier: Tier;
}

export interface SettingsTiming {
  key: string;
  label: string;
  value: number;
  unit: 'minutes' | 'days';
}

export interface AdminSettings {
  ok: true;
  read_only: true;
  defaults: { editable: false; note: string; items: SettingsDefaultItem[] };
  plan: { tier: Tier; name: string; description: string; items: SettingsPlanItem[] };
  timings: SettingsTiming[];
  fixed: Array<{ key: string; text: string }>;
}

/**
 * The plan features worth naming, in plain words. A flag key with no label here is
 * not shown: the two test-only mock switches are deliberately left out, and the
 * spec fails if a new real flag is added without a label.
 */
const PLAN_LABELS: Record<string, string> = {
  [FLAG_KEYS.FORMS_REGISTER]: 'Registration form',
  [FLAG_KEYS.FORMS_CHECKIN]: 'Check-in form',
  [FLAG_KEYS.FORMS_SURVEY]: 'Survey form',
  [FLAG_KEYS.FORMS_EMAIL_SIGNUP]: 'Email updates sign-up',
  [FLAG_KEYS.CONFIG_SELF_SERVE]: 'Set up your own events',
  [FLAG_KEYS.CONFIG_EVENT_SETTINGS]: 'Settings on each event',
  [FLAG_KEYS.ANALYTICS_SHARED_REPORT]: 'Shared report',
  [FLAG_KEYS.REPORT_EXPORT_JSON]: 'Report download (data file)',
  [FLAG_KEYS.REPORT_ADVANCED_METRICS]: 'Advanced report numbers',
  [FLAG_KEYS.REPORT_EXPORT_PDF]: 'Report download (PDF)',
  [FLAG_KEYS.REPORT_CUSTOM_WINDOW]: 'Report for a time window you choose',
  [FLAG_KEYS.REPORT_PORTFOLIO]: 'One report across all your events',
  [FLAG_KEYS.ASSETS_FILE_UPLOAD]: 'File uploads',
  [FLAG_KEYS.ASSETS_CUSTOM_QR]: 'Custom QR codes',
  [FLAG_KEYS.BRANDING_WHITE_LABEL]: 'White-label branding',
  [FLAG_KEYS.BRANDING_CUSTOM_DOMAIN]: 'Your own web address',
  [FLAG_KEYS.BRANDING_COLOR_PALETTE]: 'Your own colour palette',
};

const TIER_ORDER: Tier[] = ['free', 'mid', 'enterprise'];

const PANE_LABELS: Record<string, string> = {
  event: 'This event',
  upcoming: 'Coming up next',
  sponsors: 'Sponsors',
};

function flagOn(tier: Tier, key: string): boolean {
  return (TIER_PRESETS[tier].flags as Record<string, boolean>)[key] === true;
}

export function buildAdminSettings(input: { tier: Tier; env: AdminSettingsEnv }): AdminSettings {
  const { tier, env } = input;
  const preset = TIER_PRESETS[tier];

  // The league screen only joins once a league link is saved, so the starting
  // order is the screens that always have something to show.
  const tvScreens = DISPLAY_PANES.filter((p) => p in PANE_LABELS)
    .map((p) => PANE_LABELS[p])
    .join(', ');

  const defaults: SettingsDefaultItem[] = [
    { key: 'print_qr', label: 'Print QR codes on the poster', value: 'On', source: 'platform' },
    { key: 'timezone', label: 'Time zone', value: PLATFORM_HOME_TZ, source: 'platform' },
    { key: 'tv_screens', label: 'TV screens', value: tvScreens, source: 'platform' },
    {
      key: 'tv_seconds',
      label: 'TV screen time',
      value: `${DWELL_DEFAULT_SECONDS} seconds`,
      source: 'platform',
    },
    {
      key: 'survey',
      label: 'Survey after the event',
      value: flagOn(tier, FLAG_KEYS.FORMS_SURVEY) ? 'On' : 'Off',
      source: 'plan',
    },
    {
      key: 'email_updates',
      label: 'Email updates sign-up',
      value: flagOn(tier, FLAG_KEYS.FORMS_EMAIL_SIGNUP) ? 'On' : 'Off',
      source: 'plan',
    },
  ];

  const planItems: SettingsPlanItem[] = Object.keys(PLAN_LABELS).map((key) => ({
    key,
    label: PLAN_LABELS[key],
    included: flagOn(tier, key),
    lowest_tier: TIER_ORDER.find((t) => flagOn(t, key)) ?? 'enterprise',
  }));

  const timings: SettingsTiming[] = [
    {
      key: 'listing_delay_minutes',
      label: 'A new event is listed after',
      value: resolvePublishGraceMinutes(env.PUBLISH_GRACE_MINUTES),
      unit: 'minutes',
    },
    {
      key: 'draft_archive_days',
      label: 'A draft nobody touched is archived after',
      value: resolveDraftExpiryDays(env.DRAFT_EXPIRY_DAYS),
      unit: 'days',
    },
  ];

  const fixed = [
    {
      key: 'privacy_line',
      text: `${NEVER_WHO_LINE} Reports count people; they never name them.`,
    },
    {
      key: 'count_floor',
      text: `Any count under ${CORRIDOR_MAP_MIN_COUNT} is hidden, so a small number can never point at someone.`,
    },
    {
      key: 'maps_neighbourhood_only',
      text: 'Maps show neighbourhood-sized areas. They never show where a person was.',
    },
    {
      key: 'no_cookies',
      text: 'Public pages set no cookies and run no tracking.',
    },
    {
      key: 'retention_registrations',
      text: `A registrant's name and email are cleared the day after the event. The rest is deleted ${REGISTRATION_TTL_DAYS} days after they register.`,
    },
    {
      key: 'retention_email',
      text: `Email sign-ups are deleted ${EMAIL_RETENTION_DAYS} days after they are made.`,
    },
    {
      key: 'brand_isolation',
      text: 'One brand can never see another brand’s events, sponsors, people or logs.',
    },
    {
      key: 'uec_colours',
      text: 'Event-type colours are set by the platform, so a poster or a TV reads the same everywhere.',
    },
    {
      key: 'security_same_on_every_plan',
      text: 'Security is the same on every plan: the activity log, who can do what, separation between brands and how long data is kept.',
    },
    {
      key: 'brand_look_via_magnets',
      text: 'Your brand’s look is requested through OurSharedMagnets. It is not edited here.',
    },
  ];

  return {
    ok: true,
    read_only: true,
    defaults: {
      editable: false,
      note: 'Every new event starts from these values today, for every brand. Choosing your own defaults is not built yet. When it is, changing a default will never touch existing events.',
      items: defaults,
    },
    plan: { tier, name: preset.name, description: preset.description, items: planItems },
    timings,
    fixed,
  };
}
