/**
 * OSE-46 — Token contract gate (AS-1: Uniform DesignTokens)
 *
 * Enforces one rule across every HTML surface the Worker renders:
 *
 *   No unscoped :root token declarations — custom properties that must
 *   apply globally belong in @ocr/ui (Tier 1/2). Page-specific colour
 *   themes must be scoped to a [data-brand] or [data-surface] attribute
 *   (Tier 3 brand override), NOT to :root.
 *
 *   An unscoped :root block risks shadowing @ocr/ui semantic tokens
 *   (--bg, --surface, --text, --accent, …) with surface-specific values,
 *   silently breaking the design system on any page that loads /ui.css.
 *
 * Contract tool: checkTemplate() from @ocr/ui — same guard used by the
 * brain-contract workflow that already gates OCR-docs changes.
 *
 * Surfaces covered:
 *   Static templates (read via TEST_SOURCE_FILES_JSON binding):
 *     admin.html, admin-signin.html, public.html, display.html,
 *     poster.html, shared-report.html, landing.html
 *   Dynamic handler output:
 *     BRIEFING_HTML           (CEO briefing — [data-brand="briefing"])
 *     renderErrorPage()       (4xx/5xx — [data-surface="ose-error"])
 *     renderPreEventHtml()    (upcoming events — [data-surface="ose-public"])
 *     renderEventLiveHtml()   (live events — [data-surface="ose-public"])
 *
 * handleUiPreview() intentionally inlines the full @ocr/ui stylesheet —
 * it is excluded from this gate.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import { checkTemplate } from '@ocr/ui';
import { BRIEFING_HTML } from '../src/handlers/briefing';
import {
  renderErrorPage,
  renderPreEventHtml,
  renderEventLiveHtml,
  type PublicEventRow,
} from '../src/handlers/pages';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

function rootViolations(file: string, html: string): string[] {
  return checkTemplate(file, html)
    .filter((f) => f.issue === 'local-root-tokens')
    .map((f) => f.detail);
}

const MINIMAL_ROW: PublicEventRow = {
  id: 'test-evt-1',
  brand_id: 'ocr',
  title: 'Test Event',
  slug: 'test-event',
  status: 'upcoming',
  description: null,
  location: null,
  start_date: null,
  end_date: null,
  timezone: null,
  what_short: null,
  who_host: null,
  why_purpose: null,
  how_details: null,
  where_address: null,
  lat: null,
  lon: null,
};

// ── Static templates ──────────────────────────────────────────────────────────

describe('static template surfaces — no :root tokens', () => {
  const TEMPLATE_NAMES = [
    'admin.html',
    'admin-signin.html',
    'public.html',
    'display.html',
    'poster.html',
    'shared-report.html',
    'landing.html',
  ] as const;

  for (const name of TEMPLATE_NAMES) {
    test(`${name} — no unscoped :root`, () => {
      const tenv = env as unknown as TestEnv;
      const sources: Record<string, string> = JSON.parse(tenv.TEST_SOURCE_FILES_JSON);
      const html = Object.entries(sources).find(([p]) =>
        p.replaceAll('\\', '/').endsWith(`templates/${name}`)
      )?.[1];
      expect(html, `${name} not found in TEST_SOURCE_FILES_JSON`).toBeDefined();
      const violations = rootViolations(name, html!);
      expect(violations, `${name} declares :root tokens`).toEqual([]);
    });
  }
});

// ── Dynamic handler output ────────────────────────────────────────────────────

describe('BRIEFING_HTML — no :root tokens', () => {
  test('scoped to [data-brand="briefing"], no :root block', () => {
    expect(BRIEFING_HTML).toContain('data-brand="briefing"');
    const violations = rootViolations('BRIEFING_HTML', BRIEFING_HTML);
    expect(violations).toEqual([]);
  });
});

describe('renderErrorPage — no :root tokens', () => {
  test('scoped to [data-surface="ose-error"], no :root block', async () => {
    const res = renderErrorPage(404, 'Not Found', 'The page you requested does not exist.');
    const html = await res.text();
    expect(html).toContain('data-surface="ose-error"');
    const violations = rootViolations('renderErrorPage', html);
    expect(violations).toEqual([]);
  });
});

describe('renderPreEventHtml — no :root tokens', () => {
  test('scoped to [data-surface="ose-public"], no :root block', () => {
    const html = renderPreEventHtml(MINIMAL_ROW, 'https://oursharedevents.com/events/test-evt-1');
    expect(html).toContain('data-surface="ose-public"');
    const violations = rootViolations('renderPreEventHtml', html);
    expect(violations).toEqual([]);
  });
});

describe('renderEventLiveHtml — no :root tokens', () => {
  test('scoped to [data-surface="ose-public"], no :root block', () => {
    const liveRow: PublicEventRow = { ...MINIMAL_ROW, status: 'live' };
    const html = renderEventLiveHtml(liveRow, 'https://oursharedevents.com/events/test-evt-1');
    expect(html).toContain('data-surface="ose-public"');
    const violations = rootViolations('renderEventLiveHtml', html);
    expect(violations).toEqual([]);
  });
});
