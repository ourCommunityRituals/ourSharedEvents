/**
 * API Schemas and Contracts
 *
 * GAS runtime validation that MIRRORS the JSON Schema source of truth.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * [MVP] CANONICAL SCHEMA FILES (4 total) - FROZEN
 * ═══════════════════════════════════════════════════════════════════════════
 *   - /schemas/event.schema.json           [MVP] Event entity (v1.0 FROZEN)
 *   - /schemas/sponsor.schema.json         [MVP] Sponsor entity (V2 feature)
 *   - /schemas/shared-analytics.schema.json [MVP] SharedAnalytics (v1.1 frozen)
 *   - /schemas/form-config.schema.json     [MVP] FormConfig (v1.0 frozen)
 *
 * MIGRATION POLICY: Breaking changes to frozen schemas require:
 *   1. New schema version (v1.1, v2.0)
 *   2. Migration script
 *   3. CI guard update
 *
 * IMPORTANT: If a field isn't in the JSON schema, it doesn't exist.
 *            If it's in the schema, it must be wired here.
 *
 * See EVENT_CONTRACT.md for human-readable documentation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RESPONSE ENVELOPE CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ALL API endpoints MUST return one of these two envelope shapes:
 *
 * SUCCESS:
 * {
 *   ok: true,
 *   etag?: string,           // Optional cache tag
 *   notModified?: boolean,   // Optional 304 equivalent
 *   value: { ... }           // Endpoint-specific payload
 * }
 *
 * ERROR:
 * {
 *   ok: false,
 *   code: "BAD_INPUT" | "NOT_FOUND" | "RATE_LIMITED" | "INTERNAL" | "UNAUTHORIZED" | "CONTRACT",
 *   message: "Human-readable error description",
 *   corrId?: string          // [Story 5.1] Correlation ID for error tracing (format: "timestamp36-random")
 * }
 *
 * [Story 5.1] CORRELATION ID (corrId):
 * - Format: Base36 timestamp + "-" + random suffix (e.g., "lqx5m8k-a7b2")
 * - Included in structured error responses via ErrWithCorrId_()
 * - Client sees: "Something went wrong. Reference: <corrId>"
 * - Logs contain: { level:"error", corrId, endpoint, message, stack, eventId? }
 * - Stack trace is NEVER exposed to client (only in logs)
 * - Use corrId to grep logs for debugging production errors
 *
 * NUSDK.html handles these envelopes consistently:
 * - Success: res.ok === true, data in res.value
 * - Error: res.ok === false, error in res.code + res.message + res.corrId?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RPC ENDPOINT INVENTORY (14 unique endpoints, 15 surface bindings)
 * ═══════════════════════════════════════════════════════════════════════════
 * Validated by: scripts/check-rpc-inventory.js
 *
 * Admin.html (6 endpoints):
 *   - api_getEventTemplates      → templates.getEventTemplates
 *   - api_saveEvent              → events.saveEvent   [CANONICAL write - ZEVENT-003]
 *   - api_get                    → events.get
 *   - api_getEventsSafe          → events.getEventsSafe  [Admin dropdown]
 *   - api_createFormFromTemplate → forms.createFromTemplate
 *   - api_generateFormShortlink  → forms.generateShortlink
 *
 * Public.html (3 endpoints):
 *   - api_getPublicBundle     → bundles.public
 *   - api_list                → events.list
 *   - api_logExternalClick    → analytics.logExternalClick
 *
 * Display.html (2 endpoints):
 *   - api_getDisplayBundle    → bundles.display
 *   - api_logExternalClick    → analytics.logExternalClick  [shared with Public]
 *
 * Poster.html (1 endpoint):
 *   - api_getPosterBundle     → bundles.poster
 *
 * SharedReport.html (3 MVP endpoints):
 *   - api_getSharedAnalytics  → analytics.getSharedReport
 *   - api_getSponsorAnalytics → analytics.getSponsorAnalytics
 *   - api_getSponsorReportQr  → analytics.getSponsorReportQr
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * [V2-QUARANTINE] BLOCKED ENDPOINTS - NOT ALLOWED IN MVP
 * ═══════════════════════════════════════════════════════════════════════════
 * These endpoints are V2 features, NOT part of the MVP contract.
 * CI will FAIL if these appear in MVP surface bindings.
 *
 * V2 BLOCKED ENDPOINTS:
 *   - api_exportSharedReport       → analytics.exportReport (export to CSV/JSON/PDF)
 *   - api_generateSharedReport     → (report generation with recommendations)
 *   - api_getPortfolioAnalyticsV2  → (multi-event portfolio mode)
 *
 * TO ENABLE V2 FEATURES:
 *   1. Set FEATURE_FLAGS.PORTFOLIO_V2 = true in Config.gs
 *   2. Move endpoint from V2_BLOCKED to EXPECTED_INVENTORY in check-rpc-inventory.js
 *   3. Wire UI buttons (remove display:none)
 *   4. Redeploy
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @module ApiSchemas
 * @version 2.5.0
 * @see /schemas/event.schema.json           [MVP] Event entity (v1.0 FROZEN)
 * @see /schemas/sponsor.schema.json         [MVP] Sponsor entity (V2)
 * @see /schemas/shared-analytics.schema.json [MVP] SharedAnalytics (v1.1 frozen)
 * @see /schemas/form-config.schema.json     [MVP] FormConfig (v1.0 frozen)
 * @see EVENT_CONTRACT.md
 */

// === Common Schemas =======================================================

