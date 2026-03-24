# Playwright Test Coverage Gap Analysis

**Date:** 2025-11-20
**Branch:** claude/restore-tests-brand-pattern-01SzNBEcXpwDGyo3temEyXaE

---

## Executive Summary

**Current Coverage:** 12% of functions have dedicated Playwright E2E tests
**Critical Gap:** 88% of functions lack E2E frontend testing
**Security Risk:** 14 security-critical functions untested

### Coverage Breakdown
- ✅ **Functions with Playwright Tests:** ~15 (12%)
- ❌ **Functions without Playwright Tests:** ~105 (88%)
- 🔴 **Critical Security Functions Untested:** 14
- ⚠️ **Business Logic Functions Untested:** 40+
- 📋 **Integration Functions Untested:** 20+

---

## 🔴 CRITICAL TEST GAPS (Priority 1 - Security)

### Security Functions - HIGH RISK

| Function | File | Status | Risk Level | Test Needed |
|----------|------|--------|------------|-------------|
| `SecurityMiddleware_generateJWT` | SecurityMiddleware.gs | ❌ NOT TESTED | CRITICAL | JWT generation E2E test |
| `SecurityMiddleware_verifyJWT` | SecurityMiddleware.gs | ❌ NOT TESTED | CRITICAL | JWT validation E2E test |
| `SecurityMiddleware_generateCSRFToken` | SecurityMiddleware.gs | ❌ NOT TESTED | CRITICAL | CSRF token generation test |
| `SecurityMiddleware_validateCSRFToken` | SecurityMiddleware.gs | ❌ NOT TESTED | CRITICAL | CSRF validation test |
| `SecurityMiddleware_sanitizeInput` | SecurityMiddleware.gs | ❌ NOT TESTED | HIGH | XSS/injection prevention test |
| `SecurityMiddleware_sanitizeSpreadsheetValue` | SecurityMiddleware.gs | ❌ NOT TESTED | HIGH | Formula injection test |
| `SecurityMiddleware_gate` | SecurityMiddleware.gs | ❌ NOT TESTED | HIGH | Rate limiting E2E test |
| `SecurityMiddleware_timingSafeCompare` | SecurityMiddleware.gs | ❌ NOT TESTED | MEDIUM | Timing attack prevention |
| `SecurityMiddleware_authenticateRequest` | SecurityMiddleware.gs | ❌ NOT TESTED | HIGH | Multi-method auth test |
| `SecurityMiddleware_validateOrigin` | SecurityMiddleware.gs | ❌ NOT TESTED | MEDIUM | CORS validation test |
| `SecurityMiddleware_sanitizeId` | SecurityMiddleware.gs | ❌ NOT TESTED | MEDIUM | ID sanitization test |
| `SecurityMiddleware_sanitizeMetaForLogging` | SecurityMiddleware.gs | ❌ NOT TESTED | LOW | Log sanitization test |
| `SecurityMiddleware_assertScopeAllowed` | SecurityMiddleware.gs | ❌ NOT TESTED | MEDIUM | Scope validation test |
| `api_generateToken` | Code.gs | ❌ NOT TESTED | HIGH | Token generation API test |

**Recommended Test File:** `tests/e2e/security/authentication-security.spec.js`

---

## ⚠️ HIGH PRIORITY TEST GAPS (Priority 2 - Analytics)

### Sponsor Analytics & ROI - HIGH BUSINESS VALUE

| Function | File | Status | Priority | Test Needed |
|----------|------|--------|----------|-------------|
| `api_getSponsorAnalytics` | Code.gs | ❌ NOT TESTED | HIGH | Sponsor analytics API test |
| `api_getSponsorROI` | Code.gs | ❌ NOT TESTED | HIGH | ROI calculation test |
| `SponsorService_calculateROI` | SponsorService.gs | ❌ NOT TESTED | HIGH | ROI calculation verification |
| `SponsorService_getAnalytics` | SponsorService.gs | ❌ NOT TESTED | HIGH | Analytics retrieval test |
| `SponsorService_aggregateMetrics` | SponsorService.gs | ❌ NOT TESTED | HIGH | Metrics aggregation test |
| `SponsorService_calculateEngagementScore` | SponsorService.gs | ❌ NOT TESTED | MEDIUM | Engagement scoring test |
| `SponsorService_generateInsights` | SponsorService.gs | ❌ NOT TESTED | MEDIUM | Insights generation test |
| `SponsorService_generateROIInsights` | SponsorService.gs | ❌ NOT TESTED | MEDIUM | ROI insights test |

