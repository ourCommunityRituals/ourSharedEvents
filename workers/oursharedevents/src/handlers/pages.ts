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
      const container = document.getElementById('events');
      try {
        const res  = await fetch('/api/v2/admin/events');
        const data = await res.json();
        if (!data.ok || !data.items.length) {
          container.innerHTML = '<p class="loading">No events found.</p>';
          return;
        }
        function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
        const rows = data.items.map(e => {
          const safeName = esc(e.name || 'Untitled');
          const safeNameAttr = safeName.replace(/'/g, "\\\\'");
          return \`
          <tr onclick="window.loadForms('\${e.id}', '\${safeNameAttr}'); document.querySelectorAll('tr.selected').forEach(r=>r.classList.remove('selected')); this.classList.add('selected');" style="cursor:pointer">
            <td>\${esc(e.id)}</td>
            <td>\${safeName}</td>
            <td>\${e.startDateISO ? new Date(e.startDateISO).toLocaleDateString() : '—'}</td>
            <td>\${esc(e.venue || '—')}</td>
            <td><span class="badge \${e.status}">\${esc(e.status)}</span></td>
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

// ─── Handlers ───────────────────────────────────────────────────────────────────

function html(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export function handlePublicPage(_env: PagesEnv): Response {
  return html(PUBLIC_HTML);
}

export function handleAdminPage(_env: PagesEnv): Response {
  return html(ADMIN_HTML);
}