const SCHEMAS = {
  // Common types
  common: {
    id: {
      type: 'string',
      pattern: '^[a-zA-Z0-9_-]+$',
      minLength: 1,
      maxLength: 128
    },
    brandId: {
      type: 'string',
      pattern: '^[a-zA-Z0-9_-]+$',
      minLength: 1,
      maxLength: 64
    },
    scope: {
      type: 'string',
      enum: ['events', 'leagues', 'tournaments']
    },
    isoDate: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z)?$'
    },
    url: {
      type: 'string',
      pattern: '^https?://.+'
    },
    email: {
      type: 'string',
      pattern: '^[^@]+@[^@]+\\.[^@]+$'
    }
  },

  // === Authentication Schemas ==============================================

  auth: {
    generateToken: {
      request: {
        type: 'object',
        required: ['brandId', 'adminKey'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          adminKey: { type: 'string', minLength: 1 },
          expiresIn: { type: 'number', minimum: 60, maximum: 86400 },
          scope: { $ref: '#/common/scope' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['token', 'expiresIn', 'expiresAt', 'usage'],
            properties: {
              token: { type: 'string' },
              expiresIn: { type: 'number' },
              expiresAt: { $ref: '#/common/isoDate' },
              usage: { type: 'string' }
            }
          }
        }
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // [MVP] EVENT SCHEMA - MIRRORS: /schemas/event.schema.json (v1.0 FROZEN)
  // ═══════════════════════════════════════════════════════════════════════════
  // See EVENT_CONTRACT.md for human-readable documentation
  // MIGRATION POLICY: Breaking changes require new schema version + migration

  events: {
    // Shared schema definitions for reuse

    // Schedule row for event schedule
    _scheduleRow: {
      type: 'object',
      required: ['time', 'title'],
      properties: {
        time: { type: 'string' },
        title: { type: 'string' },
        description: { type: ['string', 'null'] }
      }
    },

    // Standing row for standings table
    _standingRow: {
      type: 'object',
      required: ['rank', 'team', 'wins', 'losses'],
      properties: {
        rank: { type: 'number' },
        team: { type: 'string' },
        wins: { type: 'number' },
        losses: { type: 'number' },
        points: { type: ['number', 'null'] }
      }
    },

    // Bracket match
    _bracketMatch: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        team1: { type: ['string', 'null'] },
        team2: { type: ['string', 'null'] },
        score1: { type: ['number', 'null'] },
        score2: { type: ['number', 'null'] },
        winner: { type: ['string', 'null'] }
      }
    },

    // Bracket round
    _bracketRound: {
      type: 'object',
      required: ['name', 'matches'],
      properties: {
        name: { type: 'string' },
        matches: {
          type: 'array',
          items: { $ref: '#/schemas/events/_bracketMatch' }
        }
      }
    },

    // CTA object (primary/secondary)
    _cta: {
      type: 'object',
      required: ['label', 'url'],
      properties: {
        label: { type: 'string', minLength: 1 },
        url: { type: 'string' }
      }
    },

    // [MVP] SPONSOR SCHEMA - MIRRORS: /schemas/sponsor.schema.json
    // V2 feature with multi-placement support
    _sponsor: {
      type: 'object',
      required: ['id', 'name', 'logoUrl'],
      anyOf: [
        { required: ['placement'] },
        { required: ['placements'] }
      ],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        logoUrl: { type: 'string' },
        linkUrl: { type: ['string', 'null'] },
        placement: {
          type: 'string',
          enum: ['poster', 'display', 'public', 'tv-banner']
        },
        placements: {
          type: 'object',
          properties: {
            posterTop: { type: 'boolean' },
            tvTop: { type: 'boolean' },
            tvSide: { type: 'boolean' },
            mobileBanner: { type: 'boolean' }
          }
        },
        clickToken: { type: ['string', 'null'] },
        impressionToken: { type: ['string', 'null'] },
        tier: {
          type: 'string',
          enum: ['title', 'platinum', 'gold', 'silver', 'bronze', 'primary']
        }
      }
    },

    // Media object (V2)
    _media: {
      type: ['object', 'null'],
      properties: {
        videoUrl: { type: ['string', 'null'] },
        mapUrl: { type: ['string', 'null'] },
        gallery: {
          type: ['array', 'null'],
          items: { type: 'string' }
        }
      }
    },

    // External data (V2)
    _externalData: {
      type: ['object', 'null'],
      properties: {
        scheduleUrl: { type: ['string', 'null'] },
        standingsUrl: { type: ['string', 'null'] },
        bracketUrl: { type: ['string', 'null'] }
      }
    },

    // Display Configuration (V2 Optional)
    _displayConfig: {
      type: ['object', 'null'],
      properties: {
        mode: { type: 'string', enum: ['public', 'dynamic'] },
        urls: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            required: ['url'],
            properties: {
              url: { type: 'string', pattern: '^https?://.+' },
              seconds: { type: 'number', minimum: 5, maximum: 300 }
            }
          }
        }
      }
    },

    // Analytics (Reserved)
    _analytics: {
      type: ['object', 'null'],
      properties: {
        enabled: { type: 'boolean' },
        eventViews: { type: ['number', 'null'] },
        publicPageViews: { type: ['number', 'null'] },
        displayViews: { type: ['number', 'null'] },
        signupStarts: { type: ['number', 'null'] },
        signupCompletes: { type: ['number', 'null'] },
        qrScans: { type: ['number', 'null'] }
      }
    },

    // Payments (Reserved)
    _payments: {
      type: ['object', 'null'],
      properties: {
        enabled: { type: 'boolean' },
        provider: { type: 'string', enum: ['stripe'] },
        price: { type: 'number' },
        currency: { type: 'string' },
        checkoutUrl: { type: ['string', 'null'] }
      }
    },

    // Settings - MIRRORS: /schemas/event.schema.json Settings (MVP-frozen v2.2)
    _settings: {
      type: 'object',
      required: ['showSchedule', 'showStandings', 'showBracket'],
      properties: {
        // MVP Required
        showSchedule: { type: 'boolean' },
        showStandings: { type: 'boolean' },
        showBracket: { type: 'boolean' },
        // MVP Optional (V2 content but MVP toggles)
        showSponsors: { type: 'boolean' },
        // MVP Optional - Template-aware section toggles (Feature 4, default true)
        showVideo: { type: 'boolean' },
        showMap: { type: 'boolean' },
        showGallery: { type: 'boolean' },
        // MVP Optional - surface-specific toggles (default true)
        showSponsorBanner: { type: 'boolean' },
        showSponsorStrip: { type: 'boolean' },
        showLeagueStrip: { type: 'boolean' },
        showQRSection: { type: 'boolean' },
        // V2 Optional - Display rotation configuration
        displayRotation: {
          type: ['object', 'null'],
          properties: {
            enabled: { type: 'boolean' },
            panes: { type: 'array' },
            defaultDwellMs: { type: 'integer' }
          }
        }
      }
    },

    // [MVP] FULL EVENT SHAPE - MIRRORS: /schemas/event.schema.json (v2.2 frozen)
    // This is THE canonical Event object shape for all MVP surfaces
    _eventShape: {
      type: 'object',
      required: ['id', 'slug', 'name', 'startDateISO', 'venue', 'links', 'qr', 'ctas', 'settings', 'createdAtISO', 'updatedAtISO'],
      properties: {
        // Identity (MVP Required)
        id: { $ref: '#/common/id' },
        slug: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1, maxLength: 200 },
        startDateISO: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        venue: { type: 'string', minLength: 1, maxLength: 200 },
        templateId: { type: ['string', 'null'], maxLength: 64 },  // MVP Optional

        // Links (MVP Required)
        links: {
          type: 'object',
          required: ['publicUrl', 'displayUrl', 'posterUrl', 'signupUrl'],
          properties: {
            publicUrl: { type: 'string' },
            displayUrl: { type: 'string' },
            posterUrl: { type: 'string' },
            signupUrl: { type: 'string' },
            sharedReportUrl: { type: ['string', 'null'] }
          }
        },

        // QR Codes (MVP Required)
        qr: {
          type: 'object',
          required: ['public', 'signup'],
          properties: {
            public: { type: 'string' },
            signup: { type: 'string' }
          }
        },

        // Schedule/Standings/Bracket (MVP Optional)
        schedule: {
          type: ['array', 'null'],
          items: { $ref: '#/schemas/events/_scheduleRow' }
        },
        standings: {
          type: ['array', 'null'],
          items: { $ref: '#/schemas/events/_standingRow' }
        },
        bracket: {
          type: ['object', 'null'],
          properties: {
            rounds: {
              type: 'array',
              items: { $ref: '#/schemas/events/_bracketRound' }
            }
          }
        },

        // CTAs (MVP Required)
        ctas: {
          type: 'object',
          required: ['primary'],
          properties: {
            primary: { $ref: '#/schemas/events/_cta' },
            secondary: {
              oneOf: [
                { $ref: '#/schemas/events/_cta' },
                { type: 'null' }
              ]
            }
          }
        },

        // Sponsors (V2 Optional)
        sponsors: {
          type: ['array', 'null'],
          items: { $ref: '#/schemas/events/_sponsor' }
        },

        // Media (V2 Optional)
        media: { $ref: '#/schemas/events/_media' },

        // External Data (V2 Optional)
        externalData: { $ref: '#/schemas/events/_externalData' },

        // Form URLs (V2 Optional)
        checkinUrl: { type: ['string', 'null'], pattern: '^https?://.+' },
        walkinUrl: { type: ['string', 'null'], pattern: '^https?://.+' },
        surveyUrl: { type: ['string', 'null'], pattern: '^https?://.+' },

        // Display Configuration (V2 Optional)
        display: { $ref: '#/schemas/events/_displayConfig' },

        // Analytics (Reserved)
        analytics: { $ref: '#/schemas/events/_analytics' },

        // Payments (Reserved)
        payments: { $ref: '#/schemas/events/_payments' },

        // Settings (MVP Required)
        settings: { $ref: '#/schemas/events/_settings' },

        // Metadata (MVP Required)
        createdAtISO: { $ref: '#/common/isoDate' },
        updatedAtISO: { $ref: '#/common/isoDate' }
      }
    },

    list: {
      request: {
        type: 'object',
        required: ['brandId', 'scope'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          scope: { $ref: '#/common/scope' },
          limit: { type: 'number', minimum: 1, maximum: 1000, default: 100 },
          offset: { type: 'number', minimum: 0, default: 0 },
          ifNoneMatch: { type: 'string' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          etag: { type: 'string' },
          notModified: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['items', 'pagination'],
            properties: {
              items: {
                type: 'array',
                items: { $ref: '#/schemas/events/_eventShape' }
              },
              pagination: {
                type: 'object',
                required: ['total', 'limit', 'offset', 'hasMore'],
                properties: {
                  total: { type: 'number' },
                  limit: { type: 'number' },
                  offset: { type: 'number' },
                  hasMore: { type: 'boolean' }
                }
              }
            }
          }
        }
      }
    },

    get: {
      request: {
        type: 'object',
        required: ['brandId', 'scope', 'id'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          scope: { $ref: '#/common/scope' },
          id: { $ref: '#/common/id' },
          ifNoneMatch: { type: 'string' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          etag: { type: 'string' },
          notModified: { type: 'boolean' },
          value: { $ref: '#/schemas/events/_eventShape' }
        }
      }
    },

    // api_getEventsSafe - Simplified event list for Admin dropdown
    // Returns clean shape: { id, name, startDateISO, eventSpreadsheetUrl, publicUrl, displayUrl }
    getEventsSafe: {
      request: {
        type: 'object',
        required: ['brandId'],
        properties: {
          brandId: { $ref: '#/common/brandId' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['items'],
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'name', 'startDateISO', 'publicUrl', 'displayUrl'],
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    startDateISO: { type: 'string' },
                    eventSpreadsheetUrl: { type: 'string' },
                    publicUrl: { type: 'string' },
                    displayUrl: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    },

    create: {
      request: {
        type: 'object',
        required: ['brandId', 'scope', 'templateId', 'data', 'adminKey'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          scope: { $ref: '#/common/scope' },
          templateId: { type: 'string' },
          data: { type: 'object' },
          adminKey: { type: 'string' },
          idemKey: { type: 'string', pattern: '^[a-zA-Z0-9-]{1,128}$' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['id', 'links'],
            properties: {
              id: { $ref: '#/common/id' },
              links: { type: 'object' }
            }
          }
        }
      }
    },

    update: {
      request: {
        type: 'object',
        required: ['brandId', 'id', 'data', 'adminKey'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          scope: { $ref: '#/common/scope' },
          id: { $ref: '#/common/id' },
          data: { type: 'object' },
          adminKey: { type: 'string' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['id', 'data'],
            properties: {
              id: { $ref: '#/common/id' },
              data: { type: 'object' }
            }
          }
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // [MVP] CANONICAL EVENT WRITE API (ZEVENT-003)
    // ═══════════════════════════════════════════════════════════════════════════
    // api_saveEvent - Canonical event write endpoint
    //
    // Modes:
    //   - CREATE: event.id absent → generates new ID/slug/links/QR
    //   - UPDATE: event.id present → updates existing event (field merge)
    //
    // This is THE write endpoint for Admin.html and all MVP surfaces.
    // Legacy endpoints (api_create, api_updateEventData) are orphaned
    // but kept for backward compatibility.
    // ═══════════════════════════════════════════════════════════════════════════

    saveEvent: {
      request: {
        type: 'object',
        required: ['brandId', 'adminKey', 'event'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          adminKey: { type: 'string', minLength: 1 },
          event: {
            type: 'object',
            description: 'Full or partial Event object per EVENT_CONTRACT.md',
            properties: {
              // Identity - id present = UPDATE, absent = CREATE
              id: { $ref: '#/common/id' },
              slug: { type: 'string', minLength: 1, maxLength: 50 },
              // MVP Required for CREATE
              name: { type: 'string', minLength: 1, maxLength: 200 },
              startDateISO: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              venue: { type: 'string', minLength: 1, maxLength: 200 },
              // MVP Optional
              templateId: { type: ['string', 'null'] },
              schedule: { type: ['array', 'null'] },
              standings: { type: ['array', 'null'] },
              bracket: { type: ['object', 'null'] },
              ctas: { type: 'object' },
              settings: { type: 'object' },
              sponsors: { type: ['array', 'null'] },
              media: { type: ['object', 'null'] },
              externalData: { type: ['object', 'null'] }
            }
          },
          scope: { $ref: '#/common/scope' },
          templateId: { type: 'string', description: 'Template ID for CREATE mode' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          etag: { type: 'string' },
          value: { $ref: '#/schemas/events/_eventShape' }
        }
      }
    }
  },

  // === Bundle Schemas ======================================================
  // Optimized payloads for each surface (Public, Display, Poster)

  bundles: {
    // api_getPublicBundle - Public.html
    public: {
      request: {
        type: 'object',
        required: ['brandId', 'id'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          scope: { $ref: '#/common/scope' },
          id: { $ref: '#/common/id' },
          ifNoneMatch: { type: 'string' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          etag: { type: 'string' },
          notModified: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['event', 'config'],
            properties: {
              event: { $ref: '#/schemas/events/_eventShape' },
              config: {
                type: 'object',
                properties: {
                  brandId: { type: 'string' },
                  brandName: { type: 'string' },
                  appTitle: { type: 'string' }
                }
              }
            }
          }
        }
      }
    },

    // api_getDisplayBundle - Display.html
    display: {
      request: {
        type: 'object',
        required: ['brandId', 'id'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          scope: { $ref: '#/common/scope' },
          id: { $ref: '#/common/id' },
          ifNoneMatch: { type: 'string' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          etag: { type: 'string' },
          notModified: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['event', 'rotation', 'layout'],
            properties: {
              event: { $ref: '#/schemas/events/_eventShape' },
              rotation: {
                type: 'object',
                properties: {
                  sponsorSlots: { type: 'number' },
                  rotationMs: { type: 'number' }
                }
              },
              layout: {
                type: 'object',
                properties: {
                  hasSidePane: { type: 'boolean' },
                  emphasis: { type: 'string', enum: ['hero', 'scores', 'sponsors'] }
                }
              },
              // V2: Display rotation engine configuration
              displayRotation: {
                type: 'object',
                properties: {
                  enabled: { type: 'boolean', description: 'Whether rotation mode is active' },
                  defaultDwellMs: { type: 'number', description: 'Default dwell time per pane (ms)' },
                  panes: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['type'],
                      properties: {
                        type: { type: 'string', enum: ['public', 'schedule', 'standings', 'sponsors', 'custom'] },
                        dwellMs: { type: 'number', description: 'Override dwell time for this pane' },
                        url: { type: 'string', description: 'Custom URL for custom pane type' },
                        title: { type: 'string', description: 'Optional title overlay' }
                      }
                    }
                  },
                  paneTypes: {
                    type: 'object',
                    description: 'Pane type metadata for frontend rendering',
                    additionalProperties: {
                      type: 'object',
                      properties: {
                        label: { type: 'string' },
                        description: { type: 'string' },
                        defaultDwellMs: { type: 'number' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },

    // api_getPosterBundle - Poster.html
    poster: {
      request: {
        type: 'object',
        required: ['brandId', 'id'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          scope: { $ref: '#/common/scope' },
          id: { $ref: '#/common/id' },
          ifNoneMatch: { type: 'string' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          etag: { type: 'string' },
          notModified: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['event', 'qrCodes', 'print'],
            properties: {
              event: { $ref: '#/schemas/events/_eventShape' },
              qrCodes: {
                type: 'object',
                properties: {
                  public: { type: ['string', 'null'] },
                  signup: { type: ['string', 'null'] }
                }
              },
              print: {
                type: 'object',
                properties: {
                  dateLine: { type: ['string', 'null'] },
                  venueLine: { type: ['string', 'null'] }
                }
              }
            }
          }
        }
      }
    }
  },

  // === Template Schemas ====================================================

  templates: {
    // api_getEventTemplates - Admin.html
    getEventTemplates: {
      request: {
        type: 'object',
        required: ['brandId'],
        properties: {
          brandId: { $ref: '#/common/brandId' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['templates', 'defaultTemplateId'],
            properties: {
              templates: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'label'],
                  properties: {
                    id: { type: 'string' },
                    label: { type: 'string' },
                    description: { type: 'string' },
                    icon: { type: 'string' },
                    exampleName: { type: 'string' }
                  }
                }
              },
              defaultTemplateId: { type: 'string' }
            }
          }
        }
      }
    }
  },

  // === Analytics Schemas ===================================================

  analytics: {
    // ═══════════════════════════════════════════════════════════════════════════
    // [MVP] CANONICAL SHAREDREPORT API SET (Story 6 Decision)
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // SharedReport.html uses exactly 3 MVP APIs:
    //
    // 1. api_getSharedAnalytics({ brandId }) → SharedAnalytics
    //    - Event-level analytics bundle for organizer dashboard
    //    - Returns: summary, surfaces[], sponsors[], events[], topSponsors[]
    //    - Schema: analytics.getSharedReport
    //
    // 2. api_getSponsorAnalytics({ brandId, sponsorId, eventId? }) → SharedAnalytics
    //    - Focused sponsor-scoped analytics for sponsor-specific reports
    //    - Same response shape, scoped to single sponsor
    //    - Schema: analytics.getSponsorAnalytics
    //
    // 3. api_getSponsorReportQr({ sponsorId, brandId? }) → { url, qrB64, verified }
    //    - Generates QR code for sharing sponsor report link
    //    - Returns base64 PNG QR code image
    //    - Schema: analytics.getSponsorReportQr
    //
    // V2-ONLY (BLOCKED for MVP release):
    //
    // 4. api_exportSharedReport({ brandId, eventId?, format }) → Err(BAD_INPUT)
    //    - Export analytics to CSV/JSON/PDF
    //    - MVP BLOCKED: Returns "Export not enabled" error
    //    - UI: Button hidden (display:none) in SharedReport.html
    //
    // 5. api_generateSharedReport({ brandId, filters? }) → Err(BAD_INPUT)
    //    - Generate formatted report with recommendations
    //    - MVP BLOCKED: Returns "Report generation not enabled" error
    //    - Was used internally by api_exportSharedReport
    //
    // 6. api_getPortfolioAnalyticsV2({ brandId, mode, sponsorId?, adminKey })
    //    - Multi-event portfolio mode for cross-brand aggregation
    //    - MVP BLOCKED: loadReport() returns error before API call
    //    - UI: Portfolio toggle button hidden (display:none)
    //    - V2 feature in archive/v2-code/SponsorPortfolioV2.gs
    //
    // ═══════════════════════════════════════════════════════════════════════════

    // api_logExternalClick - Public.html, Display.html
    logExternalClick: {
      request: {
        type: 'object',
        required: ['eventId', 'surface', 'token'],
        properties: {
          eventId: { $ref: '#/common/id' },
          surface: { type: 'string', enum: ['public', 'display', 'poster'] },
          token: { type: 'string' },
          brandId: { $ref: '#/common/brandId' }
        }
      },
      response: {
        type: 'object',
        required: ['ok'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            properties: {
              logged: { type: 'boolean' }
            }
          }
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // [MVP] SHAREDANALYTICS SCHEMA - MIRRORS: /schemas/shared-analytics.schema.json (v1.1 frozen)
    // Used by: api_getSharedAnalytics, api_getSponsorAnalytics
    // This is THE canonical SharedAnalytics object shape for SharedReport.html
    // ═══════════════════════════════════════════════════════════════════════════
    _sharedAnalytics: {
      type: 'object',
      required: ['lastUpdatedISO', 'summary', 'surfaces'],
      properties: {
        lastUpdatedISO: { type: 'string' },
        summary: {
          type: 'object',
          required: ['totalImpressions', 'totalClicks', 'totalQrScans', 'totalSignups', 'uniqueEvents', 'uniqueSponsors'],
          properties: {
            totalImpressions: { type: 'integer', minimum: 0 },
            totalClicks: { type: 'integer', minimum: 0 },
            totalQrScans: { type: 'integer', minimum: 0 },
            totalSignups: { type: 'integer', minimum: 0 },
            uniqueEvents: { type: 'integer', minimum: 0 },
            uniqueSponsors: { type: 'integer', minimum: 0 }
          }
        },
        surfaces: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'label', 'impressions', 'clicks', 'qrScans'],
            properties: {
              id: { type: 'string', enum: ['poster', 'display', 'public', 'signup'] },
              label: { type: 'string' },
              impressions: { type: 'integer', minimum: 0 },
              clicks: { type: 'integer', minimum: 0 },
              qrScans: { type: 'integer', minimum: 0 },
              engagementRate: { type: ['number', 'null'] }
            }
          }
        },
        sponsors: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            required: ['id', 'name', 'impressions', 'clicks', 'ctr'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              impressions: { type: 'integer', minimum: 0 },
              clicks: { type: 'integer', minimum: 0 },
              ctr: { type: 'number', minimum: 0 }
            }
          }
        },
        events: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            required: ['id', 'name', 'impressions', 'clicks', 'ctr', 'signupsCount'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              impressions: { type: 'integer', minimum: 0 },
              clicks: { type: 'integer', minimum: 0 },
              ctr: { type: 'number', minimum: 0 },
              signupsCount: { type: 'integer', minimum: 0 }
            }
          }
        },
        topSponsors: {
          type: ['array', 'null'],
          maxItems: 3,
          items: {
            type: 'object',
            required: ['id', 'name', 'impressions', 'clicks', 'ctr'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              impressions: { type: 'integer', minimum: 0 },
              clicks: { type: 'integer', minimum: 0 },
              ctr: { type: 'number', minimum: 0 }
            }
          }
        }
      }
    },

    // api_getSharedAnalytics - SharedReport.html (organizer view)
    getSharedReport: {
      request: {
        type: 'object',
        required: ['brandId'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          eventId: { type: ['string', 'null'] },  // Optional: filter by event
          isSponsorView: { type: 'boolean' }      // Optional: sponsor-scoped mode
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          etag: { type: 'string' },
          value: { $ref: '#/analytics/_sharedAnalytics' }
        }
      }
    },

    // api_getSponsorAnalytics - SharedReport.html (sponsor view)
    getSponsorAnalytics: {
      request: {
        type: 'object',
        required: ['brandId', 'sponsorId'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          sponsorId: { type: 'string', minLength: 1 },
          eventId: { type: ['string', 'null'] }   // Optional: filter by event
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          etag: { type: 'string' },
          value: { $ref: '#/analytics/_sharedAnalytics' }
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // [V2-QUARANTINE] EXPORT REPORT - NOT MVP
    // ═══════════════════════════════════════════════════════════════════════════
    // api_exportSharedReport - V2 Export feature
    // BLOCKED: FEATURE_FLAGS.PORTFOLIO_V2 must be true to enable
    // UI: Button hidden (display:none) in SharedReport.html
    // Schema kept for V2 when export functionality is enabled.
    exportReport: {
      request: {
        type: 'object',
        required: ['brandId'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          eventId: { $ref: '#/common/id' },
          format: { type: 'string', enum: ['csv', 'json', 'pdf'] }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            properties: {
              data: { type: 'string' },
              filename: { type: 'string' },
              mimeType: { type: 'string' }
            }
          }
        }
      }
    },

    // api_getSponsorReportQr - SharedReport.html / Admin.html (sponsor QR code generation)
    getSponsorReportQr: {
      request: {
        type: 'object',
        required: ['sponsorId'],
        properties: {
          sponsorId: { type: 'string', minLength: 1 },
          brandId: { $ref: '#/common/brandId' },  // Optional: admin context
          adminKey: { type: 'string' }             // Optional: admin authentication
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: { $ref: '#/analytics/_sponsorReportQr' }
        }
      }
    },

    // Internal: SponsorReportQr response shape
    _sponsorReportQr: {
      type: 'object',
      required: ['url', 'qrB64', 'verified'],
      additionalProperties: false,
      properties: {
        url: {
          type: 'string',
          description: 'Sponsor report URL with sponsorId parameter'
        },
        qrB64: {
          type: 'string',
          description: 'Base64-encoded PNG QR code image (without data URI prefix)'
        },
        verified: {
          type: 'boolean',
          description: 'True if QR was generated for a verified deployment URL'
        }
      }
    },

    logEvents: {
      request: {
        type: 'object',
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              required: ['eventId', 'surface', 'metric'],
              properties: {
                ts: { type: 'number' },
                eventId: { type: 'string' },
                surface: { type: 'string', enum: ['public', 'poster', 'display', 'mobile'] },
                metric: { type: 'string', enum: ['impression', 'click', 'dwellSec'] },
                sponsorId: { type: 'string' },
                value: { type: 'number' },
                token: { type: 'string' },
                ua: { type: 'string' }
              }
            }
          }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['count'],
            properties: {
              count: { type: 'number' }
            }
          }
        }
      }
    },

    getReport: {
      request: {
        type: 'object',
        required: ['brandId', 'id', 'adminKey'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          id: { $ref: '#/common/id' },
          adminKey: { type: 'string' },
          dateFrom: { $ref: '#/common/isoDate' },
          dateTo: { $ref: '#/common/isoDate' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['totals', 'bySurface', 'bySponsor', 'byToken'],
            properties: {
              totals: { $ref: '#/schemas/analytics/metrics' },
              bySurface: { type: 'object' },
              bySponsor: { type: 'object' },
              byToken: { type: 'object' }
            }
          }
        }
      }
    },

    metrics: {
      type: 'object',
      required: ['impressions', 'clicks', 'dwellSec'],
      properties: {
        impressions: { type: 'number', minimum: 0 },
        clicks: { type: 'number', minimum: 0 },
        dwellSec: { type: 'number', minimum: 0 },
        ctr: { type: 'number', minimum: 0, maximum: 100 }
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // [MVP] SPONSOR SCHEMAS - MIRRORS: /schemas/sponsor.schema.json
  // ═══════════════════════════════════════════════════════════════════════════

  sponsors: {
    getAnalytics: {
      request: {
        type: 'object',
        required: ['sponsorId'],
        properties: {
          sponsorId: { type: 'string' },
          eventId: { $ref: '#/common/id' },
          dateFrom: { $ref: '#/common/isoDate' },
          dateTo: { $ref: '#/common/isoDate' },
          brandId: { $ref: '#/common/brandId' },
          adminKey: { type: 'string' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['sponsorId', 'totals', 'bySurface', 'byEvent', 'timeline'],
            properties: {
              sponsorId: { type: 'string' },
              totals: { $ref: '#/schemas/analytics/metrics' },
              bySurface: { type: 'object' },
              byEvent: { type: 'object' },
              timeline: { type: 'array' },
              insights: { type: 'array' }
            }
          }
        }
      }
    },

    getROI: {
      request: {
        type: 'object',
        required: ['sponsorId'],
        properties: {
          sponsorId: { type: 'string' },
          sponsorshipCost: { type: 'number', minimum: 0 },
          costPerClick: { type: 'number', minimum: 0 },
          conversionRate: { type: 'number', minimum: 0, maximum: 100 },
          avgTransactionValue: { type: 'number', minimum: 0 },
          dateFrom: { $ref: '#/common/isoDate' },
          dateTo: { $ref: '#/common/isoDate' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['sponsorId', 'period', 'metrics', 'financials', 'insights'],
            properties: {
              sponsorId: { type: 'string' },
              period: {
                type: 'object',
                properties: {
                  from: { $ref: '#/common/isoDate' },
                  to: { $ref: '#/common/isoDate' }
                }
              },
              metrics: { type: 'object' },
              financials: {
                type: 'object',
                required: ['totalCost', 'costPerClick', 'cpm', 'estimatedConversions', 'estimatedRevenue', 'roi'],
                properties: {
                  totalCost: { type: 'number' },
                  costPerClick: { type: 'number' },
                  cpm: { type: 'number' },
                  estimatedConversions: { type: 'number' },
                  estimatedRevenue: { type: 'number' },
                  roi: { type: 'number' }
                }
              },
              insights: { type: 'array' }
            }
          }
        }
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // [MVP] FORMCONFIG SCHEMA - MIRRORS: /schemas/form-config.schema.json (v1.0 frozen)
  // ═══════════════════════════════════════════════════════════════════════════
  // FormConfig shape used by Admin signup tile and Report UI:
  // {
  //   formId: string,          // Google Form ID
  //   signupUrl: string,       // Published form URL
  //   shortLink: string|null,  // Short URL (if generated)
  //   qrB64: string|null,      // QR code base64 PNG (if generated)
  //   totalResponses: number   // Response count from linked sheet
  // }

  forms: {
    // [MVP] FormConfig shape - used by Admin signup tile, Report UI
    formConfig: {
      type: 'object',
      required: ['formId', 'signupUrl', 'totalResponses'],
      properties: {
        formId: { type: 'string', description: 'Google Form ID' },
        signupUrl: { $ref: '#/common/url', description: 'Published form URL' },
        shortLink: { type: ['string', 'null'], description: 'Short URL (if generated)' },
        qrB64: { type: ['string', 'null'], description: 'QR code base64 PNG (if generated)' },
        totalResponses: { type: 'integer', minimum: 0, description: 'Response count' }
      }
    },

    listTemplates: {
      request: {
        type: 'object',
        properties: {}
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['templates'],
            properties: {
              templates: { type: 'array' }
            }
          }
        }
      }
    },

    createFromTemplate: {
      request: {
        type: 'object',
        required: ['templateType', 'brandId', 'adminKey'],
        properties: {
          templateType: { type: 'string' },
          eventName: { type: 'string' },
          eventId: { $ref: '#/common/id' },
          brandId: { $ref: '#/common/brandId' },
          adminKey: { type: 'string' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['formId', 'editUrl', 'publishedUrl', 'responseSheetUrl'],
            properties: {
              formId: { type: 'string' },
              editUrl: { $ref: '#/common/url' },
              publishedUrl: { $ref: '#/common/url' },
              responseSheetUrl: { $ref: '#/common/url' },
              templateType: { type: 'string' },
              eventId: { type: 'string' }
            }
          }
        }
      }
    },

    // api_generateFormShortlink - Admin.html
    generateShortlink: {
      request: {
        type: 'object',
        required: ['formUrl', 'brandId', 'adminKey'],
        properties: {
          formUrl: { $ref: '#/common/url' },
          eventId: { $ref: '#/common/id' },
          brandId: { $ref: '#/common/brandId' },
          adminKey: { type: 'string' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['shortUrl'],
            properties: {
              shortUrl: { $ref: '#/common/url' },
              originalUrl: { $ref: '#/common/url' },
              eventId: { type: 'string' }
            }
          }
        }
      }
    }
  },

  // === Webhook Schemas =====================================================

  webhooks: {
    register: {
      request: {
        type: 'object',
        required: ['brandId', 'eventType', 'url'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          eventType: {
            type: 'string',
            enum: [
              'event.created', 'event.updated', 'event.deleted',
              'analytics.report', 'analytics.threshold',
              'sponsor.performance', 'sponsor.ctr.low', 'sponsor.ctr.high',
              'form.submitted', 'registration.completed',
              'system.error', 'system.warning'
            ]
          },
          url: {
            type: 'string',
            pattern: '^https://.+',
            maxLength: 2048
          },
          secret: {
            type: 'string',
            minLength: 16,
            maxLength: 128
          },
          enabled: { type: 'boolean' },
          filters: { type: 'object' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['id', 'brandId', 'eventType', 'url', 'secret', 'enabled', 'createdAt'],
            properties: {
              id: { type: 'string' },
              brandId: { type: 'string' },
              eventType: { type: 'string' },
              url: { type: 'string' },
              secret: { type: 'string' },
              enabled: { type: 'boolean' },
              createdAt: { type: 'string' }
            }
          }
        }
      }
    },
    unregister: {
      request: {
        type: 'object',
        required: ['brandId', 'webhookId'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          webhookId: { type: 'string' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['id', 'deleted'],
            properties: {
              id: { type: 'string' },
              deleted: { type: 'boolean' }
            }
          }
        }
      }
    },
    list: {
      request: {
        type: 'object',
        required: ['brandId'],
        properties: {
          brandId: { $ref: '#/common/brandId' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['webhooks'],
            properties: {
              webhooks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    brandId: { type: 'string' },
                    eventType: { type: 'string' },
                    url: { type: 'string' },
                    enabled: { type: 'boolean' },
                    createdAt: { type: 'string' },
                    lastTriggered: { type: 'string' },
                    deliveryCount: { type: 'number' }
                  }
                }
              }
            }
          }
        }
      }
    },
    test: {
      request: {
        type: 'object',
        required: ['brandId', 'webhookId'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          webhookId: { type: 'string' }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['webhookId', 'url', 'success', 'statusCode', 'timestamp'],
            properties: {
              webhookId: { type: 'string' },
              url: { type: 'string' },
              success: { type: 'boolean' },
              statusCode: { type: 'number' },
              response: { type: 'string' },
              timestamp: { type: 'string' }
            }
          }
        }
      }
    },
    getDeliveries: {
      request: {
        type: 'object',
        required: ['brandId'],
        properties: {
          brandId: { $ref: '#/common/brandId' },
          webhookId: { type: 'string' },
          limit: { type: 'number', minimum: 1, maximum: 500 }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['deliveries', 'count'],
            properties: {
              deliveries: {
                type: 'array',
                items: {
                  type: 'object'
                }
              },
              count: { type: 'number' }
            }
          }
        }
      }
    }
  },

  // === i18n Schemas ========================================================

  i18n: {
    translate: {
      request: {
        type: 'object',
        required: ['key'],
        properties: {
          key: {
            type: 'string',
            minLength: 1,
            maxLength: 256
          },
          locale: {
            type: 'string',
            pattern: '^[a-z]{2}-[A-Z]{2}$'
          },
          params: {
            type: 'object'
          }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['key', 'locale', 'translation'],
            properties: {
              key: { type: 'string' },
              locale: { type: 'string' },
              translation: { type: 'string' }
            }
          }
        }
      }
    },
    getSupportedLocales: {
      request: {
        type: 'object',
        properties: {}
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['locales', 'default'],
            properties: {
              locales: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['code', 'name'],
                  properties: {
                    code: { type: 'string' },
                    name: { type: 'string' },
                    nativeName: { type: 'string' }
                  }
                }
              },
              default: { type: 'string' }
            }
          }
        }
      }
    },
    setUserLocale: {
      request: {
        type: 'object',
        required: ['locale'],
        properties: {
          locale: {
            type: 'string',
            pattern: '^[a-z]{2}-[A-Z]{2}$'
          }
        }
      },
      response: {
        type: 'object',
        required: ['ok', 'value'],
        properties: {
          ok: { type: 'boolean' },
          value: {
            type: 'object',
            required: ['locale'],
            properties: {
              locale: { type: 'string' }
            }
          }
        }
      }
    }
  },

  // === Error Schemas =======================================================

  error: {
    type: 'object',
    required: ['ok', 'code', 'message'],
    properties: {
      ok: { type: 'boolean', enum: [false] },
      code: {
        type: 'string',
        enum: ['BAD_INPUT', 'NOT_FOUND', 'RATE_LIMITED', 'INTERNAL', 'CONTRACT', 'UNAUTHORIZED']
      },
      message: { type: 'string' }
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SC_* CONSTANTS - Direct references to canonical schema shapes
// ═══════════════════════════════════════════════════════════════════════════════
// These constants provide easy access to the core schema shapes that MUST match
// the JSON Schema files in /schemas/. Use these for validation and contract checks.
//
// Mapping:
//   SC_EVENT          → /schemas/event.schema.json
//   SC_SPONSOR        → /schemas/sponsor.schema.json
//   SC_FORM_CONFIG    → /schemas/form-config.schema.json
//   SC_SHARED_ANALYTICS → /schemas/shared-analytics.schema.json
//   SC_SETTINGS       → /schemas/event.schema.json#/$defs/Settings
// ═══════════════════════════════════════════════════════════════════════════════

/** @const {Object} SC_EVENT - Event schema shape (mirrors /schemas/event.schema.json) */
const SC_EVENT = SCHEMAS.events._eventShape;

/** @const {Object} SC_SPONSOR - Sponsor schema shape (mirrors /schemas/sponsor.schema.json) */
const SC_SPONSOR = SCHEMAS.events._sponsor;

/** @const {Object} SC_FORM_CONFIG - FormConfig schema shape (mirrors /schemas/form-config.schema.json) */
const SC_FORM_CONFIG = SCHEMAS.forms.formConfig;

/** @const {Object} SC_SHARED_ANALYTICS - SharedAnalytics schema shape (mirrors /schemas/shared-analytics.schema.json) */
const SC_SHARED_ANALYTICS = SCHEMAS.analytics._sharedAnalytics;

/** @const {Object} SC_SETTINGS - Settings sub-schema (mirrors /schemas/event.schema.json#/$defs/Settings) */
const SC_SETTINGS = SCHEMAS.events._settings;

/**
 * Validate request against schema
 *
 * @param {string} endpoint - Endpoint name (e.g., 'events.list')
 * @param {object} data - Request data
 * @returns {object} Result envelope (Ok/Err)
 */
function ApiSchemas_validateRequest(endpoint, data) {
  const parts = endpoint.split('.');
  if (parts.length !== 2) {
    return Err(ERR.BAD_INPUT, 'Invalid endpoint format');
  }

  const [category, operation] = parts;
  const schema = SCHEMAS[category]?.[operation]?.request;

  if (!schema) {
    return Err(ERR.BAD_INPUT, `Unknown endpoint: ${endpoint}`);
  }

  try {
    schemaCheck(schema, data, `ApiSchemas_validateRequest:${endpoint}`);
    return Ok();
  } catch (e) {
    return Err(ERR.BAD_INPUT, e.message);
  }
}

/**
 * Validate response against schema
 *
 * @param {string} endpoint - Endpoint name (e.g., 'events.list')
 * @param {object} data - Response data
 * @returns {object} Result envelope (Ok/Err)
 */
function ApiSchemas_validateResponse(endpoint, data) {
  const parts = endpoint.split('.');
  if (parts.length !== 2) {
    return Err(ERR.CONTRACT, 'Invalid endpoint format');
  }

  const [category, operation] = parts;
  const schema = SCHEMAS[category]?.[operation]?.response;

  if (!schema) {
    return Err(ERR.CONTRACT, `Unknown endpoint: ${endpoint}`);
  }

  try {
    schemaCheck(schema, data, `ApiSchemas_validateResponse:${endpoint}`);
    return Ok();
  } catch (e) {
    return Err(ERR.CONTRACT, e.message);
  }
}

/**
 * Get schema for endpoint
 *
 * @param {string} endpoint - Endpoint name
 * @returns {object|null} Schema object or null
 */
function ApiSchemas_getSchema(endpoint) {
  const parts = endpoint.split('.');
  if (parts.length !== 2) return null;

  const [category, operation] = parts;
  return SCHEMAS[category]?.[operation] || null;
}

/**
 * Get all schemas (for documentation generation)
 *
 * @returns {object} All schemas
 */
function ApiSchemas_getAllSchemas() {
  return SCHEMAS;
}
