/**
 * TemplateService.gs
 *
 * Event Template System
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * [MVP] SERVICE CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * READS: None (templates are static configuration)
 *
 * WRITES (to Event via applyTemplateToEvent_):
 *   → event.templateId                    [MVP OPTIONAL - event.schema.json]
 *   → event.settings.showSchedule         [MVP REQUIRED - event.schema.json]
 *   → event.settings.showStandings        [MVP REQUIRED - event.schema.json]
 *   → event.settings.showBracket          [MVP REQUIRED - event.schema.json]
 *   → event.settings.showSponsors         [MVP OPTIONAL - event.schema.json]
 *   → event.settings.showVideo            [MVP OPTIONAL - event.schema.json]
 *   → event.settings.showMap              [MVP OPTIONAL - event.schema.json]
 *   → event.settings.showGallery          [MVP OPTIONAL - event.schema.json]
 *   → event.settings.showSponsorBanner    [MVP OPTIONAL - event.schema.json]
 *   → event.settings.showSponsorStrip     [MVP OPTIONAL - event.schema.json]
 *   → event.settings.showLeagueStrip      [MVP OPTIONAL - event.schema.json]
 *   → event.settings.showQRSection        [MVP OPTIONAL - event.schema.json]
 *
 * DOES NOT WRITE (internal template fields only):
 *   - sections.notes → Legacy, not in schema
 *   - defaultCtas[] → Used for UI suggestions only, not written to event
 *   - defaults.* → Used for UI pre-fill only, not written to event
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SCHEMA COMPLIANCE: Templates MUST only produce fields defined in
 * /schemas/event.schema.json. Do NOT add custom fields to templates.
 *
 * Template fields that map to schema:
 *   - sections.schedule  → event.settings.showSchedule
 *   - sections.sponsors  → event.settings.showSponsors
 *   - sections.video     → event.settings.showVideo
 *   - sections.map       → event.settings.showMap
 *   - sections.gallery   → event.settings.showGallery
 *   - defaultCtas[]      → event.ctas.primary.label (UI suggestion only)
 *   - sections.notes     → NOT IN SCHEMA (legacy, ignored in MVP)
 *
 * [MVP] Templates (focus-group ready):
 *   - bar_night   → Bar events, trivia, casual
 *   - rec_league  → Sports leagues, standings, schedule-heavy
 *   - bocce       → Bocce ball leagues, tournaments
 *   - custom      → Blank slate, all options available
 *
 * [V2+] Templates (require V2 media/gallery features):
 *   - school, fundraiser, corporate (Professional)
 *   - wedding, photo_gallery, shower, bachelor_party (Social)
 *   - farmers_market, art_show, carnival, church, church_club (Community)
 *   - trivia, darts, bags, pinball (Bar Games - covered by rec_league in MVP)
 *
 * @version 1.3.0
 * @since 2025-11-18
 */

// ============================================================================
// [MVP] EVENT TEMPLATE CATALOG - Triangle Live Demo
// ============================================================================
//
// STAGE-GATE: Templates are tiered for controlled rollout
//
// [MVP] bar_night, rec_league, bocce, custom - Core templates for focus group
// [V2+] All other templates - Require V2 media/gallery features
//
// Templates are grouped by category for UI organization:
//   - bar_events: Bar & Tavern events
//   - leagues: Leagues & Sports
//   - general: General Purpose (custom)
//   - social: Social & Celebration (V2)
//   - community: Community & Faith (V2)
//   - professional: Professional & Corporate (V2)
//
// ============================================================================

/**
 * Event archetypes for different verticals
 * Templates = reusable patterns (sections, CTAs, defaults)
 * Config = brand-level wiring (which templates each brand sees)
 */
// ============================================================================
// [MVP] TEMPLATE TIER DEFINITIONS
// ============================================================================
// Templates are gated by tier to control rollout:
//   - 'mvp': Core templates for focus group (bar_night, rec_league, bocce, custom)
//   - 'v2': Deferred templates requiring V2 features (weddings, galleries, etc.)
//
// Admin UI only shows MVP tier templates until V2 features ship.
// ============================================================================

/**
 * Template tiers for stage-gating
 * @enum {string}
 */
var TEMPLATE_TIER = {
  MVP: 'mvp',   // Focus group ready - ship now
  V2: 'v2'      // Deferred - requires V2 features
};

/**
 * Minimum and maximum MVP template count for validation
 * Per S13 acceptance criteria: 3-10 base templates marked as MVP
 * Expanded from 3-6 to support full 10-template base set
 * @constant {Object}
 */
var MVP_TEMPLATE_REQUIREMENTS = {
  MIN_COUNT: 3,
  MAX_COUNT: 10
};

/**
 * Template groups for UI organization
 * Groups are displayed in order, templates within groups sorted by displayOrder
 */
var TEMPLATE_GROUPS = [
  {
    id: 'bar_events',
    label: 'Bar & Tavern',
    description: 'Events at bars, taverns, and restaurants',
    icon: '🍺',
    tier: TEMPLATE_TIER.MVP,
    displayOrder: 1
  },
  {
    id: 'leagues',
    label: 'Leagues & Sports',
    description: 'Recreational leagues, tournaments, and competitions',
    icon: '🏆',
    tier: TEMPLATE_TIER.MVP,
    displayOrder: 2
  },
  {
    id: 'general',
    label: 'General Purpose',
    description: 'Flexible templates for any event type',
    icon: '✨',
    tier: TEMPLATE_TIER.MVP,
    displayOrder: 3
  },
  {
    id: 'schools',
    label: 'Schools & Youth',
    description: 'School events, youth sports, clubs, and activities',
    icon: '🎓',
    tier: TEMPLATE_TIER.MVP,
    displayOrder: 4
  },
  {
    id: 'community',
    label: 'Community & Faith',
    description: 'Fairs, block parties, parish fests, and community gatherings',
    icon: '🏛️',
    tier: TEMPLATE_TIER.MVP,
    displayOrder: 5
  },
  {
    id: 'social',
    label: 'Social & Celebration',
    description: 'Weddings, parties, and personal celebrations',
    icon: '🎉',
    tier: TEMPLATE_TIER.V2,
    displayOrder: 6
  },
  {
    id: 'professional',
    label: 'Professional & Corporate',
    description: 'Business events, conferences, and fundraisers',
    icon: '💼',
    tier: TEMPLATE_TIER.V2,
    displayOrder: 7
  },
  {
    id: 'travel',
    label: 'Travel & Lodging',
    description: 'Lodging guides, local recommendations, and travel hubs',
    icon: '🏡',
    tier: TEMPLATE_TIER.V2,
    displayOrder: 8
  }
];

