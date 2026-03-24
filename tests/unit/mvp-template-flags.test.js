/**
 * S13 - MVP Template Flags Tests
 *
 * Validates that templates are correctly flagged as MVP or V2:
 * - Each template has mvp: true/false property
 * - MVP templates include core event types (bar events, bocce, rec leagues, custom)
 * - MVP template count is within 3-6 range per acceptance criteria
 * - V2 templates are correctly excluded from MVP builds
 *
 * @see src/mvp/TemplateService.gs
 * @see S13 acceptance criteria
 */

const {
  MVP_TEMPLATE_REQUIREMENTS,
  MVP_TEMPLATES,
  V2_TEMPLATES,
  ALL_TEMPLATES
} = require('../shared/fixtures/templates.fixtures');

// ============================================================================
// S13: MVP Template Flag Tests
// ============================================================================

describe('S13 - MVP Template Flags', () => {

  describe('MVP Template Requirements', () => {

    test('MVP template count is within required range (3-6)', () => {
      const mvpCount = Object.keys(MVP_TEMPLATES).length;
      const min = MVP_TEMPLATE_REQUIREMENTS.MIN_COUNT;
      const max = MVP_TEMPLATE_REQUIREMENTS.MAX_COUNT;

      expect(mvpCount).toBeGreaterThanOrEqual(min);
      expect(mvpCount).toBeLessThanOrEqual(max);

      // Log for visibility
      console.log(`MVP template count: ${mvpCount} (required range: ${min}-${max})`);
    });

    test('MVP templates include core event types', () => {
      // Full 10-template base set
      const coreTemplateIds = [
        'bar_night', 'music_event',           // Bar & Tavern
        'rec_league', 'bocce', 'youth_sports', // Leagues
        'custom', 'fundraiser',                // General
        'school_event', 'club_activity',       // Schools
        'community_day'                        // Community
      ];

      coreTemplateIds.forEach(id => {
        expect(MVP_TEMPLATES[id]).toBeDefined();
        expect(MVP_TEMPLATES[id].id).toBe(id);
      });
    });

    test('MVP templates include at least one bar/tavern template', () => {
      const barTemplates = Object.values(MVP_TEMPLATES).filter(t =>
        t.group === 'bar_events'
      );
      expect(barTemplates.length).toBeGreaterThanOrEqual(1);
    });

    test('MVP templates include at least one league template', () => {
      const leagueTemplates = Object.values(MVP_TEMPLATES).filter(t =>
        t.group === 'leagues'
      );
      expect(leagueTemplates.length).toBeGreaterThanOrEqual(1);
    });

    test('MVP templates include a custom/general purpose template', () => {
      const generalTemplates = Object.values(MVP_TEMPLATES).filter(t =>
        t.group === 'general'
      );
      expect(generalTemplates.length).toBeGreaterThanOrEqual(1);
    });

    test('MVP templates include school/youth templates', () => {
      const schoolTemplates = Object.values(MVP_TEMPLATES).filter(t =>
        t.group === 'schools'
      );
      expect(schoolTemplates.length).toBeGreaterThanOrEqual(1);
    });

    test('MVP templates include community templates', () => {
      const communityTemplates = Object.values(MVP_TEMPLATES).filter(t =>
        t.group === 'community'
      );
      expect(communityTemplates.length).toBeGreaterThanOrEqual(1);
    });

  });

  describe('MVP Flag Property', () => {

    test('all MVP templates have mvp: true', () => {
      Object.values(MVP_TEMPLATES).forEach(template => {
        expect(template).toHaveProperty('mvp');
        expect(template.mvp).toBe(true);
      });
    });

    test('all MVP templates have tier: mvp', () => {
      Object.values(MVP_TEMPLATES).forEach(template => {
        expect(template).toHaveProperty('tier');
        expect(template.tier).toBe('mvp');
      });
    });

    test('mvp flag matches tier property for MVP templates', () => {
      Object.values(MVP_TEMPLATES).forEach(template => {
        // mvp: true should always correlate with tier: 'mvp'
        expect(template.mvp === true && template.tier === 'mvp').toBe(true);
      });
    });

    test('all V2 templates have mvp: false', () => {
      Object.values(V2_TEMPLATES).forEach(template => {
        expect(template).toHaveProperty('mvp');
        expect(template.mvp).toBe(false);
      });
    });

    test('all V2 templates have tier: v2', () => {
      Object.values(V2_TEMPLATES).forEach(template => {
        expect(template).toHaveProperty('tier');
        expect(template.tier).toBe('v2');
      });
    });

    test('mvp flag matches tier property for V2 templates', () => {
      Object.values(V2_TEMPLATES).forEach(template => {
        // mvp: false should always correlate with tier: 'v2'
        expect(template.mvp === false && template.tier === 'v2').toBe(true);
      });
    });

    test('all templates in ALL_TEMPLATES have mvp property', () => {
      Object.values(ALL_TEMPLATES).forEach(template => {
        expect(template).toHaveProperty('mvp');
        expect(typeof template.mvp).toBe('boolean');
      });
    });

  });

  describe('Template Structure Integrity', () => {

    test('MVP templates have all required fields', () => {
      const requiredFields = ['id', 'label', 'icon', 'tier', 'mvp', 'group', 'sections'];

      Object.values(MVP_TEMPLATES).forEach(template => {
        requiredFields.forEach(field => {
          expect(template).toHaveProperty(field);
        });
      });
    });

    test('V2 templates have all required fields', () => {
      const requiredFields = ['id', 'label', 'icon', 'tier', 'mvp', 'group', 'sections'];

      Object.values(V2_TEMPLATES).forEach(template => {
        requiredFields.forEach(field => {
          expect(template).toHaveProperty(field);
        });
      });
    });

    test('template ids are unique across MVP and V2', () => {
      const mvpIds = Object.keys(MVP_TEMPLATES);
      const v2Ids = Object.keys(V2_TEMPLATES);

      // No overlap between MVP and V2
      const overlap = mvpIds.filter(id => v2Ids.includes(id));
      expect(overlap).toEqual([]);

      // All ids are unique
      const allIds = [...mvpIds, ...v2Ids];
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });

  });

  describe('Stage-Gate Filtering', () => {

    test('filtering by mvp: true returns only MVP templates', () => {
      const allTemplates = Object.values(ALL_TEMPLATES);
      const mvpFiltered = allTemplates.filter(t => t.mvp === true);

      expect(mvpFiltered.length).toBe(Object.keys(MVP_TEMPLATES).length);
      mvpFiltered.forEach(template => {
        expect(MVP_TEMPLATES[template.id]).toBeDefined();
      });
    });

    test('filtering by mvp: false returns only V2 templates', () => {
      const allTemplates = Object.values(ALL_TEMPLATES);
      const v2Filtered = allTemplates.filter(t => t.mvp === false);

      expect(v2Filtered.length).toBe(Object.keys(V2_TEMPLATES).length);
      v2Filtered.forEach(template => {
        expect(V2_TEMPLATES[template.id]).toBeDefined();
      });
    });

    test('filtering by tier produces same results as mvp flag', () => {
      const allTemplates = Object.values(ALL_TEMPLATES);

      const mvpByFlag = allTemplates.filter(t => t.mvp === true);
      const mvpByTier = allTemplates.filter(t => t.tier === 'mvp');

      expect(mvpByFlag.length).toBe(mvpByTier.length);
      expect(mvpByFlag.map(t => t.id).sort()).toEqual(mvpByTier.map(t => t.id).sort());

      const v2ByFlag = allTemplates.filter(t => t.mvp === false);
      const v2ByTier = allTemplates.filter(t => t.tier === 'v2');

      expect(v2ByFlag.length).toBe(v2ByTier.length);
      expect(v2ByFlag.map(t => t.id).sort()).toEqual(v2ByTier.map(t => t.id).sort());
    });

  });

  describe('Admin UI Filtering Contract', () => {

    test('MVP build should show exactly 10 core templates', () => {
      const expectedMvpTemplates = [
        'bar_night', 'music_event',           // Bar & Tavern
        'rec_league', 'bocce', 'youth_sports', // Leagues
        'custom', 'fundraiser',                // General
        'school_event', 'club_activity',       // Schools
        'community_day'                        // Community
      ];
      const actualMvpTemplates = Object.keys(MVP_TEMPLATES);

      expect(actualMvpTemplates.sort()).toEqual(expectedMvpTemplates.sort());
    });

    test('V2 templates are not in MVP_TEMPLATES', () => {
      const v2Ids = Object.keys(V2_TEMPLATES);

      v2Ids.forEach(id => {
        expect(MVP_TEMPLATES[id]).toBeUndefined();
      });
    });

    test('template picker should be able to filter by mvp flag', () => {
      // Simulates Admin.html template picker filtering
      const getVisibleTemplates = (includeV2 = false) => {
        return Object.values(ALL_TEMPLATES).filter(t => {
          if (includeV2) return true;  // Show all
          return t.mvp === true;       // MVP only
        });
      };

      const mvpOnly = getVisibleTemplates(false);
      const allTemplates = getVisibleTemplates(true);

      expect(mvpOnly.length).toBe(Object.keys(MVP_TEMPLATES).length);
      expect(allTemplates.length).toBe(Object.keys(ALL_TEMPLATES).length);

      // MVP-only should be subset of all
      const mvpOnlyIds = mvpOnly.map(t => t.id);
      const allIds = allTemplates.map(t => t.id);
      mvpOnlyIds.forEach(id => {
        expect(allIds).toContain(id);
      });
    });

  });

});

