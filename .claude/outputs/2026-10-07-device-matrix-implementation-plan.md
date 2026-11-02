# Five-Device Matrix Implementation Plan

> **Status: post-launch. Do not start before 2026-10-24.** PO decision, 2026-10-07: nothing is added to the audit now. This plan is parked for after launch (Sprint 17, Nov 5 to Nov 19). Before starting, re-read the "What exists today" table against `main`; the workflow and config will have moved.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name five device profiles (desktop, tablet, Android, new iPhone, old iPhone), run the layout contracts on each as its own isolated check, and keep the full browser suite on one profile only.

**Architecture:** One table of device profiles is the single source. The Playwright config builds the three new projects from it; the two existing screen projects stay as they are. Each device is one matrix leg in the existing audit workflow, so each reports as its own check. Only the existing phone leg stays required.

**Tech Stack:** Playwright 1.62.0 (`@playwright/test`), Vitest (root config, `tests/unit/**`), GitHub Actions, `js-yaml`.

**Spec:** `.claude/outputs/SPRINT-PLAN-SECURITY-AND-FE-TDD-2026-10-07.md` and `docs/ccr-archive/CCR-TEST-PLAN-SECURITY-AND-FE-2026-10-07.md`, as amended by the PO on 2026-10-07: "I do not need to execute on every device. This would be cost prohibitive. I do want a solid plan though isolating a desktop, new iphone, old iphone, android, and tablet."

## Global Constraints

- **Not every test on every device.** The full suite (20 spec files, about 360 tests, about 15 minutes) runs on `mobile-chromium` only. Every other profile runs `tests/playwright/mobile-workability.spec.ts` only.
- **The required check does not change.** `Mobile workability — PR code (375×812, blocking)` stays the only required audit leg. Do not edit `tools/ci/main-branch-protection.json`.
- **Existing project names are kept:** `mobile-chromium`, `mobile-webkit`, `desktop-chromium`, `tablet-chromium`.
- **No new `test.skip`, `continue-on-error` or orphan spec.** `scripts/ci/ci-integrity-ratchets.mjs` fails if any of those counts rises (today 22 / 30 / 364 / 97).
- **Every test is watched failing before the code that passes it is written.**
- **Run the whole root suite before each commit:** `npx vitest run tests/unit/ci tests/integration`. On Windows, tests that spawn `bash` can time out under load; re-run a timed-out file alone before treating it as a failure.
- **Commits:** no `OSE-###` in the branch name or PR title. The PR body says `Part of OSE-292`. End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Lane:** the phone audit belongs to Lane B. Claim this on OSE-292 before starting.
- **Not before launch.** No task here is started until after 2026-10-24.

## What exists today (read 2026-10-07, `main@ce3c33f5`)

| Leg     | Projects                                                                                        | Specs                                    | Minutes | Required |
| ------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------- | ------- | -------- |
| phone   | `mobile-chromium` (Desktop Chrome at 375×812, touch) and `mobile-webkit` (iPhone 13 at 375×812) | All 20 on Chromium; 4 journeys on WebKit | 15      | Yes      |
| desktop | `desktop-chromium`, 1280×800                                                                    | Contracts only                           | 2       | No       |
| tablet  | `tablet-chromium`, 820×1180                                                                     | Contracts only                           | 2       | No       |

A separate nightly job runs `playwright.config.ts` against deployed staging on iPhone SE, iPhone 14 Pro Max and iPad Air. This plan does not touch it.

## The five profiles

| Device     | Project                     | Playwright descriptor | Engine   | Viewport | Runs      |
| ---------- | --------------------------- | --------------------- | -------- | -------- | --------- |
| Desktop    | `desktop-chromium` (exists) | Desktop Chrome        | Chromium | 1280×800 | Contracts |
| Tablet     | `tablet-chromium` (exists)  | Desktop Chrome        | Chromium | 820×1180 | Contracts |
| Android    | `android` (new)             | Pixel 7               | Chromium | 412×839  | Contracts |
| New iPhone | `iphone-new` (new)          | iPhone 15             | WebKit   | 393×659  | Contracts |
| Old iPhone | `iphone-old` (new)          | iPhone 8              | WebKit   | 375×667  | Contracts |

**Cost.** Three new legs at about 2 to 5 minutes each: about 8 to 12 more runner-minutes per pull request the audit applies to, on top of 19 today. They run in parallel, so the wait stays at the phone leg's 15 minutes. To spend less, delete a leg's matrix entry; nothing else depends on it.