var EVENT_TEMPLATES = {
  // ============================================================================
  // [MVP] BAR & TAVERN TEMPLATES - Group: bar_events
  // ============================================================================

  bar_night: {
    id: 'bar_night',
    label: 'Bar / Tavern Event',
    description: 'Trivia nights, live music, happy hours',
    exampleName: 'Thursday Trivia Night',
    icon: '🍺',
    tier: TEMPLATE_TIER.MVP,
    mvp: true,  // S13: MVP template flag for stage-gating
    group: 'bar_events',
    displayOrder: 1,
    sections: {
      video: true,
      map: true,
      schedule: false,
      sponsors: true,
      notes: true,
      gallery: true
    },
    defaultCtas: ['RSVP', 'Add to Calendar'],
    defaults: {
      audience: 'Adults 21+',
      notesLabel: 'House Rules',
      sponsorStripLabel: "Tonight's Sponsors"
    }
  },

  music_event: {
    id: 'music_event',
    label: 'Music Night / Live Music',
    description: 'Live music, acoustic sets, band nights, promoter events',
    exampleName: 'Friday Night Live Music',
    icon: '🎵',
    tier: TEMPLATE_TIER.MVP,
    mvp: true,  // S13: MVP template flag for stage-gating
    group: 'bar_events',
    displayOrder: 2,
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: true
    },
    defaultCtas: ['RSVP', 'View Lineup'],
    defaults: {
      audience: 'Music Fans',
      notesLabel: 'Set Times & Info',
      sponsorStripLabel: 'Event Sponsors'
    }
  },

  // ============================================================================
  // [MVP] LEAGUE & SPORTS TEMPLATES - Group: leagues
  // ============================================================================

  rec_league: {
    id: 'rec_league',
    label: 'Rec League / Season',
    description: 'Sports leagues, tournaments, team registrations',
    exampleName: 'Summer Softball League',
    icon: '⚾',
    tier: TEMPLATE_TIER.MVP,
    mvp: true,  // S13: MVP template flag for stage-gating
    group: 'leagues',
    displayOrder: 1,
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: true
    },
    defaultCtas: ['Register Team', 'View Schedule'],
    defaults: {
      audience: 'Teams & Captains',
      notesLabel: 'League Notes',
      sponsorStripLabel: 'Season Sponsors'
    },
    // ExternalLeagueData: default provider for league templates
    defaultExternalProvider: 'Custom'
  },

  bocce: {
    id: 'bocce',
    label: 'Bocce League',
    description: 'Bocce ball leagues, tournaments, and social play',
    exampleName: 'Thursday Night Bocce',
    icon: '🎱',
    tier: TEMPLATE_TIER.MVP,
    mvp: true,  // S13: MVP template flag for stage-gating
    group: 'leagues',
    displayOrder: 2,
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: false
    },
    defaultCtas: ['Register Team', 'View Standings'],
    defaults: {
      audience: 'Players & Teams',
      notesLabel: 'League Rules',
      sponsorStripLabel: 'League Sponsors'
    },
    defaultExternalProvider: 'Custom'
  },

  youth_sports: {
    id: 'youth_sports',
    label: 'Youth Sports',
    description: 'Youth sports events, games, practices, schedules',
    exampleName: 'EP Youth Football Schedule',
    icon: '🏈',
    tier: TEMPLATE_TIER.MVP,
    mvp: true,  // S13: MVP template flag for stage-gating
    group: 'leagues',
    displayOrder: 3,
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: true
    },
    defaultCtas: ['View Schedule', 'Register Player'],
    defaults: {
      audience: 'Parents & Players',
      notesLabel: 'Team Info',
      sponsorStripLabel: 'Season Sponsors'
    },
    defaultExternalProvider: 'Custom'
  },

  // ============================================================================
  // [MVP] GENERAL PURPOSE TEMPLATES - Group: general
  // ============================================================================

  custom: {
    id: 'custom',
    label: 'Custom Event',
    description: 'Start from scratch with all options available',
    exampleName: 'My Custom Event',
    icon: '✨',
    tier: TEMPLATE_TIER.MVP,
    mvp: true,  // S13: MVP template flag for stage-gating
    group: 'general',
    displayOrder: 99,  // Always last
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: true
    },
    defaultCtas: ['Register', 'Add to Calendar'],
    defaults: {}
  },

  fundraiser: {
    id: 'fundraiser',
    label: 'Fundraiser / Charity Event',
    description: 'Fundraising events, charity nights, benefit events, auctions',
    exampleName: 'Trivia Night for a Cause',
    icon: '💝',
    tier: TEMPLATE_TIER.MVP,
    mvp: true,  // S13: MVP template flag for stage-gating
    group: 'general',
    displayOrder: 2,
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: true
    },
    defaultCtas: ['Donate', 'Buy Tickets'],
    defaults: {
      audience: 'Donors & Guests',
      notesLabel: 'About the Cause',
      sponsorStripLabel: 'Event Sponsors'
    }
  },

  // ============================================================================
  // [MVP] SCHOOLS & YOUTH TEMPLATES - Group: schools
  // ============================================================================

  school_event: {
    id: 'school_event',
    label: 'School Event',
    description: 'School calendars, concerts, plays, open houses, assemblies',
    exampleName: 'Spring Band Concert',
    icon: '🏫',
    tier: TEMPLATE_TIER.MVP,
    mvp: true,  // S13: MVP template flag for stage-gating
    group: 'schools',
    displayOrder: 1,
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: false,
      notes: true,
      gallery: true
    },
    defaultCtas: ['RSVP', 'Add to Calendar'],
    defaults: {
      audience: 'Parents & Students',
      notesLabel: 'Event Details',
      sponsorStripLabel: ''
    }
  },

  club_activity: {
    id: 'club_activity',
    label: 'Club / Activity',
    description: 'Clubs, boosters, arts groups, student organizations',
    exampleName: 'Robotics Club Meeting',
    icon: '🎭',
    tier: TEMPLATE_TIER.MVP,
    mvp: true,  // S13: MVP template flag for stage-gating
    group: 'schools',
    displayOrder: 2,
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: true
    },
    defaultCtas: ['Join Club', 'View Schedule'],
    defaults: {
      audience: 'Members & Parents',
      notesLabel: 'Club Info',
      sponsorStripLabel: 'Club Sponsors'
    }
  },

  // ============================================================================
  // [MVP] COMMUNITY TEMPLATES - Group: community
  // ============================================================================

  community_day: {
    id: 'community_day',
    label: 'Community Day / Festival',
    description: 'Fairs, block parties, parish fests, rec center events',
    exampleName: 'Summer Block Party',
    icon: '🎪',
    tier: TEMPLATE_TIER.MVP,
    mvp: true,  // S13: MVP template flag for stage-gating
    group: 'community',
    displayOrder: 1,
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: true
    },
    defaultCtas: ['Get Directions', 'View Schedule'],
    defaults: {
      audience: 'Community Members',
      notesLabel: 'Event Info',
      sponsorStripLabel: 'Event Sponsors'
    }
  },

  // ============================================================================
  // [V2+] PROFESSIONAL & CORPORATE TEMPLATES - Group: professional
  // ============================================================================

  school: {
    id: 'school',
    label: 'School / Youth Event',
    description: 'School fundraisers, band boosters, sports events',
    exampleName: 'Band Booster Fundraiser',
    icon: '🎓',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'professional',
    displayOrder: 1,
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

  // Note: fundraiser moved to MVP tier in general group

  corporate: {
    id: 'corporate',
    label: 'Corporate / Professional',
    description: 'Conferences, networking, company events',
    exampleName: 'Q4 Sales Kickoff',
    icon: '💼',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'professional',
    displayOrder: 3,
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: false
    },
    defaultCtas: ['Register', 'Add to Calendar'],
    defaults: {
      audience: 'Employees & Partners',
      notesLabel: 'Agenda',
      sponsorStripLabel: 'Event Partners'
    }
  },

  // ============================================================================
  // [V2+] SOCIAL & CELEBRATION TEMPLATES - Group: social
  // ============================================================================

  wedding: {
    id: 'wedding',
    label: 'Wedding',
    description: 'Wedding celebrations, ceremonies, receptions',
    exampleName: 'Sarah & John Wedding',
    icon: '💒',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'social',
    displayOrder: 1,
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: false,
      notes: true,
      gallery: true
    },
    defaultCtas: ['RSVP', 'View Registry'],
    defaults: {
      audience: 'Guests & Family',
      notesLabel: 'Event Details',
      sponsorStripLabel: ''
    }
  },

  photo_gallery: {
    id: 'photo_gallery',
    label: 'Photo Gallery / Sharing',
    description: 'Weddings, birthdays, anniversaries - share photos',
    exampleName: 'Johnson Family Reunion Photos',
    icon: '📸',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'social',
    displayOrder: 2,
    sections: {
      video: true,
      map: false,
      schedule: false,
      sponsors: false,
      notes: true,
      gallery: true
    },
    defaultCtas: ['View Photos', 'Download'],
    defaults: {
      audience: 'Friends & Family',
      notesLabel: 'About This Event',
      sponsorStripLabel: ''
    }
  },

  shower: {
    id: 'shower',
    label: 'Shower (Baby/Bridal)',
    description: 'Baby showers, bridal showers, gift registries',
    exampleName: "Sarah's Baby Shower",
    icon: '🎀',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'social',
    displayOrder: 3,
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: false,
      notes: true,
      gallery: true
    },
    defaultCtas: ['RSVP', 'View Registry'],
    defaults: {
      audience: 'Friends & Family',
      notesLabel: 'Party Details',
      sponsorStripLabel: ''
    }
  },

  bachelor_party: {
    id: 'bachelor_party',
    label: 'Bachelor / Bachelorette',
    description: 'Bachelor parties, bachelorette weekends, stag nights',
    exampleName: "Jake's Bachelor Party",
    icon: '🥳',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'social',
    displayOrder: 4,
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: false,
      notes: true,
      gallery: true
    },
    defaultCtas: ['RSVP', 'View Itinerary'],
    defaults: {
      audience: 'Wedding Party & Friends',
      notesLabel: 'Party Details',
      sponsorStripLabel: ''
    }
  },

  // ============================================================================
  // [V2+] COMMUNITY & FAITH TEMPLATES - Group: community
  // ============================================================================

  farmers_market: {
    id: 'farmers_market',
    label: 'Farmers Market',
    description: 'Local markets, vendor fairs, craft shows',
    exampleName: 'Saturday Farmers Market',
    icon: '🥕',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'community',
    displayOrder: 1,
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: true
    },
    defaultCtas: ['Get Directions', 'View Vendors'],
    defaults: {
      audience: 'Shoppers & Vendors',
      notesLabel: 'Market Info',
      sponsorStripLabel: 'Market Sponsors'
    }
  },

  art_show: {
    id: 'art_show',
    label: 'Art Show / Exhibition',
    description: 'Art exhibits, gallery shows, artist showcases',
    exampleName: 'Spring Art Walk',
    icon: '🎨',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'community',
    displayOrder: 2,
    sections: {
      video: true,
      map: true,
      schedule: false,
      sponsors: true,
      notes: true,
      gallery: true
    },
    defaultCtas: ['RSVP', 'View Gallery'],
    defaults: {
      audience: 'Art Enthusiasts',
      notesLabel: 'Exhibition Details',
      sponsorStripLabel: 'Gallery Sponsors'
    }
  },

  carnival: {
    id: 'carnival',
    label: 'Carnival / Fair',
    description: 'Carnivals, county fairs, community festivals',
    exampleName: 'Summer Carnival',
    icon: '🎡',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'community',
    displayOrder: 3,
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: true
    },
    defaultCtas: ['Buy Tickets', 'View Schedule'],
    defaults: {
      audience: 'Families & Community',
      notesLabel: 'Event Info',
      sponsorStripLabel: 'Carnival Sponsors'
    }
  },

  church: {
    id: 'church',
    label: 'Church Event',
    description: 'Services, potlucks, community gatherings',
    exampleName: 'Easter Service',
    icon: '⛪',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'community',
    displayOrder: 4,
    sections: {
      video: true,
      map: true,
      schedule: true,
      sponsors: false,
      notes: true,
      gallery: true
    },
    defaultCtas: ['RSVP', 'Get Directions'],
    defaults: {
      audience: 'Congregation & Guests',
      notesLabel: 'Event Details',
      sponsorStripLabel: ''
    }
  },

  church_club: {
    id: 'church_club',
    label: "Church Group / Club",
    description: "Men's, women's, youth groups and ministries",
    exampleName: "Women's Bible Study",
    icon: '✝️',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'community',
    displayOrder: 5,
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: false,
      notes: true,
      gallery: true
    },
    defaultCtas: ['Join Group', 'Contact Leader'],
    defaults: {
      audience: 'Group Members',
      notesLabel: 'Group Info',
      sponsorStripLabel: ''
    }
  },

  // ============================================================================
  // [V2+] BAR GAMES TEMPLATES - Group: leagues (V2 tier)
  // ============================================================================

  trivia: {
    id: 'trivia',
    label: 'Trivia Night',
    description: 'Pub trivia, quiz nights, team competitions',
    exampleName: 'Wednesday Trivia',
    icon: '🧠',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'leagues',
    displayOrder: 10,
    sections: {
      video: false,
      map: true,
      schedule: false,
      sponsors: true,
      notes: true,
      gallery: false
    },
    defaultCtas: ['Register Team', 'View Rules'],
    defaults: {
      audience: 'Teams & Players',
      notesLabel: 'House Rules',
      sponsorStripLabel: "Tonight's Sponsors"
    }
  },

  darts: {
    id: 'darts',
    label: 'Darts League',
    description: 'Dart leagues, tournaments, competitions',
    exampleName: 'Tuesday Darts League',
    icon: '🎯',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'leagues',
    displayOrder: 11,
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: false
    },
    defaultCtas: ['Register', 'View Standings'],
    defaults: {
      audience: 'Players & Teams',
      notesLabel: 'League Rules',
      sponsorStripLabel: 'League Sponsors'
    },
    defaultExternalProvider: 'Custom'
  },

  bags: {
    id: 'bags',
    label: 'Bags / Cornhole',
    description: 'Cornhole leagues, bags tournaments',
    exampleName: 'Summer Bags League',
    icon: '🥏',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'leagues',
    displayOrder: 12,
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: false
    },
    defaultCtas: ['Register Team', 'View Bracket'],
    defaults: {
      audience: 'Players & Teams',
      notesLabel: 'League Rules',
      sponsorStripLabel: 'League Sponsors'
    },
    defaultExternalProvider: 'Custom'
  },

  pinball: {
    id: 'pinball',
    label: 'Pinball League',
    description: 'Pinball leagues, arcade tournaments',
    exampleName: 'Monday Pinball League',
    icon: '🕹️',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - not available in MVP build
    group: 'leagues',
    displayOrder: 13,
    sections: {
      video: false,
      map: true,
      schedule: true,
      sponsors: true,
      notes: true,
      gallery: false
    },
    defaultCtas: ['Register', 'View Rankings'],
    defaults: {
      audience: 'Players',
      notesLabel: 'League Rules',
      sponsorStripLabel: 'League Sponsors'
    },
    defaultExternalProvider: 'Custom'
  },

  // ============================================================================
  // [V2+] TRAVEL & LODGING TEMPLATES - Group: travel
  // ============================================================================

  travel_hub: {
    id: 'travel_hub',
    label: 'Travel Hub / Local Guide',
    description: 'Lodging + local guide with nearby wineries, breweries, food, and activities',
    exampleName: 'Harbor Country Cabins Guide',
    icon: '🏡',
    tier: TEMPLATE_TIER.V2,
    mvp: false,  // S13: V2 template - post-MVP core growth feature
    group: 'travel',
    displayOrder: 1,
    sections: {
      video: true,
      map: true,
      schedule: false,  // Not event-based, persistent guide
      sponsors: true,
      notes: true,
      gallery: true
    },
    defaultCtas: ['View Guide', 'Get Directions'],
    defaults: {
      audience: 'Guests & Travelers',
      notesLabel: 'Stay Info',
      sponsorStripLabel: 'Local Partners'
    },
    // Travel Hub specific structure
    travelHubConfig: {
      // Host/Property block
      host: {
        name: '',
        address: '',
        mapUrl: '',
        checkIn: '',
        checkOut: '',
        houseRules: '',
        emergencyContact: '',
        wifi: '',
        parking: '',
        specialNotes: ''
      },
      // Local "Layers" - categories of nearby recommendations
      defaultLayers: [
        { id: 'wine_weekend', label: 'Wineries', icon: '🍷', enabled: true },
        { id: 'craft_beer', label: 'Breweries', icon: '🍺', enabled: true },
        { id: 'bocce_bonfire', label: 'Bocce + Bonfires', icon: '🔥', enabled: true },
        { id: 'foodie', label: 'Foodie', icon: '🍽️', enabled: true },
        { id: 'outdoors', label: 'Outdoors', icon: '🏕️', enabled: true },
        { id: 'family_friendly', label: 'Family Friendly', icon: '👨‍👩‍👧‍👦', enabled: true },
        { id: 'couples_retreat', label: 'Couples', icon: '💑', enabled: true },
        { id: 'group_trip', label: 'Group Trip', icon: '🎉', enabled: true }
      ],
      // Optional curated weekend packs
      weekendPacks: []
    }
  }
};

