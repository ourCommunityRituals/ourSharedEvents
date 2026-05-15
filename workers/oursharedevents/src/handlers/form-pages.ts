/**
 * Form page handler — serves mobile-first HTML form pages.
 *
 * Sr Design FE: 10-second comprehension test — customer sees event name,
 * one clear action, and completes the form in under 10 seconds.
 *
 * QR→form routing: ?type= param selects form type.
 *   GET /forms/:eventId                → registration (default)
 *   GET /forms/:eventId?type=register  → registration
 *   GET /forms/:eventId?type=checkin   → check-in
 *   GET /forms/:eventId?type=survey    → survey
 *   GET /forms/:eventId?type=email     → email signup
 *
 * Lead FE: Forms post to /api/v2/events/:id/forms/:type via fetch().
 * No page reload. Success state shown inline.
 *
 * Sr Design FE: All interactive elements have data-testid attributes
 * for stable Playwright automation. These IDs survive CSS/layout changes.
 */

export interface FormPagesEnv {
  // OSE-R-007 (2026-05-15): event title must come from the canonical
  // event row in D1, not from the URL query param. Optional so the
  // handler stays compatible with test environments that don't bind DB.
  DB?: D1Database;
  WORKER_ENV?: string;
}

// ── Security headers (SEC-2) ──────────────────────────────────────────────────

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// ── GDPR Art. 13 privacy notice (BE-9 / BE-10) ───────────────────────────────

function privacyNotice(formType: string, legalTier = 1): string {
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
      purpose = 'We collect your email address to notify you about future community events.';
      legalBasis =
        'GDPR Art. 6(1)(a) — your <strong>consent</strong>. You can <strong>withdraw consent</strong> at any time.';
      retention =
        'Your email is encrypted at rest and automatically deleted after <strong>30</strong> days.';
      break;
    default: // register
      purpose =
        'We collect your name (required) and email (optional) to register you for this event.';
      legalBasis =
        'GDPR Art. 6(1)(a) — your <strong>consent</strong>. Your data is <strong>deleted when the event ends</strong>.';
      retention = 'Registration data is deleted automatically when the event ends.';
  }

  let addenda = '';
  if (legalTier >= 2) {
    addenda += `<br/><strong>Commerce notice:</strong> Payment data is handled by our PCI DSS-compliant processor and never stored by us. `;
  }
  if (legalTier >= 4) {
    addenda += `<br/><strong>Health notice:</strong> Health data is protected under HIPAA safeguards and a Business Associate Agreement. `;
  }
  if (legalTier >= 5) {
    addenda += `<br/><strong>Children's notice:</strong> For children under 13, a parent or guardian must submit this form (COPPA). `;
  }

  return `<p class="privacy-notice" data-testid="privacy-notice">
    ${purpose} Legal basis: ${legalBasis} ${retention}
    You have the right to access, correct, or erase your data, and to lodge a complaint with your local data protection
    <strong>supervisory authority</strong>.
    ${addenda}
    <a href="/privacy" data-testid="privacy-policy-link">Full privacy policy</a>
  </p>`;
}

// ── XSS Prevention ───────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Shared CSS: mobile-first, system fonts, 10-second comprehension ──────────

