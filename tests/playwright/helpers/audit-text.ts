/**
 * `auditText(page)`: every piece of visible text under a floor, in one call
 * (OSE-2160 ships the helper; the gate that calls it on every surface is
 * OSE-2181, F-47).
 *
 * The phone audit checked the size of INPUT text (16 px) and the size of tap
 * targets (44 px), once, at first paint. Text that is not an input (a label, a
 * sponsor name, a status line, a helper line under a field) had no floor, and a
 * menu or wizard step that opens later was never looked at. This walks the text
 * the visitor can read, so the caller can run it after each opened menu or
 * wizard step.
 *
 * What it reads, in the browser, in one evaluate (one round trip, not one per
 * element, as getTouchTargets does for the same reason):
 *   text         every non-blank text node whose element is visible
 *   option       the label of an <option> of a visible <select>
 *   placeholder  the `::placeholder` of a visible field that has one
 *   pseudo       `::before` / `::after` generated content that shows text
 *
 * What it skips, because the visitor cannot read it: display:none, hidden,
 * visibility:hidden, an element with no box or a box under 2 px (a screen-reader
 * only clip), an element laid out off the left of the screen (a skip link), and
 * text of `script` / `style` / `noscript` / `template`.
 *
 * Not a gate on its own: it returns the findings. `assertTextFloor` throws with
 * them listed, which is what a spec calls.
 */
import type { Page } from '@playwright/test';

/** The org floor for text a visitor reads (README rule: 13 px). */
export const MIN_TEXT_PX = 13;

export interface SmallText {
  kind: 'text' | 'option' | 'placeholder' | 'pseudo';
  /** A short selector: tag, test id and the first classes. Never the page's text. */
  where: string;
  /** The first 40 characters of the text, so a person can find it. */
  sample: string;
  size: number;
}

export interface AuditTextOptions {
  /** The floor, in CSS px. Default MIN_TEXT_PX. */
  min?: number;
  /** Look only under this selector. Default the whole page. */
  root?: string;
}

export async function auditText(page: Page, opts: AuditTextOptions = {}): Promise<SmallText[]> {
  const min = opts.min ?? MIN_TEXT_PX;
  const root = opts.root ?? 'body';
  return page.evaluate(
    ({ min, root }) => {
      const out: {
        kind: 'text' | 'option' | 'placeholder' | 'pseudo';
        where: string;
        sample: string;
        size: number;
      }[] = [];
      const base = document.querySelector(root);
      if (!base) return out;
      const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD']);

      const describe = (el: Element): string => {
        const id = el.getAttribute('data-testid');
        const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 2);
        return (
          el.tagName.toLowerCase() +
          (id ? `[data-testid="${id}"]` : '') +
          (cls.length ? '.' + cls.join('.') : '')
        );
      };

      /** True when the visitor can see this element: it, and every ancestor, takes part. */
      const visible = (el: Element): boolean => {
        for (let e: Element | null = el; e; e = e.parentElement) {
          if (e.hasAttribute('hidden')) return false;
          const cs = getComputedStyle(e);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        }
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false; // no box, or a screen-reader clip
        if (r.right <= 0) return false; // laid out off the left (a skip link)
        return true;
      };

      const push = (
        kind: 'text' | 'option' | 'placeholder' | 'pseudo',
        el: Element,
        text: string,
        size: number
      ) => {
        if (size > 0 && size < min - 0.01) {
          out.push({
            kind,
            where: describe(el),
            sample: text.trim().replace(/\s+/g, ' ').slice(0, 40),
            size: Math.round(size * 100) / 100,
          });
        }
      };

      // Text nodes.
      const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.nodeValue ?? '';
        if (!text.trim()) continue;
        const el = n.parentElement;
        if (!el || SKIP.has(el.tagName)) continue;
        if (el.tagName === 'OPTION') continue; // handled with its select below
        if (!visible(el)) continue;
        push('text', el, text, parseFloat(getComputedStyle(el).fontSize) || 0);
      }

      // Options: the select is what is visible; an option has no box of its own.
      for (const opt of Array.from(base.querySelectorAll('option'))) {
        const select = opt.closest('select');
        if (!select || !visible(select)) continue;
        push('option', opt, opt.textContent ?? '', parseFloat(getComputedStyle(opt).fontSize) || 0);
      }

      // Placeholders.
      for (const f of Array.from(
        base.querySelectorAll('input[placeholder], textarea[placeholder]')
      )) {
        if (!visible(f) || !(f.getAttribute('placeholder') ?? '').trim()) continue;
        push(
          'placeholder',
          f,
          f.getAttribute('placeholder') ?? '',
          parseFloat(getComputedStyle(f, '::placeholder').fontSize) || 0
        );
      }

      // Generated content that shows text.
      for (const el of Array.from(base.querySelectorAll('*'))) {
        if (SKIP.has(el.tagName)) continue;
        for (const which of ['::before', '::after'] as const) {
          const cs = getComputedStyle(el, which);
          const content = cs.content;
          if (!content || content === 'none' || content === 'normal') continue;
          const text = content.replace(/^["']|["']$/g, '');
          if (!text.trim() || !visible(el)) continue;
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          push('pseudo', el, text, parseFloat(cs.fontSize) || 0);
        }
      }
      return out;
    },
    { min, root }
  );
}

/** Throw, listing every piece of text under the floor. `name` says which page or step. */
export async function assertTextFloor(
  page: Page,
  name: string,
  opts: AuditTextOptions = {}
): Promise<void> {
  const small = await auditText(page, opts);
  if (small.length === 0) return;
  const min = opts.min ?? MIN_TEXT_PX;
  throw new Error(
    `${name}: ${small.length} piece(s) of text under ${min} px:\n  ` +
      small.map((s) => `${s.kind} <${s.where}> ${s.size}px "${s.sample}"`).join('\n  ')
  );
}