// ============================================================================
// [MVP] Template Helpers
// ============================================================================

/**
 * Get all available event templates (MVP)
 * @returns {Array} Array of template objects
 */
function getEventTemplates_() {
  return Object.values(EVENT_TEMPLATES);
}

/**
 * Get a specific template by ID (MVP)
 * @param {string} templateId - Template identifier
 * @returns {Object} Template object (defaults to 'custom' if not found)
 */
function getEventTemplate_(templateId) {
  return EVENT_TEMPLATES[templateId] || EVENT_TEMPLATES.custom;
}

/**
 * Get templates filtered by tier
 * @param {string} tier - Template tier ('mvp' or 'v2')
 * @returns {Array} Array of template objects matching the tier
 */
function getTemplatesByTier_(tier) {
  return Object.values(EVENT_TEMPLATES).filter(function(t) {
    return t.tier === tier;
  });
}

/**
 * Get MVP-tier templates only (stage-gate filter)
 * @returns {Array} Array of MVP template objects
 */
function getMvpTemplates_() {
  return getTemplatesByTier_(TEMPLATE_TIER.MVP);
}

/**
 * Check if a template is MVP (stage-gate)
 * @param {string} templateId - Template ID to check
 * @returns {boolean} True if template is MVP tier
 */
function isMvpTemplate_(templateId) {
  var template = EVENT_TEMPLATES[templateId];
  return template && template.mvp === true;
}

