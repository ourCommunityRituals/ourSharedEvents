# Security Setup Guide

**CRITICAL:** Before deploying this application to production, you MUST complete these security steps.

## 1. Change Admin Secrets

The default admin secrets in `Config.gs` are insecure placeholders that MUST be changed.

### Steps:

1. **Generate Strong Secrets**

   Use one of these methods to generate cryptographically secure random strings:

   **Option A: Node.js**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   **Option B: OpenSSL**
   ```bash
   openssl rand -hex 32
   ```

   **Option C: Python**
   ```bash
   python3 -c "import secrets; print(secrets.token_hex(32))"
   ```

   **Option D: Online Generator** (use with caution)
   - Visit: https://www.random.org/strings/
   - Length: 64, Characters: Hexadecimal
   - Generate 3 unique strings (one per brand)

2. **Update Config.gs**

   Replace the `CHANGE_ME_*` values in `Config.gs`:

   ```javascript
   const BRANDS = [
     {
       id: 'root',
       name: 'Zeventbook',
       hostnames: ['zeventbook.io','www.zeventbook.io'],
       adminSecret: 'YOUR_GENERATED_SECRET_HERE', // ✅ REPLACE THIS
       store: { type: 'workbook', spreadsheetId: SpreadsheetApp.getActive().getId() },
       scopesAllowed: ['events']
     },
     // ... repeat for other brands
   ];
   ```

3. **Store Secrets Securely**

   - **NEVER** commit secrets to version control
   - Store secrets in a password manager (1Password, LastPass, etc.)
   - Share with team members via secure channels only
   - Consider using Google Apps Script Properties Service for production:

   ```javascript
   // Alternative: Use Script Properties (more secure)
   const props = PropertiesService.getScriptProperties();
   props.setProperty('ADMIN_SECRET_ROOT', 'your-secret-here');

   // Then in Config.gs:
   adminSecret: PropertiesService.getScriptProperties().getProperty('ADMIN_SECRET_ROOT')
   ```

## 2. Security Checklist

Before going live, verify these items:

### Authentication & Authorization
- [ ] All brand `adminSecret` values changed from `CHANGE_ME_*`
- [ ] Admin secrets are at least 32 characters long
- [ ] Admin secrets are cryptographically random
- [ ] Secrets stored securely (password manager or Script Properties)
- [ ] Test that old placeholder secrets no longer work

### Deployment Configuration
- [ ] Apps Script deployment set to execute as "User accessing"
- [ ] Access set appropriately (not "Anyone" unless intended)
- [ ] Review OAuth scopes in `appsscript.json`
- [ ] Enable "Require users to sign in" if applicable

### Data Protection
- [ ] Spreadsheet permissions restricted to authorized users
- [ ] DIAG log sheet reviewed for sensitive data
- [ ] Consider encrypting sensitive data at rest
- [ ] Review and limit retention period for logs

### Input Validation
- [ ] Server-side input sanitization enabled (already implemented)
- [ ] URL validation restricts to http/https (already implemented)
- [ ] Test XSS protection with malicious inputs
- [ ] Test SQL-like injection attempts

### Rate Limiting
- [ ] Rate limit configured (default: 10 req/min per brand)
- [ ] Adjust `RATE_MAX_PER_MIN` if needed for your use case
- [ ] Test rate limiting enforcement
- [ ] Monitor for abuse patterns in DIAG logs

## 3. Testing Security

Run these tests before production deployment:

### Test 1: Admin Authentication
```javascript
// Should FAIL with invalid key
api_create({
  brandId: 'root',
  scope: 'events',
  templateId: 'event',
  adminKey: 'WRONG_KEY',
  data: { name: 'Test Event', dateISO: '2025-12-01' }
});
// Expected: { ok: false, code: 'BAD_INPUT', message: 'Invalid admin key' }

// Should SUCCEED with correct key
api_create({
  brandId: 'root',
  scope: 'events',
  templateId: 'event',
  adminKey: 'YOUR_ACTUAL_SECRET',
  data: { name: 'Test Event', dateISO: '2025-12-01' }
});
// Expected: { ok: true, value: { id: '...', links: {...} } }
```

### Test 2: XSS Protection
```javascript
// Try to inject script tags
api_create({
  brandId: 'root',
  scope: 'events',
  templateId: 'event',
  adminKey: 'YOUR_ACTUAL_SECRET',
  data: {
    name: '<script>alert("XSS")</script>Test Event',
    dateISO: '2025-12-01'
  }
});
// Verify: Script tags are stripped/escaped in stored data
```

