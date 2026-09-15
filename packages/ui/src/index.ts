/**
 * @ocr/ui — the shared UI layer for OSE and its spokes.
 *
 * NATIVE JS ONLY (owner decision, 2026-09-05). This package exports functions
 * that return HTML STRINGS, plus the stylesheet and design tokens that style
 * them. No framework, no build step, no bundler — the same shape the workers
 * already produce, which is what makes adoption drop-in.
 *
 * REMOVED, DELIBERATELY: a React component layer (13 .tsx files under src/react/)
 * and a Tailwind preset (src/tailwind.ts). Neither was used by any served
 * surface — the seven templates are hand-written HTML and the only mentions of
 * Tailwind anywhere in the repo were comments about a blue that had drifted in
 * (OSE-221). They existed as a Phase-3 bet, and carrying an unused framework
 * layer in the one package everything imports is how "which stack is this?"
 * becomes a question people have to ask. It should not be a question.
 *
 * If a framework layer is ever wanted, it belongs in its own package, added
 * when something actually renders it.
 */
export {
  tokens,
  primitives,
  semanticDark,
  semanticLight,
  structural,
  rootBlock,
  lightModeBlock,
  forceDarkBlock,
  uecDisplay,
  uecScan,
  uecBlock,
  type TokenName,
  type PrimitiveName,
} from './tokens';
export { componentStyles } from './styles';
export { ocrStylesheet, serveCss, styleTag } from './css';
export { esc, escUrl } from './esc';
export { contrastRatio } from './contrast';
export {
  header,
  footer,
  bottomNav,
  button,
  card,
  loading,
  emptyState,
  accessDenied,
  formInput,
  textarea,
  formSelect,
  checkbox,
  radioGroup,
  formGroup,
  page,
  type NavItem,
  type ButtonOpts,
  type EmptyStateOpts,
  type FooterOpts,
  type FooterLink,
  type FormInputOpts,
  type TextareaOpts,
  type FormSelectOpts,
  type CheckboxOpts,
  type RadioGroupOpts,
  type FormGroupOpts,
  type PageOpts,
} from './partials';
export { checkTemplate, checkAll, type DriftFinding } from './contract';
export {
  BRAND_CUSTOMIZABLE,
  BRAND_LOCKED,
  DESIGNATION,
  validateBrandOverride,
  type CustomizableToken,
  type BrandOverrideViolation,
} from './brand';
