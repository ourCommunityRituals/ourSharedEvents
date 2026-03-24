# Code Review Report - MVP Event Toolkit

**Review Date:** 2025-11-08
**Build:** mvp-v1.0-events-only
**Reviewer:** Claude Code

## Executive Summary

This Google Apps Script-based event management system is functional but has several critical security, performance, and maintainability issues that should be addressed before production use.

**Overall Grade: C+**

---

## Critical Issues (Must Fix)

### 1. Security Vulnerabilities

#### 1.1 Hardcoded Admin Secrets
**Location:** Config.gs:16, 26, 34
**Severity:** CRITICAL
**Issue:** Admin secrets are set to 'CHANGE_ME_*' placeholders.

```javascript
adminSecret: 'CHANGE_ME_root',  // ❌ CRITICAL
```

**Recommendation:**
- Generate strong, unique secrets for each brand
- Use environment variables or Script Properties for sensitive data
- Implement secret rotation mechanism

#### 1.2 Insecure Credential Storage
**Location:** Admin.html:62
**Severity:** HIGH
**Issue:** Admin keys stored in localStorage without encryption.

```javascript
localStorage.setItem('ADMIN_KEY:'+brandId, k);  // ❌ Plaintext storage
```

**Recommendation:**
- Use sessionStorage instead of localStorage
- Implement token-based authentication with expiration
- Consider OAuth2 for admin access

#### 1.3 Missing Server-Side Input Sanitization
**Location:** Code.gs:143-180
**Severity:** HIGH
**Issue:** Server relies on client-side escaping only; vulnerable to XSS if client bypassed.

**Recommendation:**
- Sanitize all user inputs on the server before storage
- Implement Content Security Policy headers
- Validate and sanitize URLs server-side

#### 1.4 Weak URL Validation
**Location:** Code.gs:80
**Severity:** MEDIUM
**Issue:** Basic URL validation doesn't check for javascript:, data:, or other dangerous protocols.

```javascript
function isUrl(s){ try{ new URL(String(s)); return true; }catch(_){ return false; } }
```

**Recommendation:**
```javascript
function isUrl(s) {
  try {
    const url = new URL(String(s));
    return ['http:', 'https:'].includes(url.protocol);
  } catch(_) {
    return false;
  }
}
```

#### 1.5 Missing CSRF Protection
**Location:** All API endpoints
**Severity:** MEDIUM
**Issue:** No CSRF tokens for state-changing operations.

**Recommendation:**
- Implement CSRF token validation for POST/PUT/DELETE operations
- Use SameSite cookie attributes

---

## High Priority Issues

### 2. Code Quality

#### 2.1 Redundant SpreadsheetApp Calls
**Location:** Code.gs:15
**Issue:**
```javascript
const ss=SpreadsheetApp.openById(SpreadsheetApp.getActive().getId());
```

**Fix:**
```javascript
const ss = SpreadsheetApp.getActive();
```

#### 2.2 Silent Error Swallowing
**Location:** Code.gs:25
**Issue:** Empty catch block in diag_ function prevents debugging.

```javascript
}catch(_){}  // ❌ Errors disappear silently
```

**Recommendation:**
- Log errors to console at minimum
- Implement fallback logging mechanism

#### 2.3 Missing Error Reference
**Location:** Header.html:9
**Issue:** Uses `BUILD_ID` instead of `ZEB.BUILD_ID`

```html
<small id="build">BUILD: <?= BUILD_ID ?></small>  <!-- ❌ Undefined -->
```

**Fix:**
```html
<small id="build">BUILD: <?= ZEB.BUILD_ID ?></small>
```

#### 2.4 Duplicate CSS Rules
**Location:** Styles.html:411-459
**Issue:** CSS rules repeated (form-row media query, focus-visible, etc.)

**Recommendation:** Remove duplicate rules starting at line 411.

#### 2.5 DRY Violation - Duplicate esc() Function
**Location:** Public.html:51, Poster.html:34
**Issue:** Same HTML escaping function duplicated across files.

**Recommendation:**
- Move to NUSDK.html as shared utility
- Add to window.NU namespace

---

## Medium Priority Issues

### 3. Performance

#### 3.1 Inefficient Data Filtering
**Location:** Code.gs:115-117
**Issue:** Loads all rows into memory before filtering.

```javascript
const rows = sh.getRange(2,1,Math.max(0, sh.getLastRow()-1),6).getValues()
  .filter(r => r[1]===brandId)  // ❌ Filter after loading all data
```

