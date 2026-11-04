// Build one day of stock data through the Worker's real admin API, and record
// every id it creates in a manifest (the check, swap and purge steps read it).
import { pickArt } from './instagram.mjs';
import { chicagoDate } from './validate-finds.mjs';

// The sponsor tiers the stock plan uses, and the tier word the Worker accepts
// for each (handlers/sponsors.ts VALID_TIERS has no premium, mid or local).
const API_TIER = { premium: 'title', mid: 'gold', local: 'bronze' };

export function sponsorTier(business, regionals) {
  if (business.anchor === true) return 'premium';
  const list = Array.isArray(regionals) ? regionals : (regionals && regionals.regionals) || [];
  return list.includes(business.name) ? 'mid' : 'local';
}

// Private before public, then the soonest start.
function bySectorThenStart(a, b) {
  const rank = (r) => (r.sector === 'private' ? 0 : 1);
  return rank(a) - rank(b) || Date.parse(a.starts_at) - Date.parse(b.starts_at);
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
  targets,
  date,
  fetch: fetchFn = globalThis.fetch,
}) {
  const perNode = targets.perNode;
  const manifest = { date, items: [], qr: [], acceptSql: [], short: {}, warnings: [] };
  const record = (kind, id, node) => manifest.items.push({ kind, id, node });

  try {
    // Sponsors first: one per business, into the root brand's pool.
    const anchorOf = new Map();
    for (const business of businesses) {
      const tier = sponsorTier(business, regionals);
      const res = await client.post('/api/v2/admin/sponsors', {
        brand_id: 'root',
        name: business.name,
        address_line: business.address,
        tier: API_TIER[tier],
      });
      manifest.items.push({ kind: 'sponsor', id: res.id, node: business.node, tier });
      if (tier === 'premium' && !anchorOf.has(business.node)) anchorOf.set(business.node, res.id);
    }

    const nodeIds = [
      ...new Set([...accepted.map((r) => r.node), ...businesses.map((b) => b.node)]),
    ];
    for (const node of nodeIds) {
      const rows = accepted
        .filter((r) => r.node === node)
        .sort(bySectorThenStart)
        .slice(0, perNode);
      if (rows.length < perNode) manifest.short[node] = perNode - rows.length;

      for (const row of rows) {
        const ev = await client.post('/api/v2/admin/events', {
          brand_id: 'root',
          status: 'active',
          is_published: true,
          title: row.title,
          description: row.summary,
          location: row.venue,
          where_address: row.address,
          event_type_id: row.event_type_id,
          start_date: chicagoDate(row.starts_at),
          lat: row.lat,
          lon: row.lng,
        });
        record('event', ev.id, node);

        const poster = await client.post(`/api/v2/admin/events/${ev.id}/poster-deployments`, {
          placement_label: row.venue,
          placement_type: 'venue',
        });
        record('poster', poster.id, node);
        const links = await client.post(`/api/v2/admin/events/${ev.id}/short-links`, {});
        manifest.qr.push({
          eventId: ev.id,
          node,
          qPath: `/q/${poster.qr_token}`,
          sPath: links.links.share,
        });

        const post = pickArt(row, posts, artTags);
        if (post) {
          try {
            const art = await downloadArt(fetchFn, post.mediaUrl);
            const up = await client.upload(ev.id, art.bytes, art.contentType);
            record('upload', up.key, node);
            await client.put(`/api/v2/admin/events/${ev.id}`, { cover_image_url: up.url });
          } catch (err) {
            manifest.warnings.push(`art skipped for ${ev.id}: ${err.message}`);
          }
        }

        const anchor = anchorOf.get(node);
        if (!anchor) {
          manifest.warnings.push(`no anchor sponsor in ${node}: ${ev.id} has no placement`);
          continue;
        }
        await client.put(`/api/v2/admin/sponsors/${anchor}`, { event_id: ev.id });
        const listed = await client.get(`/api/v2/admin/sponsors?eventId=${ev.id}`);
        const placement = (listed.items || []).find((i) => i.id === anchor && i.placement_id);
        if (!placement) {
          manifest.warnings.push(`placement id not found for ${ev.id}`);
          continue;
        }
        record('placement', placement.placement_id, node);
        // No admin API sets sponsor_accepted: the swap step applies it by SQL.
        manifest.acceptSql.push(placement.placement_id);
      }
    }
  } catch (err) {
    // Keep what was created so the purge can still remove it.
    err.manifest = manifest;
    throw err;
  }
  return manifest;
}
