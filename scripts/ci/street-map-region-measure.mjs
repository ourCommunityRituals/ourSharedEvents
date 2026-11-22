#!/usr/bin/env node
/**
 * The street-map regions, and what the measure-only workflow needs to size one
 * (.github/workflows/street-map-region-measure.yml, OSE-2210).
 *
 * A region is a file of boxes that `pmtiles extract --region` cuts a Protomaps
 * build to. The United States file is the one the load workflow cuts today
 * (street-map-archive-load.yml). North America comes next (owner, 2026-11-22),
 * as region archives of its own, not one large file: Canada (`ca`), and Mexico,
 * Central America and the Caribbean (`mx`). The owner's rule for the world is
 * the same: one archive per region, each loaded and kept up on its own.
 * Adding a region here lets CI measure its size; it loads nothing.
 * The load workflow, its key, its bucket and its credential are not touched by
 * this file.
 *
 *   check            every region file is a set of closed, valid boxes
 *   target <region>  writes REGION_FILE, REGION_KEY and PROTOMAPS_BUILD to
 *                    $GITHUB_ENV for the dry run, the build being the one the
 *                    load workflow names (one place to change it)
 *
 * It reads files and environment variables only. It holds no credential and
 * calls no network.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LOAD_WORKFLOW = '.github/workflows/street-map-archive-load.yml';

/** Every region, by the prefix its archive key would carry: `<prefix>-<build>.pmtiles`. */
export const REGIONS = Object.freeze({
  us: 'docs/runbooks/street-map-us-region.geojson',
  ca: 'docs/runbooks/street-map-ca-region.geojson',
  mx: 'docs/runbooks/street-map-mx-region.geojson',
});

/** The Protomaps build the load workflow names, or undefined. */
export function loadWorkflowBuild(workflowText) {
  return /^ {2}PROTOMAPS_BUILD: '(\d{8})'\r?$/m.exec(String(workflowText ?? ''))?.[1];
}

/** The boxes of a region file as [west, south, east, north], or throws. */
export function regionBoxes(geojsonText) {
  const doc = JSON.parse(geojsonText);
  if (doc?.type !== 'Feature' || doc.geometry?.type !== 'MultiPolygon') {
    throw new Error('not a GeoJSON Feature with a MultiPolygon');
  }
  return doc.geometry.coordinates.map((polygon, i) => {
    if (!Array.isArray(polygon) || polygon.length !== 1) {
      throw new Error(`polygon ${i} is not one ring`);
    }
    const ring = polygon[0];
    if (!Array.isArray(ring) || ring.length !== 5) throw new Error(`polygon ${i} is not 5 points`);
    const [first, last] = [ring[0], ring[4]];
    if (first[0] !== last[0] || first[1] !== last[1]) throw new Error(`polygon ${i} is not closed`);
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    if (![...lons, ...lats].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw new Error(`polygon ${i} has a point that is not two numbers`);
    }
    const box = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
    const corners = new Set(ring.slice(0, 4).map((p) => `${p[0]},${p[1]}`));
    const wanted = [
      `${box[0]},${box[1]}`,
      `${box[2]},${box[1]}`,
      `${box[2]},${box[3]}`,
      `${box[0]},${box[3]}`,
    ];
    if (corners.size !== 4 || !wanted.every((c) => corners.has(c))) {
      throw new Error(`polygon ${i} is not a box`);
    }
    if (box[0] < -180 || box[2] > 180 || box[1] < -90 || box[3] > 90) {
      throw new Error(`polygon ${i} runs off the globe`);
    }
    if (!(box[0] < box[2] && box[1] < box[3])) throw new Error(`polygon ${i} has no area`);
    return box;
  });
}

/** What is wrong with a region file, as sentences. What cannot be read is a problem. */
export function regionProblems(geojsonText) {
  try {
    regionBoxes(geojsonText);
    return [];
  } catch (e) {
    return [e.message];
  }
}

/** True when some box of the region holds the point (longitude, latitude). */
export function regionCovers(geojsonText, lon, lat) {
  return regionBoxes(geojsonText).some(
    ([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n
  );
}

/** The names a dry run of one region uses, or the problems that stop it. */
export function regionTarget(region, workflowText) {
  if (!Object.hasOwn(REGIONS, String(region))) {
    return { problems: [`"${region}" is not a region (${Object.keys(REGIONS).join(', ')})`] };
  }
  const build = loadWorkflowBuild(workflowText);
  if (!build) return { problems: [`${LOAD_WORKFLOW} names no PROTOMAPS_BUILD`] };
  return {
    problems: [],
    file: REGIONS[region],
    key: `${region}-${build}.pmtiles`,
    build,
  };
}

function stop(problems, ok) {
  for (const p of problems) console.log(`::error::${p}`);
  if (problems.length === 0) console.log(ok);
  return problems.length === 0 ? 0 : 1;
}

const COMMANDS = {
  check() {
    const problems = Object.entries(REGIONS).flatMap(([region, file]) => {
      let text;
      try {
        text = readFileSync(join(ROOT, file), 'utf8');
      } catch {
        return [`${region}: ${file} is not in this repo`];
      }
      return regionProblems(text).map((p) => `${region}: ${file}: ${p}`);
    });
    return stop(problems, `Regions ${Object.keys(REGIONS).join(', ')}: every file is a set of boxes.`);
  },
  target([region]) {
    const t = regionTarget(region, readFileSync(join(ROOT, LOAD_WORKFLOW), 'utf8'));
    if (t.problems.length) return stop(t.problems, '');
    const lines = `REGION_FILE=${t.file}\nREGION_KEY=${t.key}\nPROTOMAPS_BUILD=${t.build}\n`;
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, lines);
    return stop([], `Region ${region}: ${t.file}, key ${t.key}, build ${t.build}.`);
  },
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [command, ...args] = process.argv.slice(2);
  if (!Object.hasOwn(COMMANDS, command ?? '')) {
    console.error(
      `Usage: node scripts/ci/street-map-region-measure.mjs <${Object.keys(COMMANDS).join('|')}> [region]`
    );
    process.exitCode = 1;
  } else {
    try {
      process.exitCode = COMMANDS[command](args);
    } catch (e) {
      console.log(`::error::${command}: ${e.message}`);
      process.exitCode = 1;
    }
  }
}
