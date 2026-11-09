/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- reads the repo's own sources and builds patterns from their variable names */
/**
 * The stock scripts read Worker answers through test fakes. This holds the three
 * together, per call: the top-level keys the stock code reads (taken from the
 * stock source itself), the keys the handler's success literal carries, and the
 * keys the fake in worker-bodies.js answers with.
 *
 *   read by the stock code  ⊆  the fake's keys  ⊆  the handler's success keys
 *
 * A stock script that reads a key the Worker never sends (the upload's `up.key`,
 * when the Worker answers `{ file: { key } }`) fails the first; a fake that
 * invents a shape fails the second.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const W = require('./worker-bodies');

const ROOT = path.join(__dirname, '../../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const HANDLERS = 'workers/oursharedevents/src/handlers';

// Skip a quoted string starting at i; returns the index after its closing quote.
function skipString(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') j++;
    else if (src[j] === q) return j + 1;
  }
  throw new Error('unterminated string');
}

// The index of the brace that closes the block or literal open at `open`.
function matchingBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i) - 1;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error('unbalanced braces');
}

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// The source of one named function, from its name to the brace that closes it.
function functionSource(rel, name) {
  const src = stripComments(read(rel));
  const at = src.search(new RegExp(`function ${name}\\(`));
  if (at < 0) throw new Error(`${name} not found in ${rel}`);
  // the body is the first `{` outside the parameter list
  let open = -1;
  let depth = 0;
  for (let i = src.indexOf('(', at); i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '{' && depth === 0) {
      open = i;
      break;
    }
  }
  return src.slice(open, matchingBrace(src, open) + 1);
}

// Top-level keys of the object literal that spans src[open..close].
function literalKeys(src, open, close) {
  const keys = [];
  let depth = 0;
  let start = open + 1;
  const take = (seg) => {
    const s = seg.trim();
    if (!s) return;
    const m = /^(\w+)\s*:/.exec(s) || /^(\w+)$/.exec(s);
    keys.push(m ? m[1] : s.startsWith('...') ? '...' : `?${s}`);
  };
  for (let i = open + 1; i < close; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') i = skipString(src, i) - 1;
    else if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      take(src.slice(start, i));
      start = i + 1;
    }
  }
  take(src.slice(start, close));
  return keys;
}

// Every success literal (`{ ok: true, ... }`) in a function, as its key list.
function successLiterals(rel, name) {
  const src = functionSource(rel, name);
  const out = [];
  for (const m of src.matchAll(/ok:\s*true\b/g)) {
    let depth = 0;
    let open = -1;
    for (let i = m.index; i >= 0; i--) {
      if (src[i] === '}') depth++;
      else if (src[i] === '{' && depth-- === 0) {
        open = i;
        break;
      }
    }
    out.push(literalKeys(src, open, matchingBrace(src, open)));
  }
  return out;
}

// The top-level keys the stock code reads off the answer bound by `anchor`
// (`const <name> = await client...`), within that binding's block.
function stockReads(rel, anchor) {
  const src = read(rel);
  const m = anchor.exec(src);
  if (!m) throw new Error(`${anchor} not found in ${rel}`);
  const name = m[1];
  let depth = 0;
  let end = src.length;
  for (let i = m.index + m[0].length; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') i = skipString(src, i) - 1;
    else if (c === '{') depth++;
    else if (c === '}' && --depth < 0) {
      end = i;
      break;
    }
  }
  const scope = src.slice(m.index + m[0].length, end);
  return [
    ...new Set(
      [...scope.matchAll(new RegExp(`(?<![\\w.])${name}\\.(\\w+)`, 'g'))].map((r) => r[1])
    ),
  ];
}

const BUILD = 'scripts/stock/build-full.mjs';
const CALLS = [
  {
    call: 'POST /api/v2/admin/events',
    handler: [`${HANDLERS}/events.ts`, 'handleCreateEvent'],
    stock: [BUILD, /const (\w+) = await client\.post\('\/api\/v2\/admin\/events',/],
    fake: W.eventCreate({ id: 'evt_1', shortcode: 'SC1' }),
  },
  {
    call: 'POST /api/v2/admin/events/:id/poster-deployments',
    handler: [`${HANDLERS}/poster-deployments.ts`, 'handleAdminCreatePosterDeployment'],
    stock: [
      BUILD,
      /const (\w+) = await client\.post\(`\/api\/v2\/admin\/events\/\$\{ev\.id\}\/poster-deployments`/,
    ],
    fake: W.posterCreate({ id: 'pd_1', qr_token: 'qrt_1' }),
  },
  {
    call: 'POST /api/v2/admin/events/:id/short-links',
    handler: [`${HANDLERS}/event-code.ts`, 'handleAdminEventCode'],
    // called for its side effect (it mints the /e/ code); nothing is read back
    stock: null,
    fake: W.shortLinks(),
  },
  {
    call: 'POST /api/v2/admin/events/:id/uploads',
    handler: [`${HANDLERS}/upload.ts`, 'ok201'],
    stock: [BUILD, /const (\w+) = await client\.upload\(/],
    fake: W.upload({
      key: 'events/evt_1/1-art.png',
      url: '/api/v2/uploads/events/evt_1/1-art.png',
    }),
  },
  {
    call: 'POST /api/v2/admin/sponsors',
    handler: [`${HANDLERS}/sponsors.ts`, 'handleAdminCreateSponsor'],
    stock: [BUILD, /const (\w+) = await client\.post\('\/api\/v2\/admin\/sponsors'/],
    fake: W.sponsorCreate({ id: 'sp_1' }),
  },
  {
    call: 'GET /api/v2/admin/sponsors?eventId=',
    handler: [`${HANDLERS}/sponsors.ts`, 'handleAdminListSponsors'],
    stock: [BUILD, /const (\w+) = await client\.get\(`\/api\/v2\/admin\/sponsors\?eventId=/],
    fake: W.sponsorList([]),
  },
  {
    call: 'PUT /api/v2/admin/events/:id/poster-codes',
    handler: [`${HANDLERS}/poster-codes.ts`, 'respond'],
    stock: [
      BUILD,
      /const (\w+) = await client\.put\(\s*`\/api\/v2\/admin\/events\/\$\{ev\.id\}\/poster-codes`/,
    ],
    fake: W.posterCodes({ codes: [{ kind: 'public', code: 'ABC234' }] }),
  },
  {
    call: 'GET /api/v2/events',
    handler: [`${HANDLERS}/events.ts`, 'handleListEvents'],
    stock: [
      'scripts/stock/check-full.mjs',
      /const (\w+) = await client\.get\('\/api\/v2\/events'\)/,
    ],
    fake: W.publicEvents([]),
  },
];

describe.each(CALLS)('$call', ({ handler, stock, fake }) => {
  const literals = successLiterals(...handler);
  const reads = stock ? stockReads(...stock) : [];

  test('the handler has a success literal the keys can be read from', () => {
    expect(literals.length).toBeGreaterThan(0);
    for (const keys of literals) expect(keys).toContain('ok');
  });

  test('every key the stock code reads is in every success literal of the handler', () => {
    for (const keys of literals) for (const k of reads) expect(keys, k).toContain(k);
  });

  test('the fake answers with every key the stock code reads', () => {
    for (const k of reads) expect(Object.keys(fake), k).toContain(k);
  });

  test('the fake invents no key the handler does not send', () => {
    for (const k of Object.keys(fake)) {
      expect(
        literals.some((keys) => keys.includes(k)),
        k
      ).toBe(true);
    }
  });
});

describe('the extraction itself', () => {
  test('reads the keys build-full takes off each answer', () => {
    expect(stockReads(BUILD, CALLS[0].stock[1]).sort()).toEqual(['id', 'shortcode', 'warnings']);
    expect(stockReads(BUILD, CALLS[3].stock[1])).toEqual(['file']);
    expect(stockReads(BUILD, CALLS[5].stock[1])).toEqual(['items']);
  });

  test('reads the upload handler’s success literal as the Worker sends it', () => {
    expect(successLiterals(`${HANDLERS}/upload.ts`, 'ok201')).toEqual([
      ['ok', 'status', 'file', 'requestId'],
    ]);
  });

  test('short-links is called and nothing is read back from it', () => {
    expect(read(BUILD)).toMatch(
      /^\s*await client\.post\(`\/api\/v2\/admin\/events\/\$\{ev\.id\}\/short-links`/m
    );
  });
});
