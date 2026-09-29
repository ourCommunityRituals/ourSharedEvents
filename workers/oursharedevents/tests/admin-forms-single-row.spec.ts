/**
 * OSE-1361 — the four forms, each shown exactly once, with ONE upsell line.
 *
 * Staging showed Registration / Check-in / Survey / Email List three times on
 * the admin event page (locked cards each carrying its own full-width tan
 * "Upgrade to Pro plan to unlock" banner, four "<5" tiles, and a FORM CONFIG
 * list reading "Survey (<5) Post-event feedback — requires mid").
 *
 * Reconciled against main first: PR #645 already collapsed the three lists into
 * one row per form (and removed the FORM CONFIG markup and its "requires mid"
 * copy). What was still wrong on main, and what this spec pins:
 *   - every locked row carried its OWN "Upgrade to …" banner (up to four);
 *   - the banner was a hardcoded tan light-mode fill (#fff3bf / #664d03);
 *   - the toggle did not carry the lock: a phase-locked form's toggle stayed
 *     live, and an organizer turning a form OFF for this event was shown as an
 *     "Upgrade" lock because the lock read the per-event flag, not the plan.
 *
 * The rows + upsell are now built by one pure function, `oseFormsSection`,
 * which this spec extracts from the served admin HTML and RUNS.
 *
 * @born-red OSE-1361 | method: ran against origin/main admin.html (restored via tagged git stash) — the extraction marker is absent, and the per-row lock-overlay / tan-hex source assertions fail | date: 2026-09-29
 */
import { describe, expect, test } from 'vitest';
import ADMIN_HTML from '../src/templates/admin.html';

type Section = (o: Record<string, unknown>) => { rowsHtml: string; upsellHtml: string };

