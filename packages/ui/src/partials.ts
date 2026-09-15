/**
 * @ocr/ui — Shared HTML partials
 *
 * Small functions that return HTML strings — the same shape both workers
 * already produce, so adoption is drop-in. All user-supplied text is escaped.
 * The headline addition is emptyState()/accessDenied(): every gate now shows
 * a title, a reason, and a next step instead of a bare refusal.
 */
import { esc, escUrl } from './esc';

export interface NavItem {
  href: string;
  label: string;
  /** Inline SVG string, or a single emoji/character. */
  icon: string;
  active?: boolean;
}

/** Sticky top header with title and optional live badge. */
export function header(opts: { title: string; live?: boolean }): string {
  const badge =
    opts.live === undefined
      ? ''
      : `<span class="live-indicator ${opts.live ? 'on' : 'off'}">${opts.live ? 'Live' : 'Offline'}</span>`;
  return `<header class="header"><h1>${esc(opts.title)}</h1>${badge}</header>`;
}

/** Fixed bottom navigation. */
export function bottomNav(items: NavItem[]): string {
  const links = items.map(
    (i) =>
      `<a class="nav-item${i.active ? ' active' : ''}" href="${escUrl(i.href)}">${i.icon}<span>${esc(i.label)}</span></a>`
  );
  return `<nav class="bottom-nav">${links.join('')}</nav>`;
}

export interface ButtonOpts {
  label: string;
  href?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  block?: boolean;
  disabled?: boolean;
  onclick?: string;
}

export function button(o: ButtonOpts): string {
  const cls = `btn btn-${o.variant ?? 'primary'}${o.block ? ' btn-block' : ''}`;
  if (o.href) {
    return `<a class="${cls}" href="${escUrl(o.href)}">${esc(o.label)}</a>`;
  }
  const dis = o.disabled ? ' disabled' : '';
  const click = o.onclick ? ` onclick="${esc(o.onclick)}"` : '';
  return `<button class="${cls}"${dis}${click}>${esc(o.label)}</button>`;
}

export function card(inner: { title?: string; sub?: string; body?: string }): string {
  const title = inner.title ? `<div class="item-name">${esc(inner.title)}</div>` : '';
  const sub = inner.sub ? `<div class="item-sub">${esc(inner.sub)}</div>` : '';
  const body = inner.body ?? '';
  return `<div class="card">${title}${sub}${body}</div>`;
}

export function loading(label = 'Loading…'): string {
  return `<div class="loading"><div class="spinner"></div><div class="item-sub">${esc(label)}</div></div>`;
}

export interface EmptyStateOpts {
  icon?: string;
  title: string;
  message: string;
  action?: { label: string; href: string };
}

/**
 * The missing component. Any "nothing here yet" or "you can't see this"
 * screen renders through this so it always offers a way forward.
 */
export function emptyState(o: EmptyStateOpts): string {
  const icon = o.icon ? `<div class="es-icon">${o.icon}</div>` : '';
  const action = o.action
    ? button({ label: o.action.label, href: o.action.href, variant: 'primary' })
    : '';
  return `<div class="empty-state">${icon}<h3>${esc(o.title)}</h3><p>${esc(o.message)}</p>${action}</div>`;
}

export interface FooterLink {
  href: string;
  label: string;
  /**
   * Optional stable id for this link. Without one the link is addressable only
   * by position, and position is exactly what changes when a legal page is
   * added — which is how `[data-testid="landing-footer"] a` came to depend on
   * the landing footer having precisely one link.
   */
  testid?: string;
}

export interface FooterOpts {
  /**
   * Surface name — prefixes the test-ids (`landing` → `landing-footer`).
   * Existing surfaces already emit `landing-footer` / `public-footer` /
   * `signin-footer`, and E2E specs address them, so the prefix is how this
   * partial adopts a surface WITHOUT breaking its contract.
   */
  surface: string;
  /** Links, rendered in order. The first one is the most reachable — order it deliberately. */
  links: FooterLink[];
  /** Defaults to the current year. Injectable so a snapshot test is not time-dependent. */
  year?: number;
  /** Product name in the copyright line. */
  product?: string;
  /**
   * Render the standing product subtitle — "Never who, only how many."
   * (OSE-1230). Off by default: the footer is legal furniture, and the promise
   * belongs where a reader meets the product, not on every page twice.
   */
  subtitle?: boolean;
  /**
   * Render the privacy STATEMENT block above the legal line (OSE-1327): the
   * "Anonymous or plant your flag." headline + the never-who statement. The
   * legal line — © + links, including the "How this works →" deeper-dive link —
   * stays: one combined footer. Off by default and dropped in `@media print`, so
   * the poster / print footer stays compact.
   */
  statement?: boolean;
}

