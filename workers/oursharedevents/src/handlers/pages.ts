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
