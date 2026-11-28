/**
 * The small picture beside each language's name in the Language menu (owner
 * 2026-11-28: flags plus letter badges). Each is a self-hosted SVG at
 * `/flags/<lang>.svg`, because flag emoji do not draw on Windows. Arabic,
 * Russian and Persian are spoken in many countries, so they get a letter badge
 * (AR, RU, FA) instead of one country's flag. `LANGUAGE_MARK` says which.
 *
 * The pictures are simplified at 21 x 14 px: shapes and colours only, no
 * script, no text but a badge's letters, no outside reference. Colours are
 * fixed here because an `<img>` cannot read the page's design tokens (the same
 * as the default sponsor image).
 */
import { LANGUAGES, LANGUAGE_MARK, type Lang } from './languages';

/** `/flags/<lang>.svg`; the route answers only for a listed language. */
export const LANGUAGE_FLAG_PREFIX = '/flags/';

export function languageFlagPath(lang: Lang): string {
  return `${LANGUAGE_FLAG_PREFIX}${lang}.svg`;
}

const W = 30;
const H = 20;

const RED = 'hsl(354 75% 45%)';
const WHITE = 'hsl(0 0% 100%)';
const BLUE = 'hsl(222 70% 32%)';
const GREEN = 'hsl(150 70% 26%)';
const YELLOW = 'hsl(48 100% 50%)';
const SAFFRON = 'hsl(28 95% 55%)';
const BLACK = 'hsl(0 0% 8%)';

const rect = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const circle = (cx: number, cy: number, r: number, fill: string): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;

/** A five-pointed star, point up, rotated by `turn` degrees. */
function star(cx: number, cy: number, r: number, fill: string, turn = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.4;
    const a = ((turn - 90 + i * 36) * Math.PI) / 180;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
}

const vertical3 = (a: string, b: string, c: string): string =>
  rect(0, 0, 10, H, a) + rect(10, 0, 10, H, b) + rect(20, 0, 10, H, c);
const horizontal = (...bands: string[]): string =>
  bands.map((f, i) => rect(0, (i * H) / bands.length, W, H / bands.length, f)).join('');
const crescent = (cx: number, cy: number, r: number, bg: string): string =>
  circle(cx, cy, r, WHITE) + circle(cx + r * 0.3, cy, r * 0.8, bg);

const FLAGS: Record<string, string> = {
  us:
    horizontal(RED, WHITE, RED, WHITE, RED, WHITE, RED, WHITE, RED, WHITE, RED, WHITE, RED) +
    rect(0, 0, 12, (H * 7) / 13, BLUE),
  mx: vertical3(GREEN, WHITE, RED) + circle(15, 10, 2.5, 'hsl(30 45% 35%)'),
  cn:
    rect(0, 0, W, H, RED) +
    star(5, 5, 3, YELLOW) +
    star(10, 2, 1, YELLOW) +
    star(12, 4, 1, YELLOW) +
    star(12, 7, 1, YELLOW) +
    star(10, 9, 1, YELLOW),
  tw: rect(0, 0, W, H, RED) + rect(0, 0, 15, 10, BLUE) + circle(7.5, 5, 2.5, WHITE),
  in:
    horizontal(SAFFRON, WHITE, GREEN) +
    `<circle cx="15" cy="10" r="2.6" fill="none" stroke="${BLUE}" stroke-width="0.8"/>`,
  br:
    rect(0, 0, W, H, 'hsl(145 100% 30%)') +
    `<polygon points="15,2 28,10 15,18 2,10" fill="${YELLOW}"/>` +
    circle(15, 10, 4.2, BLUE),
  bd: rect(0, 0, W, H, 'hsl(160 100% 21%)') + circle(13.5, 10, 6, RED),
  jp: rect(0, 0, W, H, WHITE) + circle(15, 10, 6, 'hsl(350 85% 42%)'),
  fr: vertical3(BLUE, WHITE, RED),
  de: horizontal(BLACK, 'hsl(0 100% 40%)', 'hsl(48 100% 50%)'),
  pk:
    rect(0, 0, W, H, 'hsl(150 100% 19%)') +
    rect(0, 0, 7.5, H, WHITE) +
    crescent(18.5, 10, 5.5, 'hsl(150 100% 19%)') +
    star(21, 7.5, 1.8, WHITE, 18),
  id: horizontal(RED, WHITE),
  kr:
    rect(0, 0, W, H, WHITE) +
    `<path d="M10.5 10 a4.5 4.5 0 0 1 9 0 Z" fill="${RED}"/>` +
    `<path d="M10.5 10 a4.5 4.5 0 0 0 9 0 Z" fill="${BLUE}"/>` +
    rect(3, 3, 4, 1.2, BLACK) +
    rect(23, 3, 4, 1.2, BLACK) +
    rect(3, 15.8, 4, 1.2, BLACK) +
    rect(23, 15.8, 4, 1.2, BLACK),
  vn: rect(0, 0, W, H, RED) + star(15, 10.5, 6, YELLOW),
  tr: rect(0, 0, W, H, RED) + crescent(12, 10, 5, RED) + star(18.5, 10, 2.2, WHITE, -18),
  it: vertical3('hsl(145 100% 30%)', WHITE, RED),
  ph:
    horizontal(BLUE, RED) +
    `<polygon points="0,0 17.3,10 0,20" fill="${WHITE}"/>` +
    circle(5.5, 10, 2.4, YELLOW),
  pl: horizontal(WHITE, RED),
  ua: horizontal('hsl(212 100% 37%)', 'hsl(50 100% 50%)'),
};

function badge(letters: string): string {
  return (
    rect(0, 0, W, H, 'hsl(222 25% 30%)') +
    `<text x="15" y="14.5" text-anchor="middle" font-family="system-ui, sans-serif" ` +
    `font-size="11" font-weight="700" fill="${WHITE}">${letters}</text>`
  );
}

/** The whole SVG for one language. */
export function languageFlagSvg(lang: Lang): string {
  const mark = LANGUAGE_MARK[lang];
  const body = mark.kind === 'flag' ? FLAGS[mark.country] : badge(mark.letters);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    body +
    // A hairline edge, so a white flag (Japan, Poland) still reads on white.
    `<rect x="0.25" y="0.25" width="${W - 0.5}" height="${H - 0.5}" fill="none" ` +
    `stroke="hsl(222 15% 50% / 0.5)" stroke-width="0.5"/></svg>`
  );
}

/** The language a `/flags/<lang>.svg` path names, or null. */
export function flagLangFromPath(pathname: string): Lang | null {
  if (!pathname.startsWith(LANGUAGE_FLAG_PREFIX) || !pathname.endsWith('.svg')) return null;
  const tag = pathname.slice(LANGUAGE_FLAG_PREFIX.length, -'.svg'.length);
  return (LANGUAGES as readonly string[]).includes(tag) ? (tag as Lang) : null;
}

/** Serve one picture. Same-origin, cached a day, locked down like /ui.css. */
export function languageFlagResponse(lang: Lang): Response {
  return new Response(languageFlagSvg(lang), {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
