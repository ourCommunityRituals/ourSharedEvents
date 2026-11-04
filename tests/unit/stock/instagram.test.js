let listPosts;
let pickArt;
let tokenWarning;
let redactUrl;
beforeAll(async () => {
  ({ listPosts, pickArt, tokenWarning, redactUrl } =
    await import('../../../scripts/stock/instagram.mjs'));
});

const res = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});
const media = (id, type, caption) => ({
  id,
  caption,
  media_type: type,
  media_url: `https://cdn.example/${id}.jpg`,
  timestamp: '2026-10-01T00:00:00+0000',
});

describe('listPosts', () => {
  test('follows paging.next across two pages and parses hashtags', async () => {
    const calls = [];
    const fetch = async (url) => {
      calls.push(url);
      if (calls.length === 1) {
        return res(200, {
          data: [media('1', 'IMAGE', 'Dusk #Bocce #lakeshore')],
          paging: { next: 'https://graph.instagram.com/page2?access_token=SECRET' },
        });
      }
      return res(200, { data: [media('2', 'CAROUSEL_ALBUM', 'Market')] });
    };
    const posts = await listPosts({ token: 'SECRET', fetch });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain(
      'https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,timestamp'
    );
    expect(posts.map((p) => p.id)).toEqual(['1', '2']);
    expect(posts[0].hashtags).toEqual(['bocce', 'lakeshore']);
    expect(posts[0].mediaUrl).toBe('https://cdn.example/1.jpg');
    expect(listPosts.warning).toBeNull();
  });

  test('drops VIDEO posts', async () => {
    const fetch = async () =>
      res(200, { data: [media('1', 'VIDEO', 'x'), media('2', 'IMAGE', 'y')] });
    expect((await listPosts({ token: 't', fetch })).map((p) => p.id)).toEqual(['2']);
  });

  test.each([400, 401])('a %i gives [] plus a warning without the token', async (status) => {
    const fetch = async () => res(status, {});
    expect(await listPosts({ token: 'SECRET', fetch })).toEqual([]);
    expect(listPosts.warning).toMatch(String(status));
    expect(listPosts.warning).not.toContain('SECRET');
  });

  test('other failures throw without the token or URL', async () => {
    const fetch = async () => res(500, {});
    const err = await listPosts({ token: 'SECRET', fetch }).catch((e) => e);
    expect(err.message).toMatch(/HTTP 500/);
    expect(err.message).not.toMatch(/SECRET|access_token/);
  });

  test('redactUrl hides access_token', () => {
    expect(redactUrl('https://x/y?a=1&access_token=SECRET&b=2')).toBe(
      'https://x/y?a=1&access_token=REDACTED&b=2'
    );
  });
});

describe('pickArt', () => {
  const find = { venue: 'Lake Park', starts_at: '2026-11-07T18:00:00Z', event_type_id: 'bocce' };
  const art = { tags: { bocce: ['bocce'], market: 'cat-market', lawn: ['cat-sport'] } };
  const post = (id, caption) => ({ id, caption, hashtags: [], mediaUrl: `u${id}` });
  const posts = [
    post('a', 'x #bocce'),
    post('b', 'bocce night'),
    post('c', 'big #bocce'),
    post('d', 'unrelated'),
  ];

  test('same find gives the same pick, and a reordered array too', () => {
    const one = pickArt(find, posts, art);
    expect(one).not.toBeNull();
    expect(pickArt(find, posts, art)).toBe(one);
    // vary the find until the pick is not the first-by-id, so a missing sort shows
    for (let i = 0; i < 30; i++) {
      const f = { ...find, venue: 'V' + i };
      expect(pickArt(f, [...posts].reverse(), art).id).toBe(pickArt(f, posts, art).id);
    }
    const picks = new Set(
      Array.from({ length: 30 }, (_, i) => pickArt({ ...find, venue: 'V' + i }, posts, art).id)
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  test('no matching tag gives null', () => {
    expect(pickArt({ ...find, event_type_id: 'chess' }, posts, art)).toBeNull();
    expect(pickArt(find, posts, { tags: {} })).toBeNull();
    expect(pickArt(find, [], art)).toBeNull();
  });

  test('category-level tags match through typeCategory only', () => {
    const p = [post('m', 'Saturday #market')];
    const f = { ...find, event_type_id: 'farmers' };
    expect(pickArt(f, p, art)).toBeNull();
    expect(pickArt(f, p, art, new Map([['farmers', 'cat-market']])).id).toBe('m');
    expect(pickArt(f, p, art, new Map([['farmers', 'cat-other']]))).toBeNull();
  });

  test('a prototype key in a caption does not match', () => {
    expect(pickArt(find, [post('p', 'constructor toString')], art)).toBeNull();
  });
});

describe('tokenWarning', () => {
  test('warns from day 50 of 60', () => {
    expect(tokenWarning('2026-09-01', '2026-10-21')).not.toBeNull();
    expect(tokenWarning('2026-10-01', '2026-10-21')).toBeNull();
    expect(tokenWarning('2026-09-02', '2026-10-21')).toBeNull();
    expect(tokenWarning('2026-08-01', '2026-10-21')).toMatch(/expired/);
  });
});
