/**
 * Template Fixtures - Single Source of Truth for Tests
 *
 * These fixtures MUST match TemplateService.gs EVENT_TEMPLATES.
 * If they drift, update this file to match production.
 *
 * Template sections map to event.settings.show* flags:
 *   sections.schedule  → settings.showSchedule
 *   sections.standings → settings.showStandings (implied by schedule for leagues)
 *   sections.bracket   → settings.showBracket (implied by schedule for tournaments)
 *   sections.sponsors  → settings.showSponsors
 *   sections.video     → settings.showVideo
 *   sections.map       → settings.showMap
 *   sections.gallery   → settings.showGallery
 *
 * @see src/mvp/TemplateService.gs EVENT_TEMPLATES
 * @see schemas/event.schema.json Settings
 */

/**
 * S13 MVP Template Requirements
 * Per acceptance criteria: Must have 3-10 base templates marked as MVP
 * Expanded from 3-6 to support full 10-template base set
 */
const MVP_TEMPLATE_REQUIREMENTS = {
  MIN_COUNT: 3,
  MAX_COUNT: 10
};

/**
 * MVP Templates (focus group ready)
 * Stage-gated: Only these templates are exposed in Admin UI
 * S13: Each template has mvp: true flag
 */
const MVP_TEMPLATES = {
  // Bar & Tavern group
  bar_night: {
    id: 'bar_night',
    label: 'Bar / Tavern Event',
    icon: '🍺',
    tier: 'mvp',
    mvp: true,
    group: 'bar_events',
    sections: {
      video: true,
      map: true,
      schedule: false,
      sponsors: true,
      gallery: true
    }
  },
  music_event: {
    id: 'music_event',
    label: 'Music Night / Live Music',
    icon: '🎵',
    tier: 'mvp',
    mvp: true,
    group: 'bar_events',
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: true,
      gallery: true
    }
  },
  // Leagues & Sports group
  rec_league: {
    id: 'rec_league',
    label: 'Rec League / Season',
    icon: '⚾',
    tier: 'mvp',
    mvp: true,
    group: 'leagues',
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: true,
      gallery: true
    }
  },
  bocce: {
    id: 'bocce',
    label: 'Bocce League',
    icon: '🎱',
    tier: 'mvp',
    mvp: true,
    group: 'leagues',
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: true,
      gallery: false
    }
  },
  youth_sports: {
    id: 'youth_sports',
    label: 'Youth Sports',
    icon: '🏈',
    tier: 'mvp',
    mvp: true,
    group: 'leagues',
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: true,
      gallery: true
    }
  },
  // General Purpose group
  custom: {
    id: 'custom',
    label: 'Custom Event',
    icon: '✨',
    tier: 'mvp',
    mvp: true,
    group: 'general',
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: true,
      gallery: true
    }
  },
  fundraiser: {
    id: 'fundraiser',
    label: 'Fundraiser / Charity Event',
    icon: '💝',
    tier: 'mvp',
    mvp: true,
    group: 'general',
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: true,
      gallery: true
    }
  },
  // Schools & Youth group
  school_event: {
    id: 'school_event',
    label: 'School Event',
    icon: '🏫',
    tier: 'mvp',
    mvp: true,
    group: 'schools',
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: false,
      gallery: true
    }
  },
  club_activity: {
    id: 'club_activity',
    label: 'Club / Activity',
    icon: '🎭',
    tier: 'mvp',
    mvp: true,
    group: 'schools',
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: true,
      gallery: true
    }
  },
  // Community group
  community_day: {
    id: 'community_day',
    label: 'Community Day / Festival',
    icon: '🎪',
    tier: 'mvp',
    mvp: true,
    group: 'community',
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: true,
      gallery: true
    }
  }
};

/**
 * V2+ Templates (post-MVP)
 * Stage-gated: Hidden from Admin UI until V2 features ship
 * S13: Each template has mvp: false flag
 */
