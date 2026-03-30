/**
 * HTML page handler.
 *
 * Serves the public listing page and admin dashboard.
 * HTML is embedded as template strings so the Worker is fully self-contained.
 *
 * Firebase Hosting migration (Phase 3, Track B):
 *   Replace the embedded strings with a fetch() call to Firebase Hosting URL.
 */

export interface PagesEnv {
  WORKER_ENV?: string;
  DB?: D1Database;
}

// ─── Public page ────────────────────────────────────────────────────────────────

const PUBLIC_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OurSharedEvents</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #212529; }
    header { background: #1a1a2e; color: #fff; padding: 1.25rem 2rem; display: flex; align-items: center; gap: 1rem; }
    header h1 { font-size: 1.4rem; font-weight: 600; letter-spacing: -0.01em; }
    main { max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    h2 { font-size: 1.1rem; font-weight: 600; color: #495057; margin-bottom: 1rem; }
    #events { display: grid; gap: 1rem; }
    .event-card {
      background: #fff; border-radius: 8px; padding: 1.25rem 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,.08); border-left: 3px solid #4361ee;
    }
    .event-card h3 { font-size: 1rem; font-weight: 600; margin-bottom: .35rem; }
    .event-card .meta { font-size: .85rem; color: #868e96; }
    .loading { text-align: center; padding: 3rem; color: #868e96; font-size: .95rem; }
    .error   { text-align: center; padding: 2rem; color: #e03131; }
  </style>
</head>
<body>
  <header>
    <h1>OurSharedEvents</h1>
  </header>
  <main>
    <h2>Upcoming Events</h2>
    <div id="events"><p class="loading">Loading events&hellip;</p></div>
  </main>
  <script>
    (async () => {
      const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
      const container = document.getElementById('events');
      try {
        const res  = await fetch('/api/v2/events');
        const data = await res.json();
        if (!data.ok || !data.items.length) {
          container.innerHTML = '<p class="loading">No events scheduled.</p>';
          return;
        }
        container.innerHTML = data.items.map(e => \`
          <div class="event-card">
            <h3>\${esc(e.name || 'Untitled Event')}</h3>
            <p class="meta">
              \${e.startDateISO ? esc(new Date(e.startDateISO).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })) : ''}
              \${e.venue ? ' &middot; ' + esc(e.venue) : ''}
            </p>
          </div>
        \`).join('');
      } catch (err) {
        container.innerHTML = '<p class="error">Could not load events. Please try again.</p>';
      }
    })();
  </script>
</body>
</html>`;

// ─── Admin page ─────────────────────────────────────────────────────────────────

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin – OurSharedEvents</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #212529; }
    header { background: #1a1a2e; color: #fff; padding: 1.25rem 2rem; display: flex; align-items: center; justify-content: space-between; }
    header h1 { font-size: 1.4rem; font-weight: 600; }
    header span { font-size: .8rem; opacity: .6; text-transform: uppercase; letter-spacing: .05em; }
    main { max-width: 1000px; margin: 2rem auto; padding: 0 1rem; }
    h2 { font-size: 1.1rem; font-weight: 600; color: #495057; margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    th { background: #1a1a2e; color: #fff; padding: .75rem 1rem; text-align: left; font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; }
    td { padding: .75rem 1rem; border-bottom: 1px solid #f1f3f5; font-size: .9rem; }
    tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: #f1f3f5; }
    tbody tr.selected { background: #dbe4ff; }
    .badge { display: inline-block; padding: .15rem .5rem; border-radius: 4px; font-size: .75rem; font-weight: 600; }
    .badge.active   { background: #d3f9d8; color: #2f9e44; }
    .badge.archived { background: #f1f3f5; color: #868e96; }
    .loading { text-align: center; padding: 3rem; color: #868e96; }
    .error   { text-align: center; padding: 2rem; color: #e03131; }
    .forms-card { background: #fff; border-radius: 8px; padding: 1.25rem 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-top: 2rem; }
    .forms-card h2 { font-size: 1.1rem; font-weight: 600; color: #495057; margin-bottom: .75rem; }
    .forms-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: .75rem; }
    .form-link { display: block; padding: .75rem 1rem; background: #f8f9fa; border-radius: 6px; text-decoration: none; color: #212529; border-left: 3px solid #4361ee; }
    .form-link:hover { background: #e9ecef; }
    .form-link .form-type { font-weight: 600; font-size: .9rem; }
    .form-link .form-desc { font-size: .8rem; color: #868e96; margin-top: .15rem; }
    .form-counts { display: grid; grid-template-columns: repeat(4, 1fr); gap: .5rem; margin-top: 1rem; }
    .form-counts .count-box { text-align: center; padding: .5rem; background: #f8f9fa; border-radius: 6px; }
    .form-counts .count-num { font-size: 1.5rem; font-weight: 700; color: #1a1a2e; }
    .form-counts .count-label { font-size: .7rem; color: #868e96; text-transform: uppercase; }
  </style>
</head>
<body>
  <header>
    <h1>OurSharedEvents</h1>
    <span>Admin</span>
  </header>
  <main>
    <h2>All Events</h2>
    <div id="events"><p class="loading">Loading&hellip;</p></div>
  </main>
  <script>
    (async () => {
      const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
      const container = document.getElementById('events');
      try {
        const res  = await fetch('/api/v2/admin/events');
        const data = await res.json();
        if (!data.ok || !data.items.length) {
          container.innerHTML = '<p class="loading">No events found.</p>';
          return;
        }
        const rows = data.items.map(e => {
          const safeName = esc(e.name || 'Untitled');
          const safeId = esc(String(e.id));
          return \`
          <tr onclick="window.loadForms('\${safeId}', '\${safeName.replace(/'/g, "\\\\'")}'); document.querySelectorAll('tr.selected').forEach(r=>r.classList.remove('selected')); this.classList.add('selected');" style="cursor:pointer">
            <td>\${safeId}</td>
            <td>\${safeName}</td>
            <td>\${e.startDateISO ? esc(new Date(e.startDateISO).toLocaleDateString()) : '—'}</td>
            <td>\${esc(e.venue || '—')}</td>
            <td><span class="badge \${esc(e.status)}">\${esc(e.status)}</span></td>
          </tr>
        \`}).join('');
        container.innerHTML = \`
          <table>
            <thead><tr><th>ID</th><th>Name</th><th>Date</th><th>Venue</th><th>Status</th></tr></thead>
            <tbody>\${rows}</tbody>
          </table>
        \`;
      } catch (err) {
        container.innerHTML = '<p class="error">Could not load events.</p>';
      }
    })();
  </script>

  <!-- Card 2: Forms Management -->
  <div class="forms-card">
    <h2>Forms (Card 2)</h2>
    <div id="forms-panel"><p class="loading">Select an event to manage forms&hellip;</p></div>
  </div>
  <script>
    // Forms card — load counts and generate QR links for selected event
    window.loadForms = async function(eventId, eventName) {
      const panel = document.getElementById('forms-panel');
      const types = [
        { key: 'register', label: 'Registration', desc: 'Pre-event sign-up' },
        { key: 'checkin', label: 'Check-in', desc: 'Walk-in door tally' },
        { key: 'survey', label: 'Survey', desc: 'Post-event feedback' },
        { key: 'email', label: 'Email List', desc: 'Voluntary opt-in' },
      ];
      const encodedName = encodeURIComponent(eventName);

      // Form links
      const linksHtml = types.map(t =>
        '<a class="form-link" href="/forms/' + eventId + '?type=' + t.key + '&event=' + encodedName + '" target="_blank">' +
          '<div class="form-type">' + t.label + '</div>' +
          '<div class="form-desc">' + t.desc + '</div>' +
        '</a>'
      ).join('');

      // Fetch counts
      const adminPaths = ['registrations', 'checkin-count', 'surveys', 'email-signups'];
      const counts = await Promise.all(adminPaths.map(p =>
        fetch('/api/v2/admin/events/' + eventId + '/forms/' + p).then(r => r.json()).then(d => d.count || 0).catch(() => 0)
      ));

      panel.innerHTML =
        '<div class="forms-grid">' + linksHtml + '</div>' +
        '<div class="form-counts">' +
          '<div class="count-box"><div class="count-num">' + counts[0] + '</div><div class="count-label">Registrations</div></div>' +
          '<div class="count-box"><div class="count-num">' + counts[1] + '</div><div class="count-label">Check-ins</div></div>' +
          '<div class="count-box"><div class="count-num">' + counts[2] + '</div><div class="count-label">Surveys</div></div>' +
          '<div class="count-box"><div class="count-num">' + counts[3] + '</div><div class="count-label">Emails</div></div>' +
        '</div>';
    };
  </script>
</body>
</html>`;

// ─── Landing page ───────────────────────────────────────────────────────────────

const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OurSharedEvents</title>
  <meta name="description" content="Community events bringing Chicago's Southside together. Gather with your neighborhood.">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.6; -webkit-font-smoothing: antialiased; }
    header { background: #1a1a2e; color: #fff; padding: 1rem 2rem; display: flex; align-items: center; justify-content: space-between; }
    .logo { font-size: 1.25rem; font-weight: 700; letter-spacing: -0.01em; text-decoration: none; color: #fff; }
    nav { display: flex; gap: 1.5rem; }
    nav a { color: rgba(255,255,255,.8); text-decoration: none; font-size: .875rem; font-weight: 500; transition: color 0.2s; }
    nav a:hover { color: #fff; }
    .hero { text-align: center; padding: 5rem 1.5rem 4rem; max-width: 700px; margin: 0 auto; }
    .hero h1 { font-size: clamp(2rem, 5vw, 3rem); font-weight: 800; color: #0f172a; line-height: 1.15; margin-bottom: 1.25rem; }
    .hero p { font-size: 1.125rem; color: #475569; max-width: 540px; margin: 0 auto 2.5rem; }
    .subscribe-form { display: flex; gap: .5rem; max-width: 440px; margin: 0 auto; flex-wrap: wrap; justify-content: center; }
    .subscribe-form input[type="email"] { flex: 1 1 240px; padding: .75rem 1rem; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 1rem; outline: none; transition: border-color 0.2s; background: #fff; color: #1e293b; }
    .subscribe-form input[type="email"]:focus { border-color: #2563eb; }
    .subscribe-form button[type="submit"] { padding: .75rem 1.5rem; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.2s; white-space: nowrap; }
    .subscribe-form button[type="submit"]:hover { background: #1d4ed8; }
    .subscribe-form button[type="submit"]:disabled { background: #94a3b8; cursor: not-allowed; }
    .form-message { width: 100%; text-align: center; font-size: .875rem; margin-top: .75rem; min-height: 1.25rem; }
    .form-message.success { color: #059669; }
    .form-message.error { color: #dc2626; }
    .ring-section { text-align: center; padding: 3rem 1.5rem 2rem; max-width: 700px; margin: 0 auto; }
    .ring-section h2 { font-size: 1.5rem; font-weight: 800; color: #0f172a; margin-bottom: .5rem; }
    .ring-section p.ring-subtitle { font-size: .95rem; color: #64748b; margin-bottom: 2.5rem; }
    .ring-container { position: relative; width: 340px; height: 340px; margin: 0 auto; }
    .ring-path { position: absolute; inset: 0; border: 2.5px dashed #cbd5e1; border-radius: 50%; pointer-events: none; }
    .ring-node { position: absolute; width: 100px; height: 100px; border-radius: 50%; display: flex; align-items: center; justify-content: center; text-align: center; font-size: .78rem; font-weight: 700; color: #fff; line-height: 1.2; padding: .5rem; box-shadow: 0 2px 8px rgba(0,0,0,.12); transition: transform 0.25s ease, box-shadow 0.25s ease; }
    .ring-node:hover { transform: scale(1.08); box-shadow: 0 4px 16px rgba(0,0,0,.2); }
    .ring-node.n-ep  { background: #2563eb; top: 8px;   left: 18px; }
    .ring-node.n-br  { background: #7c3aed; top: 8px;   right: 18px; }
    .ring-node.n-bv  { background: #059669; top: 50%;    right: -12px; transform: translateY(-50%); }
    .ring-node.n-bv:hover { transform: translateY(-50%) scale(1.08); }
    .ring-node.n-bi  { background: #d97706; bottom: 8px; right: 18px; }
    .ring-node.n-mg  { background: #dc2626; bottom: 8px; left: 18px; }
    .ring-node.n-ol  { background: #0891b2; top: 50%;    left: -12px; transform: translateY(-50%); }
    .ring-node.n-ol:hover { transform: translateY(-50%) scale(1.08); }
    @media (min-width: 600px) {
      .ring-container { width: 440px; height: 440px; }
      .ring-node { width: 120px; height: 120px; font-size: .85rem; }
      .ring-node.n-ep  { top: 6px;   left: 24px; }
      .ring-node.n-br  { top: 6px;   right: 24px; }
      .ring-node.n-bv  { right: -18px; }
      .ring-node.n-bi  { bottom: 6px; right: 24px; }
      .ring-node.n-mg  { bottom: 6px; left: 24px; }
      .ring-node.n-ol  { left: -18px; }
    }
    @media (max-width: 380px) {
      .ring-container { width: 280px; height: 280px; }
      .ring-node { width: 82px; height: 82px; font-size: .7rem; padding: .35rem; }
      .ring-node.n-ep  { top: 4px;   left: 10px; }
      .ring-node.n-br  { top: 4px;   right: 10px; }
      .ring-node.n-bv  { right: -8px; }
      .ring-node.n-bi  { bottom: 4px; right: 10px; }
      .ring-node.n-mg  { bottom: 4px; left: 10px; }
      .ring-node.n-ol  { left: -8px; }
    }
    .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.5rem; max-width: 960px; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
    .feature-card { background: #fff; border-radius: 12px; padding: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,.06); border: 1px solid #e2e8f0; }
    .feature-icon { width: 48px; height: 48px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; margin-bottom: 1rem; }
    .feature-icon.events { background: #eff6ff; color: #2563eb; }
    .feature-icon.sponsors { background: #fef3c7; color: #d97706; }
    .feature-icon.community { background: #dcfce7; color: #059669; }
    .feature-card h3 { font-size: 1.1rem; font-weight: 700; color: #0f172a; margin-bottom: .5rem; }
    .feature-card p { font-size: .9rem; color: #64748b; line-height: 1.5; }
    footer { background: #1a1a2e; color: rgba(255,255,255,.6); text-align: center; padding: 2rem 1.5rem; font-size: .8rem; }
    footer a { color: rgba(255,255,255,.8); text-decoration: none; }
    footer a:hover { color: #fff; }
    @media (max-width: 480px) { header { padding: .75rem 1rem; } nav { gap: 1rem; } .hero { padding: 3rem 1rem 2.5rem; } .subscribe-form { flex-direction: column; } .subscribe-form input[type="email"], .subscribe-form button[type="submit"] { width: 100%; flex: none; } .features { padding: 2rem 1rem 3rem; } }
  </style>
</head>
<body>
  <header>
    <span class="logo">OurSharedEvents</span>
    <nav>
      <a href="/events">Events</a>
      <a href="/admin">Admin</a>
    </nav>
  </header>
  <main>
    <section class="hero">
      <h1>Gather with your neighborhood on Chicago&#x2019;s Southside</h1>
      <p>Community events that bring people together. Stay in the loop and be the first to know when something&#x2019;s happening near you.</p>
      <form class="subscribe-form" id="subscribe-form" novalidate>
        <label for="email-input" class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);">Email address</label>
        <input type="email" id="email-input" name="email" placeholder="Enter your email" aria-label="Email address" required>
        <button type="submit">Stay in the Loop</button>
        <div class="form-message" id="form-message" role="status" aria-live="polite"></div>
      </form>
    </section>
    <section class="ring-section" aria-label="Focus neighborhoods">
      <h2>Our Neighborhood Ring</h2>
      <p class="ring-subtitle">Six Southside communities. One connected flywheel.</p>
      <div class="ring-container" data-testid="ring-layout">
        <div class="ring-path" aria-hidden="true"></div>
        <div class="ring-node n-ep" data-testid="ring-node-ep">Evergreen Park</div>
        <div class="ring-node n-br" data-testid="ring-node-br">Brainard</div>
        <div class="ring-node n-bv" data-testid="ring-node-bv">Beverly</div>
        <div class="ring-node n-bi" data-testid="ring-node-bi">Blue Island</div>
        <div class="ring-node n-mg" data-testid="ring-node-mg">Mt Greenwood</div>
        <div class="ring-node n-ol" data-testid="ring-node-ol">Oak Lawn</div>
      </div>
    </section>
    <section class="features">
      <div class="feature-card">
        <div class="feature-icon events" role="img" aria-hidden="true">&#x1F4C5;</div>
        <h3>Shared Events</h3>
        <p>Browse upcoming gatherings, leagues, and community nights happening across the neighborhood.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon sponsors" role="img" aria-hidden="true">&#x1F91D;</div>
        <h3>Local Sponsors</h3>
        <p>Neighborhood businesses supporting the events you love. Real partnerships, real impact.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon community" role="img" aria-hidden="true">&#x1F3D8;</div>
        <h3>Community First</h3>
        <p>Built for the Southside, by the Southside. Every event strengthens the bonds that matter.</p>
      </div>
    </section>
  </main>
  <footer>
    <p>&#xA9; 2026 OurSharedEvents &#xB7; <a href="/events">Browse Events</a></p>
  </footer>
  <script type="module">
    const form = document.getElementById('subscribe-form');
    const emailInput = document.getElementById('email-input');
    const messageEl = document.getElementById('form-message');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();

      if (!email) {
        emailInput.setCustomValidity('Please enter your email address.');
        emailInput.reportValidity();
        return;
      }

      const emailPattern = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
      if (!emailPattern.test(email)) {
        emailInput.setCustomValidity('Please enter a valid email address.');
        emailInput.reportValidity();
        return;
      }

      emailInput.setCustomValidity('');
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Sending\\u2026';
      messageEl.textContent = '';
      messageEl.className = 'form-message';

      try {
        const res = await fetch('/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();

        if (res.ok && data.success) {
          messageEl.textContent = "Thank you \\u2014 you're in! We'll reach out when something's ready.";
          messageEl.className = 'form-message success';
          emailInput.value = '';
        } else {
          messageEl.textContent = data.error || 'Something went wrong. Please try again.';
          messageEl.className = 'form-message error';
        }
      } catch {
        messageEl.textContent = 'Could not connect. Please try again later.';
        messageEl.className = 'form-message error';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Stay in the Loop';
      }
    });

    emailInput.addEventListener('input', () => {
      emailInput.setCustomValidity('');
    });
  </script>
</body>
</html>`;

// ─── Handlers ───────────────────────────────────────────────────────────────────

/** Generate a cryptographic nonce for CSP script-src. */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Base64-encode using btoa on a binary string
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Build security headers with a per-request nonce. */
function securityHeaders(nonce: string): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'`,
  };
}

/**
 * Serve an HTML page with nonce-based CSP.
 * Replaces `<script` with `<script nonce="..."` so inline scripts are allowed
 * only for this specific response.
 */
function html(content: string, status = 200): Response {
  const nonce = generateNonce();
  // Inject nonce into all <script> tags (handles <script>, <script type="module">, etc.)
  const nonced = content.replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`);
  return new Response(nonced, {
    status,
    headers: securityHeaders(nonce),
  });
}

export function handlePublicPage(_env: PagesEnv): Response {
  return html(PUBLIC_HTML);
}

export function handleAdminPage(_env: PagesEnv): Response {
  return html(ADMIN_HTML);
}

// ─── Rate limiter (per-isolate, in-memory sliding window) ────────────────────
// Cloudflare Workers share isolates across requests. This provides basic burst
// protection within a single isolate. For cross-isolate enforcement, upgrade
// to KV or Durable Objects in Phase 2.

const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX_REQUESTS = 10;  // max 10 subscribe attempts per IP per minute
const RATE_MAX_BUCKETS = 10_000;
const RATE_EVICT_BATCH = 200;  // evict up to 200 stale entries per request
const rateBuckets = new Map<string, number[]>();
let evictCursor: string | undefined;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateBuckets.get(ip) ?? [];
  const recent = timestamps.filter(t => now - t < RATE_WINDOW_MS);

  if (recent.length >= RATE_MAX_REQUESTS) {
    rateBuckets.set(ip, recent);
    return true;
  }

  recent.push(now);
  rateBuckets.set(ip, recent);

  // Incremental eviction: scan a small batch per request to avoid blocking
  if (rateBuckets.size > RATE_MAX_BUCKETS) {
    let evicted = 0;
    let started = false;
    for (const [key, ts] of rateBuckets) {
      if (evictCursor && !started) {
        if (key === evictCursor) started = true;
        else continue;
      }
      const active = ts.filter(t => now - t < RATE_WINDOW_MS);
      if (active.length === 0) {
        rateBuckets.delete(key);
      } else {
        rateBuckets.set(key, active); // compact timestamps
      }
      evicted++;
      if (evicted >= RATE_EVICT_BATCH) { evictCursor = key; return false; }
    }
    evictCursor = undefined; // wrapped around
  }

  return false;
}

/** Max request body size for subscribe endpoint (2 KB). */
const SUBSCRIBE_MAX_BODY = 2048;

export async function handleSubscribe(request: Request, env: PagesEnv): Promise<Response> {
  // Rate limit by Cloudflare's trusted client IP header only
  const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (isRateLimited(clientIp)) {
    return Response.json(
      { success: false, error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  // Reject requests without Content-Length to prevent chunked transfer abuse
  const contentLength = request.headers.get('Content-Length');
  if (!contentLength) {
    return Response.json({ success: false, error: 'Content-Length required.' }, { status: 411 });
  }
  if (parseInt(contentLength, 10) > SUBSCRIBE_MAX_BODY) {
    return Response.json({ success: false, error: 'Payload too large.' }, { status: 413 });
  }

  try {
    const rawText = await request.text();
    if (rawText.length > SUBSCRIBE_MAX_BODY) {
      return Response.json({ success: false, error: 'Payload too large.' }, { status: 413 });
    }

    const body = JSON.parse(rawText) as { email?: string };
    const email = typeof body?.email === 'string' ? body.email.trim() : '';

    if (!email) {
      return Response.json({ success: false, error: 'Email is required.' }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
      return Response.json({ success: false, error: 'Please enter a valid email address.' }, { status: 400 });
    }
    if (email.length > 254) {
      return Response.json({ success: false, error: 'Email address is too long.' }, { status: 400 });
    }

    // Persist to D1 if available (graceful fallback if DB not provisioned)
    let persisted = false;
    if (env.DB) {
      try {
        await env.DB.prepare(
          'INSERT INTO subscribers (email, ip_address, source) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING'
        ).bind(email, clientIp, 'landing').run();
        persisted = true;
      } catch (dbErr) {
        // Log but don't fail the request — email capture is best-effort in Phase 1
        console.error(JSON.stringify({ type: 'SUBSCRIBE_DB_ERROR', error: dbErr instanceof Error ? dbErr.message : String(dbErr) }));
      }
    }

    return Response.json({ success: true, persisted });
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }
}

export function handleLandingPage(_env: PagesEnv): Response {
  return html(LANDING_HTML);
}
