# @ocr/ui Component Inventory

**Source:** `workers/oursharedevents/node_modules/@ocr/ui/src/` — a link to the hub's `packages/ui` (ourCommunityRituals/ourCommunityRituals), staged at `../packages/ui` from the commit pinned in `.ocr-hub-ref` (ADR-008 Phase 0; the in-repo `packages/ui` copy was deleted)
**Import:** `import { ... } from '@ocr/ui'`
**Purpose:** Reference for Claude Design — what exists, how it's structured, and how to add new components without breaking the token contract.

---

## 1. Token System

Three-tier architecture. Components reference only Tier 2 (semantic) tokens — never Tier 1 (primitives) directly.

### Tier 1 — Primitives (never use in components)

| Variable          | Value     | Notes                                  |
| ----------------- | --------- | -------------------------------------- |
| `--ocr-blue-600`  | `#1785FB` | CARTO signature blue                   |
| `--ocr-blue-500`  | `#3D9BFF` | hover / lighter                        |
| `--ocr-blue-200`  | `#A8CEFD` | subtle highlight (light mode)          |
| `--ocr-navy-950`  | `#0F1824` | darkest bg                             |
| `--ocr-navy-900`  | `#1A2740` | surface / card                         |
| `--ocr-navy-800`  | `#223350` | surface hover                          |
| `--ocr-navy-700`  | `#2A3D5A` | border                                 |
| `--ocr-navy-500`  | `#7A94B0` | muted text                             |
| `--ocr-navy-100`  | `#F0F4F8` | text on dark (blue-white)              |
| `--ocr-light-050` | `#F4F7FC` | light mode bg                          |
| `--ocr-light-100` | `#FFFFFF` | light mode surface                     |
| `--ocr-light-200` | `#D4E0ED` | light mode border                      |
| `--ocr-dark-900`  | `#162945` | light mode text (CARTO dark navy)      |
| `--ocr-dark-500`  | `#5A7A9A` | light mode muted                       |
| `--ocr-teal-400`  | `#00C4B4` | live dark (8.1:1 on navy-950)          |
| `--ocr-teal-300`  | `#33D4C6` | live hover dark                        |
| `--ocr-teal-700`  | `#00796B` | live light (4.9:1 on light-050)        |
| `--ocr-teal-600`  | `#009688` | live hover light                       |
| `--ocr-red-500`   | `#E05252` | danger dark (4.7:1 on navy-950)        |
| `--ocr-red-400`   | `#E87272` | danger hover dark                      |
| `--ocr-red-700`   | `#B03030` | danger light (5.2:1 on light-050)      |
| `--ocr-red-600`   | `#C03838` | danger hover light                     |
| `--ocr-blue-700`  | `#0057D6` | accent light mode (4.7:1 on light-050) |
| `--ocr-blue-600l` | `#2E6FDF` | accent hover light                     |
| `--ocr-slate-600` | `#4A6882` | muted light (4.6:1 on light-050)       |

### Tier 2 — Semantic tokens (use these in components)

| Variable          | Dark default | Light override | Use                             |
| ----------------- | ------------ | -------------- | ------------------------------- |
| `--bg`            | navy-950     | light-050      | Page background                 |
| `--surface`       | navy-900     | light-100      | Card / panel background         |
| `--border`        | navy-700     | light-200      | All borders and dividers        |
| `--text`          | navy-100     | dark-900       | Primary body text               |
| `--text-muted`    | navy-500     | slate-600      | Secondary / label text          |
| `--accent`        | blue-600     | blue-700       | CTAs, links, active states      |
| `--accent-hover`  | blue-500     | blue-600l      | Hover state for accent elements |
| `--surface-hover` | navy-800     | light-200      | Row / card hover background     |
| `--live`          | teal-400     | teal-700       | Live/active status — NOT green  |
| `--live-hover`    | teal-300     | teal-600       | Live hover state                |
| `--danger`        | red-500      | red-700        | Destructive actions only        |
| `--danger-hover`  | red-400      | red-600        | Danger hover                    |
| `--error`         | red-500      | red-700        | Form validation / error banners |

