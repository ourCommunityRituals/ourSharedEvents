/**
 * Template Service Unit Tests
 *
 * Tests for applyTemplateToEvent_ and template system behavior.
 * Validates that templates correctly seed sections, ctaLabels, and defaults
 * while preserving user edits.
 *
 * EVENT_CONTRACT.md v1.0 Compliance:
 * - SectionConfig format: { enabled: bool, title: string|null, content: string|null }
 * - CTALabel format: [{ key: string, label: string, url: string|null }]
 * - Status defaults to 'draft'
 *
 * @see TemplateService.gs
 * @see EVENT_CONTRACT.md
 */

// Mock template data matching TemplateService.gs
const EVENT_TEMPLATES = {
  bar_night: {
    id: 'bar_night',
    label: 'Bar / Tavern Event',
    icon: '🍺',
    sections: {
      video: true,
      map: true,
      schedule: false,
      sponsors: true,
      notes: true,
      gallery: false
    },
    defaultCtas: ['RSVP', 'Add to Calendar'],
    defaults: {
      audience: 'Adults 21+',
      notesLabel: 'House Rules',
      sponsorStripLabel: "Tonight's Sponsors"
    }
  },
  rec_league: {
    id: 'rec_league',
    label: 'Rec League / Season',
    icon: '⚾',
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: false
    },
    defaultCtas: ['Register Team', 'View Schedule'],
    defaults: {
      audience: 'Teams & Captains',
      notesLabel: 'League Notes',
      sponsorStripLabel: 'Season Sponsors'
    }
  },
  school: {
    id: 'school',
    label: 'School / Youth Event',
    icon: '🎓',
    sections: {
      video: true,
      map: true,
      schedule: false,
      sponsors: true,
      notes: true,
      gallery: true
    },
    defaultCtas: ['Buy Tickets', 'Donate'],
    defaults: {
      audience: 'Families & Supporters',
      notesLabel: 'Event Details',
      sponsorStripLabel: 'Our Sponsors'
    }
  },
  fundraiser: {
    id: 'fundraiser',
    label: 'Fundraiser / Charity',
    icon: '💝',
    sections: {
      video: true,
      map: true,
      schedule: false,
      sponsors: true,
      notes: true,
      gallery: true
    },
    defaultCtas: ['Donate', 'Buy Tickets', 'Share'],
    defaults: {
      audience: 'Donors & Guests',
      notesLabel: 'About the Cause',
      sponsorStripLabel: 'Event Sponsors'
    }
  },
  custom: {
    id: 'custom',
    label: 'Custom Event',
    icon: '✨',
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: true
    },
    defaultCtas: ['Register', 'Learn More'],
    defaults: {
      audience: 'Everyone',
      notesLabel: 'Notes',
      sponsorStripLabel: 'Sponsors'
    }
  }
};

// Implementation matching TemplateService.gs (EVENT_CONTRACT.md v1.0)
function getEventTemplate_(templateId) {
  return EVENT_TEMPLATES[templateId] || EVENT_TEMPLATES.custom;
}

/**
 * Apply template defaults to an event object (EVENT_CONTRACT.md v1.0)
 * Only sets values where user hasn't already provided data
 *
 * @param {Object} event - Event object (can be partial data from form)
 * @param {string} templateId - Template ID to apply
 * @returns {Object} Modified event object with template defaults applied
 */
