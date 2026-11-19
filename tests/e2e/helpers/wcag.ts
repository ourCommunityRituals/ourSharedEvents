/**
 * WCAG 2.0, 2.1 and 2.2 (levels A and AA) checks for a page open in Playwright
 * (owner, 2026-11-18: "a full accessibility audit … WCAG 2.0 and 2.2", then
 * "dedicated to the WCAG 2.0 and 2.2 Accessibility standards … for on call and
 * future mandatory execution").
 *
 * Two kinds of check:
 *   - axe-core with every WCAG A/AA tag (2.0, 2.1, 2.2). Any violation, of any
 *     impact, fails.
 *   - Measured checks for success criteria a rule engine cannot decide:
 *       1.4.10 Reflow, 1.4.12 Text Spacing, 2.4.7 Focus Visible,
 *       2.4.11 Focus Not Obscured (Minimum), 2.5.8 Target Size (Minimum),
 *       3.1.1 Language of Page (a real tag, not only present).
 *
 * Each check returns the list of problems it found; an empty list is a pass.
 * The mutation tests in tests/e2e/2-pages/wcag-map.component.spec.ts inject a
 * fault for each one and require it to be reported, so no check here can pass
 * by being unable to fail.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** Every WCAG A and AA tag axe-core 4.x carries, 2.0 to 2.2. */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

/** axe-core with every WCAG A/AA rule: one line per violation, any impact. */
/**
 * Waits for running CSS transitions to end. `.btn` fades its opacity over
 * 0.2 s when a button turns from disabled to enabled (the zoom Reset button
 * after +), and axe measures colour mid-fade: WebKit failed color-contrast on
 * `button[data-z="reset"]` on main run 44423687790 for that reason alone.
 * Only transitions are awaited; a looping animation never finishes.
 */
export async function settleTransitions(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => typeof CSSTransition !== 'undefined' && a instanceof CSSTransition)
        .map((a) => a.finished.catch(() => undefined))
    )
  );
}

export async function axeWcag(page: Page, include?: string): Promise<string[]> {
  await settleTransitions(page);
  let b = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) b = b.include(include);
  const r = await b.analyze();
  return r.violations.map(
    (v) =>
      `${v.id} (${v.impact}; ${v.tags.filter((t) => /^wcag\d/.test(t)).join(' ')}): ${v.nodes
        .map((n) => n.target.join(' '))
        .slice(0, 5)
        .join(' | ')}`
  );
}

/**
 * 1.4.10 Reflow: at 320 CSS px nothing scrolls sideways. Call it on a page
 * whose viewport is 320 px wide (400% of a 1280 px screen).
 */
export async function reflow(page: Page): Promise<string[]> {
  const r = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    v: window.innerWidth,
  }));
  return r.w > r.v + 1 ? [`page is ${r.w} px wide in a ${r.v} px window`] : [];
}

/**
 * 1.4.12 Text Spacing: with the spacing the criterion names applied, no text is
 * cut off by its box and nothing scrolls sideways.
 */
export async function textSpacing(page: Page): Promise<string[]> {
  await page.addStyleTag({
    content:
      '*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}',
  });
  return page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('scrolls sideways');
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (el.closest('svg') || el.classList.contains('sr-only')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || el.clientWidth === 0) continue;
      const clipX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      const clipY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      if (!el.textContent?.trim()) continue;
      if (
        (clipX && el.scrollWidth > el.clientWidth + 1) ||
        (clipY && el.scrollHeight > el.clientHeight + 1)
      ) {
        out.push(
          `text cut off: ${el.dataset.testid ?? el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 30)}"`
        );
      }
    }
    return out;
  });
}

/**
 * 2.5.8 Target Size (Minimum): every target is at least 24 by 24 CSS px, or a
 * 24 px circle on its centre meets no other target (the spacing exception), or
 * it is a link inside a sentence (the inline exception). A hidden input whose
 * label is the target is judged by its label.
 */
