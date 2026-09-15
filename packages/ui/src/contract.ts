/**
 * @ocr/ui — Adoption contract
 *
 * The slim-down only stays slim if templates can't quietly re-inline styles.
 * This guard, run in CI (mirrors the brain-contract pattern already in the
 * fleet), fails the build if a template declares its own :root tokens or
 * carries a large inline <style> block instead of linking the shared sheet.
 */

export interface DriftFinding {
  file: string;
  issue: 'local-root-tokens' | 'large-inline-style' | 'missing-shared-stylesheet' | 'raw-hex-color';
  detail: string;
}

const INLINE_STYLE_BUDGET = 400; // chars of inline CSS tolerated (small per-page tweaks OK)

/** Analyse one template's HTML for drift away from the shared stylesheet. */
export function checkTemplate(file: string, html: string): DriftFinding[] {
  const findings: DriftFinding[] = [];

  if (/:root\s*{/.test(html)) {
    findings.push({
      file,
      issue: 'local-root-tokens',
      detail: 'Declares its own :root tokens. Remove and link /ui.css instead.',
    });
  }

  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  const inlineCss = styleBlocks.map((m) => m[1]).join('');
  if (inlineCss.length > INLINE_STYLE_BUDGET) {
    findings.push({
      file,
      issue: 'large-inline-style',
      detail: `Inline <style> is ${inlineCss.length} chars (budget ${INLINE_STYLE_BUDGET}). Move shared rules into @ocr/ui.`,
    });
  }

  const links = /rel=["']stylesheet["']/i.test(html);
  if (!links && styleBlocks.length === 0 && /<body/i.test(html)) {
    findings.push({
      file,
      issue: 'missing-shared-stylesheet',
      detail: 'No stylesheet linked. Add <link rel="stylesheet" href="/ui.css">.',
    });
  }

  // Raw hex colors bypass the token system, so a surface that uses them cannot
  // follow dark/light — it is not theme-correct. Hex INSIDE a var() fallback
  // (`var(--token, #fallback)`) is fine: that IS routed through a token. This is
  // the token-adherence keystone (OSE-1328) — a surface with zero raw hex is
  // correct in BOTH themes by construction, because the tokens are
  // contrast-verified for dark + light (verify-contrast.mjs). CSS comments and
  // var() fallbacks are stripped before the scan so neither is a false positive.
  const scannableCss = inlineCss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/var\([^)]*\)/g, '');
  const rawHex = [...scannableCss.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  if (rawHex.length > 0) {
    const sample = [...new Set(rawHex)].slice(0, 8).join(', ');
    findings.push({
      file,
      issue: 'raw-hex-color',
      detail:
        `${rawHex.length} raw hex color(s) not routed through a token (${sample}). ` +
        'Use var(--token[, #fallback]) so both themes stay correct.',
    });
  }

  return findings;
}

/** Convenience: fold many templates into one pass/fail result. */
export function checkAll(files: { file: string; html: string }[]): DriftFinding[] {
  return files.flatMap(({ file, html }) => checkTemplate(file, html));
}
