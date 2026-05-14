/**
 * OSE Anonymity Architecture — CI-enforced static gate
 *
 * The load-bearing architectural commitment in ADR-001 is that NO
 * public-facing rendering handler reads per-attendee identity. This
 * file is the canonical home for that gate, defending the principle
 * across every public-facing handler file in `src/handlers/`.
 *
 * Why this file exists (bug-fix history):
 *
 *   - OSE-243a (PR #167) added the gate but ONLY on handlePublicEventPage
 *     in pages.ts. The original implementation was narrower than the
 *     architectural commitment — handlePublicEventPage was just the
 *     first surface to ship with the anonymity affordance, not the
 *     only surface that needed the gate.
 *   - OSE-263 (PR #178) widened the gate to all 6 handle*Page handlers
 *     in pages.ts.
 *   - OSE-274 / OSE-275 / OSE-276 (THIS PR) close the remaining gap:
 *     the gate was never on handleFormPage (form-pages.ts), nor on
 *     handleShortlinkResolve (shortlink-resolve.ts), nor on
 *     handlePrivacyPage (privacy.ts). All three are public-facing
 *     handlers that have ALWAYS been bound by the same architectural
 *     promise. The gate was incomplete; this is the bug fix.
 *
 * Architectural rule the gate defends:
 *
 *   No public-facing handler in src/handlers/*.ts may read any of:
 *     - Cf-Connecting-Ip          (the network identifier)
 *     - X-Forwarded-For           (the alt network identifier)
 *     - request.headers.get('Cookie')   (per-attendee session)
 *     - getOrCreateAnonId / setAnonCookie   (the anon_id cookie helper)
 *     - request.headers.get('Referer')  (the previous URL — re-id risk)
 *     - request.headers.get('User-Agent')  (device fingerprint input)
 *
 * Documented exemptions (admin / explicit-opt-in surfaces):
 *
 *   - All handle*Admin* / admin-scoped handlers — admin auth is legitimate
 *   - handleSubscribe (pages.ts) — explicit email opt-in + peppered IP
 *     hash for rate limit (OSE-207 / migration 0028); never stores raw IP
 *   - Data-subject erasure (data-subject.ts) — admin-authenticated
 *
 * Adding a new public-facing handler file?
 *
 *   Register it in PUBLIC_HANDLER_FILES below with the set of exported
 *   handler names that must be gated. The drift-guard test catches new
 *   handlers added to existing registered files; the file-level addition
 *   here is a one-line change.
 */

import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

