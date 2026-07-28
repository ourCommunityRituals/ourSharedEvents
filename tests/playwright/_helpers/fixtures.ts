/**
 * Playwright fixture extension — injects typed page objects so specs
 * receive them as named arguments instead of constructing them inline.
 *
 * Pattern: test.extend() per Playwright best practice. Each fixture
 * owns its own setup/teardown and is scoped to the test ('test' scope
 * is default, meaning a fresh instance per test case).
 *
 * Usage:
 *   import { test, expect } from './_helpers/fixtures';
 *   test('...', async ({ uiPreview }) => { ... });
 *
 * Adding a new page object:
 *   1. Create a POM class in ./_helpers/<name>.page.ts
 *   2. Add a fixture entry here (type + implementation)
 *   3. Import from fixtures in specs — no other changes needed
 */

import { test as base } from '@playwright/test';
import { UiPreviewPage } from './ui-preview.page';

type OcrFixtures = {
  /** Page Object for GET /ui-preview — @ocr/ui component showcase. */
  uiPreview: UiPreviewPage;
};

export const test = base.extend<OcrFixtures>({
  uiPreview: async ({ page }, use) => {
    await use(new UiPreviewPage(page));
  },
});

export { expect } from '@playwright/test';
