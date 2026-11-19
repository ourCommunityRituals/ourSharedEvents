# Runbook: regenerating the golden renders

Part of OSE-2160. This is the one procedure. A story that changes a page's markup or text follows it; it does not invent its own.

## What a golden is

A golden is a saved copy of what a page renders, kept as text in `workers/oursharedevents/tests/__golden__/`. A spec renders the page and compares it with the file. Three folders, three specs:

| Folder                             | Spec                                         | Pages                                             |
| ---------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| `tests/__golden__/list-landing/`   | `tests/list-landing-language-golden.spec.ts` | `/events` and the landing, English and Spanish    |
| `tests/__golden__/language-layer/` | `tests/language-layer-golden.spec.ts`        | the event page before, during and after the event |
| `tests/__golden__/form-pages/`     | `tests/form-pages-language-golden.spec.ts`   | every form screen in every language               |

All three run in the node project (`vitest.node-specs.mjs`). They use `toMatchFileSnapshot`, so Vitest's update flag rewrites the files.

## The command

Run from `workers/oursharedevents/`. Name one spec at a time:

```powershell
npx vitest run --config vitest.node.config.mts tests/list-landing-language-golden.spec.ts -u
```

Swap in the spec you need. Never run `-u` over the whole suite: it would accept every other red test as a new golden.

## The steps

1. Change the source (a template, a string, a renderer). Do not touch a golden yet.
2. Run the spec without `-u`. It must go red on the golden you expect, and only on those. A red on a golden you did not mean to change is a defect in your change, not a golden to regenerate.
3. Run the same spec with `-u`.
4. Read the diff: `git diff -- workers/oursharedevents/tests/__golden__`. Every changed line must be one the story set out to change. If a line surprises you, stop and find out why before you commit.
5. Run the spec again without `-u`. It must be green.
6. Commit the golden files **on their own**, in a commit that holds no source change. The message names the story and says what changed in the render, for example `Goldens: landing doors read "Start an event" (Part of OSE-nnnn)`. Keep closing words (close, fix, resolve, complete, implement) away from the id.
7. Source change first, golden commit second. A reviewer can then read the golden diff alone and confirm it is only what the source change should produce.

## Why a commit of its own

A golden diff is large and mostly the same line over and over. Mixed with a source change it hides the one line that should not have moved. On its own it can be read in a minute.

## Windows

On a Windows checkout `-u` writes line feeds and Git may show the whole file as changed (`LF will be replaced by CRLF`). That is line-ending noise, not a change. Check with `git diff --ignore-space-at-eol`. CI runs on Linux and compares the same text.

## Born red

The procedure was run on 2026-11-19 with a fault: one character appended to `landing-map-leads.en.golden.txt`. Without `-u` the spec failed on `landing, map-leads, en` and passed the other 63 cases. With `-u` the file was rewritten to the render and the run was green: 64 passed.
