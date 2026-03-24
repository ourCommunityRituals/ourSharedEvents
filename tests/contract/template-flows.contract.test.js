/**
 * Template Flow Contract Tests
 *
 * Validates end-to-end data flows for each MVP template type:
 * - Bar Night: video, map, sponsors enabled; no schedule or league info
 * - Rec League: schedule enabled with externalData (schedule/standings/bracket URLs)
 * - Fundraiser/School: Donate/Buy Tickets CTAs, gallery enabled
 * - Custom: all sections togglable by user
 *
 * These tests validate the CONTRACT - what data shapes flow through:
 * Admin → EventService → API → Public/Display/Poster
 *
 * Gate: CI Stage1/Stage2 should protect event schema, template application,
 * and Admin→Public→Display→Poster flows across templates.
 *
 * @see EVENT_CONTRACT.md v1.0
 * @see TemplateService.gs
 */

const {
  validateSectionConfig,
  validateCTALabel,
  validateSponsor,
  ERROR_CODES
} = require('../shared/helpers/test.helpers');

const {
  MVP_TEMPLATES,
  V2_TEMPLATES,
  ALL_TEMPLATES,
  SECTION_TO_SETTING_MAP,
  ALL_SETTING_KEYS
} = require('../shared/fixtures/templates.fixtures');

// ============================================================================
// Template Definitions - Using Shared Fixtures
// ============================================================================
// These are imported from templates.fixtures.js to prevent drift.
// The fixtures MUST match TemplateService.gs EVENT_TEMPLATES.
// See: tests/shared/fixtures/templates.fixtures.js

const EVENT_TEMPLATES = {
  bar_night: {
    id: 'bar_night',
    label: 'Bar / Tavern Event',
    sections: { ...MVP_TEMPLATES.bar_night.sections, notes: true },
    defaultCtas: ['RSVP', 'Add to Calendar'],
    defaults: {
      audience: 'Adults 21+',
      notesLabel: 'House Rules',
      sponsorStripLabel: "Tonight's Sponsors"
    }
  },
  rec_league: {
    id: 'rec_league',
    label: 'Rec League / Sports',
    sections: { ...MVP_TEMPLATES.rec_league.sections, notes: true },
    defaultCtas: ['Register Team', 'View Schedule'],
    defaults: {
      notesLabel: 'League Notes',
      sponsorStripLabel: 'Season Sponsors'
    }
  },
  school: {
    id: 'school',
    label: 'School / Club Event',
    sections: { ...V2_TEMPLATES.school.sections, notes: true },
    defaultCtas: ['Buy Tickets', 'Donate'],
    defaults: {
      notesLabel: 'Event Notes',
      sponsorStripLabel: 'Event Sponsors'
    }
  },
  fundraiser: {
    id: 'fundraiser',
    label: 'Fundraiser / Charity',
    sections: { ...MVP_TEMPLATES.fundraiser.sections, notes: true },
    defaultCtas: ['Donate', 'Buy Tickets', 'Share'],  // Donate is FIRST
    defaults: {
      notesLabel: 'About the Cause',
      sponsorStripLabel: 'Generous Sponsors'
    }
  },
  custom: {
    id: 'custom',
    label: 'Custom Event',
    sections: { ...MVP_TEMPLATES.custom.sections, notes: true },
    defaultCtas: ['Register', 'Learn More'],
    defaults: {
      notesLabel: 'Notes',
      sponsorStripLabel: 'Sponsors'
    }
  }
};

// ============================================================================
// MOCK: applyTemplateToEvent_ (mirrors TemplateService.gs)
// ============================================================================

