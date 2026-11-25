/**
 * A layout skin as a Markdown file (OSE-2232).
 *
 * The owner (2026-11-25): one base brand; customization for ourSharedEvents
 * goes through a solution engineer, through Bruno, exchanging .md files. A
 * lightweight front end will let flag-side users do the same for themselves.
 * So the file is the hand-over, and both sides read and write the same shape.
 *
 * THE FILE. A front-matter block of plain `key: value` lines between `---`
 * lines, then free notes that the system keeps no copy of:
 *
 *   ---
 *   surface: report
 *   skin: map_first
 *   columns: 2
 *   order: map, stats, sponsors, classes, posters, trend, locked
 *   wide: map, posters, trend, locked
 *   ---
 *
 *   Notes for whoever reads this file.
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

/** Read a skin file. The words on failure say which line to fix. */
export function parseSkinMarkdown(
  text: unknown
): { ok: true; surface: LayoutSurface; layout: SurfaceLayout } | { ok: false; error: string } {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'markdown must be the text of a skin file' };
  }
  if (new TextEncoder().encode(text).length > SKIN_MD_MAX_BYTES) {
    return { ok: false, error: `a skin file is at most ${SKIN_MD_MAX_BYTES} bytes` };
  }
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !lines[i]!.trim()) i++;
  if (lines[i]?.trim() !== '---') {
    return { ok: false, error: 'a skin file starts with a line of three dashes (---)' };
  }
  const fields: Record<string, string> = {};
  let closed = false;
  for (i++; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '---') {
      closed = true;
      break;
    }
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = /^\s*([A-Za-z_]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!m) return { ok: false, error: `line ${i + 1} must read key: value` };
    const key = m[1]!;
    if (!(KEYS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: `line ${i + 1}: ${key} ${notALayoutKey(key)} (skin keys: ${KEYS.join(', ')})`,
      };
    }
    if (key in fields) return { ok: false, error: `line ${i + 1}: ${key} is given twice` };
    fields[key] = m[2]!;
  }
  if (!closed) return { ok: false, error: 'the header must end with a line of three dashes (---)' };
  const surface = fields.surface;
  if (!isLayoutSurface(surface)) {
    return { ok: false, error: `surface must be one of ${LAYOUT_SURFACES.join(', ')}` };
  }
  for (const k of ['skin', 'columns', 'order'] as const) {
    if (fields[k] === undefined) return { ok: false, error: `${k} is missing` };
  }
  const checked = checkLayout(surface, {
    skin: fields.skin,
    columns: fields.columns === '1' ? 1 : fields.columns === '2' ? 2 : fields.columns,
    order: list(fields.order!),
    wide: list(fields.wide ?? ''),
  });
  if (!checked.ok)
    return { ok: false, error: checked.error.replace(`settings.layouts.${surface}.`, '') };
  return { ok: true, surface, layout: checked.value };
}

/** Write a layout as a skin file a person can read, change and send back. */
export function skinMarkdown(surface: LayoutSurface, layout: SurfaceLayout): string {
  const words = REGION_WORDS[surface];
  const skins = Object.keys(SKINS[surface]);
  return [
    '---',
    `surface: ${surface}`,
    `skin: ${layout.skin}`,
    `columns: ${layout.columns}`,
    `order: ${layout.order.join(', ')}`,
    `wide: ${layout.wide.join(', ')}`,
    '---',
    '',
    'Notes for whoever edits this file. The system keeps only the lines above.',
    '',
    `- order: every part once, top to bottom. Parts: ${SURFACE_REGIONS[surface]
      .map((r) => `${r} (${words[r]})`)
      .join(', ')}.`,
    '- wide: parts that run the full width when columns is 2. A phone always shows one column.',
    `- skin: where this started (${skins.join(', ')}), or custom once moved.`,
    '',
  ].join('\n');
}
