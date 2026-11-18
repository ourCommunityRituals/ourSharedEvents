// Build one day of stock data through the Worker's real admin API, and record
// every id it creates in a manifest (the check, swap and purge steps read it).
import { readFile as fsReadFile } from 'node:fs/promises';
import { pickArt } from './instagram.mjs';
import { chicagoDate } from './validate-finds.mjs';
import { SAFE_ID } from './purge-full.mjs';
import { missingPairs, planShowcase, posterCodesBody } from './poster-showcase.mjs';

// A QR token or shortcode: one path segment, nothing that climbs or adds a query.
const PATH_TOKEN = /^[A-Za-z0-9_-]{1,100}$/;

// The stock plan's sponsor tiers, and the tier word the Worker accepts for each.
// Every value must be in VALID_TIERS in workers/oursharedevents/src/handlers/sponsors.ts.
export const SPONSOR_TIER_WIRE = { premium: 'title', mid: 'gold', local: 'bronze' };

const CHICAGO_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Chicago',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function sponsorTier(business, regionals) {
  if (business.anchor === true) return 'premium';
  const list = Array.isArray(regionals) ? regionals : (regionals && regionals.regionals) || [];
  return list.includes(business.name) ? 'mid' : 'local';
}

// The Chicago end date of a row, for the Worker's end_date (handlers/events.ts reads
// end_date as YYYY-MM-DD; it has no end time field). { date } to send, { skip } with
// the reason it is not sent, or {} when the row has no end.
export function endDateOf(row, startDate) {
  if (typeof row.ends_at !== 'string' || row.ends_at === '') return {};
  if (Number.isNaN(Date.parse(row.ends_at))) return { skip: 'unreadable' };
  const date = chicagoDate(row.ends_at);
  return date < startDate ? { skip: 'before the start' } : { date };
}

// Private before public, then the soonest start.
function bySectorThenStart(a, b) {
  const rank = (r) => (r.sector === 'private' ? 0 : 1);
  // a missing or invalid start sorts last; ties fall back to the title
  const at = (r) => {
    const t = Date.parse(r.starts_at);
    return Number.isNaN(t) ? Infinity : t;
  };
  const byStart = at(a) === at(b) ? 0 : at(a) < at(b) ? -1 : 1;
  return rank(a) - rank(b) || byStart || String(a.title).localeCompare(String(b.title));
}

// ── Did a failed create land? (OSE-2082) ────────────────────────────────────
// client.mjs tries a create again after a 502/503/504 only when a read shows its
// row is not there. Each read below answers for one create: the row it made (the
// client takes it as the answer and sends nothing again), or null (not there).
// A row counts as this create's only if it carries the create's own fields, is not
// already on the manifest, and was made no earlier than the create was sent: the
// load before this one holds rows with the same names until the swap.

// How far the site's clock may be behind this runner's and a row still be new.
const CLOCK_SLACK_MS = 120_000;

// A row with no readable created_at could be new: it is never ruled out by time.
function madeSince(item, sentAt) {
  const t = Date.parse(String(item && item.created_at));
  return Number.isNaN(t) || t >= sentAt - CLOCK_SLACK_MS;
}

// An error that ends the call: client.mjs passes it on and does not try again.
const finalError = (message) => Object.assign(new Error(message), { final: true });

/** The one row among `found`, null for none; two that could be it stop the build. */
function theOne(found, what) {
  const byId = [...new Map(found.map((i) => [i.id, i])).values()];
  if (byId.length > 1) {
    throw finalError(`${what}: ${byId.length} rows could be the one a failed create made`);
  }
  return byId[0] ?? null;
}

// A local photo (stock/art, local-art.mjs) is read from disk; an Instagram post
// is downloaded.
async function loadArt(post, fetchFn, readFile) {
  if (typeof post.file === 'string') {
    return { bytes: new Uint8Array(await readFile(post.file)), contentType: 'image/jpeg' };
  }
  return downloadArt(fetchFn, post.mediaUrl);
}

async function downloadArt(fetchFn, url) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`art download failed: ${res.status}`);
  const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: contentType.split(';')[0].trim() || 'image/jpeg',
  };
}

// One picture, however many events it was uploaded for: a local photo by its
// file, an Instagram post by its id (else its media address).
function artKey(post) {
  return String(post.file ?? post.id ?? post.mediaUrl);
}

