/**
 * OSE-1518 — three plain choices under the facts, and the next events at the
 * venue, on the public event page; OSE-1519 — the error page uses the shared
 * footer.
 *
 * The page order (title/when, sponsors, What, Where, Who, How much, THEN the
 * choices, THEN share + calendar, then Why, How, anonymity) is the canonical
 * order locked by pre-event-funnel-order.spec.ts and
 * public-event-stakeholder-surfaces.spec.ts. This spec adds what sits in the ask:
 *
 *   Register first and full width (pre-event) / Check in first (on now),
 *   "count me in anonymously" (the check-in form), "just looking" (a way out
 *   that asks for nothing), then Share and Add to calendar as a pair BELOW.
 *
 * Constraint kept: "plant my flag" is a link out to ourWKRP at most, never a
 * profile flow inside OSE, so the choices hold no form field of their own.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const E = env as unknown as { DB: D1Database; TEST_MIGRATION_STATEMENTS: string };

beforeAll(async () => {
  for (const stmt of JSON.parse(E.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await E.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column') || m.includes('already exists')) continue;
      throw e;
    }
  }
});

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

interface Seed {
  id: string;
  title?: string;
  status?: string;
  start?: string;
  end?: string;
  location?: string | null;
  published?: number;
}

async function seed(s: Seed): Promise<void> {
  await E.DB.prepare(
    `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date,
            what_short, who_host, why_purpose, how_details, where_address, location, created_at, updated_at)
     VALUES (?, 'root', ?, ?, ?, ?, ?, ?, 'A weekly game night', 'The Host', 'To meet', 'Show up', '1 Main St', ?,
             datetime('now'), datetime('now'))`
  )
    .bind(
      s.id,
      s.title ?? `Event ${s.id}`,
      s.id,
      s.status ?? 'active',
      s.published ?? 1,
      s.start ?? inDays(3),
      s.end ?? s.start ?? inDays(3),
      s.location === undefined ? 'The Venue' : s.location
    )
    .run();
}

async function page(path: string): Promise<string> {
  const res = await SELF.fetch(`https://localhost${path}`);
  expect(res.status).toBe(200);
  return res.text();
}

const at = (html: string, needle: string) => html.indexOf(needle);
const tid = (html: string, t: string) => at(html, `data-testid="${t}"`);

/** The opening tag of the element carrying a test id. */
const tag = (html: string, t: string) =>
  html.match(new RegExp(`<[a-z]+ [^>]*data-testid="${t}"[^>]*>`))?.[0] ?? '';

