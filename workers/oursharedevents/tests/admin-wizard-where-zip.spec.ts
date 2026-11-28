/**
 * W1 (OSE-2095) and OSE-1717: the wizard's Where step asks for the place name,
 * the street address and the ZIP code, each in its own box.
 *
 *   1. Three boxes for in person and both; none for online.
 *   2. Create sends location = name, where_address = address, zip_code = ZIP.
 *   3. The ZIP fills itself in from an address that ends in one or a town with
 *      exactly one ZIP (the server's rule: the zip-suggest answer here is the
 *      real lib/event-zip.ts suggestZip). A ZIP the organizer typed is kept.
 *   4. A ZIP that is not one stops Next and says why; an empty one is fine.
 *   5. The not-found note no longer asks for the town in the place name.
 *   6. The review row shows the address and the ZIP; the review-and-edit save
 *      sends both.
 *   7. The advanced form has a ZIP box and sends it.
 *
 * Runs the wizard's real script from the admin.html Text import in jsdom.
 *
 * @born-red admin-wizard-where-zip | method: (1) `body.zip_code` not set in the
 *   create, (2) the fill-in overwriting a typed ZIP (touched check removed), (3)
 *   the step-1 ZIP check removed, (4) the old not-found sentence put back, (5)
 *   saveEdit without where_address; each turned a test red | date: 2026-11-16
 */

import { describe, test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import ADMIN_HTML from '../src/templates/admin.html';
import { suggestZip } from '../src/lib/event-zip';

function scriptWith(doc: Document, marker: string): string {
  const el = Array.from(doc.querySelectorAll('script')).find((s) =>
    (s.textContent || '').includes(marker)
  );
  expect(el, `script containing ${marker}`).toBeDefined();
  return el!.textContent || '';
}

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };

function mount(opts: { created?: Record<string, unknown> } = {}) {
  const dom = new JSDOM(ADMIN_HTML, {
    runScripts: 'outside-only',
    url: 'https://admin.test/admin',
  });
  const w = dom.window as unknown as Window & { eval(s: string): unknown } & Record<
      string,
      unknown
    >;
  const doc = w.document;
  (w as unknown as { Element: typeof Element }).Element.prototype.scrollIntoView = () => {};
  const calls: Call[] = [];
  const reply = (status: number, b: unknown) => ({
    ok: status < 400,
    status,
    json: async () => b,
    text: async () => JSON.stringify(b),
  });
  w.fetch = (async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), method, body });
    if (String(url).endsWith('/admin/zip-suggest')) {
      return reply(200, { ok: true, ...suggestZip(body?.address, body?.place) });
    }
    if (method === 'POST' && String(url).endsWith('/admin/events')) {
      return reply(201, { ok: true, id: 'evt_new', warnings: [], ...(opts.created ?? {}) });
    }
    return reply(200, { ok: true });
  }) as unknown as typeof fetch;
  w.eval(scriptWith(doc, 'function goNext()'));
  try {
    w.eval(scriptWith(doc, 'oseWizardPreview: the page you are making'));
  } catch {
    /* no preview script */
  }
  const $ = <T extends HTMLElement>(id: string) => doc.querySelector<T>(`[data-testid="${id}"]`)!;
  $('admin-path-wizard').click();
  const fire = (el: Element, type: string) =>
    el.dispatchEvent(new w.Event(type, { bubbles: true }));
  const type = (id: string, value: string) => {
    const el = $<HTMLInputElement>(id);
    el.value = value;
    fire(el, 'input');
  };
  /** Type, then leave the box (a change), as a person does. */
  const typeAndLeave = (id: string, value: string) => {
    type(id, value);
    fire($(id), 'change');
  };
  const next = () => $('wizard-next-btn').click();
  const onStep = (n: number) =>
    doc.getElementById(`wizard-step-${n}`)!.classList.contains('active');
  const flush = async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const txt = (id: string) => ($(id)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const created = () =>
    calls.find((c) => c.method === 'POST' && c.url.endsWith('/admin/events'))?.body;
  return { w, doc, $, calls, fire, type, typeAndLeave, next, onStep, flush, txt, created };
}

type M = ReturnType<typeof mount>;

function isoDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function createFrom(m: M) {
  m.type('wizard-event-name', 'Bocce Night');
  m.type('wizard-event-date', isoDaysFromNow(14));
  m.next();
  expect(m.onStep(2), m.txt('wizard-msg')).toBe(true);
  m.$('wizard-save-draft-btn').click(); // Save draft
  await m.flush();
  expect(m.onStep(3), 'created, on the share screen').toBe(true);
}

const choose = (m: M, value: string) => {
  const el = m.$<HTMLSelectElement>('wizard-event-mode');
  el.value = value;
  m.fire(el, 'change');
};

