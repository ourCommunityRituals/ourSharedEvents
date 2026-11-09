// The stg poster showcase (owner 2026-11-08). Each stock poster carries the code
// set its event type suggests, and every run shows each set with landscape AND
// portrait art, so stg holds every pair inside the existing poster.
//
// Poster language: the event type decides which calls to action the poster makes
// (the event; registration; donation). Each carries a person from the paper
// poster into the event's pages privately: /q and /s stay anonymous, and only a
// person who chooses REGISTER reaches a form.
//
// Choice: the type only suggests a starting set ("Choice though. they are not
// fixed."). The stock build plays the organizer and makes that choice through
// the organizer's own admin route. The app reads none of this.

/** The three sets, smallest first. */
export const SET_NAMES = ['events', 'events+registration', 'events+registration+donation'];

const ORIENTATIONS = ['landscape', 'portrait'];

// The same rule lib/poster-codes.ts applies to an external code's target.
const HTTPS = /^https:\/\/[^\s"'<>]+$/;

/** Validate stock/poster-code-sets.json; throws on anything the build cannot use. */
export function readCodeSets(raw) {
  if (!raw || typeof raw.types !== 'object' || raw.types === null || Array.isArray(raw.types)) {
    throw new Error('stock/poster-code-sets.json: no types map');
  }
  if (!SET_NAMES.includes(raw.default)) {
    throw new Error(`stock/poster-code-sets.json: default must be one of ${SET_NAMES.join(', ')}`);
  }
  for (const [type, set] of Object.entries(raw.types)) {
    if (!SET_NAMES.includes(set)) {
      throw new Error(`stock/poster-code-sets.json: unknown set ${set} for ${type}`);
    }
  }
  if (typeof raw.donateUrl !== 'string' || !HTTPS.test(raw.donateUrl)) {
    throw new Error('stock/poster-code-sets.json: donateUrl must be a full https:// address');
  }
  return { default: raw.default, types: { ...raw.types }, donateUrl: raw.donateUrl };
}

/** The set a type starts at. */
export function setFor(codeSets, typeId) {
  return Object.hasOwn(codeSets.types, typeId) ? codeSets.types[typeId] : codeSets.default;
}

/**
 * The PUT /api/v2/admin/events/:id/poster-codes body for a set, or null when
 * there is nothing to save (the event page code is implicit and always first).
 * REGISTER is the event's own form, so no link is sent for it.
 */
export function posterCodesBody(set, donateUrl) {
  if (set === 'events') return null;
  if (set === 'events+registration') return { codes: [{ kind: 'register' }] };
  if (set === 'events+registration+donation') {
    return { codes: [{ kind: 'register' }, { kind: 'donation', target_url: donateUrl }] };
  }
  throw new Error(`unknown set ${set}`);
}

const byTitle = (a, b) =>
  String(a.title).localeCompare(String(b.title)) ||
  String(a.venue).localeCompare(String(b.venue)) ||
  String(a.starts_at).localeCompare(String(b.starts_at));

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Each row's { set, post }. A row keeps the art `pick` chose for it, except
 * that a set with no portrait poster gives the portrait photo to its first event
 * by title, and a set with no landscape poster gives a landscape photo to its
 * first event by title. Neither takes away the set's only photo of the other
 * orientation: that gap is left for missingPairs to name. Deterministic: the
 * same rows and photos give the same plan.
 */
export function planShowcase(rows, { codeSets, posts, pick }) {
  const plan = new Map();
  for (const row of rows) {
    plan.set(row, { set: setFor(codeSets, row.event_type_id), post: pick(row, posts) || null });
  }
  const of = (orientation) =>
    [...(posts || [])].filter((p) => p.orientation === orientation).sort(byId);
  for (const set of SET_NAMES) {
    const members = rows.filter((r) => plan.get(r).set === set).sort(byTitle);
    if (!members.length) continue;
    const holders = (o) =>
      members.filter((r) => plan.get(r).post && plan.get(r).post.orientation === o);
    for (const orientation of ORIENTATIONS) {
      if (holders(orientation).length) continue;
      const photos = of(orientation);
      if (!photos.length) continue;
      // never take away the set's only photo of the other orientation: a gap is
      // left to be named (missingPairs), not traded for another
      const other = ORIENTATIONS.find((o) => o !== orientation);
      const only = holders(other).length === 1 ? holders(other)[0] : null;
      const row = members.find((r) => r !== only);
      if (!row) continue;
      // the photo that fits the event among this orientation's, else the first;
      // a pick from outside them is never trusted
      const fits = pick(row, photos);
      plan.set(row, { set, post: fits && photos.includes(fits) ? fits : photos[0] });
    }
  }
  return plan;
}

/** The (set, orientation) pairs a plan does not show, as 'set orientation'. */
export function missingPairs(plan) {
  const shown = new Set();
  for (const { set, post } of plan.values()) {
    if (post && post.orientation) shown.add(`${set} ${post.orientation}`);
  }
  const out = [];
  for (const set of SET_NAMES) {
    for (const o of ORIENTATIONS) if (!shown.has(`${set} ${o}`)) out.push(`${set} ${o}`);
  }
  return out;
}

const WORD = { register: 'REGISTER', donation: 'DONATE' };
const cellText = (s) => String(s).replace(/[|\r\n]/g, ' ');

/**
 * The run summary's "Poster showcase" table: for each (set, orientation), the
 * first poster that shows it, with its /q and every /s code, as full stg
 * addresses. A pair no poster shows is named. Empty for a manifest whose build
 * had no code sets.
 */
export function renderShowcase(manifest, baseUrl) {
  const qr = (manifest && Array.isArray(manifest.qr) ? manifest.qr : []).filter(
    (q) => q && typeof q.set === 'string'
  );
  if (!qr.length) return '';
  const lines = [
    '',
    '### Poster showcase',
    '',
    '| Code set | Art | Poster | /q (placement) | /s codes |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const set of SET_NAMES) {
    for (const o of ORIENTATIONS) {
      const q = qr.find((x) => x.set === set && x.orientation === o);
      if (!q) {
        lines.push(`| ${set} | ${o} | not shown this run | | |`);
        continue;
      }
      const poster = `${baseUrl}/events/${encodeURIComponent(q.eventId)}/poster`;
      const s = [q.sPath ? `${baseUrl}${q.sPath}` : 'no event code'];
      for (const [kind, p] of Object.entries(q.codes || {})) {
        s.push(`${WORD[kind] || kind.toUpperCase()} ${baseUrl}${p}`);
      }
      lines.push(
        `| ${set} | ${o} | ${poster} | ${q.qPath ? `${baseUrl}${q.qPath}` : ''} | ${cellText(s.join(' · '))} |`
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
