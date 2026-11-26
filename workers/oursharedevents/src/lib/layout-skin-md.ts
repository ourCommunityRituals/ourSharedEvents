/**
 * A layout skin as a Markdown file (OSE-2232).
 *
 * The owner (2026-11-25): one base brand; customization for ourSharedEvents
 * goes through a solution engineer, through Bruno, exchanging .md files. A
 * lightweight front end will let flag-side users do the same for themselves.
 * So the file is the hand-over, and both sides read and write the same shape.
 *
 * THE FILE. One header block per page ("surface"), each a run of plain
 * `key: value` lines between two `---` lines; everything else is notes, which
 * the system keeps no copy of:
 *
 *   ---
 *   surface: report
 *   skin: map_first
 *   columns: 2
 *   order: map, stats, sponsors, classes, posters, trend, locked
 *   wide: map, posters, trend, locked
 *   ---
 *
 *   ---
 *   surface: vote_screen
 *   skin: standard
 *   columns: 1
 *   order: line, code
 *   wide:
 *   ---
 *
 *   Notes for whoever reads this file.
 *
 * A block starts at a `---` line whose next non-blank line is `surface:`, so a
 * `---` rule in the notes is still notes. A file names each surface at most
 * once. One file may carry a client's pages on both products (owner,
 * 2026-11-25: clients on ourSharedEvents, on ourWKRP, or on both can skin):
 * each product reads the blocks for its own surfaces and passes over the rest
 * (ourWKRP#139 reads the same file). Each block is its own page's layout:
 * nothing in one block is copied to another (owner, 2026-11-25). Every page
 * has a free "standard" skin; other skins belong to their page.
 *
 * A list is comma separated; `[a, b]` is read the same. Key names and region
 * names are the ones in lib/layout-skins.ts; the checks are that module's
 * (checkLayout), so a file and the admin card are held to one rule.
 *
 * NOT A TEMPLATE LANGUAGE. The file names parts and their arrangement only:
 * no colors, no markup, no links, no counts. It is parsed line by line, never
 * evaluated, and the notes are dropped.
 */

import {
  LAYOUT_SURFACES,
  REGION_WORDS,
  SKINS,
  SURFACE_REGIONS,
  SURFACE_REQUIRED,
  checkLayout,
  isLayoutSurface,
  notALayoutKey,
  type LayoutSurface,
  type SurfaceLayout,
} from './layout-skins';

/** The largest file read. A skin is a few short lines; notes may run longer. */
export const SKIN_MD_MAX_BYTES = 8192;

const KEYS = ['surface', 'skin', 'columns', 'order', 'wide'] as const;

