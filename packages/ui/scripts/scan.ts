import { readFileSync, readdirSync } from 'node:fs';
import { checkTemplate } from '../src/contract';

const dir = process.argv[2];
const files = readdirSync(dir).filter((f) => f.endsWith('.html'));
let totalCss = 0;
let flagged = 0;

for (const f of files) {
  const html = readFileSync(`${dir}/${f}`, 'utf8');
  const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('');
  totalCss += inline.length;
  const findings = checkTemplate(f, html);
  if (findings.length) {
    flagged++;
    console.log(`\n${f}  (${inline.length} chars inline CSS)`);
    for (const fd of findings) console.log(`   ⚠ ${fd.issue}: ${fd.detail}`);
  }
}

console.log(`\n── ${flagged}/${files.length} templates carry duplicated styling`);
console.log(`── ${totalCss.toLocaleString()} chars of inline CSS across the folder`);
console.log(`── shared stylesheet replaces it with ONE source of truth`);
