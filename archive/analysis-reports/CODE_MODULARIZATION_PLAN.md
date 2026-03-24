# 📦 Code.gs Modularization Plan

**Current State:** Monolithic ~2000+ line file
**Target State:** Modular architecture with focused, maintainable files
**Priority:** MEDIUM (improves maintainability, not critical for production)
**Estimated Effort:** 2-3 weeks

---

## Current Architecture

**File:** `Code.gs` (~2000+ lines)
- Contains all backend logic
- Mixes concerns: routing, auth, CRUD, analytics, forms, security
- Difficult to maintain and test individual components

---

## Proposed Module Structure

### 1. **Auth.gs** - Authentication & Authorization
**Lines to extract:** ~200-300 lines
**Functions:**
- `gate_()` - Main authentication gate
- `getAdminSecret_()` - Secret key management
- `authenticateRequest_()` - Multi-method authentication
- `generateJWT_()` - JWT token generation
- `verifyJWT_()` - JWT verification (includes timing-safe comparison)
- `generateJWTSignature_()` - HMAC signature generation
- `timingSafeCompare_()` - Constant-time string comparison

**Benefits:**
- Centralized authentication logic
- Easier to audit security
- Simplified testing

---

### 2. **Security.gs** - Security Utilities
**Lines to extract:** ~300-400 lines
**Functions:**
- `generateCSRFToken_()` - CSRF token generation
- `validateCSRFToken_()` - Atomic CSRF validation with LockService
- `isAllowedOrigin_()` - Origin validation with auth header checks
- `sanitizeInput_()` - Input sanitization
- `sanitizeLogs_()` - Log sanitization (redact secrets)
- `sanitizeError_()` - Error message sanitization
- `sanitizeUrl_()` - URL validation and sanitization
- `sanitizeForSpreadsheet_()` - Formula injection prevention
- `isValidId_()` - ID validation

**Benefits:**
- All security utilities in one place
- Easier to maintain security standards
- Simplified security audits

---

### 3. **Events.gs** - Event Management
**Lines to extract:** ~400-500 lines
**Functions:**
- `api_create()` - Create event (when scope=events)
- `api_update()` - Update event
- `api_delete()` - Delete event
- `api_list()` - List events with pagination
- `api_get()` - Get single event
- `_findEventById_()` - Helper to find event
- Event validation helpers
- Event data transformation helpers

**Benefits:**
- Focused event business logic
- Easier to add event-specific features
- Cleaner separation of concerns

---

### 4. **Sponsors.gs** - Sponsor Management
**Lines to extract:** ~300-400 lines
**Functions:**
- `api_create()` - Create sponsor (when scope=sponsors)
- `api_update()` - Update sponsor
- `api_delete()` - Delete sponsor
- `api_list()` - List sponsors
- `api_get()` - Get single sponsor
- Sponsor validation helpers
- Sponsor data transformation helpers

**Benefits:**
- Dedicated sponsor management
- Easier to extend sponsor features
- Clear API surface

---

### 5. **Analytics.gs** - Reporting & Analytics
**Lines to extract:** ~300-400 lines
**Functions:**
- `api_getReport()` - Event analytics (already has auth)
- `api_track()` - Track impressions/clicks
- `api_getSharedAnalytics()` - Shared analytics (from SharedReporting.gs)
- `_ensureAnalyticsSheet_()` - Analytics sheet management
- `_aggregateAnalytics_()` - Data aggregation helpers
- Report generation helpers

**Benefits:**
- Centralized analytics logic
- Easier to add new metrics
- Better performance optimization opportunities

---

### 6. **Forms.gs** - Form Templates & Submissions
**Lines to extract:** ~200-300 lines
**Functions:**
- `api_createFormFromTemplate()` - Create form from template
- `api_getFormTemplates()` - List available templates
- `api_submitForm()` - Handle form submissions
- `api_generateFormShortlink()` - Generate shortlinks
- Form validation helpers
- Template processing helpers

**Benefits:**
- Focused form handling
- Easier to add new form types
- Better test coverage for forms (currently undertested)

---

### 7. **Router.gs** - Request Routing
**Lines to extract:** ~200-300 lines
**Functions:**
- `doGet()` - HTTP GET handler
- `doPost()` - HTTP POST handler
- `handleRestApiGet_()` - GET request routing
- `handleRestApiPost_()` - POST request routing
- URL parsing helpers
- Brand resolution (`findBrandByHost_()`, `findBrand_()`)

**Benefits:**
- Clear entry points
- Easier to understand request flow
- Simplified middleware integration

---

### 8. **Utils.gs** - Shared Utilities
**Lines to extract:** ~100-200 lines
**Functions:**
- `Ok()` / `Err()` - Result type helpers
- `runSafe()` - Error handling wrapper
- `diag_()` - Diagnostic logging
- `UserFriendlyErr_()` - User-friendly error messages
- `jsonResponse_()` - JSON response helper
- `pageFile_()` - Page template mapping
- Date/time helpers
- String manipulation helpers

**Benefits:**
- Shared utilities available to all modules
- No duplication
- Easier to maintain common code