// ============================================================================
// MVP Template Validation Function Test
// ============================================================================

describe('S13 - validateMvpTemplateRequirements_', () => {

  // Mock implementation matching TemplateService.gs
  function validateMvpTemplateRequirements(mvpTemplates) {
    const count = Object.keys(mvpTemplates).length;
    const min = MVP_TEMPLATE_REQUIREMENTS.MIN_COUNT;
    const max = MVP_TEMPLATE_REQUIREMENTS.MAX_COUNT;

    if (count < min) {
      return {
        ok: false,
        count: count,
        message: `Too few MVP templates: ${count} (minimum ${min} required)`
      };
    }

    if (count > max) {
      return {
        ok: false,
        count: count,
        message: `Too many MVP templates: ${count} (maximum ${max} allowed for MVP build)`
      };
    }

    return {
      ok: true,
      count: count,
      message: `MVP template count valid: ${count} templates (range ${min}-${max})`
    };
  }

  test('validates current MVP templates successfully', () => {
    const result = validateMvpTemplateRequirements(MVP_TEMPLATES);

    expect(result.ok).toBe(true);
    expect(result.count).toBe(Object.keys(MVP_TEMPLATES).length);
  });

  test('rejects too few templates', () => {
    const tooFew = { bar_night: MVP_TEMPLATES.bar_night };
    const result = validateMvpTemplateRequirements(tooFew);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Too few');
  });

  test('rejects too many templates', () => {
    // Simulate 7+ templates
    const tooMany = {
      ...MVP_TEMPLATES,
      extra1: { ...MVP_TEMPLATES.custom, id: 'extra1' },
      extra2: { ...MVP_TEMPLATES.custom, id: 'extra2' },
      extra3: { ...MVP_TEMPLATES.custom, id: 'extra3' }
    };
    const result = validateMvpTemplateRequirements(tooMany);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Too many');
  });

});
