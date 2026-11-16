/**
 * A browser page's reads of staging, and the Cloudflare edge in front of it.
 *
 *   tests/e2e/3-flows/map-place-panel.spec.ts      T4k (through ./map-zoom-area)
 *   tests/e2e/3-flows/launch-story-smoke.spec.ts   T4g (OSE-2022)
 *
 * From a GitHub runner the edge can answer a read of `/events/<id>…` on stg with a
 * managed challenge (403, cf-mitigated) before the Worker runs, unless the read
 * carries the X-OCR-CI header the stg skip rule matches
 * (docs/runbooks/RUNBOOK-STG-CI-SKIP-RULE.md). A Playwright page navigation sends
 * no such header by itself. What is here:
 *
 *   passStgEdge(page)             send the header on this page's reads of the site
 *   edgeHeaderSent(res)           did the request behind this answer carry it?
 *   throwIfEdgeAnswered(res, p)   a challenge fails the test by name (T4k)
 *   noteIfEdgeAnswered(res, p)    a challenge is a warning, and a failure once the
 *                                 owner sets CALENDAR_EDGE_STRICT=1 (T4g)
 *
 * Nothing here prints the header's value. Gates: tests/unit/ci/map-links-stg-edge.test.js
 * and tests/unit/ci/launch-smoke-stg-edge.test.js.
 */
import type { Page, Response } from '@playwright/test';
import { edgeChallenged, edgeHeaders, noteEdgeChallenge } from '../../../scripts/ci/edge-read.mjs';

const BASE_URL = (process.env.BASE_URL || 'https://stg.oursharedevents.com').replace(/\/+$/, '');

/**
 * Let this page's reads of the site pass the stg edge, as CI's other reads do.
 *
 * `/` is not challenged, which is why the map's area page needs nothing; the stg
 * watch `edge` job shows both answers for `/events/<id>`.
 *
 * The header goes on requests to BASE_URL's own origin and on nothing else, so
 * the token never reaches another host. The Worker does not read X-OCR-CI
 * (nothing under workers/oursharedevents/src names it), so a read with it is
 * counted, or not counted, exactly as a visitor's is. With no token set (a local
 * Worker has no edge) nothing is added.
 */
export async function passStgEdge(page: Page): Promise<void> {
  const headers = edgeHeaders();
  if (Object.keys(headers).length === 0) return;
  const origin = new URL(BASE_URL).origin;
  await page.route(
    (url) => url.origin === origin,
    (route) => route.continue({ headers: { ...route.request().headers(), ...headers } })
  );
}

/**
 * Did the request behind this answer carry X-OCR-CI? Read from the request
 * itself, so it says what was sent, not what the environment could have sent.
 */
export async function edgeHeaderSent(res: Response): Promise<boolean> {
  const sent = await res.request().allHeaders();
  return typeof sent['x-ocr-ci'] === 'string' && sent['x-ocr-ci'] !== '';
}

/**
 * Fail by name when the edge answered a navigation, not the Worker. A challenge
 * is never a pass and never a skip here: a link the walk could not follow proves
 * nothing about what following it counts.
 */
export function throwIfEdgeAnswered(res: Response | null, path: string): void {
  if (!res || !edgeChallenged(res.status(), res.headers())) return;
  const sent = edgeHeaders()['X-OCR-CI']
    ? 'with X-OCR-CI: the stg skip rule did not let it through (path not covered, or another token)'
    : 'without X-OCR-CI: OCR_CI_EDGE_TOKEN is not set for this step';
  throw new Error(
    `Cloudflare answered ${path}, not the Worker (cf-mitigated: ${res.headers()['cf-mitigated']}; ` +
      `sent ${sent}). See docs/runbooks/RUNBOOK-STG-CI-SKIP-RULE.md.`
  );
}

/**
 * When the edge answered a navigation, record it where a person looks (a GitHub
 * warning and a step-summary line) and return the message; throw when
 * CALENDAR_EDGE_STRICT is 1. Return null when the edge did not answer: the caller
 * then checks the Worker's own answer, a 403 of the Worker's included.
 *
 * The caller stops at a message. It never goes on to count the read as a pass.
 */
export async function noteIfEdgeAnswered(
  res: Response | null,
  path: string
): Promise<string | null> {
  if (!res || !edgeChallenged(res.status(), res.headers())) return null;
  return noteEdgeChallenge(path, process.env, { headerSent: await edgeHeaderSent(res) });
}
