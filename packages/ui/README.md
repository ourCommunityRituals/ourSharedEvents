# @ocr/ui

One design language for the whole fleet. Canonical tokens, a single shared
stylesheet, and HTML partials that both Cloudflare Workers (OSE and WKRP) serve.

**Why this exists:** the nine WKRP templates each carried their own near-identical
`:root` block and full component CSS — **51,313 characters of inline styling, 9/9
templates duplicated.** OSE inlined a _different_ look inside a 3,306-line
`pages.ts`. Every UX fix had to be made many times, so it wasn't made. This package
collapses all of it to **one 4KB stylesheet (~92% less CSS to maintain)** plus a
small set of partials — and adds the one component the fleet was missing: a proper
empty / access-denied state that always offers a next step.

## Install (workspace)

Already a pnpm monorepo (`packages/flags` lives here too). Add:

```jsonc
// package.json of a consuming worker
"dependencies": { "@ocr/ui": "workspace:*" }
```

## Adopt — the low-risk path (do this first)

Serve the shared sheet from each worker, then swap every inline `<style>` for a link.

```ts
// router: add one route
import { serveCss } from '@ocr/ui';
if (url.pathname === '/ui.css') return serveCss();
```

```html
<!-- every template: delete the <style>…</style> block, add: -->
<link rel="stylesheet" href="/ui.css" />
```

That single change clears all nine WKRP `local-root-tokens` findings and cuts
`dashboard.html` from 333 → 254 lines (−24%) with zero visual change.

## Adopt — partials (incremental)

Replace bespoke markup with shared partials where it helps most — starting with
the dead ends:

```ts
import { accessDenied, emptyState, page, bottomNav } from '@ocr/ui';

// was: bare "access denied" div
return html(accessDenied({ what: 'The DJ dashboard' }));

// "no data yet" screens
emptyState({ icon: '📀', title: 'No sets yet',
  message: 'Start your first set and it shows up here.',
  action: { label: 'Start a set', href: '/live' } });

// whole-page shell (OSE can build pages this way instead of string constants)
page({ title: 'Dashboard', live: true, body, nav: [...] });
```

## Keep it slim — the contract

`checkTemplate()` (see `src/contract.ts`) is a CI guard in the spirit of the
brain contracts: it fails the build if a template re-declares `:root` or
re-inlines a large `<style>`. Wire it into `docs-ci` / a workflow so the
duplication can't creep back.

```bash
pnpm --filter @ocr/ui scan ./src/templates   # audit a folder
```

## Test

```bash
pnpm --filter @ocr/ui test         # unit + a11y + contract (node:test, zero browser)
BASE_URL=<preview-url> npx playwright test e2e/   # end-to-end across both apps
```

The e2e spec asserts the _shared_ selectors — so one spec validates the design
system on every surface of both workers. That's the payoff of extraction: the UI
became testable fleet-wide instead of page-by-page.

## What's in the box

| File              | Purpose                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `src/tokens.ts`   | Canonical tokens; drift (two reds, missing radii) resolved into decisions                |
| `src/styles.ts`   | Deduplicated component CSS + new `.empty-state`                                          |
| `src/css.ts`      | Combined sheet, `serveCss()` route helper, `styleTag()`                                  |
| `src/partials.ts` | `page`, `header`, `bottomNav`, `button`, `card`, `loading`, `emptyState`, `accessDenied` |
| `src/contract.ts` | `checkTemplate()` drift guard for CI                                                     |
| `src/esc.ts`      | HTML/URL escaping (all partials use it)                                                  |
| `src/contrast.ts` | WCAG contrast, used by the a11y tests                                                    |
| `tests/`          | 17 tests: token invariants, contrast AA/AAA, XSS escaping, no-dead-end                   |
| `e2e/`            | Playwright spec against shared selectors                                                 |