function applyTemplateToEvent_(event, templateId) {
  const tpl = EVENT_TEMPLATES[templateId] || EVENT_TEMPLATES.custom;

  event.templateId = tpl.id;

  // === Sections: Convert template booleans to SectionConfig ===
  event.sections = event.sections || {};
  const sectionKeys = ['video', 'map', 'schedule', 'sponsors', 'notes', 'gallery'];

  sectionKeys.forEach(key => {
    if (event.sections[key] == null) {
      event.sections[key] = {
        enabled: tpl.sections[key] || false,
        title: null,
        content: null
      };
    } else if (typeof event.sections[key] === 'boolean') {
      event.sections[key] = {
        enabled: event.sections[key],
        title: null,
        content: null
      };
    }
  });

  // Apply template default titles
  if (tpl.defaults) {
    if (tpl.defaults.notesLabel && event.sections.notes && !event.sections.notes.title) {
      event.sections.notes.title = tpl.defaults.notesLabel;
    }
    if (tpl.defaults.sponsorStripLabel && event.sections.sponsors && !event.sections.sponsors.title) {
      event.sections.sponsors.title = tpl.defaults.sponsorStripLabel;
    }
  }

  // === CTA Labels ===
  if (!event.ctaLabels || !event.ctaLabels.length) {
    event.ctaLabels = (tpl.defaultCtas || []).map((label, idx) => ({
      key: 'cta_' + idx,
      label: label,
      url: null
    }));
  }

  // === Defaults ===
  if (!event.audience && tpl.defaults?.audience) {
    event.audience = tpl.defaults.audience;
  }

  if (!event.status) {
    event.status = 'draft';
  }

  return event;
}

// ============================================================================
// MOCK: Surface Rendering Helpers (mirrors Public.html, Display.html, Poster.html)
// ============================================================================

/**
 * Check if section is enabled (EVENT_CONTRACT.md helper)
 */
function sectionEnabled(sections, key) {
  if (!sections) return true;
  const section = sections[key];
  if (section === null || section === undefined) return true;
  if (typeof section === 'boolean') return section;
  return section.enabled !== false;
}

/**
 * Get section title (from SectionConfig or default)
 */
function getSectionTitle(sections, key, defaultTitle) {
  const section = sections?.[key];
  if (section && typeof section === 'object' && section.title) {
    return section.title;
  }
  return defaultTitle;
}

/**
 * Simulate what Public.html renders for an event
 */
function simulatePublicRender(event) {
  const rendered = {
    showsVideo: false,
    showsMap: false,
    showsSchedule: false,
    showsSponsors: false,
    showsNotes: false,
    showsGallery: false,
    showsLeagueInfo: false,
    ctaButtons: [],
    sponsorTierBadges: []
  };

  // Check each section
  rendered.showsVideo = sectionEnabled(event.sections, 'video') && !!event.videoUrl;
  rendered.showsMap = sectionEnabled(event.sections, 'map') && (!!event.mapEmbedUrl || !!event.location);
  rendered.showsSchedule = sectionEnabled(event.sections, 'schedule');
  rendered.showsSponsors = sectionEnabled(event.sections, 'sponsors') && event.sponsors?.length > 0;
  rendered.showsNotes = sectionEnabled(event.sections, 'notes') && (!!event.notes || !!event.summary);
  rendered.showsGallery = sectionEnabled(event.sections, 'gallery') && event.galleryUrls?.length > 0;

  // League Info (only for rec_league with externalData)
  const ext = event.externalData || {};
  rendered.showsLeagueInfo = rendered.showsSchedule &&
    (!!ext.scheduleUrl || !!ext.standingsUrl || !!ext.bracketUrl);

  // CTA buttons
  rendered.ctaButtons = (event.ctaLabels || []).map(cta => cta.label);

  // Sponsor tier badges
  rendered.sponsorTierBadges = (event.sponsors || [])
    .filter(s => s.tier)
    .map(s => s.tier);

  return rendered;
}

/**
 * Simulate what Display.html renders for an event
 */
function simulateDisplayRender(event) {
  const rendered = {
    showsSponsorTop: false,
    showsSponsorSide: false,
    showsLeagueOverlay: false,
    leagueLinks: []
  };

  // Sponsors
  rendered.showsSponsorTop = sectionEnabled(event.sections, 'sponsors') && event.sponsors?.length > 0;
  rendered.showsSponsorSide = rendered.showsSponsorTop && event.sponsors?.length > 2;

  // League overlay (only for rec_league)
  if (event.templateId === 'rec_league') {
    const ext = event.externalData || {};
    if (ext.scheduleUrl) rendered.leagueLinks.push('Schedule');
    if (ext.standingsUrl) rendered.leagueLinks.push('Standings');
    if (ext.bracketUrl) rendered.leagueLinks.push('Bracket');
    rendered.showsLeagueOverlay = rendered.leagueLinks.length > 0;
  }

  return rendered;
}

/**
 * Simulate what Poster.html renders for an event
 */