## Review Focus

1. **An iPhone's visible height is 659 or 667 px, not 812.** A first action at 700 px passes today's fold contract and is off-screen on both iPhones. Expected behaviour: the contract says what it measures on each device. Pinned in Task 1 (`foldLimitFor`) and Task 3.
2. **WebKit rejects the Chromium clipboard permissions the config sets for every project.** Expected: iPhone projects start. Pinned in Task 1 (the `permissions: []` assertion).
3. **A new device leg must not block merges on day one.** Expected: only the phone leg is required. Pinned in Task 4 (the branch-protection assertion).
4. **A profile's viewport drifting from the real device.** Expected: the table cannot disagree with Playwright's own descriptor. Pinned in Task 1.
5. **A sixth project quietly running the full suite.** Expected: exactly one project has no `testMatch`. Pinned in Task 2.

**Not covered by any test here, and it cannot be:** these are emulations. "Old iPhone" is a small screen and an old user-agent string on current WebKit, not an old Safari. "Android" is Chromium emulating a Pixel, not Chrome on a phone or Samsung's browser. Behaviour that depends on a real old engine needs a real device, or a paid device service. One manual pass on a physical old iPhone and a physical Android phone before 2026-10-24 is the cheap way to cover it.

---

### Task 1: The device profile table

**Files:**

- Create: `tests/playwright/helpers/device-profiles.ts`
- Test: `tests/unit/ci/device-profiles.test.ts`

**Interfaces:**

- Consumes: `devices` from `@playwright/test`.
- Produces:
  - `DEVICE_PROFILES: readonly DeviceProfile[]`
  - `CONTRACTS_SPEC: RegExp`
  - `FULL_SUITE_PROJECT: 'mobile-chromium'`
  - `REFERENCE_FOLD_PX: 812`
  - `deviceProjects(chromiumLaunch?: { executablePath?: string }): DeviceProject[]`
  - `foldLimitFor(metadata: unknown, viewportHeight: number): number`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ci/device-profiles.test.ts`:

```ts
/**
 * The five device profiles the browser tests are isolated on (PO 2026-10-07).
 *
 * Not every test runs on every device: that would cost too much. One project
 * runs the whole suite. Each device profile runs the layout contracts only.
 * This table is the single place a device is named, so the config, the
 * workflow legs and the report cannot disagree about what "old iPhone" means.
 */
import { describe, test, expect } from 'vitest';
import { devices } from '@playwright/test';
import {
  DEVICE_PROFILES,
  CONTRACTS_SPEC,
  FULL_SUITE_PROJECT,
  REFERENCE_FOLD_PX,
  deviceProjects,
  foldLimitFor,
} from '../../playwright/helpers/device-profiles';

describe('the device profile table', () => {
  test('names exactly the five devices', () => {
    expect(DEVICE_PROFILES.map((p) => p.id).sort()).toEqual([
      'android',
      'desktop',
      'iphone-new',
      'iphone-old',
      'tablet',
    ]);
  });

  test('every project name is unique and none is the full-suite project', () => {
    const names = DEVICE_PROFILES.map((p) => p.project);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain(FULL_SUITE_PROJECT);
  });

  test.each(DEVICE_PROFILES.map((p) => [p.id, p] as const))(
    '%s uses a descriptor Playwright ships, on the engine it names',
    (_id, p) => {
      const d = devices[p.descriptor];
      expect(d, `Playwright has no device called "${p.descriptor}"`).toBeDefined();
      expect(d.defaultBrowserType).toBe(p.engine);
    }
  );

  test.each(DEVICE_PROFILES.filter((p) => !p.existing).map((p) => [p.id, p] as const))(
    '%s has the viewport of the real device, not a guess',
    (_id, p) => {
      expect(p.viewport).toEqual(devices[p.descriptor].viewport);
    }
  );

  test('the two iPhones are WebKit and the Android phone is Chromium', () => {
    const engine = (id: string) => DEVICE_PROFILES.find((p) => p.id === id)!.engine;
    expect(engine('iphone-new')).toBe('webkit');
    expect(engine('iphone-old')).toBe('webkit');
    expect(engine('android')).toBe('chromium');
  });
});