function extract(html: string): Section {
  const begin = html.indexOf('// @ose-forms-section:begin');
  const end = html.indexOf('// @ose-forms-section:end');
  expect(begin, 'admin.html must carry the oseFormsSection block').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${html.slice(begin, end)}; return oseFormsSection;`)() as Section;
}

// Lazy, so each test reports on its own (a missing block fails the behaviour
// tests, not the whole file).
let cached: Section | null = null;
const section: Section = (o) => (cached ??= extract(ADMIN_HTML))(o);

// The same four types loadForms declares (asserted against the source below).
const TYPES = [
  { key: 'register', flagKey: 'forms.register', label: 'Registration', desc: 'Pre-event sign-up' },
  { key: 'checkin', flagKey: 'forms.checkin', label: 'Check-in', desc: 'Walk-in door tally' },
  {
    key: 'survey',
    flagKey: 'forms.survey',
    label: 'Survey',
    desc: 'Post-event feedback',
    upgradeTier: 'mid',
    upgradePhase: 2,
  },
  {
    key: 'email',
    flagKey: 'forms.email-signup',
    label: 'Email List',
    desc: 'Voluntary opt-in',
    upgradeTier: 'mid',
    upgradePhase: 2,
  },
];
const TIER: Record<string, string> = {
  free: 'Free plan',
  mid: 'Pro plan',
  enterprise: 'Enterprise plan',
};
const PHASE: Record<number, string> = { 1: 'Community events', 2: 'Commerce events' };
const FREE_PLAN = {
  'forms.register': true,
  'forms.checkin': true,
  'forms.survey': false,
  'forms.email-signup': false,
};

function build(over: Record<string, unknown> = {}) {
  return section({
    types: TYPES,
    counts: ['suppressed', 'suppressed', 'suppressed', 'suppressed'],
    eventFlags: FREE_PLAN,
    planFlags: FREE_PLAN,
    eventPhase: 2,
    eventId: 'evt-1',
    eventName: 'Bocce Night',
    tierLabel: (s: string) => TIER[s] || 'Free plan',
    phaseLabel: (p: number) => PHASE[p] || 'Community events',
    ...over,
  });
}
const count = (html: string, re: RegExp) => (html.match(re) || []).length;

describe('OSE-1361: each form exactly once, one row each', () => {
  test('four rows, one per form, each with name, one-line purpose, count and toggle', () => {
    const { rowsHtml } = build();
    for (const t of TYPES) {
      expect(count(rowsHtml, new RegExp(`data-testid="form-row-${t.key}"`, 'g')), t.key).toBe(1);
      expect(count(rowsHtml, new RegExp(`data-testid="form-toggle-${t.key}"`, 'g')), t.key).toBe(1);
      expect(count(rowsHtml, new RegExp(`data-testid="form-count-${t.key}"`, 'g')), t.key).toBe(1);
      expect(count(rowsHtml, new RegExp(`>${t.label}<`, 'g')), t.key).toBe(1);
      expect(rowsHtml).toContain(t.desc);
    }
  });

  test('counts stay K-anonymous: a floored count renders "<5", never a raw number', () => {
    const { rowsHtml } = build();
    expect(count(rowsHtml, /data-testid="count-suppressed"/g)).toBe(4);
    expect(rowsHtml).toContain('&lt;5');
  });
});

describe('OSE-1361: ONE upsell line for the section, in organizer language', () => {
  test('two plan-locked forms produce exactly one upsell line, naming the plan', () => {
    const { rowsHtml, upsellHtml } = build();
    expect(rowsHtml).not.toMatch(/Upgrade to|lock-overlay/);
    expect(count(upsellHtml, /data-testid="forms-upsell"/g)).toBe(1);
    expect(count(upsellHtml, /Upgrade to/g)).toBe(1);
    expect(upsellHtml).toContain('Survey and Email List come with the Pro plan.');
    expect(upsellHtml).toContain('Upgrade to Pro plan to unlock.');
  });

  test('no tier codes ever reach the organizer (no "mid", no "requires")', () => {
    const { rowsHtml, upsellHtml } = build();
    const text = (rowsHtml + upsellHtml).replace(/<[^>]*>/g, ' ');
    expect(text).not.toMatch(/\bmid\b|\benterprise\b|requires/i);
    // aria-labels are read aloud, so they count as visible copy too.
    expect(rowsHtml).not.toMatch(/aria-label="[^"]*\bmid\b/);
  });

  test('a phase-locked form says where it is available, still in one line', () => {
    const all = {
      'forms.register': true,
      'forms.checkin': true,
      'forms.survey': true,
      'forms.email-signup': true,
    };
    const { upsellHtml } = build({ eventFlags: all, planFlags: all, eventPhase: 1 });
    expect(count(upsellHtml, /data-testid="forms-upsell"/g)).toBe(1);
    expect(upsellHtml).toContain('Survey and Email List are available for Commerce events.');
    expect(upsellHtml).not.toContain('Upgrade');
  });

  test('nothing locked, no upsell at all', () => {
    const all = {
      'forms.register': true,
      'forms.checkin': true,
      'forms.survey': true,
      'forms.email-signup': true,
    };
    expect(build({ eventFlags: all, planFlags: all }).upsellHtml).toBe('');
  });
});

describe('OSE-1361: the toggle carries the lock state', () => {
  const toggle = (html: string, key: string) =>
    html.match(
      new RegExp(`<label class="toggle"[^>]*>\\s*<input[^>]*data-testid="form-toggle-${key}"[^>]*>`)
    )![0];

  test('plan-locked forms: toggle disabled, unchecked, and its label says why', () => {
    const { rowsHtml } = build();
    for (const k of ['survey', 'email']) {
      const t = toggle(rowsHtml, k);
      expect(t, k).toContain(' disabled');
      expect(t, k).not.toContain(' checked');
      expect(t, k).toMatch(/aria-label="[^"]*locked, comes with the Pro plan"/);
    }
    for (const k of ['register', 'checkin']) {
      const t = toggle(rowsHtml, k);
      expect(t, k).not.toContain(' disabled');
      expect(t, k).toContain(' checked');
    }
  });

  test('a form the organizer turned OFF for this event is off, not "locked" and not an upsell', () => {
    const { rowsHtml, upsellHtml } = build({
      eventFlags: { ...FREE_PLAN, 'forms.register': false },
    });
    const t = toggle(rowsHtml, 'register');
    expect(t).not.toContain(' disabled');
    expect(t).not.toContain(' checked');
    expect(upsellHtml).not.toContain('Registration');
    expect(rowsHtml).not.toMatch(/form-row feature-locked" data-testid="form-row-register"/);
  });

  test('phase-locked forms: toggle disabled even when the plan includes them', () => {
    const all = {
      'forms.register': true,
      'forms.checkin': true,
      'forms.survey': true,
      'forms.email-signup': true,
    };
    const { rowsHtml } = build({ eventFlags: all, planFlags: all, eventPhase: 1 });
    expect(toggle(rowsHtml, 'survey')).toContain(' disabled');
    expect(toggle(rowsHtml, 'survey')).toMatch(
      /aria-label="Survey: available for Commerce events"/
    );
  });
});

describe('OSE-1361: wired into loadForms; the tan banner is gone', () => {
  test('loadForms builds rows with oseFormsSection, the upsell rendered once after the list', () => {
    expect(ADMIN_HTML).toContain('const section = oseFormsSection({');
    expect(ADMIN_HTML).toContain(
      `'<div class="forms-list" data-testid="forms-list">' + formRowsHtml + '</div>' + section.upsellHtml +`
    );
    for (const t of TYPES) expect(ADMIN_HTML).toContain(`key: '${t.key}', flagKey: '${t.flagKey}'`);
  });

  test('no per-row lock banner is built anywhere in the page', () => {
    expect(ADMIN_HTML).not.toContain(`'<div class="lock-overlay">Upgrade to '`);
    expect(ADMIN_HTML).not.toContain('.feature-locked .lock-overlay');
  });

  test('the upsell sits on @ocr/ui tokens, not the light-only tan fill', () => {
    expect(ADMIN_HTML).not.toMatch(/#fff3bf/i);
    expect(ADMIN_HTML).not.toMatch(/#664d03/i);
    expect(ADMIN_HTML).toMatch(
      /\.lock-overlay \{[^}]*background: var\(--surface-hover\);[^}]*border: 1px solid var\(--border\);/
    );
  });

  test('the dead FORM CONFIG styles are gone with the markup #645 removed', () => {
    expect(ADMIN_HTML).not.toContain('.form-config');
  });
});