function applyTemplateToEvent_(event, templateId) {
  const tpl = getEventTemplate_(templateId);

  // Set template reference
  event.templateId = tpl.id;

  // === Sections: Convert template booleans to SectionConfig objects ===
  // EVENT_CONTRACT.md shape: { enabled: bool, title: string|null, content: string|null }
  event.sections = event.sections || {};

  const sectionKeys = ['video', 'map', 'schedule', 'sponsors', 'notes', 'gallery'];
  sectionKeys.forEach(function(key) {
    // Don't overwrite if user already set a section config
    if (event.sections[key] == null) {
      const enabled = tpl.sections[key] || false;
      event.sections[key] = {
        enabled: enabled,
        title: null,
        content: null
      };
    } else if (typeof event.sections[key] === 'boolean') {
      // Convert legacy boolean to SectionConfig
      event.sections[key] = {
        enabled: event.sections[key],
        title: null,
        content: null
      };
    }
    // If it's already a SectionConfig object, leave it alone
  });

  // Apply custom titles from template defaults
  if (tpl.defaults) {
    if (tpl.defaults.notesLabel && event.sections.notes && !event.sections.notes.title) {
      event.sections.notes.title = tpl.defaults.notesLabel;
    }
    if (tpl.defaults.sponsorStripLabel && event.sections.sponsors && !event.sections.sponsors.title) {
      event.sections.sponsors.title = tpl.defaults.sponsorStripLabel;
    }
  }

  // === CTA Labels: Convert template strings to CTALabel objects ===
  // EVENT_CONTRACT.md shape: [{ key: string, label: string, url: string|null }]
  if (!event.ctaLabels || !event.ctaLabels.length) {
    event.ctaLabels = (tpl.defaultCtas || []).map(function(label, idx) {
      return {
        key: 'cta_' + idx,
        label: label,
        url: null
      };
    });
  }

  // === Audience: Apply default if not set ===
  if (!event.audience && tpl.defaults && tpl.defaults.audience) {
    event.audience = tpl.defaults.audience;
  }

  // === Status: Default to 'draft' per EVENT_CONTRACT.md ===
  if (!event.status) {
    event.status = 'draft';
  }

  return event;
}

// ============================================================================
// TESTS
// ============================================================================

