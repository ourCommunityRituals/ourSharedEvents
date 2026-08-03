/**
 * @ocr/ui — Tailwind CSS preset for Phase 3 React surfaces.
 *
 * Import this preset in any React app's tailwind.config.ts to inherit
 * the full OCR token vocabulary as Tailwind utility classes. The preset
 * maps every Tier 2 semantic token to a CSS custom property reference so
 * the same light/dark theme logic (prefers-color-scheme + data-theme="…")
 * that governs the Worker surfaces governs React components too — one
 * token, one value, zero drift.
 *
 * Usage (tailwind.config.ts in the React app):
 *
 *   import { ocrTailwindPreset } from '@ocr/ui/tailwind'
 *   export default {
 *     presets: [ocrTailwindPreset],
 *     content: ['./src/**\/*.{ts,tsx}'],
 *   }
 *
 * The React app must also inject the @ocr/ui stylesheet so the CSS custom
 * properties are declared in the document. Two patterns:
 *
 *   // Vite: import the string and inject it in index.html via a plugin,
 *   // or use a global CSS file that links /ui.css from the Worker:
 *   //   <link rel="stylesheet" href="/ui.css">   ← preferred for Phase 3
 *
 *   // Programmatic (non-Worker contexts only):
 *   import { ocrStylesheet } from '@ocr/ui/css'
 *   // then inject: document.head.insertAdjacentHTML('beforeend', `<style>${ocrStylesheet}</style>`)
 *
 *   // Do NOT call serveCss() from React — it is a Cloudflare Worker API.
 *
 * Generated utility class examples:
 *   bg-bg          → background-color: var(--bg)
 *   text-text       → color: var(--text)
 *   text-accent     → color: var(--accent)
 *   border-border   → border-color: var(--border)
 *   bg-surface      → background-color: var(--surface)
 *   text-text-muted → color: var(--text-muted)
 *   bg-live         → background-color: var(--live)
 *   bg-danger       → background-color: var(--danger)
 *   rounded-DEFAULT → border-radius: var(--radius)      (12px)
 *   rounded-sm      → border-radius: var(--radius-sm)   (8px)
 *   rounded-pill    → border-radius: var(--radius-pill) (20px)
 *   min-h-tap       → min-height: var(--tap-min)        (48px — WCAG tap target)
 *   font-sans       → font-family: var(--font)
 */

// Using Record<string, unknown> to avoid a hard devDependency on tailwindcss types.
// Callers who have tailwindcss installed can cast: `ocrTailwindPreset as Config['presets'][0]`
export const ocrTailwindPreset: Record<string, unknown> = {
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        border: 'var(--border)',
        text: 'var(--text)',
        'text-muted': 'var(--text-muted)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        live: 'var(--live)',
        'live-hover': 'var(--live-hover)',
        'surface-hover': 'var(--surface-hover)',
        danger: 'var(--danger)',
        'danger-hover': 'var(--danger-hover)',
        error: 'var(--error)',
        // UEC v1.1 — Universal Event Code category colors (display palette)
        'uec-enter': 'var(--uec-enter)',
        'uec-live': 'var(--uec-live)',
        'uec-sponsor': 'var(--uec-sponsor)',
        'uec-archive': 'var(--uec-archive)',
        'uec-help': 'var(--uec-help)',
        'uec-feedback': 'var(--uec-feedback)',
        'uec-utility': 'var(--uec-utility)',
        'uec-alert': 'var(--uec-alert)',
        'uec-staff': 'var(--uec-staff)',
        'uec-checkin': 'var(--uec-checkin)',
        'uec-shop': 'var(--uec-shop)',
        // UEC v1.1 — scan palette (WCAG AA on white, QR module fill)
        'uec-enter-scan': 'var(--uec-enter-scan)',
        'uec-live-scan': 'var(--uec-live-scan)',
        'uec-sponsor-scan': 'var(--uec-sponsor-scan)',
        'uec-archive-scan': 'var(--uec-archive-scan)',
        'uec-help-scan': 'var(--uec-help-scan)',
        'uec-feedback-scan': 'var(--uec-feedback-scan)',
        'uec-utility-scan': 'var(--uec-utility-scan)',
        'uec-alert-scan': 'var(--uec-alert-scan)',
        'uec-staff-scan': 'var(--uec-staff-scan)',
        'uec-checkin-scan': 'var(--uec-checkin-scan)',
        'uec-shop-scan': 'var(--uec-shop-scan)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'var(--radius-sm)',
        pill: 'var(--radius-pill)',
      },
      fontFamily: {
        sans: ['var(--font)', 'system-ui', 'sans-serif'],
      },
      minHeight: {
        tap: 'var(--tap-min)',
      },
      minWidth: {
        tap: 'var(--tap-min)',
      },
      spacing: {
        tap: 'var(--tap-min)', // 48px — WCAG touch target
      },
    },
  },
};
