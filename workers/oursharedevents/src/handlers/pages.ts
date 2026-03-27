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
            <h3>\${e.name || 'Untitled Event'}</h3>
            <p class="meta">
              \${e.startDateISO ? new Date(e.startDateISO).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) : ''}
              \${e.venue ? ' &middot; ' + e.venue : ''}
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
    .badge { display: inline-block; padding: .15rem .5rem; border-radius: 4px; font-size: .75rem; font-weight: 600; }
    .badge.active   { background: #d3f9d8; color: #2f9e44; }
    .badge.archived { background: #f1f3f5; color: #868e96; }
    .loading { text-align: center; padding: 3rem; color: #868e96; }
    .error   { text-align: center; padding: 2rem; color: #e03131; }
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
      const container = document.getElementById('events');
      try {
        const res  = await fetch('/api/v2/admin/events');
        const data = await res.json();
        if (!data.ok || !data.items.length) {
          container.innerHTML = '<p class="loading">No events found.</p>';
          return;
        }
        const rows = data.items.map(e => \`
          <tr>
            <td>\${e.id}</td>
            <td>\${e.name || '—'}</td>
            <td>\${e.startDateISO ? new Date(e.startDateISO).toLocaleDateString() : '—'}</td>
            <td>\${e.venue || '—'}</td>
            <td><span class="badge \${e.status}">\${e.status}</span></td>
          </tr>
        \`).join('');
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
</body>
</html>`;

// ─── Landing page ───────────────────────────────────────────────────────────────

const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OurSharedEvents</title>
  <meta name="description" content="Community events bringing Chicago's Southside together.">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.6; }
    header { background: #1a1a2e; color: #fff; padding: 1rem 2rem; display: flex; align-items: center; justify-content: space-between; }
    .logo { font-size: 1.25rem; font-weight: 700; color: #fff; text-decoration: none; }
    nav { display: flex; gap: 1.5rem; }
    nav a { color: rgba(255,255,255,.8); text-decoration: none; font-size: .875rem; font-weight: 500; }
    nav a:hover { color: #fff; }
    .hero { text-align: center; padding: 5rem 1.5rem 4rem; max-width: 700px; margin: 0 auto; }
    .hero h1 { font-size: clamp(2rem, 5vw, 3rem); font-weight: 800; color: #0f172a; line-height: 1.15; margin-bottom: 1.25rem; }
    .hero p { font-size: 1.125rem; color: #475569; max-width: 540px; margin: 0 auto 2.5rem; }
    .subscribe-form { display: flex; gap: .5rem; max-width: 440px; margin: 0 auto; flex-wrap: wrap; justify-content: center; }
    .subscribe-form input[type="email"] { flex: 1 1 240px; padding: .75rem 1rem; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 1rem; outline: none; background: #fff; color: #1e293b; }
    .subscribe-form input[type="email"]:focus { border-color: #2563eb; }
    .subscribe-form button[type="submit"] { padding: .75rem 1.5rem; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; }
    .subscribe-form button[type="submit"]:hover { background: #1d4ed8; }
    .subscribe-form button[type="submit"]:disabled { background: #94a3b8; cursor: not-allowed; }
    .form-message { width: 100%; text-align: center; font-size: .875rem; margin-top: .75rem; min-height: 1.25rem; }
    .form-message.success { color: #059669; }
    .form-message.error { color: #dc2626; }
    .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.5rem; max-width: 960px; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
    .feature-card { background: #fff; border-radius: 12px; padding: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,.06); border: 1px solid #e2e8f0; }
    .feature-card h3 { font-size: 1.1rem; font-weight: 700; color: #0f172a; margin-bottom: .5rem; }
    .feature-card p { font-size: .9rem; color: #64748b; }
    footer { background: #1a1a2e; color: rgba(255,255,255,.6); text-align: center; padding: 2rem 1.5rem; font-size: .8rem; }
    footer a { color: rgba(255,255,255,.8); text-decoration: none; }
    @media (max-width: 480px) { .hero { padding: 3rem 1rem 2.5rem; } .subscribe-form { flex-direction: column; } .subscribe-form input, .subscribe-form button { width: 100%; flex: none; } }
  </style>
</head>
<body>
  <header>
    <span class="logo">OurSharedEvents</span>
    <nav><a href="/events">Events</a><a href="/admin">Admin</a></nav>
  </header>
  <main>
    <section class="hero">
      <h1>Gather with your neighborhood on Chicago&rsquo;s Southside</h1>
      <p>Community events that bring people together. Stay in the loop and be the first to know when something&rsquo;s happening near you.</p>
      <form class="subscribe-form" id="subscribe-form" novalidate>
        <label for="email-input" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);">Email address</label>
        <input type="email" id="email-input" name="email" placeholder="Enter your email" aria-label="Email address" required>
        <button type="submit">Stay in the Loop</button>
        <div class="form-message" id="form-message" role="status" aria-live="polite"></div>
      </form>
    </section>
    <section class="features">
      <div class="feature-card"><h3>Shared Events</h3><p>Browse upcoming gatherings, leagues, and community nights across the neighborhood.</p></div>
      <div class="feature-card"><h3>Local Sponsors</h3><p>Neighborhood businesses supporting the events you love.</p></div>
      <div class="feature-card"><h3>Community First</h3><p>Built for the Southside, by the Southside. Every event strengthens the bonds that matter.</p></div>
    </section>
  </main>
  <footer><p>&copy; 2026 OurSharedEvents &middot; <a href="/events">Browse Events</a></p></footer>
  <script type="module">
    const form = document.getElementById('subscribe-form');
    const emailInput = document.getElementById('email-input');
    const messageEl = document.getElementById('form-message');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      if (!email) { emailInput.setCustomValidity('Please enter your email address.'); emailInput.reportValidity(); return; }
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) { emailInput.setCustomValidity('Please enter a valid email address.'); emailInput.reportValidity(); return; }
      emailInput.setCustomValidity('');
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Sending\\u2026';
      messageEl.textContent = ''; messageEl.className = 'form-message';
      try {
        const res = await fetch('/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
        const data = await res.json();
        if (res.ok && data.success) {
          messageEl.textContent = "Thank you \\u2014 you're in! We'll reach out when something's ready.";
          messageEl.className = 'form-message success';
          emailInput.value = '';
        } else {
          messageEl.textContent = data.error || 'Something went wrong. Please try again.';
          messageEl.className = 'form-message error';
        }
      } catch { messageEl.textContent = 'Could not connect. Please try again later.'; messageEl.className = 'form-message error'; }
      finally { btn.disabled = false; btn.textContent = 'Stay in the Loop'; }
    });
    emailInput.addEventListener('input', () => { emailInput.setCustomValidity(''); });
  </script>
</body>
</html>`;

// ─── Handlers ───────────────────────────────────────────────────────────────────

function html(content: string, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(content, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...extraHeaders },
  });
}

export function handlePublicPage(_env: PagesEnv): Response {
  return html(PUBLIC_HTML);
}

export function handleAdminPage(_env: PagesEnv): Response {
  return html(ADMIN_HTML);
}

export async function handleSubscribe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { email?: string };
    const email = typeof body?.email === 'string' ? body.email.trim() : '';

    if (!email) {
      return Response.json({ success: false, error: 'Email is required.' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ success: false, error: 'Please enter a valid email address.' }, { status: 400 });
    }

    // Phase 1: acknowledge the subscription (no persistence backend yet)
    return Response.json({ success: true });
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }
}

export function handleLandingPage(_env: PagesEnv): Response {
  return html(LANDING_HTML, 200, {
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'",
  });
}