**Recommendation:**
- Use Sheet.createTextFinder() for targeted queries
- Implement proper indexing strategy
- Consider migrating to Firebase/Cloud Firestore for better query performance

#### 3.2 Expensive Daily Cleanup
**Location:** Code.gs:22-24
**Issue:** Log cleanup runs on every write operation.

**Recommendation:**
- Run cleanup as scheduled trigger (daily)
- Implement lazy cleanup (only when threshold reached)
- Use time-based triggers instead of inline execution

---

## Bugs

### 4.1 Incorrect QR Code URL
**Location:** Poster.html:24
**Severity:** MEDIUM
**Issue:** QR code should point to public page, not poster page.

```javascript
const url = evt?.links?.posterUrl;  // ❌ Wrong URL
```

**Fix:**
```javascript
const url = evt?.links?.publicUrl;  // ✅ Correct
```

### 4.2 No Slug Collision Handling
**Location:** Code.gs:169
**Issue:** Slug generation doesn't check for duplicates.

**Recommendation:**
- Check for existing slugs before insert
- Append counter for duplicates (event-name, event-name-2, etc.)

### 4.3 Weak Idempotency Key Fallback
**Location:** Admin.html:44
**Issue:** Date.now() doesn't guarantee uniqueness.

```javascript
idemKey: (crypto.randomUUID?.() || String(Date.now())),  // ❌ Collision risk
```

**Recommendation:**
```javascript
idemKey: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36)}`,
```

---

## Low Priority / Enhancements

### 5. Missing Features

1. **No loading states** in Public.html
2. **No form validation feedback** - errors only shown via alert()
3. **No retry logic** for failed API calls
4. **No pagination** for large event lists
5. **No search/filter functionality**
6. **No data export** capability
7. **No audit trail** for admin actions

### 6. Maintainability

1. **Magic numbers** scattered throughout:
   - DIAG_MAX=3000
   - DIAG_PER_DAY=800
   - RATE_MAX_PER_MIN=10

   **Recommendation:** Move to Config.gs as constants.

2. **Mixed concerns** in Code.gs:
   - Routing, business logic, and data access all in one file

   **Recommendation:** Separate into modules (Router.gs, Services.gs, Data.gs)

3. **No JSDoc comments** for public APIs

4. **No unit tests**

---

## Testing Recommendations

1. **Security Testing:**
   - Test XSS injection in all input fields
   - Test SQL-like injection in data fields
   - Test CSRF attacks
   - Test rate limiting bypass

2. **Functional Testing:**
   - Test concurrent creates with same idemKey
   - Test slug collision scenarios
   - Test rate limit enforcement
   - Test SWR cache behavior

3. **Performance Testing:**
   - Test with 1000+ events
   - Test log rotation under load
   - Measure cold start vs warm cache performance

---

## Positive Aspects ✅

1. **Clean API envelope pattern** with Ok/Err responses
2. **Good SWR implementation** with etag support
3. **Rate limiting** implemented
4. **Idempotency** support for creates
5. **Multi-brand architecture** ready for scaling
6. **Responsive design** with mobile support
7. **Accessibility features** (focus-visible, reduced-motion)

---

## Action Items (Prioritized)

### Immediate (Before Production):
1. ✅ Change all admin secrets to strong, unique values
2. ✅ Fix URL validation to whitelist http/https only
3. ✅ Add server-side input sanitization
4. ✅ Fix posterUrl bug in QR code generation
5. ✅ Remove duplicate CSS rules

### Short Term (Next Sprint):
1. ✅ Implement token-based admin auth
2. ✅ Optimize data filtering queries
3. ✅ Move log cleanup to scheduled trigger
4. ✅ Add slug collision handling
5. ✅ Refactor duplicate code (esc function)
6. ✅ Add JSDoc comments

### Medium Term (Next Month):
1. Add comprehensive error handling
2. Implement pagination
3. Add search/filter functionality
4. Create admin audit trail
5. Write unit tests

### Long Term (Roadmap):
1. Migrate to Cloud Firestore for better querying
2. Implement OAuth2 for admin access
3. Add webhook support
4. Create API versioning strategy
5. Build CI/CD pipeline

---

## Conclusion

The codebase demonstrates good architectural patterns (multi-brand, API envelopes, SWR caching) but requires security hardening and performance optimization before production deployment. The critical issues are addressable with focused refactoring work.

**Estimated effort to production-ready:** 3-5 days of focused development.
