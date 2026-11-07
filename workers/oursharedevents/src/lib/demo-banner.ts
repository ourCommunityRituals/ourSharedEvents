/**
 * demo-banner.ts — OSE-1012 (demo-provenance banner).
 *
 * A persistent top banner that declares a surface is a SHOWCASE, not the live
 * site. It exists so a viewer can never mistake the RIPH/mock showcase for
 * production — the mock dataset is for showing the product off, not QA.
 *
 * DOCTRINE (provenance self-declaration): the banner's presence is DERIVED from
 * the SAME signal that makes the surface render mock data — DataProvider's
 * `isMockActive`, resolved via `createDataProvider` (which honours the
 * production mock-block). It is therefore structural, not a remembered label:
 *   - mock data served  ⇒ banner present
 *   - real prod data     ⇒ banner absent (can't be hand-forced on)
 * So "this is a demo" is a property of the data, not a per-page decision.
 */

import { createDataProvider, type DataProviderEnv } from './data-provider.js';
import { msg } from './i18n/catalog.js';
import { DEFAULT_LANG, isLang, type Lang } from './i18n/languages.js';

export const DEMO_BANNER_TESTID = 'demo-provenance-banner';
export const DEGRADED_BANNER_TESTID = 'data-unavailable-banner';

/**
 * Is this worker currently serving the demo/mock dataset? Reuses the canonical
 * mock-mode resolution (createDataProvider → isMockActive) so the banner and the
 * data can never disagree, and inherits the production mock-block. Fails CLOSED:
 * if mock-mode can't be resolved, we do NOT assert "demo" (never mislabel real
 * data as a demo either).
 */
export type SurfaceProvenance = 'live' | 'demo' | 'degraded';

/**
 * The THREE mutually-exclusive provenance states of a surface. "Broken" is a
 * first-class state, NOT "the absence of demo" — `live` and `degraded` serve
 * different data and must be distinguishable:
 *   - 'demo'     — the operator intentionally put the worker in mock mode
 *                  (isIntentionalMock) → the OSE-1012 "DEMO — showcase" banner.
 *   - 'degraded' — mock FALLBACK is being served because the DB is unavailable
 *                  (isMockActive but NOT intentional). Its own indicator, and
 *                  never the word "DEMO" — a broken state is not a showcase.
 *                  Rendered by OSE-1013.
 *   - 'live'     — real data, no indicator.
 * Fail-closed: an unresolvable provider is treated as 'live' — never assert a
 * demo/degraded state we cannot confirm.
 */
export async function resolveSurfaceProvenance(env: DataProviderEnv): Promise<SurfaceProvenance> {
  try {
    const dp = await createDataProvider(env);
    if (dp.isIntentionalMock) return 'demo';
    if (dp.isMockActive) return 'degraded';
    return 'live';
  } catch {
    return 'live';
  }
}

/**
 * The OSE-1012 demo-provenance banner shows for the 'demo' state ONLY. The
 * 'degraded' (outage/fallback) state gets its own distinct indicator (OSE-1013),
 * never "DEMO".
 */
export async function isDemoModeActive(env: DataProviderEnv): Promise<boolean> {
  return (await resolveSurfaceProvenance(env)) === 'demo';
}

/**
 * Internal builder for a provenance bar — ONE geometry, parameterised by the
 * state's colour/label/text. Self-contained (inline styles only — these pages
 * already rely on inline styling, so no CSP <style>/nonce is introduced). Slim,
 * sticky, high-contrast, mobile-first. Callers pass only literals (no untrusted
 * data), so the exported markup functions below stay arity-0 and injection-free.
 */
function provenanceBar(o: {
  testid: string;
  bg: string;
  chip: string;
  text: string;
  label: string;
}): string {
  return (
    `<div data-testid="${o.testid}" role="status" aria-label="${o.label}" ` +
    `style="position:sticky;top:0;left:0;right:0;z-index:2147483000;display:flex;gap:.5rem;` +
    `align-items:center;justify-content:center;padding:.4rem .75rem;` +
    `background:${o.bg};color:#fff;text-align:center;` +
    `font:600 clamp(.72rem,2.6vw,.85rem)/1.2 system-ui,-apple-system,sans-serif;` +
    `letter-spacing:.01em;box-shadow:0 1px 3px rgba(0,0,0,.25);">` +
    `<span style="background:rgba(255,255,255,.22);border-radius:.2rem;padding:.05rem .4rem;` +
    `font-weight:800;letter-spacing:.06em;">${o.chip}</span>` +
    `<span>${o.text}</span>` +
    `</div>`
  );
}

/**
 * OSE-1012 — the 'demo' state: a confident amber showcase bar. Arity-0 (the
 * language defaults); its words are in the catalog, in the page's language.
 */