export async function targetSize(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sel =
      'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[tabindex]:not([tabindex="-1"])';
    type T = { el: Element; r: DOMRect; name: string };
    const shown = (el: Element) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return (
        cs.display !== 'none' &&
        cs.visibility !== 'hidden' &&
        r.width > 0 &&
        r.height > 0 &&
        cs.pointerEvents !== 'none'
      );
    };
    const all: T[] = [];
    for (const el of document.querySelectorAll(sel)) {
      let t: Element = el;
      if (
        el instanceof HTMLInputElement &&
        (el.type === 'radio' || el.type === 'checkbox') &&
        el.id
      ) {
        const lab = document.querySelector(`label[for="${el.id}"]`);
        if (lab) t = lab;
      }
      if (!shown(t)) continue;
      const name =
        (t as HTMLElement).dataset?.testid ??
        `${t.tagName.toLowerCase()} "${(t.textContent ?? '').trim().slice(0, 25)}"`;
      all.push({ el: t, r: t.getBoundingClientRect(), name });
    }
    const inline = (el: Element) => {
      if (el.tagName !== 'A') return false;
      const block = el.parentElement;
      if (!block) return false;
      const own = (el.textContent ?? '').trim();
      const around = (block.textContent ?? '').replace(own, '').trim();
      return getComputedStyle(el).display === 'inline' && around.length > 0;
    };
    const out: string[] = [];
    for (const t of all) {
      if (t.r.width >= 24 && t.r.height >= 24) continue;
      if (inline(t.el)) continue;
      const cx = t.r.left + t.r.width / 2,
        cy = t.r.top + t.r.height / 2;
      const hit = all.find((o) => {
        if (o === t || o.el.contains(t.el) || t.el.contains(o.el)) return false;
        const nx = Math.max(o.r.left, Math.min(cx, o.r.right));
        const ny = Math.max(o.r.top, Math.min(cy, o.r.bottom));
        return Math.hypot(nx - cx, ny - cy) < 12;
      });
      if (hit)
        out.push(
          `${t.name} is ${Math.round(t.r.width)}x${Math.round(t.r.height)} px and within 12 px of ${hit.name}`
        );
    }
    return out;
  });
}

/**
 * 2.4.7 Focus Visible and 2.4.11 Focus Not Obscured (Minimum): Tab through the
 * page; each stop (or, for a hidden radio or checkbox, its label) shows an
 * outline or a ring and is not wholly covered by another element. Returns the
 * problems and the stops walked.
 */
export async function focusWalk(
  page: Page,
  max = 120
): Promise<{ problems: string[]; stops: string[] }> {
  const problems: string[] = [];
  const stops: string[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      let shown: HTMLElement = el;
      if (
        el instanceof HTMLInputElement &&
        (el.type === 'radio' || el.type === 'checkbox') &&
        el.id
      ) {
        const lab = document.querySelector<HTMLElement>(`label[for="${el.id}"]`);
        if (lab) shown = lab;
      }
      shown.scrollIntoView({ block: 'nearest' });
      const cs = getComputedStyle(shown);
      const ring =
        (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
        (cs.boxShadow !== 'none' && cs.boxShadow !== '');
      const r = shown.getBoundingClientRect();
      const visible =
        r.width > 0 && r.height > 0 && getComputedStyle(shown).visibility !== 'hidden';
      const pts = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 2, r.top + 2],
        [r.right - 2, r.bottom - 2],
      ];
      const covered = pts.every(([x, y]) => {
        const top = document.elementFromPoint(
          Math.max(0, Math.min(x!, innerWidth - 1)),
          Math.max(0, Math.min(y!, innerHeight - 1))
        );
        return !(
          top &&
          (top === shown || shown.contains(top) || top.contains(shown) || top === el)
        );
      });
      return {
        id:
          shown.dataset.testid ??
          `${shown.tagName.toLowerCase()} "${(shown.textContent ?? '').trim().slice(0, 25)}"`,
        ring,
        visible,
        covered,
      };
    });
    if (!s) break;
    if (stops.length && s.id === stops[0] && i > 3) break;
    stops.push(s.id);
    if (!s.visible) problems.push(`focus on something not on screen: ${s.id}`);
    else if (!s.ring) problems.push(`no visible focus: ${s.id}`);
    if (s.visible && s.covered) problems.push(`focus hidden under another element: ${s.id}`);
  }
  return { problems, stops };
}

/** 3.1.1 Language of Page: <html lang> is a real language tag. */
export async function pageLanguage(page: Page): Promise<string[]> {
  const lang = await page.evaluate(() => document.documentElement.getAttribute('lang') ?? '');
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang) ? [] : [`html lang is "${lang}"`];
}
