import { SELF } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';

describe('/briefing route (BRIEF-1)', () => {
  test('GET /briefing returns 200 with HTML', async () => {
    const res = await SELF.fetch('https://t.test/briefing');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  test('GET /briefing serves PIN-gated React app', async () => {
    const res = await SELF.fetch('https://t.test/briefing');
    const html = await res.text();
    expect(html).toContain('PIN="2026"');
    expect(html).toContain('id="root"');
    expect(html).toContain('ourCommunityRituals');
  });

  test('GET /briefing has correct security headers', async () => {
    const res = await SELF.fetch('https://t.test/briefing');
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  test('GET /overview and /summary also route to briefing', async () => {
    for (const path of ['/overview', '/summary']) {
      const res = await SELF.fetch(`https://t.test${path}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('ourCommunityRituals');
    }
  });

  test('POST /briefing returns 404 (GET-only route)', async () => {
    const res = await SELF.fetch('https://t.test/briefing', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
