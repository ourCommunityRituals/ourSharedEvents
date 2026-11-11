/**
 * Form page handler — serves mobile-first HTML form pages.
 *
 * Sr Design FE: 10-second comprehension test — customer sees event name,
 * one clear action, and completes the form in under 10 seconds.
 *
 * Each event's forms live under its own address (OSE-1684), and that is what
 * the platform writes (eventFormPath, lib/canonical.ts):
 *   GET /events/:eventId/register | checkin | survey | updates (email signup)
 *
 * The older /forms/ address keeps answering for printed and saved links;
 * there the ?type= param selects the form:
 *   GET /forms/:eventId                → registration (default)
 *   GET /forms/:eventId?type=register  → registration
 *   GET /forms/:eventId?type=checkin   → check-in
 *   GET /forms/:eventId?type=survey    → survey
 *   GET /forms/:eventId?type=email        → email signup
 *   GET /forms/:eventId?type=email-signup → email signup
 *
 * Lead FE: Forms post to /api/v2/events/:id/forms/:type via fetch().
 * No page reload. Success state shown inline.
 *
 * Sr Design FE: All interactive elements have data-testid attributes
 * for stable Playwright automation. These IDs survive CSS/layout changes.
 */

import {
  isStaleForPublicLanding,
  staleEventForward,
  STALE_FORWARD_PATH,
} from '../lib/event-staleness';
import { HARDENING_HEADERS } from '../lib/security-headers';
import { escapeHtml, jsonForScript } from '../lib/html-escape';
import { isValidDeploymentId, isValidEventId, repairEventIdTypo } from '../lib/form-validation';
import { fetchNextEventsAtVenue, type NextEventRow } from '../lib/next-at-venue';
import { buildGoogleCalendarUrl } from '../lib/calendar-links';
import { formatHumanDate } from '../lib/event-datetime';
import { BACK_BUTTON_CSS, renderBackButton } from '../lib/back-button';
import {
  canonicalOrigin,
  eventFormPath,
  eventPagePath,
  EVENT_FORM_SCREENS,
  type EventFormScreen,
} from '../lib/canonical';
import { fmt, msg, type MessageKey } from '../lib/i18n/catalog';
import { isolateTyped } from '../lib/i18n/bidi';
import { DEFAULT_LANG, DIRECTION, type Lang } from '../lib/i18n/languages';
import { LANGUAGE_MENU_CSS, renderLanguageMenu } from '../lib/i18n/language-menu';
import { withLangPrefix } from '../lib/i18n/path-prefix';
import { resolveLanguage } from '../lib/i18n/resolve-language';
import {
  turnstileScriptTag,
  turnstileWidgetHtml,
  turnstileClientEnabled,
  TURNSTILE_HOST,
} from '../lib/turnstile';

export interface FormPagesEnv {
  // OSE-R-007 (2026-05-15): event title must come from the canonical
  // event row in D1, not from the URL query param. Optional so the
  // handler stays compatible with test environments that don't bind DB.
  DB?: D1Database;
  WORKER_ENV?: string;
  // L4 (OSE-1378) Slice 2: Turnstile client widget — dark unless BOTH are set.
  TURNSTILE_ENABLED?: string;
  TURNSTILE_SITE_KEY?: string;
}

// ── Security headers (SEC-2 / OSE-638 DESIGN-SEC-1) ─────────────────────────

function generateNonce(): string {
  const buf = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...buf));
}

