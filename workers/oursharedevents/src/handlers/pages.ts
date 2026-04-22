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
      display: flex; justify-content: space-between; align-items: center; gap: 1rem;
    }
    .event-card .event-info { flex: 1; min-width: 0; }
    .event-card h3 { font-size: 1rem; font-weight: 600; margin-bottom: .35rem; }
    .event-card .meta { font-size: .85rem; color: #6c757d; }
    .event-card .cta { display: inline-block; padding: .5rem 1.25rem; background: #4361ee; color: #fff; border-radius: 6px; font-size: .85rem; font-weight: 600; text-decoration: none; white-space: nowrap; transition: background .2s; flex-shrink: 0; }
    .event-card .cta:hover { background: #3451d1; }
    .event-card .cta:focus-visible { outline: 2px solid #4361ee; outline-offset: 2px; }
    .loading { text-align: center; padding: 3rem; color: #6c757d; font-size: .95rem; }
    .error   { text-align: center; padding: 2rem; color: #e03131; }
    .sponsor-strip { display: flex; align-items: center; gap: 1.5rem; padding: .75rem 0; margin-bottom: 1rem; overflow-x: auto; }
    .sponsor-strip:empty { display: none; }
    .sponsor-card { display: flex; align-items: center; gap: .5rem; flex-shrink: 0; }
    .sponsor-card img { height: 32px; width: auto; max-width: 100px; object-fit: contain; }
    .sponsor-card a { font-size: .8rem; color: #4361ee; text-decoration: none; font-weight: 500; }
    .sponsor-card a:hover { text-decoration: underline; }
    .sponsor-card a:focus-visible { outline: 2px solid #4361ee; outline-offset: 2px; }
    .skip-link { position: absolute; left: -9999px; top: auto; width: 1px; height: 1px; overflow: hidden; }
    .skip-link:focus { position: fixed; top: 0; left: 0; width: auto; height: auto; padding: .5rem 1rem; background: #1a1a2e; color: #fff; font-size: 1rem; z-index: 9999; text-decoration: none; border-bottom: 2px solid #4361ee; }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to content</a>
  <header data-testid="public-header">
    <h1>OurSharedEvents</h1>
  </header>
  <main id="main-content" data-testid="public-main">
    <div id="sponsor-banner" data-testid="public-sponsor-banner"></div>
    <h2>Upcoming Events</h2>
    <div id="events" data-testid="public-events"><p class="loading">Loading events&hellip;</p></div>
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
        container.innerHTML = data.items.map(e => {
          const safeId = esc(String(e.id || ''));
          const safeName = esc(e.name || e.title || 'Untitled Event');
          const encodedName = encodeURIComponent(e.name || e.title || 'Event');
          const dateStr = e.startDateISO || e.start_date
            ? esc(new Date(e.startDateISO || e.start_date).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }))
            : '';
          const venueStr = (e.venue || e.location) ? ' &middot; ' + esc(e.venue || e.location) : '';
          return \`
          <div class="event-card" data-testid="public-event-card" data-event-id="\${safeId}">
            <div class="event-info">
              <h3 data-testid="public-event-name">\${safeName}</h3>
              <p class="meta" data-testid="public-event-meta">\${dateStr}\${venueStr}</p>
            </div>
            <a class="cta" href="/forms/\${safeId}?type=register&event=\${encodedName}" data-testid="public-event-cta" aria-label="Register for \${safeName}">Register</a>
          </div>\`;
        }).join('');
      } catch (err) {
        container.innerHTML = '<p class="error" data-testid="public-error">Could not load events. Please try again.</p>';
      }
    })();
  </script>
  <script>
    (async () => {
      const banner = document.getElementById('sponsor-banner');
      if (!banner) return;
      try {
        const params = new URLSearchParams(window.location.search);
        const eventId = params.get('event');
        if (!eventId) return;
        const res = await fetch('/api/v2/events/' + encodeURIComponent(eventId) + '/sponsor-bundle?surface=public');
        const data = await res.json();
        if (!data.ok) return;
        const sponsors = data.bundle?.surface_sponsors?.mobileBanner || [];
        if (!sponsors.length) return;
        const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
        banner.innerHTML = sponsors.map(s => {
          const logo = s.logo_url ? '<img src="' + esc(s.logo_url) + '" alt="' + esc(s.name) + '">' : '';
          const link = s.website_url ? '<a href="' + esc(s.website_url) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a>' : '<span>' + esc(s.name) + '</span>';
          return '<div class="sponsor-card" data-testid="public-sponsor-card">' + logo + link + '</div>';
        }).join('');
        banner.classList.add('sponsor-strip');
        sponsors.forEach(s => {
          fetch('/api/v2/events/' + encodeURIComponent(eventId) + '/sponsors/' + encodeURIComponent(s.id) + '/impression', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ surface: 'public', placement: 'mobileBanner' })
          }).catch(() => {});
        });
      } catch { /* sponsor loading is non-critical */ }
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
    .tier-badge { display: inline-block; padding: .2rem .6rem; border-radius: 12px; font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin-left: .75rem; }
    .tier-badge.free       { background: #d3f9d8; color: #155724; }
    .tier-badge.mid        { background: #d0ebff; color: #1971c2; }
    .tier-badge.enterprise { background: #e8deee; color: #7c3aed; }
    .feature-locked { position: relative; opacity: .5; }
    .feature-locked::after { content: '🔒'; position: absolute; top: .5rem; right: .5rem; font-size: 1rem; }
    .feature-locked .form-link { pointer-events: none; }
    .lock-overlay { display: none; padding: .5rem .75rem; background: #fff3bf; border-radius: 6px; font-size: .8rem; color: #664d03; margin-top: .5rem; }
    .feature-locked .lock-overlay { display: block; }
    .form-config { display: flex; align-items: center; justify-content: space-between; padding: .5rem 0; border-bottom: 1px solid #f1f3f5; }
    .form-config:last-child { border-bottom: none; }
    .form-config-label { font-size: .9rem; font-weight: 500; }
    .form-config-desc { font-size: .75rem; color: #6c757d; }
    .toggle { position: relative; width: 40px; height: 22px; flex-shrink: 0; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .toggle .slider { position: absolute; inset: 0; background: #dee2e6; border-radius: 22px; cursor: pointer; transition: background .2s; }
    .toggle .slider::before { content: ''; position: absolute; left: 2px; top: 2px; width: 18px; height: 18px; background: #fff; border-radius: 50%; transition: transform .2s; }
    .toggle input:checked + .slider { background: #4361ee; }
    .toggle input:checked + .slider::before { transform: translateX(18px); }
    .toggle input:disabled + .slider { opacity: .4; cursor: not-allowed; }
    .config-section { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #e9ecef; }
    .config-section h3 { font-size: .85rem; font-weight: 600; color: #495057; margin-bottom: .5rem; text-transform: uppercase; letter-spacing: .04em; }
    main { max-width: 1000px; margin: 2rem auto; padding: 0 1rem; }
    h2 { font-size: 1.1rem; font-weight: 600; color: #495057; margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    th { background: #1a1a2e; color: #fff; padding: .75rem 1rem; text-align: left; font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; }
    td { padding: .75rem 1rem; border-bottom: 1px solid #f1f3f5; font-size: .9rem; }
    tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: #f1f3f5; }
    tbody tr.selected { background: #dbe4ff; }
    .badge { display: inline-block; padding: .15rem .5rem; border-radius: 4px; font-size: .75rem; font-weight: 600; }
    .badge.active   { background: #d3f9d8; color: #155724; }
    .badge.archived { background: #f1f3f5; color: #495057; }
    .loading { text-align: center; padding: 3rem; color: #6c757d; }
    .error   { text-align: center; padding: 2rem; color: #e03131; }
    .forms-card { background: #fff; border-radius: 8px; padding: 1.25rem 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-top: 2rem; }
    .forms-card h2 { font-size: 1.1rem; font-weight: 600; color: #495057; margin-bottom: .75rem; }
    .forms-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: .75rem; }
    .form-link { display: block; padding: .75rem 1rem; background: #f8f9fa; border-radius: 6px; text-decoration: none; color: #212529; border-left: 3px solid #4361ee; }
    .form-link:hover { background: #e9ecef; }
    .form-link .form-type { font-weight: 600; font-size: .9rem; }
    .form-link .form-desc { font-size: .8rem; color: #6c757d; margin-top: .15rem; }
    .form-counts { display: grid; grid-template-columns: repeat(4, 1fr); gap: .5rem; margin-top: 1rem; }
    .form-counts .count-box { text-align: center; padding: .5rem; background: #f8f9fa; border-radius: 6px; }
    .form-counts .count-num { font-size: 1.5rem; font-weight: 700; color: #1a1a2e; }
    .form-counts .count-label { font-size: .7rem; color: #6c757d; text-transform: uppercase; }
    .surface-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 2rem; }
    .surface-card { background: #fff; border-radius: 8px; padding: 1rem 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); border-left: 3px solid #6c757d; }
    .surface-card h3 { font-size: .9rem; font-weight: 600; margin-bottom: .35rem; }
    .surface-card p { font-size: .8rem; color: #6c757d; margin-bottom: .5rem; }
    .surface-card a { font-size: .8rem; color: #4361ee; text-decoration: none; font-weight: 500; }
    .surface-card a:hover { text-decoration: underline; }
    .surface-card.poster  { border-left-color: #d97706; }
    .surface-card.display { border-left-color: #2563eb; }
    .surface-card.public  { border-left-color: #16a34a; }
    .surface-card.report  { border-left-color: #7c3aed; }
    .qr-hint { font-size: .7rem; color: #64748b; margin-top: .25rem; }
    .copy-btn { display: inline-block; padding: .2rem .5rem; background: #f1f3f5; border: 1px solid #dee2e6; border-radius: 4px; font-size: .75rem; cursor: pointer; color: #495057; margin-left: .5rem; transition: background .2s, color .2s; }
    .copy-btn:hover { background: #e9ecef; }
    .copy-btn.copied { background: #d3f9d8; color: #155724; border-color: #b2f2bb; }
    .clickable-row { cursor: pointer; }
    .muted-sm { color: #6c757d; font-size: .8rem; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
    .flex-row { display: flex; align-items: center; gap: .75rem; }
    .form-actions { display: flex; align-items: end; gap: .75rem; }
    .required-star { color: #dc2626; }
    @keyframes shimmer { 0% { background-position: -200px 0; } 100% { background-position: 200px 0; } }
    .skeleton { background: linear-gradient(90deg, #f1f3f5 25%, #e9ecef 50%, #f1f3f5 75%); background-size: 400px 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: 4px; }
    .skeleton-row { height: 1rem; margin-bottom: .5rem; }
    .skeleton-table { display: flex; flex-direction: column; gap: .5rem; padding: 1.5rem; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .skeleton-table .skeleton-row { height: 2.5rem; border-radius: 6px; }
    .skeleton-table .skeleton-row:first-child { height: 2rem; width: 60%; }
    .card-error { text-align: center; padding: 1.5rem; background: #fff5f5; border: 1px solid #ffc9c9; border-radius: 8px; color: #c92a2a; }
    .card-error .error-icon { font-size: 1.5rem; margin-bottom: .5rem; }
    .card-error .error-msg { font-size: .85rem; }
    .card-error .retry-btn { display: inline-block; margin-top: .75rem; padding: .4rem 1rem; background: #fff; border: 1px solid #dee2e6; border-radius: 6px; font-size: .8rem; cursor: pointer; color: #495057; }
    .card-error .retry-btn:hover { background: #f8f9fa; }
    .create-card { background: #fff; border-radius: 8px; padding: 1.25rem 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 2rem; border-left: 3px solid #16a34a; }
    .create-card h2 { font-size: 1.1rem; font-weight: 600; color: #495057; margin-bottom: 1rem; }
    .create-form { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
    .create-form .full-width { grid-column: 1 / -1; }
    .create-form label { display: block; font-size: .8rem; font-weight: 600; color: #495057; margin-bottom: .25rem; }
    .create-form input, .create-form select { width: 100%; padding: .5rem .75rem; border: 1px solid #dee2e6; border-radius: 6px; font-size: .9rem; background: #fff; color: #1e293b; }
    .create-form input:focus, .create-form select:focus { border-color: #4361ee; outline: none; box-shadow: 0 0 0 3px rgba(67,97,238,.12); }
    .create-btn { padding: .6rem 1.5rem; background: #16a34a; color: #fff; border: none; border-radius: 6px; font-size: .9rem; font-weight: 600; cursor: pointer; transition: background .2s; }
    .create-btn:hover { background: #15803d; }
    .create-btn:disabled { background: #64748b; cursor: not-allowed; }
    .create-msg { font-size: .85rem; margin-top: .5rem; min-height: 1.25rem; }
    .create-msg.success { color: #16a34a; }
    .create-msg.error { color: #dc2626; }
    .skip-link { position: absolute; left: -9999px; top: auto; width: 1px; height: 1px; overflow: hidden; }
    .skip-link:focus { position: fixed; top: 0; left: 0; width: auto; height: auto; padding: .5rem 1rem; background: #1a1a2e; color: #fff; font-size: 1rem; z-index: 9999; text-decoration: none; border-bottom: 2px solid #4361ee; }
    button:focus-visible { outline: 2px solid #4361ee; outline-offset: 2px; }
    .form-link:focus-visible { outline: 2px solid #4361ee; outline-offset: 2px; }
    .clickable-row:focus-visible { outline: 2px solid #4361ee; outline-offset: -2px; background: #eef2ff; }
    @media (max-width: 600px) { .create-form { grid-template-columns: 1fr; } }
    .sponsors-card { background: #fff; border-radius: 8px; padding: 1.25rem 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-top: 2rem; }
    .sponsors-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
    .sponsors-card-header h2 { margin-bottom: 0; }
    .add-spon-btn { padding: .4rem 1rem; background: #4361ee; color: #fff; border: none; border-radius: 6px; font-size: .85rem; font-weight: 600; cursor: pointer; transition: background .2s; }
    .add-spon-btn:hover { background: #3a56d4; }
    .add-spon-btn:focus-visible { outline: 2px solid #4361ee; outline-offset: 2px; }
    .cancel-btn { padding: .6rem 1rem; background: #fff; color: #495057; border: 1px solid #dee2e6; border-radius: 6px; font-size: .9rem; cursor: pointer; }
    .cancel-btn:hover { background: #f8f9fa; }
    .spon-form-wrap { background: #f8f9fa; border-radius: 6px; padding: 1rem; margin-bottom: 1rem; border-left: 3px solid #4361ee; }
    .spon-tier-pill { display: inline-block; padding: .15rem .5rem; border-radius: 4px; font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    .spon-tier-pill.title    { background: #fff9db; color: #7d5a00; }
    .spon-tier-pill.platinum { background: #e8deee; color: #7c3aed; }
    .spon-tier-pill.gold     { background: #fff3cd; color: #856404; }
    .spon-tier-pill.silver   { background: #e9ecef; color: #495057; }
    .spon-tier-pill.bronze   { background: #fde8d8; color: #9c4221; }
    .spon-tier-pill.primary  { background: #d0ebff; color: #1971c2; }
    .placement-pips { display: flex; gap: .25rem; flex-wrap: wrap; }
    .pip { display: inline-block; padding: .1rem .35rem; border-radius: 3px; font-size: .65rem; font-weight: 700; background: #e9ecef; color: #adb5bd; }
    .pip.active { background: #4361ee; color: #fff; }
    .spon-action-btn { padding: .25rem .6rem; border: 1px solid #dee2e6; border-radius: 4px; font-size: .75rem; cursor: pointer; background: #fff; color: #495057; transition: all .15s; }
    .spon-action-btn:hover { background: #f8f9fa; }
    .spon-action-btn:focus-visible { outline: 2px solid #4361ee; outline-offset: 2px; }
    .spon-action-btn.deactivate { border-color: #ffc9c9; color: #c92a2a; }
    .spon-action-btn.deactivate:hover { background: #fff5f5; }
    .placements-group { display: flex; gap: 1.25rem; flex-wrap: wrap; margin-top: .25rem; }
    .placement-check { display: flex; align-items: center; gap: .35rem; font-size: .85rem; cursor: pointer; font-weight: normal; color: #212529; }
    .placement-check input { cursor: pointer; width: auto; }
    .spon-edit-ctx { padding: .4rem .75rem; background: #e8f4fd; border-radius: 4px; font-size: .85rem; color: #1971c2; margin-bottom: .75rem; font-weight: 500; }
    .spon-row-inactive { opacity: .55; }
    .spon-ml { margin-left: .25rem; }
    .deact-confirm-lbl { font-size: .8rem; }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to content</a>
  <header data-testid="admin-header">
    <h1>OurSharedEvents<span class="tier-badge" id="tierBadge" data-testid="tier-badge"></span></h1>
    <span>Admin</span>
  </header>
  <main id="main-content" data-testid="admin-main">

    <!-- Create Event Card -->
    <div class="create-card" data-testid="create-event-card">
      <h2>Create Event</h2>
      <form id="create-event-form" data-testid="create-event-form" novalidate>
        <div class="create-form">
          <div class="full-width">
            <label for="create-title">Event Name <span class="required-star">*</span></label>
            <input type="text" id="create-title" name="title" data-testid="create-title" placeholder="Summer Block Party" maxlength="200" required />
          </div>
          <div>
            <label for="create-date">Start Date</label>
            <input type="date" id="create-date" name="start_date" data-testid="create-date" />
          </div>
          <div>
            <label for="create-venue">Venue</label>
            <input type="text" id="create-venue" name="location" data-testid="create-venue" placeholder="Evergreen Park" maxlength="500" />
          </div>
          <div class="full-width form-actions">
            <button type="submit" id="create-submit-btn" class="create-btn" data-testid="create-submit">Create Event</button>
            <div id="create-msg" class="create-msg" data-testid="create-msg"></div>
          </div>
        </div>
      </form>
    </div>

    <h2>All Events</h2>
    <div id="events" data-testid="events-container"><div class="skeleton-table" data-testid="skeleton-events"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div></div>
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
          <tr onclick="window.loadForms('\${safeId}', '\${safeName.replace(/'/g, "\\\\'")}'); document.querySelectorAll('tr.selected').forEach(r=>r.classList.remove('selected')); this.classList.add('selected');" onkeydown="if(event.key==='Enter'||event.key===' '){this.click();event.preventDefault();}" class="clickable-row" tabindex="0" data-testid="event-row-\${safeId}">
            <td data-testid="event-id">\${safeId}</td>
            <td data-testid="event-name">\${safeName}</td>
            <td data-testid="event-date">\${e.startDateISO ? esc(new Date(e.startDateISO).toLocaleDateString()) : '—'}</td>
            <td data-testid="event-venue">\${esc(e.venue || '—')}</td>
            <td><span class="badge \${esc(e.status)}" data-testid="event-status">\${esc(e.status)}</span></td>
          </tr>
        \`}).join('');
        container.innerHTML = \`
          <table data-testid="events-table">
            <thead><tr><th>ID</th><th>Name</th><th>Date</th><th>Venue</th><th>Status</th></tr></thead>
            <tbody data-testid="events-tbody">\${rows}</tbody>
          </table>
        \`;
      } catch (err) {
        container.innerHTML = '<div class="card-error" data-testid="events-error"><div class="error-icon">&#9888;</div><div class="error-msg">Could not load events.</div><button class="retry-btn" data-testid="events-retry" onclick="location.reload()">Retry</button></div>';
      }
    })();

    // ── Create Event form handler ──
    document.getElementById('create-event-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('create-submit-btn');
      const msg = document.getElementById('create-msg');
      const title = document.getElementById('create-title').value.trim();
      if (!title) { msg.textContent = 'Event name is required.'; msg.className = 'create-msg error'; return; }

      btn.disabled = true;
      btn.textContent = 'Creating\\u2026';
      msg.textContent = '';
      msg.className = 'create-msg';

      try {
        const body = { title };
        const dateVal = document.getElementById('create-date').value;
        if (dateVal) body.start_date = dateVal;
        const venueVal = document.getElementById('create-venue').value.trim();
        if (venueVal) body.location = venueVal;

        const res = await fetch('/api/v2/admin/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();

        if (res.ok && data.ok) {
          msg.textContent = 'Event created \\u2014 ' + data.id;
          msg.className = 'create-msg success';
          document.getElementById('create-title').value = '';
          document.getElementById('create-date').value = '';
          document.getElementById('create-venue').value = '';
          // Reload events table to show the new event
          location.reload();
        } else {
          msg.textContent = data.error || 'Failed to create event.';
          msg.className = 'create-msg error';
        }
      } catch (err) {
        msg.textContent = 'Network error. Please try again.';
        msg.className = 'create-msg error';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create Event';
      }
    });
  </script>

  <!-- Card 2: Forms Management -->
  <div class="forms-card" data-testid="forms-card">
    <h2>Forms (Card 2)</h2>
    <div id="forms-panel" data-testid="forms-panel"><p class="loading">Select an event to manage forms&hellip;</p></div>
  </div>
  <script>
    // Forms card — load counts and generate QR links for selected event
    window.loadForms = async function(eventId, eventName) {
      const panel = document.getElementById('forms-panel');
      panel.innerHTML = '<div class="skeleton-table" data-testid="skeleton-forms"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>';
      try {
      const types = [
        { key: 'register', flagKey: 'forms.register', label: 'Registration', desc: 'Pre-event sign-up' },
        { key: 'checkin', flagKey: 'forms.checkin', label: 'Check-in', desc: 'Walk-in door tally' },
        { key: 'survey', flagKey: 'forms.survey', label: 'Survey', desc: 'Post-event feedback', upgradeTier: 'mid' },
        { key: 'email', flagKey: 'forms.email-signup', label: 'Email List', desc: 'Voluntary opt-in', upgradeTier: 'mid' },
      ];
      const encodedName = encodeURIComponent(eventName);

      // Resolve flags for this specific event
      const eventFlagsRes = await fetch('/api/v2/admin/flags/resolve?eventId=' + eventId).then(r => r.json()).catch(() => null);
      const flags = (eventFlagsRes && eventFlagsRes.ok) ? eventFlagsRes.flags : (window._resolvedFlags || {});

      // Fetch counts in parallel
      const adminPaths = ['registrations', 'checkin-count', 'surveys', 'email-signups'];
      const counts = await Promise.all(adminPaths.map(p =>
        fetch('/api/v2/admin/events/' + eventId + '/forms/' + p).then(r => r.json()).then(d => d.count || 0).catch(() => 0)
      ));
      const countLabels = ['Registrations', 'Check-ins', 'Surveys', 'Emails'];

      // Form links — locked if flag is off
      const linksHtml = types.map(t => {
        const enabled = flags[t.flagKey] !== false;
        const lockedClass = enabled ? '' : ' feature-locked';
        const lockMsg = enabled ? '' : '<div class="lock-overlay">Upgrade to ' + (t.upgradeTier || 'mid') + ' to unlock</div>';
        return '<div class="' + lockedClass + '" data-testid="form-gate-' + t.key + '">' +
          '<a class="form-link" href="/forms/' + eventId + '?type=' + t.key + '&event=' + encodedName + '" target="_blank" data-testid="form-link-' + t.key + '">' +
            '<div class="form-type">' + t.label + '</div>' +
            '<div class="form-desc">' + t.desc + '</div>' +
          '</a>' + lockMsg + '</div>';
      }).join('');

      // Inline form config toggles
      const configHtml = types.map((t, i) => {
        const globalEnabled = (window._resolvedFlags || {})[t.flagKey] !== false;
        const eventEnabled = flags[t.flagKey] !== false;
        const tierLocked = !globalEnabled && !t.upgradeTier; // truly unavailable
        const disabled = !globalEnabled ? ' disabled' : '';
        const checked = eventEnabled ? ' checked' : '';
        return '<div class="form-config" data-testid="form-config-' + t.key + '">' +
          '<div>' +
            '<div class="form-config-label">' + t.label + ' <span class="muted-sm">(' + counts[i] + ')</span></div>' +
            '<div class="form-config-desc">' + t.desc + (disabled ? ' — requires ' + (t.upgradeTier || 'upgrade') : '') + '</div>' +
          '</div>' +
          '<label class="toggle">' +
            '<input type="checkbox" data-testid="form-toggle-' + t.key + '" data-flag="' + t.flagKey + '" data-event="' + eventId + '"' + checked + disabled +
            ' onchange="toggleFormFlag(this)" />' +
            '<span class="slider"></span>' +
          '</label>' +
        '</div>';
      }).join('');

      panel.innerHTML =
        '<div class="forms-grid" data-testid="forms-grid">' + linksHtml + '</div>' +
        '<div class="form-counts" data-testid="form-counts">' +
          counts.map((c, i) =>
            '<div class="count-box" data-testid="count-' + countLabels[i].toLowerCase().replace(/\s+/g, '-') + '"><div class="count-num" data-testid="count-num">' + c + '</div><div class="count-label">' + countLabels[i] + '</div></div>'
          ).join('') +
        '</div>' +
        '<div class="config-section" data-testid="config-section">' +
          '<h3>Form Config</h3>' +
          configHtml +
        '</div>';
      } catch (err) {
        panel.innerHTML = '<div class="card-error" data-testid="forms-error"><div class="error-icon">&#9888;</div><div class="error-msg">Could not load forms.</div><button class="retry-btn" data-testid="forms-retry" onclick="window.loadForms(\'' + eventId + '\',\'' + eventName.replace(/'/g, "\\\\'") + '\')">Retry</button></div>';
      }
    };

    // Toggle a form flag for the selected event
    window.toggleFormFlag = async function(el) {
      const flagKey = el.dataset.flag;
      const eventId = el.dataset.event;
      const enabled = el.checked;
      try {
        const res = await fetch('/api/v2/admin/events/' + eventId + '/flags/' + flagKey, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Failed');
      } catch (err) {
        el.checked = !enabled; // revert on failure
        console.error('Flag toggle failed:', err);
      }
    };
  </script>

  <!-- Card 3: Sponsor Management (SPON-6) -->
  <div class="sponsors-card" data-testid="sponsors-card">
    <div class="sponsors-card-header">
      <h2>Sponsors</h2>
      <button class="add-spon-btn" id="add-spon-toggle" data-testid="add-sponsor-toggle"
        aria-expanded="false" aria-controls="spon-form-wrap">+ Add Sponsor</button>
    </div>

    <div id="spon-form-wrap" class="spon-form-wrap" hidden data-testid="sponsor-form-wrap">
      <form id="spon-create-form" data-testid="sponsor-create-form" novalidate>
        <input type="hidden" id="spon-edit-id" value="" />
        <div id="spon-edit-ctx" class="spon-edit-ctx" hidden data-testid="sponsor-edit-ctx"></div>
        <div class="create-form">
          <div>
            <label for="spon-name">Name <span class="required-star" aria-hidden="true">*</span></label>
            <input type="text" id="spon-name" name="name" data-testid="spon-name"
              placeholder="ACME Corp" maxlength="200" required autocomplete="organization"
              aria-required="true" />
          </div>
          <div>
            <label for="spon-event">Event <span class="required-star" aria-hidden="true">*</span></label>
            <select id="spon-event" name="event_id" data-testid="spon-event" required aria-required="true"></select>
          </div>
          <div>
            <label for="spon-tier">Tier</label>
            <select id="spon-tier" name="tier" data-testid="spon-tier">
              <option value="primary">Primary</option>
              <option value="bronze">Bronze</option>
              <option value="silver">Silver</option>
              <option value="gold">Gold</option>
              <option value="platinum">Platinum</option>
              <option value="title">Title</option>
            </select>
          </div>
          <div>
            <label for="spon-logo">Logo URL</label>
            <input type="text" id="spon-logo" name="logo_url" data-testid="spon-logo"
              placeholder="https://acme.com/logo.png" maxlength="500" />
          </div>
          <div class="full-width">
            <label for="spon-website">Website URL</label>
            <input type="text" id="spon-website" name="website_url" data-testid="spon-website"
              placeholder="https://acme.com" maxlength="500" />
          </div>
          <div class="full-width">
            <label>Placements</label>
            <div class="placements-group" role="group" aria-label="Placement surfaces" data-testid="placements-group">
              <label class="placement-check"><input type="checkbox" id="spon-placement-poster" data-testid="placement-poster-top" /> Poster Top</label>
              <label class="placement-check"><input type="checkbox" id="spon-placement-tvtop" data-testid="placement-tv-top" /> TV Top</label>
              <label class="placement-check"><input type="checkbox" id="spon-placement-tvside" data-testid="placement-tv-side" /> TV Side</label>
              <label class="placement-check"><input type="checkbox" id="spon-placement-mobile" data-testid="placement-mobile-banner" /> Mobile Banner</label>
            </div>
          </div>
          <div class="full-width form-actions">
            <button type="submit" id="spon-submit-btn" class="create-btn" data-testid="sponsor-submit">Save Sponsor</button>
            <button type="button" class="cancel-btn" id="spon-cancel-btn" data-testid="sponsor-cancel">Cancel</button>
            <div id="spon-form-msg" class="create-msg" role="status" aria-live="polite" data-testid="sponsor-form-msg"></div>
          </div>
        </div>
      </form>
    </div>

    <div id="sponsors-list" data-testid="sponsors-list">
      <div class="skeleton-table" data-testid="skeleton-sponsors">
        <div class="skeleton skeleton-row"></div>
        <div class="skeleton skeleton-row"></div>
        <div class="skeleton skeleton-row"></div>
      </div>
    </div>
  </div>
  <script>
    (function() {
      const esc = s => { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; };

      function parsePlc(raw) {
        try { const p = JSON.parse(raw || '{}'); return (p && typeof p === 'object') ? p : {}; } catch (e) { return {}; }
      }

      function pipHtml(raw) {
        const p = parsePlc(raw);
        const defs = [['posterTop','P'],['tvTop','TV'],['tvSide','S'],['mobileBanner','M']];
        return '<span class="placement-pips">' + defs.map(function(d) {
          return '<span class="pip' + (p[d[0]] ? ' active' : '') + '" title="' + d[0] + '">' + d[1] + '</span>';
        }).join('') + '</span>';
      }

      async function loadEventOptions(selectedId) {
        const sel = document.getElementById('spon-event');
        sel.innerHTML = '<option value="" disabled selected>Loading events\u2026</option>';
        try {
          const data = await fetch('/api/v2/admin/events').then(function(r) { return r.json(); });
          const items = (data.ok && data.items) ? data.items : [];
          sel.innerHTML = items.length
            ? items.map(function(e) {
                return '<option value="' + esc(e.id) + '"' + (e.id === selectedId ? ' selected' : '') + '>' + esc(e.name || e.id) + '</option>';
              }).join('')
            : '<option value="" disabled>No events found \u2014 create an event first</option>';
        } catch (e) {
          sel.innerHTML = '<option value="" disabled>Could not load events</option>';
        }
      }

      async function loadSponsors() {
        const wrap = document.getElementById('sponsors-list');
        wrap.innerHTML = '<div class="skeleton-table"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>';
        try {
          const data = await fetch('/api/v2/admin/sponsors').then(function(r) { return r.json(); });
          if (!data.ok) throw new Error(data.error || 'Load failed');
          const items = data.items || [];
          if (!items.length) {
            wrap.innerHTML = '<p class="loading" data-testid="sponsors-empty">No sponsors yet. Click &ldquo;+ Add Sponsor&rdquo; to add the first one.</p>';
            return;
          }
          const rows = items.map(function(s) {
            const dimStyle = s.is_active ? '' : ' class="spon-row-inactive"';
            const statusBadge = s.is_active
              ? '<span class="badge active" data-testid="spon-status-' + esc(s.id) + '">Active</span>'
              : '<span class="badge archived" data-testid="spon-status-' + esc(s.id) + '">Inactive</span>';
            const actions = s.is_active
              ? '<button class="spon-action-btn" data-testid="edit-' + esc(s.id) + '" onclick="window._editSponsor(\'' + esc(s.id) + '\')">Edit</button> ' +
                '<button class="spon-action-btn deactivate" data-testid="deactivate-' + esc(s.id) + '" onclick="window._deactivateSponsor(\'' + esc(s.id) + '\')">Deactivate</button>'
              : '<span class="muted-sm">Deactivated</span>';
            return '<tr data-testid="sponsor-row-' + esc(s.id) + '"' + dimStyle + '>' +
              '<td data-testid="spon-name-' + esc(s.id) + '">' + esc(s.name) + '</td>' +
              '<td><span class="spon-tier-pill ' + esc(s.tier) + '" data-testid="spon-tier-' + esc(s.id) + '">' + esc(s.tier) + '</span></td>' +
              '<td class="muted-sm" data-testid="spon-event-' + esc(s.id) + '">' + esc(s.event_id) + '</td>' +
              '<td data-testid="spon-placements-' + esc(s.id) + '">' + pipHtml(s.placement_formats) + '</td>' +
              '<td>' + statusBadge + '</td>' +
              '<td class="flex-row">' + actions + '</td>' +
            '</tr>';
          }).join('');
          wrap.innerHTML = '<table data-testid="sponsors-table">' +
            '<thead><tr><th scope="col">Name</th><th scope="col">Tier</th><th scope="col">Event</th><th scope="col">Placements</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>' +
            '<tbody data-testid="sponsors-tbody">' + rows + '</tbody></table>';
        } catch (err) {
          wrap.innerHTML = '<div class="card-error" data-testid="sponsors-error"><div class="error-icon">&#9888;</div><div class="error-msg">Could not load sponsors.</div><button class="retry-btn" data-testid="sponsors-retry" onclick="window._loadSponsors()">Retry</button></div>';
        }
      }
      window._loadSponsors = loadSponsors;

      function openForm() {
        const wrap = document.getElementById('spon-form-wrap');
        const btn = document.getElementById('add-spon-toggle');
        wrap.removeAttribute('hidden');
        btn.setAttribute('aria-expanded', 'true');
        btn.textContent = '\u2715 Cancel';
      }

      function doCloseForm() {
        document.getElementById('spon-form-wrap').setAttribute('hidden', '');
        document.getElementById('add-spon-toggle').setAttribute('aria-expanded', 'false');
        document.getElementById('add-spon-toggle').textContent = '+ Add Sponsor';
        document.getElementById('spon-edit-id').value = '';
        document.getElementById('spon-create-form').reset();
        const msg = document.getElementById('spon-form-msg');
        msg.textContent = '';
        msg.className = 'create-msg';
        document.getElementById('spon-submit-btn').textContent = 'Save Sponsor';
        const ctx = document.getElementById('spon-edit-ctx');
        ctx.hidden = true;
        ctx.textContent = '';
      }
      window._doCloseForm = doCloseForm;

      function formHasData() {
        return !!(document.getElementById('spon-name').value.trim() ||
                  document.getElementById('spon-edit-id').value.trim());
      }

      function closeForm() {
        if (formHasData()) {
          const msg = document.getElementById('spon-form-msg');
          msg.className = 'create-msg error';
          msg.innerHTML = 'Discard unsaved changes?\u00a0' +
            '<button class="spon-action-btn spon-ml" onclick="window._doCloseForm()" data-testid="confirm-discard">Yes, discard</button>' +
            '\u00a0<button class="spon-action-btn" onclick="document.getElementById(\'spon-form-msg\').textContent=\'\';document.getElementById(\'spon-form-msg\').className=\'create-msg\';" data-testid="keep-editing">Keep editing</button>';
          return;
        }
        doCloseForm();
      }

      document.getElementById('add-spon-toggle').addEventListener('click', function() {
        const hidden = document.getElementById('spon-form-wrap').hasAttribute('hidden');
        if (hidden) { openForm(); loadEventOptions(null); } else { closeForm(); }
      });
      document.getElementById('spon-cancel-btn').addEventListener('click', closeForm);

      window._editSponsor = async function(id) {
        openForm();
        const msg = document.getElementById('spon-form-msg');
        msg.textContent = '';
        msg.className = 'create-msg';
        try {
          const data = await fetch('/api/v2/admin/sponsors/' + id).then(function(r) { return r.json(); });
          if (!data.ok || !data.item) throw new Error('Not found');
          const s = data.item;
          await loadEventOptions(s.event_id);
          document.getElementById('spon-edit-id').value = s.id;
          document.getElementById('spon-name').value = s.name || '';
          document.getElementById('spon-event').value = s.event_id || '';
          document.getElementById('spon-tier').value = s.tier || 'primary';
          document.getElementById('spon-logo').value = s.logo_url || '';
          document.getElementById('spon-website').value = s.website_url || '';
          const p = parsePlc(s.placement_formats);
          document.getElementById('spon-placement-poster').checked = !!p.posterTop;
          document.getElementById('spon-placement-tvtop').checked = !!p.tvTop;
          document.getElementById('spon-placement-tvside').checked = !!p.tvSide;
          document.getElementById('spon-placement-mobile').checked = !!p.mobileBanner;
          document.getElementById('spon-submit-btn').textContent = 'Update Sponsor';
          const ctx = document.getElementById('spon-edit-ctx');
          ctx.textContent = 'Editing: ' + (s.name || s.id);
          ctx.hidden = false;
          document.getElementById('spon-form-wrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (e) {
          msg.textContent = 'Could not load sponsor data.';
          msg.className = 'create-msg error';
        }
      };

      window._deactivateSponsor = function(id) {
        const btn = document.querySelector('[data-testid="deactivate-' + id + '"]');
        if (!btn) return;
        const cell = btn.parentElement;
        cell.innerHTML =
          '<span class="muted-sm deact-confirm-lbl">Deactivate?</span>\u00a0' +
          '<button class="spon-action-btn deactivate" data-testid="confirm-deactivate-' + esc(id) + '" onclick="window._confirmDeactivate(\'' + esc(id) + '\')">Yes</button>' +
          '\u00a0<button class="spon-action-btn" data-testid="cancel-deactivate-' + esc(id) + '" onclick="window._loadSponsors()">No</button>';
      };

      window._confirmDeactivate = async function(id) {
        try {
          const res = await fetch('/api/v2/admin/sponsors/' + id, { method: 'DELETE' });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'Failed');
          loadSponsors();
        } catch (err) {
          alert('Could not deactivate: ' + (err.message || 'Unknown error'));
          loadSponsors();
        }
      };

      document.getElementById('spon-create-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        const btn = document.getElementById('spon-submit-btn');
        const msg = document.getElementById('spon-form-msg');
        const editId = document.getElementById('spon-edit-id').value.trim();
        const name = document.getElementById('spon-name').value.trim();
        const event_id = document.getElementById('spon-event').value.trim();

        if (!name) { msg.textContent = 'Name is required.'; msg.className = 'create-msg error'; return; }
        if (!event_id) { msg.textContent = 'Event is required.'; msg.className = 'create-msg error'; return; }

        const placements = JSON.stringify({
          posterTop: document.getElementById('spon-placement-poster').checked,
          tvTop: document.getElementById('spon-placement-tvtop').checked,
          tvSide: document.getElementById('spon-placement-tvside').checked,
          mobileBanner: document.getElementById('spon-placement-mobile').checked,
        });
        const body = { name: name, event_id: event_id, tier: document.getElementById('spon-tier').value, placement_formats: placements };
        const logoVal = document.getElementById('spon-logo').value.trim();
        if (logoVal) body.logo_url = logoVal;
        const siteVal = document.getElementById('spon-website').value.trim();
        if (siteVal) body.website_url = siteVal;

        btn.disabled = true;
        btn.textContent = editId ? 'Updating\u2026' : 'Saving\u2026';
        msg.textContent = '';
        msg.className = 'create-msg';

        try {
          const url = editId ? '/api/v2/admin/sponsors/' + editId : '/api/v2/admin/sponsors';
          const res = await fetch(url, { method: editId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed');
          msg.className = 'create-msg success';
          msg.innerHTML = (editId ? 'Sponsor updated.' : 'Sponsor created \u2014 ' + esc(data.id)) +
            '\u00a0<button class="spon-action-btn spon-ml" onclick="window._doCloseForm()" data-testid="close-after-save">Close</button>';
          loadSponsors();
        } catch (err) {
          msg.textContent = err.message || 'Could not save sponsor.';
          msg.className = 'create-msg error';
        } finally {
          btn.disabled = false;
          btn.textContent = editId ? 'Update Sponsor' : 'Save Sponsor';
        }
      });

      loadSponsors();
    })();
  </script>

  <!-- Cards 4-7: Surface Links -->
  <div class="surface-cards" data-testid="surface-cards">
    <div class="surface-card poster" data-testid="card-poster">
      <h3>Poster Page</h3>
      <p>Print-ready event poster with QR codes</p>
      <a href="/poster" target="_blank" data-testid="link-poster">Open Poster</a>
      <button class="copy-btn" data-testid="copy-poster" onclick="copyUrl('/poster', this)">Copy URL</button>
      <div class="qr-hint">QR-ready: /poster</div>
    </div>
    <div class="surface-card display" data-testid="card-display">
      <h3>TV Display</h3>
      <p>Bar TV / kiosk live event display</p>
      <a href="/display" target="_blank" data-testid="link-display">Open Display</a>
      <button class="copy-btn" data-testid="copy-display" onclick="copyUrl('/display', this)">Copy URL</button>
      <div class="qr-hint">QR-ready: /display</div>
    </div>
    <div class="surface-card public" data-testid="card-public">
      <h3>Public Page</h3>
      <p>Customer-facing events listing</p>
      <a href="/" target="_blank" data-testid="link-public">Open Public Page</a>
      <button class="copy-btn" data-testid="copy-public" onclick="copyUrl('/', this)">Copy URL</button>
      <div class="qr-hint">QR-ready: /</div>
    </div>
    <div class="surface-card report" data-testid="card-report">
      <h3>Shared Report</h3>
      <p>Post-event analytics dashboard</p>
      <a href="/sharedReport" target="_blank" data-testid="link-report">Open Report</a>
      <button class="copy-btn" data-testid="copy-report" onclick="copyUrl('/sharedReport', this)">Copy URL</button>
      <div class="qr-hint">QR-ready: /sharedReport</div>
    </div>
  </div>

  <!-- Copy URL helper -->
  <script>
    function copyUrl(path, btn) {
      const url = location.origin + path;
      navigator.clipboard.writeText(url).then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy URL'; btn.classList.remove('copied'); }, 2000);
      }).catch(() => {
        btn.textContent = 'Failed';
        setTimeout(() => { btn.textContent = 'Copy URL'; }, 2000);
      });
    }
  </script>

  <!-- Tier badge + feature gating -->
  <script>
    (async () => {
      // Fetch current tier and resolved flags in parallel
      const [tierRes, flagsRes] = await Promise.all([
        fetch('/api/v2/admin/flags/current-tier').then(r => r.json()).catch(() => null),
        fetch('/api/v2/admin/flags/resolve').then(r => r.json()).catch(() => null),
      ]);

      // Render tier badge
      const badge = document.getElementById('tierBadge');
      const tier = (tierRes && tierRes.ok) ? tierRes.tier : 'free';
      badge.textContent = tier;
      badge.className = 'tier-badge ' + tier;

      // Store resolved flags globally for form gating
      window._resolvedFlags = (flagsRes && flagsRes.ok) ? flagsRes.flags : {};
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
  <meta name="description" content="Community events bringing Chicago's Southside together. Gather with your neighborhood.">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.6; -webkit-font-smoothing: antialiased; }
    header { background: #1a1a2e; color: #fff; padding: 1rem 2rem; display: flex; align-items: center; justify-content: space-between; }
    .logo { font-size: 1.25rem; font-weight: 700; letter-spacing: -0.01em; text-decoration: none; color: #fff; }
    nav { display: flex; gap: 1.5rem; }
    nav a { color: rgba(255,255,255,.8); text-decoration: none; font-size: .875rem; font-weight: 500; transition: color 0.2s; }
    nav a:hover { color: #fff; }
    nav a:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .logo:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .hero { text-align: center; padding: 5rem 1.5rem 4rem; max-width: 700px; margin: 0 auto; }
    .hero h1 { font-size: clamp(2rem, 5vw, 3rem); font-weight: 800; color: #0f172a; line-height: 1.15; margin-bottom: 1.25rem; }
    .hero p { font-size: 1.125rem; color: #475569; max-width: 540px; margin: 0 auto 2.5rem; }
    .subscribe-form { display: flex; gap: .5rem; max-width: 440px; margin: 0 auto; flex-wrap: wrap; justify-content: center; }
    .subscribe-form input[type="email"] { flex: 1 1 240px; padding: .75rem 1rem; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 1rem; outline: none; transition: border-color 0.2s; background: #fff; color: #1e293b; }
    .subscribe-form input[type="email"]:focus { border-color: #2563eb; }
    .subscribe-form button[type="submit"] { padding: .75rem 1.5rem; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.2s; white-space: nowrap; }
    .subscribe-form button[type="submit"]:hover { background: #1d4ed8; }
    .subscribe-form button[type="submit"]:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
    .subscribe-form button[type="submit"]:disabled { background: #64748b; cursor: not-allowed; }
    .form-message { width: 100%; text-align: center; font-size: .875rem; margin-top: .75rem; min-height: 1.25rem; }
    .form-message.success { color: #059669; }
    .form-message.error { color: #dc2626; }
    .ring-section { text-align: center; padding: 3rem 1.5rem 2rem; max-width: 700px; margin: 0 auto; }
    .ring-section h2 { font-size: 1.5rem; font-weight: 800; color: #0f172a; margin-bottom: .5rem; }
    .ring-section p.ring-subtitle { font-size: .95rem; color: #64748b; margin-bottom: 2.5rem; }
    .ring-container { position: relative; width: 340px; height: 340px; margin: 0 auto; overflow: visible; }
    .ring-path { position: absolute; inset: 0; border: 2.5px dashed #cbd5e1; border-radius: 50%; pointer-events: none; }
    .ring-node { position: absolute; width: 100px; height: 100px; border-radius: 50%; display: flex; align-items: center; justify-content: center; text-align: center; font-size: .78rem; font-weight: 700; color: #fff; line-height: 1.2; padding: .5rem; box-shadow: 0 2px 8px rgba(0,0,0,.12); transition: transform 0.25s ease, box-shadow 0.25s ease; z-index: 1; }
    .ring-node:hover { transform: scale(1.08); box-shadow: 0 4px 16px rgba(0,0,0,.2); }
    .ring-node.n-ep  { background: #2563eb; top: 8px;   left: 18px; }
    .ring-node.n-br  { background: #6d28d9; top: 8px;   right: 18px; }
    .ring-node.n-bv  { background: #059669; top: 50%;    right: -12px; transform: translateY(-50%); }
    .ring-node.n-bv:hover { transform: translateY(-50%) scale(1.08); }
    .ring-node.n-bi  { background: #b45309; bottom: 8px; right: 18px; }
    .ring-node.n-mg  { background: #b91c1c; bottom: 8px; left: 18px; }
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
      .ring-section { padding-left: 2rem; padding-right: 2rem; }
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
    footer a:focus-visible { outline: 2px solid rgba(255,255,255,.8); outline-offset: 2px; }
    .skip-link { position: absolute; left: -9999px; top: auto; width: 1px; height: 1px; overflow: hidden; }
    .skip-link:focus { position: fixed; top: 0; left: 0; width: auto; height: auto; padding: .5rem 1rem; background: #1a1a2e; color: #fff; font-size: 1rem; z-index: 9999; text-decoration: none; border-bottom: 2px solid #4361ee; }
    @media (max-width: 480px) { header { padding: .75rem 1rem; } nav { gap: 1rem; } .hero { padding: 3rem 1rem 2.5rem; } .subscribe-form { flex-direction: column; } .subscribe-form input[type="email"], .subscribe-form button[type="submit"] { width: 100%; flex: none; } .features { padding: 2rem 1rem 3rem; } }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to content</a>
  <header data-testid="landing-header">
    <span class="logo" data-testid="landing-logo">OurSharedEvents</span>
    <nav data-testid="landing-nav">
      <a href="/events" data-testid="nav-events">Events</a>
      <a href="/admin" data-testid="nav-admin">Admin</a>
    </nav>
  </header>
  <main id="main-content" data-testid="landing-main">
    <section class="hero" data-testid="hero-section">
      <h1>Gather with your neighborhood on Chicago&#x2019;s Southside</h1>
      <p>Community events that bring people together. Stay in the loop and be the first to know when something&#x2019;s happening near you.</p>
      <form class="subscribe-form" id="subscribe-form" data-testid="subscribe-form" novalidate>
        <label for="email-input" class="sr-only">Email address</label>
        <input type="email" id="email-input" name="email" placeholder="Enter your email" aria-label="Email address" data-testid="subscribe-email" required>
        <button type="submit" data-testid="subscribe-submit">Stay in the Loop</button>
        <div class="form-message" id="form-message" role="status" aria-live="polite"></div>
      </form>
    </section>
    <section class="ring-section" aria-label="Focus neighborhoods" data-testid="ring-section">
      <h2>Our Neighborhood Ring</h2>
      <p class="ring-subtitle">Six Southside communities. One connected flywheel.</p>
      <div class="ring-container" data-testid="ring-layout">
        <div class="ring-path" aria-hidden="true"></div>
        <div class="ring-node n-ep" data-testid="ring-node-ep" aria-label="Evergreen Park neighborhood">Evergreen Park</div>
        <div class="ring-node n-br" data-testid="ring-node-br" aria-label="Brainard neighborhood">Brainard</div>
        <div class="ring-node n-bv" data-testid="ring-node-bv" aria-label="Beverly neighborhood">Beverly</div>
        <div class="ring-node n-bi" data-testid="ring-node-bi" aria-label="Blue Island neighborhood">Blue Island</div>
        <div class="ring-node n-mg" data-testid="ring-node-mg" aria-label="Mt Greenwood neighborhood">Mt Greenwood</div>
        <div class="ring-node n-ol" data-testid="ring-node-ol" aria-label="Oak Lawn neighborhood">Oak Lawn</div>
      </div>
    </section>
    <section class="features" data-testid="features-section">
      <div class="feature-card" data-testid="feature-events">
        <div class="feature-icon events" role="img" aria-hidden="true">&#x1F4C5;</div>
        <h3>Shared Events</h3>
        <p>Browse upcoming gatherings, leagues, and community nights happening across the neighborhood.</p>
      </div>
      <div class="feature-card" data-testid="feature-sponsors">
        <div class="feature-icon sponsors" role="img" aria-hidden="true">&#x1F91D;</div>
        <h3>Local Sponsors</h3>
        <p>Neighborhood businesses supporting the events you love. Real partnerships, real impact.</p>
      </div>
      <div class="feature-card" data-testid="feature-community">
        <div class="feature-icon community" role="img" aria-hidden="true">&#x1F3D8;</div>
        <h3>Community First</h3>
        <p>Built for the Southside, by the Southside. Every event strengthens the bonds that matter.</p>
      </div>
    </section>
  </main>
  <footer data-testid="landing-footer">
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
const RATE_MAX_REQUESTS = 10; // max 10 subscribe attempts per IP per minute
const RATE_MAX_BUCKETS = 10_000;
const RATE_EVICT_BATCH = 200; // evict up to 200 stale entries per request
const rateBuckets = new Map<string, number[]>();
let evictCursor: string | undefined;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateBuckets.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);

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
      const active = ts.filter((t) => now - t < RATE_WINDOW_MS);
      if (active.length === 0) {
        rateBuckets.delete(key);
      } else {
        rateBuckets.set(key, active); // compact timestamps
      }
      evicted++;
      if (evicted >= RATE_EVICT_BATCH) {
        evictCursor = key;
        return false;
      }
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
      { status: 429, headers: { 'Retry-After': '60' } }
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
      return Response.json(
        { success: false, error: 'Please enter a valid email address.' },
        { status: 400 }
      );
    }
    if (email.length > 254) {
      return Response.json(
        { success: false, error: 'Email address is too long.' },
        { status: 400 }
      );
    }

    // Persist to D1 if available (graceful fallback if DB not provisioned)
    let persisted = false;
    if (env.DB) {
      try {
        await env.DB.prepare(
          'INSERT INTO subscribers (email, ip_address, source) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING'
        )
          .bind(email, clientIp, 'landing')
          .run();
        persisted = true;
      } catch (dbErr) {
        // Log but don't fail the request — email capture is best-effort in Phase 1
        console.error(
          JSON.stringify({
            type: 'SUBSCRIBE_DB_ERROR',
            error: dbErr instanceof Error ? dbErr.message : String(dbErr),
          })
        );
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

// ─── Display page (TV / kiosk) ──────────────────────────────────────────────────

const DISPLAY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Display – OurSharedEvents</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; flex-direction: column; }
    header { background: #1a1a2e; padding: 1rem 2rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,.08); }
    header h1 { font-size: 1.4rem; font-weight: 700; letter-spacing: -0.01em; }
    .clock { font-size: 1rem; opacity: .6; font-variant-numeric: tabular-nums; }
    main { flex: 1; max-width: 1200px; width: 100%; margin: 0 auto; padding: 2rem 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; }
    .event-card {
      background: rgba(255,255,255,.05); border-radius: 12px;
      padding: 2rem 2.5rem; border: 1px solid rgba(255,255,255,.08);
    }
    .event-card .label { font-size: .75rem; text-transform: uppercase; letter-spacing: .08em; color: #64748b; margin-bottom: .5rem; }
    .event-card h2 { font-size: clamp(1.5rem, 4vw, 2.5rem); font-weight: 800; line-height: 1.15; color: #f8fafc; margin-bottom: .75rem; }
    .event-card .meta { font-size: 1.1rem; color: #64748b; display: flex; gap: 1.5rem; flex-wrap: wrap; }
    .event-card .meta span::before { content: ""; }
    .next-events { display: grid; gap: 1rem; }
    .next-events h3 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; color: #64748b; margin-bottom: .25rem; }
    .next-card { background: rgba(255,255,255,.03); border-radius: 8px; padding: 1rem 1.25rem; border: 1px solid rgba(255,255,255,.06); display: flex; justify-content: space-between; align-items: center; }
    .next-card .name { font-weight: 600; font-size: 1rem; }
    .next-card .date { font-size: .85rem; color: #64748b; }
    .empty { text-align: center; padding: 4rem; color: #475569; font-size: 1.1rem; }
    .ticker { background: #1e3a5f; padding: .6rem 2rem; font-size: .85rem; color: #93c5fd; border-top: 1px solid rgba(255,255,255,.06); overflow: hidden; white-space: nowrap; }
    .ticker-inner { display: inline-block; animation: scroll 30s linear infinite; }
    @keyframes scroll { from { transform: translateX(100vw); } to { transform: translateX(-100%); } }
    .display-sponsor-banner { display: flex; align-items: center; justify-content: center; gap: 2rem; padding: .75rem 1.5rem; background: rgba(255,255,255,.03); border-radius: 8px; border: 1px solid rgba(255,255,255,.06); min-height: 48px; }
    .display-sponsor-banner:empty { display: none; }
    .display-sponsor-sidebar { position: fixed; right: 0; top: 60px; width: 200px; padding: 1rem; display: flex; flex-direction: column; gap: 1rem; z-index: 10; }
    .display-sponsor-sidebar:empty { display: none; }
    .display-sponsor-item { display: flex; align-items: center; gap: .5rem; padding: .5rem; background: rgba(255,255,255,.05); border-radius: 6px; border: 1px solid rgba(255,255,255,.06); transition: opacity .6s ease-in-out; }
    .display-sponsor-item.fade-out { opacity: 0; }
    .display-sponsor-item img { height: 36px; width: auto; max-width: 80px; object-fit: contain; filter: brightness(1.1); }
    .display-sponsor-item .name { font-size: .8rem; color: #64748b; }
    .display-sponsor-item[data-tier="title"],
    .display-sponsor-item[data-tier="platinum"] { border-color: rgba(234,179,8,.4); background: rgba(234,179,8,.08); padding: .625rem .75rem; }
    .display-sponsor-item[data-tier="title"] img,
    .display-sponsor-item[data-tier="platinum"] img { height: 48px; max-width: 120px; }
    .display-sponsor-item[data-tier="title"] .name,
    .display-sponsor-item[data-tier="platinum"] .name { font-size: .9rem; color: #e2e8f0; font-weight: 600; }
    .display-sponsor-item[data-tier="gold"] { border-color: rgba(234,179,8,.2); }
    .display-sponsor-item[data-tier="gold"] img { height: 42px; max-width: 100px; }
    .sponsor-counter { font-size: .65rem; color: #64748b; text-align: center; margin-top: .25rem; font-variant-numeric: tabular-nums; }
    @media (min-width: 1920px) {
      header h1 { font-size: 2rem; }
      .clock { font-size: 1.4rem; }
      main { max-width: 1600px; padding: 3rem 2.5rem; gap: 2rem; }
      .event-card { padding: 3rem 3.5rem; }
      .event-card h2 { font-size: 3rem; }
      .event-card .meta { font-size: 1.4rem; }
      .display-sponsor-sidebar { width: 280px; padding: 1.5rem; top: 80px; }
      .display-sponsor-item img { height: 48px; max-width: 120px; }
      .display-sponsor-item[data-tier="title"] img,
      .display-sponsor-item[data-tier="platinum"] img { height: 64px; max-width: 160px; }
      .display-sponsor-item .name { font-size: 1rem; }
      .display-sponsor-banner { padding: 1rem 2rem; gap: 3rem; min-height: 64px; }
      .ticker { font-size: 1.1rem; padding: .8rem 2rem; }
    }
    .skip-link { position: absolute; left: -9999px; top: auto; width: 1px; height: 1px; overflow: hidden; }
    .skip-link:focus { position: fixed; top: 0; left: 0; width: auto; height: auto; padding: .5rem 1rem; background: #1a1a2e; color: #fff; font-size: 1rem; z-index: 9999; text-decoration: none; border-bottom: 2px solid #4361ee; }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to content</a>
  <header data-testid="display-header">
    <h1>OurSharedEvents</h1>
    <div class="clock" id="clock" aria-live="off" data-testid="display-clock"></div>
  </header>
  <aside id="display-sponsor-sidebar" class="display-sponsor-sidebar" data-testid="display-sponsor-sidebar"></aside>
  <main id="main-content" data-testid="display-main">
    <p class="empty">Loading&hellip;</p>
  </main>
  <div id="display-sponsor-banner" class="display-sponsor-banner" data-testid="display-sponsor-banner"></div>
  <div class="ticker" aria-hidden="true" data-testid="display-ticker"><span class="ticker-inner" id="ticker">OurSharedEvents &mdash; Community events on Chicago&rsquo;s Southside</span></div>
  <script>
    // Clock
    function updateClock() {
      const el = document.getElementById('clock');
      if (el) el.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
    updateClock();
    setInterval(updateClock, 30_000);

    // Events
    async function loadEvents() {
      const main = document.getElementById('main-content');
      try {
        const res = await fetch('/api/v2/events');
        const data = await res.json();
        const items = (data.ok && data.items) ? data.items : [];
        if (!items.length) {
          main.innerHTML = '<p class="empty">No upcoming events scheduled.</p>';
          return;
        }
        const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
        const fmt = iso => iso ? new Date(iso).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' }) : '';
        const [featured, ...rest] = items;
        let html = '<div class="event-card">' +
          '<div class="label">Upcoming Event</div>' +
          '<h2>' + esc(featured.name || 'Untitled Event') + '</h2>' +
          '<div class="meta">' +
          (featured.startDateISO ? '<span>' + esc(fmt(featured.startDateISO)) + '</span>' : '') +
          (featured.venue ? '<span>' + esc(featured.venue) + '</span>' : '') +
          '</div></div>';
        if (rest.length) {
          html += '<div class="next-events"><h3>Also Coming Up</h3>' +
            rest.slice(0, 4).map(e => '<div class="next-card"><div class="name">' + esc(e.name || 'Untitled') + '</div>' +
              '<div class="date">' + esc(fmt(e.startDateISO)) + '</div></div>').join('') +
            '</div>';
        }
        main.innerHTML = html;
        // Update ticker
        const ticker = document.getElementById('ticker');
        if (ticker) ticker.textContent = items.map(e => e.name).filter(Boolean).join(' \u2022 ');
      } catch {
        main.innerHTML = '<p class="empty">Could not load events.</p>';
      }
    }
    loadEvents();
    // Auto-refresh every 5 minutes
    setInterval(loadEvents, 5 * 60 * 1000);

    // ── Display sponsor loading + rotation ──
    async function loadDisplaySponsors() {
      const sidebar = document.getElementById('display-sponsor-sidebar');
      const banner = document.getElementById('display-sponsor-banner');
      try {
        const evRes = await fetch('/api/v2/events');
        const evData = await evRes.json();
        const items = (evData.ok && evData.items) ? evData.items : [];
        if (!items.length || !items[0].id) return;
        const eventId = items[0].id;
        const res = await fetch('/api/v2/events/' + encodeURIComponent(eventId) + '/sponsor-bundle?surface=display');
        const data = await res.json();
        if (!data.ok) return;
        const bundle = data.bundle || {};
        const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
        const tvTop = bundle.surface_sponsors?.tvTop || [];
        const tvSide = bundle.surface_sponsors?.tvSide || [];
        if (banner && tvTop.length) {
          banner.innerHTML = tvTop.map(s => {
            const logo = s.logo_url ? '<img src="' + esc(s.logo_url) + '" alt="' + esc(s.name) + '">' : '';
            return '<div class="display-sponsor-item" data-tier="' + esc(s.tier || 'primary') + '" data-testid="display-sponsor-item">' + logo + '<span class="name">' + esc(s.name) + '</span></div>';
          }).join('');
        }
        if (sidebar && tvSide.length) {
          let idx = 0;
          const total = tvSide.length;
          function renderSideItem(s, num) {
            const logo = s.logo_url ? '<img src="' + esc(s.logo_url) + '" alt="' + esc(s.name) + '">' : '';
            return '<div class="display-sponsor-item" data-tier="' + esc(s.tier || 'primary') + '" data-testid="display-sponsor-rotate">' + logo + '<span class="name">' + esc(s.name) + '</span></div>' +
              (total > 1 ? '<div class="sponsor-counter">' + num + '/' + total + '</div>' : '');
          }
          function showNext() {
            const s = tvSide[idx % total];
            const current = sidebar.querySelector('.display-sponsor-item');
            if (current && total > 1) {
              current.classList.add('fade-out');
              setTimeout(function() {
                sidebar.innerHTML = renderSideItem(s, (idx % total) + 1);
              }, 600);
            } else {
              sidebar.innerHTML = renderSideItem(s, (idx % total) + 1);
            }
            idx++;
          }
          showNext();
          const ms = bundle.rotation_config?.rotationMs || 5000;
          setInterval(showNext, ms);
        }
        // Log impressions
        [...tvTop, ...tvSide].forEach(s => {
          fetch('/api/v2/events/' + encodeURIComponent(eventId) + '/sponsors/' + encodeURIComponent(s.id) + '/impression', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ surface: 'display', placement: s.tvTop ? 'tvTop' : 'tvSide' })
          }).catch(() => {});
        });
      } catch { /* sponsor loading is non-critical */ }
    }
    loadDisplaySponsors();
  </script>
</body>
</html>`;

// ─── Poster page (printable) ────────────────────────────────────────────────────

const POSTER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Event Poster – OurSharedEvents</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #1e293b; }
    .page-header { background: #1a1a2e; color: #fff; padding: 1rem 2rem; display: flex; align-items: center; justify-content: space-between; }
    .page-header h1 { font-size: 1.2rem; font-weight: 700; }
    .page-header a { color: rgba(255,255,255,.7); font-size: .85rem; text-decoration: none; }
    .page-header a:hover { color: #fff; }
    .container { max-width: 680px; margin: 2rem auto; padding: 0 1rem; }
    .poster {
      background: #fff; border-radius: 12px; overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,.12); border: 1px solid #e2e8f0;
    }
    .poster-header { background: #1a1a2e; color: #fff; padding: 2.5rem 2rem 2rem; text-align: center; }
    .poster-header .org { font-size: .8rem; text-transform: uppercase; letter-spacing: .12em; opacity: .6; margin-bottom: .75rem; }
    .poster-header h2 { font-size: clamp(1.5rem, 5vw, 2.25rem); font-weight: 800; line-height: 1.2; }
    .poster-body { padding: 2rem; }
    .poster-meta { display: grid; gap: .75rem; margin-bottom: 2rem; }
    .meta-row { display: flex; align-items: flex-start; gap: .75rem; }
    .meta-icon { width: 24px; flex-shrink: 0; text-align: center; font-size: 1rem; padding-top: .1rem; }
    .meta-text { font-size: 1rem; color: #334155; }
    .qr-section { display: flex; justify-content: center; gap: 2rem; flex-wrap: wrap; padding: 1.5rem 0; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; margin-bottom: 1.5rem; }
    .qr-item { text-align: center; }
    .qr-placeholder { width: 120px; height: 120px; background: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin: 0 auto .5rem; font-size: .7rem; color: #64748b; text-align: center; padding: .5rem; }
    .qr-label { font-size: .75rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
    .poster-footer { text-align: center; padding: 1rem; background: #f8fafc; font-size: .8rem; color: #64748b; }
    .loading { text-align: center; padding: 4rem; color: #64748b; }
    .error { text-align: center; padding: 3rem; color: #dc2626; }
    .event-select { margin-bottom: 1.5rem; }
    .event-select label { display: block; font-size: .875rem; font-weight: 600; color: #374151; margin-bottom: .375rem; }
    .event-select select { width: 100%; padding: .5rem .75rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: .95rem; background: #fff; color: #1e293b; }
    .poster-sponsors { display: flex; align-items: center; justify-content: center; gap: 1.5rem; padding: 1rem 2rem; flex-wrap: wrap; }
    .poster-sponsors:empty { display: none; }
    .poster-sponsor { display: flex; align-items: center; gap: .5rem; }
    .poster-sponsor img { height: 28px; width: auto; max-width: 80px; object-fit: contain; }
    .poster-sponsor-name { font-size: .75rem; color: #64748b; font-weight: 500; }
    .poster-sponsor-label { font-size: .65rem; text-transform: uppercase; letter-spacing: .06em; color: #64748b; text-align: center; margin-bottom: .35rem; }
    .poster-sponsor-tier-row { display: flex; align-items: center; justify-content: center; gap: 1rem; flex-wrap: wrap; padding: .2rem 0; }
    .poster-sponsor-tier-label { font-size: .6rem; text-transform: uppercase; letter-spacing: .06em; color: #64748b; text-align: center; width: 100%; margin-bottom: .15rem; }
    .poster-sponsor--premium img { height: 36px; }
    .poster-sponsor--premium .poster-sponsor-name { font-size: .8rem; font-weight: 600; color: #1e293b; }
    .poster-sponsor--mid img { height: 26px; }
    .poster-sponsor--local img { height: 20px; }
    .poster-sponsor--local .poster-sponsor-name { font-size: .65rem; color: #64748b; }
    .page-header a:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .event-select select:focus { border-color: #4361ee; outline: none; box-shadow: 0 0 0 3px rgba(67,97,238,.15); }
    .skip-link { position: absolute; left: -9999px; top: auto; width: 1px; height: 1px; overflow: hidden; }
    .skip-link:focus { position: fixed; top: 0; left: 0; width: auto; height: auto; padding: .5rem 1rem; background: #1a1a2e; color: #fff; font-size: 1rem; z-index: 9999; text-decoration: none; border-bottom: 2px solid #4361ee; }
    @media print {
      .page-header, .event-select, .no-print { display: none !important; }
      body { background: #fff; }
      .container { margin: 0; max-width: 100%; }
      .poster { box-shadow: none; border: none; }
    }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to content</a>
  <div class="page-header no-print" data-testid="poster-header">
    <h1>OurSharedEvents — Poster</h1>
    <a href="javascript:window.print()" data-testid="poster-print">&#x1F5A8; Print</a>
  </div>
  <div id="main-content" class="container" data-testid="poster-container">
    <div class="event-select no-print" data-testid="poster-event-select">
      <label for="event-picker">Select Event</label>
      <select id="event-picker" data-testid="poster-event-picker"><option value="">Loading events&hellip;</option></select>
    </div>
    <div id="poster-area" data-testid="poster-area"><p class="loading">Loading&hellip;</p></div>
  </div>
  <script>
    const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    const fmt = iso => iso ? new Date(iso).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) : '';
    const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }) : '';

    function renderPoster(event) {
      const data = event.data || {};
      const venue = data.venue || event.venue || '';
      const address = data.address || '';
      const startISO = data.startDateISO || event.startDateISO || '';
      const name = data.name || event.name || 'Event';

      return '<div class="poster" data-testid="poster-card">' +
        '<div class="poster-header">' +
          '<div class="org">OurSharedEvents</div>' +
          '<h2 data-testid="poster-event-title">' + esc(name) + '</h2>' +
        '</div>' +
        '<div class="poster-body">' +
          '<div class="poster-meta" data-testid="poster-meta">' +
          (startISO ? '<div class="meta-row"><div class="meta-icon">&#x1F4C5;</div><div class="meta-text">' + esc(fmt(startISO)) + (startISO ? ' &mdash; ' + esc(fmtTime(startISO)) : '') + '</div></div>' : '') +
          (venue ? '<div class="meta-row"><div class="meta-icon">&#x1F4CD;</div><div class="meta-text">' + esc(venue) + (address ? '<br><small>' + esc(address) + '</small>' : '') + '</div></div>' : '') +
          '</div>' +
          '<div class="qr-section" data-testid="poster-qr">' +
            '<div class="qr-item"><div class="qr-placeholder">QR codes available after event setup</div><div class="qr-label">Event Page</div></div>' +
            '<div class="qr-item"><div class="qr-placeholder">QR codes available after event setup</div><div class="qr-label">Registration</div></div>' +
          '</div>' +
        '</div>' +
        '<div id="poster-sponsor-strip" class="poster-sponsors" data-testid="poster-sponsor-strip"></div>' +
        '<div class="poster-footer" data-testid="poster-footer">oursharedevents.com</div>' +
      '</div>';
    }

    async function init() {
      const picker = document.getElementById('event-picker');
      const area = document.getElementById('poster-area');
      try {
        const res = await fetch('/api/v2/events');
        const data = await res.json();
        const items = (data.ok && data.items) ? data.items : [];
        if (!items.length) {
          picker.innerHTML = '<option>No events available</option>';
          area.innerHTML = '<p class="loading">No events scheduled.</p>';
          return;
        }
        picker.innerHTML = items.map((e, i) =>
          '<option value="' + i + '">' + esc(e.name || 'Untitled Event') + '</option>'
        ).join('');
        area.innerHTML = renderPoster(items[0]);
        loadPosterSponsors(items[0].id);
        picker.addEventListener('change', () => {
          const idx = parseInt(picker.value, 10);
          if (!isNaN(idx) && items[idx]) {
            area.innerHTML = renderPoster(items[idx]);
            loadPosterSponsors(items[idx].id);
          }
        });
      } catch {
        area.innerHTML = '<p class="error">Could not load events.</p>';
      }
    }
    async function loadPosterSponsors(eventId) {
      const strip = document.getElementById('poster-sponsor-strip');
      if (!strip || !eventId) return;
      try {
        const res = await fetch('/api/v2/events/' + encodeURIComponent(eventId) + '/sponsor-bundle?surface=poster');
        const data = await res.json();
        if (!data.ok) return;
        const sponsors = data.bundle?.surface_sponsors?.posterTop || [];
        if (!sponsors.length) { strip.innerHTML = ''; return; }

        const premium = sponsors.filter(function(s) { return s.tier === 'title' || s.tier === 'platinum'; });
        const mid = sponsors.filter(function(s) { return s.tier === 'gold' || s.tier === 'silver'; });
        const local = sponsors.filter(function(s) { return s.tier === 'bronze' || s.tier === 'primary'; });

        function renderTierRow(group, mod, testid, label) {
          if (!group.length) return '';
          return '<div class="poster-sponsor-tier-row" data-testid="' + testid + '">' +
            (label ? '<span class="poster-sponsor-tier-label">' + label + '</span>' : '') +
            group.map(function(s) {
              var logo = s.logo_url ? '<img src="' + esc(s.logo_url) + '" alt="' + esc(s.name) + '">' : '';
              return '<div class="poster-sponsor poster-sponsor--' + mod + '" data-testid="poster-sponsor-item">' +
                logo + '<span class="poster-sponsor-name">' + esc(s.name) + '</span></div>';
            }).join('') +
          '</div>';
        }

        strip.innerHTML = '<div class="poster-sponsor-label" data-testid="poster-sponsor-label">Sponsored By</div>' +
          renderTierRow(premium, 'premium', 'poster-sponsor-premium', null) +
          renderTierRow(mid, 'mid', 'poster-sponsor-mid', null) +
          renderTierRow(local, 'local', 'poster-sponsor-local', local.length && (premium.length || mid.length) ? 'Supporting Sponsors' : null);
      } catch { strip.innerHTML = ''; }
    }
    init();
  </script>
</body>
</html>`;

// ─── Shared report page ─────────────────────────────────────────────────────────

const SHARED_REPORT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Shared Report – OurSharedEvents</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #212529; }
    header { background: #1a1a2e; color: #fff; padding: 1.25rem 2rem; display: flex; align-items: center; justify-content: space-between; }
    header h1 { font-size: 1.4rem; font-weight: 600; }
    header span { font-size: .8rem; opacity: .6; text-transform: uppercase; letter-spacing: .05em; }
    main { max-width: 960px; margin: 2rem auto; padding: 0 1rem; display: grid; gap: 1.5rem; }
    .section-title { font-size: .75rem; text-transform: uppercase; letter-spacing: .08em; color: #6c757d; margin-bottom: .75rem; font-weight: 600; }
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; }
    .stat-card { background: #fff; border-radius: 8px; padding: 1.25rem 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .stat-card .num { font-size: 2rem; font-weight: 800; color: #1a1a2e; line-height: 1; margin-bottom: .25rem; }
    .stat-card .label { font-size: .8rem; color: #6c757d; }
    .events-list { background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); overflow: hidden; }
    .event-row { display: flex; align-items: center; justify-content: space-between; padding: .875rem 1.25rem; border-bottom: 1px solid #f1f3f5; gap: 1rem; }
    .event-row:last-child { border-bottom: none; }
    .event-row .name { font-weight: 600; font-size: .95rem; }
    .event-row .date { font-size: .8rem; color: #6c757d; white-space: nowrap; }
    .badge { display: inline-block; padding: .15rem .5rem; border-radius: 4px; font-size: .72rem; font-weight: 600; }
    .badge.active { background: #d3f9d8; color: #155724; }
    .badge.archived { background: #f1f3f5; color: #495057; }
    .loading { text-align: center; padding: 3rem; color: #6c757d; }
    .empty { text-align: center; padding: 2rem; color: #6c757d; font-size: .95rem; }
    .sponsor-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .sponsor-metrics:empty { display: none; }
    .sponsor-metric-card { background: #fff; border-radius: 8px; padding: 1rem 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .sponsor-metric-card .sponsor-name { font-weight: 600; font-size: .9rem; margin-bottom: .5rem; }
    .sponsor-metric-card .metric-row { display: flex; justify-content: space-between; font-size: .8rem; color: #6c757d; padding: .15rem 0; }
    .sponsor-metric-card .metric-val { font-weight: 600; color: #212529; }
    .action-bar { display: flex; gap: .75rem; justify-content: flex-end; }
    .btn { display: inline-flex; align-items: center; gap: .4rem; padding: .5rem 1rem; border-radius: 6px; border: none; font-size: .85rem; font-weight: 600; cursor: pointer; transition: opacity .15s; }
    .btn:hover:not(:disabled) { opacity: .85; }
    .btn:disabled { opacity: .45; cursor: not-allowed; }
    .btn-outline { background: #fff; color: #1a1a2e; border: 1.5px solid #dee2e6; box-shadow: 0 1px 2px rgba(0,0,0,.05); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border-width: 0; }
    .report-table { width: 100%; border-collapse: collapse; }
    .report-table th[scope] { text-align: left; padding: .625rem 1.25rem; font-size: .8rem; color: #6c757d; font-weight: 600; border-bottom: 2px solid #f1f3f5; }
    .report-table td { padding: .875rem 1.25rem; border-bottom: 1px solid #f1f3f5; font-size: .9rem; }
    .report-table tr:last-child td { border-bottom: none; }
    .stat-dl { display: flex; flex-direction: column; }
    .stat-dl dt { font-size: .8rem; color: #6c757d; order: 2; margin-top: .25rem; }
    .stat-dl dd { font-size: 2rem; font-weight: 800; color: #1a1a2e; line-height: 1; order: 1; margin: 0; }
    .btn:focus-visible { outline: 2px solid #4361ee; outline-offset: 2px; }
    .tier-badge { display: inline-block; padding: .15rem .45rem; border-radius: 10px; font-size: .65rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; vertical-align: middle; margin-left: .35rem; }
    .tier-badge.mid { background: #d0ebff; color: #1971c2; }
    .tier-badge.enterprise { background: #e8deee; color: #7c3aed; }
    .funnel-card { background: #fff; border-radius: 8px; padding: 1.25rem 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .funnel-card h3 { font-size: .85rem; font-weight: 600; color: #495057; margin-bottom: .75rem; text-transform: uppercase; letter-spacing: .04em; }
    .funnel-table { width: 100%; border-collapse: collapse; font-size: .85rem; }
    .funnel-table th { text-align: left; padding: .35rem .5rem; font-size: .75rem; color: #6c757d; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; border-bottom: 1px solid #e9ecef; }
    .funnel-table td { padding: .45rem .5rem; border-bottom: 1px solid #f1f3f5; vertical-align: middle; }
    .funnel-table tr:last-child td { border-bottom: none; }
    .bar-cell { width: 80px; }
    .bar-track { height: 6px; background: #f1f3f5; border-radius: 3px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 3px; background: #4361ee; }
    .bar-fill.checkin { background: #16a34a; }
    .rate-val { font-size: .75rem; color: #6c757d; text-align: right; min-width: 36px; }
    .upgrade-prompt { text-align: center; padding: 2rem 1.5rem; background: #f8f9fa; border-radius: 8px; border: 2px dashed #dee2e6; }
    .upgrade-prompt strong { color: #1a1a2e; display: block; font-size: .95rem; margin-bottom: .5rem; }
    .upgrade-prompt p { font-size: .85rem; color: #6c757d; margin: 0; }
    .skip-link { position: absolute; left: -9999px; top: auto; width: 1px; height: 1px; overflow: hidden; }
    .skip-link:focus { position: fixed; top: 0; left: 0; width: auto; height: auto; padding: .5rem 1rem; background: #1a1a2e; color: #fff; font-size: 1rem; z-index: 9999; text-decoration: none; border-bottom: 2px solid #4361ee; }
    @media print {
      .skip-link, .action-bar { display: none !important; }
      header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .stat-card, .events-list, .sponsor-metric-card, .funnel-card { box-shadow: none; border: 1px solid #e9ecef; }
      body { background: #fff; }
      #advanced-metrics-section { display: block !important; }
    }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to content</a>
  <header data-testid="report-header">
    <h1>OurSharedEvents</h1>
    <span>Shared Report</span>
  </header>
  <main id="main-content" data-testid="report-main">
    <div class="action-bar" data-testid="report-action-bar">
      <button class="btn btn-outline" data-testid="export-json-btn" id="export-json-btn" disabled>
        &#8595; Export JSON
      </button>
      <button class="btn btn-outline" data-testid="export-pdf-btn" id="export-pdf-btn" disabled title="Mid+ plan required">
        &#128438; Export PDF
      </button>
    </div>
    <section aria-labelledby="section-stats">
      <h2 class="section-title" id="section-stats">Events Overview</h2>
      <div class="stats-row" id="stats-row" data-testid="report-stats">
        <div class="stat-card" data-testid="stat-total"><dl class="stat-dl"><dt>Total Events</dt><dd id="stat-total">&mdash;</dd></dl></div>
        <div class="stat-card" data-testid="stat-active"><dl class="stat-dl"><dt>Active</dt><dd id="stat-active">&mdash;</dd></dl></div>
      </div>
    </section>
    <section aria-labelledby="section-events">
      <h2 class="section-title" id="section-events">Events</h2>
      <div class="events-list" id="events-list" data-testid="report-events-list"><p class="loading">Loading&hellip;</p></div>
    </section>
    <section id="report-sponsor-section" aria-labelledby="section-sponsors" data-testid="report-sponsor-section">
      <h2 class="section-title" id="section-sponsors">Sponsor Overview</h2>
      <div id="sponsor-metrics" class="sponsor-metrics" data-testid="report-sponsor-metrics"></div>
    </section>
    <section id="advanced-metrics-section" data-testid="advanced-metrics-section" style="display:none" aria-labelledby="section-advanced-metrics">
      <h2 class="section-title" id="section-advanced-metrics">Advanced Metrics <span class="tier-badge mid" data-testid="advanced-metrics-tier-badge">Mid+</span></h2>
      <div id="advanced-metrics-content" data-testid="advanced-metrics-content" class="funnel-card">
        <p class="loading" role="status" aria-live="polite">Loading&hellip;</p>
      </div>
    </section>
  </main>
  <script>
    window.__reportBundle = { events: [], sponsors: [], generatedAt: null };
  </script>
  <script>
    (async () => {
      const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
      const fmt = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '\u2014';
      const listEl = document.getElementById('events-list');
      try {
        const res = await fetch('/api/v2/events');
        const data = await res.json();
        const items = (data.ok && data.items) ? data.items : [];
        window.__reportBundle.events = items;
        window.__reportBundle.generatedAt = new Date().toISOString();
        document.getElementById('stat-total').textContent = items.length;
        document.getElementById('stat-active').textContent = items.filter(e => e.status === 'active').length;
        if (!items.length) {
          listEl.innerHTML = '<p class="empty">No events to report.</p>';
          return;
        }
        listEl.innerHTML = '<table class="report-table" data-testid="events-table"><caption class="sr-only">Events list</caption>' +
          '<thead><tr>' +
          '<th scope="col">Name</th>' +
          '<th scope="col">Date</th>' +
          '<th scope="col">Status</th>' +
          '</tr></thead>' +
          '<tbody>' +
          items.map(e => '<tr data-testid="report-event-row">' +
            '<td data-testid="report-event-name">' + esc(e.name || 'Untitled') + '</td>' +
            '<td data-testid="report-event-date">' + esc(fmt(e.startDateISO)) + '</td>' +
            '<td><span class="badge ' + esc(e.status || '') + '" data-testid="report-event-status">' + esc(e.status || '') + '</span></td>' +
            '</tr>').join('') +
          '</tbody></table>';
        document.getElementById('export-json-btn').disabled = false;
      } catch {
        listEl.innerHTML = '<p class="empty">Could not load data.</p>';
      }
    })();
  </script>
  <script>
    (async () => {
      const metricsEl = document.getElementById('sponsor-metrics');
      const sectionEl = document.getElementById('report-sponsor-section');
      if (!metricsEl) return;
      try {
        const evRes = await fetch('/api/v2/events');
        const evData = await evRes.json();
        const items = (evData.ok && evData.items) ? evData.items : [];
        if (!items.length) { sectionEl.style.display = 'none'; return; }
        const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
        const allSponsors = [];
        for (const ev of items.slice(0, 10)) {
          try {
            const res = await fetch('/api/v2/events/' + encodeURIComponent(ev.id) + '/sponsors');
            const data = await res.json();
            if (data.ok && data.items) {
              data.items.forEach(s => { if (!allSponsors.find(x => x.id === s.id)) allSponsors.push(s); });
            }
          } catch { /* skip */ }
        }
        window.__reportBundle.sponsors = allSponsors;
        if (!allSponsors.length) { sectionEl.style.display = 'none'; return; }
        metricsEl.innerHTML = allSponsors.map(s =>
          '<div class="sponsor-metric-card" data-testid="report-sponsor-card">' +
            '<div class="sponsor-name">' + esc(s.name) + '</div>' +
            '<div class="metric-row"><span>Tier</span><span class="metric-val">' + esc(s.tier) + '</span></div>' +
            '<div class="metric-row"><span>Status</span><span class="metric-val">' + (s.is_active ? 'Active' : 'Inactive') + '</span></div>' +
          '</div>'
        ).join('');
      } catch { if (sectionEl) sectionEl.style.display = 'none'; }
    })();
  </script>
  <script>
    (async () => {
      const section = document.getElementById('advanced-metrics-section');
      const content = document.getElementById('advanced-metrics-content');
      if (!section || !content) return;
      let tier = 'free';
      try {
        const tr = await fetch('/api/v2/admin/flags/current-tier').then(r => r.json()).catch(() => null);
        if (tr && tr.ok && tr.tier) tier = tr.tier;
      } catch { /* stay free */ }
      section.style.display = '';
      const pdfBtn = document.getElementById('export-pdf-btn');
      if (pdfBtn && tier !== 'free') { pdfBtn.disabled = false; pdfBtn.title = ''; }
      if (tier === 'free') {
        content.innerHTML = '<div class="upgrade-prompt" data-testid="advanced-metrics-upgrade"><strong>Upgrade to Mid+ for Advanced Metrics</strong><p>Conversion funnels and per-event trends are available on the Mid+ plan.</p></div>';
        return;
      }
      let events = [];
      try {
        const res = await fetch('/api/v2/events');
        const data = await res.json();
        events = (data.ok && data.items) ? data.items : [];
      } catch { /* empty */ }
      if (!events.length) { content.innerHTML = '<p class="empty">No event data to analyze.</p>'; return; }
      const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
      const rows = await Promise.all(events.slice(0, 10).map(async ev => {
        let reg = 0, checkin = 0;
        try {
          const [rRes, cRes] = await Promise.all([
            fetch('/api/v2/admin/events/' + encodeURIComponent(ev.id) + '/forms/registrations').then(r => r.json()).catch(() => null),
            fetch('/api/v2/admin/events/' + encodeURIComponent(ev.id) + '/forms/checkin-count').then(r => r.json()).catch(() => null),
          ]);
          reg = (rRes && rRes.ok) ? (Number(rRes.count) || 0) : 0;
          checkin = (cRes && cRes.ok) ? (Number(cRes.count) || 0) : 0;
        } catch { /* zero */ }
        return { name: ev.name || 'Untitled', reg, checkin };
      }));
      const maxReg = Math.max(...rows.map(r => r.reg), 1);
      content.innerHTML =
        '<h3>Registration \u2192 Check-in Funnel</h3>' +
        '<table class="funnel-table" data-testid="funnel-table" aria-label="Conversion funnel per event">' +
        '<thead><tr>' +
        '<th scope="col">Event</th>' +
        '<th scope="col">Registrations</th>' +
        '<th scope="col" class="bar-cell"></th>' +
        '<th scope="col">Check-ins</th>' +
        '<th scope="col">Attendance</th>' +
        '</tr></thead><tbody>' +
        rows.map(r => {
          const pct = r.reg > 0 ? Math.round((r.checkin / r.reg) * 100) : 0;
          const barW = Math.round((r.reg / maxReg) * 100);
          return '<tr data-testid="funnel-row">' +
            '<td data-testid="funnel-event-name">' + esc(r.name) + '</td>' +
            '<td data-testid="funnel-reg-count">' + r.reg + '</td>' +
            '<td class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:' + barW + '%" aria-hidden="true"></div></div></td>' +
            '<td data-testid="funnel-checkin-count">' + r.checkin + '</td>' +
            '<td class="rate-val" data-testid="funnel-rate">' + pct + '%</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>';
    })();
    document.getElementById('export-pdf-btn').addEventListener('click', function() {
      window.print();
    });
    document.getElementById('export-json-btn').addEventListener('click', function() {
      const bundle = window.__reportBundle || {};
      const params = new URLSearchParams(location.search);
      const eventId = params.get('id') || 'all';
      const payload = JSON.stringify({
        generatedAt: bundle.generatedAt || new Date().toISOString(),
        events: bundle.events || [],
        sponsors: bundle.sponsors || []
      }, null, 2);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
      a.download = 'report-' + eventId + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  </script>
</body>
</html>`;

export function handleDisplayPage(_env: PagesEnv): Response {
  return html(DISPLAY_HTML);
}

export function handlePosterPage(_env: PagesEnv): Response {
  return html(POSTER_HTML);
}

export function handleSharedReportPage(_env: PagesEnv): Response {
  return html(SHARED_REPORT_HTML);
}