/**
 * Validate MVP template requirements
 * Per S13 acceptance criteria: Must have 3-6 base templates marked as MVP
 * @returns {Object} Validation result with ok, count, and message
 */
function validateMvpTemplateRequirements_() {
  var mvpTemplates = getMvpTemplates_();
  var count = mvpTemplates.length;
  var min = MVP_TEMPLATE_REQUIREMENTS.MIN_COUNT;
  var max = MVP_TEMPLATE_REQUIREMENTS.MAX_COUNT;

  if (count < min) {
    return {
      ok: false,
      count: count,
      message: 'Too few MVP templates: ' + count + ' (minimum ' + min + ' required)'
    };
  }

  if (count > max) {
    return {
      ok: false,
      count: count,
      message: 'Too many MVP templates: ' + count + ' (maximum ' + max + ' allowed for MVP build)'
    };
  }

  return {
    ok: true,
    count: count,
    message: 'MVP template count valid: ' + count + ' templates (range ' + min + '-' + max + ')'
  };
}

/**
 * Get template groups filtered by tier
 * @param {string} tier - Optional tier filter ('mvp' or 'v2')
 * @returns {Array} Array of group objects
 */
function getTemplateGroups_(tier) {
  if (!tier) {
    return TEMPLATE_GROUPS.slice().sort(function(a, b) {
      return a.displayOrder - b.displayOrder;
    });
  }
  return TEMPLATE_GROUPS.filter(function(g) {
    return g.tier === tier;
  }).sort(function(a, b) {
    return a.displayOrder - b.displayOrder;
  });
}

