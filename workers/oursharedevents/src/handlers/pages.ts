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
    .event-card .meta { font-size: .85rem; color: #868e96; }
    .event-card .cta { display: inline-block; padding: .5rem 1.25rem; background: #4361ee; color: #fff; border-radius: 6px; font-size: .85rem; font-weight: 600; text-decoration: none; white-space: nowrap; transition: background .2s; flex-shrink: 0; }
    .event-card .cta:hover { background: #3451d1; }
    .event-card .cta:focus-visible { outline: 2px solid #4361ee; outline-offset: 2px; }
    .loading { text-align: center; padding: 3rem; color: #868e96; font-size: .95rem; }
    .error   { text-align: center; padding: 2rem; color: #e03131; }
  </style>
</head>
<body>
  <header data-testid="public-header">
    <h1>OurSharedEvents</h1>
  </header>
  <main data-testid="public-main">
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
    .tier-badge.free       { background: #d3f9d8; color: #2f9e44; }
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
    .form-config-desc { font-size: .75rem; color: #868e96; }
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
    .surface-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 2rem; }
    .surface-card { background: #fff; border-radius: 8px; padding: 1rem 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); border-left: 3px solid #868e96; }
    .surface-card h3 { font-size: .9rem; font-weight: 600; margin-bottom: .35rem; }
    .surface-card p { font-size: .8rem; color: #868e96; margin-bottom: .5rem; }
    .surface-card a { font-size: .8rem; color: #4361ee; text-decoration: none; font-weight: 500; }
    .surface-card a:hover { text-decoration: underline; }
    .surface-card.poster  { border-left-color: #d97706; }
    .surface-card.display { border-left-color: #2563eb; }
    .surface-card.public  { border-left-color: #16a34a; }
    .surface-card.report  { border-left-color: #7c3aed; }
    .qr-hint { font-size: .7rem; color: #adb5bd; margin-top: .25rem; }
    .copy-btn { display: inline-block; padding: .2rem .5rem; background: #f1f3f5; border: 1px solid #dee2e6; border-radius: 4px; font-size: .75rem; cursor: pointer; color: #495057; margin-left: .5rem; transition: background .2s, color .2s; }
    .copy-btn:hover { background: #e9ecef; }
    .copy-btn.copied { background: #d3f9d8; color: #2f9e44; border-color: #b2f2bb; }
    .clickable-row { cursor: pointer; }
    .muted-sm { color: #868e96; font-size: .8rem; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
    .flex-row { display: flex; align-items: center; gap: .75rem; }
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
    .create-btn:disabled { background: #94a3b8; cursor: not-allowed; }
    .create-msg { font-size: .85rem; margin-top: .5rem; min-height: 1.25rem; }
    .create-msg.success { color: #16a34a; }
    .create-msg.error { color: #dc2626; }
    @media (max-width: 600px) { .create-form { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header data-testid="admin-header">
    <h1>OurSharedEvents<span class="tier-badge" id="tierBadge" data-testid="tier-badge"></span></h1>
    <span>Admin</span>
  </header>
  <main data-testid="admin-main">

    <!-- Create Event Card -->
    <div class="create-card" data-testid="create-event-card">
      <h2>Create Event</h2>
      <form id="create-event-form" data-testid="create-event-form" novalidate>
        <div class="create-form">
          <div class="full-width">
            <label for="create-title">Event Name <span style="color:#dc2626">*</span></label>
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
          <div class="full-width" style="display:flex;align-items:end;gap:.75rem;">
            <button type="submit" class="create-btn" data-testid="create-submit">Create Event</button>
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
          <tr onclick="window.loadForms('\${safeId}', '\${safeName.replace(/'/g, "\\\\'")}'); document.querySelectorAll('tr.selected').forEach(r=>r.classList.remove('selected')); this.classList.add('selected');" class="clickable-row" data-testid="event-row-\${safeId}">
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
      const btn = e.target.querySelector('[data-testid="create-submit"]');
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
    @media (max-width: 480px) { header { padding: .75rem 1rem; } nav { gap: 1rem; } .hero { padding: 3rem 1rem 2.5rem; } .subscribe-form { flex-direction: column; } .subscribe-form input[type="email"], .subscribe-form button[type="submit"] { width: 100%; flex: none; } .features { padding: 2rem 1rem 3rem; } }
  </style>
</head>
<body>
  <header data-testid="landing-header">
    <span class="logo" data-testid="landing-logo">OurSharedEvents</span>
    <nav data-testid="landing-nav">
      <a href="/events" data-testid="nav-events">Events</a>
      <a href="/admin" data-testid="nav-admin">Admin</a>
    </nav>
  </header>
  <main data-testid="landing-main">
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
    .event-card .label { font-size: .75rem; text-transform: uppercase; letter-spacing: .08em; color: #94a3b8; margin-bottom: .5rem; }
    .event-card h2 { font-size: clamp(1.5rem, 4vw, 2.5rem); font-weight: 800; line-height: 1.15; color: #f8fafc; margin-bottom: .75rem; }
    .event-card .meta { font-size: 1.1rem; color: #94a3b8; display: flex; gap: 1.5rem; flex-wrap: wrap; }
    .event-card .meta span::before { content: ""; }
    .next-events { display: grid; gap: 1rem; }
    .next-events h3 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; color: #64748b; margin-bottom: .25rem; }
    .next-card { background: rgba(255,255,255,.03); border-radius: 8px; padding: 1rem 1.25rem; border: 1px solid rgba(255,255,255,.06); display: flex; justify-content: space-between; align-items: center; }
    .next-card .name { font-weight: 600; font-size: 1rem; }
    .next-card .date { font-size: .85rem; color: #94a3b8; }
    .empty { text-align: center; padding: 4rem; color: #475569; font-size: 1.1rem; }
    .ticker { background: #1e3a5f; padding: .6rem 2rem; font-size: .85rem; color: #93c5fd; border-top: 1px solid rgba(255,255,255,.06); overflow: hidden; white-space: nowrap; }
    .ticker-inner { display: inline-block; animation: scroll 30s linear infinite; }
    @keyframes scroll { from { transform: translateX(100vw); } to { transform: translateX(-100%); } }
  </style>
</head>
<body>
  <header data-testid="display-header">
    <h1>OurSharedEvents</h1>
    <div class="clock" id="clock" aria-live="off" data-testid="display-clock"></div>
  </header>
  <main id="main" data-testid="display-main">
    <p class="empty">Loading&hellip;</p>
  </main>
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
      const main = document.getElementById('main');
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
    .qr-placeholder { width: 120px; height: 120px; background: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin: 0 auto .5rem; font-size: .7rem; color: #94a3b8; text-align: center; padding: .5rem; }
    .qr-label { font-size: .75rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
    .poster-footer { text-align: center; padding: 1rem; background: #f8fafc; font-size: .8rem; color: #94a3b8; }
    .loading { text-align: center; padding: 4rem; color: #94a3b8; }
    .error { text-align: center; padding: 3rem; color: #dc2626; }
    .event-select { margin-bottom: 1.5rem; }
    .event-select label { display: block; font-size: .875rem; font-weight: 600; color: #374151; margin-bottom: .375rem; }
    .event-select select { width: 100%; padding: .5rem .75rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: .95rem; background: #fff; color: #1e293b; }
    @media print {
      .page-header, .event-select, .no-print { display: none !important; }
      body { background: #fff; }
      .container { margin: 0; max-width: 100%; }
      .poster { box-shadow: none; border: none; }
    }
  </style>
</head>
<body>
  <div class="page-header no-print" data-testid="poster-header">
    <h1>OurSharedEvents — Poster</h1>
    <a href="javascript:window.print()" data-testid="poster-print">&#x1F5A8; Print</a>
  </div>
  <div class="container" data-testid="poster-container">
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

      return '<div class="poster">' +
        '<div class="poster-header">' +
          '<div class="org">OurSharedEvents</div>' +
          '<h2>' + esc(name) + '</h2>' +
        '</div>' +
        '<div class="poster-body">' +
          '<div class="poster-meta">' +
          (startISO ? '<div class="meta-row"><div class="meta-icon">&#x1F4C5;</div><div class="meta-text">' + esc(fmt(startISO)) + (startISO ? ' &mdash; ' + esc(fmtTime(startISO)) : '') + '</div></div>' : '') +
          (venue ? '<div class="meta-row"><div class="meta-icon">&#x1F4CD;</div><div class="meta-text">' + esc(venue) + (address ? '<br><small>' + esc(address) + '</small>' : '') + '</div></div>' : '') +
          '</div>' +
          '<div class="qr-section">' +
            '<div class="qr-item"><div class="qr-placeholder">QR codes available after event setup</div><div class="qr-label">Event Page</div></div>' +
            '<div class="qr-item"><div class="qr-placeholder">QR codes available after event setup</div><div class="qr-label">Registration</div></div>' +
          '</div>' +
        '</div>' +
        '<div class="poster-footer">oursharedevents.com</div>' +
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
        picker.addEventListener('change', () => {
          const idx = parseInt(picker.value, 10);
          if (!isNaN(idx) && items[idx]) area.innerHTML = renderPoster(items[idx]);
        });
      } catch {
        area.innerHTML = '<p class="error">Could not load events.</p>';
      }
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
    .badge.active { background: #d3f9d8; color: #2f9e44; }
    .badge.archived { background: #f1f3f5; color: #868e96; }
    .loading { text-align: center; padding: 3rem; color: #868e96; }
    .empty { text-align: center; padding: 2rem; color: #868e96; font-size: .95rem; }
  </style>
</head>
<body>
  <header data-testid="report-header">
    <h1>OurSharedEvents</h1>
    <span>Shared Report</span>
  </header>
  <main data-testid="report-main">
    <div>
      <div class="section-title">Events Overview</div>
      <div class="stats-row" id="stats-row" data-testid="report-stats">
        <div class="stat-card" data-testid="stat-total"><div class="num" id="stat-total">&mdash;</div><div class="label">Total Events</div></div>
        <div class="stat-card" data-testid="stat-active"><div class="num" id="stat-active">&mdash;</div><div class="label">Active</div></div>
      </div>
    </div>
    <div>
      <div class="section-title">Events</div>
      <div class="events-list" id="events-list" data-testid="report-events-list"><p class="loading">Loading&hellip;</p></div>
    </div>
  </main>
  <script>
    (async () => {
      const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
      const fmt = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '\u2014';
      const listEl = document.getElementById('events-list');
      try {
        const res = await fetch('/api/v2/events');
        const data = await res.json();
        const items = (data.ok && data.items) ? data.items : [];
        document.getElementById('stat-total').textContent = items.length;
        document.getElementById('stat-active').textContent = items.filter(e => e.status === 'active').length;
        if (!items.length) {
          listEl.innerHTML = '<p class="empty">No events to report.</p>';
          return;
        }
        listEl.innerHTML = items.map(e => '<div class="event-row" data-testid="report-event-row">' +
          '<div class="name" data-testid="report-event-name">' + esc(e.name || 'Untitled') + '</div>' +
          '<div class="flex-row">' +
          '<div class="date" data-testid="report-event-date">' + esc(fmt(e.startDateISO)) + '</div>' +
          '<span class="badge ' + esc(e.status || '') + '" data-testid="report-event-status">' + esc(e.status || '') + '</span>' +
          '</div></div>').join('');
      } catch {
        listEl.innerHTML = '<p class="empty">Could not load data.</p>';
      }
    })();
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