**Recommended Test File:** `tests/e2e/analytics/sponsor-analytics.spec.js`

### Event Analytics - MEDIUM BUSINESS VALUE

| Function | File | Status | Priority | Test Needed |
|----------|------|--------|----------|-------------|
| `api_getReport` | Code.gs | ⚠️ PARTIAL | MEDIUM | Dedicated E2E test needed |
| `api_logEvents` | Code.gs | ⚠️ PARTIAL | MEDIUM | Analytics logging test |
| `AnalyticsService_logEvents` | AnalyticsService.gs | ❌ NOT TESTED | MEDIUM | Event logging test |
| `AnalyticsService_getEventReport` | AnalyticsService.gs | ❌ NOT TESTED | MEDIUM | Report generation test |
| `AnalyticsService_aggregateEventData` | AnalyticsService.gs | ❌ NOT TESTED | MEDIUM | Data aggregation test |
| `AnalyticsService_calculateEngagementRate` | AnalyticsService.gs | ❌ NOT TESTED | LOW | Engagement calculation test |
| `AnalyticsService_groupBySurface` | AnalyticsService.gs | ❌ NOT TESTED | LOW | Surface grouping test |
| `AnalyticsService_groupByEvent` | AnalyticsService.gs | ❌ NOT TESTED | LOW | Event grouping test |
| `AnalyticsService_groupBySponsor` | AnalyticsService.gs | ❌ NOT TESTED | LOW | Sponsor grouping test |
| `AnalyticsService_calculateDailyTrends` | AnalyticsService.gs | ❌ NOT TESTED | LOW | Trend calculation test |

**Recommended Test File:** `tests/e2e/analytics/event-analytics.spec.js`

### Portfolio Analytics - MEDIUM BUSINESS VALUE

| Function | File | Status | Priority | Test Needed |
|----------|------|--------|----------|-------------|
| `api_getPortfolioSponsorReport` | Code.gs | ❌ NOT TESTED | MEDIUM | Portfolio sponsor report test |
| `api_getPortfolioSummary` | Code.gs | ❌ NOT TESTED | MEDIUM | Portfolio summary test |
| `api_getPortfolioSponsors` | Code.gs | ❌ NOT TESTED | MEDIUM | Portfolio sponsors list test |
| `SponsorService_getPortfolioSponsors` | SponsorService.gs | ❌ NOT TESTED | MEDIUM | Portfolio data retrieval test |

**Recommended Test File:** `tests/e2e/analytics/portfolio-analytics.spec.js` (exists but incomplete)

### Shared Reporting - MEDIUM BUSINESS VALUE

| Function | File | Status | Priority | Test Needed |
|----------|------|--------|----------|-------------|
| `api_getSharedAnalytics` | SharedReporting.gs | ❌ NOT TESTED | MEDIUM | Shared analytics API test |
| `api_generateSharedReport` | SharedReporting.gs | ❌ NOT TESTED | MEDIUM | Report generation test |
| `api_exportSharedReport` | SharedReporting.gs | ❌ NOT TESTED | MEDIUM | Export functionality test |
| `AnalyticsService_getSharedAnalytics` | AnalyticsService.gs | ❌ NOT TESTED | MEDIUM | Shared analytics retrieval |
| `AnalyticsService_verifyEventOwnership` | AnalyticsService.gs | ❌ NOT TESTED | HIGH | Ownership verification test |

**Recommended Test File:** `tests/e2e/analytics/shared-reporting.spec.js`

---

