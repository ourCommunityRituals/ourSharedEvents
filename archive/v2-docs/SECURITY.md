# Security Considerations

This document outlines security considerations, known limitations, and recommended best practices for the MVP-EVENT-TOOLKIT.

## Known Security Limitations

### 1. Admin Key Storage (Bug #15)

**Issue:** Admin keys are stored in `sessionStorage` in the browser (Admin.html, Display.html, etc.)

**Risk:** If an XSS vulnerability exists, an attacker could potentially read the admin key from sessionStorage.

**Why This Exists:**
- Google Apps Script web apps run entirely in the browser
- Apps Script doesn't support HTTP-only cookies for web app contexts
- The admin key must be passed with each API request for authentication
- Server-side sessions are not available in Apps Script's stateless architecture

**Mitigations in Place:**
1. ✅ Comprehensive XSS prevention (input sanitization, URL validation, CSP headers where possible)
2. ✅ CSRF token protection on all POST endpoints
3. ✅ Admin key validation on every authenticated request
4. ✅ Rate limiting to prevent brute force attacks
5. ✅ Session timeout (sessionStorage clears on tab close)

**Recommended Additional Measures:**
- Use HTTPS only (enforced by Apps Script)
- Rotate admin keys regularly
- Monitor diagnostic logs for suspicious access patterns
- Consider implementing IP whitelisting for admin access
- Use separate admin keys per environment (dev/staging/prod)
- Implement admin key expiration and rotation policies

**Future Improvements:**
If migrating away from Google Apps Script, consider:
- HTTP-only cookies for session management
- Server-side session storage (Redis, database)
- OAuth2/OIDC for admin authentication
- Multi-factor authentication (MFA)

### 2. Multi-brand Database Separation (Bug #11)

**Issue:** All brands share the same spreadsheet with logical separation only

**Risk:** A critical bug in brand filtering could expose data across brands

**Mitigations in Place:**
1. ✅ Brand ID validation on every request
2. ✅ Filter by brandId in all data queries
3. ✅ Comprehensive tests for cross-brand access prevention
4. ✅ Analytics queries isolated by brand

**Recommended for Production:**
- Physical database separation per brand
- Separate spreadsheets per brand
- Database-level row-level security

### 3. Apps Script Platform Limitations

**General Limitations:**
- No support for HTTP-only cookies
- No support for server-side sessions
- No database-level query filtering (loads all data then filters in-memory)
- Limited control over HTTP security headers
- No support for WebSockets or real-time features

**Workarounds:**
- Pagination support added to limit memory usage (Bug #50)
- User-friendly error messages to avoid information disclosure (Bug #48)
- Comprehensive input validation and sanitization
- ETag-based caching to reduce data transfer

## Security Features Implemented

### Input Validation & Sanitization
- ✅ XSS prevention via `sanitizeInput_()` function
- ✅ SQL injection prevention via `sanitizeId_()` validation
- ✅ Formula injection prevention via `sanitizeSpreadsheetValue_()`
- ✅ URL validation with protocol checks (javascript:, data:, file: blocked)
- ✅ Comprehensive regex validation for all user inputs

### Authentication & Authorization
- ✅ Admin key validation via `gate_()` function
- ✅ JWT implementation with algorithm verification (HS256 only)
- ✅ Token expiration and not-before (nbf) validation
- ✅ Timing-safe signature comparison
- ✅ Brand-scoped authentication

### CSRF Protection
- ✅ CSRF tokens required for all POST requests
- ✅ Token validation before processing mutations
- ✅ Origin validation for API requests

### Rate Limiting
- ✅ Per-brand rate limiting
- ✅ Progressive backoff on repeated failures
- ✅ Configurable rate limit thresholds

### Data Protection
- ✅ Brand isolation in all queries
- ✅ Sensitive data redaction in logs (adminKey, tokens, passwords)
- ✅ ETag support for efficient caching
- ✅ Input length validation to prevent DoS

### Open Redirect Prevention
- ✅ Warning page for external redirects (Bug #1)
- ✅ Hostname validation against brand whitelist
- ✅ URL sanitization before redirects

### CORS Configuration
- ✅ Origin validation against brand hostnames (Bug #16)
- ✅ Localhost allowed for development
- ✅ Google domains allowed for Apps Script execution

## Security Testing

### Unit Tests
- 372 unit tests covering all security fixes
- Tests for XSS, CSRF, SQL injection, formula injection
- JWT security tests (algorithm verification, expiration, nbf)
- Cross-brand isolation tests

### E2E Tests
- 261+ E2E tests covering security workflows
- Authentication and authorization flows
- Input validation on all forms
- CSRF protection verification

## Incident Response

If you discover a security vulnerability:

1. **DO NOT** open a public GitHub issue
2. Contact the maintainers privately
3. Provide detailed information:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Security Checklist for Deployment

Before deploying to production:

- [ ] Rotate all admin keys
- [ ] Enable rate limiting
- [ ] Configure CORS allowed origins
- [ ] Set up monitoring and alerting
- [ ] Review diagnostic logs for sensitive data
- [ ] Test all authentication flows
- [ ] Verify brand isolation
- [ ] Run full security test suite
- [ ] Enable HTTPS-only access
- [ ] Document admin key rotation policy
- [ ] Set up regular security audits

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Google Apps Script Security Best Practices](https://developers.google.com/apps-script/guides/security)
- [BUG_CATALOG.md](./BUG_CATALOG.md) - Full list of identified and fixed security issues

---

**Last Updated:** 2025-11-15
**Security Test Coverage:** 372 unit tests, 261+ E2E tests
**Known Critical Issues:** 0 (all addressed with mitigations)
