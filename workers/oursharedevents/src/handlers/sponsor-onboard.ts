/**
 * Sponsor self-serve onboarding screen.
 *
 * GET /sponsor/onboard?t=<invite>
 *   Renders a noindex/no-store sponsor-facing draft capture form.
 *
 * GET /api/v2/sponsors/draft/preview?t=<invite>&eventId=<event>&tier=<tier>
 *   Returns the OSE-1266 read-only outcome preview for the invite's brand/event
 *   using the real preview engine. This never promotes a draft and never touches
 *   sponsor_accepted or payment state.
 */

import { html, renderErrorPage } from './pages';
import {
  verifySponsorInviteToken,
  type SponsorInviteClaim,
  type SponsorInviteEnv,
} from '../lib/sponsor-invite';
import {
  buildOutcomePreview,
  commercialTierOfDbTier,
  type PreviewInput,
} from '../lib/sponsor-preview';
import { sovTierOf, type RotationSponsor } from '../lib/sponsor-allocation';

export interface SponsorOnboardEnv extends SponsorInviteEnv {
  DB?: D1Database;
}

const VALID_TIERS = ['primary', 'bronze', 'silver', 'gold', 'platinum', 'title'] as const;

function bearer(request: Request): string | null {
  const m = (request.headers.get('Authorization') ?? '').match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function inviteTokenFrom(request: Request): string | null {
  const url = new URL(request.url);
  return url.searchParams.get('t') ?? bearer(request);
}

function jsonError(code: string, message: string, status: number): Response {
  return Response.json(
    { ok: false, status, code, error: message },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

function withNoStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

async function categories(env: SponsorOnboardEnv): Promise<string[]> {
  if (!env.DB) return [];
  const rows = await env.DB.prepare(
    'SELECT category FROM category_registry ORDER BY category ASC LIMIT 100'
  ).all<{ category: string }>();
  return (rows.results ?? []).map((r) => r.category).filter(Boolean);
}

async function claimForPage(
  request: Request,
  env: SponsorOnboardEnv
): Promise<{ token: string; claim: SponsorInviteClaim } | null> {
  const token = inviteTokenFrom(request);
  const claim = await verifySponsorInviteToken(env, token);
  return token && claim ? { token, claim } : null;
}

export async function handleSponsorOnboardPage(
  request: Request,
  env: SponsorOnboardEnv
): Promise<Response> {
  const auth = await claimForPage(request, env);
  if (!auth) {
    return withNoStore(
      renderErrorPage(
        401,
        'This sponsor invite is not valid',
        'It may have expired, or it may have been copied incompletely. Ask the organizer for a fresh invite link.',
        '/events',
        'See public events'
      )
    );
  }

  const cats = await categories(env);
  const categoryOptions = cats.length
    ? cats
        .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c.replace(/_/g, ' '))}</option>`)
        .join('')
    : '<option value="" disabled>No sponsor categories are configured</option>';
  const defaultEvent = auth.claim.event_id ?? '';
  const tokenJson = JSON.stringify(auth.token);
  const eventJson = JSON.stringify(defaultEvent);

  return withNoStore(
    html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Sponsor onboarding - OurSharedEvents</title>
  <style>
    :root { color-scheme: light; --bg:#f8fafc; --card:#fff; --text:#172033; --muted:#667085; --border:#d0d5dd; --accent:#3657d6; --ok:#087443; --err:#b42318; }
    body { margin:0; font-family:system-ui,-apple-system,Segoe UI,sans-serif; background:var(--bg); color:var(--text); }
    main { max-width:900px; margin:0 auto; padding:2rem 1rem 4rem; }
    .card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:1.25rem; box-shadow:0 1px 2px rgba(16,24,40,.06); }
    h1 { margin:0 0 .35rem; font-size:1.7rem; }
    h2 { margin:0 0 .75rem; font-size:1.05rem; }
    p { line-height:1.5; }
    .muted { color:var(--muted); }
    form { display:grid; gap:1rem; margin-top:1rem; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:1rem; }
    label { display:grid; gap:.35rem; font-weight:650; }
    input, select { min-height:44px; border:1px solid var(--border); border-radius:8px; padding:.55rem .65rem; font:inherit; background:#fff; color:var(--text); }
    .actions { display:flex; flex-wrap:wrap; gap:.75rem; align-items:center; }
    button { min-height:44px; border:0; border-radius:8px; padding:.6rem 1rem; font-weight:700; background:var(--accent); color:#fff; cursor:pointer; }
    button[disabled] { opacity:.55; cursor:not-allowed; }
    .preview { margin-top:1rem; border:1px solid var(--border); border-radius:12px; padding:1rem; background:#f9fbff; }
    .preview ul { margin:.5rem 0 0; padding-left:1.1rem; }
    .status.ok { color:var(--ok); }
    .status.err { color:var(--err); }
    .fineprint { font-size:.9rem; color:var(--muted); }
  </style>
</head>
<body>
<main>
  <section class="card" aria-labelledby="sponsor-title">
    <h1 id="sponsor-title">Sponsor onboarding</h1>
    <p class="muted">Tell organizers which event types you want to be available for in this base node. Base-node availability is free. The paid lane is the money-ops lane from the sponsor payment runbook: prepaid <strong>standard</strong>, <strong>frequent</strong>, or <strong>headline</strong> rotation-frequency layers handled out of band through Stripe Payment Links/Wave, and any deeper SharedReport context stays aggregate-only. This screen never charges a card, reserves a slot, changes sponsor acceptance, or starts payment.</p>
    <form id="sponsor-onboard-form" data-testid="sponsor-onboard-form">
      <input type="hidden" id="event-id" value="${escapeHtml(defaultEvent)}" />
      <label>Base node from this invite
        <input id="base-node" data-testid="sponsor-onboard-base-node" value="${escapeHtml(defaultEvent || 'Organizer-selected base node')}" readonly />
      </label>
      <div class="grid">
        <label>Business name
          <input id="business-name" name="name" data-testid="sponsor-onboard-name" required maxlength="200" autocomplete="organization" />
        </label>
        <label>Website
          <input id="website-url" name="website_url" data-testid="sponsor-onboard-website" type="url" maxlength="500" autocomplete="url" />
        </label>
      </div>
      <label>Business address
        <input id="address-raw" name="address_raw" data-testid="sponsor-onboard-address" autocomplete="street-address" />
      </label>
      <div class="grid">
        <label>Event types you want to be available for
          <select id="category" data-testid="sponsor-onboard-category">${categoryOptions}</select>
        </label>
        <label>Availability layer
          <select id="tier" data-testid="sponsor-onboard-tier">
            <option value="primary">Free - base node + selected event types</option>
            <option value="bronze">Standard paid frequency - prepaid/manual</option>
            <option value="silver">Frequent paid frequency - prepaid/manual</option>
            <option value="title">Headline paid frequency - prepaid/manual</option>
          </select>
        </label>
      </div>
      <label>
        <span><input id="covenant" type="checkbox" data-testid="sponsor-onboard-covenant" required /> I understand free availability is scoped to my base node and selected event types; paid money-ops layers buy rotation frequency and may unlock aggregate SharedReport context, but never position, size, slot, attendee data, or a bought-local claim.</span>
      </label>
      <div id="preview" class="preview" data-testid="sponsor-onboard-preview" role="status" aria-live="polite">
        <h2>Live outcome preview</h2>
        <p class="muted">Choose an availability layer to preview the aggregate report shape and expected frequency share.</p>
      </div>
      <div class="actions">
        <button id="submit" type="submit" data-testid="sponsor-onboard-submit">Save draft</button>
        <span id="status" class="status" data-testid="sponsor-onboard-status" role="status" aria-live="polite"></span>
      </div>
      <p class="fineprint">Local status and base-node fit are geo-derived and reviewed by the organizer. Per the payment runbook, free/community-benefit sponsors receive no payment link; paid sponsors are invoiced out of band and price never reaches the allocation engine.</p>
    </form>
  </section>
</main>
<script>
(function(){
  var token = ${tokenJson};
  var defaultEvent = ${eventJson};
  var form = document.getElementById('sponsor-onboard-form');
  var tier = document.getElementById('tier');
  var eventId = document.getElementById('event-id');
  var preview = document.getElementById('preview');
  var status = document.getElementById('status');
  var submit = document.getElementById('submit');
  function esc(s){ var d=document.createElement('div'); d.textContent=String(s == null ? '' : s); return d.innerHTML; }
  async function refreshPreview(){
    var qs = new URLSearchParams({ t: token, tier: tier.value });
    if ((eventId.value || defaultEvent || '').trim()) qs.set('eventId', (eventId.value || defaultEvent).trim());
    preview.innerHTML = '<h2>Live outcome preview</h2><p class="muted">Loading...</p>';
    try {
      var res = await fetch('/api/v2/sponsors/draft/preview?' + qs.toString());
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Preview unavailable');
      var p = data.preview;
      var sections = (p.report_sections || []).map(function(x){ return '<li>' + esc(String(x).replace(/_/g,' ')) + '</li>'; }).join('');
      preview.innerHTML = '<h2>Live outcome preview</h2>' +
        '<p><strong>' + esc(data.copy.frequencyLabel) + ': ' + esc(p.frequency_share_pct) + '%</strong></p>' +
        '<p class="fineprint">' + esc(data.copy.frequencyCaveat) + '</p>' +
        '<p class="fineprint">Report depth: ' + esc(p.report_depth) + ' - aggregate-only, no attendee questions.</p>' +
        '<ul>' + sections + '</ul>';
    } catch (e) {
      preview.innerHTML = '<h2>Live outcome preview</h2><p class="status err">Preview unavailable.</p>';
    }
  }
  tier.addEventListener('change', refreshPreview);
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    status.textContent = '';
    status.className = 'status';
    submit.disabled = true;
    try {
      var category = document.getElementById('category').value;
      var body = {
        event_id: eventId.value || undefined,
        name: document.getElementById('business-name').value.trim(),
        website_url: document.getElementById('website-url').value.trim() || undefined,
        address_raw: document.getElementById('address-raw').value.trim() || undefined,
        category_selections: category ? [{ category: category, mode: 'whole' }] : [],
        covenant_acknowledged: document.getElementById('covenant').checked
      };
      var res = await fetch('/api/v2/sponsors/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      });
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not save draft');
      status.className = 'status ok';
      status.textContent = 'Draft saved. Reference: ' + data.draft_token;
    } catch (err) {
      status.className = 'status err';
      status.textContent = err.message || 'Could not save draft.';
    } finally {
      submit.disabled = false;
    }
  });
  refreshPreview();
})();
</script>
</body>
</html>`)
  );
}

