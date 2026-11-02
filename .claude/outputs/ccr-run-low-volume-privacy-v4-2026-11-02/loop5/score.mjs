// Scoring arithmetic for the five-loop CCR on the v4 subject, per MERGED-loop5.md sections 6-8.
// Method (B): rows open at the end of loop N, at that loop's tiers. Nothing here is a ruling;
// every parameter is the loop-5 merge's, and the two declared choices are marked DECLARED.
import { readFileSync } from 'node:fs';

const W = { High: 10, Med: 5, Low: 2 };
const H1 = { 1: 1.0, 2: 1.25, 3: 1.5, 4: 1.5, 5: 1.5 }; // loops 4-5 capped at 1.5 (RC-05, declared)
const H5 = { 'R1-22': 0.75, 'R2-18': 0.75, 'R3-03': 0.75 }; // only where a merge ruled it; else 1.0
const T1 = ['R1-14','R1-15','R1-20','R1-27','R1-30','R1-36','R1-39','R1-40','R1-46','R2-11','R2-12','R2-13','R2-14','R2-22','R3-05','R3-11','R4-12'];
const T2 = ['R1-31','R1-41','R2-15','R2-17','R3-08','R4-06','R4-07'];
const CLUSTERS = [
  { id: 'C1', members: ['R1-01','R1-10'], factor: () => 1.5, from: 2 },
  { id: 'C2', members: ['R1-03','R1-13'], factor: () => 1.5, from: 2 },
  { id: 'C3', members: ['R1-07','R1-08','R2-03'], factor: () => 2.0, from: 2 },
  { id: 'C5', members: ['R1-05','R1-06','R2-04','R1-02','R1-04'], factor: () => 2.0, from: 2 },
  { id: 'C6', members: ['R1-09','R2-01','R3-06'], factor: (n) => (n >= 3 ? 2.0 : 1.5), from: 2 },
];
const TIER1_ITEM = { points: 15, from: 2 };

const rows = readFileSync(new URL('./tier-history.txt', import.meta.url), 'utf8')
  .trim().split('\n').map((l) => {
    const [id, l1, l2, l3, l4] = l.split(' ');
    return { id, disc: Number(id[1]), tier: { 1: l1, 2: l2, 3: l3, 4: l4, 5: l4 } };
  });
const log2 = (n) => Math.log2(n + 1);

function loopFigure(N, { collapse = true, coppa = false } = {}) {
  const open = rows.filter((r) => r.disc <= N && r.tier[N] !== '-');
  const t1 = open.filter((r) => T1.includes(r.id));
  const t2 = open.filter((r) => T2.includes(r.id));
  const collapsed = new Set();
  const notes = [];
  let ded = 0;
  const per = {};
  const base = (r) => W[r.tier[N]] * H1[r.disc] * (H5[r.id] ?? 1);
  // H4 systemic rows: promoted to High (10), H3 breadth over member count, H1 at the group's first loop, H5 1.0
  const groups = [];
  if (collapse) {
    if (t1.length >= 3) groups.push({ id: 'T1', members: t1, disc: 1 });
    if (t2.length >= 3) groups.push({ id: 'T2', members: t2, disc: 2 });
  }
  for (const g of groups) {
    const d = 10 * log2(g.members.length) * H1[g.disc];
    per[g.id] = d; ded += d;
    g.members.forEach((r) => collapsed.add(r.id));
    notes.push(`${g.id}: N=${g.members.length}, members sum ${g.members.reduce((s, r) => s + base(r), 0).toFixed(2)}, collapsed ${d.toFixed(2)}`);
  }
  const clustered = new Set();
  for (const c of CLUSTERS) {
    if (N < c.from) continue;
    const m = open.filter((r) => c.members.includes(r.id));
    if (m.length < 2) continue;
    const f = c.factor(m.length);
    const sum = m.reduce((s, r) => s + base(r), 0);
    const d = sum * f;
    per[c.id] = d; ded += d;
    m.forEach((r) => clustered.add(r.id));
    notes.push(`${c.id}: ${m.map((r) => r.id).join('+')} = ${sum.toFixed(2)} x ${f} = ${d.toFixed(2)}`);
  }
  let plain = 0;
  for (const r of open) {
    if (collapsed.has(r.id) || clustered.has(r.id)) continue;
    if (coppa && r.id === 'R4-01' && N >= 4) continue; // folds into the Regulatory notice item
    plain += base(r);
  }
  ded += plain;
  if (N >= TIER1_ITEM.from) ded += TIER1_ITEM.points;
  let reg = 0;
  if (coppa && N >= 4) { reg = 3 * 25 * 1.5; ded += reg; } // 3 Regulatory items x COPPA modifier 1.5 (merge 3.4)
  const counts = { High: 0, Med: 0, Low: 0 };
  for (const r of open) if (!collapsed.has(r.id)) counts[r.tier[N]]++;
  counts.High += groups.length;
  if (coppa && N >= 4) counts.High -= 1;
  return { N, open: open.length, counts, plain, per, tier1: N >= TIER1_ITEM.from ? 15 : 0, reg, total: ded, raw: 100 - ded, notes };
}

for (const variant of [
  { name: 'A. Ruled: collapse T1/T2, no COPPA', opts: {} },
  { name: 'B. Uncollapsed (members counted separately)', opts: { collapse: false } },
  { name: 'C. Ruled + COPPA ruled Regulatory (from loop 4)', opts: { coppa: true } },
]) {
  console.log(`\n=== ${variant.name}`);
  for (let N = 1; N <= 5; N++) {
    const f = loopFigure(N, variant.opts);
    const c = f.counts;
    const regCount = variant.opts.coppa && N >= 4 ? 3 : 0;
    console.log(`Loop ${N}: open ${f.open} rows; counted reg ${regCount} High ${c.High} Med ${c.Med} Low ${c.Low}; ` +
      `plain ${f.plain.toFixed(2)} + groups/clusters ${Object.values(f.per).reduce((a, b) => a + b, 0).toFixed(2)} + tier1 ${f.tier1} + reg ${f.reg} = ${f.total.toFixed(2)}; raw 100 - that = ${f.raw.toFixed(2)}`);
    for (const n of f.notes) console.log('   ' + n);
    const ceilingCounts = c.High * 10 + c.Med * 5 + c.Low * 2;
    console.log(`   checker ceiling: max(0, 100 - 0.375 x ${ceilingCounts}) = ${Math.max(0, 100 - 0.375 * ceilingCounts).toFixed(2)}${regCount ? ' then min(.., 60)' : ''}`);
  }
}
