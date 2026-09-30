# Worker startup cost — measured (remediation plan step 7a)

**Date:** 2026-09-30 · **Tool:** `node scripts/measure-startup.mjs [runs]` (from `workers/oursharedevents`) · **Plan:** `docs/audits/frontend-remediation-plan-2026-09-04.md` §4.1 / step 7 — _"Measure before choosing."_

## Question

Step 7 said: every Worker invocation carries `admin.html` (now 328 KB), including anonymous QR scans that can never reach it, so split admin out. The plan also said nobody had measured whether that costs anything. This measures it.

## Method

`wrangler check startup --workerBundle` profiles the Worker's startup phase (module evaluation, before any request) in local workerd. Three variants, each built once with `wrangler deploy --dry-run --outfile` and profiled 9 times:

| Variant    | What changes                                                            |
| ---------- | ----------------------------------------------------------------------- |
| `baseline` | the Worker as built                                                     |
| `no-admin` | `admin.html` replaced by a one-line stub (restored after)               |
| `no-h3`    | `h3-js` aliased to a stub with the same exports (temporary config only) |

The script refuses to report a variant whose change did not land (the first attempt used `wrangler deploy --alias`, which is accepted but not applied to an installed package — the "stubbed" build still contained h3-js).

Absolute milliseconds are this machine's CPU, not Cloudflare's. The differences are the finding.

## Result

Upload (dry-run, no source maps): **1,864 KB raw / 413 KB gzip** — `index.js` 1,373 KB, `admin.html` 328 KB, the other seven templates 163 KB.

| Variant    | Startup CPU, median of 9 | Range        | vs baseline  |
| ---------- | ------------------------ | ------------ | ------------ |
| `baseline` | 24.5 ms                  | 13.9–29.3 ms | —            |
| `no-admin` | 24.4 ms                  | 22.6–31.5 ms | **−0.1 ms**  |
| `no-h3`    | 3.6 ms                   | 3.5–5.8 ms   | **−20.9 ms** |

Profiles attribute ~16–17 ms of every baseline run to one line in `h3-js`'s Emscripten runtime: `buffer = new ArrayBuffer(INITIAL_TOTAL_MEMORY)`, where `INITIAL_TOTAL_MEMORY = 33554432` — a **32 MB** heap requested at module load, followed by base64-decoding its memory image. That is what the code asks for and what local workerd does; whether Cloudflare's runtime commits those pages eagerly (a zero-filled buffer may be committed lazily) is **not verified** — treat "32 MB of the 128 MB limit" as the worst case, not a measurement.

**Reading the numbers (CCR PR 700, QA S2).** With n = 9 and a baseline range of ~15 ms, the `no-admin` difference (−0.1 ms; +0.3 ms and −0.8 ms on re-runs) is **inside the noise**: the honest statement is "not measurable locally", and the reason to believe it is the mechanism below, not the digit. The `no-h3` difference is outside the noise (non-overlapping ranges on every run).

JS composition (esbuild metafile): `h3-js` 546 KB (40%), `src/handlers` 389 KB, `src/lib` 294 KB, `@ocr/ui` 54 KB, `src/router.ts` 39 KB.

## What it means

1. **Splitting admin does not measurably help startup CPU.** Wrangler ships each template as a separate _text_ module; it is never parsed as JavaScript, so its startup cost is creating a string, which this method cannot see above the noise. What this does **not** measure: upload/bundle size against Cloudflare's limits, fetching the script to an edge location on a cold start, and the isolate memory the 328 KB string occupies. So the split is still worth arguing on size, memory and maintainability — just not on startup CPU.
2. **`h3-js` is ~85% of startup CPU and 32 MB of memory**, paid on every cold start by every request — including the QR scan hot path, which `handlers/qr-scan.ts` deliberately keeps free of h3 imports, but which still pays for it because the module graph is evaluated eagerly.
3. **The lever is lazy-loading h3-js — for the paths that don't need it.** Caveat (CCR PR 700, QA S3): the landing page now draws the attendee map (`lib/attendee-map`, via h3), and `/api/v2/events/map` uses h3 too, so those requests would still pay on first use; the win is for everything else, above all the anonymous QR-scan path. esbuild turns `await import('h3-js')` into a lazily-initialised module inside the same bundle, so the allocation would happen on first use rather than at startup. The six modules that import it (`lib/h3-tagging`, `lib/geo`, `lib/corridor-map`, `lib/attendee-map`, `lib/shared-report-builder`, `handlers/events-map`) and their callers (e.g. `maybeTag` on event and sponsor writes) are currently synchronous, so this is an async ripple through their call sites — a design change to decide on, not a drive-by.

## Recommendation

- Re-scope remediation step 7 from "split admin" to **"lazy-load h3-js"** for the cold-start goal (a decision, not taken yet), measured with this script before and after, per route.
- Keep the admin split as a separate maintainability item, judged on file size and review cost rather than startup.
- Re-run this script whenever a dependency is added; it takes a few minutes.
