/**
 * The text-floor helper finds small text, and only small text (OSE-2160).
 *
 * `auditText` (helpers/audit-text.ts) ships here ahead of the gate that uses it
 * on every surface (OSE-2181, F-47). A helper nobody has watched fail would be
 * a gate that cannot fail, so each case plants the fault and expects it named,
 * and each control plants text the visitor cannot read and expects silence.
 *
 * Pages are built in the browser with setContent: no worker, no seed, nothing
 * to drift. Runs in the blocking phone audit (playwright.mobile.config.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { assertTextFloor, auditText, MIN_TEXT_PX } from './helpers/audit-text';

const page375 = { width: 375, height: 812 };

async function render(page: Page, body: string, css = ''): Promise<void> {
  await page.setViewportSize(page375);
  await page.setContent(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>` +
      `<style>body{margin:0;font:16px/1.4 sans-serif}${css}</style></head><body>${body}</body></html>`
  );
}

test.describe('auditText: finds text under the floor', () => {
  test('floor is 13 px', () => {
    expect(MIN_TEXT_PX).toBe(13);
  });

  test('control: ordinary text, 13 px and up, is clean', async ({ page }) => {
    await render(
      page,
      `<p>Sixteen pixel text</p><span style="font-size:13px">Thirteen is the floor</span>`
    );
    expect(await auditText(page)).toEqual([]);
    await assertTextFloor(page, 'control');
  });

  test('an injected 12 px span fails, and the failure names it', async ({ page }) => {
    await render(
      page,
      `<p>fine</p><span data-testid="tiny" style="font-size:12px">Small print</span>`
    );
    const found = await auditText(page);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'text', size: 12, sample: 'Small print' });
    expect(found[0].where).toContain('data-testid="tiny"');
    await expect(assertTextFloor(page, 'sponsor strip')).rejects.toThrow(
      /sponsor strip: 1 piece\(s\) of text under 13 px[\s\S]*tiny[\s\S]*12px/
    );
  });

  test('a placeholder at 12 px fails', async ({ page }) => {
    await render(
      page,
      `<input aria-label="Town" placeholder="Town or zip">`,
      `input{font-size:16px} input::placeholder{font-size:12px}`
    );
    const found = await auditText(page);
    expect(found.map((f) => f.kind)).toEqual(['placeholder']);
    expect(found[0].size).toBe(12);
  });

  test('generated content at 11 px fails', async ({ page }) => {
    await render(page, `<p class="note">Note</p>`, `.note::after{content:" (new)";font-size:11px}`);
    const found = await auditText(page);
    expect(found.map((f) => f.kind)).toEqual(['pseudo']);
    expect(found[0].size).toBe(11);
  });

  test('an option of a visible select fails', async ({ page }) => {
    await render(
      page,
      `<select aria-label="Pick"><option>One</option></select>`,
      `select{font-size:16px} option{font-size:12px}`
    );
    const found = await auditText(page);
    expect(found.map((f) => f.kind)).toEqual(['option']);
  });

  test('text that opens later is found when the caller looks again', async ({ page }) => {
    await render(
      page,
      `<button id="open">Menu</button><div id="menu" hidden><span style="font-size:11px">Language</span></div>`
    );
    expect(await auditText(page), 'closed menu: nothing to read').toEqual([]);
    await page.evaluate(() => document.getElementById('menu')!.removeAttribute('hidden'));
    expect((await auditText(page)).map((f) => f.sample)).toEqual(['Language']);
  });

  test('root narrows the look', async ({ page }) => {
    await render(
      page,
      `<div id="a"><span style="font-size:11px">in a</span></div><div id="b"><span style="font-size:11px">in b</span></div>`
    );
    expect((await auditText(page, { root: '#a' })).map((f) => f.sample)).toEqual(['in a']);
  });
});

test.describe('auditText: ignores what the visitor cannot read', () => {
  test('display:none, hidden, visibility:hidden, a screen-reader clip and a skip link', async ({
    page,
  }) => {
    await render(
      page,
      [
        `<span style="display:none;font-size:9px">gone</span>`,
        `<span hidden style="font-size:9px">hidden</span>`,
        `<span style="visibility:hidden;font-size:9px">invisible</span>`,
        `<span class="sr" style="font-size:9px">for a screen reader</span>`,
        `<a class="skip" href="#x" style="font-size:9px">Skip</a>`,
        `<template><span style="font-size:9px">inert</span></template>`,
      ].join(''),
      `.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}` +
        `.skip{position:absolute;left:-9999px}`
    );
    expect(await auditText(page)).toEqual([]);
  });

  test('a parent that is hidden hides its small child', async ({ page }) => {
    await render(page, `<div style="display:none"><span style="font-size:9px">inside</span></div>`);
    expect(await auditText(page)).toEqual([]);
  });
});