### Tier 2 — Structural tokens (theme-insensitive)

| Variable        | Value           | Use                          |
| --------------- | --------------- | ---------------------------- |
| `--radius`      | `12px`          | Large cards, modals          |
| `--radius-sm`   | `8px`           | Buttons, inputs, small cards |
| `--radius-pill` | `20px`          | Badges, chips                |
| `--tap-min`     | `48px`          | Minimum touch target height  |
| `--font`        | system-ui stack | Body font family             |

### OSE-specific surface tokens (`--ose-*`)

Used only in public event page renders (`renderPreEventHtml`, `renderLiveEventHtml`, `renderPostEventHtml`, `renderMinimalPhaseHtml`) which embed isolated `<style>` blocks rather than linking `/ui.css`. These are **not** exported from `@ocr/ui`.

| Variable            | Value                  | Use                                    |
| ------------------- | ---------------------- | -------------------------------------- |
| `--ose-bg`          | `#faf7f2`              | Event page background (warm off-white) |
| `--ose-text`        | `#2a2a2a`              | Event page primary text                |
| `--ose-muted`       | `#5a5a5a`              | Event page secondary text              |
| `--ose-accent`      | `#4361ee`              | Event page CTA / links                 |
| `--ose-card`        | `#fff`                 | Event page card background             |
| `--ose-live`        | `#d63b3b`              | Live badge (live phase only)           |
| `--ose-focus`       | `#ffb800`              | Focus ring color (amber)               |
| `--ose-accent-tint` | `rgba(67,97,238,0.06)` | Anonymity card tinted background       |

### Generating CSS

```typescript
import { rootBlock, lightModeBlock, forceDarkBlock } from '@ocr/ui';

// Full :root + semantic dark defaults
const css = rootBlock();

// Light mode override (media query or selector)
const lightCss = lightModeBlock(); // prefers-color-scheme: light
const forcedLight = lightModeBlock('[data-theme="light"]'); // explicit attribute — Claude Design preview

// Dark mode forced override (explicit attribute)
const forcedDark = forceDarkBlock(); // [data-theme="dark"] — locks dark regardless of OS
const customDark = forceDarkBlock('[data-brand="x"]'); // custom selector

// Serve from worker route
import { ocrStylesheet } from '@ocr/ui';
// ocrStylesheet = rootBlock()
//               + lightModeBlock()                    (@media prefers-color-scheme: light)
//               + lightModeBlock('[data-theme="light"]')  (explicit forced light)
//               + forceDarkBlock()                    ([data-theme="dark"])
//               + componentStyles                     (includes :focus-visible + prefers-reduced-motion)
```

### Theme switching (Claude Design)

Set `data-theme` on `<html>` to override the OS preference:

```html
<html data-theme="light">
  <!-- force light, ignore OS -->
  <html data-theme="dark">
    <!-- force dark, ignore OS -->
  </html>
</html>
```

Claude Design uses explicit `[data-theme]` selectors for component preview — the stylesheet includes both directions. Without `data-theme`, the theme follows `prefers-color-scheme` automatically.

### Accessibility — `:focus-visible` (WCAG 2.4.11)

All interactive component classes have explicit `outline: 2px solid var(--accent)` on `:focus-visible`. Covered classes: `.btn`, `.attr-btn`, `.filter-chip`, `.genre-filter-btn`, `.view-btn`, `.btn-link`, `.nav-item`, `.card`, `.track-card`, `.genre-link`, `.list-item`, `.grid-card`, `.input`, `.search-bar`, `.sort-select`, `.toggle input + .toggle-track`.

### Accessibility — `prefers-reduced-motion` (WCAG 2.3.3)

A `@media (prefers-reduced-motion: reduce)` block in `componentStyles` disables all animations and transitions for users who opt out. Covered: `.live-indicator.on`, `.live-badge`, `.spinner`, `.search-bar.loading`, `.btn`, `.card`, `.track-card`, `.filter-chip`, `.grid-card`, `.genre-popup`, `.genre-link`, `.list-item`, `.nav-item`, `.bar-fill`, `.progress-bar`, `.toggle-track`.

