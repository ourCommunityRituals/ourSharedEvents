/**
 * INVARIANT: Runtime is LLM-free (COST-101)
 *
 * No runtime code path in the OSE worker may import a model-provider SDK or
 * call a model-provider HTTP API. Served-user operations (create event,
 * poster/QR, scan, SharedReport) are deterministic Cloudflare Workers compute
 * and cost ~0 model tokens. That property is the load-bearing reason the
 * free-forever promise (churches + chosen clients) is structurally
 * sustainable: cost scales with cheap deterministic primitives, never with
 * per-operation token metering.
 *
 * The dormant `src/lib/ai-sanitization.ts` seam is the SINGLE sanctioned place
 * a future AI feature may enter, and it is reviewed before any wiring
 * (COST-102). It is the only allowlisted file here.
 *
 * Pyramid coverage:
 *   L0 STATIC (this file) — code shape: no model-SDK import specifier and no
 *                           model-API hostname appears in any runtime .ts under
 *                           workers/oursharedevents/src (except the seam).
 *
 * What this invariant catches:
 *   - Someone adds `import ... from '@anthropic-ai/sdk'` (or openai / cohere /
 *     mistral / gemini / groq / replicate / langchain / ollama) to a runtime
 *     path → CI fails → a ~0-token operation cannot silently become a
 *     token-metered one.
 *   - Someone hard-codes a model-provider base URL (api.anthropic.com,
 *     api.openai.com, …) into a runtime fetch() → CI fails.
 *
 * Wall: this STRENGTHENS the gate — it adds a security/cost assertion, removes
 * none. Pattern reference: monetization-inert.invariant.spec.ts (same
 * readFileSync + walkTs L0 structural approach).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC_DIR = join(REPO_ROOT, 'workers', 'oursharedevents', 'src');

// The ONLY runtime file permitted to reference model concepts. It is the
// sanctioned AI seam (COST-102) — a sanitizer applied before any model call,
// reviewed before wiring. Relative to SRC_DIR, using forward slashes.
const ALLOWLIST = new Set(['lib/ai-sanitization.ts']);

// Forbidden model-provider import specifiers. Matched only inside an
// `import ... from '<spec>'` or `require('<spec>')` — NOT as bare substrings,
// so "coherence"/"incoherent" (which contain "cohere") never trip the gate.
const FORBIDDEN_MODULE_SPECIFIERS = [
  '@anthropic-ai/sdk',
  '@anthropic-ai/',
  'openai',
  '@openai/',
  'cohere-ai',
  '@mistralai/',
  '@google/generative-ai',
  '@google-cloud/aiplatform',
  '@google-cloud/vertexai',
  'langchain',
  '@langchain/',
  'replicate',
  'groq-sdk',
  'ollama',
];

// Forbidden model-provider API hostnames (a runtime HTTP call to a model API).
const FORBIDDEN_HOSTNAMES = [
  /api\.anthropic\.com/i,
  /api\.openai\.com/i,
  /generativelanguage\.googleapis\.com/i,
  /api\.cohere\.(ai|com)/i,
  /api\.mistral\.ai/i,
  /api\.groq\.com/i,
  /api\.replicate\.com/i,
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build an import/require matcher for each forbidden specifier. A leading `@`
// or exact word boundary anchors the specifier so `openai` does not match a
// hypothetical `openair` package.
function specifierMatchers(spec: string): RegExp[] {
  const e = escapeRe(spec);
  // import ... from 'spec'  |  import 'spec'  |  require('spec')  |  from 'spec/...'
  return [
    new RegExp(`from\\s*['"\`]${e}(['"\`/])`),
    new RegExp(`require\\(\\s*['"\`]${e}(['"\`/])`),
    new RegExp(`import\\s*['"\`]${e}(['"\`/])`),
  ];
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

test.describe('Invariant: Runtime is LLM-free — free-forever cost guardrail (COST-101)', () => {
  test('OSE-COST101 | platform | existence | the sanctioned AI seam exists and is the only allowlisted file', () => {
    const seam = join(SRC_DIR, 'lib', 'ai-sanitization.ts');
    expect(
      readdirSync(join(SRC_DIR, 'lib')).includes('ai-sanitization.ts'),
      `The sanctioned AI seam must exist at src/lib/ai-sanitization.ts — it is the ` +
        `single reviewed entry point for any future AI feature (COST-102). Seam: ${seam}`
    ).toBe(true);
  });

  test('OSE-COST101 | platform | inert | no model-provider SDK import or model-API hostname in any runtime path', () => {
    const violations: string[] = [];

    for (const filePath of walkTs(SRC_DIR)) {
      const rel = relFromSrc(filePath);
      if (ALLOWLIST.has(rel)) continue;

      const content = readFileSync(filePath, 'utf8');

      for (const spec of FORBIDDEN_MODULE_SPECIFIERS) {
        for (const matcher of specifierMatchers(spec)) {
          if (matcher.test(content)) {
            violations.push(
              `${rel}: imports model-provider SDK "${spec}" — runtime must stay LLM-free ` +
                `(route any AI feature through the reviewed src/lib/ai-sanitization.ts seam)`
            );
          }
        }
      }

      for (const host of FORBIDDEN_HOSTNAMES) {
        if (host.test(content)) {
          violations.push(
            `${rel}: references model-provider API hostname ${host} — runtime must not call a model API`
          );
        }
      }
    }

    expect(
      violations,
      `Runtime-LLM-free invariant violated. Introducing a per-operation model call converts a ` +
        `~0-token operation into a token-metered one and threatens the free-forever promise. ` +
        `Violations:\n  - ${violations.join('\n  - ')}`
    ).toEqual([]);
  });
});
