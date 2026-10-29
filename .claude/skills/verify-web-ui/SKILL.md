---
name: verify-web-ui
description: >
  Start the single-page web UI locally, drive it with Playwright through this
  skill's verify.js, and capture device-true screenshots plus ARIA snapshots at
  phone, tablet and desktop sizes. Use to see a UI change working, to produce
  evidence for a PR, or when asked to run, screenshot or verify the web UI.
---

# verify-web-ui

Status: **the `server.mjs` app is not built yet.** It does not exist in any
OurCommunityRituals repo today (checked 2026-10-27). This skill is the contract
that app must meet. Until it exists, `verify.js` captures any running instance
with `--url`, including OSE's own worker: start it with `npm run dev` in
`workers/oursharedevents` and pass the URL it prints.

This skill is kept as identical copies in `ourSharedEvents` (OSE) and `ourWKRP` (OW),
so it is available in either repo and in a session that spans both (the OSE/OW
hybrid, ADR-009: composed, never fused). If you change one copy, change the other
in the same sitting; `diff` the two files to check.

## Surface

One web UI, one route (`/`), used on phones, tablets and desktops. Check all
three; a pass on desktop alone is not a pass.

## Run

```bash
npm start            # node server.mjs, default port 4173
PORT=5000 npm start  # any other port
```

`server.mjs` must read `process.env.PORT` and default to `4173`.

## Drive

Playwright, only through this skill's wrapper:

```bash
node .claude/skills/verify-web-ui/verify.js
```

Run it from the root of `ourSharedEvents/` or `ourWKRP/` after `npm ci`. It resolves
Playwright from the current directory (`playwright`, then `@playwright/test`),
and it starts `server.mjs` from there too.

Flags:

| Flag              | Meaning                                                     |
| ----------------- | ----------------------------------------------------------- |
| `--url <url>`     | Capture an already-running instance; do not start a server. |
| `--server <file>` | Server entry to start. Default `server.mjs`.                |
| `--out <dir>`     | Output directory. Default `.verify-out`.                    |
| `--path </x>`     | Route to capture. Default `/`.                              |
| `--devices a,b`   | Subset of `phone,tablet,desktop`. Default all three.        |

Without `--url` the wrapper starts `node server.mjs` on a free port, waits for
it, captures, and stops only the process it started.

## Observe

Per device, in the output directory:

- `<device>.png`: full-page screenshot at the device's true size and pixel ratio.
  Phone is iPhone 14 (390x664 viewport, 3x, touch), tablet is iPad Pro 11
  (834x1194, 2x, touch), desktop is 1440x900 at 1x. Sizes come from Playwright's device registry, not hand-picked numbers.
- `<device>.aria.yml`: ARIA snapshot of `body`. Diff it between runs to see
  structure changes without pixel noise.

The wrapper also prints one JSON summary: viewport, pixel ratio, `<title>`,
`<h1>` count (must be exactly 1) and any console or page errors per device.
Treat a non-empty `consoleErrors` or an `h1` count other than 1 as a failure.

Read the screenshots; do not report a pass from the JSON alone.

## Isolate

Two instances can run side by side. `server.mjs` takes its port from `PORT`, and
`verify.js` picks a free port on every run, so parallel agents and worktrees do
not collide. Never hard-code 4173 in a test. To stop a server you started by
hand, stop it by PID, never by image name (`node` is shared with other sessions).

## Rules that apply here

From the OSE invariants (OSE `AGENTS.md` 5 and 8; OW follows its own `CLAUDE.md`):

- Colors come from `packages/tokens` only; a raw hex in a page fails review.
- Touch targets are at least 44 px and input text at least 16 px, so check the
  phone screenshot for both.
- The display (TV) surface shows no counts at all.
- A screenshot proves nothing about the under-5 floor or cookies; those need
  the Worker tests, not this skill.
- Keep `.verify-out/` out of git; it is evidence, not source.
