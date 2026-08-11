/**
 * OSE-655 — Pre-event funnel rich media (WHO photo + WHAT video).
 *
 * OSE-664 added who_image_url / what_video_url (columns + admin authoring wall).
 * The funnel must SURFACE them: the WHO card (the conversion engine) shows the
 * host's face; the WHAT card offers the lean-in video as a link-out (never an
 * embed). Render re-guards both URLs http(s)-only (defense-in-depth) so a scheme
 * that ever slipped past authoring can never reach an <img src>/<a href>.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column') || m.includes('already exists') || m.includes('no such column')) continue;
      throw e;
    }
  }
}

async function seed(id: string, whoImage: string | null, whatVideo: string | null): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const start = new Date(Date.now() + 7 * 86400000).toISOString(); // +7d → pre_event
  await tenv.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date,
                         what_short, who_host, who_story, who_image_url, what_video_url,
                         created_at, updated_at)
     VALUES (?, 'media-test', 'Media Funnel Event', ?, 'active', 'The Venue', ?, ?,
             'What it is', 'DJ Mallang', 'Ten years behind the decks', ?, ?,
             datetime('now'), datetime('now'))`
  )
    .bind(id, id, start, start, whoImage, whatVideo)
    .run();
}

beforeAll(applyMigrations);

describe('OSE-655 | pre-event funnel rich media (WHO photo + WHAT video)', () => {
  test('valid https media renders: WHO photo in the WHO card, WHAT video as a link-out', async () => {
    const id = 'evt_media_ok';
    await seed(id, 'https://cdn.example.com/host.jpg', 'https://videos.example.com/promo.mp4');
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    const at = (t: string) => html.indexOf(`data-testid="${t}"`);

    // WHO card shows the host's face, inside the WHO card, ahead of the story.
    expect(at('event-who-image'), 'WHO card must show the host photo').toBeGreaterThan(-1);
    expect(html).toContain('src="https://cdn.example.com/host.jpg"');
    expect(at('event-who-image')).toBeGreaterThan(at('event-who'));
    expect(at('event-who-image'), 'photo leads the story').toBeLessThan(at('event-who-story'));

    // WHAT card offers the video as a safe link-out — never an embed.
    expect(at('event-what-video'), 'WHAT card must offer the video').toBeGreaterThan(-1);
    expect(html).toContain('href="https://videos.example.com/promo.mp4"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html, 'video is a link-out, never an iframe embed').not.toContain('<iframe');
  });

  test('defense-in-depth: a non-http(s) scheme that slipped past authoring is NOT rendered', async () => {
    const id = 'evt_media_bad';
    await seed(id, 'javascript:alert(1)//host.jpg', 'data:text/html,<script>evil</script>');
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();

    // Guarded at render: neither the image nor the video link appears.
    expect(html).not.toContain('event-who-image');
    expect(html).not.toContain('event-what-video');
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('data:text/html');

    // The WHO card still renders (host + story) — just without the bad image.
    expect(html).toContain('data-testid="event-who"');
    expect(html).toContain('data-testid="event-who-story"');
  });
});
