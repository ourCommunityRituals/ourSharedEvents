// One-off: writes src/demo-cells.json, the DEMO res-7 cell ids the proof draws.
// Town centres are used here only to pick plausible demo cells; the proof page
// and Worker read cell ids and nothing else, exactly like lib/attendee-map.ts.
import { latLngToCell, gridDisk } from 'h3-js';
import { writeFileSync } from 'node:fs';
const towns = [
  ['Blue Island', 41.6537, -87.6803],
  ['Sawyer', 41.8853, -86.5942],
  ['Milwaukee', 43.0389, -87.9065],
  ['Davenport', 41.5236, -90.5776],
  ['Kankakee', 41.12, -87.8612],
  ['Chicago Loop', 41.8819, -87.6278],
];
const demo = [23, 12, 7, 3, 9, 2, 5];
const out = [];
for (const [label, lat, lon] of towns) {
  gridDisk(latLngToCell(lat, lon, 7), 1).forEach((cell, i) =>
    out.push({ cell, count: demo[i % demo.length], ...(i === 0 ? { label } : {}) })
  );
}
writeFileSync(new URL('../src/demo-cells.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(out.length, 'cells');
