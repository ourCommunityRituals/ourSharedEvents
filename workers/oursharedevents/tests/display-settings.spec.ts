import { describe, expect, test } from 'vitest';
import {
  DEFAULT_DISPLAY_PANES,
  DISPLAY_PANES,
  parseEventSettings,
  resolveDisplaySettings,
  resolveEventSettings,
  validateSettingsPatch,
} from '../src/lib/event-settings';
import { generateQrCode } from '../src/lib/qr';

// OSE-851 (X-14) second slice: the TV display's saved order, seconds per
// screen and league links live in events.settings_json beside showQRSection,
// read and written only through lib/event-settings.ts.

describe('display settings: the reader never throws and never trusts', () => {
  test('nothing stored → default order, 15 s, no league links, no donate link', () => {
    expect(resolveDisplaySettings(parseEventSettings('{}'))).toEqual({
      panes: ['event', 'upcoming', 'sponsors', 'league', 'donate'],
      dwellSeconds: 15,
      leagueLinks: {},
      donateLink: null,
    });
  });

  test('a stored order, dwell and links come back resolved', () => {
    const s = parseEventSettings(
      JSON.stringify({
        displayPanes: ['league', 'event'],
        displayDwellSeconds: 30,
        leagueLinks: { standings: 'https://league.example/standings' },
      })
    );
    expect(resolveDisplaySettings(s)).toEqual({
      panes: ['league', 'event'],
      dwellSeconds: 30,
      leagueLinks: { standings: 'https://league.example/standings' },
      donateLink: null,
    });
  });

  test('junk stored values are dropped, each on its own', () => {
    const s = parseEventSettings(
      JSON.stringify({
        displayPanes: ['event', 'event'],
        displayDwellSeconds: 9000,
        leagueLinks: {
          schedule: 'javascript:alert(1)',
          standings: 'http://plain.example/',
          bracket: 'https://ok.example/b',
          scores: 'https://unknown-kind.example/',
        },
      })
    );
    expect(s).toEqual({ leagueLinks: { bracket: 'https://ok.example/b' } });
  });

  test('the poster switch is untouched by the new keys', () => {
    const s = parseEventSettings('{"showQRSection":false,"displayDwellSeconds":20}');
    expect(resolveEventSettings(s)).toEqual({ showQRSection: false });
  });
});

describe('display settings: a write is strict', () => {
  test('accepts a valid order, dwell and links', () => {
    expect(
      validateSettingsPatch({
        displayPanes: ['sponsors', 'league'],
        displayDwellSeconds: 5,
        leagueLinks: { schedule: 'https://league.example/sched' },
      })
    ).toEqual({
      ok: true,
      value: {
        displayPanes: ['sponsors', 'league'],
        displayDwellSeconds: 5,
        leagueLinks: { schedule: 'https://league.example/sched' },
      },
    });
  });

  test('null clears a key, and an empty or null link clears just that link', () => {
    expect(
      validateSettingsPatch({
        displayPanes: null,
        displayDwellSeconds: null,
        leagueLinks: { schedule: '', bracket: null },
      })
    ).toEqual({
      ok: true,
      value: {
        displayPanes: null,
        displayDwellSeconds: null,
        leagueLinks: { schedule: null, bracket: null },
      },
    });
    expect(validateSettingsPatch({ leagueLinks: null })).toEqual({
      ok: true,
      value: { leagueLinks: null },
    });
  });

  test.each([
    [{ displayPanes: [] }],
    [{ displayPanes: ['event', 'event'] }],
    [{ displayPanes: ['scoreboard'] }],
    [{ displayPanes: 'event' }],
    [{ displayDwellSeconds: 4 }],
    [{ displayDwellSeconds: 121 }],
    [{ displayDwellSeconds: 15.5 }],
    [{ displayDwellSeconds: '15' }],
    [{ leagueLinks: { schedule: 'http://not-https.example/' } }],
    [{ leagueLinks: { schedule: 'javascript:alert(1)' } }],
    [{ leagueLinks: { schedule: 'https://user:pw@league.example/' } }],
    [{ leagueLinks: { schedule: 'https://league.example/' + 'x'.repeat(500) } }],
    // One byte over what the TV's QR code can hold (154 bytes, version 7 / L).
    [{ leagueLinks: { schedule: 'https://league.example/' + 'x'.repeat(154 - 23 + 1) } }],
    [{ leagueLinks: { scores: 'https://league.example/' } }],
    [{ leagueLinks: ['https://league.example/'] }],
  ])('refuses %j', (patch) => {
    expect(validateSettingsPatch(patch).ok).toBe(false);
  });
});