export async function handleSponsorDraftPreview(
  request: Request,
  env: SponsorOnboardEnv
): Promise<Response> {
  const token = inviteTokenFrom(request);
  const claim = await verifySponsorInviteToken(env, token);
  if (!claim) return jsonError('UNAUTHORIZED', 'Valid sponsor invite token required', 401);

  const url = new URL(request.url);
  const dbTier = url.searchParams.get('tier') || 'primary';
  if (!(VALID_TIERS as readonly string[]).includes(dbTier)) {
    return jsonError('INVALID_TIER', `tier must be one of: ${VALID_TIERS.join(', ')}`, 400);
  }
  const eventId = claim.event_id ?? url.searchParams.get('eventId');
  if (!env.DB) return jsonError('DB_NOT_CONFIGURED', 'Database not available', 503);

  let brandId = claim.brand_id;
  let corridorSponsors: RotationSponsor[] = [];
  if (eventId) {
    const event = await env.DB.prepare('SELECT id, brand_id FROM events WHERE id = ? LIMIT 1')
      .bind(eventId)
      .first<{ id: string; brand_id: string }>();
    if (!event || event.brand_id !== claim.brand_id) {
      return jsonError('NOT_FOUND', `Event not found: ${eventId}`, 404);
    }
    brandId = event.brand_id;
    const rows = await env.DB.prepare(
      `SELECT sb.id, sp.tier, COALESCE(sp.locality_band, 0) AS is_local
         FROM sponsor_placement sp
         JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
        WHERE sp.event_id = ?
          AND sb.brand_id = ?
          AND sp.is_active = 1
          AND sb.is_active = 1
          AND COALESCE(sp.organizer_accepted, 1) = 1
          AND sp.sponsor_accepted = 1`
    )
      .bind(event.id, brandId)
      .all<{ id: string; tier: string; is_local: number }>();
    corridorSponsors = (rows.results ?? []).map((row) => ({
      id: row.id,
      tier: sovTierOf(row.tier),
      is_local: Number(row.is_local) === 1,
    }));
  }

  const input: PreviewInput = {
    tier: commercialTierOfDbTier(dbTier),
    sponsorId: 'draft-preview',
    isLocal: false,
    corridorSponsors,
  };
  const preview = buildOutcomePreview(input);

  return Response.json(
    {
      ok: true,
      status: 200,
      preview,
      copy: {
        frequencyLabel: 'Estimated rotation frequency share',
        frequencyCaveat:
          'Transparency estimate only - not a reserved slot, rank, size, or position.',
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
