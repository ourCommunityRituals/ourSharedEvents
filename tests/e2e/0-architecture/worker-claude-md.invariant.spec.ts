/**
 * INVARIANT: Worker-scoped CLAUDE.md exists and documents the hot-path ban (COST-403)
 *
 * The OSE worker must carry its OWN scoped `CLAUDE.md` so worker-level ops load
 * a small boundary file instead of inheriting the full 300+-line product
 * CLAUDE.md at the repo root (session context-load surface is the only real
 * measured token cost — R7 / EPIC 4). That scoped file must also restate the
 * load-bearing runtime-LLM-free boundary (COST-101) so the ban is visible at
 * the worker altitude, not just in the invariant spec.
 *
 * Pyramid coverage:
 *   L0 STATIC (this file) — file shape: the scoped CLAUDE.md is present and
 *                           names the model-provider ban + the single sanctioned
 *                           AI seam. No deployed worker needed (node:fs only).
 *
 * What this invariant catches:
 *   - Someone deletes or empties workers/oursharedevents/CLAUDE.md → CI fails.
 *   - The scoped file drifts to no longer document the hot-path import ban or
 *     the sanctioned seam → CI fails (the boundary silently disappears).
 *
 * Wall: this STRENGTHENS the gate — adds an existence + content assertion,
 * removes none. Sibling: runtime-llm-free.invariant.spec.ts (same readFileSync
 * L0 structural approach; classified structural by the OSE-350 placement guard).
 */

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKER_CLAUDE_MD = join(REPO_ROOT, 'workers', 'oursharedevents', 'CLAUDE.md');

// The model-provider ban this scoped file must restate (mirrors the allowlist
// source of truth in runtime-llm-free.invariant.spec.ts / COST-101).
const BANNED_MARKERS = ['@anthropic-ai/sdk', 'openai', 'cohere', 'mistral'];
const SANCTIONED_SEAM = 'ai-sanitization.ts';

test('worker-scoped CLAUDE.md exists', () => {
  expect(
    existsSync(WORKER_CLAUDE_MD),
    'workers/oursharedevents/CLAUDE.md must exist so worker ops load a scoped boundary file, not the full product CLAUDE.md (COST-403)'
  ).toBe(true);
});

test('worker CLAUDE.md documents the hot-path import ban + sanctioned seam', () => {
  const body = readFileSync(WORKER_CLAUDE_MD, 'utf8');

  for (const marker of BANNED_MARKERS) {
    expect(
      body.includes(marker),
      `worker CLAUDE.md must name the banned model-provider "${marker}" so the runtime-LLM-free boundary (COST-101) is visible at the worker altitude`
    ).toBe(true);
  }

  expect(
    body.includes(SANCTIONED_SEAM),
    'worker CLAUDE.md must name the single sanctioned AI seam (src/lib/ai-sanitization.ts, COST-102)'
  ).toBe(true);

  expect(
    body.includes('COST-101'),
    'worker CLAUDE.md must reference the COST-101 runtime-LLM-free invariant'
  ).toBe(true);
});