/**
 * Get templates grouped by category for UI display
 * @param {string} tier - Optional tier filter ('mvp' to only show MVP templates)
 * @returns {Array} Array of groups with their templates
 */
function getGroupedTemplates_(tier) {
  var groups = getTemplateGroups_(tier);
  var templates = tier ? getTemplatesByTier_(tier) : getEventTemplates_();

  return groups.map(function(group) {
    var groupTemplates = templates.filter(function(t) {
      return t.group === group.id;
    }).sort(function(a, b) {
      return (a.displayOrder || 99) - (b.displayOrder || 99);
    });

    return {
      id: group.id,
      label: group.label,
      description: group.description,
      icon: group.icon,
      tier: group.tier,
      templates: groupTemplates
    };
  }).filter(function(group) {
    // Only return groups that have templates
    return group.templates.length > 0;
  });
}

/**
 * Apply template defaults to an event object (MVP-frozen)
 * Only sets values where user hasn't already provided data.
 *
 * IMPORTANT: This function MUST only set fields that exist in /schemas/event.schema.json (v2.2)
 * If a field isn't in the schema, it doesn't get set here.
 *
 * Settings fields set by this function:
 *   - showSchedule, showStandings, showBracket, showSponsors (section visibility)
 *   - showSponsorBanner, showSponsorStrip, showLeagueStrip, showQRSection (surface toggles)
 *
 * @param {Object} event - Event object (can be partial data from form)
 * @param {string} templateId - Template ID to apply
 * @returns {Object} Modified event object with template defaults applied
 * @see /schemas/event.schema.json Settings definition
 * @see EVENT_CONTRACT.md
 */