describe('the projects built from the table', () => {
  const projects = deviceProjects({ executablePath: '/opt/chromium' });

  test('only the three new devices are built; the two existing screens stay hand-written', () => {
    expect(projects.map((p) => p.name)).toEqual(['android', 'iphone-new', 'iphone-old']);
  });

  test('every device project runs the layout contracts and nothing else', () => {
    for (const p of projects) expect(p.testMatch).toBe(CONTRACTS_SPEC);
    expect(CONTRACTS_SPEC.test('tests/playwright/mobile-workability.spec.ts')).toBe(true);
    expect(CONTRACTS_SPEC.test('tests/playwright/publish-loop-journey.spec.ts')).toBe(false);
  });

  test('every device project tells the spec its own viewport', () => {
    for (const p of projects) {
      const profile = DEVICE_PROFILES.find((d) => d.project === p.name)!;
      expect(p.metadata.auditViewport).toEqual(profile.viewport);
      expect(p.use.viewport).toEqual(profile.viewport);
    }
  });

  test('WebKit projects drop the Chromium clipboard permissions', () => {
    const webkit = projects.filter((p) => p.name.startsWith('iphone'));
    expect(webkit).toHaveLength(2);
    for (const p of webkit) expect(p.use.permissions).toEqual([]);
  });

  test('the Chromium project takes the custom browser path, WebKit ones do not', () => {
    const byName = Object.fromEntries(projects.map((p) => [p.name, p]));
    expect(byName.android.use.launchOptions).toEqual({ executablePath: '/opt/chromium' });
    expect(byName['iphone-new'].use.launchOptions).toBeUndefined();
  });
});