describe('OSE-1518 three plain choices (before the event)', () => {
  test('Register first, then count me in anonymously, then just looking, in that order', async () => {
    await seed({ id: 'evt_1518_pre' });
    const html = await page('/events/evt_1518_pre');
    expect(tid(html, 'event-choices'), '[OSE-1518] the choices block renders').toBeGreaterThan(-1);
    const register = tid(html, 'event-rsvp');
    const checkin = tid(html, 'event-choice-checkin');
    const looking = tid(html, 'event-choice-looking');
    expect(register, 'Register link').toBeGreaterThan(tid(html, 'event-choices'));
    expect(checkin, 'check-in follows Register').toBeGreaterThan(register);
    expect(looking, 'just looking comes last').toBeGreaterThan(checkin);
  });

  test('Register is the primary action; the others are secondary', async () => {
    await seed({ id: 'evt_1518_primary' });
    const html = await page('/events/evt_1518_primary');
    expect(tag(html, 'event-rsvp')).toContain('ose-choice-primary');
    expect(tag(html, 'event-choice-checkin')).not.toContain('ose-choice-primary');
    expect(tag(html, 'event-choice-looking')).not.toContain('ose-choice-primary');
  });

  test('each choice goes where it says: register form, check-in form, the events list', async () => {
    await seed({ id: 'evt_1518_links' });
    const html = await page('/events/evt_1518_links');
    expect(tag(html, 'event-rsvp')).toContain('href="/events/evt_1518_links/register"');
    expect(tag(html, 'event-choice-checkin')).toContain('href="/events/evt_1518_links/checkin"');
    expect(tag(html, 'event-choice-looking')).toContain('href="/events"');
  });

  test('the choices follow the facts and come before Share and Add to calendar, which come before Why', async () => {
    await seed({ id: 'evt_1518_order' });
    const html = await page('/events/evt_1518_order');
    expect(tid(html, 'event-where'), 'facts first').toBeLessThan(tid(html, 'event-choices'));
    expect(tid(html, 'event-choices'), 'choices before the share pair').toBeLessThan(
      tid(html, 'event-actions')
    );
    expect(tid(html, 'event-actions'), 'the pair sits above the deeper detail').toBeLessThan(
      tid(html, 'event-why')
    );
    expect(tid(html, 'share-btn'), 'Share and Add to calendar are one pair').toBeLessThan(
      tid(html, 'add-to-calendar')
    );
  });

  test('a poster scan context keeps its form first and still offers the three choices', async () => {
    await seed({ id: 'evt_1518_ctx' });
    const html = await page('/events/evt_1518_ctx?type=survey&deployment=pd_1518');
    expect(tag(html, 'event-rsvp')).toContain('/evt_1518_ctx/survey?deployment=pd_1518');
    expect(html).toContain('Share feedback');
    expect(tag(html, 'event-choice-register')).toContain(
      '/evt_1518_ctx/register?deployment=pd_1518'
    );
    expect(tag(html, 'event-choice-checkin')).toContain('/evt_1518_ctx/checkin?deployment=pd_1518');
    expect(tid(html, 'event-choice-looking')).toBeGreaterThan(-1);
  });

  test('never a profile flow inside OSE: the choices hold no field of their own', async () => {
    await seed({ id: 'evt_1518_noform' });
    const html = await page('/events/evt_1518_noform');
    const start = tid(html, 'event-choices');
    const end = tid(html, 'event-actions');
    expect(start, '[OSE-1518] the block under test renders').toBeGreaterThan(-1);
    const block = html.slice(start, end);
    expect(block).not.toMatch(/<(form|input|select|textarea)[\s>]/);
  });

  test('the draft preview switches every choice off: no form link leaves the page', async () => {
    const { renderPreEventHtml } = await import('../src/handlers/pages');
    const row = {
      id: 'evt_1518_prev',
      brand_id: 'root',
      title: 'Preview Night',
      status: 'draft',
      start_date: inDays(3),
      location: 'The Venue',
    } as unknown as Parameters<typeof renderPreEventHtml>[0];
    const html = renderPreEventHtml(row, 'https://t.test/events/evt_1518_prev', undefined, {
      preview: true,
    });
    for (const t of ['event-rsvp', 'event-choice-checkin', 'event-choice-looking']) {
      const open = tag(html, t);
      expect(open, `${t} renders`).not.toBe('');
      expect(open).toContain('data-preview-inert="true"');
      expect(open).not.toContain('href=');
    }
    expect(html).not.toContain('/events/evt_1518_prev/register');
    expect(html).not.toContain('/forms/evt_1518_prev');
  });
});

describe('OSE-1518 three plain choices (while the event is on)', () => {
  test('check in first, then register, then just looking', async () => {
    await seed({ id: 'evt_1518_now', start: inDays(-1), end: inDays(1) });
    const html = await page('/events/evt_1518_now');
    expect(html, 'the live render is the one under test').toContain('event-title-live');
    const checkin = tid(html, 'event-checkin');
    const register = tid(html, 'event-choice-register');
    const looking = tid(html, 'event-choice-looking');
    expect(tid(html, 'event-choices')).toBeGreaterThan(-1);
    expect(register, 'register follows check-in').toBeGreaterThan(checkin);
    expect(looking).toBeGreaterThan(register);
    expect(tag(html, 'event-checkin')).toContain('ose-choice-primary');
    expect(tag(html, 'event-choice-register')).toContain('href="/events/evt_1518_now/register"');
  });

  test('Share and Add to calendar are a pair below the choices', async () => {
    await seed({ id: 'evt_1518_now2', start: inDays(-1), end: inDays(1) });
    const html = await page('/events/evt_1518_now2');
    expect(tid(html, 'event-choices'), '[OSE-1518] choices render').toBeGreaterThan(-1);
    expect(tid(html, 'event-choices')).toBeLessThan(tid(html, 'event-actions'));
    expect(tid(html, 'event-actions')).toBeLessThan(tid(html, 'event-why-live'));
  });
});

