import { contrastRatio } from '../src/contrast.ts';

const darkBg  = '#0F1824';
const darkSurf = '#1A2740';
const lightBg  = '#F4F7FC';

const pairs = [
  // Dark mode
  ['text on bg (dark)',        '#F0F4F8', darkBg],
  ['text on surface (dark)',   '#F0F4F8', darkSurf],
  ['muted on bg (dark)',       '#7A94B0', darkBg],
  ['accent on bg (dark)',      '#1785FB', darkBg],
  ['live/teal on bg (dark)',   '#00C4B4', darkBg],
  ['danger on bg (dark)',      '#E05252', darkBg],
  // Light mode — darker variants
  ['text on bg (light)',       '#162945', lightBg],
  ['muted on bg (light)',      '#4A6882', lightBg],
  ['accent on bg (light)',     '#0057D6', lightBg],
  ['live/teal on bg (light)',  '#00796B', lightBg],
  ['danger on bg (light)',     '#B03030', lightBg],
];

let allPass = true;
for (const [label, fg, bg] of pairs) {
  const ratio = contrastRatio(fg, bg);
  const pass  = ratio >= 4.5;
  const tag   = pass ? 'AA ✓     ' : ratio >= 3.0 ? 'AA large ' : 'FAIL ✗   ';
  if (!pass) allPass = false;
  console.log(`${String(ratio.toFixed(2)).padStart(5)}:1  ${tag}  ${label}`);
}
console.log('');
console.log(allPass ? '✓ All pairs meet WCAG AA (4.5:1)' : '✗ Some pairs below AA — fix before shipping');
