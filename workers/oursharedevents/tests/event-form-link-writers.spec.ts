/**
 * Every form link the platform writes is the event's own address (OSE-1684).
 *
 * The admin Reg & Forms card opens each form, and nothing under src/ may build
 * the older /forms/<id>?type= address again (it keeps answering, for printed
 * and saved links, but is no longer written).
 *
 * @born-red 2026-10-10 | method: on main the card linked /forms/<id>?type=…&event=…
 * and the scan found seven writers of /forms/
 */
import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ADMIN_HTML from '../src/templates/admin.html';

type Section = (o: Record<string, unknown>) => { rowsHtml: string };

function section(): Section {
  const begin = ADMIN_HTML.indexOf('// @ose-forms-section:begin');
  const end = ADMIN_HTML.indexOf('// @ose-forms-section:end');
  expect(begin).toBeGreaterThan(-1);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- template code under test
  return new Function(`${ADMIN_HTML.slice(begin, end)}; return oseFormsSection;`)() as Section;
}

const ALL_ON = {
  'forms.register': true,
  'forms.checkin': true,
  'forms.survey': true,
  'forms.email-signup': true,
};

describe('the admin Reg & Forms card', () => {
  test('opens each form at /events/<id>/<screen>, with no event name in the address', () => {
    const { rowsHtml } = section()({
      types: [
        { key: 'register', flagKey: 'forms.register', label: 'Registration', desc: '' },
        { key: 'checkin', flagKey: 'forms.checkin', label: 'Check-in', desc: '' },
        { key: 'survey', flagKey: 'forms.survey', label: 'Survey', desc: '' },
        { key: 'email', flagKey: 'forms.email-signup', label: 'Email List', desc: '' },
      ],
      counts: [0, 0, 0, 0],
      eventFlags: ALL_ON,
      planFlags: ALL_ON,
      eventPhase: 2,
      eventId: 'evt_1',
      eventName: 'Bears & Beer',
      tierLabel: () => 'Free plan',
      phaseLabel: () => 'Community events',
    });
    const hrefs = [...rowsHtml.matchAll(/data-testid="form-link-[^"]+"/g)].length;
    expect(hrefs).toBe(4);
    for (const screen of ['register', 'checkin', 'survey', 'updates']) {
      expect(rowsHtml).toContain(`href="/events/evt_1/${screen}"`);
    }
    expect(rowsHtml).not.toContain('/forms/');
    expect(rowsHtml).not.toContain('Bears');
  });
});

describe('nothing the platform writes uses the older /forms/ address', () => {
  const SRC = join(__dirname, '..', 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|html)$/.test(n) ? [p] : [];
    });

  test('no line of code builds a /forms/ link (the router keeps serving it)', () => {
    const hits: string[] = [];
    for (const f of files(SRC)) {
      // robots.txt still keeps crawlers off /forms/: a rule, not a link.
      if (f.endsWith('crawl-policy.ts')) continue;
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const code = line.trim();
          if (/^(\/\/|\*|\/\*|<!--)/.test(code)) return; // prose about the old address is fine
          if (!/['"`]\/forms\/|\/forms\/\$\{/.test(code)) return;
          if (code.includes('/api/v2/')) return;
          hits.push(`${f.slice(SRC.length)}:${i + 1}`);
        });
    }
    expect(hits, 'write eventFormPath(id, type) (lib/canonical.ts) instead').toEqual([]);
  });
});