function applyTemplateToEvent_(event, templateId) {
  var tpl = getEventTemplate_(templateId);

  // === templateId: IN SCHEMA (MVP OPTIONAL) ===
  event.templateId = tpl.id;

  // ═══════════════════════════════════════════════════════════════════════════
  // Settings: MUST match /schemas/event.schema.json Settings (MVP-frozen v2.2)
  // ═══════════════════════════════════════════════════════════════════════════
  event.settings = event.settings || {};

  // Map template sections to contract settings
  // Template sections.schedule → settings.showSchedule
  if (event.settings.showSchedule == null) {
    event.settings.showSchedule = !!(tpl.sections && tpl.sections.schedule);
  }
  // Template sections.sponsors → settings.showSponsors
  if (event.settings.showSponsors == null) {
    event.settings.showSponsors = !!(tpl.sections && tpl.sections.sponsors);
  }
  // Template sections.video → settings.showVideo
  if (event.settings.showVideo == null) {
    event.settings.showVideo = !!(tpl.sections && tpl.sections.video);
  }
  // Template sections.map → settings.showMap
  if (event.settings.showMap == null) {
    event.settings.showMap = !!(tpl.sections && tpl.sections.map);
  }
  // Template sections.gallery → settings.showGallery
  if (event.settings.showGallery == null) {
    event.settings.showGallery = !!(tpl.sections && tpl.sections.gallery);
  }
  // showStandings and showBracket - default false unless template has specific support
  if (event.settings.showStandings == null) {
    // Only league-type templates default to showStandings=true
    var leagueTemplates = ['rec_league', 'bocce', 'youth_sports', 'darts', 'bags', 'pinball'];
    event.settings.showStandings = leagueTemplates.includes(tpl.id);
  }
  if (event.settings.showBracket == null) {
    // Only tournament-style templates default to showBracket=true
    var bracketTemplates = ['rec_league', 'bocce', 'youth_sports', 'bags'];
    event.settings.showBracket = bracketTemplates.includes(tpl.id);
  }

  // Surface-specific toggles (MVP Optional per schema, default true)
  if (event.settings.showSponsorBanner == null) {
    event.settings.showSponsorBanner = true;
  }
  if (event.settings.showSponsorStrip == null) {
    event.settings.showSponsorStrip = true;
  }
  if (event.settings.showLeagueStrip == null) {
    event.settings.showLeagueStrip = true;
  }
  if (event.settings.showQRSection == null) {
    event.settings.showQRSection = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // [V2+] LEGACY FIELDS - REMOVED FROM MVP (not in /schemas/event.schema.json)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // The following fields were deprecated and removed from the MVP contract:
  //   - sections.*         → Use settings.showSchedule, settings.showSponsors, etc.
  //   - ctaLabels[]        → Use ctas.primary, ctas.secondary
  //   - notesLabel         → [V2+] Custom section labels
  //   - sponsorStripLabel  → [V2+] Custom section labels
  //   - audience           → [V2+] Event audience targeting
  //   - status             → [V2+] Event lifecycle (draft|published|cancelled)
  //
  // These fields are NO LONGER written by applyTemplateToEvent_().
  // Old data with these fields will be migrated by _buildEventContract_() in Code.gs.
  // ═══════════════════════════════════════════════════════════════════════════

  return event;
}

/**
 * Convert flat section booleans (from Admin form) to SectionConfig objects
 * Helper for api_create when receiving legacy format from Admin.html
 *
 * @param {Object} sections - { video: true, map: false, ... }
 * @returns {Object} - { video: { enabled: true, title: null, content: null }, ... }
 */
function normalizeSections_(sections) {
  if (!sections) return null;

  var result = {};
  var keys = ['video', 'map', 'schedule', 'sponsors', 'notes', 'gallery'];

  keys.forEach(function(key) {
    if (sections[key] != null) {
      if (typeof sections[key] === 'boolean') {
        result[key] = { enabled: sections[key], title: null, content: null };
      } else if (typeof sections[key] === 'object') {
        result[key] = sections[key];
      }
    }
  });

  return result;
}

/**
 * Validate that a template ID exists (MVP)
 * @param {string} templateId - Template ID to validate
 * @returns {boolean} True if valid
 */
function isValidTemplate_(templateId) {
  return templateId && Object.prototype.hasOwnProperty.call(EVENT_TEMPLATES, templateId);
}

/**
 * Get template display name with icon (MVP)
 * @param {string} templateId - Template ID
 * @returns {string} Display string like "🍺 Bar / Tavern Event"
 */
function getTemplateDisplayName_(templateId) {
  var tpl = getEventTemplate_(templateId);
  return (tpl.icon || '') + ' ' + (tpl.label || 'Custom Event');
}

// ============================================================================
// [v2+] EXPERIMENTAL - Enhanced Template System
// ============================================================================

/**
 * Get template by ID with inheritance resolution
 *
 * @param {string} templateId - Template ID
 * @param {string} [locale] - Optional locale for localized templates
 * @returns {Object} Result envelope with resolved template
 */
function TemplateService_getTemplate(templateId, locale) {
  try {
    if (!templateId) {
      return Err('BAD_INPUT', 'Missing required parameter: templateId');
    }

    // Load templates from Config
    const template = findTemplate_(templateId);

    if (!template) {
      return Err('NOT_FOUND', `Template not found: ${templateId}`);
    }

    // Resolve inheritance chain
    const resolvedTemplate = resolveTemplateInheritance_(template);

    // Apply locale-specific overrides if provided
    if (locale && resolvedTemplate.locales && resolvedTemplate.locales[locale]) {
      Object.assign(resolvedTemplate, resolvedTemplate.locales[locale]);
    }

    Logger.log(`Template ${templateId} resolved successfully`);

    return Ok({
      template: resolvedTemplate
    });

  } catch (err) {
    Logger.log('TemplateService_getTemplate error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to get template: ' + err.message);
  }
}

/**
 * List all available templates
 *
 * @param {Object} [params] - Optional parameters
 * @param {string} [params.category] - Filter by category
 * @param {string} [params.locale] - Filter by locale
 * @param {boolean} [params.includeDeprecated=false] - Include deprecated templates
 * @returns {Object} Result envelope with templates array
 */
function TemplateService_listTemplates(params) {
  try {
    params = params || {};

    // Load all templates from Config
    let templates = TEMPLATES || [];

    // Filter by category
    if (params.category) {
      templates = templates.filter(t => t.category === params.category);
    }

    // Filter deprecated unless requested
    if (!params.includeDeprecated) {
      templates = templates.filter(t => !t.deprecated);
    }

    // Map to summary format (exclude detailed field definitions)
    const templateSummaries = templates.map(t => ({
      id: t.id,
      label: t.label,
      description: t.description,
      category: t.category || 'general',
      version: t.version || 1,
      deprecated: t.deprecated || false,
      extendsFrom: t.extendsFrom || null,
      locales: Object.keys(t.locales || {})
    }));

    return Ok({
      templates: templateSummaries,
      count: templateSummaries.length
    });

  } catch (err) {
    Logger.log('TemplateService_listTemplates error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to list templates: ' + err.message);
  }
}

/**
 * Validate data against template schema
 *
 * @param {string} templateId - Template ID
 * @param {Object} data - Data to validate
 * @param {string} [locale] - Optional locale
 * @returns {Object} Result envelope with validation result
 */
function TemplateService_validateData(templateId, data, locale) {
  try {
    if (!templateId || !data) {
      return Err('BAD_INPUT', 'Missing required parameters: templateId, data');
    }

    const templateResult = TemplateService_getTemplate(templateId, locale);
    if (!templateResult.ok) {
      return templateResult;
    }

    const template = templateResult.value.template;
    const errors = [];

    // Validate each field
    for (const field of template.fields) {
      const value = data[field.id];

      // Check required fields
      if (field.required && (value === undefined || value === null || value === '')) {
        errors.push({
          field: field.id,
          message: `${field.label} is required`,
          code: 'REQUIRED_FIELD'
        });
        continue;
      }

      // Skip validation for optional empty fields
      if (!field.required && (value === undefined || value === null || value === '')) {
        continue;
      }

      // Type validation
      const typeValidation = validateFieldType_(field, value);
      if (!typeValidation.ok) {
        errors.push({
          field: field.id,
          message: typeValidation.message,
          code: 'TYPE_MISMATCH'
        });
      }

      // Custom validation rules
      if (field.validation) {
        const customValidation = validateFieldCustomRules_(field, value);
        if (!customValidation.ok) {
          errors.push({
            field: field.id,
            message: customValidation.message,
            code: 'VALIDATION_FAILED'
          });
        }
      }
    }

    // Check for extra fields not in template
    if (template.strictMode) {
      const allowedFields = new Set(template.fields.map(f => f.id));
      for (const key of Object.keys(data)) {
        if (!allowedFields.has(key)) {
          errors.push({
            field: key,
            message: `Unknown field: ${key}`,
            code: 'UNKNOWN_FIELD'
          });
        }
      }
    }

    const valid = errors.length === 0;

    Logger.log(`Template validation ${valid ? 'passed' : 'failed'} for ${templateId}: ${errors.length} errors`);

    return Ok({
      valid: valid,
      errors: errors,
      templateId: templateId
    });

  } catch (err) {
    Logger.log('TemplateService_validateData error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to validate data: ' + err.message);
  }
}

/**
 * Migrate data from one template version to another
 *
 * @param {Object} data - Data to migrate
 * @param {string} fromTemplateId - Source template ID
 * @param {string} toTemplateId - Target template ID
 * @returns {Object} Result envelope with migrated data
 */
function TemplateService_migrateData(data, fromTemplateId, toTemplateId) {
  try {
    if (!data || !fromTemplateId || !toTemplateId) {
      return Err('BAD_INPUT', 'Missing required parameters: data, fromTemplateId, toTemplateId');
    }

    const fromTemplate = findTemplate_(fromTemplateId);
    const toTemplate = findTemplate_(toTemplateId);

    if (!fromTemplate || !toTemplate) {
      return Err('NOT_FOUND', 'Template not found');
    }

    // If templates are the same, no migration needed
    if (fromTemplateId === toTemplateId) {
      return Ok({ data: data, migrated: false });
    }

    // Apply migration function if defined
    if (toTemplate.migration && typeof toTemplate.migration === 'function') {
      const migratedData = toTemplate.migration(data, fromTemplate);
      Logger.log(`Data migrated from ${fromTemplateId} to ${toTemplateId}`);
      return Ok({ data: migratedData, migrated: true });
    }

    // Default migration: copy matching fields
    const migratedData = {};
    const toFieldIds = new Set(toTemplate.fields.map(f => f.id));

    for (const [key, value] of Object.entries(data)) {
      if (toFieldIds.has(key)) {
        migratedData[key] = value;
      }
    }

    // Apply default values for new required fields
    for (const field of toTemplate.fields) {
      if (field.required && !(field.id in migratedData)) {
        migratedData[field.id] = field.defaultValue || '';
      }
    }

    Logger.log(`Data migrated (default) from ${fromTemplateId} to ${toTemplateId}`);

    return Ok({ data: migratedData, migrated: true });

  } catch (err) {
    Logger.log('TemplateService_migrateData error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to migrate data: ' + err.message);
  }
}

/**
 * Render template as HTML form
 *
 * @param {string} templateId - Template ID
 * @param {Object} [data] - Pre-filled data
 * @param {string} [locale] - Optional locale
 * @returns {Object} Result envelope with HTML string
 */
function TemplateService_renderForm(templateId, data, locale) {
  try {
    const templateResult = TemplateService_getTemplate(templateId, locale);
    if (!templateResult.ok) {
      return templateResult;
    }

    const template = templateResult.value.template;
    data = data || {};

    const html = [];
    html.push('<form class="template-form" data-template-id="' + template.id + '">');

    for (const field of template.fields) {
      html.push(renderField_(field, data[field.id], locale));
    }

    html.push('</form>');

    return Ok({
      html: html.join('\n'),
      templateId: templateId
    });

  } catch (err) {
    Logger.log('TemplateService_renderForm error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to render form: ' + err.message);
  }
}

/**
 * Compose a new template from multiple base templates
 *
 * @param {Object} params - Composition parameters
 * @param {string} params.id - New template ID
 * @param {string} params.label - Template label
 * @param {Array<string>} params.composedFrom - Array of template IDs to compose
 * @param {Array<Object>} [params.additionalFields] - Additional fields to add
 * @returns {Object} Result envelope with composed template
 */
function TemplateService_composeTemplate(params) {
  try {
    if (!params || !params.id || !params.composedFrom || !Array.isArray(params.composedFrom)) {
      return Err('BAD_INPUT', 'Missing required parameters: id, composedFrom');
    }

    const composedTemplate = {
      id: params.id,
      label: params.label || params.id,
      description: params.description || 'Composed template',
      category: params.category || 'custom',
      composedFrom: params.composedFrom,
      fields: []
    };

    // Merge fields from all source templates
    const fieldIds = new Set();

    for (const sourceId of params.composedFrom) {
      const source = findTemplate_(sourceId);
      if (!source) {
        return Err('NOT_FOUND', `Source template not found: ${sourceId}`);
      }

      for (const field of source.fields) {
        // Avoid duplicate fields
        if (!fieldIds.has(field.id)) {
          composedTemplate.fields.push({ ...field }); // Deep copy
          fieldIds.add(field.id);
        }
      }
    }

    // Add additional fields if provided
    if (params.additionalFields) {
      for (const field of params.additionalFields) {
        if (!fieldIds.has(field.id)) {
          composedTemplate.fields.push(field);
          fieldIds.add(field.id);
        }
      }
    }

    Logger.log(`Composed template ${params.id} from ${params.composedFrom.join(', ')}`);

    return Ok({
      template: composedTemplate
    });

  } catch (err) {
    Logger.log('TemplateService_composeTemplate error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to compose template: ' + err.message);
  }
}

// ============================================================================
// Private Helper Functions
// ============================================================================

/**
 * Find template by ID
 *
 * @param {string} templateId - Template ID
 * @returns {Object|null} Template object or null
 * @private
 */
function findTemplate_(templateId) {
  const templates = TEMPLATES || [];
  return templates.find(t => t.id === templateId) || null;
}

/**
 * Resolve template inheritance chain
 *
 * @param {Object} template - Template object
 * @returns {Object} Resolved template with inherited fields
 * @private
 */
function resolveTemplateInheritance_(template) {
  // If no inheritance, return as-is
  if (!template.extendsFrom) {
    return { ...template };
  }

  // Get parent template
  const parent = findTemplate_(template.extendsFrom);
  if (!parent) {
    Logger.log(`Warning: Parent template not found: ${template.extendsFrom}`);
    return { ...template };
  }

  // Recursively resolve parent inheritance
  const resolvedParent = resolveTemplateInheritance_(parent);

  // Merge parent and child
  const resolved = {
    ...resolvedParent,
    ...template,
    fields: [
      ...(resolvedParent.fields || []),
      ...(template.fields || [])
    ]
  };

  // Remove duplicate fields (child overrides parent)
  const fieldMap = new Map();
  for (const field of resolved.fields) {
    fieldMap.set(field.id, field);
  }
  resolved.fields = Array.from(fieldMap.values());

  return resolved;
}

/**
 * Validate field type
 *
 * @param {Object} field - Field definition
 * @param {*} value - Value to validate
 * @returns {Object} Validation result
 * @private
 */
function validateFieldType_(field, value) {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'tel':
      if (typeof value !== 'string') {
        return { ok: false, message: `${field.label} must be a string` };
      }
      break;

    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        return { ok: false, message: `${field.label} must be a number` };
      }
      break;

    case 'date':
    case 'time':
    case 'datetime':
      // Accept ISO date strings or Date objects
      if (typeof value !== 'string' && !(value instanceof Date)) {
        return { ok: false, message: `${field.label} must be a date` };
      }
      break;

    case 'url':
      if (typeof value !== 'string' || !value.match(/^https?:\/\/.+/)) {
        return { ok: false, message: `${field.label} must be a valid URL` };
      }
      break;

    case 'checkbox':
    case 'boolean':
      if (typeof value !== 'boolean') {
        return { ok: false, message: `${field.label} must be true or false` };
      }
      break;

    case 'select':
    case 'radio':
      if (!field.options || !field.options.includes(value)) {
        return { ok: false, message: `${field.label} must be one of: ${field.options.join(', ')}` };
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        return { ok: false, message: `${field.label} must be an array` };
      }
      break;

    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, message: `${field.label} must be an object` };
      }
      break;
  }

  return { ok: true };
}

