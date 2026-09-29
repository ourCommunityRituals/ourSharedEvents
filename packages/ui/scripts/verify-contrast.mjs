import { contrastRatio } from '../src/contrast.ts';

const darkBg  = '#141F30'; // --bg after OSE-1325 (navy-925); was navy-950 #0F1824
const darkSurf = '#1A2740';
const lightBg  = '#F4F7FC';
const lightHover = '#E8EEF6'; // --surface-hover (light-150)

const pairs = [
  // Dark mode
  ['text on bg (dark)',        '#F0F4F8', darkBg],
  ['text on surface (dark)',   '#F0F4F8', darkSurf],
  ['muted on bg (dark)',       '#7A94B0', darkBg],
  ['accent on bg (dark)',      '#1785FB', darkBg],
  ['live/teal on bg (dark)',   '#00C4B4', darkBg],
  ['danger on bg (dark)',      '#EA6D6D', darkBg],
  ['danger on surface (dark)', '#EA6D6D', darkSurf],
  ['warn on bg (dark)',        '#F5B32E', darkBg],
  ['info on bg (dark)',        '#3D9BFF', darkBg],
  ['success on bg (dark)',     '#34D399', darkBg],
  ['success on surface (dark)','#34D399', darkSurf],
  // Status-pill text on the neutral --border fill (sponsor-home .done/.declined,
  // CCR-PR567 L3c). The colored pills (soon/pending/live = --bg on accent/warn/
  // success) are already covered: contrast is symmetric, so those equal the
  // gated "<color> on bg" pairs above.
  ['pill text on border (dark)',  '#F0F4F8', '#2A3D5A'], // --text on --border(navy-700)
  ['pill text on border (light)', '#162945', '#D4E0ED'], // --text on --border(light-200)
  // --on-accent: text on solid --accent buttons/CTAs (CCR-PR567 re-run item 5).
  // Asymmetric: dark --accent (#1785FB, light-ish) needs DARK text; light
  // --accent (#0057D6, dark) needs WHITE text.
  ['on-accent (dark):  navy-950 on --accent',  '#0F1824', '#1785FB'],
  ['on-accent (light): white on --accent',     '#FFFFFF', '#0057D6'],
  // Light mode — darker variants
  ['text on bg (light)',       '#162945', lightBg],
  ['muted on bg (light)',      '#4A6882', lightBg],
  ['accent on bg (light)',     '#0057D6', lightBg],
  ['live/teal on bg (light)',  '#00796B', lightBg],
  ['danger on bg (light)',     '#B03030', lightBg],
  ['warn on bg (light)',       '#8A5A00', lightBg],
  ['info on bg (light)',       '#0057D6', lightBg],
  ['success on bg (light)',    '#137A42', lightBg],
  // Light mode on a hovered card / list row (--surface-hover = light-150).
  // Was light-200, where muted/live/warn/success fell to 3.97–4.43:1.
  ['muted on surface-hover (light)',   '#4A6882', lightHover],
  ['live on surface-hover (light)',    '#00796B', lightHover],
  ['warn on surface-hover (light)',    '#8A5A00', lightHover],
  ['success on surface-hover (light)', '#137A42', lightHover],
  // Ink on the accent HOVER fill: .btn-primary etc. now use --on-accent
  // (they hard-coded #000, which was 3.33:1 on the light accent).
  ['on-accent on accent-hover (dark)',  '#0F1824', '#3D9BFF'],
  ['on-accent on accent-hover (light)', '#FFFFFF', '#2E6FDF'],
];

// Non-text contrast (WCAG 1.4.11, 3:1): the edge of a form control.
const nonText = [
  ['border-strong on bg (light)',            '#72879F', lightBg],
  ['border-strong on surface (light)',       '#72879F', '#FFFFFF'],
  ['border-strong on surface-hover (light)', '#72879F', lightHover],
];

let allPass = true;
for (const [label, fg, bg] of pairs) {
  const ratio = contrastRatio(fg, bg);
  const pass  = ratio >= 4.5;
  const tag   = pass ? 'AA ✓     ' : ratio >= 3.0 ? 'AA large ' : 'FAIL ✗   ';
  if (!pass) allPass = false;
  console.log(`${String(ratio.toFixed(2)).padStart(5)}:1  ${tag}  ${label}`);
}
for (const [label, fg, bg] of nonText) {
  const ratio = contrastRatio(fg, bg);
  const pass  = ratio >= 3.0;
  if (!pass) allPass = false;
  console.log(`${String(ratio.toFixed(2)).padStart(5)}:1  ${pass ? '3:1 ✓    ' : 'FAIL ✗   '}  ${label}`);
}
console.log('');
console.log(allPass ? '✓ All pairs meet WCAG AA (4.5:1 text, 3:1 control edges)' : '✗ Some pairs below AA — fix before shipping');
// A gate that can't fail is not a gate — exit non-zero so CI actually blocks
// on a sub-AA pair (OSE-1328). NOTE (follow-up): this pair list is hand-synced
// to tokens.ts; a stale darkBg is exactly how the OSE-1325 danger regression
// slipped. It should read + resolve the semantic tokens from tokens.ts instead.
process.exit(allPass ? 0 : 1);
