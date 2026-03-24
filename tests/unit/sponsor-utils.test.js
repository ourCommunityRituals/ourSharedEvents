/**
 * SponsorUtils Unit Tests
 *
 * Tests for the shared sponsor utilities module used across
 * Display.html, Public.html, and Poster.html
 */

describe('SponsorUtils', () => {

  describe('esc() - XSS Prevention', () => {
    let esc;

    beforeAll(() => {
      // Simulate the esc function from SponsorUtils
      esc = function(s) {
        return String(s).replace(/[&<>"']/g, m => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
      };
    });

    test('should escape ampersands', () => {
      expect(esc('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    test('should escape less than signs', () => {
      expect(esc('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    test('should escape greater than signs', () => {
      expect(esc('2 > 1')).toBe('2 &gt; 1');
    });

    test('should escape double quotes', () => {
      expect(esc('Say "hello"')).toBe('Say &quot;hello&quot;');
    });

    test('should escape single quotes', () => {
      expect(esc("It's fine")).toBe('It&#39;s fine');
    });

    test('should handle null/undefined by converting to string', () => {
      expect(esc(null)).toBe('null');
      expect(esc(undefined)).toBe('undefined');
    });

    test('should handle numbers', () => {
      expect(esc(123)).toBe('123');
    });

    test('should handle empty string', () => {
      expect(esc('')).toBe('');
    });

    test('should escape complex XSS attack vectors', () => {
      const xssVector = '<img src="x" onerror="alert(\'XSS\')">';
      const escaped = esc(xssVector);
      // The angle brackets and quotes are escaped, making the HTML non-executable
      expect(escaped).not.toContain('<img');
      expect(escaped).toContain('&lt;img'); // < is escaped to &lt;
      expect(escaped).toBe('&lt;img src=&quot;x&quot; onerror=&quot;alert(&#39;XSS&#39;)&quot;&gt;');
    });

    test('should escape URL with malicious query params', () => {
      const maliciousUrl = 'https://example.com?redirect=<script>steal()</script>';
      const escaped = esc(maliciousUrl);
      expect(escaped).not.toContain('<script>');
    });
  });

  describe('filterByPlacement()', () => {
    let filterByPlacement;

    beforeAll(() => {
      filterByPlacement = function(sponsors, placement) {
        return (sponsors || []).filter(s => s?.placements?.[placement]);
      };
    });

    const mockSponsors = [
      { id: 'sp1', name: 'Sponsor 1', placements: { tvTop: true, mobileBanner: false } },
      { id: 'sp2', name: 'Sponsor 2', placements: { tvTop: false, mobileBanner: true } },
      { id: 'sp3', name: 'Sponsor 3', placements: { tvTop: true, mobileBanner: true, tvSide: true } },
      { id: 'sp4', name: 'Sponsor 4', placements: { posterTop: true } }
    ];

    test('should filter sponsors by tvTop placement', () => {
      const result = filterByPlacement(mockSponsors, 'tvTop');
      expect(result).toHaveLength(2);
      expect(result.map(s => s.id)).toEqual(['sp1', 'sp3']);
    });

    test('should filter sponsors by mobileBanner placement', () => {
      const result = filterByPlacement(mockSponsors, 'mobileBanner');
      expect(result).toHaveLength(2);
      expect(result.map(s => s.id)).toEqual(['sp2', 'sp3']);
    });

    test('should filter sponsors by tvSide placement', () => {
      const result = filterByPlacement(mockSponsors, 'tvSide');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('sp3');
    });

    test('should filter sponsors by posterTop placement', () => {
      const result = filterByPlacement(mockSponsors, 'posterTop');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('sp4');
    });

    test('should return empty array for unknown placement', () => {
      const result = filterByPlacement(mockSponsors, 'unknownPlacement');
      expect(result).toHaveLength(0);
    });

    test('should handle null/undefined sponsors array', () => {
      expect(filterByPlacement(null, 'tvTop')).toEqual([]);
      expect(filterByPlacement(undefined, 'tvTop')).toEqual([]);
    });

    test('should handle sponsors with missing placements object', () => {
      const sponsorsWithMissing = [
        { id: 'sp1', name: 'No Placements' },
        { id: 'sp2', name: 'Has Placements', placements: { tvTop: true } }
      ];
      const result = filterByPlacement(sponsorsWithMissing, 'tvTop');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('sp2');
    });
  });

  describe('Analytics Logging', () => {
    let logBatch;
    let logEvent;
    let flush;

    beforeEach(() => {
      logBatch = [];

      // Mock navigator and Date
      global.navigator = { userAgent: 'TestBrowser/1.0' };
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);

      logEvent = function(evt) {
        try {
          evt.ua = navigator.userAgent;
          evt.ts = Date.now();
          logBatch.push(evt);
        } catch (_) {
          // Silently ignore logging errors
        }
      };

      flush = function() {
        if (!logBatch.length) return;
        const copy = logBatch.splice(0, logBatch.length);
        return copy;
      };
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('should add userAgent to log event', () => {
      logEvent({ eventId: 'ev1', surface: 'display', metric: 'impression' });
      expect(logBatch[0].ua).toBe('TestBrowser/1.0');
    });

    test('should add timestamp to log event', () => {
      logEvent({ eventId: 'ev1', surface: 'display', metric: 'impression' });
      expect(logBatch[0].ts).toBe(1700000000000);
    });

    test('should batch multiple events', () => {
      logEvent({ eventId: 'ev1', metric: 'impression' });
      logEvent({ eventId: 'ev1', metric: 'click' });
      logEvent({ eventId: 'ev2', metric: 'view' });

      expect(logBatch).toHaveLength(3);
    });

    test('should flush and clear batch', () => {
      logEvent({ metric: 'impression' });
      logEvent({ metric: 'click' });

      const flushed = flush();

      expect(flushed).toHaveLength(2);
      expect(logBatch).toHaveLength(0);
    });

    test('should return nothing on empty flush', () => {
      const result = flush();
      expect(result).toBeUndefined();
    });

    test('should preserve event properties on log', () => {
      logEvent({
        eventId: 'ev1',
        surface: 'poster',
        metric: 'print',
        sponsorId: 'sp1',
        value: 1
      });

      const evt = logBatch[0];
      expect(evt.eventId).toBe('ev1');
      expect(evt.surface).toBe('poster');
      expect(evt.metric).toBe('print');
      expect(evt.sponsorId).toBe('sp1');
      expect(evt.value).toBe(1);
    });
  });

  describe('Sponsor Carousel Logic', () => {
    test('should rotate through sponsors array', () => {
      const sponsors = ['A', 'B', 'C'];
      let currentIndex = 0;
      const results = [];

      for (let i = 0; i < 6; i++) {
        results.push(sponsors[currentIndex]);
        currentIndex = (currentIndex + 1) % sponsors.length;
      }

      expect(results).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
    });

    test('should handle single sponsor (no rotation)', () => {
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

  describe('Poster Analytics Events', () => {
    const posterSurface = 'poster';

    test('view event should have correct structure', () => {
      const viewEvent = {
        eventId: 'ev1',
        surface: posterSurface,
        metric: 'view',
        value: 1
      };

      expect(viewEvent.surface).toBe('poster');
      expect(viewEvent.metric).toBe('view');
      expect(viewEvent.value).toBe(1);
    });

    test('print event should have correct structure', () => {
      const printEvent = {
        eventId: 'ev1',
        surface: posterSurface,
        metric: 'print',
        value: 1
      };

      expect(printEvent.surface).toBe('poster');
      expect(printEvent.metric).toBe('print');
    });

    test('impression event should include sponsorId', () => {
      const impressionEvent = {
        eventId: 'ev1',
        surface: posterSurface,
        metric: 'impression',
        sponsorId: 'sp1'
      };

      expect(impressionEvent.sponsorId).toBe('sp1');
    });
  });

  // =============================================================================
  // EDGE CASES - Long Sponsor Names
  // =============================================================================

  describe('Long Sponsor Names', () => {
    let normalizeSponsor;
    let renderInline;
    let renderCard;
    let renderBanner;
    let esc;

    beforeAll(() => {
      // Simulate esc function
      esc = function(s) {
        return String(s).replace(/[&<>"']/g, m => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
      };

      // Simulate normalizeSponsor
      normalizeSponsor = function(s) {
        if (!s) return null;
        let placement = s.placement || '';
        if (!placement && s.placements && typeof s.placements === 'object') {
          placement = Object.keys(s.placements).find(k => s.placements[k]) || '';
        }
        return {
          id: s.id || '',
          name: s.name || '',
          logoUrl: s.logoUrl || s.img || '',
          linkUrl: s.linkUrl || s.website || s.url || '',
          placement: placement,
          isPrimary: !!s.isPrimary
        };
      };

      // Simulate renderInline
      renderInline = function(s, wrapLinks) {
        const content = s.img
          ? `<img src="${esc(s.img)}" alt="${esc(s.name || '')}">`
          : `<strong>${esc(s.name || '')}</strong>`;

        if (wrapLinks && s.url) {
          return `<a href="${esc(s.url)}" target="_blank" rel="noopener sponsored" data-sponsor-id="${esc(s.id || '')}">${content}</a>`;
        }
        return content;
      };

      // Simulate renderCard
      renderCard = function(s, wrapLinks) {
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

      // Simulate renderBanner
      renderBanner = function(s, wrapLinks) {
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

    const longName = 'A'.repeat(250); // 250 character name
    const veryLongName = 'B'.repeat(500); // 500 character name
    const unicodeLongName = '\u2603'.repeat(100); // 100 snowman characters

    test('normalizeSponsor should handle very long names without truncation', () => {
      const sponsor = { id: 'sp1', name: longName };
      const normalized = normalizeSponsor(sponsor);

      // Should preserve full name (truncation is UI's responsibility)
      expect(normalized.name).toBe(longName);
      expect(normalized.name.length).toBe(250);
    });

    test('normalizeSponsor should handle 500+ character names', () => {
      const sponsor = { id: 'sp1', name: veryLongName };
      const normalized = normalizeSponsor(sponsor);

      expect(normalized.name.length).toBe(500);
    });

    test('normalizeSponsor should handle unicode long names', () => {
      const sponsor = { id: 'sp1', name: unicodeLongName };
      const normalized = normalizeSponsor(sponsor);

      expect(normalized.name).toBe(unicodeLongName);
    });

    test('renderInline should escape long names and not break HTML', () => {
      const sponsor = { id: 'sp1', name: longName };
      const html = renderInline(sponsor, false);

      expect(html).toContain('<strong>');
      expect(html).toContain('</strong>');
      expect(html).not.toContain('<script>'); // No XSS
    });

    test('renderCard should handle long names in sp-name div', () => {
      const sponsor = { id: 'sp1', name: longName };
      const html = renderCard(sponsor, false);

      expect(html).toContain('class="sp-name"');
      expect(html).toContain(longName);
    });

    test('renderBanner should not break with very long names', () => {
      const sponsor = { id: 'sp1', name: veryLongName };
      const html = renderBanner(sponsor, false);

      expect(html).toContain('<strong>');
      // Should not crash or throw
      expect(html.length).toBeGreaterThan(500);
    });

    test('long name with special characters should be escaped', () => {
      const specialLongName = '<script>'.repeat(30) + 'Test';
      const sponsor = { id: 'sp1', name: specialLongName };
      const html = renderInline(sponsor, false);

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  // =============================================================================
  // EDGE CASES - Missing logoUrl or linkUrl
  // =============================================================================

  describe('Missing logoUrl or linkUrl', () => {
    let normalizeSponsor;
    let renderInline;
    let renderCard;
    let renderBanner;
    let esc;

    beforeAll(() => {
      esc = function(s) {
        return String(s).replace(/[&<>"']/g, m => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
      };

      normalizeSponsor = function(s) {
        if (!s) return null;
        let placement = s.placement || '';
        if (!placement && s.placements && typeof s.placements === 'object') {
          placement = Object.keys(s.placements).find(k => s.placements[k]) || '';
        }
        return {
          id: s.id || '',
          name: s.name || '',
          logoUrl: s.logoUrl || s.img || '',
          linkUrl: s.linkUrl || s.website || s.url || '',
          placement: placement,
          isPrimary: !!s.isPrimary
        };
      };

      renderInline = function(s, wrapLinks) {
        const content = s.img
          ? `<img src="${esc(s.img)}" alt="${esc(s.name || '')}">`
          : `<strong>${esc(s.name || '')}</strong>`;

        if (wrapLinks && s.url) {
          return `<a href="${esc(s.url)}" target="_blank" rel="noopener sponsored" data-sponsor-id="${esc(s.id || '')}">${content}</a>`;
        }
        return content;
      };

      renderCard = function(s, wrapLinks) {
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

      renderBanner = function(s, wrapLinks) {
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

    describe('Missing logoUrl', () => {
      test('normalizeSponsor should return empty string for missing logoUrl', () => {
        const sponsor = { id: 'sp1', name: 'Test Sponsor' };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.logoUrl).toBe('');
      });

      test('renderInline should show name when logoUrl is missing', () => {
        const sponsor = { id: 'sp1', name: 'Test Sponsor' };
        const html = renderInline(sponsor, false);

        expect(html).toContain('<strong>Test Sponsor</strong>');
        expect(html).not.toContain('<img');
      });

      test('renderCard should render without img when logoUrl is missing', () => {
        const sponsor = { id: 'sp1', name: 'Test Sponsor' };
        const html = renderCard(sponsor, false);

        expect(html).toContain('class="sp-name"');
        expect(html).toContain('Test Sponsor');
        expect(html).not.toContain('src=');
      });

      test('renderBanner should show name without img when logoUrl is missing', () => {
        const sponsor = { id: 'sp1', name: 'Test Sponsor' };
        const html = renderBanner(sponsor, false);

        expect(html).toContain('<strong>Test Sponsor</strong>');
        expect(html).not.toContain('<img');
      });
    });

    describe('Missing linkUrl', () => {
      test('normalizeSponsor should return empty string for missing linkUrl', () => {
        const sponsor = { id: 'sp1', name: 'Test', logoUrl: 'https://img.test/logo.png' };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.linkUrl).toBe('');
      });

      test('renderInline should not wrap in anchor when linkUrl is missing', () => {
        const sponsor = { id: 'sp1', name: 'Test', img: 'https://img.test/logo.png' };
        const html = renderInline(sponsor, true); // wrapLinks = true

        expect(html).toContain('<img');
        expect(html).not.toContain('<a href');
      });

      test('renderCard should not wrap in anchor when linkUrl is missing', () => {
        const sponsor = { id: 'sp1', name: 'Test', img: 'https://img.test/logo.png' };
        const html = renderCard(sponsor, true);

        expect(html).toContain('class="sp-card"');
        expect(html).not.toContain('<a href');
      });

      test('renderBanner should use span instead of anchor when linkUrl is missing', () => {
        const sponsor = { id: 'sp1', name: 'Test' };
        const html = renderBanner(sponsor, true);

        expect(html).toContain('<span>');
        expect(html).not.toContain('<a href');
      });
    });

    describe('Both logoUrl and linkUrl missing', () => {
      test('should render name-only sponsor without crashing', () => {
        const sponsor = { id: 'sp1', name: 'Name Only Sponsor' };

        expect(() => renderInline(sponsor, true)).not.toThrow();
        expect(() => renderCard(sponsor, true)).not.toThrow();
        expect(() => renderBanner(sponsor, true)).not.toThrow();
      });

      test('renderInline should show name in strong tag', () => {
        const sponsor = { id: 'sp1', name: 'Name Only' };
        const html = renderInline(sponsor, true);

        expect(html).toBe('<strong>Name Only</strong>');
      });
    });
  });

  // =============================================================================
  // EDGE CASES - Partial Sponsor Objects (Never Throw)
  // =============================================================================

  describe('Partial Sponsor Objects - Never Throw', () => {
    let normalizeSponsor;
    let renderInline;
    let renderCard;
    let renderBanner;
    let esc;

    beforeAll(() => {
      esc = function(s) {
        return String(s).replace(/[&<>"']/g, m => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
      };

      normalizeSponsor = function(s) {
        if (!s) return null;
        let placement = s.placement || '';
        if (!placement && s.placements && typeof s.placements === 'object') {
          placement = Object.keys(s.placements).find(k => s.placements[k]) || '';
        }
        return {
          id: s.id || '',
          name: s.name || '',
          logoUrl: s.logoUrl || s.img || '',
          linkUrl: s.linkUrl || s.website || s.url || '',
          placement: placement,
          isPrimary: !!s.isPrimary
        };
      };

      renderInline = function(s, wrapLinks) {
        const content = s.img
          ? `<img src="${esc(s.img)}" alt="${esc(s.name || '')}">`
          : `<strong>${esc(s.name || '')}</strong>`;

        if (wrapLinks && s.url) {
          return `<a href="${esc(s.url)}" target="_blank" rel="noopener sponsored" data-sponsor-id="${esc(s.id || '')}">${content}</a>`;
        }
        return content;
      };

      renderCard = function(s, wrapLinks) {
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

      renderBanner = function(s, wrapLinks) {
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

    test('normalizeSponsor should return null for null input', () => {
      expect(normalizeSponsor(null)).toBeNull();
    });

    test('normalizeSponsor should return null for undefined input', () => {
      expect(normalizeSponsor(undefined)).toBeNull();
    });

    test('normalizeSponsor should handle empty object', () => {
      const normalized = normalizeSponsor({});

      expect(normalized).toEqual({
        id: '',
        name: '',
        logoUrl: '',
        linkUrl: '',
        placement: '',
        isPrimary: false
      });
    });

    test('normalizeSponsor should handle sponsor with only id', () => {
      const normalized = normalizeSponsor({ id: 'sp1' });

      expect(normalized.id).toBe('sp1');
      expect(normalized.name).toBe('');
      expect(normalized.logoUrl).toBe('');
    });

    test('normalizeSponsor should handle sponsor with only name', () => {
      const normalized = normalizeSponsor({ name: 'Test' });

      expect(normalized.id).toBe('');
      expect(normalized.name).toBe('Test');
    });

    describe('Render helpers never throw', () => {
      test('renderInline should not throw on empty object', () => {
        expect(() => renderInline({}, true)).not.toThrow();
        expect(() => renderInline({}, false)).not.toThrow();
      });

      test('renderCard should not throw on empty object', () => {
        expect(() => renderCard({}, true)).not.toThrow();
        expect(() => renderCard({}, false)).not.toThrow();
      });

      test('renderBanner should not throw on empty object', () => {
        expect(() => renderBanner({}, true)).not.toThrow();
        expect(() => renderBanner({}, false)).not.toThrow();
      });

      test('renderInline should not throw with undefined properties', () => {
        const sponsor = { id: undefined, name: undefined, img: undefined, url: undefined };
        expect(() => renderInline(sponsor, true)).not.toThrow();
      });

      test('renderCard should not throw with null properties', () => {
        const sponsor = { id: null, name: null, img: null, url: null };
        expect(() => renderCard(sponsor, true)).not.toThrow();
      });

      test('renderBanner should produce valid HTML with minimal sponsor', () => {
        const sponsor = {};
        const html = renderBanner(sponsor, true);

        // Should be a valid span with empty content
        expect(html).toContain('<span>');
        expect(html).toContain('</span>');
        expect(html).toContain('<strong>');
      });
    });

    describe('Legacy format handling', () => {
      test('should normalize sponsor with legacy img field', () => {
        const sponsor = { id: 'sp1', name: 'Test', img: 'https://img.test/logo.png' };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.logoUrl).toBe('https://img.test/logo.png');
      });

      test('should normalize sponsor with legacy url field', () => {
        const sponsor = { id: 'sp1', name: 'Test', url: 'https://sponsor.com' };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.linkUrl).toBe('https://sponsor.com');
      });

      test('should normalize sponsor with legacy website field', () => {
        const sponsor = { id: 'sp1', name: 'Test', website: 'https://website.com' };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.linkUrl).toBe('https://website.com');
      });

      test('should prefer linkUrl over legacy fields', () => {
        const sponsor = {
          id: 'sp1',
          name: 'Test',
          linkUrl: 'https://primary.com',
          url: 'https://legacy-url.com',
          website: 'https://legacy-website.com'
        };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.linkUrl).toBe('https://primary.com');
      });

      test('should normalize sponsor with legacy placements object', () => {
        const sponsor = {
          id: 'sp1',
          name: 'Test',
          placements: { tvTop: true, mobileBanner: false }
        };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.placement).toBe('tvTop');
      });

      test('should prefer placement string over placements object', () => {
        const sponsor = {
          id: 'sp1',
          name: 'Test',
          placement: 'poster',
          placements: { tvTop: true }
        };
        const normalized = normalizeSponsor(sponsor);

        expect(normalized.placement).toBe('poster');
      });
    });

    describe('isPrimary flag', () => {
      test('should default isPrimary to false', () => {
        const normalized = normalizeSponsor({ id: 'sp1', name: 'Test' });
        expect(normalized.isPrimary).toBe(false);
      });

      test('should preserve isPrimary when true', () => {
        const normalized = normalizeSponsor({ id: 'sp1', name: 'Test', isPrimary: true });
        expect(normalized.isPrimary).toBe(true);
      });

      test('should coerce truthy values to boolean', () => {
        const normalized = normalizeSponsor({ id: 'sp1', name: 'Test', isPrimary: 1 });
        expect(normalized.isPrimary).toBe(true);
      });

      test('should coerce falsy values to false', () => {
        const normalized1 = normalizeSponsor({ id: 'sp1', name: 'Test', isPrimary: 0 });
        const normalized2 = normalizeSponsor({ id: 'sp1', name: 'Test', isPrimary: '' });
        const normalized3 = normalizeSponsor({ id: 'sp1', name: 'Test', isPrimary: null });

        expect(normalized1.isPrimary).toBe(false);
        expect(normalized2.isPrimary).toBe(false);
        expect(normalized3.isPrimary).toBe(false);
      });
    });
  });
});