// Owner 2026-11-10: the stock sponsors show art from the same pool as the stock
// events (the pictures this build uploaded as poster art) until a real sponsor
// uploads its own. Each sponsor gets one of those uploads as its logo, round-robin in
// creation order so the sponsors show the variety of the pool. The Worker reads an
// uploaded logo from R2 (lib/sponsor-logo.ts serveUploadedLogo); the purge
// removes the asset rows of the sponsors and the uploads together. No art uploaded
// (an art failure is already named): the sponsors keep the standard image. A
// refused logo is named, never fatal.
export async function giveSponsorsArt(client, manifest, pool) {
  if (pool.length === 0) return;
  const sponsors = manifest.items.filter((i) => i.kind === 'sponsor').map((i) => i.id);
  for (const [i, id] of sponsors.entries()) {
    try {
      await client.put(`/api/v2/admin/sponsors/${id}`, { logo_url: pool[i % pool.length] });
    } catch (err) {
      manifest.warnings.push(`sponsor art not set for ${id}: ${err.message}`);
    }
  }
}

export async function buildDay({
  client,
  accepted,
  businesses,
  regionals,
  posts,
  artTags,
  // type id -> category code, so art tagged by category fits (pickArt)
  typeCategory,
  // node id -> how many stock events it gets (seed.mjs expectedByNode); a node
  // missing here gets none
  expected,
  date,
  nodeIds,
  fetch: fetchFn = globalThis.fetch,
  // reads a local photo's bytes (posts from local-art.mjs carry a file path)
  readFile = (path) => fsReadFile(path),
  // stock/poster-code-sets.json, read by poster-showcase.mjs readCodeSets: the
  // codes each poster carries, and every set shown with both art orientations.
  // Absent: no codes are saved and art is picked per event, as before.
  codeSets,
  // Called with the manifest after every id it records, so the caller can save it
  // as it grows: a build killed mid-run still leaves what it created on record.
  onRecord = () => {},
  // the runner's clock, to tell a row a failed create made from an older one
  now = Date.now,
}) {
  const want = (node) => {
    const n = expected && expected[node];
    return Number.isInteger(n) && n > 0 ? n : 0;
  };
  const manifest = { date, items: [], qr: [], acceptSql: [], short: {}, warnings: [] };
  // An id the admin API hands back goes into the purge's SQL and R2 keys, so it
  // is checked before it is recorded; a bad one stops the build (CCR 2026-11-07).
  const record = (kind, id, node, extra = {}) => {
    if (typeof id !== 'string' || !SAFE_ID.test(id))
      throw new Error(`unsafe ${kind} id from the admin API`);
    manifest.items.push({ kind, id, node, ...extra });
    onRecord(manifest);
  };
  const onManifest = (id) => manifest.items.some((i) => i.id === id);

  // picture -> the address of its first upload in this build (the art for the sponsors)
  const artPool = new Map();

  try {
    // Sponsors first: one per business, into the root brand's pool.
    const anchorOf = new Map();
    // per node, the regional (mid) and local sponsor ids in creation order
    const tierOf = { mid: new Map(), local: new Map() };
    for (const business of businesses) {
      const tier = sponsorTier(business, regionals);
      const sponsorSentAt = now();
      const sponsorBody = {
        brand_id: 'root',
        name: business.name,
        address_line: business.address,
        tier: SPONSOR_TIER_WIRE[tier],
        // the Worker derives the sponsor cells from lat/lon only and never
        // geocodes address_line (handleAdminCreateSponsor)
        lat: business.lat,
        lon: business.lng,
      };
      // Only the id is used from the answer, so a sponsor that landed is taken over.
      const sponsorLanded = async () => {
        const listed = await client.get('/api/v2/admin/sponsors?brand_id=root');
        const mine = theOne(
          ((listed && listed.items) || []).filter(
            (i) => i && i.name === business.name && !onManifest(i.id) && madeSince(i, sponsorSentAt)
          ),
          'POST /api/v2/admin/sponsors'
        );
        return mine ? { id: mine.id } : null;
      };
      const res = await client.post('/api/v2/admin/sponsors', sponsorBody, {
        landed: sponsorLanded,
      });
      record('sponsor', res.id, business.node, { tier });
      if (tier === 'premium' && !anchorOf.has(business.node)) anchorOf.set(business.node, res.id);
      if (tier !== 'premium') {
        if (!tierOf[tier].has(business.node)) tierOf[tier].set(business.node, []);
        tierOf[tier].get(business.node).push(res.id);
      }
    }

    // Every node counts toward `short`, so the caller passes all of them.
    const nodes = nodeIds || [
      ...new Set([...accepted.map((r) => r.node), ...businesses.map((b) => b.node)]),
    ];
    const rowsOf = new Map();
    for (const node of nodes) {
      const rows = accepted
        .filter((r) => r.node === node)
        .sort(bySectorThenStart)
        .slice(0, want(node));
      if (rows.length < want(node)) manifest.short[node] = want(node) - rows.length;
      rowsOf.set(node, rows);
    }
    // The poster showcase is planned over every event at once, so each code set
    // shows a landscape and a portrait poster somewhere on the site.
    const pick = (row, list) => pickArt(row, list, artTags, typeCategory);
    const showcase = codeSets
      ? planShowcase([...rowsOf.values()].flat(), { codeSets, posts, pick })
      : null;
    if (showcase) {
      for (const pair of missingPairs(showcase)) {
        manifest.warnings.push(`showcase pair not shown: ${pair}`);
      }
    }

    for (const node of nodes) {
      const rows = rowsOf.get(node);
      // The node's events by name: the order the mid and local sponsors go round in.
      const byName = new Map(
        [...rows]
          .sort(
            (a, b) =>
              String(a.title).localeCompare(String(b.title)) ||
              String(a.venue).localeCompare(String(b.venue))
          )
          .map((r, i) => [r, i])
      );

      for (const row of rows) {
        const startDate = chicagoDate(row.starts_at);
        const end = endDateOf(row, startDate);
        const eventSentAt = now();
        const eventBody = {
          brand_id: 'root',
          status: 'active',
          is_published: true,
          // OSE-1900: a sponsor shows only on an event that opted in, and every
          // stock event is given sponsors below (check-full requires the strip).
          settings: { useSponsors: true },
          // OSE-2012: the create API requires the mode. Every stock event has a venue.
          attendance_mode: 'in_person',
          title: row.title,
          description: row.summary,
          location: row.venue,
          where_address: row.address,
          event_type_id: row.event_type_id,
          start_date: startDate,
          start_time: CHICAGO_TIME.format(new Date(row.starts_at)),
          ...(end.date ? { end_date: end.date } : {}),
          timezone: 'America/Chicago',
          lat: row.lat,
          lon: row.lng,
        };
        const ev = await client.post('/api/v2/admin/events', eventBody, {
          // The create's answer carries the event's short code, and the admin list
          // does not. So an event that landed is put on the manifest, for the purge,
          // and the build stops: it is never made twice and never left unnamed.
          landed: async () => {
            const listed = await client.get('/api/v2/admin/events?limit=100');
            const mine = theOne(
              ((listed && listed.items) || []).filter(
                (i) =>
                  i &&
                  i.title === eventBody.title &&
                  i.start_date === eventBody.start_date &&
                  i.location === eventBody.location &&
                  !onManifest(i.id) &&
                  madeSince(i, eventSentAt)
              ),
              'POST /api/v2/admin/events'
            );
            if (!mine) return null;
            record('event', mine.id, node);
            throw finalError(
              'POST /api/v2/admin/events failed, but the event was made; it is on the manifest for the purge and was not made again'
            );
          },
        });
        record('event', ev.id, node);
        if (end.skip) manifest.warnings.push(`${ev.id} ends_at not sent: ${end.skip}`);

        // The event is this build's own and seconds old, so a poster on it with this
        // label is this create's. The list carries its id and QR token.
        const posterBody = { placement_label: row.venue, placement_type: 'venue' };
        const posterLanded = async () => {
          const listed = await client.get(`/api/v2/admin/events/${ev.id}/poster-deployments`);
          const mine = theOne(
            ((listed && listed.items) || []).filter(
              (i) =>
                i &&
                i.placement_label === posterBody.placement_label &&
                i.placement_type === posterBody.placement_type
            ),
            'POST /api/v2/admin/events/:id/poster-deployments'
          );
          return mine ? { id: mine.id, qr_token: mine.qr_token } : null;
        };
        const poster = await client.post(
          `/api/v2/admin/events/${ev.id}/poster-deployments`,
          posterBody,
          { landed: posterLanded }
        );
        record('poster', poster.id, node);
        // mints the event's /e/ share code; the /s/ routing link is the create's shortcode.
        // The route makes the code on the first ask and answers every later ask with the
        // same one (ensureEventCode), so asking again is safe.
        await client.post(`/api/v2/admin/events/${ev.id}/short-links`, {}, { idempotent: true });
        if (typeof poster.qr_token !== 'string' || !PATH_TOKEN.test(poster.qr_token)) {
          throw new Error('unsafe QR token from the admin API');
        }
        if (ev.shortcode && (typeof ev.shortcode !== 'string' || !PATH_TOKEN.test(ev.shortcode))) {
          throw new Error('unsafe shortcode from the admin API');
        }
        const qr = { eventId: ev.id, node, qPath: `/q/${poster.qr_token}` };
        if (ev.shortcode) {
          qr.sPath = `/s/${ev.shortcode}`;
        } else {
          manifest.warnings.push(`no shortcode for ${ev.id}`);
        }
        const planned = showcase ? showcase.get(row) : null;
        if (planned) {
          qr.set = planned.set;
          qr.orientation = null;
          qr.codes = {};
        }
        manifest.qr.push(qr);
        for (const w of ev.warnings || []) manifest.warnings.push(`${ev.id} ${w.code}`);

        // The organizer's choice of codes, made through the organizer's own
        // route. A refused save is named and the build goes on: the event and its
        // event-page code stand without it.
        const body = planned ? posterCodesBody(planned.set, codeSets.donateUrl) : null;
        if (body) {
          try {
            const saved = await client.put(`/api/v2/admin/events/${ev.id}/poster-codes`, body);
            const list = Array.isArray(saved && saved.codes) ? saved.codes : [];
            for (const { kind } of body.codes) {
              const found = list.find((c) => c && c.kind === kind);
              if (found && typeof found.code === 'string' && PATH_TOKEN.test(found.code)) {
                qr.codes[kind] = `/s/${found.code}`;
              } else {
                manifest.warnings.push(`poster code ${kind} missing for ${ev.id}`);
              }
            }
          } catch (err) {
            manifest.warnings.push(`poster codes not saved for ${ev.id}: ${err.message}`);
          }
        }

        const post = planned ? planned.post : pick(row, posts);
        if (post) {
          try {
            const art = await loadArt(post, fetchFn, readFile);
            // The Worker answers { ok, status, file: { key, url, ... }, requestId }
            // (handlers/upload.ts). A key the purge could not name is never recorded.
            const up = await client.upload(ev.id, art.bytes, art.contentType);
            const file = up && up.file;
            if (!file || typeof file.key !== 'string' || !SAFE_ID.test(file.key)) {
              manifest.warnings.push(
                `art skipped for ${ev.id}: the upload answer has no usable key`
              );
            } else {
              // the object is in R2 now, so its key is recorded before anything else
              record('upload', file.key, node);
              if (typeof file.url === 'string' && file.url !== '') {
                await client.put(`/api/v2/admin/events/${ev.id}`, { cover_image_url: file.url });
                if (planned && post.orientation) qr.orientation = post.orientation;
                // the first upload of each picture joins the art pool for the sponsors
                const art = artKey(post);
                if (!artPool.has(art)) artPool.set(art, file.url);
              } else {
                manifest.warnings.push(`art skipped for ${ev.id}: the upload answer has no url`);
              }
            }
          } catch (err) {
            manifest.warnings.push(`art skipped for ${ev.id}: ${err.message}`);
          }
        }

        const anchor = anchorOf.get(node);
        if (!anchor) {
          manifest.warnings.push(`no anchor sponsor in ${node}: ${ev.id} has no placement`);
          continue;
        }
        // The anchor, then one regional and one local from this node, round-robin by
        // event name so every sponsor shows. Geo matching is off on staging, so
        // only an attached placement shows a sponsor.
        const idx = byName.get(row);
        const picks = [anchor];
        for (const t of ['mid', 'local']) {
          const pool = tierOf[t].get(node) || [];
          if (pool.length) picks.push(pool[idx % pool.length]);
        }
        for (const sponsorId of picks) {
          await client.put(`/api/v2/admin/sponsors/${sponsorId}`, { event_id: ev.id });
          const listed = await client.get(`/api/v2/admin/sponsors?eventId=${ev.id}`);
          const placement = (listed.items || []).find((i) => i.id === sponsorId && i.placement_id);
          if (!placement) {
            manifest.warnings.push(`placement id not found for ${ev.id}`);
            continue;
          }
          record('placement', placement.placement_id, node);
          // No admin API sets sponsor_accepted: the swap step applies it by SQL.
          manifest.acceptSql.push(placement.placement_id);
        }
      }
    }

    await giveSponsorsArt(client, manifest, [...artPool.values()]);
  } catch (err) {
    // Keep what was created so the purge can still remove it.
    err.manifest = manifest;
    throw err;
  }
  return manifest;
}