function list(v: string): string[] {
  const inner = v.trim().replace(/^\[(.*)\]$/, '$1');
  if (!inner.trim()) return [];
  return inner.split(',').map((x) => x.trim().replace(/^["']|["']$/g, ''));
}

/** One header block's fields, or the words that say which line to fix. */
function readBlock(
  lines: string[],
  start: number
): { ok: true; fields: Record<string, string>; end: number } | { ok: false; error: string } {
  const fields: Record<string, string> = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '---') return { ok: true, fields, end: i };
    if (!line.trim() || line.trim().startsWith('#')) continue;
    // No \s* after the colon: a line of spaces would make that pattern slow.
    const m = /^\s*([A-Za-z_]+)\s*:(.*)$/.exec(line);
    if (!m) return { ok: false, error: `line ${i + 1} must read key: value` };
    const key = m[1]!;
    if (!(KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: `line ${i + 1}: ${key} ${notALayoutKey(key)} (skin keys: ${KEYS.join(', ')})`,
      };
    }
    if (key in fields) return { ok: false, error: `line ${i + 1}: ${key} is given twice` };
    fields[key] = m[2]!.trim();
  }
  return {
    ok: false,
    error: `the block at line ${start + 1} must end with a line of three dashes (---)`,
  };
}

/** Does a block start at line i: a "---" line whose next non-blank line is "surface:"? */
function startsBlock(lines: string[], i: number): boolean {
  if (lines[i]!.trim() !== '---') return false;
  for (let j = i + 1; j < lines.length; j++) {
    if (!lines[j]!.trim()) continue;
    return /^\s*surface\s*:/.test(lines[j]!);
  }
  return false;
}

/**
 * Read a skin file: one header block per surface. Blocks for a surface this
 * product does not arrange (another product's page) are passed over and
 * named in `skipped`; a file with none of ours is refused. The words on
 * failure say which line or which surface to fix.
 */
export function parseSkinFile(
  text: unknown
):
  | { ok: true; layouts: Partial<Record<LayoutSurface, SurfaceLayout>>; skipped: string[] }
  | { ok: false; error: string } {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'markdown must be the text of a skin file' };
  }
  if (new TextEncoder().encode(text).length > SKIN_MD_MAX_BYTES) {
    return { ok: false, error: `a skin file is at most ${SKIN_MD_MAX_BYTES} bytes` };
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const layouts: Partial<Record<LayoutSurface, SurfaceLayout>> = {};
  const seen = new Set<string>();
  const skipped: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!startsBlock(lines, i)) continue;
    const block = readBlock(lines, i);
    if (!block.ok) return block;
    const { fields } = block;
    const surface = String(fields.surface ?? '');
    if (seen.has(surface)) {
      return { ok: false, error: `line ${i + 1}: surface ${surface} is given twice in this file` };
    }
    seen.add(surface);
    i = block.end;
    if (!isLayoutSurface(surface)) {
      if (/^[a-z_]{1,32}$/.test(surface)) skipped.push(surface);
      continue;
    }
    for (const k of ['skin', 'columns', 'order'] as const) {
      if (fields[k] === undefined) return { ok: false, error: `${surface}: ${k} is missing` };
    }
    const checked = checkLayout(surface, {
      skin: fields.skin,
      columns: fields.columns === '1' ? 1 : fields.columns === '2' ? 2 : fields.columns,
      order: list(fields.order!),
      wide: list(fields.wide ?? ''),
    });
    if (!checked.ok) {
      const at = `settings.layouts.${surface}`;
      return {
        ok: false,
        error: `${surface}: ${checked.error.replace(`${at}.`, '').replace(`${at} `, '')}`,
      };
    }
    layouts[surface] = checked.value;
  }
  if (!Object.keys(layouts).length) {
    return {
      ok: false,
      error: `the file names no page this product arranges (${LAYOUT_SURFACES.join(', ')}); a page starts with a line of three dashes (---) and then surface:`,
    };
  }
  return { ok: true, layouts, skipped };
}

function block(surface: LayoutSurface, layout: SurfaceLayout): string[] {
  return [
    '---',
    `surface: ${surface}`,
    `skin: ${layout.skin}`,
    `columns: ${layout.columns}`,
    `order: ${layout.order.join(', ')}`,
    `wide: ${layout.wide.join(', ')}`,
    '---',
  ];
}

function notes(surfaces: LayoutSurface[]): string[] {
  const out = [
    '',
    'Notes for whoever edits this file. The system keeps only the blocks between the --- lines.',
    '',
  ];
  for (const surface of surfaces) {
    const words = REGION_WORDS[surface];
    out.push(
      `- ${surface} parts, top to bottom, each at most once: ${SURFACE_REGIONS[surface]
        .map(
          (r) =>
            `${r} (${words[r]}${SURFACE_REQUIRED[surface].includes(r) ? ', required' : ', optional'})`
        )
        .join(
          ', '
        )}. Leave an optional part out of order to hide it. Skins: ${Object.keys(SKINS[surface]).join(', ')}, or custom once changed.`
    );
  }
  out.push(
    '- wide: parts that run the full width when columns is 2. A phone always shows one column.',
    "- A block for another product's page (an ourWKRP profile) may sit in the same file; each product reads its own.",
    ''
  );
  return out;
}

/** Write one surface's layout as a skin file. */
export function skinMarkdown(surface: LayoutSurface, layout: SurfaceLayout): string {
  return [...block(surface, layout), ...notes([surface])].join('\n');
}

/** Write every surface's layout into one skin file, one block each. */
export function skinFile(layouts: Record<LayoutSurface, SurfaceLayout>): string {
  const surfaces = LAYOUT_SURFACES.filter((s) => layouts[s]);
  return [
    ...surfaces.flatMap((s, n) => (n ? ['', ...block(s, layouts[s])] : block(s, layouts[s]))),
    ...notes(surfaces),
  ].join('\n');
}
