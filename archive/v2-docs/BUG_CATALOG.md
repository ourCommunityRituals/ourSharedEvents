# Bug Catalog - MVP-EVENT-TOOLKIT

**Generated:** 2025-11-15
**Analysis Method:** Multi-Agent Automated Analysis (Security, Code Quality, API Contract, Data Integrity)

## Executive Summary

**Total Bugs Found:** 57 unique bugs across 4 categories
- **Critical:** 13 bugs (Immediate fix required)
- **High:** 17 bugs (Fix within 24-48 hours)
- **Medium:** 15 bugs (Fix within 1 week)
- **Low:** 12 bugs (Fix as time permits)

---

## CRITICAL PRIORITY (Fix Immediately)

### Security - Critical

1. **Open Redirect Vulnerability** - Code.gs:395
   - Allows phishing attacks via malicious shortlinks
   - Fix: Add URL whitelist validation

2. **Insecure JWT Implementation** - Code.gs:446-526
   - Missing algorithm verification allows token forgery
   - Fix: Replace with Google OAuth2 or proper JWT library

3. **XSS via Video URL Injection** - Public.html:376-391
   - User-controlled video URLs not validated
   - Fix: Add strict regex validation for video IDs

4. **Missing CSRF Protection** - Code.gs:181-191
   - All POST endpoints lack CSRF tokens
   - Fix: Implement CSRF token validation

### API Contract - Critical

5. **api_getReport Parameter Mismatch** - Code.gs:272-279, 834
   - Expects `req.id` but receives `req.eventId`
   - 100% failure rate on analytics reports
   - Fix: Standardize parameter name

6. **api_getReport Missing Authentication** - Code.gs:832-880
   - No gate_() check allows unauthenticated access to analytics
   - Security breach - anyone can view analytics
   - Fix: Add gate_() authentication check

7. **api_list ETag Parameter Mismatch** - Code.gs:197, 210, 689
   - Expects `ifNoneMatch` but receives `etag`
   - Caching completely broken
   - Fix: Standardize parameter name

### Code Quality - Critical

8. **Off-by-One Error in Diagnostic Cleanup** - Code.gs:90
   - Incorrect deleteRows calculation causes data loss
   - Fix: Use correct row deletion logic

9. **Off-by-One Error in Daily Cleanup** - Code.gs:100
   - Wrong row deletion in daily cleanup
   - Fix: Calculate rowsToDelete correctly

10. **Array Access Without Bounds Check** - SharedReporting.gs:418
    - Accessing `metrics.bySponsor[0]` without checking if array is empty
    - Causes runtime crash
    - Fix: Add array length check

### Data Integrity - Critical

11. **Multi-brand Data Leakage** - Config.gs:21, 30, 39, 48
    - All brands share same spreadsheet
    - Brand isolation only via in-memory filtering
    - Fix: Separate databases per brand

12. **Race Condition in Slug Generation** - Code.gs:759-766
    - Read-then-write without locking
    - Can create duplicate slugs
    - Fix: Add LockService

13. **Race Condition in Update Operations** - Code.gs:792-800
    - Read-modify-write without locking
    - Lost updates possible
    - Fix: Add LockService

---

## HIGH PRIORITY (Fix Within 24-48 Hours)

### Security - High

14. **Weak Input Sanitization** - Code.gs:563-569
    - Only removes 5 characters, no context-aware escaping
    - Fix: Comprehensive HTML entity encoding

15. **Admin Key Stored in sessionStorage** - Admin.html:827-828, etc.
    - Vulnerable to XSS attacks
    - Fix: Use HTTP-only cookies or server-side sessions

16. **No CORS Restrictions** - Code.gs:320-328
    - Any website can make API requests
    - Fix: Implement origin whitelist

17. **Information Disclosure in Diagnostics** - Code.gs:64-106
    - Logs contain sensitive tokens and keys
    - Fix: Sanitize metadata before logging

