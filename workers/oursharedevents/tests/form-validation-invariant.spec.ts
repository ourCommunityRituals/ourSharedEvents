/**
 * OSE-204 / BE-15 — Form validation container static invariant.
 *
 * Locks in the architectural contract that the validation container
 * extracted to `src/lib/form-validation.ts` (in this PR) is the single
 * canonical entry point for all public form submissions.
 *
 * What this gate enforces (static analysis over src/handlers/forms.ts):
 *
 *   1. `forms.ts` imports `validateFormRequest` from `../lib/form-validation`
 *      (not a local re-definition).
 *   2. Every public form handler — `handleFormRegistration`,
 *      `handleFormCheckin`, `handleFormSurvey`, `handleFormEmailSignup` —
 *      calls `validateFormRequest(...)` exactly once.
 *   3. `forms.ts` no longer defines its own copies of `validateFormRequest`,
 *      `parseJsonBody`, or `isValidEventId` — these MUST come from the lib so
 *      any future drift is caught at the gate, not in production.
 *   4. The lib itself exports the canonical symbols.
 *
 * This is the same architectural-invariant pattern as:
 *   - `pagination-shape-invariant.spec.ts` (OSE-206)
 *   - `pii-invariant.spec.ts` (OSE-207)
 *   - `fk-type-invariant.spec.ts` (Sweep 2)
 *   - `architecture.spec.ts` (OSE-205)
 *
 * Together these 5 static gates raise the architectural floor — the test
 * pyramid catches contract drift BEFORE it lands.
 */

import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

const PUBLIC_FORM_HANDLERS = [
  'handleFormRegistration',
  'handleFormCheckin',
  'handleFormSurvey',
  'handleFormEmailSignup',
] as const;

/**
 * Extract the body of a named exported function from a source string.
 * Brace-aware so nested {} parse correctly. Returns the full function
 * text including the signature line.
 */
function extractFunctionBody(content: string, name: string): string | null {
  const marker = `export async function ${name}`;
  const i = content.indexOf(marker);
  if (i === -1) return null;
  const braceStart = content.indexOf('{', i);
  if (braceStart === -1) return null;
  let depth = 0;
  let end = braceStart;
  for (; end < content.length; end++) {
    if (content[end] === '{') depth++;
    else if (content[end] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null;
  return content.slice(i, end + 1);
}

function getSource(relPath: string): string {
  const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  const entry = Object.entries(sources).find(([p]) => p.replace(/\\/g, '/').endsWith(relPath));
  if (!entry) {
    throw new Error(`source not found in TEST_SOURCE_FILES_JSON: ${relPath}`);
  }
  return entry[1];
}

describe('Form validation container invariant (OSE-204)', () => {
  test('src/handlers/forms.ts imports validateFormRequest from lib/form-validation', () => {
    const src = getSource('src/handlers/forms.ts');
    // Accept any single-line import shape that pulls validateFormRequest from
    // ../lib/form-validation. Don't pin formatting — prettier may reflow.
    expect(
      src.includes("from '../lib/form-validation'") ||
        src.includes('from "../lib/form-validation"'),
      'forms.ts must import from ../lib/form-validation'
    ).toBe(true);
    expect(
      /import\s*\{[^}]*validateFormRequest[^}]*\}\s*from\s*['"]\.\.\/lib\/form-validation['"]/s.test(
        src
      ),
      'forms.ts must import the named export `validateFormRequest`'
    ).toBe(true);
  });

  test('forms.ts no longer locally defines validateFormRequest / parseJsonBody / isValidEventId', () => {
    const src = getSource('src/handlers/forms.ts');
    const localDefs = [
      /\bfunction\s+validateFormRequest\s*\(/,
      /\bfunction\s+parseJsonBody\s*\(/,
      /\bfunction\s+isValidEventId\s*\(/,
    ];
    const violations: string[] = [];
    for (const pattern of localDefs) {
      if (pattern.test(src)) {
        violations.push(pattern.source);
      }
    }
    expect(
      violations,
      `forms.ts re-defines a symbol that MUST come from the lib (drift risk): ${violations.join(', ')}`
    ).toEqual([]);
  });

  test.each(PUBLIC_FORM_HANDLERS)('handler %s calls validateFormRequest exactly once', (name) => {
    const src = getSource('src/handlers/forms.ts');
    const body = extractFunctionBody(src, name);
    expect(body, `function ${name} not found in forms.ts`).not.toBeNull();
    const matches = body!.match(/validateFormRequest\s*\(/g);
    expect(
      matches?.length ?? 0,
      `${name} must call validateFormRequest exactly once (found ${matches?.length ?? 0})`
    ).toBe(1);
  });

  test('lib/form-validation.ts exports the canonical container surface', () => {
    const src = getSource('src/lib/form-validation.ts');
    // Each symbol the gate above relies on MUST be exported by the lib.
    const required = [
      'validateFormRequest',
      'parseJsonBody',
      'isValidEventId',
      'handleDbError',
      'trimStr',
      'MAX_BODY_BYTES',
    ];
    const missing = required.filter((sym) => {
      const re = new RegExp(`\\bexport\\s+(?:const|function|async\\s+function|type)\\s+${sym}\\b`);
      return !re.test(src);
    });
    expect(
      missing,
      `lib/form-validation.ts is missing canonical exports: ${missing.join(', ')}`
    ).toEqual([]);
  });
});