describe('less text on the event page (owner 2026-10-11): each choice says only what it asks', () => {
  /** The note under a choice, or null when it has none. */
  const noteOf = (html: string, testid: string) => {
    const t = tag(html, testid);
    const id = t.match(/aria-describedby="([^"]+)"/)?.[1];
    if (!id) return null;
    return html.match(new RegExp(`<p class="ose-choice-note" id="${id}">([^<]*)</p>`))?.[1] ?? null;
  };

  test('before the event: Register says what it asks for; the other two carry no note', async () => {
    await seed({ id: 'evt_less_pre' });
    const html = await page('/events/evt_less_pre');
    expect(noteOf(html, 'event-rsvp')).toBe('Asks for your name and email.');
    // The label already says "anonymously", so a note would repeat it.
    expect(noteOf(html, 'event-choice-checkin')).toBeNull();
    expect(noteOf(html, 'event-choice-looking')).toBeNull();
    expect(html).not.toContain('Nothing to fill in');
    expect(html).not.toContain('Save a spot.');
  });

  test('while it is on: Check in keeps its promise, because its label does not say it', async () => {
    await seed({ id: 'evt_less_live', start: inDays(-1), end: inDays(1) });
    const html = await page('/events/evt_less_live');
    expect(noteOf(html, 'event-checkin')).toBe('Counted, never named.');
    expect(noteOf(html, 'event-choice-register')).toBe('Asks for your name and email.');
    expect(noteOf(html, 'event-choice-looking')).toBeNull();
  });

  test('the header names the host and nothing else', async () => {
    await seed({ id: 'evt_less_host' });
    const html = await page('/events/evt_less_host');
    expect(tag(html, 'event-trust')).not.toBe('');
    expect(html).toContain('Hosted by The Host');
    expect(html).not.toContain('No account needed to view');
    expect(html).not.toContain('Verified event link');
  });
});

describe('OSE-1518 next at this venue on the event page', () => {
  async function seedVenue(): Promise<void> {
    await seed({ id: 'evt_1518_v_self', title: 'Self Night', location: 'Eagles Hall' });
    await seed({ id: 'evt_1518_v_a', title: 'Venue A', start: inDays(5), location: 'Eagles Hall' });
    await seed({ id: 'evt_1518_v_b', title: 'Venue B', start: inDays(6), location: 'Eagles Hall' });
    await seed({ id: 'evt_1518_v_c', title: 'Venue C', start: inDays(7), location: 'Eagles Hall' });
    await seed({ id: 'evt_1518_v_d', title: 'Venue D', start: inDays(8), location: 'Eagles Hall' });
    await seed({
      id: 'evt_1518_v_past',
      title: 'Venue Past',
      start: inDays(-9),
      location: 'Eagles Hall',
    });
    await seed({
      id: 'evt_1518_v_other',
      title: 'Elsewhere',
      start: inDays(5),
      location: 'Other Hall',
    });
    await seed({
      id: 'evt_1518_v_unlisted',
      title: 'Unlisted One',
      start: inDays(4),
      location: 'Eagles Hall',
      published: 0,
    });
    await seed({
      id: 'evt_1518_v_draft',
      title: 'Draft One',
      status: 'draft',
      start: inDays(4),
      location: 'Eagles Hall',
    });
  }

  test('the pre-event page lists up to three other events at the same venue, soonest first', async () => {
    await seedVenue();
    const html = await page('/events/evt_1518_v_self');
    expect(tid(html, 'venue-next-events'), '[OSE-1518] the list renders').toBeGreaterThan(-1);
    const list = html.slice(tid(html, 'venue-next-events'));
    const a = list.indexOf('Venue A');
    const b = list.indexOf('Venue B');
    const c = list.indexOf('Venue C');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(list, 'bounded at three').not.toContain('Venue D');
    expect(list, 'past events are not next').not.toContain('Venue Past');
    expect(list, 'another venue is not this venue').not.toContain('Elsewhere');
    expect(list, 'unlisted stays unlisted').not.toContain('Unlisted One');
    expect(list, 'a draft is never named').not.toContain('Draft One');
    expect(list, 'it does not list itself').not.toContain('Self Night');
  });

  test('the page while the event is on lists them too', async () => {
    await seedVenue();
    await seed({
      id: 'evt_1518_v_live',
      title: 'Live Night',
      start: inDays(-1),
      end: inDays(1),
      location: 'Eagles Hall',
    });
    const html = await page('/events/evt_1518_v_live');
    expect(html).toContain('event-title-live');
    expect(tid(html, 'venue-next-events'), '[OSE-1518] live page too').toBeGreaterThan(-1);
    expect(html.slice(tid(html, 'venue-next-events'))).toContain('Venue A');
  });

  test('it sits after the deeper detail and before the anonymity note, never above the ask', async () => {
    await seedVenue();
    const html = await page('/events/evt_1518_v_self');
    const next = tid(html, 'venue-next-events');
    const anon = at(html, 'class="ose-never-who"');
    expect(next, '[OSE-1518] the list renders').toBeGreaterThan(-1);
    expect(anon, 'the anonymity note renders').toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(tid(html, 'event-how'));
    expect(next).toBeLessThan(anon);
  });

  test('the renderer itself is bounded at three, whatever it is handed', async () => {
    const { renderEventLiveHtml } = await import('../src/handlers/pages');
    const row = {
      id: 'evt_1518_bound',
      brand_id: 'root',
      title: 'Bound Night',
      status: 'active',
      start_date: inDays(-1),
      location: 'Eagles Hall',
    } as unknown as Parameters<typeof renderEventLiveHtml>[0];
    const nextEvents = [1, 2, 3, 4, 5].map((n) => ({
      id: `evt_n${n}`,
      title: `Next ${n}`,
      start_date: inDays(n),
      location: 'Eagles Hall',
    }));
    const html = renderEventLiveHtml(row, 'https://t.test/events/evt_1518_bound', undefined, {
      nextEvents,
    });
    expect(html.match(/data-testid="venue-next-event-\d"/g)?.length).toBe(3);
  });

  test('no other event at the venue: nothing renders, not an empty heading', async () => {
    await seed({ id: 'evt_1518_alone', location: 'Lonely Hall' });
    const html = await page('/events/evt_1518_alone');
    expect(html).not.toContain('data-testid="venue-next-events"');
    expect(html).not.toContain('Next at');
  });

  test('an event with no venue shows no list', async () => {
    await seed({ id: 'evt_1518_novenue', location: null });
    const html = await page('/events/evt_1518_novenue');
    expect(html).not.toContain('data-testid="venue-next-events"');
  });
});