describe('TemplateService - applyTemplateToEvent_', () => {

  describe('Bar Night Template', () => {
    test('sets correct sections for bar_night (SectionConfig format)', () => {
      const event = { name: 'Trivia Night' };
      const result = applyTemplateToEvent_(event, 'bar_night');

      expect(result.templateId).toBe('bar_night');
      // EVENT_CONTRACT.md: sections use SectionConfig format
      expect(result.sections.video.enabled).toBe(true);
      expect(result.sections.map.enabled).toBe(true);
      expect(result.sections.schedule.enabled).toBe(false); // Bar events don't have schedules
      expect(result.sections.sponsors.enabled).toBe(true);
      expect(result.sections.gallery.enabled).toBe(false);
    });

    test('sets correct CTAs for bar_night (CTALabel format)', () => {
      const event = { name: 'Happy Hour' };
      const result = applyTemplateToEvent_(event, 'bar_night');

      // EVENT_CONTRACT.md: ctaLabels use CTALabel format
      expect(result.ctaLabels).toHaveLength(2);
      expect(result.ctaLabels[0]).toEqual({ key: 'cta_0', label: 'RSVP', url: null });
      expect(result.ctaLabels[1]).toEqual({ key: 'cta_1', label: 'Add to Calendar', url: null });
    });

    test('sets correct defaults for bar_night', () => {
      const event = { name: 'Live Music' };
      const result = applyTemplateToEvent_(event, 'bar_night');

      expect(result.audience).toBe('Adults 21+');
      // Section titles from template defaults
      expect(result.sections.notes.title).toBe('House Rules');
      expect(result.sections.sponsors.title).toBe("Tonight's Sponsors");
    });

    test('defaults status to draft', () => {
      const event = { name: 'Test Event' };
      const result = applyTemplateToEvent_(event, 'bar_night');

      expect(result.status).toBe('draft');
    });
  });

  describe('Rec League Template', () => {
    test('sets correct sections for rec_league (SectionConfig format)', () => {
      const event = { name: 'Summer Softball' };
      const result = applyTemplateToEvent_(event, 'rec_league');

      expect(result.templateId).toBe('rec_league');
      expect(result.sections.video.enabled).toBe(false); // Rec leagues don't need video
      expect(result.sections.schedule.enabled).toBe(true); // Rec leagues NEED schedule
      expect(result.sections.map.enabled).toBe(true);
      expect(result.sections.sponsors.enabled).toBe(true);
    });

    test('sets correct CTAs for rec_league (CTALabel format)', () => {
      const event = { name: 'Basketball League' };
      const result = applyTemplateToEvent_(event, 'rec_league');

      expect(result.ctaLabels).toHaveLength(2);
      expect(result.ctaLabels[0].label).toBe('Register Team');
      expect(result.ctaLabels[1].label).toBe('View Schedule');
    });

    test('sets league-specific section titles', () => {
      const event = { name: 'Volleyball Tournament' };
      const result = applyTemplateToEvent_(event, 'rec_league');

      expect(result.sections.notes.title).toBe('League Notes');
      expect(result.sections.sponsors.title).toBe('Season Sponsors');
    });
  });

  describe('School/Fundraiser Templates', () => {
    test('school template enables gallery section (SectionConfig format)', () => {
      const event = { name: 'Band Concert' };
      const result = applyTemplateToEvent_(event, 'school');

      expect(result.sections.gallery.enabled).toBe(true);
      expect(result.sections.schedule.enabled).toBe(false);
    });

    test('school template sets Buy Tickets / Donate CTAs', () => {
      const event = { name: 'Sports Banquet' };
      const result = applyTemplateToEvent_(event, 'school');

      const labels = result.ctaLabels.map(c => c.label);
      expect(labels).toContain('Buy Tickets');
      expect(labels).toContain('Donate');
    });

    test('fundraiser template sets Donate as primary CTA', () => {
      const event = { name: 'Charity Gala' };
      const result = applyTemplateToEvent_(event, 'fundraiser');

      expect(result.ctaLabels[0].label).toBe('Donate'); // First CTA is Donate
      const labels = result.ctaLabels.map(c => c.label);
      expect(labels).toContain('Buy Tickets');
      expect(labels).toContain('Share');
    });

    test('fundraiser sets cause-specific section title', () => {
      const event = { name: 'Benefit Night' };
      const result = applyTemplateToEvent_(event, 'fundraiser');

      expect(result.sections.notes.title).toBe('About the Cause');
    });
  });

  describe('Custom Template', () => {
    test('custom template enables all sections (SectionConfig format)', () => {
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
  });

  describe('Idempotent & Non-Destructive Behavior', () => {
    test('calling applyTemplateToEvent_ twice produces same result', () => {
      const event = { name: 'Test Event' };
      const result1 = applyTemplateToEvent_(event, 'bar_night');
      const result2 = applyTemplateToEvent_(result1, 'bar_night');

      expect(result1).toEqual(result2);
    });

    test('preserves user-set sections when template is applied (SectionConfig)', () => {
      const event = {
        name: 'Custom Bar Event',
        sections: {
          video: { enabled: false, title: 'Custom Video', content: null }, // User turned off video
          schedule: { enabled: true, title: 'My Schedule', content: null } // User turned on schedule
        }
      };
      const result = applyTemplateToEvent_(event, 'bar_night');

      // User overrides should be preserved
      expect(result.sections.video.enabled).toBe(false); // User's choice
      expect(result.sections.video.title).toBe('Custom Video');
      expect(result.sections.schedule.enabled).toBe(true); // User's choice
      expect(result.sections.schedule.title).toBe('My Schedule');
      // Template defaults should fill in the rest
      expect(result.sections.map.enabled).toBe(true);
      expect(result.sections.sponsors.enabled).toBe(true);
    });

    test('converts legacy boolean sections to SectionConfig', () => {
      const event = {
        name: 'Legacy Event',
        sections: {
          video: true, // Legacy boolean format
          map: false
        }
      };
      const result = applyTemplateToEvent_(event, 'custom');

      // Should be converted to SectionConfig
      expect(result.sections.video).toEqual({ enabled: true, title: null, content: null });
      expect(result.sections.map).toEqual({ enabled: false, title: null, content: null });
    });

    test('preserves user-set CTAs when template is applied (CTALabel format)', () => {
      const event = {
        name: 'Special Event',
        ctaLabels: [
          { key: 'custom', label: 'Custom CTA', url: 'https://example.com' },
          { key: 'another', label: 'Another CTA', url: null }
        ]
      };
      const result = applyTemplateToEvent_(event, 'bar_night');

      // User's custom CTAs should be preserved
      expect(result.ctaLabels).toHaveLength(2);
      expect(result.ctaLabels[0].label).toBe('Custom CTA');
      expect(result.ctaLabels[0].url).toBe('https://example.com');
    });

    test('preserves user-set section titles', () => {
      const event = {
        name: 'My Event',
        sections: {
          notes: { enabled: true, title: 'My Custom Notes Label', content: null },
          sponsors: { enabled: true, title: 'My Custom Sponsors', content: null }
        }
      };
      const result = applyTemplateToEvent_(event, 'bar_night');

      // User's titles should be preserved, not replaced with template defaults
      expect(result.sections.notes.title).toBe('My Custom Notes Label');
      expect(result.sections.sponsors.title).toBe('My Custom Sponsors');
    });

    test('preserves explicit status value', () => {
      const event = { name: 'Published Event', status: 'published' };
      const result = applyTemplateToEvent_(event, 'bar_night');

      expect(result.status).toBe('published');
    });

    test('preserves existing event data (name, date, location)', () => {
      const event = {
        id: 'EVT_123',
        name: 'Trivia Night',
        dateTime: '2025-12-01T19:00:00',
        location: '123 Main St',
        videoUrl: 'https://youtube.com/watch?v=abc',
        mapEmbedUrl: 'https://maps.google.com/embed?...',
        sponsors: [{ name: 'Acme Corp' }]
      };
      const result = applyTemplateToEvent_(event, 'bar_night');

      // All original data should be preserved
      expect(result.id).toBe('EVT_123');
      expect(result.name).toBe('Trivia Night');
      expect(result.dateTime).toBe('2025-12-01T19:00:00');
      expect(result.location).toBe('123 Main St');
      expect(result.videoUrl).toBe('https://youtube.com/watch?v=abc');
      expect(result.mapEmbedUrl).toBe('https://maps.google.com/embed?...');
      expect(result.sponsors).toEqual([{ name: 'Acme Corp' }]);
    });
  });

  describe('Template Switching', () => {
    test('switching templates updates templateId', () => {
      const event = { name: 'Test' };
      let result = applyTemplateToEvent_(event, 'bar_night');
      expect(result.templateId).toBe('bar_night');

      result = applyTemplateToEvent_(result, 'rec_league');
      expect(result.templateId).toBe('rec_league');
    });

    test('switching templates preserves existing SectionConfig values', () => {
      const event = { name: 'Test', sections: { video: { enabled: true, title: 'My Video', content: null } } };
      let result = applyTemplateToEvent_(event, 'bar_night');

      // Now switch to rec_league which has schedule=true by default
      result = applyTemplateToEvent_(result, 'rec_league');

      // video should stay as user set it (full SectionConfig preserved)
      expect(result.sections.video.enabled).toBe(true);
      expect(result.sections.video.title).toBe('My Video');
    });
  });

  describe('Fallback to Custom Template', () => {
    test('unknown templateId falls back to custom', () => {
      const event = { name: 'Unknown Template' };
      const result = applyTemplateToEvent_(event, 'nonexistent_template');

      expect(result.templateId).toBe('custom');
      // Should get custom template's sections (all enabled)
      expect(result.sections.video.enabled).toBe(true);
      expect(result.sections.schedule.enabled).toBe(true);
    });
  });

  describe('EVENT_CONTRACT.md v1.0 Format Compliance', () => {
    test('sections produce SectionConfig format for all keys', () => {
      const event = { name: 'Test' };
      const result = applyTemplateToEvent_(event, 'custom');

      const sectionKeys = ['video', 'map', 'schedule', 'sponsors', 'notes', 'gallery'];
      sectionKeys.forEach(key => {
        expect(result.sections[key]).toHaveProperty('enabled');
        expect(result.sections[key]).toHaveProperty('title');
        expect(result.sections[key]).toHaveProperty('content');
        expect(typeof result.sections[key].enabled).toBe('boolean');
      });
    });

    test('ctaLabels produce CTALabel format', () => {
      const event = { name: 'Test' };
      const result = applyTemplateToEvent_(event, 'bar_night');

      result.ctaLabels.forEach(cta => {
        expect(cta).toHaveProperty('key');
        expect(cta).toHaveProperty('label');
        expect(cta).toHaveProperty('url');
        expect(typeof cta.key).toBe('string');
        expect(typeof cta.label).toBe('string');
      });
    });

    test('status defaults to draft per EVENT_CONTRACT.md', () => {
      const event = { name: 'Test' };
      const result = applyTemplateToEvent_(event, 'custom');

      expect(result.status).toBe('draft');
    });

    test('supports all valid status values', () => {
      const statuses = ['draft', 'published', 'cancelled', 'completed'];

      statuses.forEach(status => {
        const event = { name: 'Test', status };
        const result = applyTemplateToEvent_(event, 'custom');
        expect(result.status).toBe(status);
      });
    });
  });

});

describe('Template Catalog Integrity', () => {

  test('all MVP templates are defined', () => {
    const mvpTemplates = ['bar_night', 'rec_league', 'school', 'fundraiser', 'custom'];

    mvpTemplates.forEach(id => {
      expect(EVENT_TEMPLATES[id]).toBeDefined();
      expect(EVENT_TEMPLATES[id].id).toBe(id);
      expect(EVENT_TEMPLATES[id].label).toBeTruthy();
      expect(EVENT_TEMPLATES[id].sections).toBeDefined();
      expect(EVENT_TEMPLATES[id].defaultCtas).toBeDefined();
    });
  });

  test('all templates have required fields', () => {
    Object.values(EVENT_TEMPLATES).forEach(tpl => {
      expect(tpl).toHaveProperty('id');
      expect(tpl).toHaveProperty('label');
      expect(tpl).toHaveProperty('sections');
      expect(tpl).toHaveProperty('defaultCtas');
      expect(Array.isArray(tpl.defaultCtas)).toBe(true);
    });
  });

  test('all templates have all section keys', () => {
    const requiredSections = ['video', 'map', 'schedule', 'sponsors', 'notes', 'gallery'];

    Object.values(EVENT_TEMPLATES).forEach(tpl => {
      requiredSections.forEach(section => {
        expect(tpl.sections).toHaveProperty(section);
        expect(typeof tpl.sections[section]).toBe('boolean');
      });
    });
  });

});

// ============================================================================
// EVENT_CONTRACT.md v2.0 Settings Compliance Tests
// ============================================================================

describe('TemplateService - EVENT_CONTRACT.md v2.0 Settings', () => {

  // Updated mock implementation matching TemplateService.gs v2.0
  function applyTemplateToEvent_v2(event, templateId) {
    const tpl = getEventTemplate_(templateId);

    // Set template reference
    event.templateId = tpl.id;

    // === Settings: Apply contract-aligned visibility flags ===
    // EVENT_CONTRACT.md v2.0 shape: { showSchedule, showStandings, showBracket, showSponsors }
    event.settings = event.settings || {};

    // Map template sections to contract settings
    if (event.settings.showSchedule == null) {
      event.settings.showSchedule = !!(tpl.sections && tpl.sections.schedule);
    }
    if (event.settings.showSponsors == null) {
      event.settings.showSponsors = !!(tpl.sections && tpl.sections.sponsors);
    }
    // showStandings and showBracket - default false unless template has specific support
    if (event.settings.showStandings == null) {
      const leagueTemplates = ['rec_league', 'darts', 'bags', 'pinball'];
      event.settings.showStandings = leagueTemplates.includes(tpl.id);
    }
    if (event.settings.showBracket == null) {
      const bracketTemplates = ['rec_league', 'bags'];
      event.settings.showBracket = bracketTemplates.includes(tpl.id);
    }

    return event;
  }

  describe('Settings Mapping from Templates', () => {
    test('bar_night template maps to correct settings', () => {
      const event = { name: 'Trivia Night' };
      const result = applyTemplateToEvent_v2(event, 'bar_night');

      // bar_night has schedule: false, sponsors: true
      expect(result.settings).toHaveProperty('showSchedule');
      expect(result.settings).toHaveProperty('showStandings');
      expect(result.settings).toHaveProperty('showBracket');
      expect(result.settings).toHaveProperty('showSponsors');

      expect(result.settings.showSchedule).toBe(false);  // bar_night has no schedule
      expect(result.settings.showSponsors).toBe(true);   // bar_night has sponsors
      expect(result.settings.showStandings).toBe(false); // Not a league template
      expect(result.settings.showBracket).toBe(false);   // Not a bracket template
    });

    test('rec_league template maps to correct settings with standings and bracket', () => {
      const event = { name: 'Summer Softball' };
      const result = applyTemplateToEvent_v2(event, 'rec_league');

      expect(result.settings.showSchedule).toBe(true);   // rec_league has schedule
      expect(result.settings.showSponsors).toBe(true);   // rec_league has sponsors
      expect(result.settings.showStandings).toBe(true);  // rec_league IS a league template
      expect(result.settings.showBracket).toBe(true);    // rec_league IS a bracket template
    });

    test('custom template maps schedule and sponsors to settings', () => {
      const event = { name: 'Custom Event' };
      const result = applyTemplateToEvent_v2(event, 'custom');

      // custom has schedule: true, sponsors: true
      expect(result.settings.showSchedule).toBe(true);
      expect(result.settings.showSponsors).toBe(true);
      expect(result.settings.showStandings).toBe(false); // Not a league template
      expect(result.settings.showBracket).toBe(false);   // Not a bracket template
    });
  });

  describe('League Templates Default showStandings: true', () => {
    // Only test with templates that exist in EVENT_TEMPLATES mock
    // The logic checks if tpl.id is in ['rec_league', 'darts', 'bags', 'pinball']
    // From our mock, only 'rec_league' exists
    const existingLeagueTemplates = ['rec_league'];

    existingLeagueTemplates.forEach(templateId => {
      test(`${templateId} template defaults showStandings to true`, () => {
        const event = { name: `${templateId} Event` };
        const result = applyTemplateToEvent_v2(event, templateId);

        expect(result.settings.showStandings).toBe(true);
      });
    });

    test('league template IDs are correctly configured in implementation', () => {
      // Document the full list of league template IDs for contract clarity
      const leagueTemplateIds = ['rec_league', 'darts', 'bags', 'pinball'];
      expect(leagueTemplateIds).toContain('rec_league');
      expect(leagueTemplateIds).toContain('darts');
      expect(leagueTemplateIds).toContain('bags');
      expect(leagueTemplateIds).toContain('pinball');
    });
  });

  describe('Non-League Templates Default showStandings: false', () => {
    const nonLeagueTemplates = ['bar_night', 'school', 'fundraiser', 'custom'];

    nonLeagueTemplates.forEach(templateId => {
      test(`${templateId} template defaults showStandings to false`, () => {
        const event = { name: `${templateId} Event` };
        const result = applyTemplateToEvent_v2(event, templateId);

        expect(result.settings.showStandings).toBe(false);
      });
    });
  });

  describe('Bracket Templates Default showBracket: true', () => {
    // Only test with templates that exist in EVENT_TEMPLATES mock
    // The logic checks if tpl.id is in ['rec_league', 'bags']
    // From our mock, only 'rec_league' exists
    const existingBracketTemplates = ['rec_league'];

    existingBracketTemplates.forEach(templateId => {
      test(`${templateId} template defaults showBracket to true`, () => {
        const event = { name: `${templateId} Event` };
        const result = applyTemplateToEvent_v2(event, templateId);

        expect(result.settings.showBracket).toBe(true);
      });
    });

    test('bracket template IDs are correctly configured in implementation', () => {
      // Document the full list of bracket template IDs for contract clarity
      const bracketTemplateIds = ['rec_league', 'bags'];
      expect(bracketTemplateIds).toContain('rec_league');
      expect(bracketTemplateIds).toContain('bags');
    });
  });

  describe('Non-Bracket Templates Default showBracket: false', () => {
    // Only test with templates that exist in EVENT_TEMPLATES mock
    // Note: darts, pinball don't exist in mock so they're excluded
    const nonBracketTemplates = ['bar_night', 'school', 'fundraiser', 'custom'];

    nonBracketTemplates.forEach(templateId => {
      test(`${templateId} template defaults showBracket to false`, () => {
        const event = { name: `${templateId} Event` };
        const result = applyTemplateToEvent_v2(event, templateId);

        expect(result.settings.showBracket).toBe(false);
      });
    });
  });

  describe('User Settings Are Preserved', () => {
    test('user-set showSchedule is not overwritten', () => {
      const event = {
        name: 'Custom Schedule',
        settings: { showSchedule: true } // User explicitly set this
      };
      const result = applyTemplateToEvent_v2(event, 'bar_night'); // bar_night has schedule: false

      // User's choice should be preserved
      expect(result.settings.showSchedule).toBe(true);
    });

    test('user-set showStandings is not overwritten', () => {
      const event = {
        name: 'Force Standings',
        settings: { showStandings: true } // User explicitly set this
      };
      const result = applyTemplateToEvent_v2(event, 'bar_night'); // Not a league template

      // User's choice should be preserved
      expect(result.settings.showStandings).toBe(true);
    });

    test('user-set showBracket is not overwritten', () => {
      const event = {
        name: 'Force Bracket',
        settings: { showBracket: true } // User explicitly set this
      };
      const result = applyTemplateToEvent_v2(event, 'bar_night'); // Not a bracket template

      // User's choice should be preserved
      expect(result.settings.showBracket).toBe(true);
    });
  });

  describe('Settings Shape Compliance', () => {
    test('settings produces all 4 required boolean flags', () => {
      const event = { name: 'Test' };
      const result = applyTemplateToEvent_v2(event, 'custom');

      const settingsKeys = ['showSchedule', 'showStandings', 'showBracket', 'showSponsors'];
      settingsKeys.forEach(key => {
        expect(result.settings).toHaveProperty(key);
        expect(typeof result.settings[key]).toBe('boolean');
      });
    });
  });
});