### Brand overrides (Tier 3)

```css
[data-brand='acme'] {
  --accent: #7b3fe4;
  --accent-hover: #9b5ff4;
}
```

Add in consumer CSS — do not modify tokens.ts.

---

## 2. Component Classes

All values reference Tier 2 tokens. No hex values in component styles.

### Layout

| Class               | Description                                  | Tokens used                |
| ------------------- | -------------------------------------------- | -------------------------- |
| `.header`           | Sticky top bar, blur backdrop, flex row      | `--border`, `--text`       |
| `.content`          | Main scrollable area, bottom padding for nav | —                          |
| `.section`          | Vertical-spaced content block                | —                          |
| `.section-title`    | Label above a section, ALL CAPS              | `--text-muted`             |
| `.page-header`      | Sticky centered header (stats pages)         | `--border`, `--text-muted` |
| `.live-view-header` | Centered static header (live display)        | `--border`                 |

### Buttons — all ≥ 48px tap target

| Class            | Description                           | Notes                                    |
| ---------------- | ------------------------------------- | ---------------------------------------- |
| `.btn`           | Base button — use with a variant      | Required, always combine                 |
| `.btn-primary`   | Accent background, dark text          | `background: var(--accent); color: #000` |
| `.btn-secondary` | Surface background, bordered          | `var(--surface)`, `var(--border)`        |
| `.btn-danger`    | Red background, white text            | `var(--danger); color: #fff`             |
| `.btn-block`     | Full-width                            | Add alongside variant                    |
| `.btn-link`      | Transparent, underlined, muted        | For inline actions                       |
| `.attr-btn`      | Attribution action button, pill shape | `var(--accent); color: #000`             |

**Usage:**

```html
<button class="btn btn-primary">Save</button>
<a class="btn btn-secondary btn-block" href="/back">Cancel</a>
```

### Cards

| Class          | Description                                            |
| -------------- | ------------------------------------------------------ |
| `.card`        | Surface background, bordered, rounded-sm, 14px padding |
| `.card:hover`  | Surface hover on pointer devices                       |
| `.stat-card`   | Fixed-width stat cell with centered value + label      |
| `.track-card`  | Horizontal flex card for tracks (art + info)           |
| `.grid-card`   | Square grid item with cover art                        |
| `.now-playing` | Surface card for currently-playing track               |

### Inputs

| Class          | Description                                                      |
| -------------- | ---------------------------------------------------------------- |
| `.input`       | Full-width text input, references all surface/border/text tokens |
| `.search-bar`  | Search-specific input with shimmer loading state                 |
| `.sort-select` | Styled `<select>` element                                        |

### Navigation

| Class              | Description                                      |
| ------------------ | ------------------------------------------------ |
| `.bottom-nav`      | Fixed bottom bar, blur backdrop, safe-area aware |
| `.nav-item`        | Individual nav link — flex column, icon + label  |
| `.nav-item.active` | Accent color active state                        |

### Status / Feedback

| Class                   | Description                           | Token                       |
| ----------------------- | ------------------------------------- | --------------------------- |
| `.live-indicator`       | Inline live/offline badge             | `--live`, `--surface`       |
| `.live-indicator.on`    | Pulsing teal "Live"                   | `--live`                    |
| `.live-indicator.off`   | Static gray "Offline"                 | `--text-muted`, `--surface` |
| `.live-badge`           | Larger pill-shaped live badge         | `--live`                    |
| `.loading`              | Centered spinner container (min 60vh) | —                           |
| `.spinner`              | 40px spinning ring                    | `--border`, `--accent`      |
| `.error-banner`         | Form error banner, hidden by default  | `--error`                   |
| `.error-banner.visible` | Shown error banner                    | `--error`                   |

### Empty States

| Class            | Description                                                    |
| ---------------- | -------------------------------------------------------------- |
| `.empty-state`   | Full-height centered empty state — always includes a next step |
| `.es-icon`       | Large emoji/icon above the title                               |
| `.access-denied` | Legacy class — prefer `emptyState()` partial instead           |
| `.not-found`     | Legacy class — prefer `emptyState()` partial instead           |
| `.offline-msg`   | Legacy offline placeholder                                     |