export function demoBannerMarkup(lang: Lang = DEFAULT_LANG): string {
  return provenanceBar({
    testid: DEMO_BANNER_TESTID,
    bg: 'var(--accent,#b45309)',
    chip: msg(lang, 'provenance.demoChip'),
    text: msg(lang, 'provenance.demoText'),
    label: msg(lang, 'provenance.demoLabel'),
  });
}

/**
 * OSE-1013 — the 'degraded' state: the DB is unavailable and the surface is
 * serving mock FALLBACK. Honest about degradation, NEVER "demo" (a broken state
 * is not a showcase); neutral slate, distinct from the amber demo bar. Arity-0.
 */
export function degradedBannerMarkup(lang: Lang = DEFAULT_LANG): string {
  return provenanceBar({
    testid: DEGRADED_BANNER_TESTID,
    bg: '#334155',
    chip: msg(lang, 'provenance.degradedChip'),
    text: msg(lang, 'provenance.degradedText'),
    label: msg(lang, 'provenance.degradedLabel'),
  });
}

/** The banner markup for a provenance state — empty string for 'live'. */
export function provenanceBannerMarkup(
  state: SurfaceProvenance,
  lang: Lang = DEFAULT_LANG
): string {
  if (state === 'demo') return demoBannerMarkup(lang);
  if (state === 'degraded') return degradedBannerMarkup(lang);
  return '';
}

/**
 * The language of a page, from its own `<html lang>` (OSE-1762), as the
 * staging band reads it (lib/test-site-notice.ts). A page with no `lang`, or
 * one the catalog has not got, is the default.
 */
function pageLang(htmlDoc: string): Lang {
  const open = /<html\b[^>]*>/i.exec(htmlDoc.slice(0, 4096));
  const tag = open && /\slang="([^"]*)"/i.exec(open[0]);
  const value = tag ? tag[1].trim().toLowerCase() : '';
  return isLang(value) ? value : DEFAULT_LANG;
}

/**
 * Inject the state's banner immediately after the opening <body …> tag. Handles
 * `<body>` and `<body attr="…">`. 'live' (no markup) returns the document
 * unchanged, so callers can inject unconditionally.
 */
export function injectProvenanceBanner(htmlDoc: string, state: SurfaceProvenance): string {
  // In the page's own language: the band says what the page around it says.
  const markup = provenanceBannerMarkup(state, pageLang(htmlDoc));
  if (!markup) return htmlDoc;
  // Linear on purpose: /(<body[^>]*>)/i rescans to the end from every "<body"
  // that has no ">" after it, which is quadratic (CodeQL js/polynomial-redos).
  // The first "<body", then the first ">" after it: the same tag that regex finds.
  const open = /<body/i.exec(htmlDoc);
  if (!open) return htmlDoc;
  const close = htmlDoc.indexOf('>', open.index);
  if (close === -1) return htmlDoc;
  return htmlDoc.slice(0, close + 1) + markup + htmlDoc.slice(close + 1);
}

/**
 * Emit an operator-facing, structured, NEVER-WHO signal so the team can clearly
 * know when a surface is not live — without inspecting the page. Same idiom as
 * `OPERATION_COST` / `FORM_EVENT`: a prefixed JSON line. Carries only the state
 * and the surface — no user/slug/QR-token/id identity (cost-metric never-who
 * discipline). 'live' is the silent healthy default. 'degraded' is warn-level
 * (alertable: the demo env / a surface fell to fallback = "not working").
 */
export function emitProvenanceSignal(state: SurfaceProvenance, surface: string): void {
  if (state === 'live') return;
  const line = `PROVENANCE_EVENT ${JSON.stringify({ provenance: state, surface })}`;
  if (state === 'degraded') console.warn(line);
  else console.info(line);
}

/** Resolve the provenance state AND emit the ops signal; returns the state. */
export async function resolveAndSignalProvenance(
  env: DataProviderEnv,
  surface: string
): Promise<SurfaceProvenance> {
  const state = await resolveSurfaceProvenance(env);
  emitProvenanceSignal(state, surface);
  return state;
}

/**
 * Resolve the surface's provenance, emit the ops signal, and inject the matching
 * banner. `surface` labels the signal (e.g. 'public', 'display').
 */
export async function withProvenanceBanner(
  htmlDoc: string,
  env: DataProviderEnv,
  surface: string
): Promise<string> {
  return injectProvenanceBanner(htmlDoc, await resolveAndSignalProvenance(env, surface));
}

/**
 * Back-compat demo-only injector (boolean-driven) — equivalent to injecting the
 * 'demo' state when `show`. Retained for the /demo/* wrapper and existing tests.
 */
export function injectDemoBanner(htmlDoc: string, show: boolean): string {
  return injectProvenanceBanner(htmlDoc, show ? 'demo' : 'live');
}
