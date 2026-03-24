# Environment Parity Report

**Story 1.4 (PO)**: Configuration Parity and Environment Alignment
**Generated**: 2025-12-10
**Status**: PARITY VERIFIED

---

## Executive Summary

Staging environment (`stg.eventangle.com`) has been verified as an acceptable UAT proxy for production (`www.eventangle.com`). All critical user journeys function identically, with only intentional environment-specific differences in testing features and debug settings.

---

## Configuration Source of Truth

All environment configuration is now centralized in:

| File | Purpose |
|------|---------|
| `deploy-manifest.json` | **Primary source** - URLs, deployment IDs, feature flags |
| `config/environments.js` | Node.js environment configuration (imports from manifest) |
| `config/feature-flags.js` | Feature flag access with staging/production defaults |
| `cloudflare-proxy/wrangler.toml` | Cloudflare Worker environment configuration |
| `.clasp-*.json` | Apps Script project configurations |

---

## Parity Checklist

### Must Match (Parity Required)

| Configuration | Staging | Production | Status |
|--------------|---------|------------|--------|
| Cloudflare Zone | eventangle.com | eventangle.com | MATCH |
| MVP Features: EVENTS | true | true | MATCH |
| MVP Features: SPONSORS | true | true | MATCH |
| MVP Features: ANALYTICS | true | true | MATCH |
| MVP Features: FORMS | true | true | MATCH |
| MVP Features: SHORTLINKS | true | true | MATCH |
| MVP Features: PORTFOLIO_ANALYTICS | true | true | MATCH |
| V2 Features: TEMPLATE_MANAGEMENT_V2 | false | false | MATCH |
| V2 Features: PORTFOLIO_V2 | false | false | MATCH |
| Valid Brands | root, abc, cbc, cbl | root, abc, cbc, cbl | MATCH |
| Default Brand | root | root | MATCH |
| API Schema Version | Same | Same | MATCH |

### Allowed Differences (By Design)

| Configuration | Staging | Production | Reason |
|--------------|---------|------------|--------|
| Base URL | https://stg.eventangle.com | https://www.eventangle.com | Different domains |
| API URL | https://api-stg.eventangle.com | https://api.eventangle.com | Different domains |
| Worker Name | eventangle-staging | eventangle-prod | Different workers |
| Worker Routes | stg.eventangle.com/* | eventangle.com/*, www.eventangle.com/* | Different domains |
| Script ID | 1gHiPuj7e... | 1YO4apLOQ... | Separate GAS projects |
| Deployment ID | AKfycbwFne... | AKfycbz-RV... | Separate deployments |
| Debug Level | debug | error | More logging in staging |
| Debug Endpoints | true | false | Security (disabled in prod) |
| DEMO_MODE_ENABLED | true | false | Testing in staging only |
| DEBUG_PANEL | true | false | Testing in staging only |
| API_TIMING_LOGS | true | false | Testing in staging only |
| ERROR_DETAILS | true | false | Security (hide in prod) |
| SAMPLE_DATA_PREFILL | true | false | Testing in staging only |
| FEATURE_HIGHLIGHTING | true | false | Testing in staging only |
| CONSOLE_LOGGING | true | false | Performance (off in prod) |
| Experimental Features | true | false | Validation before production |

---

## Feature Flags Strategy

### Categories

1. **MVP Features** (Always ON in both)
   - Core application functionality
   - Must maintain parity between staging and production
   - Changes require full release cycle

2. **Testing Features** (ON in staging, OFF in production)
   - Development and QA tools
   - Demo mode, debug panels, timing logs
   - Safe to enable in staging for UAT

3. **V2 Features** (OFF in both)
   - Deferred features not yet ready for any environment
   - Explicit approval required before enabling

4. **Experimental Features** (ON in staging, OFF in production)
   - Features being validated before production release
   - Enable in staging for testing, disable in production for safety

### Configuration Priority

```
1. Environment Variables (FEATURE_FLAG_<NAME>=true|false)
2. deploy-manifest.json (featureFlags section)
3. config/feature-flags.js (DEFAULT_FLAGS)
```

---

## Critical User Journeys

All critical user journeys verified to work identically in staging and production:

| Journey | Staging Verified | Production Equivalent |
|---------|-----------------|----------------------|
| View Public Events | `stg.eventangle.com/events` | `www.eventangle.com/events` |
| Admin Login | `stg.eventangle.com/manage` | `www.eventangle.com/manage` |
| Create Event | Admin CRUD operations | Same API endpoints |
| Sponsor Management | Sponsor CRUD operations | Same API endpoints |
| Display Mode | `stg.eventangle.com/display` | `www.eventangle.com/display` |
| Status Check | `stg.eventangle.com/status` | `www.eventangle.com/status` |
| Multi-brand Routing | `stg.eventangle.com/abc/events` | `www.eventangle.com/abc/events` |
| Analytics/Reports | Report pages | Same functionality |

---

## Security Considerations

### Disabled in Production

- **Debug Endpoints**: `/__debug/*` routes are disabled
- **Error Details**: Internal error messages hidden from users
- **Console Logging**: Reduced to minimize information leakage
- **Demo Mode**: Sample data prefill disabled

### Same in Both Environments

- **Authentication**: Same admin key validation
- **CORS**: Same origin policies
- **Input Validation**: Same schema validation
- **Rate Limiting**: Same Cloudflare protection

---

## Verification Commands

```bash
# Run parity comparison
node scripts/compare-environments.js

# Run with strict mode (fails on issues)
node scripts/compare-environments.js --strict

# Generate JSON report for CI
node scripts/compare-environments.js --json

# View feature flags
node -e "require('./config/feature-flags').printFeatureFlagInfo()"
```

---

## Audit Trail

| Date | Action | Performed By |
|------|--------|-------------|
| 2025-12-10 | Initial parity audit | Story 1.4 Implementation |
| 2025-12-10 | Feature flags centralized in manifest | Story 1.4 Implementation |
| 2025-12-10 | Parity comparison script created | Story 1.4 Implementation |

---

## Sign-off

See `docs/PO_SIGNOFF_STAGING_PARITY.md` for Product Owner approval.