const FORM_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #212529; min-height: 100vh; }
  header { background: #1a1a2e; color: #fff; padding: 1rem 1.5rem; text-align: center; }
  header h1 { font-size: 1.1rem; font-weight: 600; opacity: .7; text-transform: uppercase; letter-spacing: .05em; }
  header .event-name { font-size: 1.4rem; font-weight: 700; margin-top: .25rem; }
  main { max-width: 480px; margin: 0 auto; padding: 1.5rem 1rem; }
  .form-card { background: #fff; border-radius: 12px; padding: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  .form-card h2 { font-size: 1.15rem; font-weight: 600; margin-bottom: 1rem; color: #1a1a2e; }
  label { display: block; font-size: .85rem; font-weight: 500; color: #495057; margin-bottom: .25rem; }
  input, textarea, select { width: 100%; padding: .65rem .75rem; border: 1.5px solid #dee2e6; border-radius: 8px; font-size: 1rem; margin-bottom: .75rem; font-family: inherit; }
  input:focus, textarea:focus { outline: none; border-color: #4361ee; box-shadow: 0 0 0 3px rgba(67,97,238,.15); }
  textarea { resize: vertical; min-height: 80px; }
  button { width: 100%; padding: .75rem; background: #4361ee; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: .5rem; }
  button:active { background: #3451d1; }
  button:disabled { background: #adb5bd; cursor: not-allowed; }
  .success { text-align: center; padding: 2rem 1rem; }
  .success .icon { font-size: 3rem; margin-bottom: .5rem; }
  .success h2 { color: #155724; font-size: 1.2rem; }
  .success p { color: #6c757d; font-size: .9rem; margin-top: .5rem; }
  .error-msg { color: #e03131; font-size: .85rem; margin-bottom: .5rem; display: none; }
  .privacy-notice { font-size: .75rem; color: #6c757d; margin-top: .75rem; line-height: 1.4; }
  .privacy-notice a { color: #4361ee; }
  .skip-link { position: absolute; left: -9999px; top: auto; width: 1px; height: 1px; overflow: hidden; }
  .skip-link:focus { position: fixed; top: 0; left: 0; width: auto; height: auto; padding: .5rem 1rem; background: #1a1a2e; color: #fff; font-size: 1rem; z-index: 9999; text-decoration: none; border-bottom: 2px solid #4361ee; }
  button:focus-visible { outline: 2px solid #4361ee; outline-offset: 2px; }
  .rating-row { display: flex; gap: .5rem; margin-bottom: .75rem; }
  .rating-row button { width: auto; flex: 1; padding: .5rem; font-size: 1.1rem; background: #f1f3f5; color: #495057; border: 2px solid transparent; }
  .rating-row button.selected { background: #4361ee; color: #fff; border-color: #3451d1; }
  .checkin-tap { text-align: center; padding: 3rem 1rem; }
  .checkin-tap button { font-size: 1.5rem; padding: 1.5rem; border-radius: 50%; width: 180px; height: 180px; margin: 1rem auto; display: block; -webkit-tap-highlight-color: transparent; touch-action: manipulation; transition: transform 0.1s, opacity 0.1s; user-select: none; }
  .checkin-tap .count { font-size: 2rem; font-weight: 700; color: #1a1a2e; margin-top: 1rem; }
  /* OSE-222: sponsor logo strip in form header. Renders hidden by
     default; gets .has-sponsors class via JS only if sponsor-bundle
     for this event returns mobileBanner sponsors. Non-critical
     load — silently no-ops on fetch failure. */
  .form-sponsor-strip { display: none; padding: 0.5rem 1rem; background: #fff; border-bottom: 1px solid #e9ecef; }
  .form-sponsor-strip.has-sponsors { display: flex; align-items: center; justify-content: center; gap: 0.75rem; flex-wrap: wrap; }
  .form-sponsor-strip .strip-label { font-size: 0.7rem; color: #6c757d; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; }
  .form-sponsor-strip .sponsor-item { display: inline-flex; align-items: center; gap: 0.35rem; }
  .form-sponsor-strip img { height: 24px; width: auto; max-width: 80px; object-fit: contain; }
  .form-sponsor-strip .sponsor-name { font-size: 0.8rem; color: #495057; }
  /* OSE-223: sponsor acknowledgment on form success state. Renders
     inside .success block below the "you can close this page" line.
     Uses the same fetched sponsor bundle (cached on page load by
     the strip loader) — no second fetch. */
  .form-sponsor-thanks { margin-top: 1.25rem; padding: 1rem; background: #f8f9fa; border-radius: 8px; text-align: center; }
  .form-sponsor-thanks .thanks-label { display: block; font-size: 0.7rem; color: #6c757d; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; margin-bottom: 0.5rem; }
  .form-sponsor-thanks .sponsor-row { display: inline-flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; justify-content: center; }
  .form-sponsor-thanks .sponsor-item { display: inline-flex; align-items: center; gap: 0.4rem; }
  .form-sponsor-thanks img { height: 32px; width: auto; max-width: 120px; object-fit: contain; }
  .form-sponsor-thanks .sponsor-name { font-size: 0.85rem; color: #495057; font-weight: 500; }
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

const FORM_JS_SUBMIT = `
  // OSE-R-002: code → friendly copy. Update both this map AND the standard
  // doc tests when a new server code is added.
  var FORM_ERROR_FRIENDLY_COPY = {
    INVALID_EVENT_ID: "This event link doesn't look right. Try the original link or contact the host.",
    INVALID_BODY: "We couldn't read your response. Please refresh the page and try again.",
    PAYLOAD_TOO_LARGE: "Your message is too long. Please shorten it and try again.",
    MISSING_FIELD: "Please fill out all required fields and try again.",
    INVALID_EMAIL: "That email doesn't look right. Please check and try again.",
    CONFIG_ERROR: "Something's not set up on our side. Please try again in a few minutes.",
    DB_ERROR: "We're having trouble right now. Please try again in a moment.",
    METHOD_NOT_ALLOWED: "This action isn't available right now."
  };

  function friendlyFormError(code, status) {
    if (code && FORM_ERROR_FRIENDLY_COPY[code]) return FORM_ERROR_FRIENDLY_COPY[code];
    if (status === 429) return "Too many tries. Please wait a moment and try again.";
    if (status === 503) return "We're having trouble right now. Please try again in a moment.";
    if (status >= 500) return "Sorry, something went wrong on our end. Please try again.";
    if (status >= 400) return "Sorry, something went wrong. Please try again.";
    return "Sorry, something went wrong. Please try again.";
  }

  async function submitForm(eventId, formType, data) {
    var errEl = document.getElementById('error-msg');
    var btn = document.querySelector('[data-testid$="-submit"]');
    if (errEl) {
      errEl.style.display = 'none';
      errEl.removeAttribute('data-error-code');
    }
    if (btn) btn.disabled = true;
    try {
      var res = await fetch('/api/v2/events/' + eventId + '/forms/' + formType, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
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
      var items = cache.slice(0, 3).map(function(s) {
        var name = String(s.name || '').replace(/[<>&"']/g, function(c) {
          return { '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c];
        });
        var logo = s.logo_url ? '<img src="' + s.logo_url + '" alt="' + name + '" loading="lazy" />' : '';
        return '<span class="sponsor-item">' + logo + '<span class="sponsor-name">' + name + '</span></span>';
      }).join('');
      thanks = '<div class="form-sponsor-thanks" data-testid="form-sponsor-thanks"><span class="thanks-label">Event supported by</span><div class="sponsor-row">' + items + '</div></div>';
    }
    document.getElementById('form-area').innerHTML =
      '<div class="success" data-testid="form-success"><div class="icon">&#10003;</div><h2>' + msg + '</h2><p>You can close this page.</p>' + thanks + '</div>';
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

const FORM_JS_SPONSOR = `
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
        var items = banner.slice(0, 3).map(function(s) {
          var name = String(s.name || '').replace(/[<>&"']/g, function(c) {
            return { '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c];
          });
          var logo = s.logo_url ? '<img src="' + s.logo_url + '" alt="' + name + '" loading="lazy" />' : '';
          return '<span class="sponsor-item">' + logo + '<span class="sponsor-name">' + name + '</span></span>';
        }).join('');
        strip.innerHTML = '<span class="strip-label">Supported by</span>' + items;
        strip.classList.add('has-sponsors');
      })
      .catch(function() { /* silently no-op — sponsor strip is non-critical */ });
  })(EVENT_ID_PLACEHOLDER);
`;

// ── Registration form ────────────────────────────────────────────────────────

function registrationForm(eventId: string, legalTier = 1): string {
  return `
    <div class="form-card" id="form-area" data-testid="form-register">
      <h2>Register for this event</h2>
      <p id="error-msg" class="error-msg" data-testid="form-error" role="alert" aria-live="assertive"></p>
      <form onsubmit="handleRegister(event)" data-testid="register-form">
        <label for="name">Your name</label>
        <input type="text" id="name" data-testid="register-name-input" placeholder="Jane Smith" maxlength="200" required autocomplete="name" aria-required="true" aria-describedby="error-msg" />
        <label for="email">Email (optional)</label>
        <input type="email" id="email" data-testid="register-email-input" placeholder="jane@example.com" maxlength="320" autocomplete="email" aria-describedby="error-msg" />
        <button type="submit" data-testid="register-submit">Register</button>
        ${privacyNotice('register', legalTier)}
      </form>
    </div>
    <script>
      ${FORM_JS_SUBMIT}
      async function handleRegister(e) {
        e.preventDefault();
        await submitForm('${eventId}', 'register', {
          name: document.getElementById('name').value,
          email: document.getElementById('email').value || undefined,
        });
        showSuccess('You\\'re registered!');
      }
    </script>`;
}

// ── Check-in form (tap counter) ──────────────────────────────────────────────

function checkinForm(eventId: string, legalTier = 1): string {
  return `
    <div class="checkin-tap" id="form-area" data-testid="form-checkin">
      <h2>Check In</h2>
      <p id="error-msg" class="error-msg" data-testid="form-error" role="alert" aria-live="assertive"></p>
      <button type="button" id="checkin-btn" data-testid="checkin-submit" ontouchend="handleCheckin(event)" onclick="handleCheckin(event)">Tap to<br/>Check In</button>
      <div class="count" id="count" data-testid="checkin-count"></div>
      ${privacyNotice('checkin', legalTier)}
    </div>
    <script>
      ${FORM_JS_SUBMIT}
      let tapping = false;
      async function handleCheckin(e) {
        if (e) e.preventDefault();
        if (tapping) return;
        tapping = true;
        const btn = document.getElementById('checkin-btn');
        btn.style.transform = 'scale(0.93)';
        btn.style.opacity = '0.7';
        try {
          const body = await submitForm('${eventId}', 'checkin', {});
          document.getElementById('count').textContent = body.count + ' checked in';
        } finally {
          tapping = false;
          btn.style.transform = 'scale(1)';
          btn.style.opacity = '1';
          btn.disabled = false;
        }
      }
    </script>`;
}

// ── Survey form ──────────────────────────────────────────────────────────────

function surveyForm(eventId: string, legalTier = 1): string {
  return `
    <div class="form-card" id="form-area" data-testid="form-survey">
      <h2>How was the event?</h2>
      <p id="error-msg" class="error-msg" data-testid="form-error" role="alert" aria-live="assertive"></p>
      <form onsubmit="handleSurvey(event)" data-testid="survey-form">
        <label id="rating-label">Overall rating</label>
        <div class="rating-row" id="rating-overall" data-testid="survey-rating-overall" role="group" aria-labelledby="rating-label">
          <button type="button" data-testid="survey-rating-1" onclick="setRating('overall',1)" aria-label="Rate 1 out of 5">1</button>
          <button type="button" data-testid="survey-rating-2" onclick="setRating('overall',2)" aria-label="Rate 2 out of 5">2</button>
          <button type="button" data-testid="survey-rating-3" onclick="setRating('overall',3)" aria-label="Rate 3 out of 5">3</button>
          <button type="button" data-testid="survey-rating-4" onclick="setRating('overall',4)" aria-label="Rate 4 out of 5">4</button>
          <button type="button" data-testid="survey-rating-5" onclick="setRating('overall',5)" aria-label="Rate 5 out of 5">5</button>
        </div>
        <label for="comments">Comments (optional)</label>
        <textarea id="comments" data-testid="survey-comments-input" placeholder="Tell us what you thought..." maxlength="1000" aria-describedby="error-msg"></textarea>
        <button type="submit" data-testid="survey-submit">Submit Feedback</button>
        ${privacyNotice('survey', legalTier)}
      </form>
    </div>
    <script>
      ${FORM_JS_SUBMIT}
      const ratings = {};
      function setRating(key, val) {
        ratings[key] = val;
        document.querySelectorAll('#rating-' + key + ' button').forEach((b, i) => {
          b.classList.toggle('selected', i < val);
        });
      }
      async function handleSurvey(e) {
        e.preventDefault();
        const comments = document.getElementById('comments').value;
        await submitForm('${eventId}', 'survey', {
          responses: { ...ratings, ...(comments ? { comments } : {}) },
        });
        showSuccess('Thanks for your feedback!');
      }
    </script>`;
}

// ── Email signup form ────────────────────────────────────────────────────────

function emailSignupForm(eventId: string, legalTier = 1): string {
  return `
    <div class="form-card" id="form-area" data-testid="form-email">
      <h2>Stay in the loop</h2>
      <p style="color:#6c757d;font-size:.9rem;margin-bottom:1rem;">Get notified about future events. We'll never share your email.</p>
      <p id="error-msg" class="error-msg" data-testid="form-error" role="alert" aria-live="assertive"></p>
      <form onsubmit="handleEmail(event)" data-testid="email-form">
        <label for="email">Your email</label>
        <input type="email" id="email" data-testid="email-email-input" placeholder="you@example.com" maxlength="320" required autocomplete="email" aria-required="true" aria-describedby="error-msg" />
        <button type="submit" data-testid="email-submit">Sign me up</button>
        ${privacyNotice('email', legalTier)}
      </form>
    </div>
    <script>
      ${FORM_JS_SUBMIT}
      async function handleEmail(e) {
        e.preventDefault();
        const body = await submitForm('${eventId}', 'email-signup', {
          email: document.getElementById('email').value,
        });
        showSuccess(body.duplicate ? 'You\\'re already signed up!' : 'You\\'re on the list!');
      }
    </script>`;
}

// ── Page shell ───────────────────────────────────────────────────────────────

function formPage(eventId: string, eventName: string, formType: string, legalTier = 1): string {
  let formHtml: string;
  switch (formType) {
    case 'checkin':
      formHtml = checkinForm(eventId, legalTier);
      break;
    case 'survey':
      formHtml = surveyForm(eventId, legalTier);
      break;
    case 'email':
      formHtml = emailSignupForm(eventId, legalTier);
      break;
    default:
      formHtml = registrationForm(eventId, legalTier);
      break;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${eventName} – OurSharedEvents</title>
  <style>${FORM_CSS}</style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to content</a>
  <header data-testid="form-header">
    <h1>OurSharedEvents</h1>
    <div class="event-name" data-testid="form-event-name">${eventName}</div>
  </header>
  <!-- OSE-222: sponsor logo strip — hidden by default. Populated on
       page load by FORM_JS_SPONSOR using the surface=public bundle.
       Renders as a thin row under the dark header. Non-critical;
       silently absent if no sponsors are configured for this event. -->
  <div class="form-sponsor-strip" id="form-sponsor-strip" data-testid="form-sponsor-strip" role="complementary" aria-label="Event sponsors"></div>
  <main id="main-content" data-testid="form-main">${formHtml}</main>
  <script>${FORM_JS_SPONSOR.replace('EVENT_ID_PLACEHOLDER', JSON.stringify(eventId))}</script>
</body>
</html>`;
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function handleFormPage(
  request: Request,
  env: FormPagesEnv,
  eventId: string,
  legalTier = 1
): Promise<Response> {
  const url = new URL(request.url);
  const formType = url.searchParams.get('type') ?? 'register';

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
  if (env.DB) {
    try {
      const row = await env.DB.prepare('SELECT title FROM events WHERE id = ?')
        .bind(eventId)
        .first<{ title: string | null }>();
      if (row && typeof row.title === 'string' && row.title.length > 0) {
        canonicalTitle = row.title;
      }
    } catch {
      // DB throw → keep the safe fallback. The form should still render so
      // a customer who scanned a QR isn't stuck on a 503 mid-conversion.
      canonicalTitle = null;
    }
  }
  // Defense in depth: even though the DB column is admin-controlled and
  // shouldn't contain HTML, escape the value and cap length before render.
  const eventName = escapeHtml((canonicalTitle ?? 'Event').slice(0, 200));

  const html = formPage(eventId, eventName, formType, legalTier);
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...SECURITY_HEADERS,
    },
  });
}
