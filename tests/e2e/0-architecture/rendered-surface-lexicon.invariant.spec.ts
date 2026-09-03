/**
 * INVARIANT #25 (surface leg): the honesty lexicon holds on RENDERED surfaces.
 *
 * The brain bans a catalogue of audience-inflation words (attendance,
 * impressions, reach, unique, turnout, eyeballs, people, views, visits) because
 * the platform counts signals, never bodies. OSE-801 put that ban on the SCHEMA
 * (src/lib/schema-lexicon.ts guards identifiers). Its own header calls the
 * surface lint "aspirational". OSE-1201 found "75% attendance rate" on the
 * public post-event recap — a banned word on the most-shared page — and this
 * spec is the gate that was missing.
 *
 * What it matches (deliberately narrower than a bare-word grep, because the
 * brand's own anti-promise reads "corridors and venues, not people"):
 *   1. COUNT CLAIMS — a number or template expression followed by a banned word
 *      ("449 people", "${n} views", "' + n + ' impressions").
 *   2. METRIC LABELS — a banned word used as a measurement name: "attendance
 *      rate", a <th>/<dt>/<h3> cell reading "Impressions" / "Unique gatherings",
 *      a data-label or aria-label naming one.
 * Comments are stripped first; legal blocks are prose, not counts, so the GDPR
 * "attendance numbers" sentence in form-pages.ts is not matched by either rule.
 *
 * The banned list is read from schema-lexicon.ts so the vocabulary has ONE home.
 *
 * Ratchet, not a big-bang: a file with pre-existing debt may be listed in
 * KNOWN_DEBT and its count may only go DOWN; every other rendered source must
 * be at zero. shared-report.html was the only row (11 labels, OSE-1204) and was
 * paid down the same day — the map is empty and the spec is a flat zero.
 *
 * Structural: reads source from disk, no worker needed (T0 Gate invariants shard).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKER = join(REPO_ROOT, 'workers', 'oursharedevents', 'src');
const LEXICON = join(WORKER, 'lib', 'schema-lexicon.ts');

/** Pre-existing debt. File → maximum allowed hits. Only shrinks. */
const KNOWN_DEBT: Record<string, { max: number; ticket: string }> = {};

function renderedSources(): string[] {
  const templates = readdirSync(join(WORKER, 'templates'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => `templates/${f}`);
  return [...templates, 'handlers/pages.ts', 'handlers/form-pages.ts'];
}

function bannedTerms(): string[] {
  const src = readFileSync(LEXICON, 'utf8');
  const block = src.match(/BANNED_SCHEMA_TERMS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (!block) throw new Error('schema-lexicon.ts: BANNED_SCHEMA_TERMS block not found');
  return [...block[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
}

function stripComments(s: string, isTs: boolean): string {
  let out = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (!isTs) out = out.replace(/<!--[\s\S]*?-->/g, '');
  return out;
}

function violations(rel: string, terms: string[]): Array<{ line: number; text: string }> {
  const B = terms.join('|');
  const countClaim = new RegExp(
    `(\\d+|\\$\\{[^}]{0,80}\\}|'\\s*\\+\\s*[A-Za-z_.()\\[\\]]+\\s*\\+\\s*')\\s*%?\\s*(?:of\\s+)?(${B})\\b`,
    'i'
  );
  const metricLabel = new RegExp(
    `(?:attendance|impressions?|turnout|eyeballs?|reach|unique)\\s+(?:rate|count|total|share)\\b` +
      `|>\\s*(?:sponsor\\s+)?(?:impressions?|unique\\s+\\w+|attendance|turnout|reach|eyeballs?)\\s*<` +
      `|data-label="[^"]*\\b(?:impressions?|unique|attendance|turnout|reach|eyeballs?)\\b` +
      `|aria-label="[^"]*\\b(?:impressions?|attendance|turnout)\\b`,
    'i'
  );
  const src = stripComments(readFileSync(join(WORKER, rel), 'utf8'), rel.endsWith('.ts'));
  const out: Array<{ line: number; text: string }> = [];
  src.split('\n').forEach((l, i) => {
    if (countClaim.test(l) || metricLabel.test(l))
      out.push({ line: i + 1, text: l.trim().slice(0, 120) });
  });
  return out;
}

test.describe('INVARIANT #25 | rendered-surface lexicon (OSE-1201)', () => {
  const terms = bannedTerms();

  test('the banned vocabulary still has one home (schema-lexicon.ts)', () => {
    expect(terms).toEqual(
      expect.arrayContaining(['attendance', 'impressions', 'reach', 'unique', 'people', 'views'])
    );
  });

  for (const rel of renderedSources()) {
    test(`${rel} claims no bodies: no count-claims or metric labels in banned vocabulary`, () => {
      const hits = violations(rel, terms);
      const debt = KNOWN_DEBT[rel];
      const max = debt ? debt.max : 0;
      const detail = hits.map((h) => `  L${h.line}: ${h.text}`).join('\n');
      expect(
        hits.length,
        debt
          ? `${rel}: ${hits.length} hits, ratchet allows ${max} (${debt.ticket}). Pay debt down, never up.\n${detail}`
          : `${rel}: banned lexicon on a rendered surface — rename by what was measured (checked in, registered, displays, distinct signals).\n${detail}`
      ).toBeLessThanOrEqual(max);
    });
  }

  test('KNOWN_DEBT rows are real: a paid-down file must have its row removed', () => {
    for (const [rel, debt] of Object.entries(KNOWN_DEBT)) {
      const hits = violations(rel, terms).length;
      expect(
        hits,
        `${rel}: debt row says ${debt.max} but only ${hits} remain — lower the max`
      ).toBe(debt.max);
    }
  });
});
