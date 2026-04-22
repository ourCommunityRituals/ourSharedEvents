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
  WORKER_ENV?: string;
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
  .rating-row { display: flex; gap: .5rem; margin-bottom: .75rem; }
  .rating-row button { width: auto; flex: 1; padding: .5rem; font-size: 1.1rem; background: #f1f3f5; color: #495057; border: 2px solid transparent; }
  .rating-row button.selected { background: #4361ee; color: #fff; border-color: #3451d1; }
  .checkin-tap { text-align: center; padding: 3rem 1rem; }
  .checkin-tap button { font-size: 1.5rem; padding: 1.5rem; border-radius: 50%; width: 180px; height: 180px; margin: 1rem auto; display: block; -webkit-tap-highlight-color: transparent; touch-action: manipulation; transition: transform 0.1s, opacity 0.1s; user-select: none; }
  .checkin-tap .count { font-size: 2rem; font-weight: 700; color: #1a1a2e; margin-top: 1rem; }
`;

// ── Form JS: shared submit logic ─────────────────────────────────────────────

const FORM_JS_SUBMIT = `
  async function submitForm(eventId, formType, data) {
    const errEl = document.getElementById('error-msg');
    const btn = document.querySelector('[data-testid$="-submit"]');
    if (errEl) errEl.style.display = 'none';
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/v2/events/' + eventId + '/forms/' + formType, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || 'Submission failed');
      return body;
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
      if (btn) btn.disabled = false;
      throw err;
    }
  }
  function showSuccess(msg) {
    document.getElementById('form-area').innerHTML =
      '<div class="success" data-testid="form-success"><div class="icon">&#10003;</div><h2>' + msg + '</h2><p>You can close this page.</p></div>';
  }
`;

// ── Registration form ────────────────────────────────────────────────────────

function registrationForm(eventId: string): string {
  return `
    <div class="form-card" id="form-area" data-testid="form-register">
      <h2>Register for this event</h2>
      <p id="error-msg" class="error-msg" data-testid="form-error"></p>
      <form onsubmit="handleRegister(event)" data-testid="register-form">
        <label for="name">Your name</label>
        <input type="text" id="name" data-testid="register-name-input" placeholder="Jane Smith" maxlength="200" required />
        <label for="email">Email (optional)</label>
        <input type="email" id="email" data-testid="register-email-input" placeholder="jane@example.com" maxlength="320" />
        <button type="submit" data-testid="register-submit">Register</button>
        <p class="privacy-notice" data-testid="privacy-notice">By submitting, you agree to our data collection practices. Your name is stored temporarily and deleted after the event. Email is hashed for deduplication only.</p>
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

function checkinForm(eventId: string): string {
  return `
    <div class="checkin-tap" id="form-area" data-testid="form-checkin">
      <h2>Check In</h2>
      <p id="error-msg" class="error-msg" data-testid="form-error"></p>
      <button type="button" id="checkin-btn" data-testid="checkin-submit" ontouchend="handleCheckin(event)" onclick="handleCheckin(event)">Tap to<br/>Check In</button>
      <div class="count" id="count" data-testid="checkin-count"></div>
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

function surveyForm(eventId: string): string {
  return `
    <div class="form-card" id="form-area" data-testid="form-survey">
      <h2>How was the event?</h2>
      <p id="error-msg" class="error-msg" data-testid="form-error"></p>
      <form onsubmit="handleSurvey(event)" data-testid="survey-form">
        <label>Overall rating</label>
        <div class="rating-row" id="rating-overall" data-testid="survey-rating-overall">
          <button type="button" data-testid="survey-rating-1" onclick="setRating('overall',1)">1</button>
          <button type="button" data-testid="survey-rating-2" onclick="setRating('overall',2)">2</button>
          <button type="button" data-testid="survey-rating-3" onclick="setRating('overall',3)">3</button>
          <button type="button" data-testid="survey-rating-4" onclick="setRating('overall',4)">4</button>
          <button type="button" data-testid="survey-rating-5" onclick="setRating('overall',5)">5</button>
        </div>
        <label for="comments">Comments (optional)</label>
        <textarea id="comments" data-testid="survey-comments-input" placeholder="Tell us what you thought..." maxlength="1000"></textarea>
        <button type="submit" data-testid="survey-submit">Submit Feedback</button>
        <p class="privacy-notice" data-testid="privacy-notice">By submitting, you agree to our data collection practices. Ratings are kept for analytics. Comments are scrubbed of personal data within 24 hours.</p>
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

function emailSignupForm(eventId: string): string {
  return `
    <div class="form-card" id="form-area" data-testid="form-email">
      <h2>Stay in the loop</h2>
      <p style="color:#6c757d;font-size:.9rem;margin-bottom:1rem;">Get notified about future events. We'll never share your email.</p>
      <p id="error-msg" class="error-msg" data-testid="form-error"></p>
      <form onsubmit="handleEmail(event)" data-testid="email-form">
        <label for="email">Your email</label>
        <input type="email" id="email" data-testid="email-email-input" placeholder="you@example.com" maxlength="320" required />
        <button type="submit" data-testid="email-submit">Sign me up</button>
        <p class="privacy-notice" data-testid="privacy-notice">By submitting, you agree to our data collection practices. Your email is encrypted and automatically deleted after 30 days.</p>
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

function formPage(eventId: string, eventName: string, formType: string): string {
  let formHtml: string;
  switch (formType) {
    case 'checkin':
      formHtml = checkinForm(eventId);
      break;
    case 'survey':
      formHtml = surveyForm(eventId);
      break;
    case 'email':
      formHtml = emailSignupForm(eventId);
      break;
    default:
      formHtml = registrationForm(eventId);
      break;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>${eventName} – OurSharedEvents</title>
  <style>${FORM_CSS}</style>
</head>
<body>
  <header data-testid="form-header">
    <h1>OurSharedEvents</h1>
    <div class="event-name" data-testid="form-event-name">${eventName}</div>
  </header>
  <main data-testid="form-main">${formHtml}</main>
</body>
</html>`;
}

// ─── Route handler ───────────────────────────────────────────────────────────

export function handleFormPage(request: Request, _env: FormPagesEnv, eventId: string): Response {
  const url = new URL(request.url);
  const formType = url.searchParams.get('type') ?? 'register';
  // Escape event name to prevent XSS — this value comes from a URL query param
  const eventName = escapeHtml((url.searchParams.get('event') ?? 'Event').slice(0, 200));

  const html = formPage(eventId, eventName, formType);
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
