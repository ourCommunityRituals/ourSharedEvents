/**
 * @ocr/ui — Canonical design tokens (CARTO palette, colorblind-safe)
 *
 * THREE-TIER ARCHITECTURE
 * ────────────────────────────────────────────────────────────────────────────
 * Tier 1  Primitives   raw colour values — never referenced by components
 * Tier 2  Semantic     meaning-mapped vars referencing Tier 1 — what components use
 * Tier 3  Brand        one CSS block that re-maps Tier 2 → different Tier 1
 *
 * COLORBLIND SAFETY (geographic consumption)
 * ────────────────────────────────────────────────────────────────────────────
 * Red + green as semantic opposites is the primary geographic accessibility
 * failure (deuteranopia affects ~8% of males; protanopia ~1%). This palette
 * avoids it:
 *   --live   = teal  (#00C4B4) — distinguishable across protanopia,
 *              deuteranopia, and tritanopia; distinct in lightness from blue
 *   --danger = red   (#E05252) — used only for DESTRUCTIVE ACTIONS, never
 *              as a semantic opposite to --live
 *
 * All foreground/background pairs target WCAG AA (4.5:1 normal text, 3:1 large).
 * Run: import { contrastRatio } from '@ocr/ui' to verify any new pair.
 *
 * ADDING A NEW CLIENT BRAND
 * ────────────────────────────────────────────────────────────────────────────
 * Add a Tier 3 block in the consumer's CSS (not here):
 *
 *   [data-brand="acme"] {
 *     --accent:       #7B3FE4;
 *     --accent-hover: #9B5FF4;
 *   }
 *
 * Override only the semantic tokens that differ. Everything else inherits OCR base.
 */

// ── Tier 1: Primitive colour scale ───────────────────────────────────────────

export const primitives = {
  // CARTO blue scale
  '--ocr-blue-600': '#1785FB', // CARTO signature blue
  '--ocr-blue-500': '#3D9BFF', // hover / lighter
  '--ocr-blue-200': '#A8CEFD', // subtle highlight (light mode)

  // Navy/dark scale
  '--ocr-navy-950': '#0F1824', // darkest bg
  '--ocr-navy-900': '#1A2740', // surface / card
  '--ocr-navy-700': '#2A3D5A', // border
  '--ocr-navy-500': '#7A94B0', // muted text
  '--ocr-navy-100': '#F0F4F8', // text on dark (blue-white)

  // Light scale
  '--ocr-light-050': '#F4F7FC', // light mode bg
  '--ocr-light-100': '#FFFFFF', // light mode surface
  '--ocr-light-200': '#D4E0ED', // light mode border
  '--ocr-dark-900': '#162945', // light mode text (CARTO dark navy)
  '--ocr-dark-500': '#5A7A9A', // light mode muted

  // Status — colorblind-safe pair (NOT red + green)
  '--ocr-teal-400': '#00C4B4', // live dark mode  (8.1:1 on navy-950)
  '--ocr-teal-300': '#33D4C6', // live hover dark
  '--ocr-teal-700': '#00796B', // live light mode (4.9:1 on light-050)
  '--ocr-teal-600': '#009688', // live hover light
  '--ocr-red-500': '#E05252', // danger dark mode (4.7:1 on navy-950)
  '--ocr-red-400': '#E87272', // danger hover dark
  '--ocr-red-700': '#B03030', // danger light mode (5.2:1 on light-050)
  '--ocr-red-600': '#C03838', // danger hover light

  // Surface hover steps
  '--ocr-navy-800': '#223350', // surface-hover dark (between navy-900 and navy-700)

  // Light-mode foreground variants — darker to clear 4.5:1 on #F4F7FC
  '--ocr-blue-700': '#0057D6', // accent light mode (4.7:1 on light-050)
  '--ocr-blue-600l': '#2E6FDF', // accent hover light
  '--ocr-slate-600': '#4A6882', // muted light mode (4.6:1 on light-050)
} as const;

export type PrimitiveName = keyof typeof primitives;

// ── Tier 2: Semantic tokens (dark default) ────────────────────────────────────

export const semanticDark = {
  '--bg': 'var(--ocr-navy-950)',
  '--surface': 'var(--ocr-navy-900)',
  '--border': 'var(--ocr-navy-700)',
  '--text': 'var(--ocr-navy-100)',
  '--text-muted': 'var(--ocr-navy-500)',
  '--accent': 'var(--ocr-blue-600)',
  '--accent-hover': 'var(--ocr-blue-500)',
  '--live': 'var(--ocr-teal-400)', // on-air / active — teal, not green
  '--live-hover': 'var(--ocr-teal-300)',
  '--surface-hover': 'var(--ocr-navy-800)',
  '--danger': 'var(--ocr-red-500)', // destructive actions only
  '--danger-hover': 'var(--ocr-red-400)',
  '--error': 'var(--ocr-red-500)', // alias — form validation / error banners
} as const;

// ── Tier 2: Light mode override ───────────────────────────────────────────────

export const semanticLight = {
  '--bg': 'var(--ocr-light-050)',
  '--surface': 'var(--ocr-light-100)',
  '--border': 'var(--ocr-light-200)',
  '--text': 'var(--ocr-dark-900)',
  '--text-muted': 'var(--ocr-slate-600)', // 4.6:1 — full AA
  '--accent': 'var(--ocr-blue-700)', // 4.7:1 — full AA
  '--accent-hover': 'var(--ocr-blue-600l)',
  '--live': 'var(--ocr-teal-700)', // 4.9:1 — full AA
  '--live-hover': 'var(--ocr-teal-600)',
  '--surface-hover': 'var(--ocr-light-200)',
  '--danger': 'var(--ocr-red-700)', // 5.2:1 — full AA
  '--danger-hover': 'var(--ocr-red-600)',
  '--error': 'var(--ocr-red-700)', // alias — form validation / error banners
} as const;