/**
 * Validate field custom rules
 *
 * @param {Object} field - Field definition
 * @param {*} value - Value to validate
 * @returns {Object} Validation result
 * @private
 */
function validateFieldCustomRules_(field, value) {
  const validation = field.validation;

  // Min length
  if (validation.minLength !== undefined && value.length < validation.minLength) {
    return {
      ok: false,
      message: `${field.label} must be at least ${validation.minLength} characters`
    };
  }

  // Max length
  if (validation.maxLength !== undefined && value.length > validation.maxLength) {
    return {
      ok: false,
      message: `${field.label} must be at most ${validation.maxLength} characters`
    };
  }

  // Min value
  if (validation.min !== undefined && value < validation.min) {
    return {
      ok: false,
      message: `${field.label} must be at least ${validation.min}`
    };
  }

  // Max value
  if (validation.max !== undefined && value > validation.max) {
    return {
      ok: false,
      message: `${field.label} must be at most ${validation.max}`
    };
  }

  // Pattern matching
  if (validation.pattern) {
    const regex = new RegExp(validation.pattern);
    if (!regex.test(value)) {
      return {
        ok: false,
        message: validation.patternMessage || `${field.label} format is invalid`
      };
    }
  }

  // Custom validation function
  if (validation.custom && typeof validation.custom === 'function') {
    const result = validation.custom(value);
    if (!result.ok) {
      return result;
    }
  }

  return { ok: true };
}