describe('OSE-1519 the error page uses the shared footer', () => {
  test('an unknown event id ends in the shared footer with the privacy link', async () => {
    const res = await SELF.fetch('https://localhost/events/no-such-event-1519-footer');
    expect(res.status).toBe(404);
    const html = await res.text();
    const footer =
      html.match(/<footer[^>]*data-testid="error-footer"[\s\S]*?<\/footer>/)?.[0] ?? '';
    expect(footer, '[OSE-1519] the shared footer, not its own').toContain('class="ocr-footer"');
    expect(footer).toContain('href="/privacy"');
    expect(html, 'the page no longer carries its own footer line').not.toContain(
      'OurSharedEvents — community gatherings'
    );
  });

  test('an ended event page ends in the same footer', async () => {
    await seed({ id: 'evt_1519_ended', title: 'Ended Night', status: 'archived', published: 0 });
    await E.DB.prepare('UPDATE events SET listed_from = ? WHERE id = ?')
      .bind('2026-09-01T00:00:00Z', 'evt_1519_ended')
      .run();
    const res = await SELF.fetch('https://localhost/events/evt_1519_ended');
    expect(res.status).toBe(410);
    const html = await res.text();
    expect(html).toContain('Ended Night has ended');
    expect(html).toContain('class="ocr-footer"');
    expect(html).toContain('href="/privacy"');
  });

  test('guard: a draft and an unknown id are still the same page, and the draft stays unnamed', async () => {
    await seed({ id: 'evt_1519_draft_x', title: 'Hidden Draft Gala', status: 'draft' });
    const draft = await SELF.fetch('https://localhost/events/evt_1519_draft_x');
    const unknown = await SELF.fetch('https://localhost/events/evt_1519_never_existed');
    expect(draft.status).toBe(404);
    const strip = (s: string) => s.replace(/nonce="[^"]+"/g, '');
    const draftBody = await draft.text();
    expect(draftBody).not.toContain('Hidden Draft Gala');
    expect(strip(draftBody)).toBe(strip(await unknown.text()));
  });

  test('guard: the error page keeps its 44px actions and the single h1', async () => {
    const res = await SELF.fetch('https://localhost/events/no-such-event-1519-h1');
    const html = await res.text();
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain('min-height: 44px');
  });
});