describe('W1: the Where step has three boxes', () => {
  test('place name (required), street address and ZIP (optional), each labelled', () => {
    const { $, doc } = mount();
    const label = (id: string) =>
      doc
        .querySelector(`label[for="${$(id).id}"]`)
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();
    expect(label('wizard-event-venue')).toBe('Place name *');
    expect(label('wizard-event-address')).toBe('Street address (optional)');
    expect(label('wizard-event-zip')).toBe('ZIP code');
    expect($<HTMLInputElement>('wizard-event-venue').required).toBe(true);
    expect($<HTMLInputElement>('wizard-event-zip').required).toBe(false);
    expect($('wizard-event-zip').getAttribute('inputmode')).toBe('numeric');
    // The name's example no longer carries a town (OSE-1717).
    expect($('wizard-event-venue').getAttribute('placeholder')).not.toContain(',');
    expect($('wizard-event-zip').getAttribute('aria-describedby')).toBe('wizard-event-zip-note');
  });

  test('online hides the three and sends none; both keeps them', async () => {
    const m = mount();
    m.type('wizard-event-venue', 'Eagles Hall');
    m.type('wizard-event-address', '1 Main St, Blue Island, IL 60406');
    m.type('wizard-event-zip', '60406');
    choose(m, 'online');
    for (const id of ['venue', 'address', 'zip']) {
      expect(m.doc.getElementById(`wizard-event-${id}-field`)!.hidden, id).toBe(true);
      expect(m.$<HTMLInputElement>(`wizard-event-${id}`).value, id).toBe('');
    }
    await createFrom(m);
    const body = m.created()!;
    expect(body.attendance_mode).toBe('online');
    expect(body).not.toHaveProperty('location');
    expect(body).not.toHaveProperty('where_address');
    expect(body).not.toHaveProperty('zip_code');
    const b = mount();
    choose(b, 'both');
    expect(b.doc.getElementById('wizard-event-zip-field')!.hidden).toBe(false);
  });
});

describe('W1: create sends the name, the address and the ZIP apart', () => {
  test('location = name, where_address = address, zip_code = ZIP', async () => {
    const m = mount();
    m.type('wizard-event-venue', 'Eagles Hall');
    m.type('wizard-event-address', '13126 S Western Ave, Blue Island, IL 60406');
    m.type('wizard-event-zip', '60406');
    await createFrom(m);
    const body = m.created()!;
    expect(body.location).toBe('Eagles Hall');
    expect(body.where_address).toBe('13126 S Western Ave, Blue Island, IL 60406');
    expect(body.zip_code).toBe('60406');
  });

  test('ZIP+4 is sent as its five digits; an empty ZIP is not sent', async () => {
    const a = mount();
    a.type('wizard-event-venue', 'Eagles Hall');
    a.type('wizard-event-zip', ' 60406-1234 ');
    await createFrom(a);
    expect(a.created()!.zip_code).toBe('60406');
    const b = mount();
    b.type('wizard-event-venue', 'Eagles Hall');
    await createFrom(b);
    expect(b.created()!).not.toHaveProperty('zip_code');
    expect(b.created()!).not.toHaveProperty('where_address');
  });
});

describe('W1: the ZIP fills itself in, and a typed one is kept', () => {
  test('from an address that ends in a ZIP', async () => {
    const m = mount();
    m.typeAndLeave('wizard-event-address', '1 Main St, Blue Island, IL 60406-1234');
    await m.flush();
    expect(m.$<HTMLInputElement>('wizard-event-zip').value).toBe('60406');
    // Asked once, by POST, with the address in the body (never the URL).
    const asks = m.calls.filter((c) => c.url.endsWith('/admin/zip-suggest'));
    expect(asks).toHaveLength(1);
    expect(asks[0].method).toBe('POST');
    expect(asks[0].url).not.toContain('Main');
  });

  test('from a town with exactly one ZIP, in the address or the name', async () => {
    const a = mount();
    a.typeAndLeave('wizard-event-address', '3200 W 95th St, Evergreen Park, IL');
    await a.flush();
    expect(a.$<HTMLInputElement>('wizard-event-zip').value).toBe('60805');
    const b = mount();
    b.typeAndLeave('wizard-event-venue', 'Eagles Hall, Evergreen Park, IL');
    await b.flush();
    expect(b.$<HTMLInputElement>('wizard-event-zip').value).toBe('60805');
  });

  test('a town with many ZIPs is not filled in', async () => {
    const m = mount();
    m.typeAndLeave('wizard-event-address', '1 Main St, Blue Island, IL');
    await m.flush();
    expect(m.$<HTMLInputElement>('wizard-event-zip').value).toBe('');
  });

  test('the box and the address disagree: the typed box wins, on screen and in the create', async () => {
    const m = mount();
    m.type('wizard-event-venue', 'Eagles Hall');
    m.type('wizard-event-zip', '60643');
    m.typeAndLeave('wizard-event-address', '1 Main St, Blue Island, IL 60406');
    await m.flush();
    expect(m.$<HTMLInputElement>('wizard-event-zip').value).toBe('60643');
    await createFrom(m);
    expect(m.created()!.zip_code).toBe('60643');
  });

  test('a filled-in ZIP follows the address when it changes', async () => {
    const m = mount();
    m.typeAndLeave('wizard-event-address', '1 Main St, Blue Island, IL 60406');
    await m.flush();
    expect(m.$<HTMLInputElement>('wizard-event-zip').value).toBe('60406');
    m.typeAndLeave('wizard-event-address', '1 Main St, Blue Island, IL');
    await m.flush();
    expect(m.$<HTMLInputElement>('wizard-event-zip').value).toBe('');
  });
});

