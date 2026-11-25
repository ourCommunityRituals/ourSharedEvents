/**
 * The off-limits list (OSE-2225, part of OSE-2222; OSE ADR-040 decision 12).
 *
 * Rules held here, each named after the fault it was watched failing on:
 *   1. every rule on the list refuses its own shape, and the refusal names the
 *      rule in plain words [a rule's pattern emptied];
 *   2. parseVotableLabel refuses through the list, so a rule added to the list
 *      reaches every route [parseVotableLabel given its own copy of the rules];
 *   3. the list is the only place a label rule lives: no file under src/ other
 *      than lib/vote-off-limits.ts holds the email or phone shape next to a
 *      vote label [a rule copied into the handler];
 *   4. the Voting card shows the warning, in the owner's words, tied to the
 *      label box [warning line removed];
 *   5. a person is never a kind (Q9): `person`, `team` and `event` stay off
 *      VOTABLE_KINDS, and `entry` is on it (decision 12) [kind left out].
 *
 * Placement: node project. Pure logic over imports and the source tree.
 *
 * @born-red OSE-2225 | method: injected-fault, each removed after; listed in
 * the PR body | date: 2026-11-24
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';
import { OFF_LIMITS_RULES, OFF_LIMITS_WARNING, offLimitsRuleFor } from '../src/lib/vote-off-limits';
import { isVotableKind, parseVotableLabel, VOTABLE_KINDS } from '../src/lib/votes';

const SRC = join(__dirname, '..', 'src');

/** One example each rule must refuse, and one each rule must let through. */
const SHAPES: Record<string, { refused: string[]; allowed: string[] }> = {
  email: {
    refused: ['Painting by ann@example.com', 'ann＠example.com', 'a@b'],
    allowed: ['Float @ the corner', 'The blue float'],
  },
  phone: {
    refused: ['Call 312 555 0199', '(312) 555-0199', '３１２５５５０１９９', '312​5550199'],
    allowed: ['Float 42', 'Chili, batch 2026'],
  },
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('OSE-2225 | the off-limits list', () => {
  test('1. every rule refuses its own shape and names itself in plain words', () => {
    expect(OFF_LIMITS_RULES.map((r) => r.id)).toEqual(Object.keys(SHAPES));
    for (const rule of OFF_LIMITS_RULES) {
      for (const label of SHAPES[rule.id].refused) {
        expect(offLimitsRuleFor(label)?.id, `${rule.id} refuses "${label}"`).toBe(rule.id);
      }
      for (const label of SHAPES[rule.id].allowed) {
        expect(offLimitsRuleFor(label), `"${label}" breaks no rule`).toBeNull();
      }
      expect(rule.words).toMatch(/^A label names the thing voted on/);
    }
  });

  test("2. parseVotableLabel refuses through the list, with the rule's words", () => {
    for (const rule of OFF_LIMITS_RULES) {
      for (const label of SHAPES[rule.id].refused) {
        const parsed = parseVotableLabel(label);
        expect(parsed.ok, `"${label}" is refused`).toBe(false);
        if (!parsed.ok) {
          expect(parsed.code).toBe('INVALID_LABEL');
          expect(parsed.error).toBe(rule.words);
        }
      }
    }
    expect(parseVotableLabel('The blue float')).toEqual({ ok: true, value: 'The blue float' });
  });

  test('3. the list is the only place a vote label rule lives', () => {
    const home = join('lib', 'vote-off-limits.ts');
    const shapes = [/\\S@\\S/, /\\p\{Nd\}\[\\s\(\)\.-\]\*\)\{7,\}/, /\\d\[\\s\(\)\.-\]\*\)\{7,\}/];
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (!/\.(ts|js)$/.test(file) || rel === home.split(sep).join('/')) continue;
      const text = readFileSync(file, 'utf8');
      // Only files that deal with vote labels: the vote modules and handlers.
      if (!/vot(e|able)/i.test(rel)) continue;
      if (shapes.some((s) => s.test(text))) offenders.push(rel);
    }
    expect(offenders, 'a vote label rule outside lib/vote-off-limits.ts').toEqual([]);
  });

  test('4. the Voting card shows the warning under the label box', () => {
    expect(OFF_LIMITS_WARNING).toBe('Name the work, not the person who made it.');
    const html = readFileSync(join(SRC, 'templates', 'admin.html'), 'utf8');
    const line =
      /<p class="sub-line" id="vote-label-warning" data-testid="vote-label-warning">([^<]*)<\/p>/.exec(
        html
      );
    expect(line?.[1]).toBe(OFF_LIMITS_WARNING);
    expect(html).toMatch(/id="vote-label"[^>]*aria-describedby="vote-label-warning /);
    expect(html).toContain('<option value="entry">Entry (anything you name)</option>');
  });

  test('5. a person is never a kind; an entry is (Q9, decision 12)', () => {
    expect([...VOTABLE_KINDS]).toEqual(['song', 'stall', 'entry']);
    for (const k of ['person', 'presenter', 'team', 'event']) expect(isVotableKind(k)).toBe(false);
  });
});