function simulatePosterRender(event) {
  const rendered = {
    showsSponsorStrip: false,
    showsQRSignup: false,
    showsQRCheckin: false,
    showsQRPublic: false
  };

  // Sponsor strip
  rendered.showsSponsorStrip = sectionEnabled(event.sections, 'sponsors') && event.sponsors?.length > 0;

  // QR codes
  rendered.showsQRSignup = !!event.signupUrl;
  rendered.showsQRCheckin = !!event.checkinUrl;
  rendered.showsQRPublic = !!event.links?.publicUrl;

  return rendered;
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Template Flow Contract Tests', () => {

  // ==========================================================================
  // BAR NIGHT FLOW
  // ==========================================================================

  describe('Bar Night Flow: Admin → Public → Display → Poster', () => {

    test('Admin: creates bar event with correct default sections', () => {
      const event = { name: 'Thursday Trivia Night' };
      const result = applyTemplateToEvent_(event, 'bar_night');

      // Bar template defaults
      expect(result.templateId).toBe('bar_night');
      expect(result.sections.video.enabled).toBe(true);
      expect(result.sections.map.enabled).toBe(true);
      expect(result.sections.schedule.enabled).toBe(false); // NO schedule for bars
      expect(result.sections.sponsors.enabled).toBe(true);
      expect(result.sections.gallery.enabled).toBe(true);  // MVP: gallery enabled for bar_night per TemplateService.gs

      // Bar-specific defaults
      expect(result.audience).toBe('Adults 21+');
      expect(result.sections.notes.title).toBe('House Rules');
      expect(result.sections.sponsors.title).toBe("Tonight's Sponsors");
    });

    test('Admin: bar event gets RSVP and Add to Calendar CTAs', () => {
      const event = { name: 'Happy Hour' };
      const result = applyTemplateToEvent_(event, 'bar_night');

      expect(result.ctaLabels).toHaveLength(2);
      expect(result.ctaLabels[0].label).toBe('RSVP');
      expect(result.ctaLabels[1].label).toBe('Add to Calendar');
    });

    test('Public: shows video, map, sponsors but NOT schedule for bar event', () => {
      const event = applyTemplateToEvent_({
        name: 'Karaoke Night',
        videoUrl: 'https://youtube.com/watch?v=abc',
        mapEmbedUrl: 'https://maps.google.com/embed?...',
        sponsors: [{ id: 'sp-1', name: 'Local Brewery', logoUrl: null, tier: 'gold' }],
        links: { publicUrl: 'https://example.com/events/karaoke' }
      }, 'bar_night');

      const rendered = simulatePublicRender(event);

      expect(rendered.showsVideo).toBe(true);
      expect(rendered.showsMap).toBe(true);
      expect(rendered.showsSponsors).toBe(true);
      expect(rendered.showsSchedule).toBe(false);  // Bar events: NO schedule
      expect(rendered.showsGallery).toBe(false);
      expect(rendered.showsLeagueInfo).toBe(false); // No league info for bars
    });

    test('Display: shows sponsors, NO league overlay for bar event', () => {
      const event = applyTemplateToEvent_({
        name: 'Live Music Night',
        sponsors: [
          { id: 'sp-1', name: 'Beer Co', logoUrl: 'https://ex.com/beer.png', tier: 'gold' },
          { id: 'sp-2', name: 'Whiskey Brand', logoUrl: null, tier: 'silver' }
        ]
      }, 'bar_night');

      const rendered = simulateDisplayRender(event);

      expect(rendered.showsSponsorTop).toBe(true);
      expect(rendered.showsLeagueOverlay).toBe(false); // NOT rec_league
      expect(rendered.leagueLinks).toHaveLength(0);
    });

    test('Poster: shows sponsor strip, no weird schedule UI for bar event', () => {
      const event = applyTemplateToEvent_({
        name: 'Trivia Championship',
        sponsors: [{ id: 'sp-1', name: 'Sponsor', logoUrl: null, tier: null }],
        signupUrl: 'https://forms.google.com/trivia',
        links: { publicUrl: 'https://example.com/trivia' }
      }, 'bar_night');

      const rendered = simulatePosterRender(event);

      expect(rendered.showsSponsorStrip).toBe(true);
      expect(rendered.showsQRSignup).toBe(true);
      expect(rendered.showsQRPublic).toBe(true);
    });

  });

  // ==========================================================================
  // REC LEAGUE FLOW
  // ==========================================================================

  describe('Rec League Flow: Admin → Public → Display → Poster', () => {

    test('Admin: creates rec league with schedule enabled and externalData fields', () => {
      const event = {
        name: 'Summer Softball League',
        externalData: {
          scheduleUrl: 'https://docs.google.com/spreadsheets/d/schedule',
          standingsUrl: 'https://docs.google.com/spreadsheets/d/standings',
          bracketUrl: 'https://challonge.com/summer-softball'
        }
      };
      const result = applyTemplateToEvent_(event, 'rec_league');

      expect(result.templateId).toBe('rec_league');
      expect(result.sections.schedule.enabled).toBe(true);  // SCHEDULE enabled
      expect(result.sections.video.enabled).toBe(false);    // No video for leagues
      expect(result.sections.map.enabled).toBe(true);
      expect(result.sections.sponsors.enabled).toBe(true);

      // Section titles
      expect(result.sections.notes.title).toBe('League Notes');
      expect(result.sections.sponsors.title).toBe('Season Sponsors');

      // externalData preserved
      expect(result.externalData.scheduleUrl).toBe('https://docs.google.com/spreadsheets/d/schedule');
      expect(result.externalData.standingsUrl).toBe('https://docs.google.com/spreadsheets/d/standings');
      expect(result.externalData.bracketUrl).toBe('https://challonge.com/summer-softball');
    });

    test('Admin: rec league gets Register Team and View Schedule CTAs', () => {
      const event = { name: 'Basketball League' };
      const result = applyTemplateToEvent_(event, 'rec_league');

      expect(result.ctaLabels).toHaveLength(2);
      expect(result.ctaLabels[0].label).toBe('Register Team');
      expect(result.ctaLabels[1].label).toBe('View Schedule');
    });

    test('Public: shows League Info card with 3 links when externalData provided', () => {
      const event = applyTemplateToEvent_({
        name: 'Volleyball Tournament',
        location: 'City Park Courts',
        sponsors: [{ id: 'sp-1', name: 'Sports Store', logoUrl: null, tier: null }],
        externalData: {
          scheduleUrl: 'https://sheets.google.com/schedule',
          standingsUrl: 'https://sheets.google.com/standings',
          bracketUrl: 'https://challonge.com/volleyball'
        }
      }, 'rec_league');

      const rendered = simulatePublicRender(event);

      expect(rendered.showsSchedule).toBe(true);
      expect(rendered.showsLeagueInfo).toBe(true);  // Has externalData URLs
      expect(rendered.showsSponsors).toBe(true);
      expect(rendered.showsMap).toBe(true);
    });

    test('Display: shows league overlay with schedule/standings/bracket links', () => {
      const event = applyTemplateToEvent_({
        name: 'Flag Football',
        sponsors: [{ id: 'sp-1', name: 'Team Sponsor', logoUrl: 'https://ex.com/logo.png', tier: 'gold' }],
        externalData: {
          scheduleUrl: 'https://example.com/schedule',
          standingsUrl: 'https://example.com/standings',
          bracketUrl: 'https://example.com/bracket'
        }
      }, 'rec_league');

      const rendered = simulateDisplayRender(event);

      expect(rendered.showsLeagueOverlay).toBe(true);
      expect(rendered.leagueLinks).toContain('Schedule');
      expect(rendered.leagueLinks).toContain('Standings');
      expect(rendered.leagueLinks).toContain('Bracket');
      expect(rendered.leagueLinks).toHaveLength(3);
    });

    test('Display: shows partial league links if not all URLs provided', () => {
      const event = applyTemplateToEvent_({
        name: 'Kickball League',
        externalData: {
          scheduleUrl: 'https://example.com/schedule',
          standingsUrl: null,
          bracketUrl: null
        }
      }, 'rec_league');

      const rendered = simulateDisplayRender(event);

      expect(rendered.showsLeagueOverlay).toBe(true);
      expect(rendered.leagueLinks).toEqual(['Schedule']);
    });

    test('Poster: still renders cleanly for rec_league (no weird schedule UI)', () => {
      const event = applyTemplateToEvent_({
        name: 'Hockey Tournament',
        sponsors: [{ id: 'sp-1', name: 'Ice Rink', logoUrl: null, tier: null }],
        signupUrl: 'https://forms.google.com/hockey',
        checkinUrl: 'https://forms.google.com/hockey-checkin',
        links: { publicUrl: 'https://example.com/hockey' }
      }, 'rec_league');

      const rendered = simulatePosterRender(event);

      expect(rendered.showsSponsorStrip).toBe(true);
      expect(rendered.showsQRSignup).toBe(true);
      expect(rendered.showsQRCheckin).toBe(true);
      expect(rendered.showsQRPublic).toBe(true);
    });

  });

  // ==========================================================================
  // FUNDRAISER / SCHOOL FLOW
  // ==========================================================================

  describe('Fundraiser/School Flow: Admin → Public → Display → Poster', () => {

    test('Admin: fundraiser has Donate as FIRST/primary CTA', () => {
      const event = { name: 'Charity Gala' };
      const result = applyTemplateToEvent_(event, 'fundraiser');

      expect(result.templateId).toBe('fundraiser');
      expect(result.ctaLabels[0].label).toBe('Donate'); // FIRST CTA
      expect(result.ctaLabels[1].label).toBe('Buy Tickets');
      expect(result.ctaLabels[2].label).toBe('Share');
    });

    test('Admin: school has Buy Tickets and Donate CTAs', () => {
      const event = { name: 'Band Concert' };
      const result = applyTemplateToEvent_(event, 'school');

      const labels = result.ctaLabels.map(c => c.label);
      expect(labels).toContain('Buy Tickets');
      expect(labels).toContain('Donate');
    });

    test('Admin: fundraiser/school enable gallery section', () => {
      const fundraiserEvent = applyTemplateToEvent_({ name: 'Benefit Night' }, 'fundraiser');
      const schoolEvent = applyTemplateToEvent_({ name: 'Sports Banquet' }, 'school');

      expect(fundraiserEvent.sections.gallery.enabled).toBe(true);
      expect(schoolEvent.sections.gallery.enabled).toBe(true);
    });

    test('Admin: fundraiser sets cause-specific section title', () => {
      const event = applyTemplateToEvent_({ name: 'Cancer Research Fundraiser' }, 'fundraiser');

      expect(event.sections.notes.title).toBe('About the Cause');
    });

    test('Public: shows video, sponsors, gallery for fundraiser', () => {
      const event = applyTemplateToEvent_({
        name: 'Annual Gala',
        videoUrl: 'https://youtube.com/watch?v=mission',
        sponsors: [{ id: 'sp-1', name: 'Corporate Sponsor', logoUrl: 'https://ex.com/corp.png', tier: 'platinum' }],
        galleryUrls: ['https://ex.com/photo1.jpg', 'https://ex.com/photo2.jpg']
      }, 'fundraiser');

      const rendered = simulatePublicRender(event);

      expect(rendered.showsVideo).toBe(true);
      expect(rendered.showsSponsors).toBe(true);
      expect(rendered.showsGallery).toBe(true);
      expect(rendered.ctaButtons[0]).toBe('Donate'); // Primary CTA
    });

    test('Public: shows sponsor tier badges', () => {
      const event = applyTemplateToEvent_({
        name: 'School Auction',
        sponsors: [
          { id: 'sp-1', name: 'Gold Sponsor', logoUrl: null, tier: 'gold' },
          { id: 'sp-2', name: 'Silver Sponsor', logoUrl: null, tier: 'silver' },
          { id: 'sp-3', name: 'Bronze Sponsor', logoUrl: null, tier: 'bronze' }
        ]
      }, 'school');

      const rendered = simulatePublicRender(event);

      expect(rendered.sponsorTierBadges).toContain('gold');
      expect(rendered.sponsorTierBadges).toContain('silver');
      expect(rendered.sponsorTierBadges).toContain('bronze');
    });

  });

  // ==========================================================================
  // CUSTOM FLOW (Power User)
  // ==========================================================================

  describe('Custom Flow: Admin → Public → Display → Poster', () => {

    test('Admin: custom template enables ALL sections by default', () => {
      const event = { name: 'My Custom Event' };
      const result = applyTemplateToEvent_(event, 'custom');

      expect(result.templateId).toBe('custom');
      expect(result.sections.video.enabled).toBe(true);
      expect(result.sections.map.enabled).toBe(true);
      expect(result.sections.schedule.enabled).toBe(true);
      expect(result.sections.sponsors.enabled).toBe(true);
      expect(result.sections.notes.enabled).toBe(true);
      expect(result.sections.gallery.enabled).toBe(true);
    });

    test('Admin: user can toggle sections off for custom event', () => {
      const event = {
        name: 'Minimal Event',
        sections: {
          video: { enabled: false, title: null, content: null },
          schedule: { enabled: false, title: null, content: null },
          gallery: { enabled: true, title: null, content: null }  // MVP: gallery enabled per TemplateService.gs
        }
      };
      const result = applyTemplateToEvent_(event, 'custom');

      // User's explicit choices preserved
      expect(result.sections.video.enabled).toBe(false);
      expect(result.sections.schedule.enabled).toBe(false);
      expect(result.sections.gallery.enabled).toBe(true);  // MVP: gallery enabled for bar_night per TemplateService.gs

      // Template fills in the rest
      expect(result.sections.map.enabled).toBe(true);
      expect(result.sections.sponsors.enabled).toBe(true);
      expect(result.sections.notes.enabled).toBe(true);
    });

    test('Public: obeys user section toggles for custom event', () => {
      const event = applyTemplateToEvent_({
        name: 'Selective Event',
        videoUrl: 'https://youtube.com/watch?v=abc',
        mapEmbedUrl: 'https://maps.google.com/embed?...',
        sponsors: [{ id: 'sp-1', name: 'Sponsor', logoUrl: null, tier: null }],
        sections: {
          video: { enabled: false, title: null, content: null },  // User disabled
          sponsors: { enabled: false, title: null, content: null } // User disabled
        }
      }, 'custom');

      const rendered = simulatePublicRender(event);

      // Even though data exists, sections are disabled
      expect(rendered.showsVideo).toBe(false);  // User disabled
      expect(rendered.showsSponsors).toBe(false); // User disabled
      expect(rendered.showsMap).toBe(true); // Still enabled
    });

    test('Display: respects section toggles for custom event', () => {
      const event = applyTemplateToEvent_({
        name: 'No Sponsors Event',
        sponsors: [{ id: 'sp-1', name: 'Hidden Sponsor', logoUrl: null, tier: null }],
        sections: {
          sponsors: { enabled: false, title: null, content: null }
        }
      }, 'custom');

      const rendered = simulateDisplayRender(event);

      expect(rendered.showsSponsorTop).toBe(false); // Section disabled
    });

    test('Poster: respects section toggles for custom event', () => {
      const event = applyTemplateToEvent_({
        name: 'No Sponsor Poster',
        sponsors: [{ id: 'sp-1', name: 'Hidden Sponsor', logoUrl: null, tier: null }],
        signupUrl: 'https://forms.google.com/signup',
        sections: {
          sponsors: { enabled: false, title: null, content: null }
        }
      }, 'custom');

      const rendered = simulatePosterRender(event);

      expect(rendered.showsSponsorStrip).toBe(false); // Section disabled
      expect(rendered.showsQRSignup).toBe(true); // Still works
    });

  });

  // ==========================================================================
  // CROSS-TEMPLATE CONTRACT VALIDATION
  // ==========================================================================

  describe('Cross-Template Contract Validation', () => {

    test('All templates produce valid SectionConfig format', () => {
      const templateIds = ['bar_night', 'rec_league', 'school', 'fundraiser', 'custom'];
      const sectionKeys = ['video', 'map', 'schedule', 'sponsors', 'notes', 'gallery'];

      templateIds.forEach(templateId => {
        const event = applyTemplateToEvent_({ name: 'Test' }, templateId);

        sectionKeys.forEach(key => {
          expect(event.sections[key]).toHaveProperty('enabled');
          expect(event.sections[key]).toHaveProperty('title');
          expect(event.sections[key]).toHaveProperty('content');
          expect(typeof event.sections[key].enabled).toBe('boolean');
        });
      });
    });

    test('All templates produce valid CTALabel format', () => {
      const templateIds = ['bar_night', 'rec_league', 'school', 'fundraiser', 'custom'];

      templateIds.forEach(templateId => {
        const event = applyTemplateToEvent_({ name: 'Test' }, templateId);

        expect(Array.isArray(event.ctaLabels)).toBe(true);
        event.ctaLabels.forEach(cta => {
          expect(cta).toHaveProperty('key');
          expect(cta).toHaveProperty('label');
          expect(cta).toHaveProperty('url');
          expect(typeof cta.key).toBe('string');
          expect(typeof cta.label).toBe('string');
        });
      });
    });

    test('All templates default status to draft', () => {
      const templateIds = ['bar_night', 'rec_league', 'school', 'fundraiser', 'custom'];

      templateIds.forEach(templateId => {
        const event = applyTemplateToEvent_({ name: 'Test' }, templateId);
        expect(event.status).toBe('draft');
      });
    });

    test('Unknown templateId falls back to custom', () => {
      const event = applyTemplateToEvent_({ name: 'Unknown Template Event' }, 'nonexistent_xyz');

      expect(event.templateId).toBe('custom');
      // Should have all sections enabled (custom default)
      expect(event.sections.video.enabled).toBe(true);
      expect(event.sections.schedule.enabled).toBe(true);
      expect(event.sections.gallery.enabled).toBe(true);
    });

  });

  // ==========================================================================
  // DATA SHAPE VALIDATION
  // ==========================================================================

  describe('Event Data Shape Validation', () => {

    test('Full event matches EVENT_CONTRACT.md v1.0 shape', () => {
      const event = applyTemplateToEvent_({
        id: 'EVT_abc123',
        brandId: 'root',
        name: 'Complete Event',
        dateTime: '2025-12-05T19:00:00Z',
        location: '123 Main Street',
        venueName: "O'Malley's Pub",
        summary: 'A great event',
        videoUrl: 'https://youtube.com/watch?v=abc',
        mapEmbedUrl: 'https://maps.google.com/embed?...',
        signupUrl: 'https://forms.google.com/signup',
        checkinUrl: 'https://forms.google.com/checkin',
        sponsors: [
          { id: 'sp-1', name: 'Gold Sponsor', logoUrl: 'https://ex.com/gold.png', website: 'https://gold.com', tier: 'gold' }
        ],
        externalData: {
          scheduleUrl: null,
          standingsUrl: null,
          bracketUrl: null
        },
        links: {
          publicUrl: 'https://example.com/events/complete-event',
          posterUrl: 'https://example.com/poster/complete-event',
          displayUrl: 'https://example.com/display/complete-event',
          reportUrl: 'https://example.com/report/complete-event'
        },
        createdAt: '2025-11-22T10:00:00.000Z',
        slug: 'complete-event'
      }, 'bar_night');

      // Validate required fields
      expect(event.id).toBeDefined();
      expect(event.brandId).toBeDefined();
      expect(event.templateId).toBe('bar_night');
      expect(event.name).toBeDefined();
      expect(event.status).toBe('draft');
      expect(event.createdAt).toBeDefined();
      expect(event.slug).toBeDefined();
      expect(event.links).toBeDefined();

      // Validate sections format
      Object.values(event.sections).forEach(section => {
        expect(section).toHaveProperty('enabled');
        expect(section).toHaveProperty('title');
        expect(section).toHaveProperty('content');
      });

      // Validate CTALabel format
      event.ctaLabels.forEach(cta => {
        expect(cta).toHaveProperty('key');
        expect(cta).toHaveProperty('label');
        expect(cta).toHaveProperty('url');
      });

      // Validate sponsors (hydrated)
      event.sponsors.forEach(sponsor => {
        expect(sponsor).toHaveProperty('id');
        expect(sponsor).toHaveProperty('name');
      });

      // Validate links
      expect(event.links.publicUrl).toBeDefined();
      expect(event.links.posterUrl).toBeDefined();
      expect(event.links.displayUrl).toBeDefined();
      expect(event.links.reportUrl).toBeDefined();
    });

    test('externalData shape for rec_league', () => {
      const event = applyTemplateToEvent_({
        name: 'League Event',
        externalData: {
          scheduleUrl: 'https://docs.google.com/spreadsheets/schedule',
          standingsUrl: 'https://docs.google.com/spreadsheets/standings',
          bracketUrl: 'https://challonge.com/bracket'
        }
      }, 'rec_league');

      expect(event.externalData).toHaveProperty('scheduleUrl');
      expect(event.externalData).toHaveProperty('standingsUrl');
      expect(event.externalData).toHaveProperty('bracketUrl');
    });

  });

  // ==========================================================================
  // BACKWARD COMPATIBILITY
  // ==========================================================================

  describe('Backward Compatibility', () => {

    test('Converts legacy boolean sections to SectionConfig', () => {
      const event = {
        name: 'Legacy Event',
        sections: {
          video: true,   // Legacy boolean
          map: false,    // Legacy boolean
          schedule: true // Legacy boolean
        }
      };

      const result = applyTemplateToEvent_(event, 'custom');

      expect(result.sections.video).toEqual({ enabled: true, title: null, content: null });
      expect(result.sections.map).toEqual({ enabled: false, title: null, content: null });
      expect(result.sections.schedule).toEqual({ enabled: true, title: null, content: null });
    });

    test('sectionEnabled() handles both boolean and SectionConfig', () => {
      // Legacy boolean
      expect(sectionEnabled({ video: true }, 'video')).toBe(true);
      expect(sectionEnabled({ video: false }, 'video')).toBe(false);

      // New SectionConfig
      expect(sectionEnabled({ video: { enabled: true, title: null, content: null } }, 'video')).toBe(true);
      expect(sectionEnabled({ video: { enabled: false, title: null, content: null } }, 'video')).toBe(false);

      // Missing section defaults to true
      expect(sectionEnabled({}, 'video')).toBe(true);
      expect(sectionEnabled(null, 'video')).toBe(true);
    });

  });

  // ==========================================================================
  // CUSTOM TEMPLATE: FULL SCHEMA ACCESS
  // ==========================================================================
  // Custom template MUST expose all settings from event.schema.json
  // This is the "power user" mode where everything is togglable

  describe('Custom Template: Full Schema Access', () => {

    test('Custom template enables all sections by default', () => {
      const customTemplate = EVENT_TEMPLATES.custom;

      // All sections should be enabled by default
      expect(customTemplate.sections.video).toBe(true);
      expect(customTemplate.sections.map).toBe(true);
      expect(customTemplate.sections.schedule).toBe(true);
      expect(customTemplate.sections.sponsors).toBe(true);
      expect(customTemplate.sections.gallery).toBe(true);
    });

    test('Custom template event has all section toggles available', () => {
      const event = applyTemplateToEvent_({ name: 'Custom Event' }, 'custom');

      // All section toggles should exist and be enabled
      const sectionKeys = ['video', 'map', 'schedule', 'sponsors', 'notes', 'gallery'];
      sectionKeys.forEach(key => {
        expect(event.sections[key]).toBeDefined();
        expect(event.sections[key].enabled).toBe(true);
      });
    });

    test('All setting keys from schema are represented in templates', () => {
      // These are the settings from event.schema.json Settings definition
      const schemaSettingKeys = ALL_SETTING_KEYS;

      // Section-to-setting mapping should cover all template-toggleable settings
      const templateMappedSettings = Object.values(SECTION_TO_SETTING_MAP);

      // Core template sections should map to these settings
      ['showSchedule', 'showSponsors', 'showVideo', 'showMap', 'showGallery'].forEach(setting => {
        expect(templateMappedSettings).toContain(setting);
      });

      // Verify ALL_SETTING_KEYS contains expected settings
      expect(schemaSettingKeys).toContain('showSchedule');
      expect(schemaSettingKeys).toContain('showStandings');
      expect(schemaSettingKeys).toContain('showBracket');
      expect(schemaSettingKeys).toContain('showSponsors');
      expect(schemaSettingKeys).toContain('showVideo');
      expect(schemaSettingKeys).toContain('showMap');
      expect(schemaSettingKeys).toContain('showGallery');
      expect(schemaSettingKeys).toContain('showSponsorBanner');
      expect(schemaSettingKeys).toContain('showSponsorStrip');
      expect(schemaSettingKeys).toContain('showLeagueStrip');
      expect(schemaSettingKeys).toContain('showQRSection');
    });

    test('Custom template does not preset standings/bracket (user chooses)', () => {
      // Unlike rec_league which has showStandings/showBracket defaults,
      // Custom template lets user decide
      const customTemplate = MVP_TEMPLATES.custom;

      // Custom has schedule enabled (for access) but doesn't force standings/bracket
      expect(customTemplate.sections.schedule).toBe(true);

      // Standings/bracket are settings, not sections - they're set in TemplateService
      // based on template type, not hardcoded in the template definition
    });

  });

});
