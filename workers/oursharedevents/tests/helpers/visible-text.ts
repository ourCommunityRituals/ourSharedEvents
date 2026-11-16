/**
 * Reading a served page the way a reader does, with the HTML parser the Worker
 * runtime ships (HTMLRewriter), never with a pattern over the markup. Workers
 * pool only: HTMLRewriter is a runtime global there.
 *
 * Shared by the public stall pages' specs (booth-page.spec.ts,
 * booth-list-page.spec.ts).
 */

/**
 * The text a reader sees: every text node of the page except what sits inside
 * a script or a style element, joined with spaces.
 */
export async function visibleText(html: string): Promise<string> {
  const parts: string[] = [];
  let hidden = 0;
  await new HTMLRewriter()
    .on('script, style', {
      element(el) {
        hidden += 1;
        el.onEndTag(() => {
          hidden -= 1;
        });
      },
    })
    .onDocument({
      text(chunk) {
        if (hidden === 0) parts.push(chunk.text);
      },
    })
    .transform(new Response(html))
    .text();
  return parts.join(' ');
}

/**
 * The text of every element that matches `selector`, in document order, each
 * trimmed. Text is as served (an entity stays an entity), so two pages compare
 * equal only when they say the same thing in the same bytes.
 */
export async function textsOf(html: string, selector: string): Promise<string[]> {
  const out: string[] = [];
  const open: string[][] = [];
  await new HTMLRewriter()
    .on(selector, {
      element(el) {
        const buf: string[] = [];
        open.push(buf);
        el.onEndTag(() => {
          open.pop();
          out.push(buf.join('').trim());
        });
      },
    })
    .onDocument({
      text(chunk) {
        for (const buf of open) buf.push(chunk.text);
      },
    })
    .transform(new Response(html))
    .text();
  return out;
}

/** The value of `attr` on every element that matches `selector`, in document order. */
export async function attrsOf(html: string, selector: string, attr: string): Promise<string[]> {
  const out: string[] = [];
  await new HTMLRewriter()
    .on(selector, {
      element(el) {
        const value = el.getAttribute(attr);
        if (value !== null) out.push(value);
      },
    })
    .transform(new Response(html))
    .text();
  return out;
}