const V2_TEMPLATES = {
  school: {
    id: 'school',
    label: 'School / Youth Event',
    icon: '🎓',
    tier: 'v2',
    mvp: false,
    group: 'professional',
    sections: {
      video: true,
      map: true,
      schedule: false,
      sponsors: true,
      gallery: true
    }
  },
  // Note: fundraiser moved to MVP tier
  corporate: {
    id: 'corporate',
    label: 'Corporate / Professional',
    icon: '💼',
    tier: 'v2',
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'professional',
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: true,
      gallery: false
    }
  },
  wedding: {
    id: 'wedding',
    label: 'Wedding',
    icon: '💒',
    tier: 'v2',
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'social',
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: false,
      gallery: true
    }
  },
  trivia: {
    id: 'trivia',
    label: 'Trivia Night',
    icon: '🧠',
    tier: 'v2',
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'leagues',
    sections: {
      video: false,
      map: true,
      schedule: false,
      sponsors: true,
      gallery: false
    }
  },
  // Travel & Lodging group
  travel_hub: {
    id: 'travel_hub',
    label: 'Travel Hub / Local Guide',
    icon: '🏡',
    tier: 'v2',
    mvp: false,  // S13: V2 template - post-MVP core growth feature
    group: 'travel',
    sections: {
      video: true,
      map: true,
      schedule: false,  // Persistent guide, not event-based
      sponsors: true,
      gallery: true
    },
    // Travel Hub has additional config for host/layers structure
    travelHubConfig: {
      defaultLayers: [
        'wine_weekend', 'craft_beer', 'bocce_bonfire', 'foodie',
        'outdoors', 'family_friendly', 'couples_retreat', 'group_trip'
      ]
    }
  }
};

/**
 * All templates (MVP + V2)
 */
const ALL_TEMPLATES = { ...MVP_TEMPLATES, ...V2_TEMPLATES };

/**
 * Section to Settings mapping
 * Template sections map to event.settings.show* flags
 */
const SECTION_TO_SETTING_MAP = {
  schedule: 'showSchedule',
  // standings/bracket are derived from template type, not sections
  sponsors: 'showSponsors',
  video: 'showVideo',
  map: 'showMap',
  gallery: 'showGallery'
};

/**
 * Get expected settings.show* values for a template
 * @param {string} templateId - Template ID
 * @returns {Object} Expected settings values
 */
function getExpectedSettingsForTemplate(templateId) {
  const template = ALL_TEMPLATES[templateId];
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`);
  }

  const settings = {
    // MVP Required defaults
    showSchedule: template.sections.schedule || false,
    showStandings: false, // Set by TemplateService based on template type
    showBracket: false,   // Set by TemplateService based on template type
    // MVP Optional
    showSponsors: template.sections.sponsors || false,
    showVideo: template.sections.video !== false,     // Default true
    showMap: template.sections.map !== false,         // Default true
    showGallery: template.sections.gallery !== false, // Default true
    // Surface-specific (always default true)
    showSponsorBanner: true,
    showSponsorStrip: true,
    showLeagueStrip: true,
    showQRSection: true
  };

  // League templates enable standings
  if (['rec_league', 'bocce', 'youth_sports', 'darts', 'bags', 'pinball'].includes(templateId)) {
    settings.showStandings = true;
  }

  // Tournament templates enable bracket
  if (['rec_league', 'bocce', 'youth_sports', 'bags'].includes(templateId)) {
    settings.showBracket = true;
  }

  return settings;
}

/**
 * Custom template exposes ALL settings (full schema access)
 */
const CUSTOM_TEMPLATE_EXPECTED_SETTINGS = {
  showSchedule: true,
  showStandings: false,  // User toggles manually
  showBracket: false,    // User toggles manually
  showSponsors: true,
  showVideo: true,
  showMap: true,
  showGallery: true,
  showSponsorBanner: true,
  showSponsorStrip: true,
  showLeagueStrip: true,
  showQRSection: true
};

/**
 * All setting keys that should be available in Admin.html for Custom template
 */
const ALL_SETTING_KEYS = [
  'showSchedule',
  'showStandings',
  'showBracket',
  'showSponsors',
  'showVideo',
  'showMap',
  'showGallery',
  'showSponsorBanner',
  'showSponsorStrip',
  'showLeagueStrip',
  'showQRSection'
];

module.exports = {
  MVP_TEMPLATE_REQUIREMENTS,
  MVP_TEMPLATES,
  V2_TEMPLATES,
  ALL_TEMPLATES,
  SECTION_TO_SETTING_MAP,
  getExpectedSettingsForTemplate,
  CUSTOM_TEMPLATE_EXPECTED_SETTINGS,
  ALL_SETTING_KEYS
};