18. **Rate Limiting Bypass** - Code.gs:529-545
    - Only tracks by brandId, not IP
    - Fix: Add IP-based tracking and progressive backoff

19. **SQL Injection Risk** - Code.gs:700, 757, 793
    - IDs used in filters without validation
    - Fix: Add ID format validation

### API Contract - High

20. **api_get ETag Parameter Mismatch** - Code.gs:197, 215, 716
    - Same issue as api_list ETag
    - Fix: Standardize parameter name

21. **api_getConfig Missing ETag Support** - Code.gs:206, 672
    - Handler doesn't pass etag parameter
    - Fix: Pass etag to api_getConfig

### Code Quality - High

22. **JSON.parse Without Try-Catch in doPost** - Code.gs:182-190
    - Broad catch masks other errors
    - Fix: Separate try-catch blocks

23. **getRange With Invalid Parameters** - Code.gs:97
    - Calling getRange(2, 1, 0, 1) when only header exists
    - Fix: Check lastRow > 1 before getRange

24. **UUID split() Without Validation** - Code.gs:937
    - Assumes UUID format has hyphens
    - Fix: Validate UUID format

25. **Base64 Decode Without Error Handling** - Code.gs:447-480
    - Malformed base64 can crash verification
    - Fix: Separate try-catch for base64 decode

26. **Missing Error Handling in _ensureOk_** - Code.gs:43-51
    - Validates error responses against success schema
    - Fix: Check obj.ok === false first

### Data Integrity - High

27. **Missing Schema Validation in Updates** - Code.gs:797-798
    - Arbitrary fields can be injected
    - Fix: Validate against template schema

28. **Unsafe JSON.parse** - Code.gs:183, 686, 706, 797
    - Multiple JSON.parse calls without error handling
    - Fix: Create safeJSONParse_() helper

29. **Missing Data Sanitization in Analytics** - Code.gs:815-823
    - Analytics data not sanitized for spreadsheet
    - Formula injection risk
    - Fix: Sanitize all values for spreadsheet

30. **No Brand Isolation in Analytics Queries** - SharedReporting.gs:41-76
    - Loads ALL analytics before filtering
    - Cross-brand data exposure risk
    - Fix: Filter at query level

---

## MEDIUM PRIORITY (Fix Within 1 Week)

### Security - Medium

31. **Missing Security Headers** - Code.gs (multiple)
    - No CSP, X-Content-Type-Options, etc.
    - Fix: Set security headers where Apps Script allows

32. **Inadequate URL Validation** - Code.gs:554-561
    - Doesn't check for javascript:, data:, localhost
    - Fix: Add comprehensive URL validation

33. **Slug Collision Race Condition** - Code.gs:757-767
    - Duplicate slug possible in concurrent requests
    - Fix: Use UUID-based slugs

34. **Insecure Random Token Generation** - Code.gs:937
    - Only 8-character tokens are guessable
    - Fix: Use full UUID or crypto-secure random

35. **Template Injection Risk** - Code.gs:169-177
    - Template variables from user data not escaped
    - Fix: Sanitize all template variables

### API Contract - Medium

36. **Extra Links in Create/Get Responses** - Code.gs:771-776, 709-713
    - Returns undocumented `reportUrl` field
    - Fix: Update contract tests or remove field

37. **Template Field Requirements Mismatch** - Config.gs:63
    - Contract expects required location, but it's optional
    - Fix: Align contract with implementation

### Code Quality - Medium

38. **Race Condition in Idempotency Cache** - Code.gs:738-741
    - Check-then-set race condition
    - Fix: Use LockService

39. **Inconsistent Null Checks** - Code.gs:849
    - Uses || operator treating 0 and "" as falsy
    - Fix: Explicit null/undefined checks

40. **Missing Validation in sanitizeInput_** - Code.gs:563-569
    - Doesn't handle backticks, event handlers
    - Fix: More comprehensive sanitization