## 📋 MEDIUM PRIORITY TEST GAPS (Priority 3 - Integrations)

### Webhook System - MEDIUM PRIORITY

| Function | File | Status | Priority | Test Needed |
|----------|------|--------|----------|-------------|
| `WebhookService_register` | WebhookService.gs | ❌ NOT TESTED | MEDIUM | Webhook registration test |
| `WebhookService_unregister` | WebhookService.gs | ❌ NOT TESTED | MEDIUM | Webhook deletion test |
| `WebhookService_list` | WebhookService.gs | ❌ NOT TESTED | LOW | List webhooks test |
| `WebhookService_deliver` | WebhookService.gs | ❌ NOT TESTED | HIGH | Webhook delivery test |
| `WebhookService_test` | WebhookService.gs | ❌ NOT TESTED | MEDIUM | Test webhook test |
| `WebhookService_getDeliveries` | WebhookService.gs | ❌ NOT TESTED | LOW | Delivery history test |
| `WebhookService_verifySignature` | WebhookService.gs | ❌ NOT TESTED | HIGH | HMAC signature verification |

**Recommended Test File:** `tests/e2e/integrations/webhooks.spec.js`

### Google Forms Integration - MEDIUM PRIORITY

| Function | File | Status | Priority | Test Needed |
|----------|------|--------|----------|-------------|
| `api_listFormTemplates` | Code.gs | ❌ NOT TESTED | MEDIUM | List templates API test |
| `api_createFormFromTemplate` | Code.gs | ❌ NOT TESTED | HIGH | Form creation test |
| `api_generateFormShortlink` | Code.gs | ❌ NOT TESTED | MEDIUM | Shortlink generation test |
| `FormService_listTemplates` | FormService.gs | ❌ NOT TESTED | LOW | Template listing test |
| `FormService_getTemplate` | FormService.gs | ❌ NOT TESTED | LOW | Template retrieval test |
| `FormService_createFromTemplate` | FormService.gs | ❌ NOT TESTED | HIGH | Form creation logic test |
| `FormService_addQuestionsToForm` | FormService.gs | ❌ NOT TESTED | MEDIUM | Question addition test |
| `FormService_generateShortlink` | FormService.gs | ❌ NOT TESTED | MEDIUM | Shortlink creation test |

**Recommended Test File:** `tests/e2e/integrations/forms.spec.js`

### Shortlinks System - LOW PRIORITY

| Function | File | Status | Priority | Test Needed |
|----------|------|--------|----------|-------------|
| `api_createShortlink` | Code.gs | ❌ NOT TESTED | MEDIUM | Shortlink creation API test |
| `handleRedirect_` | Code.gs | ❌ NOT TESTED | MEDIUM | Redirect handling test |

**Recommended Test File:** `tests/e2e/integrations/shortlinks.spec.js`

---

## 🔧 LOW PRIORITY TEST GAPS (Priority 4 - Templates & Utilities)

### Template System - LOW PRIORITY

| Function | File | Status | Priority | Test Needed |
|----------|------|--------|----------|-------------|
| `TemplateService_getTemplate` | TemplateService.gs | ❌ NOT TESTED | LOW | Template retrieval test |
| `TemplateService_listTemplates` | TemplateService.gs | ❌ NOT TESTED | LOW | Template listing test |
| `TemplateService_validateData` | TemplateService.gs | ❌ NOT TESTED | MEDIUM | Validation logic test |
| `TemplateService_migrateData` | TemplateService.gs | ❌ NOT TESTED | MEDIUM | Migration logic test |
| `TemplateService_renderForm` | TemplateService.gs | ❌ NOT TESTED | LOW | Form rendering test |
| `TemplateService_composeTemplate` | TemplateService.gs | ❌ NOT TESTED | LOW | Template composition test |

**Recommended Test File:** `tests/e2e/templates/template-validation.spec.js`

### i18n System - LOW PRIORITY