// OSE-638: nonce replaces 'unsafe-inline' in script-src.
// style-src keeps 'unsafe-inline' (nonce for CSS requires moving ALL inline
// styles — tracked as a follow-on story). base-uri and frame-ancestors
// are not directives accepted by all browsers but are included for defence depth.
function buildSecurityHeaders(nonce: string, env?: FormPagesEnv): Record<string, string> {
  // L4 (OSE-1378) Slice 2: when the widget renders, allow the Turnstile host in
  // script-src (the api.js loader) and add frame-src (the challenge iframe).
  const tsOn = env ? turnstileClientEnabled(env) : false;
  const scriptExtra = tsOn ? ` ${TURNSTILE_HOST}` : '';
  const frameSrc = tsOn ? ` frame-src ${TURNSTILE_HOST};` : '';
  return {
    ...HARDENING_HEADERS,
    'Content-Security-Policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}'${scriptExtra}; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none';${frameSrc} base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

// ── GDPR Art. 13 privacy notice (BE-9 / BE-10) ───────────────────────────────

/**
 * The one line under each form: what that form keeps, and for how long. Each
 * line matches the retention in the details below it (owner 2026-10-11).
 *
 * OSE-1850: these lines are privacy text, so they stay in English until a human
 * translation and a legal read. The check-in line is the one exception: it is
 * the same promise the event page's check-in choice already makes in every
 * language (`choices.checkinNote`), so the reader who tapped it reads it again
 * here in the same words.
 */
function privacySummary(formType: string): string {
  switch (formType) {
    case 'survey':
      return 'Comments are cleaned of personal details within 24 hours.';
    case 'email':
    case 'email-signup':
      return 'Your email is deleted after 30 days.';
    default:
      return 'Your name and email are cleared the day after the event.';
  }
}

function privacyNotice(formType: string, legalTier = 1, lang: Lang = DEFAULT_LANG): string {
  let purpose: string;
  let legalBasis: string;
  let retention: string;

  switch (formType) {
    case 'checkin':
      purpose = 'We record an <strong>anonymous count only</strong> — no personal data is stored.';
      legalBasis = 'GDPR Art. 6(1)(f) — legitimate interest in knowing attendance numbers.';
      retention = 'Anonymous aggregate counts are kept for event reporting only.';
      break;
    case 'survey':
      purpose = 'We collect your ratings and optional comments to improve future events.';
      legalBasis = 'GDPR Art. 6(1)(a) — your <strong>consent</strong>.';
      retention =
        'Comments are scrubbed of personal information within <strong>24</strong> hours. Aggregate ratings are kept indefinitely.';
      break;
    case 'email':
    case 'email-signup':
      purpose = 'We collect your email address to notify you about future community events.';
      legalBasis =
        'GDPR Art. 6(1)(a) — your <strong>consent</strong>. You can <strong>withdraw consent</strong> at any time.';
      retention =
        'Your email is encrypted at rest and automatically deleted after <strong>30</strong> days.';
      break;
    default: // register
      // Owner 2026-10-11: the email is optional and only lets the organizer
      // reach you about this event (a new date, a cancellation).
      purpose =
        'We collect your name and, if you choose, your email, so the organizer can reach you if this event changes.';
      legalBasis = 'GDPR Art. 6(1)(a) — your <strong>consent</strong>.';
      retention =
        'Your name and email are encrypted, and <strong>cleared the day after the event</strong>. The rest of the registration is deleted after 90 days.';
  }

  let addenda = '';
  if (legalTier >= 2) {
    addenda += `<br/><strong>Commerce notice:</strong> Payment data is handled by our PCI DSS-compliant processor and never stored by us. `;
  }
  // Tiers 4 and 5 (HIPAA, COPPA) are declined regimes (ADR-018): no notice may
  // promise their safeguards. The tier is capped at 3, so these never render.

  // OSE-1850: on a page not in English, the legal text below keeps its English
  // and says so (`lang="en"`, so a screen reader reads it as English), and a
  // plain note in the page's language explains why. No machine translation.
  const translated = lang !== DEFAULT_LANG;
  const en = translated ? ' lang="en"' : '';
  const summary =
    formType === 'checkin'
      ? `<p class="privacy-summary" data-testid="privacy-summary">${msg(lang, 'choices.checkinNote')}</p>`
      : `<p class="privacy-summary" data-testid="privacy-summary"${en}>${privacySummary(formType)}</p>`;
  const note = translated
    ? `\n    <p class="privacy-lang-note" data-testid="privacy-english-note">${msg(lang, 'form.privacy.englishNote')}</p>`
    : '';

  return `<div class="privacy-notice" data-testid="privacy-notice">
    ${summary}${note}
    <details class="privacy-details" data-testid="privacy-details">
      <summary>${msg(lang, 'form.privacy.details')}</summary>
      <p${en}>
        ${purpose} Legal basis: ${legalBasis} ${retention}
        You have the right to access, correct, or erase your data, and to lodge a complaint with your local data protection
        <strong>supervisory authority</strong>.
        ${addenda}
        <a href="/privacy" data-testid="privacy-policy-link">Full privacy policy</a>
      </p>
    </details>
  </div>`;
}

// ── Shared CSS: mobile-first, system fonts, 10-second comprehension ──────────

// Colours come from @ocr/ui tokens (/ui.css is linked ahead of this block), so
// the forms follow the viewer's light/dark theme like every other surface.
// No literal colour belongs here — tests/forms-error-privacy-theming.spec.ts.
const FORM_CSS = `
  body { line-height: 1.4; }
  header { background: var(--surface); color: var(--text); border-bottom: 1px solid var(--border); padding: 1rem 1.5rem; text-align: center; }
  header h1 { overflow-wrap: anywhere; font-size: 1.1rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; }
  header .event-name { font-size: 1.4rem; font-weight: 700; margin-top: .25rem; overflow-wrap: anywhere; }
  main { max-width: 480px; margin: 0 auto; padding: 1.5rem 1rem; }
  .form-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; }
  .form-card h2 { font-size: 1.15rem; font-weight: 600; margin-bottom: 1rem; color: var(--text); }
  .form-intro { color: var(--text-muted); font-size: .9rem; margin-bottom: 1rem; }
  .field-note { color: var(--text-muted); font-size: .85rem; margin: -.25rem 0 .4rem; }
  label { display: block; font-size: .85rem; font-weight: 500; color: var(--text); margin-bottom: .25rem; }
  /* Walkthrough 2026-09-03: inputs measured 42px at 390px — under the 44px floor
     (OCR_STANDARD_mobileWorkability #2). min-height holds the floor regardless of font metrics.
     16px text stops iOS zooming on focus; the edge is --border-strong (WCAG 1.4.11). */
  input, textarea, select { width: 100%; min-height: 44px; padding: .65rem .75rem; background: var(--surface); color: var(--text); border: 1.5px solid var(--border-strong); border-radius: 8px; font-size: 16px; margin-bottom: .75rem; font-family: inherit; }
  input::placeholder, textarea::placeholder { color: var(--text-muted); }
  input:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 0; border-color: var(--accent); }
  textarea { resize: vertical; min-height: 80px; }
  /* OSE-292 (2026-05-16): min-height 44px on every button to meet
     WCAG 2.5.5 + Apple HIG touch-target floor. */
  button { width: 100%; padding: .75rem; min-height: 44px; background: var(--accent); color: var(--on-accent); border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: .5rem; font-family: inherit; }
  button:active { background: var(--accent-hover); }
  button:disabled { background: var(--border); color: var(--text-muted); cursor: not-allowed; }
  .success { text-align: center; padding: 2rem 1rem; }
  .success .icon { font-size: 3rem; margin-bottom: .5rem; }
  .success h2 { color: var(--success); font-size: 1.2rem; }
  .success p { color: var(--text-muted); font-size: .9rem; margin-top: .5rem; }
  .error-msg { color: var(--error); font-size: .85rem; margin-bottom: .5rem; display: none; }
  .privacy-notice { font-size: .85rem; color: var(--text-muted); margin-top: .75rem; line-height: 1.5; }
  .privacy-summary { margin-bottom: .25rem; color: var(--text); font-weight: 600; }
  .privacy-details summary { min-height: 44px; display: inline-flex; align-items: center; color: var(--accent); cursor: pointer; font-weight: 600; }
  .privacy-details p { margin-top: .25rem; }
  /* OSE-292: privacy-policy link must be a real tap target on phones —
     inline-block + padding gives a 44px+ touch area without breaking
     the inline text flow visually. */
  .privacy-notice a { color: var(--accent); display: inline-block; min-height: 44px; padding: .5rem .25rem; line-height: 1.4; }
  .skip-link { position: absolute; left: -9999px; top: auto; width: 1px; height: 1px; overflow: hidden; }
  .skip-link:focus { position: fixed; top: 0; left: 0; width: auto; height: auto; padding: .5rem 1rem; background: var(--surface); color: var(--text); font-size: 1rem; z-index: 9999; text-decoration: none; border-bottom: 2px solid var(--accent); }
  summary:focus-visible, a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .rating-row { display: flex; gap: .5rem; margin-bottom: .75rem; }
  /* OSE-292: 44px floor for survey rating tap targets. The unselected edge is
     --border-strong so each button is findable against the card (WCAG 1.4.11). */
  .rating-row button { width: auto; flex: 1; padding: .5rem; min-height: 44px; font-size: 1.1rem; background: var(--surface); color: var(--text); border: 2px solid var(--border-strong); }
  .rating-row button.selected { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  .checkin-tap { text-align: center; padding: 3rem 1rem; }
  .checkin-tap button { font-size: 1.5rem; padding: 1.5rem; border-radius: 50%; width: 180px; height: 180px; margin: 1rem auto; display: block; -webkit-tap-highlight-color: transparent; touch-action: manipulation; transition: transform 0.1s, opacity 0.1s; user-select: none; }
  .walk-in-row { color: var(--text-muted); font-size: .9rem; }
  .checkin-tap .walk-in-btn { width: auto; height: auto; min-height: 44px; margin: .5rem auto 0; padding: .6rem 1.1rem; border-radius: 8px; font-size: 1rem; background: var(--surface); color: var(--text); border: 1.5px solid var(--border-strong); }
  .checkin-tap .count { font-size: 2rem; font-weight: 700; color: var(--text); margin-top: 1rem; }
  /* OSE-222: sponsor logo strip in form header. Renders hidden by
     default; gets .has-sponsors class via JS only if sponsor-bundle
     for this event returns mobileBanner sponsors. Non-critical
     load — silently no-ops on fetch failure. */
  .form-sponsor-strip { display: none; padding: 0.5rem 1rem; background: var(--surface); border-bottom: 1px solid var(--border); }
  .form-sponsor-strip.has-sponsors { display: flex; align-items: center; justify-content: center; gap: 0.75rem; flex-wrap: wrap; }
  .form-sponsor-strip .strip-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; }
  .form-sponsor-strip .sponsor-item { display: inline-flex; align-items: center; gap: 0.35rem; }
  .form-sponsor-strip img { height: 24px; width: auto; max-width: 80px; object-fit: contain; }
  .form-sponsor-strip .sponsor-name { font-size: 0.8rem; color: var(--text); }
  /* OSE-223: sponsor acknowledgment on form success state. Renders
     inside .success block below the "you can close this page" line.
     Uses the same fetched sponsor bundle (cached on page load by
     the strip loader) — no second fetch. */
  .form-sponsor-thanks { margin-top: 1.25rem; padding: 1rem; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; text-align: center; }
  .form-sponsor-thanks .thanks-label { display: block; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; margin-bottom: 0.5rem; }
  .form-sponsor-thanks .sponsor-row { display: inline-flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; justify-content: center; }
  .form-sponsor-thanks .sponsor-item { display: inline-flex; align-items: center; gap: 0.4rem; }
  .form-sponsor-thanks img { height: 32px; width: auto; max-width: 120px; object-fit: contain; }
  .form-sponsor-thanks .sponsor-name { font-size: 0.85rem; color: var(--text); font-weight: 500; }
  /* F5.3: the next step under a confirmation (register: calendar, event page,
     check-in line; email signup: next at this venue). 44px rows, tokens only. */
  .next-step { margin-top: 1.25rem; text-align: left; }
  .next-step h3 { font-size: .85rem; font-weight: 600; color: var(--text-muted); }
  .next-step ul { list-style: none; margin: 0; padding: 0; }
  .next-step-link { display: flex; justify-content: space-between; align-items: center; gap: .75rem; min-height: 44px; padding: .4rem 0; color: var(--accent); font-weight: 600; text-decoration: none; border-bottom: 1px solid var(--border); }
  .next-step-when { font-size: .8rem; font-weight: 400; color: var(--text-muted); white-space: nowrap; }
  /* OSE-1850 / OSE-1943: the Language menu at the start of the header (the left
     in a left-to-right page, the right in Arabic), and the note that the privacy
     text is in English. Logical properties only. */
  .form-topbar { display: flex; justify-content: flex-start; text-align: start; margin: 0 0 .5rem; }
  .privacy-lang-note { margin-bottom: .25rem; }
`;

// ── Form JS: shared submit logic ─────────────────────────────────────────────
//
// OSE-R-002 (2026-05-15) — error rendering must show friendly user copy, never
// raw server codes. Before the fix, `errEl.textContent = err.message` piped
// strings like "INVALID_BODY", "Request body must be valid JSON under 16KB",
// or "FORMS_ENCRYPTION_KEY not configured" directly to bar customers in
// noisy venues. The audit (REFINEMENT-BACKLOG-2026-05-15.md R-002) flagged
// this as a ship-stopper.
//
// Contract:
//   • Map known server `code` values to bar-customer-friendly copy.
//   • Unknown codes → generic fallback. Never expose raw server strings.
//   • Preserve the raw code in a `data-error-code` attribute so QA / support
//     can still see what actually happened via DevTools.
//   • Status-code fallback (429 rate limit, 4xx, 5xx) for codes that aren't
//     mapped.

/** A catalog message as a script string literal (quoted, `<` escaped). */
function js(lang: Lang, key: MessageKey): string {
  return jsonForScript(msg(lang, key));
}

// OSE-1850: the copy is the page's language. Keys stay unquoted (`CODE: "..."`),
// the shape tests/form-error-friendly-copy.spec.ts reads.
const formJsSubmit = (lang: Lang): string => `
  // FE-15: broken sponsor logos hide gracefully. Inline onerror= is CSP-blocked
  // (script-src 'nonce-…' does not cover inline event handlers), so sponsor <img>s
  // carry data-hide-on-error and this ONE capture-phase listener hides them. The
  // 'error' event does NOT bubble — capture phase is required for the dynamically
  // added imgs (success-state thanks + the sponsor strip in FORM_JS_SPONSOR).
  // Mirrors the public/display/poster surfaces.
  document.addEventListener('error', function (ev) {
    var el = ev.target;
    if (el && el.tagName === 'IMG' && el.hasAttribute('data-hide-on-error')) {
      // 0083: swap a failing sponsor logo to the OSE default; hide only if
      // the default itself fails.
      // Fixed same-origin fallback; never read back from the DOM.
      var d = '/sponsor-default-logo.svg';
      if (el.hasAttribute('data-default-src') && el.getAttribute('src') !== d) el.setAttribute('src', d);
      else el.style.display = 'none';
    }
  }, true);
  // OSE-R-002: code → friendly copy. Update both this map AND the standard
  // doc tests when a new server code is added.
  var FORM_ERROR_FRIENDLY_COPY = {
    INVALID_EVENT_ID: ${js(lang, 'form.error.invalidEventId')},
    INVALID_BODY: ${js(lang, 'form.error.invalidBody')},
    PAYLOAD_TOO_LARGE: ${js(lang, 'form.error.payloadTooLarge')},
    MISSING_FIELD: ${js(lang, 'form.error.missingField')},
    INVALID_EMAIL: ${js(lang, 'form.error.invalidEmail')},
    CONFIG_ERROR: ${js(lang, 'form.error.configError')},
    DB_ERROR: ${js(lang, 'form.error.busy')},
    METHOD_NOT_ALLOWED: ${js(lang, 'form.error.methodNotAllowed')}
  };

  function friendlyFormError(code, status) {
    if (code && Object.prototype.hasOwnProperty.call(FORM_ERROR_FRIENDLY_COPY, code)) return FORM_ERROR_FRIENDLY_COPY[code];
    if (status === 429) return ${js(lang, 'form.error.tooMany')};
    if (status === 503) return ${js(lang, 'form.error.busy')};
    if (status >= 500) return ${js(lang, 'form.error.server')};
    return ${js(lang, 'form.error.generic')};
  }

  async function submitForm(eventId, formType, data) {
    var errEl = document.getElementById('error-msg');
    var btn = document.querySelector('[data-testid$="-submit"]');
    if (errEl) {
      errEl.style.display = 'none';
      errEl.removeAttribute('data-error-code');
    }
    if (btn) btn.disabled = true;
    // FE-10: cap the request so a stalled network can't leave the button
    // disabled forever. On timeout the fetch rejects (AbortError) and the catch
    // below shows the friendly network error and re-enables the button.
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, 15000);
    try {
      // L4 (OSE-1378) Slice 2: attach the Turnstile token as a header when the
      // widget is present (window.turnstile exists only when the loader ran). The
      // server reads it via extractTurnstileToken (header fallback). Dark → no header.
      var _headers = { 'Content-Type': 'application/json' };
      var _tsToken = (window.turnstile && window.turnstile.getResponse) ? window.turnstile.getResponse() : '';
      if (_tsToken) _headers['cf-turnstile-response'] = _tsToken;
      var res = await fetch('/api/v2/events/' + eventId + '/forms/' + formType, {
        method: 'POST',
        headers: _headers,
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      var body;
      try {
        body = await res.json();
      } catch (parseErr) {
        // Non-JSON response — surface a generic friendly error, preserve
        // status for triage via data attribute.
        if (errEl) {
          errEl.textContent = friendlyFormError(null, res.status);
          errEl.setAttribute('data-error-code', 'NON_JSON_RESPONSE');
          errEl.style.display = 'block';
        }
        if (btn) btn.disabled = false;
        throw new Error('NON_JSON_RESPONSE');
      }
      if (!body.ok) {
        // Friendly UI, raw code preserved for support
        if (errEl) {
          errEl.textContent = friendlyFormError(body.code, res.status);
          errEl.setAttribute('data-error-code', body.code || 'UNKNOWN');
          errEl.style.display = 'block';
        }
        if (btn) btn.disabled = false;
        throw new Error(body.code || 'UNKNOWN');
      }
      return body;
    } catch (err) {
      // Network failure or thrown above. err.message holds the code OR a
      // network-level error. Render generic friendly copy if errEl wasn't
      // already populated by the parse/!body.ok branches.
      if (errEl && !errEl.textContent) {
        errEl.textContent = friendlyFormError(null, 0);
        errEl.setAttribute('data-error-code', 'NETWORK_ERROR');
        errEl.style.display = 'block';
      }
      if (btn) btn.disabled = false;
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  function showSuccess(msg) {
    // OSE-223: append sponsor-thanks block if sponsors were loaded for
    // this event. window.__formSponsorCache is populated by the
    // sponsor-strip loader on page init (see FORM_JS_SPONSOR). If the
    // cache is empty (no sponsors / fetch failed / suppressed), the
    // thanks block silently no-ops.
    var thanks = '';
    var cache = window.__formSponsorCache;
    if (cache && cache.length) {
      // OSE-R-015 (2026-05-15): escape every attribute value, set
      // referrerpolicy="no-referrer" so the sponsor host cannot fingerprint
      // the attendee, and mark data-hide-on-error (FE-15) so the capture-phase
      // listener hides broken images — inline onerror= is CSP-blocked.
      var escAttr = function(v) {
        return String(v || '').replace(/[<>&"']/g, function(c) {
          return { '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c];
        });
      };
      // OSE-1850: a sponsor name shows as typed; on a right-to-left page it is
      // isolated (<bdi>) so its own punctuation stays where it was typed.
      var rtl = document.documentElement.dir === 'rtl';
      var items = cache.slice(0, 3).map(function(s) {
        var name = escAttr(s.title || s.name);
        // 0083: no logo → the OSE default; a failing logo swaps to it too.
        var logo = '<img src="' + (s.logo_url && s.id ? '/api/v2/sponsors/' + encodeURIComponent(s.id) + '/logo' : '/sponsor-default-logo.svg') + '" alt="' + name + '" referrerpolicy="no-referrer" loading="lazy" data-hide-on-error="1" data-default-src="/sponsor-default-logo.svg" />';
        return '<span class="sponsor-item">' + logo + '<span class="sponsor-name">' + (rtl ? '<bdi>' + name + '</bdi>' : name) + '</span></span>';
      }).join('');
      thanks = '<div class="form-sponsor-thanks" data-testid="form-sponsor-thanks"><span class="thanks-label">' + ${js(lang, 'form.sponsorThanks')} + '</span><div class="sponsor-row">' + items + '</div></div>';
    }
    // F5.3: the next step the server put in the #form-next-step template
    // (outside #form-area, so the swap below keeps it) joins the confirmation
    // only now, after the submit succeeded. A clone of inert server markup.
    var next = document.getElementById('form-next-step');
    document.getElementById('form-area').innerHTML =
      '<div class="success" data-testid="form-success"><div class="icon">&#10003;</div><h2>' + msg + '</h2>' + thanks + '</div>';
    var done = document.querySelector('[data-testid="form-success"]');
    if (next && next.content && done) {
      done.insertBefore(next.content.cloneNode(true), done.querySelector('.form-sponsor-thanks'));
    }
  }
`;

// ── Sponsor strip + cache loader (OSE-222 + OSE-223) ─────────────────────────
//
// Single fetch per form-page page load. Caches the mobileBanner sponsor
// list on window.__formSponsorCache for showSuccess() to read on form
// submit. If sponsor-bundle is empty or the fetch fails, the strip stays
// hidden and the success-state thanks block silently no-ops.
//
// Why a separate const: keeps FORM_JS_SUBMIT focused on the submit
// contract; this is a non-critical brand-presence overlay that any
// individual form can include or skip without coupling.

const formJsSponsor = (eventId: string, lang: Lang): string => `
  (function loadFormSponsors(eventId) {
    window.__formSponsorCache = null;
    fetch('/api/v2/events/' + eventId + '/sponsor-bundle?surface=public')
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !data.ok || !data.bundle || !data.bundle.surface_sponsors) return;
        var banner = data.bundle.surface_sponsors.mobileBanner;
        if (!banner || !banner.length) return;
        window.__formSponsorCache = banner;
        var strip = document.getElementById('form-sponsor-strip');
        if (!strip) return;
        // OSE-R-015 (2026-05-15): see FORM_JS_SUBMIT counterpart above for
        // the same escape + referrerpolicy + data-hide-on-error contract.
        var escAttr = function(v) {
          return String(v || '').replace(/[<>&"']/g, function(c) {
            return { '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c];
          });
        };
        // OSE-1850: typed names isolated on a right-to-left page, as above.
        var rtl = document.documentElement.dir === 'rtl';
        var items = banner.slice(0, 3).map(function(s) {
          var name = escAttr(s.title || s.name);
          var logo = '<img src="' + (s.logo_url && s.id ? '/api/v2/sponsors/' + encodeURIComponent(s.id) + '/logo' : '/sponsor-default-logo.svg') + '" alt="' + name + '" referrerpolicy="no-referrer" loading="lazy" data-hide-on-error="1" data-default-src="/sponsor-default-logo.svg" />';
          return '<span class="sponsor-item">' + logo + '<span class="sponsor-name">' + (rtl ? '<bdi>' + name + '</bdi>' : name) + '</span></span>';
        }).join('');
        strip.innerHTML = '<span class="strip-label">' + ${js(lang, 'sponsors.supportedBy')} + '</span>' + items;
        strip.classList.add('has-sponsors');
        // OSE-1566: the strip owns its fallback. It does not lean on the capture
        // listener in the form script (a different script block), and it also
        // covers an image that already failed before any listener could see it.
        // Fixed same-origin default; never read back from the DOM.
        var dflt = '/sponsor-default-logo.svg';
        Array.prototype.forEach.call(strip.querySelectorAll('img[data-default-src]'), function(im) {
          var swap = function() { if (im.getAttribute('src') !== dflt) im.setAttribute('src', dflt); };
          im.addEventListener('error', swap);
          if (im.complete && im.naturalWidth === 0) swap();
        });
      })
      .catch(function() { /* silently no-op — sponsor strip is non-critical */ });
  })(${jsonForScript(eventId)});
`;

// ── Registration form ────────────────────────────────────────────────────────

function registrationForm(
  eventId: string,
  legalTier = 1,
  deploymentId?: string,
  // Stryker disable next-line StringLiteral: equivalent, formPage always passes the page's nonce, so the default is never read.
  nonce = '',
  lang: Lang = DEFAULT_LANG
): string {
  const hiddenDeployment = deploymentId
    ? `<input type="hidden" name="deploymentId" data-testid="form-deployment-id" value="${escapeHtml(deploymentId)}" />`
    : '';
  // Stryker disable next-line StringLiteral: equivalent, privacyNotice's default branch is the registration notice.
  const privacy = privacyNotice('register', legalTier, lang);
  return `
    <div class="form-card" id="form-area" data-testid="form-register">
      <h2>${msg(lang, 'form.register.heading')}</h2>
      <p id="error-msg" class="error-msg" data-testid="form-error" role="alert" aria-live="assertive"></p>
      <form data-testid="register-form">
        ${hiddenDeployment}
        <label for="name">${msg(lang, 'form.register.name')}</label>
        <input type="text" id="name" data-testid="register-name-input" placeholder="${msg(lang, 'form.register.namePlaceholder')}" maxlength="200" required autocomplete="name" aria-required="true" aria-describedby="error-msg" />
        <label for="email">${msg(lang, 'form.register.email')}</label>
        <p class="field-note" id="register-email-note" data-testid="register-email-note">${msg(lang, 'form.register.emailNote')}</p>
        <input type="email" id="email" data-testid="register-email-input" placeholder="${msg(lang, 'form.register.emailPlaceholder')}" maxlength="320" autocomplete="email" aria-describedby="register-email-note error-msg" />
        <button type="submit" data-testid="register-submit">${msg(lang, 'cta.register')}</button>
        ${privacy}
      </form>
    </div>
    <script nonce="${nonce}">
      ${formJsSubmit(lang)}
      async function handleRegister(e) {
        e.preventDefault();
        // submitForm has already shown the friendly error on a refusal, so a
        // refusal ends here: no confirmation, no next step, no unhandled rejection.
        try {
          await submitForm(${jsonForScript(eventId)}, 'register', {
            name: document.getElementById('name').value,
            email: document.getElementById('email').value || undefined,
            sourcePlacementId: ${jsonForScript(deploymentId ?? null)},
          });
        } catch (_) {
          return;
        }
        showSuccess(${js(lang, 'form.register.done')});
      }
      document.querySelector('[data-testid="register-form"]').addEventListener('submit', handleRegister);
    </script>`;
}

// ── Check-in form (tap counter) ──────────────────────────────────────────────

function checkinForm(
  eventId: string,
  legalTier = 1,
  deploymentId?: string,
  // Stryker disable next-line StringLiteral: equivalent, formPage always passes the page's nonce, so the default is never read.
  nonce = '',
  lang: Lang = DEFAULT_LANG
): string {
  return `
    <div class="checkin-tap" id="form-area" data-testid="form-checkin">
      <h2>${msg(lang, 'form.checkin.heading')}</h2>
      <p id="error-msg" class="error-msg" data-testid="form-error" role="alert" aria-live="assertive"></p>
      <button type="button" id="checkin-btn" data-testid="checkin-submit">${msg(lang, 'form.checkin.tap')}</button>
      <p class="walk-in-row">${msg(lang, 'form.checkin.noRegistration')}
        <button type="button" id="walk-in-btn" class="walk-in-btn" data-testid="checkin-walk-in-submit">${msg(lang, 'form.checkin.walkIn')}</button>
      </p>
      <div class="count" id="count" data-testid="checkin-count" role="status" aria-live="polite"></div>
      ${privacyNotice('checkin', legalTier, lang)}
    </div>
    <script nonce="${nonce}">
      ${formJsSubmit(lang)}
      let tapping = false;
      // OSE-1736: once a check-in has gone through, the page takes no more. The
      // answer carries no count (OSE-1657), so a second tap would add one the
      // person could never see. A failed submit leaves this false and the
      // buttons live, so someone who lost signal can try again.
      let checkedIn = false;
      // OSE-1373: the walk-in button declares its arrival path; the plain tap
      // declares none. A category per check-in — never who checked in.
      async function handleCheckin(e, walkIn) {
        if (e) e.preventDefault();
        if (tapping || checkedIn) return;
        tapping = true;
        const btn = document.getElementById('checkin-btn');
        const walkInBtn = document.getElementById('walk-in-btn');
        btn.style.transform = 'scale(0.93)';
        btn.style.opacity = '0.7';
        btn.setAttribute('aria-busy', 'true');
        try {
          await submitForm(${jsonForScript(eventId)}, 'checkin', walkIn ? {
            sourcePlacementId: ${jsonForScript(deploymentId ?? null)},
            arrival_path: 'walk_in',
          } : {
            sourcePlacementId: ${jsonForScript(deploymentId ?? null)},
          });
          // OSE-1657: counts are post-event only, so the page confirms the
          // check-in and shows no tally.
          checkedIn = true;
          document.getElementById('count').textContent = ${js(lang, 'form.checkin.done')};
          // Both buttons read as spent, not just inert: dimmed, the label says
          // why, and a plain cursor. The status line above is a live region, so
          // a screen reader announces the same sentence.
          // Not aria-disabled/disabled on purpose: the held journey test taps
          // again and requires that tap to be a real, harmless one (it must
          // send nothing), and it must stay a >= 44px target.
          btn.textContent = ${js(lang, 'form.checkin.doneButton')};
          [btn, walkInBtn].forEach(function (b) {
            b.style.cursor = 'default';
          });
          walkInBtn.style.opacity = '0.5';
        } catch (err) {
          // submitForm already put the friendly error on the page; nothing
          // more to say, and nothing to leave unhandled.
        } finally {
          tapping = false;
          btn.removeAttribute('aria-busy');
          btn.style.transform = 'scale(1)';
          btn.style.opacity = checkedIn ? '0.5' : '1';
          // submitForm disabled the button on the way in. A failed submit gets it
          // back live so a retry is possible; a successful one is held by the
          // checkedIn guard above, not by a second disable.
          btn.disabled = false;
        }
      }
      const _checkinBtn = document.getElementById('checkin-btn');
      _checkinBtn.addEventListener('touchend', handleCheckin);
      _checkinBtn.addEventListener('click', handleCheckin);
      const _walkInBtn = document.getElementById('walk-in-btn');
      const _walkIn = function (e) { return handleCheckin(e, true); };
      _walkInBtn.addEventListener('touchend', _walkIn);
      _walkInBtn.addEventListener('click', _walkIn);
    </script>`;
}

// ── Survey form ──────────────────────────────────────────────────────────────

function surveyForm(
  eventId: string,
  legalTier = 1,
  deploymentId?: string,
  // Stryker disable next-line StringLiteral: equivalent, formPage always passes the page's nonce, so the default is never read.
  nonce = '',
  lang: Lang = DEFAULT_LANG
): string {
  const hiddenDeployment = deploymentId
    ? `<input type="hidden" name="deploymentId" data-testid="form-deployment-id" value="${escapeHtml(deploymentId)}" />`
    : '';
  // Each rating button says what it does: "Rate 3 out of 5", in the page's language.
  const rate = (n: number) =>
    `<button type="button" data-testid="survey-rating-${n}" aria-label="${fmt(lang, 'form.survey.rate', { n })}" aria-pressed="false">${n}</button>`;
  return `
    <div class="form-card" id="form-area" data-testid="form-survey">
      <h2>${msg(lang, 'form.survey.heading')}</h2>
      <p id="error-msg" class="error-msg" data-testid="form-error" role="alert" aria-live="assertive"></p>
      <form data-testid="survey-form">
        ${hiddenDeployment}
        <label id="rating-label">${msg(lang, 'form.survey.rating')}</label>
        <div class="rating-row" id="rating-overall" data-testid="survey-rating-overall" role="group" aria-labelledby="rating-label">
          ${[1, 2, 3, 4, 5].map(rate).join('\n          ')}
        </div>
        <label for="comments">${msg(lang, 'form.survey.comments')}</label>
        <textarea id="comments" data-testid="survey-comments-input" placeholder="${msg(lang, 'form.survey.commentsPlaceholder')}" maxlength="1000" aria-describedby="error-msg"></textarea>
        <button type="submit" data-testid="survey-submit">${msg(lang, 'form.survey.submit')}</button>
        ${privacyNotice('survey', legalTier, lang)}
      </form>
    </div>
    <script nonce="${nonce}">
      ${formJsSubmit(lang)}
      const ratings = {};
      function setRating(key, val) {
        ratings[key] = val;
        document.querySelectorAll('#rating-' + key + ' button').forEach((b, i) => {
          const on = i < val;
          b.classList.toggle('selected', on);
          // Expose the fill state to assistive tech, not colour alone (FE-7).
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
      async function handleSurvey(e) {
        e.preventDefault();
        const comments = document.getElementById('comments').value;
        await submitForm(${jsonForScript(eventId)}, 'survey', {
          responses: { ...ratings, ...(comments ? { comments } : {}) },
          sourcePlacementId: ${jsonForScript(deploymentId ?? null)},
        });
        showSuccess(${js(lang, 'form.survey.done')});
      }
      document.querySelector('[data-testid="survey-form"]').addEventListener('submit', handleSurvey);
      document.querySelectorAll('#rating-overall button').forEach(function(btn, i) {
        btn.addEventListener('click', function() { setRating('overall', i + 1); });
      });
    </script>`;
}

// ── Email signup form ────────────────────────────────────────────────────────

function emailSignupForm(
  eventId: string,
  legalTier = 1,
  deploymentId?: string,
  // Stryker disable next-line StringLiteral: equivalent, formPage always passes the page's nonce, so the default is never read.
  nonce = '',
  lang: Lang = DEFAULT_LANG
): string {
  const hiddenDeployment = deploymentId
    ? `<input type="hidden" name="deploymentId" data-testid="form-deployment-id" value="${escapeHtml(deploymentId)}" />`
    : '';
  return `
    <div class="form-card" id="form-area" data-testid="form-email">
      <h2>${msg(lang, 'form.email.heading')}</h2>
      <p class="form-intro">${msg(lang, 'form.email.intro')}</p>
      <p id="error-msg" class="error-msg" data-testid="form-error" role="alert" aria-live="assertive"></p>
      <form data-testid="email-form">
        ${hiddenDeployment}
        <label for="email">${msg(lang, 'form.email.label')}</label>
        <input type="email" id="email" data-testid="email-email-input" placeholder="${msg(lang, 'form.email.placeholder')}" maxlength="320" required autocomplete="email" aria-required="true" aria-describedby="error-msg" />
        <button type="submit" data-testid="email-submit">${msg(lang, 'form.email.submit')}</button>
        ${privacyNotice('email', legalTier, lang)}
      </form>
    </div>
    <script nonce="${nonce}">
      ${formJsSubmit(lang)}
      async function handleEmail(e) {
        e.preventDefault();
        let body;
        try {
          body = await submitForm(${jsonForScript(eventId)}, 'email-signup', {
            email: document.getElementById('email').value,
            sourcePlacementId: ${jsonForScript(deploymentId ?? null)},
          });
        } catch (_) {
          return; // the friendly error is already on screen
        }
        showSuccess(body.duplicate ? ${js(lang, 'form.email.already')} : ${js(lang, 'form.email.done')});
      }
      document.querySelector('[data-testid="email-form"]').addEventListener('submit', handleEmail);
    </script>`;
}

// ── Next step after a confirmation (F5.3) ────────────────────────────────────
//
// The confirmation is drawn in the browser once the POST succeeds (showSuccess),
// so the server renders the next step into an inert <template> and the success
// script moves a clone in. Nothing here is a count or an echo of what the person
// typed: counts are post-event only (#885), and the card reads only public
// event fields from DB.

/** The event fields the form page reads (all public, all from DB). */
export interface FormEventRow {
  id: string;
  brand_id: string | null;
  title: string | null;
  slug: string | null;
  status: string | null;
  description: string | null;
  location: string | null;
  where_address: string | null;
  start_date: string | null;
  end_date: string | null;
  starts_at: string | null;
  timezone: string | null;
}

function nextStepTemplate(inner: string): string {
  return `<template id="form-next-step" data-testid="form-next-step">${inner}</template>`;
}

/**
 * S-5.3.1 (OSE-479): after registering, add it to a calendar (the event's
 * existing server .ics, plus the Google Calendar link the event page offers for
 * Android), go back to the event page, and know how check-in works.
 */
function registerNextStep(row: FormEventRow, shareUrl: string, lang: Lang = DEFAULT_LANG): string {
  const id = encodeURIComponent(row.id);
  const google = buildGoogleCalendarUrl(row, shareUrl);
  // The calendar file is not a page and has no language; the event page does.
  const calendar = row.start_date
    ? `<a class="next-step-link" data-testid="register-next-calendar" href="/events/${escapeHtml(id)}/calendar.ics" download>${msg(lang, 'calendar.label')}</a>${
        google
          ? `<a class="next-step-link" data-testid="register-next-calendar-google" href="${escapeHtml(google)}" target="_blank" rel="noopener noreferrer">${msg(lang, 'form.next.googleCalendar')}</a>`
          : ''
      }`
    : '';
  return nextStepTemplate(`<div class="next-step" data-testid="register-next-step">
      ${calendar}<a class="next-step-link" data-testid="register-next-event-page" href="${escapeHtml(withLangPrefix(lang, eventPagePath(id, row.slug)))}">${msg(lang, 'form.next.eventPage')}</a>
      <p data-testid="register-next-checkin">${msg(lang, 'form.next.checkin')}</p>
    </div>`);
}

/**
 * S-5.3.2 (OSE-480): after an email signup, what is on next at this venue,
 * straight away (the same list as the event page and its recap,
 * lib/next-at-venue.ts). None listed: a link to everything coming up.
 */
// Exported for its unit test: the handler asks for the list only when the
// event has a venue, so the "this venue" fallback is reached directly there.
export function emailNextStep(
  row: FormEventRow,
  next: NextEventRow[],
  lang: Lang = DEFAULT_LANG
): string {
  if (!next.length) {
    return nextStepTemplate(`<div class="next-step" data-testid="email-next-step">
      <a class="next-step-link" data-testid="email-next-browse" href="${withLangPrefix(lang, '/events')}">${msg(lang, 'form.next.browse')}</a>
    </div>`);
  }
  // Titles and the venue are typed by organizers and show as typed (isolated on
  // a right-to-left page); the date is in the page's language.
  const items = next
    .map(
      (
        ev,
        i
      ) => `<li><a class="next-step-link" data-testid="email-next-venue-link-${i}" href="${escapeHtml(withLangPrefix(lang, `/events/${encodeURIComponent(ev.id)}`))}">
          <span>${isolateTyped(lang, escapeHtml(ev.title))}</span><span class="next-step-when">${escapeHtml(formatHumanDate(ev.start_date, lang))}</span>
        </a></li>`
    )
    .join('');
  const venue = isolateTyped(lang, escapeHtml(row.location)) || msg(lang, 'next.thisVenue');
  return nextStepTemplate(`<div class="next-step" data-testid="email-next-step">
      <aside data-testid="email-next-venue" aria-labelledby="email-next-heading">
        <h3 id="email-next-heading">${fmt(lang, 'next.atVenue', { venue })}</h3>
        <ul>${items}</ul>
      </aside>
    </div>`);
}

// ── Page shell ───────────────────────────────────────────────────────────────

function formPage(
  eventId: string,
  eventName: string,
  formType: string,
  legalTier = 1,
  deploymentId?: string,
  nonce = '',
  env?: FormPagesEnv,
  nextStep = '',
  lang: Lang = DEFAULT_LANG
): string {
  let formHtml: string;
  switch (formType) {
    case 'checkin':
      formHtml = checkinForm(eventId, legalTier, deploymentId, nonce, lang);
      break;
    case 'survey':
      formHtml = surveyForm(eventId, legalTier, deploymentId, nonce, lang);
      break;
    case 'email':
    case 'email-signup':
      formHtml = emailSignupForm(eventId, legalTier, deploymentId, nonce, lang);
      break;
    default:
      formHtml = registrationForm(eventId, legalTier, deploymentId, nonce, lang);
      break;
  }

  // L4 (OSE-1378) Slice 2: inject the Turnstile widget before the submit control
  // (dark → widget is '' and nothing changes). Action matches the server guard.
  const turnstileScript = env ? turnstileScriptTag(env) : '';
  if (env) {
    const action =
      formType === 'checkin'
        ? 'checkin'
        : formType === 'survey'
          ? 'survey'
          : formType === 'email' || formType === 'email-signup'
            ? 'email-signup'
            : 'register';
    const widget = turnstileWidgetHtml(env, action);
    if (widget) {
      const marker =
        formType === 'checkin'
          ? '<button type="button" id="checkin-btn" data-testid="checkin-submit">'
          : formType === 'survey'
            ? '<button type="submit" data-testid="survey-submit">'
            : formType === 'email' || formType === 'email-signup'
              ? '<button type="submit" data-testid="email-submit">'
              : '<button type="submit" data-testid="register-submit">';
      formHtml = formHtml.replace(marker, widget + marker);
    }
  }

  // OSE-1850 / OSE-1943: the header Language menu leads to this same form in
  // each other language, at the event's own form address, carrying only a
  // vetted ?deployment= (the one parameter the page reads besides its screen).
  const menuPath = eventFormPath(eventId, formType, deploymentId);
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${DIRECTION[lang]}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${eventName} – OurSharedEvents</title>
  <link rel="stylesheet" href="/ui.css" />
  <style>${FORM_CSS}${BACK_BUTTON_CSS}${LANGUAGE_MENU_CSS}</style>
  ${turnstileScript}
</head>
<body>
  <a href="#main-content" class="skip-link">${msg(lang, 'page.skipContent')}</a>
  <header data-testid="form-header">
    <div class="form-topbar" data-testid="form-topbar">
    ${renderLanguageMenu({ lang, path: menuPath, nonce })}
    </div>
    <h1>OurSharedEvents</h1>
    <div class="event-name" data-testid="form-event-name">${isolateTyped(lang, eventName)}</div>
  </header>
  <!-- OSE-222: sponsor logo strip — hidden by default. Populated on
       page load by formJsSponsor using the surface=public bundle.
       Renders as a thin row under the dark header. Non-critical;
       silently absent if no sponsors are configured for this event. -->
  <div class="form-sponsor-strip" id="form-sponsor-strip" data-testid="form-sponsor-strip" role="complementary" aria-label="${msg(lang, 'sponsors.label')}"></div>
  <main id="main-content" data-testid="form-main">${formHtml}${nextStep}
  ${renderBackButton({ fallbackHref: withLangPrefix(lang, `/events/${encodeURIComponent(eventId)}`), nonce, testid: 'form-back', lang })}</main>
  <script nonce="${nonce}">${formJsSponsor(eventId, lang)}</script>
</body>
</html>`;
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function handleFormPage(
  request: Request,
  env: FormPagesEnv,
  eventId: string,
  legalTier = 1,
  // /events/<id>/<screen> (OSE-1684): the screen names the form, so the
  // `?type=` of the old /forms/ address is not read.
  screen?: EventFormScreen,
  // OSE-1850: the language in the path (`/es/events/<id>/checkin`), the
  // visitor's explicit choice. Without one, the Accept-Language header picks
  // it, as on the event page. Read and forgotten: never stored, never posted.
  pathLang?: Lang
): Promise<Response> {
  const lang = pathLang ?? resolveLanguage(request.headers.get('Accept-Language'));
  // OSE-1754: /forms/<id> takes any segment without a slash, undecoded, so a
  // raw quote can arrive here. An id the form endpoints would refuse
  // (validateFormRequest) gets no form at all: the page could never submit it,
  // and the id is then never written into a script.
  if (!isValidEventId(eventId)) {
    // A link that is right apart from junk on the end (copied out of a
    // sentence, a space typed after it) goes to the form it meant, at the
    // event's own address (OSE-1684), with its form type and a valid
    // ?deployment= kept.
    const meant = repairEventIdTypo(eventId);
    if (meant) {
      const asked = new URL(request.url).searchParams;
      const deployment = asked.get('deployment');
      return new Response(null, {
        status: 302,
        headers: {
          // A bare address stays bare (the header picks the language again); a
          // prefixed one keeps its prefix.
          Location: withLangPrefix(
            pathLang ?? DEFAULT_LANG,
            eventFormPath(
              meant,
              asked.get('type'),
              isValidDeploymentId(deployment) ? deployment : null
            )
          ),
          'Cache-Control': 'no-store',
        },
      });
    }
    // Loaded on this path only: pages.ts pulls in the .html templates, and this
    // file must stay importable on its own (the root unit tests render it in Node).
    const { renderErrorPage } = await import('./pages');
    return renderErrorPage(
      404,
      "This event link doesn't look right",
      'Try the original link or contact the host.'
    );
  }
  const url = new URL(request.url);
  const formType = screen
    ? EVENT_FORM_SCREENS[screen]
    : (url.searchParams.get('type') ?? 'register');
  // OSE-627: deployment ID for poster attribution (written to source_placement_id
  // on form submission so SharedReport can link scans to form registrations).
  // OSE-1754: a value of any other shape is dropped, never written into the page.
  const rawDeployment = url.searchParams.get('deployment');
  const deploymentId = isValidDeploymentId(rawDeployment) ? rawDeployment : null;

  // OSE-R-007 (2026-05-15): event title MUST come from the canonical
  // event row in D1, never from the URL query param. Pre-fix the page
  // trusted `?event=...` and rendered it as the official event name,
  // letting an attacker craft `/forms/evt_X?event=Cheap%20Rolex%20Deals!`
  // and present a phishing-ready form page. The query param is now
  // ignored entirely for display content; the canonical title is fetched
  // by eventId.
  //
  // Backward compat: unknown event IDs (including ones the form-submission
  // endpoints still accept "for un-seeded test fixtures") fall back to the
  // generic "Event" label rather than 404ing. The customer who scanned a
  // QR for an event we can't resolve still sees a renderable form; the
  // attacker-controlled string never reaches the DOM.
  let canonicalTitle: string | null = null;
  let row: FormEventRow | null = null;
  if (env.DB) {
    try {
      row = await env.DB.prepare(
        `SELECT id, brand_id, title, slug, status, description, location, where_address,
                start_date, end_date, starts_at, timezone
           FROM events WHERE id = ?`
      )
        .bind(eventId)
        .first<FormEventRow>();
      if (row) {
        // OSE-291 (EPIC OSE-284) — "a poster must never rot." The event this QR
        // points at may have been archived (or wound back to draft/ready) since
        // the poster was printed. A non-active event must NOT hand the scanner a
        // live registration form; forward them to the /events discovery listing
        // instead — the same graceful behavior /events/:id already gives, so
        // every public link stays consistent. Only applies to a KNOWN event:
        // unknown/un-seeded ids keep the permissive fallback below (OSE-R-007).
        if (isStaleForPublicLanding(row.status)) {
          // OSE-1850: a prefixed form forwards to the list in the same language.
          return staleEventForward(
            url.origin,
            eventId,
            row.status,
            'form',
            withLangPrefix(pathLang ?? DEFAULT_LANG, STALE_FORWARD_PATH)
          );
        }
        if (typeof row.title === 'string' && row.title.length > 0) {
          canonicalTitle = row.title;
        }
      }
    } catch {
      // DB throw → keep the safe fallback. The form should still render so
      // a customer who scanned a QR isn't stuck on a 503 mid-conversion.
      canonicalTitle = null;
      row = null;
    }
  }
  // Defense in depth: even though the DB column is admin-controlled and
  // shouldn't contain HTML, escape the value and cap length before render.
  const eventName = escapeHtml((canonicalTitle ?? msg(lang, 'form.eventFallback')).slice(0, 200));

  // F5.3: the next step under the confirmation, for a known live event only
  // (an unknown id has no event page to link back to).
  let nextStep = '';
  if (row) {
    if (formType === 'email' || formType === 'email-signup') {
      nextStep = emailNextStep(row, await fetchNextEventsAtVenue(env.DB, row), lang);
    } else if (formType !== 'checkin' && formType !== 'survey') {
      // Any other ?type= renders the registration form (formPage's default).
      // The calendar entry's link is the bare event page: it is read later, by
      // whoever opens the calendar, so their own browser picks the language.
      const shareUrl = `${canonicalOrigin(request, env) ?? url.origin}${eventPagePath(row.id, row.slug)}`;
      nextStep = registerNextStep(row, shareUrl, lang);
    }
  }

  const nonce = generateNonce();
  const html = formPage(
    eventId,
    eventName,
    formType,
    legalTier,
    deploymentId ?? undefined,
    nonce,
    env,
    nextStep,
    lang
  );
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...buildSecurityHeaders(nonce, env),
      // A bare address answers in the header's language, so a cache keeps one
      // copy per language. Under a prefix the address alone decides it.
      ...(pathLang ? {} : { Vary: 'Accept-Language' }),
    },
  });
}