// ─── Forbidden reads — the architectural rule, in regex form ─────────────────
const FORBIDDEN_READS: RegExp[] = [
  /\bCf-Connecting-Ip\b/i,
  /\bX-Forwarded-For\b/i,
  /\brequest\.headers\.get\(['"]?[Cc]ookie['"]?\)/,
  /\bgetOrCreateAnonId\b/,
  /\bsetAnonCookie\b/,
  /\brequest\.headers\.get\(['"]?[Rr]eferer['"]?\)/,
  /\brequest\.headers\.get\(['"]?[Uu]ser-[Aa]gent['"]?\)/,
];

// ─── Helper — extract a named exported function body via brace-walker ────────
function extractFunctionBody(src: string, exportName: string): string | null {
  const patterns = [`export async function ${exportName}`, `export function ${exportName}`];
  let start = -1;
  for (const p of patterns) {
    const idx = src.indexOf(p);
    if (idx > -1) {
      start = idx;
      break;
    }
  }
  if (start < 0) return null;
  let depth = 0;
  let i = src.indexOf('{', start);
  if (i < 0) return null;
  const bodyStart = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(bodyStart, i + 1);
}

function loadSource(relPath: string): string {
  const sources: Record<string, string> = JSON.parse(
    (env as unknown as TestEnv).TEST_SOURCE_FILES_JSON
  );
  const entry = Object.entries(sources).find(([p]) => p.replace(/\\/g, '/').endsWith(relPath));
  expect(entry, `${relPath} not found in TEST_SOURCE_FILES_JSON`).toBeDefined();
  return entry![1];
}

// ─── Per-file gate registry ──────────────────────────────────────────────────
// Each entry: { relPath, gatedHandlers, exemptHandlers, exportFinder }
//
//   - gatedHandlers: MUST be anonymity-safe (no forbidden reads)
//   - exemptHandlers: documented exemptions (admin auth, peppered IP, etc.)
//   - exportFinder: regex that enumerates the export name pattern in the file;
//     used by the drift-guard to assert no new public-facing handler in the
//     file silently slips past the gate
//
// Note: pages.ts gate is already in tests/public-event-page.spec.ts (PR #178).
// Once both that PR and this one merge, a follow-on story will consolidate
// pages.ts here too. For now this file covers form-pages, shortlink-resolve,
// and privacy — the three files OSE-274/275/276 identified as gap.

interface FileRegistry {
  relPath: string;
  description: string;
  gatedHandlers: string[];
  exemptHandlers: string[];
  exportFinder: RegExp;
  exportFinderDescription: string;
}

const PUBLIC_HANDLER_FILES: FileRegistry[] = [
  {
    relPath: 'src/handlers/form-pages.ts',
    description: 'attendee-facing form surface (/forms/:id?type=...)',
    gatedHandlers: ['handleFormPage'],
    exemptHandlers: [],
    exportFinder: /export (?:async )?function (handle\w+)/g,
    exportFinderDescription: '`export (async )? function handle*`',
  },
  {
    relPath: 'src/handlers/shortlink-resolve.ts',
    description: 'public shortlink redirect (/s/:code) — the first attendee touchpoint',
    gatedHandlers: ['handleShortlinkResolve'],
    exemptHandlers: [],
    exportFinder: /export (?:async )?function (handle\w+)/g,
    exportFinderDescription: '`export (async )? function handle*`',
  },
  {
    relPath: 'src/handlers/privacy.ts',
    description: 'privacy policy page (/privacy) — the irony surface',
    gatedHandlers: ['handlePrivacyPage'],
    exemptHandlers: [],
    exportFinder: /export (?:async )?function (handle\w+)/g,
    exportFinderDescription: '`export (async )? function handle*`',
  },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('OSE-274/275/276: anonymity-principle static gate (bug fix — every public handler)', () => {
  for (const entry of PUBLIC_HANDLER_FILES) {
    describe(`${entry.relPath} — ${entry.description}`, () => {
      test('all gated handlers have zero per-attendee identity reads', () => {
        const src = loadSource(entry.relPath);
        const perHandlerViolations: Record<string, string[]> = {};

        for (const fnName of entry.gatedHandlers) {
          const body = extractFunctionBody(src, fnName);
          expect(
            body,
            `${fnName} not found in ${entry.relPath} — gate must be updated when handlers are renamed or removed`
          ).not.toBeNull();
          const violations: string[] = [];
          for (const pattern of FORBIDDEN_READS) {
            if (pattern.test(body!)) violations.push(pattern.source);
          }
          if (violations.length > 0) {
            perHandlerViolations[fnName] = violations;
          }
        }

        expect(
          perHandlerViolations,
          `Public handler reads per-attendee identity in ${entry.relPath} (violates OSE anonymity principle, ADR-001): ${JSON.stringify(perHandlerViolations, null, 2)}`
        ).toEqual({});
      });

      test('drift-guard: gated list covers every public handler in the file (no silent gaps)', () => {
        const src = loadSource(entry.relPath);
        const found = new Set<string>();
        const re = new RegExp(entry.exportFinder.source, entry.exportFinder.flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) {
          found.add(m[1]);
        }

        const exemptSet = new Set(entry.exemptHandlers);
        const expectedInGate = [...found].filter((name) => !exemptSet.has(name)).sort();
        const gateNames = [...entry.gatedHandlers].sort();

        expect(
          gateNames,
          `Drift: gatedHandlers in ${entry.relPath} does not match the ${entry.exportFinderDescription} exports in source.\n  In source (non-exempt): ${expectedInGate.join(', ')}\n  In gate: ${gateNames.join(', ')}\n  → Add the missing handler to gatedHandlers OR add a documented exemption.`
        ).toEqual(expectedInGate);
      });
    });
  }
});