/**
 * Site footer — the legal surface.
 *
 * WHY THIS IS A PARTIAL AND NOT MARKUP IN SEVEN TEMPLATES
 *   Measured 2026-09-05: three of the seven templates carried a footer, they
 *   had diverged (only `admin-signin` linked Privacy at all), and two surfaces
 *   that need one — `admin`, `shared-report` — had none. Legal text that
 *   differs per page is not a legal surface; it is four independent drafts.
 *
 * LINKS ARE DATA, NOT CODE
 *   `/terms`, `/legal` and `/accessibility` do not exist yet — verified against
 *   `src/router.ts`, which routes `/privacy` and `/privacy-policy` and nothing
 *   else. When they ship, they are added to the link array. No surface changes,
 *   no partial changes, no new markup.
 *
 * Every field is escaped; `escUrl` gates the hrefs.
 */
export function footer(o: FooterOpts): string {
  const surface = o.surface;
  const year = o.year ?? new Date().getUTCFullYear();
  const product = o.product ?? 'OurSharedEvents';

  const links = o.links
    .map((l) => {
      const id = l.testid ? ` data-testid="${esc(l.testid)}"` : '';
      return `<a href="${escUrl(l.href)}"${id}>${esc(l.label)}</a>`;
    })
    .join('<span class="ocr-footer-sep" aria-hidden="true"> · </span>');

  const sub = o.subtitle
    ? `<p class="ocr-footer-sub" data-testid="${esc(surface)}-footer-subtitle">Never who, only how many.</p>`
    : '';

  // OSE-1327 — combined footer: the privacy statement sits ABOVE the retained
  // legal line (© + links, incl. the "How this works →" deeper-dive link). Off by
  // default; dropped in @media print so the poster/print footer stays compact.
  const statement = o.statement
    ? `<div class="ocr-footer-statement" data-testid="${esc(surface)}-footer-statement">` +
      `<p class="ocr-footer-flag">Anonymous or plant your flag.</p>` +
      `<p class="ocr-footer-say">We measure that people came, when, and roughly where. We never collect who. If you want your name on something, that's your choice to make, each time.</p>` +
      `</div>`
    : '';

  return (
    `<footer class="ocr-footer" data-testid="${esc(surface)}-footer">` +
    statement +
    `<p class="ocr-footer-legal" data-testid="${esc(surface)}-footer-copyright">` +
    `© ${esc(String(year))} ${esc(product)}` +
    (links ? `<span class="ocr-footer-sep" aria-hidden="true"> · </span>${links}` : '') +
    `</p>${sub}</footer>`
  );
}

/**
 * Access-denied built on emptyState — replaces the bare "access denied".
 * Defaults give a non-DJ visitor an on-ramp instead of a wall.
 */
export function accessDenied(o?: {
  what?: string;
  action?: { label: string; href: string };
}): string {
  return emptyState({
    icon: '🎧',
    title: o?.what ? `${o.what} is DJ-only` : 'This area is for DJs',
    message: 'Want in? Connect your account to start building sets and get on the air.',
    action: o?.action ?? { label: 'Get started', href: '/connect' },
  });
}

export interface PageOpts {
  title: string;
  body: string;
  /** Path to the shared stylesheet route, default /ui.css */
  cssHref?: string;
  live?: boolean;
  nav?: NavItem[];
}

// ─── Form partials ────────────────────────────────────────────────────────────

export interface FormInputOpts {
  id: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search' | 'date';
  placeholder?: string;
  value?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  error?: string;
}