### Lists

| Class          | Description                                          |
| -------------- | ---------------------------------------------------- |
| `.list-item`   | Row with name, sub, and count — hover state included |
| `.list-name`   | Primary text in list row                             |
| `.list-sub`    | Secondary text in list row                           |
| `.list-count`  | Accent-colored count on right                        |
| `.item-info`   | Flex-1 info block inside a row                       |
| `.item-name`   | Truncated primary text                               |
| `.item-sub`    | Truncated secondary text                             |
| `.item-action` | Right-side action (flex-shrink: 0)                   |

### Chips / Tags

| Class | Description |
| --------------------- | ---------------------------------------- | ----------------------------------- |
| `.filter-chip` | Scrollable filter chip, accent on active | `--surface`, `--border`, `--accent` |
| `.filter-chip.active` | Selected state | `--accent` |
| `.genre-tag` | Small inline genre tag | `--accent` tinted bg |
| `.meta-badge` | Tiny metadata chip | `--surface`, `--text-muted` |
| `.meta-badge.high` | High-prominence badge | `--accent` |
| `.user-badge` | Identity pill for logged-in user | `--accent` tinted |
| `.brand` | Uppercase brand label | `--accent` |
| `.source-badge` | Content source attribution pill | `--surface`, `--border` |

### Charts

| Class | Description |
| ------------ | ----------------------------------- | ---------- |
| `.stats-row` | Horizontal scroll row of stat cards |
| `.bar-chart` | Vertical stack of labeled bars |
| `.bar-row` | Single bar with label and count |
| `.bar-fill` | Animated fill bar | `--accent` |

### Form partials — classes

These classes are emitted by the `formInput()`, `textarea()`, `formSelect()`,
`checkbox()`, `radioGroup()`, and `formGroup()` partials. They are not
standalone utilities — use the partials, not the bare classes, so aria wiring
is guaranteed.

| Class                | Description                                                  | Tokens used              |
| -------------------- | ------------------------------------------------------------ | ------------------------ |
| `.form-field`        | Wrapper div — flex column, 6px gap, 16px margin-bottom       | —                        |
| `.form-hint`         | Hint text below input when no error                          | `--text-muted`           |
| `.form-error`        | Inline error message (has `role="alert"` via partial)        | `--error`                |
| `.required-mark`     | Red `*` after label on required fields (`aria-hidden`)       | `--error`                |
| `.input-error`       | Applied to input/textarea/select in error state              | `--error` border + focus |
| `.form-group`        | Fieldset with bordered legend — used by radioGroup/formGroup | `--border`               |
| `.checkbox-label`    | Flex row wrapping checkbox + label, min 44px height          | `--text`, `--accent`     |
| `.radio-option`      | Flex row wrapping radio + label, min 44px height             | `--text`, `--accent`     |
| `.radio-group-error` | Error message below a radio group                            | `--error`                |

### Forms (advanced)

| Class | Description |
| --------------------- | ------------------------------------- | ----------------------- |
| `.toggle-row` | Label + toggle switch row |
| `.toggle` | Toggle switch container |
| `.toggle-track` | Clickable track — accent when checked | `--border`, `--accent` |
| `.range-group` | Label + range slider row |
| `.drop-zone` | Drag-and-drop file target | `--border`, `--accent` |
| `.drop-zone.dragover` | Active drag state | `--accent` |
| `.preview-table` | Tabular preview of imported data | `--surface`, `--border` |
| `.progress-bar` | Upload/import progress bar | `--accent` |
| `.result-success` | Success result card | `--accent` tinted |
| `.result-error` | Error result card | `--error` tinted |

### Genre Popup

| Class | Description |
| ----------------------- | ----------------------------------- | --------------------------- |
| `.genre-popup` | Bottom sheet, slides up from bottom | `--surface`, `--border` |
| `.genre-popup.open` | Visible state (translateY(0)) | — |
| `.genre-popup-backdrop` | Full-screen scrim | `rgba(0,0,0,.5)` |
| `.genre-link` | Tap target inside popup | `--text`, `--surface-hover` |