describe('where the first action must sit', () => {
  test('with no fold line set, the limit is the screen the test runs at', () => {
    expect(foldLimitFor({ auditViewport: { width: 412, height: 839 } }, 839)).toBe(839);
    expect(foldLimitFor(undefined, 812)).toBe(812);
  });

  test('a profile can hold a device to a stated line instead', () => {
    expect(foldLimitFor({ foldLimitPx: 812 }, 659)).toBe(812);
  });

  test('a fold line that is not a positive number is ignored', () => {
    expect(foldLimitFor({ foldLimitPx: 0 }, 659)).toBe(659);
    expect(foldLimitFor({ foldLimitPx: 'tall' }, 659)).toBe(659);
  });

  test('both iPhones are held to the reference line until the PO rules on OSE-292', () => {
    const projects = deviceProjects();
    const line = (name: string) => projects.find((p) => p.name === name)!.metadata.foldLimitPx;
    expect(line('iphone-new')).toBe(REFERENCE_FOLD_PX);
    expect(line('iphone-old')).toBe(REFERENCE_FOLD_PX);
    expect(line('android')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/ci/device-profiles.test.ts`
Expected: the file fails to load, because `tests/playwright/helpers/device-profiles` does not exist. That is an error, not a failing assertion, so do Step 3 first.

- [ ] **Step 3: Add an empty module so the test fails on its assertions**

Create `tests/playwright/helpers/device-profiles.ts`:

```ts
export const DEVICE_PROFILES: readonly never[] = [];
export const CONTRACTS_SPEC = /never-matches-anything/;
export const FULL_SUITE_PROJECT = 'mobile-chromium';
export const REFERENCE_FOLD_PX = 812;
export function deviceProjects(_chromiumLaunch: { executablePath?: string } = {}): never[] {
  return [];
}
export function foldLimitFor(_metadata: unknown, viewportHeight: number): number {
  return viewportHeight;
}
```

Run: `npx vitest run tests/unit/ci/device-profiles.test.ts`
Expected: FAIL. "names exactly the five devices" reports `expected [] to deeply equal [ 'android', … ]`.

- [ ] **Step 4: Write the implementation**

Replace `tests/playwright/helpers/device-profiles.ts` with:

```ts
/**
 * The five device profiles the browser tests are isolated on (PO 2026-10-07).
 *
 * Running every test on every device costs too much. So one project,
 * `mobile-chromium`, runs the whole suite, and each device here runs the
 * layout contracts only (`mobile-workability.spec.ts`).
 *
 * These are emulations: a screen size, a touch flag and a user-agent on the
 * engine Playwright ships. "Old iPhone" is not an old Safari.
 */
import { devices } from '@playwright/test';

export type DeviceId = 'desktop' | 'tablet' | 'android' | 'iphone-new' | 'iphone-old';

export interface DeviceProfile {
  id: DeviceId;
  /** The Playwright project name. Existing names are kept. */
  project: string;
  /** Shown in the workflow leg's name. */
  label: string;
  /** A key of Playwright's `devices`. */
  descriptor: string;
  engine: 'chromium' | 'webkit';
  viewport: { width: number; height: number };
  /**
   * true: the project is written out in playwright.mobile.config.ts and
   * predates this table. false: `deviceProjects()` builds it.
   */
  existing: boolean;
  /**
   * Where the first action must sit, when that is not the screen's own height.
   * See REFERENCE_FOLD_PX.
   */
  foldLimitPx?: number;
}

/** The only spec a device project runs. */
export const CONTRACTS_SPEC = /mobile-workability\.spec\.ts/;

/** The one project that runs every spec. */
export const FULL_SUITE_PROJECT = 'mobile-chromium';

/**
 * The reference phone's height. An iPhone's visible page is shorter (659 or
 * 667 px), so a first action that passes at 812 can be off-screen there. Until
 * the PO answers OSE-292 (keep an action in view, or accept one short scroll),
 * both iPhones are held to this same line: the check then catches a page
 * getting worse, and does not claim the action is visible on an iPhone.
 */
export const REFERENCE_FOLD_PX = 812;

export const DEVICE_PROFILES: readonly DeviceProfile[] = [
  {
    id: 'desktop',
    project: 'desktop-chromium',
    label: 'desktop 1280×800',
    descriptor: 'Desktop Chrome',
    engine: 'chromium',
    viewport: { width: 1280, height: 800 },
    existing: true,
  },
  {
    id: 'tablet',
    project: 'tablet-chromium',
    label: 'tablet 820×1180',
    descriptor: 'Desktop Chrome',
    engine: 'chromium',
    viewport: { width: 820, height: 1180 },
    existing: true,
  },
  {
    id: 'android',
    project: 'android',
    label: 'Android 412×839',
    descriptor: 'Pixel 7',
    engine: 'chromium',
    viewport: { width: 412, height: 839 },
    existing: false,
  },
  {
    id: 'iphone-new',
    project: 'iphone-new',
    label: 'new iPhone 393×659',
    descriptor: 'iPhone 15',
    engine: 'webkit',
    viewport: { width: 393, height: 659 },
    existing: false,
    foldLimitPx: REFERENCE_FOLD_PX,
  },
  {
    id: 'iphone-old',
    project: 'iphone-old',
    label: 'old iPhone 375×667',
    descriptor: 'iPhone 8',
    engine: 'webkit',
    viewport: { width: 375, height: 667 },
    existing: false,
    foldLimitPx: REFERENCE_FOLD_PX,
  },
];

export interface DeviceProject {
  name: string;
  testMatch: RegExp;
  metadata: { auditViewport: { width: number; height: number }; foldLimitPx?: number };
  use: Record<string, unknown> & {
    viewport: { width: number; height: number };
    permissions?: string[];
    launchOptions?: { executablePath?: string };
  };
}

/** Playwright projects for the devices this table adds. */
export function deviceProjects(chromiumLaunch: { executablePath?: string } = {}): DeviceProject[] {
  return DEVICE_PROFILES.filter((p) => !p.existing).map((p) => ({
    name: p.project,
    testMatch: CONTRACTS_SPEC,
    metadata: {
      auditViewport: p.viewport,
      ...(p.foldLimitPx ? { foldLimitPx: p.foldLimitPx } : {}),
    },
    use: {
      ...devices[p.descriptor],
      viewport: p.viewport,
      // The config grants Chromium clipboard permissions to every project;
      // WebKit refuses to start with them.
      ...(p.engine === 'webkit' ? { permissions: [] } : { launchOptions: chromiumLaunch }),
    },
  }));
}

/**
 * The y position the first action must sit above. A project may state a line
 * in its metadata; otherwise it is the height of the screen the test runs at.
 */
export function foldLimitFor(metadata: unknown, viewportHeight: number): number {
  const line = (metadata as { foldLimitPx?: unknown } | undefined)?.foldLimitPx;
  return typeof line === 'number' && line > 0 ? line : viewportHeight;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/ci/device-profiles.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 6: Prove three of the tests can fail**

For each line, make the change, run the test, see the named test fail, then undo the change.

| Change in `device-profiles.ts`                      | Test that must fail                                       |
| --------------------------------------------------- | --------------------------------------------------------- |
| `descriptor: 'iPhone 8'` → `descriptor: 'iPhone 9'` | "iphone-old uses a descriptor Playwright ships"           |
| Android `viewport` → `{ width: 400, height: 800 }`  | "android has the viewport of the real device"             |
| `{ permissions: [] }` → `{}`                        | "WebKit projects drop the Chromium clipboard permissions" |

- [ ] **Step 7: Commit**

```bash
git add tests/playwright/helpers/device-profiles.ts tests/unit/ci/device-profiles.test.ts
git commit -m "Browser tests: one table names the five device profiles"
```

---

### Task 2: Build the three new projects in the config

**Files:**

- Modify: `playwright.mobile.config.ts` (the import block at the top; the end of the `projects: [` array, after the `mobile-webkit` entry)
- Test: `tests/unit/ci/device-profiles.test.ts` (add one `describe`)

**Interfaces:**

- Consumes: `deviceProjects`, `FULL_SUITE_PROJECT` from Task 1.
- Produces: Playwright projects `android`, `iphone-new`, `iphone-old`, selectable with `--project`.

- [ ] **Step 1: Write the failing test**

Add these two imports to the import block at the top of `tests/unit/ci/device-profiles.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
```

Then add this `describe` at the end of the file:

```ts
describe('playwright.mobile.config.ts', () => {
  const source = readFileSync(
    join(__dirname, '..', '..', '..', 'playwright.mobile.config.ts'),
    'utf8'
  );
  // Comments describe projects; only code declares one.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test('builds the new device projects from the table', () => {
    expect(code).toMatch(/\.\.\.deviceProjects\(/);
  });

  test('does not also declare them by hand', () => {
    for (const name of ['android', 'iphone-new', 'iphone-old']) {
      expect(code).not.toContain(`name: '${name}'`);
    }
  });

  test('exactly one hand-written project has no testMatch: the full suite runs on one', () => {
    const blocks = code.split(/\n\s*\{\s*\n\s*name: '/).slice(1);
    const unrestricted = blocks
      .map((b) => ({ name: b.slice(0, b.indexOf("'")), block: b.split(/\n\s{4}\},/)[0] }))
      .filter((b) => !/testMatch/.test(b.block))
      .map((b) => b.name);
    expect(unrestricted).toEqual([FULL_SUITE_PROJECT]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/ci/device-profiles.test.ts`
Expected: FAIL on "builds the new device projects from the table". The third test should already pass; if it fails, the config's formatting differs from what the split expects, so print `unrestricted` and adjust the two regular expressions until it reports `['mobile-chromium']` on the unchanged config. Do not weaken it to pass.

- [ ] **Step 3: Write the implementation**

In `playwright.mobile.config.ts`, add this import beside the existing `@playwright/test` import:

```ts
import { deviceProjects } from './tests/playwright/helpers/device-profiles';
```

In the `projects: [` array, directly after the closing `},` of the `mobile-webkit` entry, add:

```ts
    // The three devices the table adds: Android, new iPhone, old iPhone. Each
    // runs the layout contracts only (PO 2026-10-07: not every test on every
    // device). See tests/playwright/helpers/device-profiles.ts.
    ...deviceProjects(
      process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}
    ),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/ci/device-profiles.test.ts`
Expected: PASS, 23 tests.

- [ ] **Step 5: Verify Playwright sees the projects and gives each only the contracts**

```bash
npx playwright test -c playwright.mobile.config.ts --list --project=android | tail -1
npx playwright test -c playwright.mobile.config.ts --list --project=iphone-old | tail -1
npx playwright test -c playwright.mobile.config.ts --list --project=mobile-chromium | tail -1
```

Expected: the first two end `in 1 file`. The third ends `in 20 files`, unchanged from before this task.

- [ ] **Step 6: Run the Android contracts for real**

```bash
npx playwright test -c playwright.mobile.config.ts --project=android
```

Expected: the run starts and reports per-surface results. Failures here are findings for Task 5, not defects in this task. If Chromium refuses to launch with the Pixel descriptor, stop and report the launch error; do not remove fields from the descriptor to get past it.

- [ ] **Step 7: Commit**

```bash
git add playwright.mobile.config.ts tests/unit/ci/device-profiles.test.ts
git commit -m "Browser tests: Android and two iPhone projects, layout contracts only"
```

---

### Task 3: The fold contract says what it measures on each device

**Files:**

- Modify: `tests/playwright/mobile-workability.spec.ts` (the `auditViewport()` helper near line 109; the fold assertion near lines 648 to 649)

**Interfaces:**

- Consumes: `foldLimitFor` from Task 1.
- Produces: nothing new. The contract "primary CTA above the fold" compares against `foldLimit()`.

The unit behaviour of `foldLimitFor` is already tested in Task 1. This task is the two-line use of it, proven in a browser run.

- [ ] **Step 1: See the contract fail on an iPhone for the reason this task removes**

Requires WebKit: `npx playwright install webkit`.

```bash
npx playwright test -c playwright.mobile.config.ts --project=iphone-old -g "primary CTA above the fold"
```

Expected: at least one surface FAILS with `viewport height 667px`. Record every failing surface and its measured top; Task 5 needs them. If nothing fails, every first action already sits above 667 px: skip to Step 4 and say so in the commit.

- [ ] **Step 2: Add the helper beside `auditViewport()`**

Add the import at the top of the spec with the other helper imports:

```ts
import { foldLimitFor } from './helpers/device-profiles';
```

Directly below the `auditViewport()` function, add:

```ts
/**
 * The line the first action must sit above. Normally the height of the screen
 * the test runs at. A device profile can state a line instead: both iPhones
 * are held to the reference phone's 812 px until the PO rules on OSE-292, so
 * the check catches a page getting worse without claiming the action is
 * visible on a 659 px screen.
 */
function foldLimit(): number {
  return foldLimitFor(test.info().project.metadata, auditViewport().height);
}
```

- [ ] **Step 3: Use it in the assertion**

In the "primary CTA above the fold" test there is one `expect` whose message contains `viewport height ${auditViewport().height}px` and whose matcher is `.toBeLessThan(auditViewport().height)`. Change both occurrences, and the wording, so the pair reads:

```ts
        `${surface.name}: primary CTA top = ${Math.round(box!.y)}px > fold line ${foldLimit()}px (screen height ${auditViewport().height}px) — CTA below the line, requires scroll-then-tap`
      ).toBeLessThan(foldLimit());
```

- [ ] **Step 4: Run it on all three engines' worth of projects**

```bash
npx playwright test -c playwright.mobile.config.ts --project=iphone-old --project=iphone-new --project=android --project=mobile-chromium -g "primary CTA above the fold"
```

Expected: `mobile-chromium` is unchanged from `main` (its line is still 812). The iPhones now fail only for a first action below 812 px. Android is judged against its own 839 px.

- [ ] **Step 5: Prove the line is really used**

Temporarily change `REFERENCE_FOLD_PX` to `100` in `device-profiles.ts` and re-run only `--project=iphone-old -g "primary CTA above the fold"`.
Expected: every surface with a first action FAILS, each message saying `fold line 100px`. Restore `812`.

- [ ] **Step 6: Run the unit suite and the ratchet**

```bash
npx vitest run tests/unit/ci tests/integration
node scripts/ci/ci-integrity-ratchets.mjs
```

Expected: no new failure; the ratchet prints `continueOnError=22 skipsUnconditional=30 skipsConditional=364 orphanSpecs=97`.

- [ ] **Step 7: Commit**

```bash
git add tests/playwright/mobile-workability.spec.ts
git commit -m "Phone audit: the fold check names its line, so an iPhone is judged against a stated one"
```

---

### Task 4: One workflow leg per new device, none of them required

**Files:**

- Modify: `.github/workflows/mobile-workability-audit.yml` (the `matrix.include` list of the `pr-code` job; the name and comment of the WebKit install step)
- Test: `tests/unit/ci/device-legs.test.js`

**Interfaces:**

- Consumes: `DEVICE_PROFILES`, `FULL_SUITE_PROJECT` from Task 1.
- Produces: three new checks named `Mobile workability — PR code (<label>)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ci/device-legs.test.js`:

```js
/**
 * Each of the five device profiles is its own leg of the audit workflow, so a
 * failure names the device. Only the phone leg is required: a new device must
 * not be able to block every pull request on its first day.
 */
const { readFileSync } = require('fs');
const { join } = require('path');
const yaml = require('js-yaml');

const ROOT = join(__dirname, '..', '..', '..');
const workflow = yaml.load(
  readFileSync(join(ROOT, '.github', 'workflows', 'mobile-workability-audit.yml'), 'utf8')
);
const job = workflow.jobs['pr-code'];
const legs = job.strategy.matrix.include;
const projectsOf = (leg) => leg.projects.split(/\s+/).filter((t) => t !== '--project');

let DEVICE_PROFILES;
let FULL_SUITE_PROJECT;
beforeAll(async () => {
  ({ DEVICE_PROFILES, FULL_SUITE_PROJECT } =
    await import('../../playwright/helpers/device-profiles.ts'));
});

describe('audit legs', () => {
  test('there is the phone leg plus one leg per device profile', () => {
    expect(legs.map((l) => l.id).sort()).toEqual(
      ['phone', ...DEVICE_PROFILES.map((p) => p.id)].sort()
    );
  });

  test('each device leg runs exactly its own project, under its own label', () => {
    for (const p of DEVICE_PROFILES) {
      const leg = legs.find((l) => l.id === p.id);
      expect(projectsOf(leg), p.id).toEqual([p.project]);
      expect(leg.label, p.id).toBe(p.label);
    }
  });

  test('only the phone leg runs the full suite', () => {
    const withFullSuite = legs.filter((l) => projectsOf(l).includes(FULL_SUITE_PROJECT));
    expect(withFullSuite.map((l) => l.id)).toEqual(['phone']);
  });

  test('WebKit is installed for the legs that need it and no others', () => {
    const needsWebkit = new Set(['phone']);
    for (const p of DEVICE_PROFILES) if (p.engine === 'webkit') needsWebkit.add(p.id);
    for (const leg of legs) expect(leg.webkit, leg.id).toBe(needsWebkit.has(leg.id));
    const install = job.steps.find((s) => /Install Playwright WebKit/.test(s.name || ''));
    expect(install.if).toContain('matrix.webkit');
  });

  test('legs do not stop each other', () => {
    expect(job.strategy['fail-fast']).toBe(false);
  });

  test('only the phone leg is a required check', () => {
    const protection = JSON.parse(
      readFileSync(join(ROOT, 'tools', 'ci', 'main-branch-protection.json'), 'utf8')
    );
    const required = JSON.stringify(protection).match(/Mobile workability — PR code \([^)]*\)/g);
    expect(required).toEqual(['Mobile workability — PR code (375×812, blocking)']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/ci/device-legs.test.js`
Expected: FAIL on "there is the phone leg plus one leg per device profile": the workflow has `desktop`, `phone`, `tablet` and the table has five devices. The last two tests pass already.

- [ ] **Step 3: Write the implementation**

In `.github/workflows/mobile-workability-audit.yml`, in the `pr-code` job, the list under `matrix: include:` ends with the `tablet` entry. Add after it, at the same indentation:

```yaml
# One leg per device profile (tests/playwright/helpers/device-profiles.ts).
# Layout contracts only, not required. To spend less, delete a leg.
- id: android
  label: Android 412×839
  projects: --project android
  webkit: false
- id: iphone-new
  label: new iPhone 393×659
  projects: --project iphone-new
  webkit: true
- id: iphone-old
  label: old iPhone 375×667
  projects: --project iphone-old
  webkit: true
```

Rename the WebKit install step and replace its comment, leaving `if`, `timeout-minutes` and `run` as they are:

```yaml
- name: Install Playwright WebKit (phone journeys and the two iPhone legs)
  if: steps.scope.outputs.run == 'true' && matrix.webkit
  timeout-minutes: 5
  # WebKit is what an iPhone runs. The phone leg needs it for four
  # journeys; the two iPhone legs need it for the layout contracts.
  run: npx playwright install --with-deps webkit
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/ci/device-legs.test.js tests/unit/ci/device-profiles.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove two of the tests can fail**

| Change in the workflow                                                 | Test that must fail                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `iphone-old` leg: `webkit: true` → `webkit: false`                     | "WebKit is installed for the legs that need it and no others"                               |
| `android` leg: `projects: --project android --project mobile-chromium` | "only the phone leg runs the full suite" and "each device leg runs exactly its own project" |

Undo both.

- [ ] **Step 6: Run the workflow gates**

```bash
npx vitest run tests/unit/ci tests/integration
node scripts/ci/ci-integrity-ratchets.mjs
node scripts/check-pr-secret-exposure.mjs
```

Expected: no new failure. `tests/integration/workflow-token-hardening.test.js` and `tests/integration/infra-consistency.test.js` read this workflow; both must still pass.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/mobile-workability-audit.yml tests/unit/ci/device-legs.test.js
git commit -m "Phone audit: one leg each for Android, new iPhone and old iPhone, none required"
```

---

### Task 5: The first baseline, written down

**Files:**

- Create: `workers/oursharedevents/docs/ops/DEVICE-MATRIX-BASELINE-2026-10.md`

**Interfaces:**

- Consumes: the three new legs from Task 4, run in CI on the pull request.
- Produces: the record the PO decides OSE-292 from, and the list of real defects.

Local fonts are narrower than CI's, so the numbers that count are CI's.

- [ ] **Step 1: Open the pull request and wait for the three new legs**

```bash
gh pr create --title "Phone audit: five device profiles, layout contracts on each" --body "Part of OSE-292."
gh pr checks --watch
```

- [ ] **Step 2: Collect every failure from the three legs**

```bash
for leg in "Android 412×839" "new iPhone 393×659" "old iPhone 375×667"; do
  link=$(gh pr checks --json name,link --jq ".[] | select(.name==\"Mobile workability — PR code ($leg)\") | .link")
  run=$(echo "$link" | sed -E 's#.*/runs/([0-9]+)/job/([0-9]+).*#\1#')
  job=$(echo "$link" | sed -E 's#.*/runs/([0-9]+)/job/([0-9]+).*#\2#')
  echo "== $leg"
  gh run view "$run" --job "$job" --log | grep -aE "Error: |[0-9]+ (passed|failed)" | sed -E 's/^[^\t]*\t[^\t]*\t[0-9TZ:.-]+ //'
done
```

- [ ] **Step 3: Write the baseline**

Create `workers/oursharedevents/docs/ops/DEVICE-MATRIX-BASELINE-2026-10.md` with this structure, one row per failure collected in Step 2. A leg with no failures gets the single row `none`.

```markdown
# Device matrix: first baseline

Read from pull request #<number>, run <run id>, on <date>.

| Device             | Surface                       | Contract                       | Measured                | Limit                   |
| ------------------ | ----------------------------- | ------------------------------ | ----------------------- | ----------------------- |
| old iPhone 375×667 | <surface name from the error> | <contract name from the error> | <number from the error> | <number from the error> |

## What each failure is

- **A fold failure on an iPhone** (first action below 812 px): goes to the PO on OSE-292. Not fixed here.
- **Anything else** (a touch target under 44 px, an input under 16 px, sideways scroll): a defect on that device. One ticket each, fixed test-first with this contract as the failing test.

## What this does not show

These are emulations. An old Safari, Chrome on a real Android phone and Samsung's browser are not covered. One manual pass on a physical old iPhone and a physical Android phone covers what this cannot.
```

- [ ] **Step 4: Decide what merges**

- All three legs green: merge.
- A leg red only on fold failures above 812 px on an iPhone: merge, with the baseline naming them. The leg is not required, and the PO decision on OSE-292 settles it.
- A leg red on anything else: fix it in this pull request if it is one small change, test first; otherwise open a ticket per defect, list them in the baseline, and merge. A red, non-required leg with a ticket is honest. A deleted assertion is not.

- [ ] **Step 5: Commit**

```bash
git add workers/oursharedevents/docs/ops/DEVICE-MATRIX-BASELINE-2026-10.md
git commit -m "Device matrix: first baseline of the Android and iPhone legs"
```

---

## Left out on purpose

- **Moving the full suite to a real device profile.** `mobile-chromium` is desktop Chrome at phone size, not a phone. Replacing it changes the required check's name, which needs a branch-protection change by the owner. Do it after the baseline shows which profile is the better home.
- **An iPad on WebKit.** The tablet leg stays Chromium at 820×1180. A real iPad is WebKit; swapping the descriptor is one line in the table, and a decision about one more WebKit install per pull request.
- **The nightly staging job.** It already runs iPhone SE, iPhone 14 Pro Max and iPad Air against deployed staging from `playwright.config.ts`.
- **Journeys on WebKit.** The four that run on `mobile-webkit` today stay there.

## Self-review

- **Spec coverage:** five named devices (Task 1); isolated, one check each (Task 4); not every test on every device (Tasks 1, 2 and 4 each pin "contracts only" and "one full-suite project"); cost stated above.
- **Placeholders:** Task 5's baseline rows come from a CI run that does not exist yet. The command that produces them and the shape they take are given in full.
- **Names:** `DEVICE_PROFILES`, `CONTRACTS_SPEC`, `FULL_SUITE_PROJECT`, `REFERENCE_FOLD_PX`, `deviceProjects`, `foldLimitFor` are spelled the same in Tasks 1 to 4. `foldLimit()` exists only in the spec (Task 3).
- **Review Focus:** items 1 to 5 each name the task that pins them. The emulation limit has no test and is stated as such.
