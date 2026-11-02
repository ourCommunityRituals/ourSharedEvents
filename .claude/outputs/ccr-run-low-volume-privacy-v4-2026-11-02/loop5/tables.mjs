// Emits the findings-register tables for the worksheet from register-rows.txt and tier-history.txt.
import { readFileSync, writeFileSync } from 'node:fs';
const T1 = ['R1-14','R1-15','R1-20','R1-27','R1-30','R1-36','R1-39','R1-40','R1-46','R2-11','R2-12','R2-13','R2-14','R2-22','R3-05','R3-11','R4-12'];
const T2 = ['R1-31','R1-41','R2-15','R2-17','R3-08','R4-06','R4-07'];
const CL = { 'R1-01':'C1','R1-10':'C1','R1-03':'C2','R1-13':'C2','R1-07':'C3','R1-08':'C3','R2-03':'C3','R1-05':'C5','R1-06':'C5','R2-04':'C5','R1-02':'C5','R1-04':'C5','R1-09':'C6','R2-01':'C6','R3-06':'C6' };
const H5 = { 'R1-22':'0.75','R2-18':'0.75','R3-03':'0.75' };
const R4 = {
  'R4-01':'`/privacy` claims HIPAA safeguards and COPPA compliance for regimes ADR-018 declines; `briefing.ts:124` youth-events plan folds in',
  'R4-02':'Threat ledger misstates the PR-head token threat (TL-015 accepted on a false premise; TL-081 mitigated by a merge gate)',
  'R4-03':'Identified-data keys have one version; any rotation strands erasure-by-email and decryption of older rows',
  'R4-04':'Erasure accepts an email only; a visitor holding their own `ose_anon` value has no route to their rows',
  'R4-05':'A client-chosen `source_placement_id` is stored in FORMS_DB beside the keyed id, hour and second; rule 6 reach unruled',
  'R4-06':'Accessibility gates list surfaces by name; `/privacy` and the admin live view are on none; S15 AC5 passes by omission',
  'R4-07':'The honesty-lexicon gate reads three file groups; "attendance" ships in `never-who.ts:35`, `privacy.ts:58`; S15 edit unread',
  'R4-08':'SharedReport sponsor section sits after the stats and map; whether invariant 6 reaches this page is unruled',
  'R4-09':'The sync chain names no Design FE, QA or PO view for public-word or test slices, and a "DS" role ROLE-STATE lacks',
  'R4-10':'S2 docs line names two files; `set-secrets.sh` "Rotate freely" header and `QR-AND-SHORTLINKS.md` key shape go false too',
  'R4-11':'Workflow comments contradict live configuration (T4 "required"; reconciler "advisory"; "self-hosted" on ubuntu runners)',
  'R4-12':'S4 AC3 names a T0 listing rule reaching one folder and suffix; README index regeneration unstated',
  'R4-13':'S5 and S6 serve no retained fix and S14 exists only for the bash steps, against the owner re-anchor rule as written',
  'R4-14':'Anonymity texts say no IP is read; public handlers hash `CF-Connecting-IP` as a rate key, unnamed as an exception',
  'R4-15':'Org brain unreconciled: yaml #7 names a floor of 3; the brain BigQuery schema defines a per-scan row with exact time',
  'R4-16':'ADR-001 keeps sentences the amendments do not name (`:56` forms to BigQuery, `:66` staging UA hash, affordance, `:110` cookie)',
  'R4-17':'Two owner statements on the deep tier unreconciled: nightly after launch versus T4 per merge SHA for Done',
};
const CL5 = { // loop-5 notes for the Highs and a few others
  'R1-01':'claim stable; custody reworded "can obtain the pepper by deploying code"; expiry and custody legs survive S2',
  'R1-02':'split now S over an M mechanism (OSE-1784); exact recovery re-run by DS',
  'R1-03':'weakest High; 12 strings in 7 components on 3 pages false after S4; `scansOf([])` suppressed (proven)',
  'R1-04':'in-scope half only; `pages.ts:1553-1828` renders label and never-who body; #1073 is environment, not credit; exact half is OSE-1752/1787 (RC-01)',
  'R1-05':'second copy at `form-pages.ts:114`; not Regulatory on the protocol text',
  'R1-06':'defect is an undisclosed one-year cookie; `privacy.ts:55` false; tier at its lower edge',
  'R1-07':'basis source-read (plan) plus proven grep; the only staging detector for C3',
  'R1-08':'"silent" becomes "unalerted"; rests on AC3 (short value put directly); closure must be runtime',
  'R1-09':'root is C.0 born-red argument (S); mechanism proven on main twice (#1057, #1073); windows push to T4 completion 50 h 41 min and 2 h 59 min',
  'R1-10':'exact where per-(event, hour) counts match; SQLite model proven, D1 order inferred',
  'R1-16':'no upper bound on the INSERT; loop-3 lowering condition withdrawn as vacuous (RC-04); replacement in section 3 of the merge',
  'R1-23':'triggers (a)-(d); (b) proven unmet; Tier-1 base item fails: −15 and cap 70 from loop 2',
  'R2-01':'config proven; collision inferred, never seen; `staging` has 0 rules',
  'R2-02':'FE SQL replay: 0 scans fallback, 1-4 suppressed; `_meta` reaches local depth; trigger (2) unmet',
  'R3-03':'re-puts every value; `FORMS_HASH_PEPPER` effects counted once under R4-03; H5 0.75 (no registrations, production closed)',
  'R4-01':'High unanimous; COPPA extension trigger appears met on repo facts; applicability is the owner call',
  'R1-13':'main #1073 wording "Fewer than 5 Walked in" is an instance of this root on main (environment, not rated)',
  'R1-19':'Wave 0 item 1 overtaken by #1069 (environment); loop-4 "worse" withdrawn; tier unchanged',
  'R3-06':'five live ancestry-only instances: 206c91ed, 0ebe2fdd, 77e5d912, 9134ab9f, 08703cd7',
  'R3-01':'Medium in loop 3, Low from loop 4',
};
const rows = readFileSync(new URL('./register-rows.txt', import.meta.url), 'utf8').trim().split('\n').map((l) => {
  const p = l.split('|').map((s) => s.trim());
  return { id: p[0], title: p[0].startsWith('R4') ? R4[p[0]] : p[3] };
});
const hist = Object.fromEntries(readFileSync(new URL('./tier-history.txt', import.meta.url), 'utf8').trim().split('\n').map((l) => { const a = l.split(' '); return [a[0], a.slice(1)]; }));
const tier = (id) => ({ High: 'High', Med: 'Medium', Low: 'Low' })[hist[id][3]];
const esc = (s) => s.replace(/\|/g, '\\|');
const rank = { High: 0, Medium: 1, Low: 2 };
let out = '';
out += '| ID | Severity | Found | Root cause (short) | Modifiers | Loop-5 note |\n|---|---|---|---|---|---|\n';
const counted = rows.filter((r) => !T1.includes(r.id) && !T2.includes(r.id));
const sysRows = [
  { id: 'T1', sev: 'High', found: '1', title: 'Systemic (H4): the subject test doctrine in C.0. Born red means a named fault, not a recorded red run; the pre-merge staging run is optional; staging steps are ad-hoc bash; criteria are absence, presence, substring or one-row checks over an enumerated scope. 17 members, listed below', mod: 'H3 N=17 (4.170); promoted Medium to High; H1 1.0', note: 'members sum 80.00 uncollapsed at loop 4 tiers (70 at base); collapsed 41.70; DES dissents on the collapse' },
  { id: 'T2', sev: 'High', found: '2', title: 'Systemic (H4): gates on main that are advisory, presence-only or name-scoped, which the subject relies on. 7 members, listed below', mod: 'H3 N=7 (3.000); promoted Medium to High; H1 1.25', note: 'members sum 37.50 uncollapsed at loop 4 tiers (29 at base); collapsed 37.50; SEC calls these related, not members' },
];
const all = [...counted.map((r) => ({ id: r.id, sev: tier(r.id), found: r.id[1], title: r.title, mod: [CL[r.id] ? `H2 ${CL[r.id]}` : '', H5[r.id] ? `H5 ${H5[r.id]}` : '', `H1 ${({1:'1.0',2:'1.25',3:'1.5',4:'1.5'})[r.id[1]]}`].filter(Boolean).join('; '), note: CL5[r.id] ?? '' })), ...sysRows]
  .sort((a, b) => rank[a.sev] - rank[b.sev] || a.id.localeCompare(b.id));
for (const r of all) out += `| ${r.id} | ${r.sev} | ${r.found} | ${esc(r.title)} | ${r.mod} | ${esc(r.note)} |\n`;
const counts = all.reduce((c, r) => ((c[r.sev] = (c[r.sev] ?? 0) + 1), c), {});
out += `\nCounted rows: ${all.length} (High ${counts.High}, Medium ${counts.Medium}, Low ${counts.Low}).\n\n`;
out += '### Systemic members (instances, not counted twice)\n\nThese 24 rows are the instances of T1 and T2. They keep their ids and their own closed-when text in the loop-4 register; they are not withdrawn and not fixed.\n\n| Group | ID | Found | Tier at loop 4 | Root cause (short) |\n|---|---|---|---|---|\n';
for (const g of [['T1', T1], ['T2', T2]]) for (const id of g[1]) { const r = rows.find((x) => x.id === id); out += `| ${g[0]} | ${id} | ${id[1]} | ${tier(id)} | ${esc(r.title)} |\n`; }
writeFileSync(new URL('./register-table.md', import.meta.url), out);
console.log(`counted ${all.length}`, counts);