| Function | File | Status | Priority | Test Needed |
|----------|------|--------|----------|-------------|
| `i18n_detectLocale` | i18nService.gs | ❌ NOT TESTED | LOW | Locale detection test |
| `i18n_translate` | i18nService.gs | ❌ NOT TESTED | MEDIUM | Translation test |
| `i18n_formatDate` | i18nService.gs | ❌ NOT TESTED | LOW | Date formatting test |
| `i18n_formatNumber` | i18nService.gs | ❌ NOT TESTED | LOW | Number formatting test |
| `i18n_formatCurrency` | i18nService.gs | ❌ NOT TESTED | LOW | Currency formatting test |
| `i18n_setUserLocale` | i18nService.gs | ❌ NOT TESTED | LOW | Locale setting test |
| `i18n_getSupportedLocales` | i18nService.gs | ❌ NOT TESTED | LOW | Locale listing test |
| `api_translate` | Code.gs | ❌ NOT TESTED | MEDIUM | Translation API test |

**Recommended Test File:** `tests/e2e/i18n/translations.spec.js`

### System Utilities - LOW PRIORITY

| Function | File | Status | Priority | Test Needed |
|----------|------|--------|----------|-------------|
| `api_healthCheck` | Code.gs | ❌ NOT TESTED | LOW | Health check test |
| `api_setupCheck` | Code.gs | ❌ NOT TESTED | LOW | Setup validation test |
| `api_exportReport` | Code.gs | ❌ NOT TESTED | MEDIUM | Report export test |
| `api_getConfig` | Code.gs | ❌ NOT TESTED | LOW | Config retrieval test |
| `SponsorService_getSettings` | SponsorService.gs | ❌ NOT TESTED | LOW | Settings retrieval test |
| `SponsorService_validatePlacements` | SponsorService.gs | ❌ NOT TESTED | MEDIUM | Placement validation test |

---

## ✅ WELL-TESTED AREAS

### Functions with Good Playwright Coverage