### Profile

| Class | Description |
| --------------------- | ---------------------------- | ----------------------- |
| `.profile-header` | Centered profile top section | `--border` |
| `.profile-avatar` | Round avatar with initials | `--accent; color: #000` |
| `.contributor-item` | Leaderboard row | — |
| `.contributor-avatar` | Small round avatar | `--accent; color: #000` |

### QR / Display

| Class | Description |
| --------------- | ---------------------------------- | ------------------------------ |
| `.display-card` | Centered card for TV/kiosk view | — |
| `.qr-frame` | White rounded frame around QR code | Hardcoded `#fff` — intentional |
| `.sponsor-slot` | Sponsor attribution below QR | `--border`, `--text-muted` |

### Utility

| Class | Description |
| ---------------- | ------------------------- | ---------------------- |
| `.hidden` | `display: none` |
| `.body-centered` | Flex column, centered |
| `.content-wrap` | 80px bottom padding |
| `.footer-cta` | Centered footer with link | `--border`, `--accent` |

---

## 3. HTML Partials

All partials escape user input. Import from `@ocr/ui`.

### `header(opts)`

```typescript
header({ title: 'My App', live: true });
// → <header class="header"><h1>My App</h1><span class="live-indicator on">Live</span></header>

header({ title: 'My App', live: false });
// → live-indicator off

header({ title: 'My App' });
// → no badge
```

Props: `{ title: string; live?: boolean }`

### `bottomNav(items)`

```typescript
bottomNav([
  { href: '/', label: 'Home', icon: '🏠', active: true },
  { href: '/stats', label: 'Stats', icon: '📊' },
]);
// → <nav class="bottom-nav"><a class="nav-item active" ...>...</a>...</nav>
```

Props: `NavItem[]` — `{ href, label, icon, active? }`

### `button(opts)`

```typescript
button({ label: 'Save', variant: 'primary' });
// → <button class="btn btn-primary">Save</button>

button({ label: 'Details', href: '/events/123', variant: 'secondary' });
// → <a class="btn btn-secondary" href="/events/123">Details</a>

button({ label: 'Delete', variant: 'danger', block: true });
// → <button class="btn btn-danger btn-block">Delete</button>
```

Props: `{ label, href?, variant?, block?, disabled?, onclick? }`

### `card(inner)`

```typescript
card({ title: 'Eagles Hall', sub: 'Chicago, IL' });
// → <div class="card"><div class="item-name">Eagles Hall</div>...</div>
```

Props: `{ title?, sub?, body? }`

### `loading(label?)`

```typescript
loading(); // → spinner + "Loading…"
loading('Syncing…'); // → spinner + "Syncing…"
```

### `emptyState(opts)`

The primary empty/gate component. Always includes a title, message, and optional action.

```typescript
emptyState({
  icon: '📭',
  title: 'No events yet',
  message: 'Events you create will appear here.',
  action: { label: 'Create event', href: '/admin/new' },
});
```

Props: `{ icon?, title, message, action? }` — action: `{ label, href }`

### `accessDenied(opts?)`

Built on `emptyState`. Defaults give a non-DJ visitor a path forward.

```typescript
accessDenied();
// → "This area is for DJs" with "Get started → /connect"

accessDenied({ what: 'Catalog', action: { label: 'Sign in', href: '/login' } });
// → "Catalog is DJ-only" with custom CTA
```

### `page(opts)`

Full HTML document shell. Links `/ui.css` exactly once.

```typescript
page({
  title: 'Admin',
  body: '<p>Hello</p>',
  cssHref: '/ui.css',    // optional, default '/ui.css'
  live: true,            // optional — passes to header()
  nav: [...],            // optional — adds bottomNav()
})
```

Props: `PageOpts` — `{ title, body, cssHref?, live?, nav? }`

---

## 3b. Form Partials

All form partials emit fully-accessible HTML — label wired to input via `for`/`id`,
`aria-describedby` pointing to the active hint or error, `aria-invalid="true"` in
error state, `role="alert"` on error containers, `aria-hidden="true"` on decorative
required marks. No additional aria wiring is needed by the caller.