/** Label + input + optional hint/error — fully accessible with aria wiring. */
export function formInput(o: FormInputOpts): string {
  const type = o.type ?? 'text';
  const hintId = `${o.id}-hint`;
  const errorId = `${o.id}-error`;
  const describedBy = o.error ? errorId : o.hint ? hintId : null;
  const aria = [
    describedBy ? `aria-describedby="${describedBy}"` : '',
    o.error ? 'aria-invalid="true"' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const requiredMark = o.required ? `<span aria-hidden="true" class="required-mark">*</span>` : '';
  const inputCls = `input${o.error ? ' input-error' : ''}`;
  const hintHtml =
    o.hint && !o.error ? `<div id="${hintId}" class="form-hint">${esc(o.hint)}</div>` : '';
  const errorHtml = o.error
    ? `<div id="${errorId}" class="form-error" role="alert">${esc(o.error)}</div>`
    : '';
  return `<div class="form-field">
  <label for="${o.id}">${esc(o.label)}${requiredMark}</label>
  <input id="${o.id}" name="${o.id}" type="${type}" class="${inputCls}"${o.value !== undefined ? ` value="${esc(o.value)}"` : ''}${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ''}${o.required ? ' required' : ''}${o.disabled ? ' disabled' : ''}${aria ? ' ' + aria : ''} />
  ${hintHtml}${errorHtml}
</div>`;
}

export interface TextareaOpts {
  id: string;
  label: string;
  placeholder?: string;
  value?: string;
  rows?: number;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  error?: string;
}

/** Label + textarea + optional hint/error. */
export function textarea(o: TextareaOpts): string {
  const hintId = `${o.id}-hint`;
  const errorId = `${o.id}-error`;
  const describedBy = o.error ? errorId : o.hint ? hintId : null;
  const aria = [
    describedBy ? `aria-describedby="${describedBy}"` : '',
    o.error ? 'aria-invalid="true"' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const requiredMark = o.required ? `<span aria-hidden="true" class="required-mark">*</span>` : '';
  const cls = `input${o.error ? ' input-error' : ''}`;
  const hintHtml =
    o.hint && !o.error ? `<div id="${hintId}" class="form-hint">${esc(o.hint)}</div>` : '';
  const errorHtml = o.error
    ? `<div id="${errorId}" class="form-error" role="alert">${esc(o.error)}</div>`
    : '';
  return `<div class="form-field">
  <label for="${o.id}">${esc(o.label)}${requiredMark}</label>
  <textarea id="${o.id}" name="${o.id}" class="${cls}" rows="${o.rows ?? 4}"${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ''}${o.required ? ' required' : ''}${o.disabled ? ' disabled' : ''}${aria ? ' ' + aria : ''}>${esc(o.value ?? '')}</textarea>
  ${hintHtml}${errorHtml}
</div>`;
}

export interface FormSelectOpts {
  id: string;
  label: string;
  options: Array<{ value: string; label: string; selected?: boolean }>;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  error?: string;
}

/** Label + select + optional hint/error. */
export function formSelect(o: FormSelectOpts): string {
  const hintId = `${o.id}-hint`;
  const errorId = `${o.id}-error`;
  const describedBy = o.error ? errorId : o.hint ? hintId : null;
  const aria = [
    describedBy ? `aria-describedby="${describedBy}"` : '',
    o.error ? 'aria-invalid="true"' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const requiredMark = o.required ? `<span aria-hidden="true" class="required-mark">*</span>` : '';
  const cls = `sort-select${o.error ? ' input-error' : ''}`;
  const opts = o.options
    .map(
      (opt) =>
        `<option value="${esc(opt.value)}"${opt.selected ? ' selected' : ''}>${esc(opt.label)}</option>`
    )
    .join('');
  const hintHtml =
    o.hint && !o.error ? `<div id="${hintId}" class="form-hint">${esc(o.hint)}</div>` : '';
  const errorHtml = o.error
    ? `<div id="${errorId}" class="form-error" role="alert">${esc(o.error)}</div>`
    : '';
  return `<div class="form-field">
  <label for="${o.id}">${esc(o.label)}${requiredMark}</label>
  <select id="${o.id}" name="${o.id}" class="${cls}"${o.required ? ' required' : ''}${o.disabled ? ' disabled' : ''}${aria ? ' ' + aria : ''}>${opts}</select>
  ${hintHtml}${errorHtml}
</div>`;
}

export interface CheckboxOpts {
  id: string;
  label: string;
  name?: string;
  value?: string;
  checked?: boolean;
  required?: boolean;
  disabled?: boolean;
}

/** Single accessible checkbox with label. */
export function checkbox(o: CheckboxOpts): string {
  return `<label class="checkbox-label">
  <input type="checkbox" id="${o.id}" name="${o.name ?? o.id}" value="${esc(o.value ?? 'on')}"${o.checked ? ' checked' : ''}${o.required ? ' required' : ''}${o.disabled ? ' disabled' : ''} />
  ${esc(o.label)}
</label>`;
}

export interface RadioGroupOpts {
  name: string;
  legend: string;
  options: Array<{ value: string; label: string; checked?: boolean; disabled?: boolean }>;
  required?: boolean;
  error?: string;
}

/** Accessible radio group inside a fieldset. */
export function radioGroup(o: RadioGroupOpts): string {
  const radios = o.options
    .map(
      (opt) =>
        `<label class="radio-option"><input type="radio" name="${o.name}" value="${esc(opt.value)}"${opt.checked ? ' checked' : ''}${o.required ? ' required' : ''}${opt.disabled ? ' disabled' : ''} />${esc(opt.label)}</label>`
    )
    .join('\n  ');
  const errorHtml = o.error
    ? `<div class="radio-group-error" role="alert">${esc(o.error)}</div>`
    : '';
  return `<fieldset class="form-group">
  <legend>${esc(o.legend)}</legend>
  ${radios}
  ${errorHtml}
</fieldset>`;
}

export interface FormGroupOpts {
  legend: string;
  fields: string;
  required?: boolean;
}

/** Fieldset wrapper for grouping related fields. */
export function formGroup(o: FormGroupOpts): string {
  const requiredMark = o.required ? `<span aria-hidden="true" class="required-mark">*</span>` : '';
  return `<fieldset class="form-group">
  <legend>${esc(o.legend)}${requiredMark}</legend>
  ${o.fields}
</fieldset>`;
}

// ─── Page shell ───────────────────────────────────────────────────────────────

/** Full HTML document shell wiring in the shared stylesheet exactly once. */
export function page(o: PageOpts): string {
  const nav = o.nav ? bottomNav(o.nav) : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(o.title)}</title>
<link rel="stylesheet" href="${escUrl(o.cssHref ?? '/ui.css')}">
</head>
<body>
${header({ title: o.title, live: o.live })}
<main class="content">${o.body}</main>
${nav}
</body>
</html>`;
}
