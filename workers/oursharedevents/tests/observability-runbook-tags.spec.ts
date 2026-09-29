/**
 * OSE-1380 (L7 observability) — the runbook must not name a structured-log tag
 * the Worker does not emit.
 *
 * `docs/ops/OBSERVABILITY.md` tells an operator to "consume these" tags in a Tail
 * Worker / Instant Logs. When a named tag is wrong the operator greps a line that
 * never appears: the runbook shipped `LIFECYCLE`, but the Worker emits
 * `LIFECYCLE_COMPLETE` (+ `LIFECYCLE_PHASE_ERROR`) — there is no bare `LIFECYCLE`
 * line. This gate ties the doc's canonical tag block to what `src/` actually
 * emits so that drift is a red test, not a silent dead-end for whoever is on call.
 *
 * Born-red: reverting `LIFECYCLE_COMPLETE` in the block back to `LIFECYCLE` fails
 * the "every documented tag is emitted" test. Node pool — reads files from disk
 * via node:fs, the same idiom as d1-canonical-shape.spec.ts.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workerRoot = join(here, '..');

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkTs(p));
    else if (ent.isFile() && p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Every structured-log `type: 'TAG'` (UPPER_SNAKE) emitted anywhere under src/. */
function emittedTags(): Set<string> {
  const tags = new Set<string>();
  for (const file of walkTs(join(workerRoot, 'src'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/type:\s*'([A-Z][A-Z0-9_]+)'/g)) tags.add(m[1]);
  }
  return tags;
}

/** The tags the runbook presents inside its delimited, machine-checked block. */
function documentedTags(): string[] {
  const doc = readFileSync(join(workerRoot, 'docs/ops/OBSERVABILITY.md'), 'utf8');
  const block = doc.match(/STRUCTURED_LOG_TAGS:start[\s\S]*?STRUCTURED_LOG_TAGS:end/);
  if (!block) throw new Error('OBSERVABILITY.md is missing the STRUCTURED_LOG_TAGS block');
  return [...block[0].matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((x) => x[1]);
}

describe('OSE-1380 observability runbook names only real structured-log tags', () => {
  test('the canonical block still lists the core request-path tags', () => {
    const doc = documentedTags();
    for (const core of ['FORM_EVENT', 'FLAG_EVENT', 'TURNSTILE_EVENT', 'OPERATION_COST']) {
      expect(doc).toContain(core);
    }
    expect(doc.length).toBeGreaterThanOrEqual(5);
  });

  test('every tag the runbook tells operators to consume is actually emitted by src/', () => {
    const emitted = emittedTags();
    const missing = documentedTags().filter((t) => !emitted.has(t));
    expect(missing).toEqual([]);
  });

  test('sanity: the emitter scan finds known lines (guards a broken regex → false green)', () => {
    const emitted = emittedTags();
    // If these vanish, the scan regex broke (not that the tags were removed) —
    // without this, an empty `emitted` set would make `missing` trivially [].
    expect(emitted.has('OPERATION_COST')).toBe(true);
    expect(emitted.has('LIFECYCLE_COMPLETE')).toBe(true);
  });
});
