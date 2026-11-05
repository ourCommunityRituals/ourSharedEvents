// Build one day of stock data through the Worker's real admin API, and record
// every id it creates in a manifest (the check, swap and purge steps read it).
import { readFile as fsReadFile } from 'node:fs/promises';
import { pickArt } from './instagram.mjs';
import { chicagoDate } from './validate-finds.mjs';
import { SAFE_ID } from './purge-full.mjs';

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
  // Called with the manifest after every id it records, so the caller can save it
  // as it grows: a build killed mid-run still leaves what it created on record.
  onRecord = () => {},
}) {
  const want = (node) => {
    const n = expected && expected[node];
    return Number.isInteger(n) && n > 0 ? n : 0;
  };
  const manifest = { date, items: [], qr: [], acceptSql: [], short: {}, warnings: [] };
  const record = (kind, id, node, extra = {}) => {
    manifest.items.push({ kind, id, node, ...extra });
    onRecord(manifest);
  };

  try {
    // Sponsors first: one per business, into the root brand's pool.
    const anchorOf = new Map();
    // per node, the regional (mid) and local sponsor ids in creation order
    const tierOf = { mid: new Map(), local: new Map() };
    for (const business of businesses) {
      const tier = sponsorTier(business, regionals);
      const res = await client.post('/api/v2/admin/sponsors', {
        brand_id: 'root',
        name: business.name,
        address_line: business.address,
        tier: SPONSOR_TIER_WIRE[tier],
        // the Worker derives the sponsor cells from lat/lon only and never
        // geocodes address_line (handleAdminCreateSponsor)
        lat: business.lat,
        lon: business.lng,
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
    for (const node of nodes) {
      const rows = accepted
        .filter((r) => r.node === node)
        .sort(bySectorThenStart)
        .slice(0, want(node));
      if (rows.length < want(node)) manifest.short[node] = want(node) - rows.length;
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
        const ev = await client.post('/api/v2/admin/events', {
          brand_id: 'root',
          status: 'active',
          is_published: true,
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
        });
        record('event', ev.id, node);
        if (end.skip) manifest.warnings.push(`${ev.id} ends_at not sent: ${end.skip}`);

        const poster = await client.post(`/api/v2/admin/events/${ev.id}/poster-deployments`, {
          placement_label: row.venue,
          placement_type: 'venue',
        });
        record('poster', poster.id, node);
        // mints the event's /e/ share code; the /s/ routing link is the create's shortcode
        await client.post(`/api/v2/admin/events/${ev.id}/short-links`, {});
        const qr = { eventId: ev.id, node, qPath: `/q/${poster.qr_token}` };
        if (ev.shortcode) {
          qr.sPath = `/s/${ev.shortcode}`;
        } else {
          manifest.warnings.push(`no shortcode for ${ev.id}`);
        }
        manifest.qr.push(qr);
        for (const w of ev.warnings || []) manifest.warnings.push(`${ev.id} ${w.code}`);

        const post = pickArt(row, posts, artTags, typeCategory);
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
        // event name so every sponsor shows. Geo matching is off on staging-full, so
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
  } catch (err) {
    // Keep what was created so the purge can still remove it.
    err.manifest = manifest;
    throw err;
  }
  return manifest;
}
