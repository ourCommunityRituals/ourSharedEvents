/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own Bruno files */
/**
 * OSE-2146: the OSE-2095 search checks look for this run's event by its id, not
 * by a title every run shares.
 *
 * Every run of folder 21 makes an event with the same title, "OSE-2095 Zip Check
 * Night (staging, synthetic)", in ZIP 59718. Dispatch run 44338955374 (T2 api job
 * 134953772523) made one at 16:33:40 on 2026-11-18. The Bruno step's old 5-minute
 * limit then cut the run off at 16:33:56, before the folder's own cleanup, so
 * that event (evt_6e90cd7b-...) stayed live. Each later run deleted its own event
 * (DELETE 200, a hard delete) and then failed "the deleted event is gone from its
 * ZIP", because the check matched the leftover's title (runs 44339529342,
 * 44348442230, 44348581595).
 *
 * The checks now match the card of this run's own event,
 * `data-event-id="<w1ZipEventId>"`. This runs the real after-response script of
 * each search request against page bodies, with a stub of Bruno's res, bru, test
 * and expect. It proves:
 *   - a leftover with the same title but another id leaves every check green;
 *   - this run's event still listed after its delete fails seq 910;
 *   - this run's event missing from its ZIP fails the "lists it" checks;
 *   - with no id captured (setup failed), the "not listed" checks fail rather than
 *     pass on an empty match.
 *
 * Born red: against the title-matching scripts (main at a525aea9), the leftover
 * cases fail (seq 910, the failure seen on staging) and the "lists it" checks
 * pass with only the leftover listed.
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

const DIR = join(
  __dirname,
  '..',
  '..',
  'bruno',
  'ose-api',
  '21. The ZIP at the Where step (OSE-2095)'
);

const FILES = {
  lists20: 'OSE-2095 - search - 20 landing zip 59718 lists it.yml',
  notOther21: 'OSE-2095 - search - 21 landing zip 59715 does not.yml',
  lists22: 'OSE-2095 - search - 22 events q 59718 lists it.yml',
  words23: 'OSE-2095 - search - 23 events q Bozeman is words.yml',
  lists24: 'OSE-2095 - search - 24 landing where Bozeman lists it.yml',
  gone910: 'OSE-2095 - cleanup - 910 the event is no longer listed.yml',
};
const LISTS = [FILES.lists20, FILES.lists22, FILES.lists24];
const NOT_LISTED = [FILES.notOther21, FILES.words23, FILES.gone910];

const TITLE = 'OSE-2095 Zip Check Night (staging, synthetic)';
const RUN_ID = 'evt_11111111-2222-4333-8444-555555555555';
const LEFTOVER_ID = 'evt_6e90cd7b-f302-447a-a27d-dd1d0786b7df';

// A card as lib/event-list.ts renders it: the id on the article, the title in it.
const card = (id, title = TITLE) =>
  `<article class="event-card" data-testid="area-card" data-event-id="${id}" data-phase="upcoming">` +
  `<a class="event-card-link" href="/events/${id}/ose-2095-zip-check-night-staging-synthetic"></a>` +
  `<h3 data-testid="area-card-name">${title}</h3></article>`;
const page = (...cards) => `<!DOCTYPE html><html><main>${cards.join('\n')}</main></html>`;

function script(file) {
  const doc = yaml.load(readFileSync(join(DIR, file), 'utf8'));
  return doc.runtime.scripts.find((s) => s.type === 'after-response').code;
}

// Runs one request's script; returns the names of the tests that failed.
function run(file, body, vars) {
  const failed = [];
  const res = { getBody: () => body, getStatus: () => 200 };
  const bru = { setVar: (k, v) => (vars[k] = v), getVar: (k) => vars[k] };
  const fail = (m) => {
    throw new Error(m);
  };
  const expect = (actual) => ({
    to: {
      eql: (want) => actual === want || fail(`expected '${actual}' to deeply equal '${want}'`),
      include: (s) => String(actual).includes(s) || fail(`expected body to include '${s}'`),
      match: (re) => re.test(String(actual)) || fail(`expected '${actual}' to match ${re}`),
      not: {
        include: (s) => !String(actual).includes(s) || fail(`expected body to not include '${s}'`),
      },
    },
  });
  const test = (name, fn) => {
    try {
      fn();
    } catch (e) {
      failed.push(`${name}: ${e.message}`);
    }
  };
  new Function('res', 'bru', 'test', 'expect', script(file))(res, bru, test, expect);
  return failed;
}

const withRun = () => ({ w1ZipEventId: RUN_ID });

describe('OSE-2095 search checks match this run’s event, not the shared title', () => {
  test('a leftover from a stopped run (same title, other id) leaves seq 910 green', () => {
    expect(run(FILES.gone910, page(card(LEFTOVER_ID)), withRun())).toEqual([]);
  });

  test('this run’s event still listed after its delete fails seq 910', () => {
    const failed = run(FILES.gone910, page(card(LEFTOVER_ID), card(RUN_ID)), withRun());
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatch(/the deleted event is gone from its ZIP/);
  });

  test.each(LISTS)('%s: this run’s event listed is green, beside a leftover too', (file) => {
    expect(run(file, page(card(RUN_ID)), withRun())).toEqual([]);
    expect(run(file, page(card(LEFTOVER_ID), card(RUN_ID)), withRun())).toEqual([]);
  });

  test.each(LISTS)('%s: only a leftover listed is red (it is not this run’s event)', (file) => {
    const failed = run(file, page(card(LEFTOVER_ID)), withRun());
    expect(failed).toHaveLength(1);
  });

  test.each(NOT_LISTED)('%s: this run’s event listed is red', (file) => {
    expect(run(file, page(card(RUN_ID)), withRun())).toHaveLength(1);
  });

  test.each(NOT_LISTED)('%s: no id captured fails, never passes on an empty match', (file) => {
    for (const vars of [{}, { w1ZipEventId: 'missing-event' }]) {
      expect(run(file, page(), vars).length).toBeGreaterThan(0);
    }
  });

  test.each([...LISTS, ...NOT_LISTED])('%s no longer matches by the shared title', (file) => {
    expect(script(file)).not.toContain(TITLE);
  });
});