describe('W1: fat finger in the ZIP box', () => {
  for (const bad of ['6040', '6O406', '604 06', '60406 S Pulaski', 'abcde']) {
    test(`"${bad}" stops Next, says why, marks the box`, () => {
      const m = mount();
      m.type('wizard-event-name', 'Bocce Night');
      m.type('wizard-event-venue', 'Eagles Hall');
      m.type('wizard-event-zip', bad);
      m.next();
      expect(m.onStep(1)).toBe(true);
      expect(m.txt('wizard-msg')).toContain('A ZIP code is five digits');
      expect(m.$('wizard-event-zip').getAttribute('aria-invalid')).toBe('true');
      expect(m.doc.activeElement).toBe(m.$('wizard-event-zip'));
      // Mended, it goes on.
      m.type('wizard-event-zip', '60406');
      expect(m.$('wizard-event-zip').hasAttribute('aria-invalid')).toBe(false);
      m.next();
      expect(m.onStep(2)).toBe(true);
    });
  }
});

describe('W1: the notes after create', () => {
  test('not found on the map: no request to put the town in the name', async () => {
    const withZip = mount({ created: { place: 'not_found' } });
    withZip.type('wizard-event-venue', 'Eagles Hall');
    withZip.type('wizard-event-zip', '60406');
    await createFrom(withZip);
    const note = withZip.txt('wizard-map-note');
    expect(note).toContain('ZIP 60406');
    expect(note).not.toMatch(/add the town/i);
    const without = mount({ created: { place: 'not_found' } });
    without.type('wizard-event-venue', 'Eagles Hall');
    await createFrom(without);
    expect(without.txt('wizard-map-note')).toContain('Add its ZIP code');
    expect(without.txt('wizard-map-note')).not.toMatch(/add the town/i);
  });

  test('a ZIP the list lacks: the server note is shown', async () => {
    const m = mount({
      created: {
        warnings: [
          {
            code: 'ZIP_NOT_IN_TABLE',
            message: 'ZIP 60454 was saved, but it is not in the zip-area table.',
          },
        ],
      },
    });
    m.type('wizard-event-venue', 'Post office');
    m.type('wizard-event-zip', '60454');
    await createFrom(m);
    expect(m.txt('wizard-map-note')).toContain('ZIP 60454 was saved');
  });
});

describe('W1: review and edit', () => {
  test('the Where row shows the address and the ZIP; the edit save sends both', async () => {
    const m = mount();
    m.type('wizard-event-venue', 'Eagles Hall');
    m.type('wizard-event-address', '1 Main St, Blue Island, IL 60406');
    m.type('wizard-event-zip', '60406');
    await createFrom(m);
    // The review is on the share screen, folded.
    expect(m.txt('wizard-review-row-where')).toContain(
      'Eagles Hall, 1 Main St, Blue Island, IL 60406 · ZIP 60406'
    );
    m.$('wizard-review-change-where').click();
    m.type('wizard-event-address', '');
    m.type('wizard-event-zip', '60643');
    m.$('wizard-save-edit-btn').click();
    await m.flush();
    const put = m.calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toMatchObject({
      location: 'Eagles Hall',
      where_address: null,
      zip_code: '60643',
    });
  });

  test('a ZIP that is not one stops the edit save', async () => {
    const m = mount();
    m.type('wizard-event-venue', 'Eagles Hall');
    await createFrom(m);
    m.$('wizard-review-change-where').click();
    m.type('wizard-event-zip', '604');
    m.$('wizard-save-edit-btn').click();
    await m.flush();
    expect(m.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(m.txt('wizard-msg')).toContain('A ZIP code is five digits');
  });
});

describe('W1: the advanced form has a ZIP box', () => {
  test('labelled, numeric, optional, and switched off for online', () => {
    const { $, doc, w } = mount();
    const zip = $<HTMLInputElement>('create-zip');
    expect(zip.getAttribute('name')).toBe('zip_code');
    expect(doc.querySelector('label[for="create-zip"]')?.textContent).toBe('ZIP code');
    expect(zip.getAttribute('inputmode')).toBe('numeric');
    expect(zip.required).toBe(false);
    // The form's own script is the one with the 5W list.
    const src = scriptWith(doc, "['create-where-address', 'where_address']");
    expect(src).toContain("['create-zip', 'zip_code']");
    expect(src).toContain("['create-venue', 'create-where-address', 'create-zip']");
    void w;
  });
});