Import from `@ocr/ui`:

```typescript
import { formInput, textarea, formSelect, checkbox, radioGroup, formGroup } from '@ocr/ui';
```

---

### `formInput(opts)` — `FormInputOpts`

Label + text input + optional hint or error. Hint and error are mutually exclusive
(error takes precedence when both are provided).

```typescript
interface FormInputOpts {
  id: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search' | 'date';
  placeholder?: string;
  value?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string; // secondary description — shown when no error
  error?: string; // validation message — triggers aria-invalid + role=alert
}
```

**Default state:**

```typescript
formInput({ id: 'pv-name', label: 'Full name', required: true });
// →
// <div class="form-field">
//   <label for="pv-name">Full name<span aria-hidden="true" class="required-mark">*</span></label>
//   <input id="pv-name" name="pv-name" type="text" class="input" required />
// </div>
```

**With hint:**

```typescript
formInput({
  id: 'pv-email',
  label: 'Email',
  type: 'email',
  hint: 'Used for your ticket confirmation',
});
// →
// <input ... aria-describedby="pv-email-hint" />
// <div id="pv-email-hint" class="form-hint">Used for your ticket confirmation</div>
```

**Error state:**

```typescript
formInput({ id: 'pv-err', label: 'Email (error)', error: 'Enter a valid email address' });
// →
// <input ... class="input input-error" aria-describedby="pv-err-error" aria-invalid="true" />
// <div id="pv-err-error" class="form-error" role="alert">Enter a valid email address</div>
```

**Aria wiring summary:**

| Condition         | `aria-describedby` | `aria-invalid` | Error container `role` |
| ----------------- | ------------------ | -------------- | ---------------------- |
| No hint, no error | —                  | —              | —                      |
| `hint` provided   | `{id}-hint`        | —              | —                      |
| `error` provided  | `{id}-error`       | `"true"`       | `alert`                |

---

### `textarea(opts)` — `TextareaOpts`

Label + textarea + optional hint or error. Same aria wiring as `formInput`.

```typescript
interface TextareaOpts {
  id: string;
  label: string;
  placeholder?: string;
  value?: string;
  rows?: number; // default: 4
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  error?: string;
}
```

```typescript
textarea({ id: 'pv-bio', label: 'Bio', rows: 3, placeholder: 'Tell us about yourself' });
// →
// <div class="form-field">
//   <label for="pv-bio">Bio</label>
//   <textarea id="pv-bio" name="pv-bio" class="input" rows="3" placeholder="Tell us about yourself"></textarea>
// </div>
```

---

### `formSelect(opts)` — `FormSelectOpts`

Label + styled `<select>` + optional hint or error.

```typescript
interface FormSelectOpts {
  id: string;
  label: string;
  options: Array<{ value: string; label: string; selected?: boolean }>;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  error?: string;
}
```

```typescript
formSelect({
  id: 'pv-tier',
  label: 'Tier',
  options: [
    { value: '', label: 'Select…' },
    { value: 'free', label: 'Free' },
    { value: 'mid', label: 'Mid', selected: true },
    { value: 'enterprise', label: 'Enterprise' },
  ],
});
// →
// <div class="form-field">
//   <label for="pv-tier">Tier</label>
//   <select id="pv-tier" name="pv-tier" class="sort-select">
//     <option value="">Select…</option>
//     <option value="free">Free</option>
//     <option value="mid" selected>Mid</option>
//     <option value="enterprise">Enterprise</option>
//   </select>
// </div>
```

---

### `checkbox(opts)` — `CheckboxOpts`

Single accessible checkbox. The label wraps the input — no separate `for` needed.
Min touch target height (44px) is enforced by `.checkbox-label`.

```typescript
interface CheckboxOpts {
  id: string;
  label: string;
  name?: string; // defaults to id
  value?: string; // defaults to 'on'
  checked?: boolean;
  required?: boolean;
  disabled?: boolean;
}
```

```typescript
checkbox({ id: 'pv-agree', label: 'I agree to the terms of service', required: true });
// →
// <label class="checkbox-label">
//   <input type="checkbox" id="pv-agree" name="pv-agree" value="on" required />
//   I agree to the terms of service
// </label>
```