| Function | File | Test Location | Status |
|----------|------|---------------|--------|
| `api_status` | Code.gs | tests/e2e/api/system-api.spec.js | ✅ TESTED |
| `api_list` | Code.gs | tests/e2e/api/events-crud-api.spec.js | ✅ TESTED |
| `api_get` | Code.gs | tests/e2e/api/events-crud-api.spec.js | ✅ TESTED |
| `api_create` | Code.gs | tests/e2e/api/events-crud-api.spec.js | ✅ TESTED |
| `api_updateEventData` | Code.gs | tests/e2e/api/events-crud-api.spec.js | ✅ TESTED |
| `api_runDiagnostics` | Code.gs | tests/e2e/api/system-api.spec.js | ✅ TESTED |
| `EventService_list` | EventService.gs | Via api_list | ✅ TESTED |
| `EventService_get` | EventService.gs | Via api_get | ✅ TESTED |
| `EventService_create` | EventService.gs | Via api_create | ✅ TESTED |
| `EventService_update` | EventService.gs | Via api_updateEventData | ✅ TESTED |
| Sponsor CRUD | SponsorService.gs | tests/e2e/api/sponsors-crud-api.spec.js | ✅ TESTED |
| `doGet` (pages) | Code.gs | tests/e2e/2-pages/*.spec.js | ✅ TESTED |

---

## 📋 RECOMMENDED TEST CREATION ROADMAP

### Phase 1: Security (2-3 days) - CRITICAL
**Priority:** IMMEDIATE
**Risk:** HIGH

Create these test files:
1. `tests/e2e/security/jwt-authentication.spec.js`
   - Test JWT token generation
   - Test JWT token validation
   - Test token expiration
   - Test token tampering detection

2. `tests/e2e/security/csrf-protection.spec.js`
   - Test CSRF token generation
   - Test CSRF token validation
   - Test token rejection on mismatch

3. `tests/e2e/security/input-sanitization.spec.js`
   - Test XSS prevention
   - Test SQL injection prevention
   - Test formula injection prevention
   - Test ID sanitization

4. `tests/e2e/security/rate-limiting.spec.js`
   - Test rate limit enforcement
   - Test rate limit bypass prevention
   - Test different rate limit tiers

**Estimated Effort:** 20-30 test cases

---

### Phase 2: Analytics & ROI (3-4 days) - HIGH PRIORITY
**Priority:** HIGH
**Business Value:** HIGH

Create these test files:
1. `tests/e2e/analytics/sponsor-analytics.spec.js`
   - Test sponsor analytics retrieval
   - Test ROI calculations
   - Test engagement scoring
   - Test insights generation

2. `tests/e2e/analytics/event-analytics.spec.js`
   - Test event analytics logging
   - Test report generation
   - Test data aggregation
   - Test trend calculations

3. `tests/e2e/analytics/shared-reporting.spec.js`
   - Test shared analytics API
   - Test ownership verification
   - Test report export

4. Enhance `tests/e2e/api/portfolio-analytics-api.spec.js`
   - Add portfolio sponsor tests
   - Add portfolio summary tests
   - Add multi-brand analytics tests

**Estimated Effort:** 40-50 test cases

---

### Phase 3: Integrations (2-3 days) - MEDIUM PRIORITY
**Priority:** MEDIUM
**Business Value:** MEDIUM

Create these test files:
1. `tests/e2e/integrations/webhooks.spec.js`
   - Test webhook registration
   - Test webhook delivery
   - Test signature verification
   - Test delivery history

2. `tests/e2e/integrations/forms.spec.js`
   - Test form template listing
   - Test form creation from template
   - Test shortlink generation
   - Test form-event linking

3. `tests/e2e/integrations/shortlinks.spec.js`
   - Test shortlink creation
   - Test redirect handling
   - Test shortlink analytics

**Estimated Effort:** 25-30 test cases

---

### Phase 4: Templates & i18n (1-2 days) - LOW PRIORITY
**Priority:** LOW
**Business Value:** LOW

Create these test files:
1. `tests/e2e/templates/template-validation.spec.js`
   - Test template retrieval
   - Test data validation
   - Test migration logic

2. `tests/e2e/i18n/translations.spec.js`
   - Test locale detection
   - Test translation API
   - Test date/number/currency formatting

**Estimated Effort:** 15-20 test cases

---

## 📊 TOTAL EFFORT ESTIMATE

- **Phase 1 (Security):** 20-30 tests, 2-3 days
- **Phase 2 (Analytics):** 40-50 tests, 3-4 days
- **Phase 3 (Integrations):** 25-30 tests, 2-3 days
- **Phase 4 (Templates/i18n):** 15-20 tests, 1-2 days

**Total:** ~100-130 additional Playwright tests, 8-12 days of effort

---

## 🎯 SUCCESS METRICS

**Current State:**
- Functions with E2E tests: ~15 (12%)
- Critical security functions tested: 0/14 (0%)
- Analytics functions tested: ~2/30 (7%)

**Target After Phase 1:**
- Functions with E2E tests: ~35 (29%)
- Critical security functions tested: 14/14 (100%)

**Target After Phase 2:**
- Functions with E2E tests: ~75 (62%)
- Analytics functions tested: 30/30 (100%)

**Target After All Phases:**
- Functions with E2E tests: ~115 (96%)
- Overall Playwright coverage: >95%

---

## 🚀 NEXT STEPS

1. **Review and Prioritize** - Review this gap analysis with team
2. **Security First** - Start with Phase 1 (security tests)
3. **Incremental Approach** - Add tests in phases, not all at once
4. **CI/CD Integration** - Add new tests to CI/CD pipeline
5. **Documentation** - Update test documentation as tests are added
6. **Coverage Tracking** - Track progress against this document

---

## 📝 NOTES

- All untested functions represent potential bugs or regressions
- Security gaps pose the highest risk
- Analytics gaps affect business intelligence and reporting
- Integration gaps affect external system reliability
- Template/i18n gaps are lower priority but affect user experience

**Recommendation:** Allocate 2 sprints (4 weeks) to address Phases 1-3, achieving 80%+ function coverage.
