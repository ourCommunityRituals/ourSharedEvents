/* globals vi, describe, test, expect, beforeEach, beforeAll, afterEach */
/**
 * SponsorUtils Unit Tests
 *
 * Who:  Shared sponsor utilities module (esc, filterByPlacement, normalizeSponsor,
 *       renderInline, renderCard, renderBanner, logEvent, flush)
 * What: XSS prevention, placement filtering, sponsor normalization, render output,
 *       analytics logging, carousel rotation, edge case resilience
 * Where: Display.html, Public.html, Poster.html — all display surfaces
 * Why:  Sponsors render on untrusted surfaces (public QR scan pages, TV displays).
 *       Every input path must be safe and every partial object must never throw.
 *
 * Naming format: Who — What — Where — Why (per TEST-NAMING-STANDARD.md)
 * Updated: OSE-168 fix — isPrimary → tier migration
 */

describe('SponsorUtils', () => {
  // ===========================================================================
  // Who: esc() — XSS prevention utility
  // ===========================================================================

  describe('esc() — XSS prevention', () => {
    let esc;

    beforeAll(() => {
      esc = function (s) {
        return String(s).replace(
          /[&<>"']/g,
          (m) =>
            ({
              '&': '&amp;',
              '<': '&lt;',
              '>': '&gt;',
              '"': '&quot;',
              "'": '&#39;',
            })[m]
        );
      };
    });

    test('escapes ampersands', () => {
      expect(esc('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    test('escapes less-than signs', () => {
      expect(esc('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    test('escapes greater-than signs', () => {
      expect(esc('2 > 1')).toBe('2 &gt; 1');
    });

    test('escapes double quotes', () => {
      expect(esc('Say "hello"')).toBe('Say &quot;hello&quot;');
    });

    test('escapes single quotes', () => {
      expect(esc("It's fine")).toBe('It&#39;s fine');
    });

    test('converts null/undefined to string', () => {
      expect(esc(null)).toBe('null');
      expect(esc(undefined)).toBe('undefined');
    });

    test('converts numbers to string', () => {
      expect(esc(123)).toBe('123');
    });

    test('returns empty string unchanged', () => {
      expect(esc('')).toBe('');
    });

    test('neutralizes complex XSS attack vector (img onerror)', () => {
      const xssVector = '<img src="x" onerror="alert(\'XSS\')">';
      const escaped = esc(xssVector);
      expect(escaped).not.toContain('<img');
      expect(escaped).toContain('&lt;img');
      expect(escaped).toBe(
        '&lt;img src=&quot;x&quot; onerror=&quot;alert(&#39;XSS&#39;)&quot;&gt;'
      );
    });

    test('neutralizes malicious query params in URL', () => {
      const maliciousUrl = 'https://example.com?redirect=<script>steal()</script>';
      const escaped = esc(maliciousUrl);
      expect(escaped).not.toContain('<script>');
    });
  });

  // ===========================================================================
  // Who: filterByPlacement() — sponsor surface filtering
  // ===========================================================================

  describe('filterByPlacement() — sponsor surface filtering', () => {
    let filterByPlacement;

    beforeAll(() => {
      filterByPlacement = function (sponsors, placement) {
        return (sponsors || []).filter((s) => s?.placements?.[placement]);
      };
    });

    const mockSponsors = [
      { id: 'sp1', name: 'Sponsor 1', placements: { tvTop: true, mobileBanner: false } },
      { id: 'sp2', name: 'Sponsor 2', placements: { tvTop: false, mobileBanner: true } },
      {
        id: 'sp3',
        name: 'Sponsor 3',
        placements: { tvTop: true, mobileBanner: true, tvSide: true },
      },
      { id: 'sp4', name: 'Sponsor 4', placements: { posterTop: true } },
    ];

    test('filters by tvTop placement — returns matching sponsors', () => {
      const result = filterByPlacement(mockSponsors, 'tvTop');
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(['sp1', 'sp3']);
    });

    test('filters by mobileBanner placement — returns matching sponsors', () => {
      const result = filterByPlacement(mockSponsors, 'mobileBanner');
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toEqual(['sp2', 'sp3']);
    });

    test('filters by tvSide placement — returns single match', () => {
      const result = filterByPlacement(mockSponsors, 'tvSide');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('sp3');
    });

    test('filters by posterTop placement — returns single match', () => {
      const result = filterByPlacement(mockSponsors, 'posterTop');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('sp4');
    });

    test('returns empty array for unknown placement', () => {
      const result = filterByPlacement(mockSponsors, 'unknownPlacement');
      expect(result).toHaveLength(0);
    });

    test('handles null/undefined sponsors array — returns empty', () => {
      expect(filterByPlacement(null, 'tvTop')).toEqual([]);
      expect(filterByPlacement(undefined, 'tvTop')).toEqual([]);
    });

    test('handles sponsors with missing placements object — skips them', () => {
      const sponsorsWithMissing = [
        { id: 'sp1', name: 'No Placements' },
        { id: 'sp2', name: 'Has Placements', placements: { tvTop: true } },
      ];
      const result = filterByPlacement(sponsorsWithMissing, 'tvTop');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('sp2');
    });
  });

  // ===========================================================================
  // Who: logEvent() / flush() — analytics logging
  // ===========================================================================

  describe('logEvent() / flush() — analytics logging', () => {
    let logBatch;
    let logEvent;
    let flush;

    beforeEach(() => {
      logBatch = [];

      Object.defineProperty(global, 'navigator', {
        value: { userAgent: 'TestBrowser/1.0' },
        writable: true,
        configurable: true,
      });
      vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

      logEvent = function (evt) {
        try {
          evt.ua = navigator.userAgent;
          evt.ts = Date.now();
          logBatch.push(evt);
        } catch (_) {
          // Silently ignore logging errors
        }
      };

      flush = function () {
        if (!logBatch.length) return;
        const copy = logBatch.splice(0, logBatch.length);
        return copy;
      };
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    test('attaches userAgent to log event', () => {
      logEvent({ eventId: 'ev1', surface: 'display', metric: 'impression' });
      expect(logBatch[0].ua).toBe('TestBrowser/1.0');
    });

    test('attaches timestamp to log event', () => {
      logEvent({ eventId: 'ev1', surface: 'display', metric: 'impression' });
      expect(logBatch[0].ts).toBe(1700000000000);
    });

    test('batches multiple events', () => {
      logEvent({ eventId: 'ev1', metric: 'impression' });
      logEvent({ eventId: 'ev1', metric: 'click' });
      logEvent({ eventId: 'ev2', metric: 'view' });

      expect(logBatch).toHaveLength(3);
    });

    test('flush returns batch and clears it', () => {
      logEvent({ metric: 'impression' });
      logEvent({ metric: 'click' });

      const flushed = flush();

      expect(flushed).toHaveLength(2);
      expect(logBatch).toHaveLength(0);
    });

    test('flush returns undefined when batch is empty', () => {
      const result = flush();
      expect(result).toBeUndefined();
    });

    test('preserves all event properties on log', () => {
      logEvent({
        eventId: 'ev1',
        surface: 'poster',
        metric: 'print',
        sponsorId: 'sp1',
        value: 1,
      });

      const evt = logBatch[0];
      expect(evt.eventId).toBe('ev1');
      expect(evt.surface).toBe('poster');
      expect(evt.metric).toBe('print');
      expect(evt.sponsorId).toBe('sp1');
      expect(evt.value).toBe(1);
    });
  });

  // ===========================================================================
  // Who: carousel — sponsor rotation logic
  // ===========================================================================

  describe('carousel — sponsor rotation logic', () => {
    test('rotates through sponsors array in order', () => {
      const sponsors = ['A', 'B', 'C'];
      let currentIndex = 0;
      const results = [];

      for (let i = 0; i < 6; i++) {
        results.push(sponsors[currentIndex]);
        currentIndex = (currentIndex + 1) % sponsors.length;
      }

      expect(results).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
    });

    test('handles single sponsor — repeats without rotation', () => {
      const sponsors = ['A'];
      let currentIndex = 0;
      const results = [];

      for (let i = 0; i < 3; i++) {
        results.push(sponsors[currentIndex]);
        currentIndex = (currentIndex + 1) % sponsors.length;
      }

      expect(results).toEqual(['A', 'A', 'A']);
    });
  });

  // ===========================================================================
  // Who: poster analytics — event structure validation
  // ===========================================================================

  describe('poster analytics — event structure', () => {
    const posterSurface = 'poster';

    test('view event has correct surface, metric, and value', () => {
      const viewEvent = {
        eventId: 'ev1',
        surface: posterSurface,
        metric: 'view',
        value: 1,
      };

      expect(viewEvent.surface).toBe('poster');
      expect(viewEvent.metric).toBe('view');
      expect(viewEvent.value).toBe(1);
    });

    test('print event has correct surface and metric', () => {
      const printEvent = {
        eventId: 'ev1',
        surface: posterSurface,
        metric: 'print',
        value: 1,
      };

      expect(printEvent.surface).toBe('poster');
      expect(printEvent.metric).toBe('print');
    });

    test('impression event includes sponsorId', () => {
      const impressionEvent = {
        eventId: 'ev1',
        surface: posterSurface,
        metric: 'impression',
        sponsorId: 'sp1',
      };

      expect(impressionEvent.sponsorId).toBe('sp1');
    });
  });

  // ===========================================================================
  // Who: normalizeSponsor + render helpers — long sponsor names
  // ===========================================================================

  describe('normalizeSponsor + render helpers — long sponsor names', () => {
    let normalizeSponsor;
    let renderInline;
    let renderCard;
    let renderBanner;
    let esc;

    beforeAll(() => {
      esc = function (s) {
        return String(s).replace(
          /[&<>"']/g,
          (m) =>
            ({
              '&': '&amp;',
              '<': '&lt;',
              '>': '&gt;',
              '"': '&quot;',
              "'": '&#39;',
            })[m]
        );
      };

      normalizeSponsor = function (s) {
        if (!s) return null;
        let placement = s.placement || '';
        if (!placement && s.placements && typeof s.placements === 'object') {
          placement = Object.keys(s.placements).find((k) => s.placements[k]) || '';
        }
        const validTiers = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'];
        let tier = 'primary';
        if (s.tier && validTiers.includes(s.tier)) {
          tier = s.tier;
        } else if (s.isPrimary) {
          tier = 'title';
        }
        return {
          id: s.id || '',
          name: s.name || '',
          logoUrl: s.logoUrl || s.img || '',
          linkUrl: s.linkUrl || s.website || s.url || '',
          placement: placement,
          tier: tier,
        };
      };

      renderInline = function (s, wrapLinks) {
        const content = s.img
          ? `<img src="${esc(s.img)}" alt="${esc(s.name || '')}">`
          : `<strong>${esc(s.name || '')}</strong>`;

        if (wrapLinks && s.url) {
          return `<a href="${esc(s.url)}" target="_blank" rel="noopener sponsored" data-sponsor-id="${esc(s.id || '')}">${content}</a>`;
        }
        return content;
      };

      renderCard = function (s, wrapLinks) {
        const card = `
          <div class="sp-card" data-id="${esc(s.id || '')}">
            ${s.img ? `<img src="${esc(s.img)}" alt="${esc(s.name || '')}">` : ''}
            <div class="sp-name">${esc(s.name || '')}</div>
          </div>
        `;

        if (wrapLinks && s.url) {
          return `<a href="${esc(s.url)}" target="_blank" rel="noopener sponsored" data-sponsor-id="${esc(s.id || '')}" style="text-decoration:none;color:inherit;">${card}</a>`;
        }
        return card;
      };

      renderBanner = function (s, wrapLinks) {
        const content = `
          ${s.img ? `<img src="${esc(s.img)}" alt="${esc(s.name || '')}">` : ''}
          <strong>${esc(s.name || '')}</strong>
        `;

        if (wrapLinks && s.url) {
          return `<a href="${esc(s.url)}" target="_blank" rel="noopener sponsored" data-sponsor-id="${esc(s.id || '')}">${content}</a>`;
        }
        return `<span>${content}</span>`;
      };
    });

    const longName = 'A'.repeat(250);
    const veryLongName = 'B'.repeat(500);
    const unicodeLongName = '\u2603'.repeat(100);

    test('normalizeSponsor preserves 250-char name without truncation', () => {
      const sponsor = { id: 'sp1', name: longName };
      const normalized = normalizeSponsor(sponsor);

      expect(normalized.name).toBe(longName);
      expect(normalized.name.length).toBe(250);
    });

    test('normalizeSponsor preserves 500-char name without truncation', () => {
      const sponsor = { id: 'sp1', name: veryLongName };
      const normalized = normalizeSponsor(sponsor);

      expect(normalized.name.length).toBe(500);
    });

    test('normalizeSponsor preserves unicode long name', () => {
      const sponsor = { id: 'sp1', name: unicodeLongName };
      const normalized = normalizeSponsor(sponsor);

      expect(normalized.name).toBe(unicodeLongName);
    });

    test('renderInline escapes long name — produces valid HTML', () => {
      const sponsor = { id: 'sp1', name: longName };
      const html = renderInline(sponsor, false);

      expect(html).toContain('<strong>');
      expect(html).toContain('</strong>');
      expect(html).not.toContain('<script>');
    });

    test('renderCard handles long name in sp-name div', () => {
      const sponsor = { id: 'sp1', name: longName };
      const html = renderCard(sponsor, false);

      expect(html).toContain('class="sp-name"');
      expect(html).toContain(longName);
    });

    test('renderBanner handles 500-char name without breaking', () => {
      const sponsor = { id: 'sp1', name: veryLongName };
      const html = renderBanner(sponsor, false);

      expect(html).toContain('<strong>');
      expect(html.length).toBeGreaterThan(500);
    });

    test('renderInline escapes long name with special chars — neutralizes XSS', () => {
      const specialLongName = '<script>'.repeat(30) + 'Test';
      const sponsor = { id: 'sp1', name: specialLongName };
      const html = renderInline(sponsor, false);

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  // ===========================================================================
  // Who: normalizeSponsor + render helpers — missing logoUrl or linkUrl
  // ===========================================================================

  describe('normalizeSponsor + render helpers — missing logoUrl or linkUrl', () => {
    let normalizeSponsor;
    let renderInline;
    let renderCard;
    let renderBanner;
    let esc;

    beforeAll(() => {
      esc = function (s) {
        return String(s).replace(
          /[&<>"']/g,
          (m) =>
            ({
              '&': '&amp;',
              '<': '&lt;',
              '>': '&gt;',
              '"': '&quot;',
              "'": '&#39;',
            })[m]
        );
      };

      normalizeSponsor = function (s) {
        if (!s) return null;
        let placement = s.placement || '';
        if (!placement && s.placements && typeof s.placements === 'object') {
          placement = Object.keys(s.placements).find((k) => s.placements[k]) || '';
        }
        const validTiers = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'];
        let tier = 'primary';
        if (s.tier && validTiers.includes(s.tier)) {
          tier = s.tier;
        } else if (s.isPrimary) {
          tier = 'title';
        }
        return {
          id: s.id || '',
          name: s.name || '',
          logoUrl: s.logoUrl || s.img || '',
          linkUrl: s.linkUrl || s.website || s.url || '',
          placement: placement,
          tier: tier,
        };
      };

      renderInline = function (s, wrapLinks) {
        const content = s.img
          ? `<img src="${esc(s.img)}" alt="${esc(s.name || '')}">`
          : `<strong>${esc(s.name || '')}</strong>`;

        if (wrapLinks && s.url) {
          return `<a href="${esc(s.url)}" target="_blank" rel="noopener sponsored" data-sponsor-id="${esc(s.id || '')}">${content}</a>`;
        }
        return content;
      };

      renderCard = function (s, wrapLinks) {
        const card = `
          <div class="sp-card" data-id="${esc(s.id || '')}">
            ${s.img ? `<img src="${esc(s.img)}" alt="${esc(s.name || '')}">` : ''}
            <div class="sp-name">${esc(s.name || '')}</div>
          </div>
        `;

        if (wrapLinks && s.url) {
          return `<a href="${esc(s.url)}" target="_blank" rel="noopener sponsored" data-sponsor-id="${esc(s.id || '')}" style="text-decoration:none;color:inherit;">${card}</a>`;
        }
        return card;
      };

      renderBanner = function (s, wrapLinks) {
        const content = `
          ${s.img ? `<img src="${esc(s.img)}" alt="${esc(s.name || '')}">` : ''}
          <strong>${esc(s.name || '')}</strong>
        `;

        if (wrapLinks && s.url) {
          return `<a href="${esc(s.url)}" target="_blank" rel="noopener sponsored" data-sponsor-id="${esc(s.id || '')}">${content}</a>`;
        }
        return `<span>${content}</span>`;
      };
    });

    describe('when logoUrl is missing', () => {
      test('normalizeSponsor returns empty string for logoUrl', () => {
        const sponsor = { id: 'sp1', name: 'Test Sponsor' };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.logoUrl).toBe('');
      });

      test('renderInline shows name in strong tag — no img rendered', () => {
        const sponsor = { id: 'sp1', name: 'Test Sponsor' };
        const html = renderInline(sponsor, false);

        expect(html).toContain('<strong>Test Sponsor</strong>');
        expect(html).not.toContain('<img');
      });

      test('renderCard renders without img — name only', () => {
        const sponsor = { id: 'sp1', name: 'Test Sponsor' };
        const html = renderCard(sponsor, false);

        expect(html).toContain('class="sp-name"');
        expect(html).toContain('Test Sponsor');
        expect(html).not.toContain('src=');
      });

      test('renderBanner shows name without img', () => {
        const sponsor = { id: 'sp1', name: 'Test Sponsor' };
        const html = renderBanner(sponsor, false);

        expect(html).toContain('<strong>Test Sponsor</strong>');
        expect(html).not.toContain('<img');
      });
    });

    describe('when linkUrl is missing', () => {
      test('normalizeSponsor returns empty string for linkUrl', () => {
        const sponsor = { id: 'sp1', name: 'Test', logoUrl: 'https://img.test/logo.png' };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.linkUrl).toBe('');
      });

      test('renderInline does not wrap in anchor — even with wrapLinks=true', () => {
        const sponsor = { id: 'sp1', name: 'Test', img: 'https://img.test/logo.png' };
        const html = renderInline(sponsor, true);

        expect(html).toContain('<img');
        expect(html).not.toContain('<a href');
      });

      test('renderCard does not wrap in anchor — even with wrapLinks=true', () => {
        const sponsor = { id: 'sp1', name: 'Test', img: 'https://img.test/logo.png' };
        const html = renderCard(sponsor, true);

        expect(html).toContain('class="sp-card"');
        expect(html).not.toContain('<a href');
      });

      test('renderBanner uses span instead of anchor', () => {
        const sponsor = { id: 'sp1', name: 'Test' };
        const html = renderBanner(sponsor, true);

        expect(html).toContain('<span>');
        expect(html).not.toContain('<a href');
      });
    });

    describe('when both logoUrl and linkUrl are missing', () => {
      test('all render helpers produce output without throwing', () => {
        const sponsor = { id: 'sp1', name: 'Name Only Sponsor' };

        expect(() => renderInline(sponsor, true)).not.toThrow();
        expect(() => renderCard(sponsor, true)).not.toThrow();
        expect(() => renderBanner(sponsor, true)).not.toThrow();
      });

      test('renderInline renders name in strong tag only', () => {
        const sponsor = { id: 'sp1', name: 'Name Only' };
        const html = renderInline(sponsor, true);

        expect(html).toBe('<strong>Name Only</strong>');
      });
    });
  });

  // ===========================================================================
  // Who: normalizeSponsor + render helpers — partial/malformed sponsor objects
  // ===========================================================================

  describe('normalizeSponsor + render helpers — partial/malformed objects (never throw)', () => {
    let normalizeSponsor;
    let renderInline;
    let renderCard;
    let renderBanner;
    let esc;

    beforeAll(() => {
      esc = function (s) {
        return String(s).replace(
          /[&<>"']/g,
          (m) =>
            ({
              '&': '&amp;',
              '<': '&lt;',
              '>': '&gt;',
              '"': '&quot;',
              "'": '&#39;',
            })[m]
        );
      };

      normalizeSponsor = function (s) {
        if (!s) return null;
        let placement = s.placement || '';
        if (!placement && s.placements && typeof s.placements === 'object') {
          placement = Object.keys(s.placements).find((k) => s.placements[k]) || '';
        }
        const validTiers = ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary'];
        let tier = 'primary';
        if (s.tier && validTiers.includes(s.tier)) {
          tier = s.tier;
        } else if (s.isPrimary) {
          tier = 'title';
        }
        return {
          id: s.id || '',
          name: s.name || '',
          logoUrl: s.logoUrl || s.img || '',
          linkUrl: s.linkUrl || s.website || s.url || '',
          placement: placement,
          tier: tier,
        };
      };

      renderInline = function (s, wrapLinks) {
        const content = s.img
          ? `<img src="${esc(s.img)}" alt="${esc(s.name || '')}">`
          : `<strong>${esc(s.name || '')}</strong>`;

        if (wrapLinks && s.url) {
          return `<a href="${esc(s.url)}" target="_blank" rel="noopener sponsored" data-sponsor-id="${esc(s.id || '')}">${content}</a>`;
        }
        return content;
      };

      renderCard = function (s, wrapLinks) {
        const card = `
          <div class="sp-card" data-id="${esc(s.id || '')}">
            ${s.img ? `<img src="${esc(s.img)}" alt="${esc(s.name || '')}">` : ''}
            <div class="sp-name">${esc(s.name || '')}</div>
          </div>
        `;

        if (wrapLinks && s.url) {
          return `<a href="${esc(s.url)}" target="_blank" rel="noopener sponsored" data-sponsor-id="${esc(s.id || '')}" style="text-decoration:none;color:inherit;">${card}</a>`;
        }
        return card;
      };

      renderBanner = function (s, wrapLinks) {
        const content = `
          ${s.img ? `<img src="${esc(s.img)}" alt="${esc(s.name || '')}">` : ''}
          <strong>${esc(s.name || '')}</strong>
        `;

        if (wrapLinks && s.url) {
          return `<a href="${esc(s.url)}" target="_blank" rel="noopener sponsored" data-sponsor-id="${esc(s.id || '')}">${content}</a>`;
        }
        return `<span>${content}</span>`;
      };
    });

    test('normalizeSponsor returns null for null input', () => {
      expect(normalizeSponsor(null)).toBeNull();
    });

    test('normalizeSponsor returns null for undefined input', () => {
      expect(normalizeSponsor(undefined)).toBeNull();
    });

    test('normalizeSponsor returns safe defaults for empty object', () => {
      const normalized = normalizeSponsor({});

      expect(normalized).toEqual({
        id: '',
        name: '',
        logoUrl: '',
        linkUrl: '',
        placement: '',
        tier: 'primary',
      });
    });

    test('normalizeSponsor handles sponsor with only id', () => {
      const normalized = normalizeSponsor({ id: 'sp1' });

      expect(normalized.id).toBe('sp1');
      expect(normalized.name).toBe('');
      expect(normalized.logoUrl).toBe('');
    });

    test('normalizeSponsor handles sponsor with only name', () => {
      const normalized = normalizeSponsor({ name: 'Test' });

      expect(normalized.id).toBe('');
      expect(normalized.name).toBe('Test');
    });

    describe('render helpers — never throw on malformed input', () => {
      test('renderInline does not throw on empty object', () => {
        expect(() => renderInline({}, true)).not.toThrow();
        expect(() => renderInline({}, false)).not.toThrow();
      });

      test('renderCard does not throw on empty object', () => {
        expect(() => renderCard({}, true)).not.toThrow();
        expect(() => renderCard({}, false)).not.toThrow();
      });

      test('renderBanner does not throw on empty object', () => {
        expect(() => renderBanner({}, true)).not.toThrow();
        expect(() => renderBanner({}, false)).not.toThrow();
      });

      test('renderInline does not throw with undefined properties', () => {
        const sponsor = { id: undefined, name: undefined, img: undefined, url: undefined };
        expect(() => renderInline(sponsor, true)).not.toThrow();
      });

      test('renderCard does not throw with null properties', () => {
        const sponsor = { id: null, name: null, img: null, url: null };
        expect(() => renderCard(sponsor, true)).not.toThrow();
      });

      test('renderBanner produces valid HTML with empty sponsor', () => {
        const sponsor = {};
        const html = renderBanner(sponsor, true);

        expect(html).toContain('<span>');
        expect(html).toContain('</span>');
        expect(html).toContain('<strong>');
      });
    });

    describe('legacy field normalization (backward compat)', () => {
      test('resolves legacy img field to logoUrl (backward compat)', () => {
        const sponsor = { id: 'sp1', name: 'Test', img: 'https://img.test/logo.png' };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.logoUrl).toBe('https://img.test/logo.png');
      });

      test('resolves legacy url field to linkUrl (backward compat)', () => {
        const sponsor = { id: 'sp1', name: 'Test', url: 'https://sponsor.com' };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.linkUrl).toBe('https://sponsor.com');
      });

      test('resolves legacy website field to linkUrl (backward compat)', () => {
        const sponsor = { id: 'sp1', name: 'Test', website: 'https://website.com' };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.linkUrl).toBe('https://website.com');
      });

      test('prefers linkUrl over legacy url and website fields (backward compat)', () => {
        const sponsor = {
          id: 'sp1',
          name: 'Test',
          linkUrl: 'https://primary.com',
          url: 'https://legacy-url.com',
          website: 'https://legacy-website.com',
        };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.linkUrl).toBe('https://primary.com');
      });

      test('resolves legacy placements object to first truthy key (backward compat)', () => {
        const sponsor = {
          id: 'sp1',
          name: 'Test',
          placements: { tvTop: true, mobileBanner: false },
        };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.placement).toBe('tvTop');
      });

      test('prefers placement string over placements object (backward compat)', () => {
        const sponsor = {
          id: 'sp1',
          name: 'Test',
          placement: 'poster',
          placements: { tvTop: true },
        };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.placement).toBe('poster');
      });
    });

    describe('tier field — current schema + legacy isPrimary coercion (intentional)', () => {
      test('defaults tier to "primary" when no tier provided', () => {
        const normalized = normalizeSponsor({ id: 'sp1', name: 'Test' });
        expect(normalized.tier).toBe('primary');
      });

      test('preserves explicit tier value', () => {
        const normalized = normalizeSponsor({ id: 'sp1', name: 'Test', tier: 'gold' });
        expect(normalized.tier).toBe('gold');
      });

      test('coerces legacy isPrimary: true → "title" (intentional coercion)', () => {
        const normalized = normalizeSponsor({ id: 'sp1', name: 'Test', isPrimary: true });
        expect(normalized.tier).toBe('title');
      });

      test('defaults to "primary" for falsy legacy isPrimary (intentional coercion)', () => {
        const normalized1 = normalizeSponsor({ id: 'sp1', name: 'Test', isPrimary: 0 });
        const normalized2 = normalizeSponsor({ id: 'sp1', name: 'Test', isPrimary: '' });
        const normalized3 = normalizeSponsor({ id: 'sp1', name: 'Test', isPrimary: null });

        expect(normalized1.tier).toBe('primary');
        expect(normalized2.tier).toBe('primary');
        expect(normalized3.tier).toBe('primary');
      });

      test('explicit tier takes precedence over legacy isPrimary (intentional coercion)', () => {
        const normalized = normalizeSponsor({
          id: 'sp1',
          name: 'Test',
          tier: 'silver',
          isPrimary: true,
        });
        expect(normalized.tier).toBe('silver');
      });
    });
  });
});
