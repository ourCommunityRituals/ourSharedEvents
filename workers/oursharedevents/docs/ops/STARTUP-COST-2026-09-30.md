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

Profiles attribute ~16–17 ms of every baseline run to one line in `h3-js`'s Emscripten runtime: `buffer = new ArrayBuffer(INITIAL_TOTAL_MEMORY)`, where `INITIAL_TOTAL_MEMORY = 33554432` — a **32 MB** heap reserved on every cold isolate (a quarter of the 128 MB Workers memory limit), followed by base64-decoding its memory image.

JS composition (esbuild metafile): `h3-js` 546 KB (40%), `src/handlers` 389 KB, `src/lib` 294 KB, `@ocr/ui` 54 KB, `src/router.ts` 39 KB.

## What it means

1. **Splitting admin does not help startup.** Wrangler ships each template as a separate _text_ module; it is never parsed as JavaScript, so the only startup cost is a string of bytes. Measured: nothing. Admin's size still matters for upload size and for maintainability (one 328 KB file), so the split remains a reasonable _code-organisation_ task — but it should be argued on those grounds, not cold start.
2. **`h3-js` is ~85% of startup CPU and 32 MB of memory**, paid on every cold start by every request — including the QR scan hot path, which `handlers/qr-scan.ts` deliberately keeps free of h3 imports, but which still pays for it because the module graph is evaluated eagerly.
3. **The lever is lazy-loading h3-js.** esbuild turns `await import('h3-js')` into a lazily-initialised module inside the same bundle, so the allocation would happen on first use rather than at startup. The six modules that import it (`lib/h3-tagging`, `lib/geo`, `lib/corridor-map`, `lib/attendee-map`, `lib/shared-report-builder`, `handlers/events-map`) and their callers (e.g. `maybeTag` on event and sponsor writes) are currently synchronous, so this is an async ripple through their call sites — a design change to decide on, not a drive-by.

## Recommendation

- Re-scope remediation step 7 from "split admin" to **"lazy-load h3-js"** for the cold-start goal, measured with this script before and after.
- Keep the admin split as a separate maintainability item, judged on file size and review cost rather than startup.
- Re-run this script whenever a dependency is added; it takes a few minutes.
