/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own Bruno files */
/**
 * Every Bruno file parses, and every request file is a request.
 *
 * `bru run` does not fail on a file it cannot parse. It prints "Skipping invalid
 * file" and runs the rest, so the checks in that file never run and the run stays
 * green. A gate that cannot run counts as absent (AGENTS.md, Quality gates).
 *
 * Seen 2026-11-16, in a Bruno folder for the poster link rule that has since been
 * folded into "20. Poster code targets (OSE-1896)": three request names held
 * "javascript: link" and "http: link" unquoted. A colon and a space inside a plain
 * YAML value starts a nested mapping, so three of that folder's four refusal
 * requests were skipped. The run printed no failure for them.
 *
 * Born red: this test failed on those three files, naming each,
 * then passed when their names were quoted. Also seen failing with a request
 * file's `http.method` removed, and with its `seq` removed.
 */
const { readFileSync, readdirSync } = require('node:fs');
const { join, relative } = require('node:path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..');
const BRUNO = join(ROOT, 'bruno');

function ymlFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...ymlFiles(p));
    else if (e.name.endsWith('.yml')) out.push(p);
  }
  return out;
}

const files = ymlFiles(BRUNO);
const docs = files.map((file) => {
  const rel = relative(ROOT, file);
  try {
    return { rel, doc: yaml.load(readFileSync(file, 'utf8')) };
  } catch (err) {
    return { rel, error: String(err.reason || err.message).split('\n')[0] };
  }
});

describe('Bruno files', () => {
  test('there are files to read', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  test('every file parses (bru run skips one that does not, and stays green)', () => {
    const broken = docs.filter((d) => d.error).map((d) => `${d.rel}: ${d.error}`);
    expect(broken).toEqual([]);
  });

  test('every request file has a name, a place in the order, a method and an address', () => {
    const bad = docs
      .filter((d) => d.doc && d.doc.info && d.doc.info.type === 'http')
      .filter(
        ({ doc }) =>
          typeof doc.info.name !== 'string' ||
          doc.info.name.trim() === '' ||
          !Number.isInteger(doc.info.seq) ||
          typeof doc.http?.method !== 'string' ||
          typeof doc.http?.url !== 'string'
      )
      .map((d) => d.rel);
    expect(bad).toEqual([]);
  });
});