### Test 3: URL Validation
```javascript
// Should FAIL with javascript: protocol
api_create({
  brandId: 'root',
  scope: 'events',
  templateId: 'event',
  adminKey: 'YOUR_ACTUAL_SECRET',
  data: {
    name: 'Test Event',
    dateISO: '2025-12-01',
    signupUrl: 'javascript:alert("XSS")'
  }
});
// Expected: { ok: false, code: 'BAD_INPUT', message: 'Invalid URL: signupUrl' }
```

### Test 4: Rate Limiting
```javascript
// Make 11 rapid requests (exceeds 10/min limit)
for (let i = 0; i < 11; i++) {
  api_create({
    brandId: 'root',
    scope: 'events',
    templateId: 'event',
    adminKey: 'YOUR_ACTUAL_SECRET',
    idemKey: `test-${i}`,
    data: { name: `Event ${i}`, dateISO: '2025-12-01' }
  });
}
// Expected: 11th request returns { ok: false, code: 'RATE_LIMITED' }
```

## 4. Production Deployment Steps

1. **Pre-deployment**
   - [ ] Complete all items in Security Checklist
   - [ ] Run all security tests
   - [ ] Review code changes since last deployment
   - [ ] Backup existing spreadsheet data

2. **Deployment**
   - [ ] Update `Config.gs` with production secrets
   - [ ] Update `ZEB.BUILD_ID` with deployment timestamp
   - [ ] Deploy as new version in Apps Script
   - [ ] Test `/exec?page=test` shows all ✅
   - [ ] Smoke test create/read/list operations

3. **Post-deployment**
   - [ ] Verify admin page requires correct secret
   - [ ] Test public page loads without authentication
   - [ ] Monitor DIAG logs for errors
   - [ ] Document deployment in changelog

## 5. Incident Response

If a secret is compromised:

1. **Immediate Actions**
   - Generate new admin secrets immediately
   - Update `Config.gs` with new secrets
   - Redeploy the application
   - Invalidate any cached admin sessions

2. **Investigation**
   - Review DIAG logs for unauthorized access
   - Check for suspicious data modifications
   - Identify scope of compromise

3. **Recovery**
   - Rotate all secrets (even if not confirmed compromised)
   - Review and restrict spreadsheet permissions
   - Consider implementing additional auth layers
   - Update documentation and notify stakeholders

## 6. Ongoing Security Maintenance

### Monthly
- [ ] Review DIAG logs for anomalies
- [ ] Check for unauthorized access attempts
- [ ] Verify rate limiting is working
- [ ] Update dependencies if applicable

### Quarterly
- [ ] Rotate admin secrets
- [ ] Review and update OAuth scopes
- [ ] Security audit of code changes
- [ ] Test disaster recovery procedures

### Annually
- [ ] Full security assessment
- [ ] Penetration testing (if budget allows)
- [ ] Review access control policies
- [ ] Update security documentation

## 7. Additional Hardening (Optional)

For high-security deployments, consider:

1. **IP Whitelisting**
   - Restrict admin access to known IP ranges
   - Implement in `gate_()` function

2. **Two-Factor Authentication**
   - Add TOTP verification for admin actions
   - Use Google Authenticator integration

3. **Audit Logging**
   - Log all admin actions with timestamps
   - Include IP addresses and user agents
   - Retain logs for compliance requirements

4. **Encrypted Storage**
   - Encrypt sensitive data fields
   - Use Google KMS for key management
   - Implement field-level encryption

5. **WAF/CDN**
   - Use Cloudflare or similar for DDoS protection
   - Implement additional rate limiting at edge
   - Add bot detection

## 8. Compliance Considerations

Depending on your use case, you may need to address:

- **GDPR**: Data privacy, right to deletion, data portability
- **CCPA**: Consumer privacy rights
- **HIPAA**: Healthcare data protection (NOT recommended for this platform)
- **SOC 2**: Security controls and auditing

**Recommendation:** This MVP is NOT designed for sensitive personal data or regulated industries. For such use cases, migrate to a platform with built-in compliance features.

---

## Emergency Contacts

- **Security Issues**: Report to your security team immediately
- **Google Apps Script Support**: https://support.google.com/
- **Report Vulnerabilities**: Create issue at project repository

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Google Apps Script Security Best Practices](https://developers.google.com/apps-script/guides/security)
- [Password Security Best Practices](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

---

**Last Updated**: 2025-11-08
**Review Schedule**: Quarterly