**Note:** `checkbox` does not support inline error messages. For checkbox groups
requiring validation, wrap multiple `checkbox()` calls inside `formGroup()` and
handle error display at the group level.

---

### `radioGroup(opts)` — `RadioGroupOpts`

Accessible radio group inside a `<fieldset>`. Each option meets the 44px touch
target floor via `.radio-option`. The `<legend>` names the group for screen readers.

```typescript
interface RadioGroupOpts {
  name: string;
  legend: string;
  options: Array<{
    value: string;
    label: string;
    checked?: boolean;
    disabled?: boolean;
  }>;
  required?: boolean;
  error?: string; // group-level error, role=alert
}
```

```typescript
radioGroup({
  name: 'pv-size',
  legend: 'Event size',
  options: [
    { value: 'intimate', label: 'Intimate (< 30)' },
    { value: 'mid', label: 'Mid (30–150)', checked: true },
    { value: 'large', label: 'Large (150+)' },
  ],
});
// →
// <fieldset class="form-group">
//   <legend>Event size</legend>
//   <label class="radio-option"><input type="radio" name="pv-size" value="intimate" /> Intimate (< 30)</label>
//   <label class="radio-option"><input type="radio" name="pv-size" value="mid" checked /> Mid (30–150)</label>
//   <label class="radio-option"><input type="radio" name="pv-size" value="large" /> Large (150+)</label>
// </fieldset>
```

**With error:**

```typescript
radioGroup({ ..., error: 'Select an event size to continue' });
// → adds: <div class="radio-group-error" role="alert">Select an event size...</div>
```

---

### `formGroup(opts)` — `FormGroupOpts`

Generic fieldset wrapper for grouping related but structurally-different fields.
Use `radioGroup()` for radio buttons (it has the same `<fieldset>` output but
handles the radio markup). Use `formGroup()` for mixed-field groups (e.g., address
= street + city + postcode).

```typescript
interface FormGroupOpts {
  legend: string;
  fields: string; // pre-rendered HTML string from other partials
  required?: boolean;
}
```

```typescript
formGroup({
  legend: 'Billing address',
  required: true,
  fields: [
    formInput({ id: 'street', label: 'Street' }),
    formInput({ id: 'city', label: 'City' }),
    formInput({ id: 'postcode', label: 'Postcode' }),
  ].join(''),
});
// →
// <fieldset class="form-group">
//   <legend>Billing address<span aria-hidden="true" class="required-mark">*</span></legend>
//   <div class="form-field">...</div>   ← street
//   <div class="form-field">...</div>   ← city
//   <div class="form-field">...</div>   ← postcode
// </fieldset>
```

---

### Form partial design rules (Claude Design must follow)

1. **Never write raw `<input>` in generated surfaces.** Always use `formInput()`,
   `textarea()`, `formSelect()`, `checkbox()`, or `radioGroup()`. The partial
   guarantees the aria chain — doing it by hand introduces drift.

2. **Error state is set at build time, not client-side.** Pass `error:` to the
   partial when the server knows the field is invalid (e.g., re-render after failed
   POST). For client-side validation, inject the `.input-error` class and set
   `aria-invalid="true"` on the existing input — do not re-render the partial.

3. **Do not override `.form-field` margin with inline styles.** Spacing between
   fields uses the 16px bottom margin on `.form-field`. Overriding it with an
   inline `style` attribute bypasses the token system.

4. **Required mark is visual-only.** The `*` is `aria-hidden="true"`. Screen
   readers learn a field is required from the HTML `required` attribute (which the
   partial sets when `required: true`). Never rely on the mark alone.

5. **One error container per field.** The `{id}-error` div emitted by the partial
   is the single source of truth for that field's error. Do not add a second error
   message above or below it.

---

## 4. Utilities

### `esc(str)` / `escUrl(str)`

HTML-escape user strings before embedding in templates.

```typescript
import { esc, escUrl } from '@ocr/ui';

const safe = `<h1>${esc(userInput)}</h1>`;
const link = `<a href="${escUrl(userHref)}">Click</a>`;
```

