// Runs the street-map archive check (./check.ts) on one local file. Started by
// `node scripts/check-street-map-archive.mjs <file>`, which sets the variables
// read here; vitest is only the TypeScript runner. This file is in no CI
// project: it needs an archive that is never committed. The checker's own tests
// are tests/street-map-archive-check.spec.ts.
//
// It writes what it found as `<file>.check.json` (the record kept with the
// archive: size, SHA-256, layout, draws), which the command prints, and fails on
// any problem. With no file named it fails; it never passes by skipping.

import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { open, stat, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { expect, it } from 'vitest';
import type { RangeSource } from '../../src/lib/pmtiles.js';
import { checkArchive, defaultProbes, type Probe } from './check.js';

const ARCHIVE_NAME = /^[a-z0-9][a-z0-9._-]{0,80}\.pmtiles$/;

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** The archive names the Worker reads (wrangler.toml sets one per environment). */
function namesTheWorkerReads(): string[] {
  const toml = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  return [...new Set([...toml.matchAll(/^MAP_TILES_ARCHIVE\s*=\s*"([^"]*)"/gm)].map((m) => m[1]!))];
}

it('the archive is one the Worker can draw streets from', async () => {
  const file = process.env.STREET_MAP_ARCHIVE_FILE;
  if (!file) {
    throw new Error('no archive named: node scripts/check-street-map-archive.mjs <file.pmtiles>');
  }
  const name = basename(file);
  const { size } = await stat(file);
  const probes: Probe[] = defaultProbes();
  const extra = (process.env.STREET_MAP_ARCHIVE_CELLS ?? '').split(',').filter(Boolean);
  if (extra.length) probes.push({ name: 'the cells given', cells: extra, expect: 'streets' });

  const fh = await open(file, 'r');
  const src: RangeSource = {
    key: `file:${file}`,
    async read(offset, length) {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, offset);
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    },
  };
  let report;
  try {
    report = await checkArchive(src, size, { probes });
  } finally {
    await fh.close();
  }

  const problems = [...report.problems];
  if (!ARCHIVE_NAME.test(name)) problems.push(`name: the Worker refuses the key "${name}"`);
  const read = namesTheWorkerReads();
  if (read.length === 0) problems.push('name: wrangler.toml sets no MAP_TILES_ARCHIVE');
  for (const n of read) {
    if (n !== name) problems.push(`name: wrangler.toml reads "${n}"; this file is "${name}"`);
  }

  const record = {
    check: 'street-map-archive',
    checkedAt: new Date().toISOString(),
    readerCommit: process.env.STREET_MAP_CHECK_COMMIT || null,
    file: name,
    bytes: size,
    sha256: await sha256(file),
    pass: problems.length === 0,
    problems,
    header: report.header,
    directories: report.directories,
    draws: report.probes,
  };
  // The command prints from this record, so what is shown is what is kept.
  await writeFile(`${file}.check.json`, `${JSON.stringify(record, null, 2)}\n`);
  expect(problems).toEqual([]);
});