---

### 9. **Config.gs** - Configuration (Already Exists!)
**Status:** ✅ Already modularized
**Functions:**
- Brand configuration
- URL aliases
- Routing rules
- Environment settings

**No changes needed** - this is already well-structured.

---

### 10. **SharedReporting.gs** - Analytics Module (Already Exists!)
**Status:** ✅ Already modularized
**Functions:**
- Shared analytics between events and sponsors
- Report generation
- Export functionality

**Possible integration:** Could be merged with Analytics.gs for consistency.

---

## Migration Strategy

### Phase 1: Foundation (Week 1)
**Goal:** Extract core utilities and security

1. Create `Utils.gs`
   - Move result types, error handling, logging
   - Update all references in Code.gs

2. Create `Security.gs`
   - Move all security functions
   - Update all references in Code.gs

3. Create `Auth.gs`
   - Move authentication functions
   - Update all references in Code.gs

**Validation:** Run all tests, verify no regressions

---

### Phase 2: Business Logic (Week 2)
**Goal:** Separate domain entities

4. Create `Events.gs`
   - Move event CRUD operations
   - Update routing in Code.gs

5. Create `Sponsors.gs`
   - Move sponsor CRUD operations
   - Update routing in Code.gs

6. Create `Forms.gs`
   - Move form handling
   - Update routing in Code.gs

**Validation:** Run all tests, verify API contracts

---

### Phase 3: Finalization (Week 3)
**Goal:** Complete modularization

7. Create `Router.gs`
   - Move doGet/doPost handlers
   - Extract routing logic

8. Create `Analytics.gs`
   - Move analytics functions
   - Consider merging with SharedReporting.gs

9. Clean up `Code.gs`
   - Should be mostly empty now
   - Keep only global initialization if needed
   - Or rename to `Main.gs` as thin orchestration layer

**Validation:** Full test suite, E2E tests, load tests

---

## Testing Strategy

### During Migration
1. **No functionality changes** - pure refactoring only
2. **Run tests after each file extraction** - immediate feedback
3. **Maintain 100% test coverage** - no gaps introduced

### Test Updates Needed
- Update import paths (if using clasp modules)
- Update mock configurations for modular tests
- Add integration tests for cross-module interactions

---

## Benefits Summary

### Maintainability ⬆️
- Easier to find and modify code
- Faster onboarding for new developers
- Clear separation of concerns

### Testability ⬆️
- Smaller, focused test suites
- Easier to mock dependencies
- Better test isolation

### Security ⬆️
- Security code in dedicated modules (Auth.gs, Security.gs)
- Easier to audit and review
- Centralized security standards

### Scalability ⬆️
- New features can be added to appropriate modules
- Less risk of merge conflicts
- Parallel development possible

---

## Risks & Mitigations

### Risk 1: Apps Script Limitations
**Issue:** Apps Script may not support ES6 imports/exports
**Mitigation:** Use clasp with TypeScript, or keep all files in same project (Google Apps Script automatically loads all .gs files in alphabetical order)

### Risk 2: Testing Complexity
**Issue:** More files = more complex test setup
**Mitigation:** Use dependency injection patterns, maintain clear module boundaries

### Risk 3: Performance
**Issue:** Multiple file loads might impact cold start
**Mitigation:** Measure before/after, optimize if needed (Apps Script bundles all files anyway)

### Risk 4: Breaking Changes
**Issue:** Accidental API changes during refactoring
**Mitigation:** Contract tests (already have 102 tests), careful validation at each step

---

## Alternative: Gradual Refactoring

If full modularization is too risky:

### Step 1: Add Module Comments
Add clear section markers in Code.gs:
```javascript
// ============================================================================
// MODULE: Authentication & Authorization
// ============================================================================

// ============================================================================
// MODULE: Security Utilities
// ============================================================================
```

### Step 2: Extract New Features to New Modules
- Keep existing Code.gs as-is
- New features go into new dedicated modules
- Gradually migrate old code during feature updates

### Step 3: Opportunistic Refactoring
- When fixing bugs in Code.gs, move that function to appropriate module
- Over time, Code.gs shrinks naturally

---

## Recommendation

**For immediate production:** Skip modularization, ship security fixes
**For long-term health:** Execute modularization plan in Phases 1-3

**Timeline:**
- Security fixes: ✅ DONE (this PR)
- Modularization: 2-3 weeks (separate effort)
- Test coverage expansion: Ongoing

**Priority:**
1. **HIGH:** Security fixes (DONE ✅)
2. **MEDIUM:** Modularization (future improvement)
3. **LOW:** Edge case handling, additional tests

---

## Conclusion

Modularization is **recommended but not critical** for production launch. The current monolithic structure is functional and all critical security issues are fixed.

Modularization should be considered a **technical debt reduction** effort for **future maintainability**, not a blocking issue for production deployment.

**Next Steps:**
1. ✅ Ship security fixes (this PR)
2. Monitor production for 2-4 weeks
3. Plan modularization sprint
4. Execute in phases with full test coverage