/**
 * Render a single field as HTML
 *
 * @param {Object} field - Field definition
 * @param {*} value - Pre-filled value
 * @param {string} locale - Locale for labels
 * @returns {string} HTML string
 * @private
 */
function renderField_(field, value, locale) {
  const label = field.label || field.id;
  const required = field.required ? 'required' : '';
  const placeholder = field.placeholder || '';

  value = value !== undefined ? value : (field.defaultValue || '');

  let input = '';

  switch (field.type) {
    case 'text':
    case 'email':
    case 'tel':
    case 'url':
    case 'date':
    case 'time':
      input = `<input type="${field.type}" name="${field.id}" value="${escapeHtml_(value)}" placeholder="${placeholder}" ${required} />`;
      break;

    case 'number': {
      const min = field.validation?.min !== undefined ? `min="${field.validation.min}"` : '';
      const max = field.validation?.max !== undefined ? `max="${field.validation.max}"` : '';
      input = `<input type="number" name="${field.id}" value="${value}" ${min} ${max} ${required} />`;
      break;
    }

    case 'textarea':
      input = `<textarea name="${field.id}" placeholder="${placeholder}" ${required}>${escapeHtml_(value)}</textarea>`;
      break;

    case 'checkbox': {
      const checked = value ? 'checked' : '';
      input = `<input type="checkbox" name="${field.id}" ${checked} ${required} />`;
      break;
    }

    case 'select': {
      const options = (field.options || []).map(opt => {
        const selected = opt === value ? 'selected' : '';
        return `<option value="${escapeHtml_(opt)}" ${selected}>${escapeHtml_(opt)}</option>`;
      }).join('\n');
      input = `<select name="${field.id}" ${required}>${options}</select>`;
      break;
    }

    default:
      input = `<input type="text" name="${field.id}" value="${escapeHtml_(value)}" ${required} />`;
  }

  return `
    <div class="form-field" data-field-id="${field.id}">
      <label for="${field.id}">${escapeHtml_(label)}${field.required ? ' *' : ''}</label>
      ${input}
      ${field.helpText ? `<small class="help-text">${escapeHtml_(field.helpText)}</small>` : ''}
    </div>
  `;
}

/**
 * Escape HTML special characters
 *
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 * @private
 */
function escapeHtml_(str) {
  if (typeof str !== 'string') return String(str);

  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * API endpoint: Get template
 *
 * @param {Object} params
 * @param {string} params.templateId - Template ID
 * @param {string} [params.locale] - Optional locale
 * @returns {Object} Result envelope
 */
function api_getTemplate(params) {
  return TemplateService_getTemplate(params.templateId, params.locale);
}

/**
 * API endpoint: List templates
 *
 * @param {Object} params - Optional parameters
 * @returns {Object} Result envelope
 */
function api_listTemplates(params) {
  return TemplateService_listTemplates(params);
}

/**
 * API endpoint: Validate data
 *
 * @param {Object} params
 * @param {string} params.templateId - Template ID
 * @param {Object} params.data - Data to validate
 * @param {string} [params.locale] - Optional locale
 * @returns {Object} Result envelope
 */
function api_validateTemplateData(params) {
  return TemplateService_validateData(params.templateId, params.data, params.locale);
}
