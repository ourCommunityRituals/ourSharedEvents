/**
 * INVARIANT: Visible language lives in the catalog, not in render code (OSE-1760)
 *
 * The public pages used to choose a language inline, with `lang === 'es' ? ...`
 * ternaries and a hard-coded `'en' | 'es'` type repeated in function signatures,
 * so a third language meant editing every call site. The language layer
 * (`src/lib/i18n/`) replaces that: one list of languages, one string catalog,
 * one lookup. This invariant keeps it that way.
 *
 * No runtime .ts under workers/oursharedevents/src, outside src/lib/i18n/, may:
 *   - compare a language variable to a language-code literal
 *     (`lang === 'es'`, `language !== "fr"`, `pageLang == 'vi'`), or
 *   - spell the language union out (`'en' | 'es'`) instead of using `Lang`.
 *
 * Adding a language is adding it to `LANGUAGES` and giving it a catalog. A page
 * that needs a language-specific string asks `msg(lang, key)`.
 *
 * Pyramid coverage:
 *   L0 STATIC (this file): code shape, same readFileSync + walkTs approach as
 *   runtime-llm-free.invariant.spec.ts and monetization-inert.invariant.spec.ts.
 *
 * Born-red: add `const x = lang === 'es' ? 'a' : 'b';` to any file under src/
 * outside src/lib/i18n/ and the second test fails, naming the file and line.
 * The first test proves the matcher itself can fail (a gate that cannot fail
 * counts as absent).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC_DIR = join(REPO_ROOT, 'workers', 'oursharedevents', 'src');
// The one place language codes and strings may appear. Relative to SRC_DIR.
const ALLOWED_PREFIX = 'lib/i18n/';

// `lang`, `language`, `pageLang`, `preferredLang`, ... compared to a 2-letter
// code (with an optional script or region) in a string literal.
const INLINE_COMPARISON =
  /\b\w*[lL]ang(?:uage)?\w*\s*[!=]==?\s*['"`][a-z]{2}(?:-[a-z0-9]{2,8})?['"`]/;
// The union written out instead of the derived `Lang` type.
const SPELLED_UNION = /['"`]en['"`]\s*\|\s*['"`]es['"`]/;

function findInlineLanguageUses(source: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = [];
  source.split('\n').forEach((text, i) => {
    // A comment may describe the old pattern; only code counts.
    const code = text.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    if (INLINE_COMPARISON.test(code) || SPELLED_UNION.test(code)) hits.push({ line: i + 1, text });
  });
  return hits;
}

function walkTs(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkTs(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function relFromSrc(filePath: string): string {
  return filePath.slice(SRC_DIR.length + 1).replace(/\\/g, '/');
}

test.describe('Invariant: visible language lives in the catalog (OSE-1760)', () => {
  test('OSE-1760 | platform | matcher | the matcher flags inline language comparisons and the spelled-out union', () => {
    expect(findInlineLanguageUses(`const a = lang === 'es' ? 'x' : 'y';`)).toHaveLength(1);
    expect(findInlineLanguageUses(`if (opts.language !== "fr") return;`)).toHaveLength(1);
    expect(findInlineLanguageUses(`if (pageLang == 'zh-hans') {}`)).toHaveLength(1);
    expect(findInlineLanguageUses(`lang: 'en' | 'es',`)).toHaveLength(1);
    // Not language code comparisons.
    expect(findInlineLanguageUses(`const ok = status === 'ok';`)).toHaveLength(0);
    expect(findInlineLanguageUses(`const t = msg(lang, 'share.label');`)).toHaveLength(0);
    expect(findInlineLanguageUses(`// was: lang === 'es' ? 'a' : 'b'`)).toHaveLength(0);
  });

  test('OSE-1760 | platform | existence | the language layer is present', () => {
    const lib = readdirSync(join(SRC_DIR, 'lib', 'i18n'));
    for (const f of ['languages.ts', 'catalog.ts', 'resolve-language.ts']) {
      expect(lib.includes(f), `src/lib/i18n/${f} must exist`).toBe(true);
    }
  });

  test('OSE-1760 | platform | inert | no runtime file outside lib/i18n compares a language to a code literal', () => {
    const violations: string[] = [];
    for (const filePath of walkTs(SRC_DIR)) {
      const rel = relFromSrc(filePath);
      if (rel.startsWith(ALLOWED_PREFIX)) continue;
      for (const hit of findInlineLanguageUses(readFileSync(filePath, 'utf8'))) {
        violations.push(
          `${rel}:${hit.line}: ${hit.text.trim()}  (ask msg(lang, key) from lib/i18n instead)`
        );
      }
    }
    expect(
      violations,
      `Language strings belong in src/lib/i18n/catalog.ts. Found inline language use:\n${violations.join('\n')}`
    ).toEqual([]);
  });
});
