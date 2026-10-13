/**
 * The TV and the poster read their event from their own address (OSE-1684).
 *
 * The platform now writes /events/<id>/tv and /events/<id>/poster. Both pages
 * must show that event, and the older /display?event=<id> and /poster?event=<id>
 * must still work (they are printed and saved on kiosks). The functions are cut
 * out of the served template and run against each address.
 *
 * Born-red: drop the path match from either template and the path cases fail;
 * drop the query fallback and the old-address cases fail; write a
 * /display?event= or /poster?event= link anywhere in src/ and the last test fails.
 */
import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import DISPLAY_HTML from '../src/templates/display.html';
import POSTER_HTML from '../src/templates/poster.html';

function between(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  expect(i, `${start} is in the template`).toBeGreaterThan(-1);
  const j = src.indexOf(end, i);
  expect(j, `${end} follows ${start}`).toBeGreaterThan(i);
  return src.slice(i, j + end.length);
}

function at(url: string) {
  const u = new URL(url, 'https://oursharedevents.com');
  return { pathname: u.pathname, search: u.search };
}

const displayRead = (url: string): string =>
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- template code under test
  new Function(
    'location',
    between(DISPLAY_HTML, 'function routeEventId()', '\n      }') + '\nreturn routeEventId();'
  )(at(url));

const posterRead = (url: string): string =>
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- template code under test
  new Function(
    'location',
    between(POSTER_HTML, 'const ROUTE_EVENT = (function ()', '})();') + '\nreturn ROUTE_EVENT;'
  )(at(url));

describe('the TV reads its event from its address', () => {
  test('/events/<id>/tv names the event', () => {
    expect(displayRead('/events/evt_smoke_sponsored/tv')).toBe('evt_smoke_sponsored');
    expect(displayRead('/events/evt-1/tv?dwell=8&panes=event,sponsors')).toBe('evt-1');
  });

  test('the older /display?event=<id> still names it', () => {
    expect(displayRead('/display?event=evt-1')).toBe('evt-1');
    expect(displayRead('/tv?event=evt-1')).toBe('evt-1');
  });

  test('no event named: empty, so the TV shows the first live event as before', () => {
    expect(displayRead('/display')).toBe('');
    expect(displayRead('/events/evt-1/poster')).toBe('');
    expect(displayRead('/events/evt.1/tv')).toBe('');
  });
});

describe('the poster reads its event from its address', () => {
  test('/events/<id>/poster names the event, with or without ?kind=', () => {
    expect(posterRead('/events/evt-1/poster')).toBe('evt-1');
    expect(posterRead('/events/evt-1/poster?kind=digital')).toBe('evt-1');
  });

  test('other addresses leave it to ?event= (still read on the next line)', () => {
    expect(posterRead('/poster?event=evt-1')).toBe('');
    expect(posterRead('/events/evt-1/tv')).toBe('');
    expect(POSTER_HTML).toContain(
      "const wanted = PREVIEW_EVENT || ROUTE_EVENT || new URLSearchParams(location.search).get('event');"
    );
  });

  test('on its own address the poster does not add ?event= back to the address bar', () => {
    expect(POSTER_HTML).toContain(
      "if (event && event.id && !ROUTE_EVENT) params.set('event', event.id);"
    );
  });
});

describe('nothing the platform writes uses the older shape', () => {
  const SRC = join(__dirname, '..', 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|html)$/.test(n) ? [p] : [];
    });

  test('no line of code builds /display?event= or /poster?event=', () => {
    const all = files(SRC);
    expect(all.length).toBeGreaterThan(50);
    const hits: string[] = [];
    for (const f of all) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const code = line.trim();
          if (/^(\/\/|\*|\/\*|<!--)/.test(code)) return; // prose about the old address is fine
          if (/\/(display|poster)\?event=/.test(code)) hits.push(`${f.slice(SRC.length)}:${i + 1}`);
        });
    }
    expect(hits, 'write /events/<id>/tv or /events/<id>/poster instead').toEqual([]);
  });
});