// ── Shared structural tokens (not colour, not theme-sensitive) ────────────────

export const structural = {
  '--radius': '12px',
  '--radius-sm': '8px',
  '--radius-pill': '20px',
  '--tap-min': '48px',
  '--font': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
} as const;

// ── Legacy alias ──────────────────────────────────────────────────────────────

export const tokens = {
  ...primitives,
  ...semanticDark,
  ...structural,
} as const;

export type TokenName = keyof typeof tokens;

/** Full :root block — primitives + dark semantic defaults + structural. */
export function rootBlock(): string {
  const lines = (obj: Record<string, string>) =>
    Object.entries(obj)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');

  return [
    '/* Tier 1 — primitives */',
    ':root {',
    lines(primitives),
    '}',
    '',
    '/* Tier 2 — semantic (dark default) */',
    ':root {',
    lines(semanticDark),
    lines(structural),
    '}',
  ].join('\n');
}

/**
 * Light-mode override block.
 * Default: automatic via prefers-color-scheme.
 * Force light: add data-theme="light" to <html> and call lightModeBlock('[data-theme="light"]').
 */
export function lightModeBlock(selector = '@media (prefers-color-scheme: light)'): string {
  const lines = Object.entries(semanticLight)
    .map(([k, v]) => `    ${k}: ${v};`)
    .join('\n');
  if (selector.startsWith('@')) {
    return `${selector} {\n  :root {\n${lines}\n  }\n}`;
  }
  return `${selector} {\n${lines}\n}`;
}

/**
 * Dark-mode forced override block.
 * Use data-theme="dark" on <html> to lock dark mode regardless of system preference.
 * Explicit forcing is required by Claude Design for component previews and for
 * users whose OS reports light mode but who prefer the dark interface.
 */
export function forceDarkBlock(selector = '[data-theme="dark"]'): string {
  const lines = Object.entries(semanticDark)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `${selector} {\n${lines}\n}`;
}

// ── UEC v1.1: Universal Event Code category colors ────────────────────────────
//
// Theme-invariant: hue carries semantic meaning (green = access, coral = energy,
// etc.) — the colors must not flip between light and dark mode.
//
// Two palettes per code:
//   display_hex — warm brand variant for UI surfaces, marketing, poster chrome
//   scan_hex    — WCAG AA validated on white, used as QR module fill color
//
// Source of truth for hex values: src/lib/uec/uec-codes.ts in the OSE Worker.
// Changes here must stay in sync with that file.

/**
 * UEC display palette — for UI surfaces, poster chrome, SharedReport badges.
 *
 * Badge text pairings (WCAG AA ≥ 3:1 for decorative/large text):
 *   WHITE text (≥ 3:1): enter, sponsor, archive, help, utility, alert, staff, checkin, shop
 *   BLACK text (≥ 3:1): live (#E07A5F coral ~2.96 white → use black), feedback (#C4930A amber ~2.79 white → use black)
 */
export const uecDisplay = {
  '--uec-enter': '#2D6A4F', // Green    — Go · Access · Safe Passage       | white text
  '--uec-live': '#E07A5F', // Coral    — Exciting · Warm · Now             | BLACK text
  '--uec-sponsor': '#1D3557', // Blue     — Trust · Commerce · Partnership    | white text
  '--uec-archive': '#6C3483', // Purple   — Memory · History · Record         | white text
  '--uec-help': '#D4668E', // Pink     — Care · Assistance · Accessibility | white text
  '--uec-feedback': '#C4930A', // Amber    — Voice · Opinion · Response        | BLACK text
  '--uec-utility': '#4A4A4A', // Charcoal — General · Info · Infrastructure  | white text
  // Extension codes (08-11)
  '--uec-alert': '#B8960A', // Yellow-Amber — high-visibility alert         | black text
  '--uec-staff': '#A00020', // Deep Red     — staff-only surface             | white text
  '--uec-checkin': '#006B6B', // Teal         — check-in variant              | white text
  '--uec-shop': '#1A4A48', // Dark Teal    — commerce placement            | white text
} as const;

/** UEC scan palette — WCAG AA on white, intended for QR module fill color. */
export const uecScan = {
  '--uec-enter-scan': '#1A6B2F',
  '--uec-live-scan': '#C04048',
  '--uec-sponsor-scan': '#1A3A8A',
  '--uec-archive-scan': '#5E1A9A',
  '--uec-help-scan': '#B01468',
  '--uec-feedback-scan': '#8A5A00',
  '--uec-utility-scan': '#2A2A3A',
  // Extensions: scan_hex === display_hex for these codes
  '--uec-alert-scan': '#B8960A',
  '--uec-staff-scan': '#A00020',
  '--uec-checkin-scan': '#006B6B',
  '--uec-shop-scan': '#1A4A48',
} as const;

/**
 * Static :root block for all UEC custom properties.
 * Include once in the global stylesheet (ocrStylesheet() already calls this).
 *
 * Colors are theme-invariant — do NOT wrap in prefers-color-scheme.
 */
export function uecBlock(): string {
  const lines = (obj: Record<string, string>) =>
    Object.entries(obj)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');
  return [
    '/* UEC v1.1 — Universal Event Code category colors (theme-invariant) */',
    ':root {',
    lines(uecDisplay),
    lines(uecScan),
    '}',
  ].join('\n');
}