### `contrastRatio(fg, bg)`

WCAG 2.1 contrast ratio check.

```typescript
import { contrastRatio } from '@ocr/ui';

contrastRatio('#1785FB', '#0F1824'); // → 5.1 (AA for large text)
```

### `ocrStylesheet` / `serveCss()` / `styleTag()`

```typescript
import { ocrStylesheet, serveCss, styleTag } from '@ocr/ui';

// Serve from a worker route:
router.get('/ui.css', () => serveCss()); // sets Content-Type, cache-control

// Inline in a <style> block:
const css = styleTag(); // → <style>...</style>

// Raw string (includes all 4 blocks + components + a11y):
const raw = ocrStylesheet;
```

`ocrStylesheet` is a pre-built string (not a function call) containing: primitives `:root`, dark semantic `:root`, `@media prefers-color-scheme: light`, `[data-theme="light"]`, `[data-theme="dark"]`, component vocabulary, `:focus-visible` rules, and `prefers-reduced-motion` block.

### `checkTemplate(html)` / `checkAll(htmlMap)`

Drift guard — verifies a rendered HTML string uses token vars rather than hardcoded primitives.

```typescript
import { checkTemplate, checkAll } from '@ocr/ui';

const findings = checkTemplate(myHtml);
// findings: DriftFinding[] — { token, found, line }

// Batch check for CI:
const results = checkAll({ admin: adminHtml, report: reportHtml });
```

---

## 5. Integration Checklist for New Surfaces

When Claude Design generates a new surface or component, validate it meets:

### Structural

- [ ] Links `/ui.css` (or calls `styleTag()`) — never duplicates the stylesheet inline
- [ ] All colors reference `var(--*)` tokens — no hardcoded hex except `#fff`/`#000` on explicitly themed elements (e.g., avatar bg with dark text)
- [ ] `data-testid` on every interactive element and every data region
- [ ] `<main>`, `<header>` or `<nav>` landmarks present — screen reader skip-navigation
- [ ] One `<h1>` per page — heading levels do not skip (h1 → h3 without h2 is a failure)
- [ ] All `<img>` elements have `alt` attribute (empty string is acceptable for decorative images)
- [ ] User input passed through `esc()` before embedding in HTML strings

### Accessibility

- [ ] Touch targets ≥ 48px (use `.btn` or `min-height: var(--tap-min)`)
- [ ] Keyboard focus rings visible — `:focus-visible` inherits from component classes (no extra work needed)
- [ ] Reduced-motion tested — `prefers-reduced-motion: reduce` disables all animations (covered globally)
- [ ] Viewport meta does not set `user-scalable=no` or `maximum-scale=1` — blocks pinch-zoom (WCAG 1.4.4)

### Forms (if the surface has any inputs)

- [ ] Use `formInput()`, `textarea()`, `formSelect()`, `checkbox()`, `radioGroup()`, or `formGroup()` partials — never raw `<input>` elements
- [ ] Error containers carry `role="alert"` and are present in the DOM before interaction (even if empty) — screen readers announce errors without page reload
- [ ] Required fields have HTML `required` attribute (set by partials automatically) — do NOT rely on the `*` visual mark alone
- [ ] Input font-size ≥ 16px — prevents iOS Safari auto-zoom on focus
- [ ] Submit button stays above the on-screen keyboard fold (~280px from viewport bottom) — test on iPhone SE

### Theming

- [ ] Light mode tested via `[data-theme="light"]` attribute on `<html>`
- [ ] Dark mode tested via `[data-theme="dark"]` attribute on `<html>`
- [ ] Brand override tested via `[data-brand="X"]` attribute on `<html>`
- [ ] New component classes reference only Tier 2 tokens (no `--ocr-*` primitives)

### CI gates

- [ ] Empty states use `emptyState()` partial — never bare "no data" text
- [ ] Run `checkTemplate()` in tests to catch drift before merge
- [ ] `node scripts/check-ui-drift.mjs` passes green — no `local-root-tokens` or `missing-shared-stylesheet` violations