describe('league links must fit in the QR code the TV shows', () => {
  test('exactly 154 bytes is accepted; 155 is refused with a reason', () => {
    const fits = 'https://league.example/' + 'x'.repeat(154 - 23);
    expect(fits).toHaveLength(154);
    expect(validateSettingsPatch({ leagueLinks: { schedule: fits } }).ok).toBe(true);
    // ...and the TV's encoder (same options as handlers/display-config.ts) takes it.
    expect(() =>
      generateQrCode(fits, { errorCorrection: 'L', scale: 6, fgColor: '#2A2A3A' })
    ).not.toThrow();
    expect(() =>
      generateQrCode(fits + 'x', { errorCorrection: 'L', scale: 6, fgColor: '#2A2A3A' })
    ).toThrow();
    const r = validateSettingsPatch({ leagueLinks: { schedule: fits + 'x' } });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toContain('QR code');
    expect(r.ok ? '' : r.error).toContain('no username or password');
  });

  test('the reader drops a stored link too long to encode', () => {
    const long = 'https://league.example/' + 'x'.repeat(200);
    expect(parseEventSettings(JSON.stringify({ leagueLinks: { schedule: long } }))).toEqual({});
  });
});

// OSE-1521 — fundraiser panes. A donate screen is driven by ONE saved https link
// (same rule and the same 154-byte QR budget as a league link); a screen per
// sponsor is an opt-in pane. Neither adds a number of any kind to the settings:
// the display shows no counts, so there is no amount raised and no goal here.
describe('display settings: donate link and the new panes (OSE-1521)', () => {
  const link = 'https://donate.example/give';

  test('both new panes are on the allowlist; the screen per sponsor is opt-in', () => {
    expect(DISPLAY_PANES).toContain('donate');
    expect(DISPLAY_PANES).toContain('sponsor');
    expect(DEFAULT_DISPLAY_PANES).toContain('donate');
    // A screen per sponsor would repeat the sponsors wall, so it is chosen, not default.
    expect(DEFAULT_DISPLAY_PANES).not.toContain('sponsor');
    expect(validateSettingsPatch({ displayPanes: ['sponsor', 'donate', 'event'] }).ok).toBe(true);
  });

  test('a stored donate link comes back resolved; none stored is null', () => {
    const s = parseEventSettings(JSON.stringify({ donateLink: link }));
    expect(s.donateLink).toBe(link);
    expect(resolveDisplaySettings(s).donateLink).toBe(link);
    expect(resolveDisplaySettings({}).donateLink).toBeNull();
  });

  test('the reader drops a donate link it cannot trust', () => {
    for (const bad of [
      'http://plain.example/',
      'javascript:alert(1)',
      'https://user:pw@donate.example/',
      'https://donate.example/' + 'x'.repeat(200),
      42,
      ['https://donate.example/'],
    ]) {
      expect(parseEventSettings(JSON.stringify({ donateLink: bad }))).toEqual({});
    }
  });

  test('a write accepts the link, and null or an empty string clears it', () => {
    expect(validateSettingsPatch({ donateLink: link })).toEqual({
      ok: true,
      value: { donateLink: link },
    });
    expect(validateSettingsPatch({ donateLink: null })).toEqual({
      ok: true,
      value: { donateLink: null },
    });
    expect(validateSettingsPatch({ donateLink: '' })).toEqual({
      ok: true,
      value: { donateLink: null },
    });
  });

  test.each([
    [{ donateLink: 'http://not-https.example/' }],
    [{ donateLink: 'javascript:alert(1)' }],
    [{ donateLink: 'https://user:pw@donate.example/' }],
    [{ donateLink: 'https://donate.example/' + 'x'.repeat(500) }],
    [{ donateLink: 42 }],
    [{ donateLink: { url: link } }],
    [{ donateLink: ['https://donate.example/'] }],
    // A number would put an amount on the TV; there is no such setting.
    [{ donateGoal: 5000 }],
    [{ donateRaised: 1200 }],
  ])('refuses %j', (patch) => {
    expect(validateSettingsPatch(patch).ok).toBe(false);
  });

  test('exactly 154 bytes is accepted; 155 is refused, with the QR reason', () => {
    const fits = 'https://donate.example/' + 'x'.repeat(154 - 23);
    expect(fits).toHaveLength(154);
    expect(validateSettingsPatch({ donateLink: fits }).ok).toBe(true);
    const r = validateSettingsPatch({ donateLink: fits + 'x' });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toContain('QR code');
    expect(r.ok ? '' : r.error).toContain('settings.donateLink');
  });
});