41. **Potential Memory Leak in Analytics** - SharedReporting.gs:134-152
    - Uses Set objects that can grow very large
    - Fix: Add limits or pagination

42. **Logic Error in Daily Cleanup** - Code.gs:94-102
    - Non-deterministic random cleanup trigger
    - Fix: Use counter instead of random

### Data Integrity - Medium

43. **Default to Root Brand on Mismatch** - Config.gs:153
    - Unknown hostname gets root brand data
    - Fix: Return null or error for unknown hosts

44. **No Atomic Batch Operations** - Code.gs:825, 939-946
    - Multiple writes not transactional
    - Fix: Use batch operations

45. **Missing Input Length Validation** - Code.gs:563-569, 745-751
    - URLs not length-validated
    - Fix: Add max length validation

46. **No Data Type Validation** - Code.gs:686, 706, 797
    - Parsed JSON not validated against schema
    - Fix: Validate data structure

47. **Missing Error Handling in Cleanup** - Code.gs:88-101
    - Cleanup can fail silently
    - Fix: Add try-catch around deleteRows

---

## LOW PRIORITY (Fix As Time Permits)

### Security - Low

48. **Verbose Error Messages** - Code.gs (multiple Err() calls)
    - Error messages reveal system internals
    - Fix: Generic user messages, log details internally

49. **Insufficient Idempotency Key Validation** - Code.gs:738-742
    - 10 minute expiry too short, no format validation
    - Fix: Extend expiry, validate format

### Code Quality - Low

50. **Inefficient Array Operations** - Code.gs:684-686
    - Loads all rows before filtering
    - Fix: Add pagination or query-level filtering

51. **Missing Input Validation in api_createShortlink** - Code.gs:927-954
    - Doesn't validate targetUrl format
    - Fix: Call isUrl() on targetUrl

### Data Integrity - Low

52. **XSS in Shortlink Redirect** - Code.gs:394-397
    - targetUrl embedded without validation
    - Fix: Validate URL before embedding

53. **Missing Brand Validation in Shortlinks** - Code.gs:367-372
    - No brand check on shortlink access
    - Fix: Add brandId to shortlinks schema

54. **Weak JWT - No Replay Protection** - Code.gs:446-481
    - No jti, nbf validation, timing attack vulnerability
    - Fix: Add JWT ID, not-before, timing-safe comparison

---

## Additional Issues

### Documentation/Process

55. **Missing TypeScript/JSDoc** - All files
    - No type definitions
    - Would catch parameter mismatches at dev time

56. **No Schema Validation Framework** - All files
    - Runtime schema validation would prevent many bugs
    - Recommend: JSON Schema or Zod

57. **Limited Test Coverage** - Tests directory
    - Many functions lack unit tests
    - Missing integration tests for concurrent operations

---

## Recommended Fix Order

### Phase 1: Immediate (Today)
1. Fix API contract parameter mismatches (#5, #6, #7, #20, #21)
2. Add authentication to api_getReport (#6)
3. Fix off-by-one errors (#8, #9)
4. Add bounds checks (#10)

### Phase 2: Security Hardening (This Week)
5. Implement CSRF protection (#4)
6. Fix XSS vulnerabilities (#3, #35, #52)
7. Add JWT security (#2, #54)
8. Fix open redirect (#1)
9. Implement input sanitization (#14, #29, #40)

### Phase 3: Data Integrity (This Week)
10. Add LockService for race conditions (#12, #13, #33, #38)
11. Separate brand databases (#11)
12. Add schema validation (#27, #46)
13. Fix JSON parsing (#28)
14. Add brand isolation in analytics (#30)

### Phase 4: Remaining Issues (Next 2 Weeks)
15. Fix remaining high priority bugs
16. Fix medium priority bugs
17. Fix low priority bugs
18. Add comprehensive tests

---

## Testing Strategy

After each fix:
1. Run relevant unit tests
2. Run contract tests
3. Add new tests for the bug
4. Verify fix doesn't introduce regressions
