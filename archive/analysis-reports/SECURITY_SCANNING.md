# 🔒 Security Scanning Infrastructure

**Implemented:** 2025-11-14
**Priority:** P1 (High)
**Status:** ✅ Active

---

## Overview

This project now has **automated security scanning** via two complementary systems:

1. **CodeQL** - Static Application Security Testing (SAST)
2. **Dependabot** - Dependency vulnerability scanning & automated updates

Together, these provide continuous security monitoring and automated remediation.

---

## 1. CodeQL Analysis

### What is CodeQL?

CodeQL is GitHub's semantic code analysis engine that finds security vulnerabilities and coding errors in your codebase.

### Coverage

**Languages Analyzed:**
- ✅ JavaScript (includes .js, .gs, .html files)

**Codebase Coverage:**
- Backend: Google Apps Script files (Code.gs, Config.gs, SharedReporting.gs)
- Frontend: HTML files with embedded JavaScript
- Tests: Jest and Playwright test suites
- Scripts: Deployment and utility scripts

### Security Checks

CodeQL scans for **200+ security vulnerabilities** including:

| Category | Examples |
|----------|----------|
| **Injection** | SQL Injection, Command Injection, XSS |
| **Authentication** | Hardcoded credentials, weak crypto |
| **Data Flow** | Path traversal, insecure deserialization |
| **Logic Errors** | Prototype pollution, ReDoS |
| **Code Quality** | Unused variables, dead code, complexity |

### When CodeQL Runs

```yaml
Triggers:
├─ Every push to main branch
├─ Every push to claude/** branches
├─ Every pull request to main
└─ Weekly scan (Sundays at 00:00 UTC)
```

### Query Packs Used

1. **security-extended** - Extended security vulnerability detection
2. **security-and-quality** - Combined security and code quality analysis

### Workflow Location

`.github/workflows/codeql-analysis.yml`

### Viewing Results

**Via GitHub UI:**
1. Go to repository **Security** tab
2. Click **Code scanning alerts**
3. View findings categorized by severity

**Via GitHub Actions:**
1. Go to **Actions** tab
2. Click on **CodeQL Security Analysis** workflow
3. View job summary for scan results

### SARIF Output

Results are uploaded as SARIF (Static Analysis Results Interchange Format) files for:
- Integration with security dashboards
- Long-term trend analysis
- Compliance reporting

---

## 2. Dependabot

### What is Dependabot?

Dependabot automatically:
- Scans dependencies for known vulnerabilities (using GitHub Advisory Database)
- Creates pull requests to update vulnerable dependencies
- Keeps dependencies up-to-date with latest patches

### Coverage

**Package Ecosystems:**

1. **NPM (package.json)**
   - All production dependencies
   - All development dependencies
   - Transitive dependencies

2. **GitHub Actions**
   - Workflow action versions
   - Keeps CI/CD secure

### Configuration Details

**NPM Dependencies:**
- **Schedule:** Weekly (Mondays at 9:00 AM Chicago time)
- **PR Limit:** 10 open PRs max
- **Grouping:** Minor/patch updates grouped by type (dev vs. prod)
- **Major Updates:** Ignored (require manual review)
- **Labels:** `dependencies`, `security`, `automated`

**GitHub Actions:**
- **Schedule:** Weekly (Mondays at 9:00 AM Chicago time)
- **PR Limit:** 5 open PRs max
- **Labels:** `dependencies`, `github-actions`, `automated`

### Dependency Groups

**Development Dependencies:**
- Groups: ESLint, Jest, Playwright, etc.
- Update Types: Minor + Patch
- Single PR per week

**Production Dependencies:**
- Groups: @google/clasp, googleapis, etc.
- Update Types: Minor + Patch
- Single PR per week

**Security Vulnerabilities:**
- Always get individual PRs (not grouped)
- Created immediately when detected
- Labeled with severity level

### Configuration Location

`.github/dependabot.yml`

### Viewing Updates

**Via GitHub UI:**
1. Go to **Pull Requests** tab
2. Filter by label: `dependencies`
3. Review Dependabot PRs

**Via Insights:**
1. Go to **Insights** tab
2. Click **Dependency graph**
3. Click **Dependabot** to see update status

### Auto-Merge (Optional)

To enable auto-merge for low-risk updates:

```bash
# Enable auto-merge for patch updates
gh pr review <PR-NUMBER> --approve
gh pr merge <PR-NUMBER> --auto --squash
```

---

## 3. Combined Security Benefits

### Continuous Monitoring

```
┌─────────────────────────────────────────────────────┐
│           CONTINUOUS SECURITY MONITORING            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  CodeQL (Code)          Dependabot (Dependencies)  │
│  ├─ Every push          ├─ Weekly scans            │
│  ├─ Every PR            ├─ Vulnerability alerts    │
│  ├─ Weekly scans        ├─ Auto PRs for fixes      │
│  └─ 200+ checks         └─ GitHub Advisory DB      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Defense in Depth

| Layer | Tool | Protection |
|-------|------|------------|
| **Code** | CodeQL | Finds vulnerabilities in YOUR code |
| **Dependencies** | Dependabot | Finds vulnerabilities in THIRD-PARTY code |
| **Quality** | ESLint | Enforces code quality standards |

### Security Metrics

**Before Security Scanning:**
- ❌ No automated vulnerability detection
- ❌ No dependency security checks
- ❌ Manual security review only
- ❌ No compliance evidence

**After Security Scanning:**
- ✅ Automated SAST on every commit
- ✅ Weekly dependency vulnerability scans
- ✅ Automated PR creation for fixes
- ✅ SARIF reports for compliance
- ✅ Security tab with centralized findings
- ✅ GitHub Advisory Database integration

---

## 4. Security Workflow

### When Code is Pushed

```
1. Developer pushes code
   ↓
2. GitHub Actions triggered
   ↓
3. Three parallel quality gates:
   ├─ ESLint (code quality)
   ├─ CodeQL (security analysis)
   └─ Unit/Contract Tests
   ↓
4. All gates must pass
   ↓
5. Deployment allowed
```

### When Vulnerability Found

**CodeQL Finding:**
```
1. CodeQL detects issue
   ↓
2. Alert created in Security tab
   ↓
3. Categorized by severity (Critical/High/Medium/Low)
   ↓
4. Developer reviews and fixes
   ↓
5. Fix verified in next scan
```

**Dependabot Finding:**
```
1. Dependabot detects vulnerable dependency
   ↓
2. Creates PR with update
   ↓
3. CI runs tests on PR
   ↓
4. Developer reviews and merges
   ↓
5. Vulnerability resolved
```

---

## 5. Best Practices

### For Developers

**✅ DO:**
- Review CodeQL alerts promptly
- Merge Dependabot PRs after testing
- Keep dependencies up-to-date
- Use `npm audit` locally before pushing
- Enable branch protection requiring security checks

**❌ DON'T:**
- Ignore security alerts
- Disable security scanning
- Skip Dependabot PRs
- Commit credentials or secrets
- Bypass security checks

### For Security Reviews

**Weekly Tasks:**
1. Check Security tab for new alerts
2. Review open Dependabot PRs
3. Verify CodeQL scans are passing
4. Update major dependencies manually

**Monthly Tasks:**
1. Review security scan trends
2. Update security policies
3. Audit dependency tree
4. Review SARIF reports for compliance

---

## 6. Configuration Files

| File | Purpose | Auto-Updated |
|------|---------|--------------|
| `.github/workflows/codeql-analysis.yml` | CodeQL workflow | No |
| `.github/dependabot.yml` | Dependabot config | No |
| `package.json` | Dependencies | Via Dependabot PRs |
| `package-lock.json` | Locked versions | Via Dependabot PRs |

---

## 7. Integration with CI/CD

### Stage 1 Pipeline (Enhanced)

```yaml
Stage 1: Build & Test
├─ 1. ESLint (code quality)        ← Added in previous task
├─ 2. CodeQL (security)             ← Added in this task
├─ 3. Unit Tests
├─ 4. Contract Tests
└─ 5. Deploy (if all pass)
```

### Security Gates

| Gate | Blocks Deployment | Run Frequency |
|------|-------------------|---------------|
| ESLint | ✅ Yes | Every push/PR |
| CodeQL | ⚠️ No* | Every push/PR + Weekly |
| Dependabot | ⚠️ No* | Weekly + On-demand |

*CodeQL and Dependabot create alerts but don't block deployment. This allows urgent fixes while maintaining security visibility.

---

## 8. Troubleshooting

### CodeQL Scan Failing

**Problem:** "CodeQL analysis failed"

**Solutions:**
1. Check for syntax errors in code
2. Verify Node.js dependencies install correctly
3. Review CodeQL logs in Actions tab
4. Ensure repo has Security tab enabled

### Dependabot Not Creating PRs

**Problem:** "No Dependabot PRs appearing"

**Solutions:**
1. Verify `.github/dependabot.yml` is in main branch
2. Check Dependabot logs in Insights → Dependency graph
3. Ensure repo has Dependabot enabled in Settings
4. Wait for scheduled run (Mondays 9 AM CT)

### Too Many Dependabot PRs

**Problem:** "Overwhelmed by update PRs"

**Solutions:**
1. Reduce `open-pull-requests-limit` in config
2. Enable PR grouping for minor/patch updates
3. Set up auto-merge for low-risk updates
4. Change schedule to monthly instead of weekly

---

## 9. Security Compliance

### Evidence for Audits

**What This Provides:**
- ✅ Automated SAST scanning (CodeQL)
- ✅ Dependency vulnerability tracking (Dependabot)
- ✅ SARIF reports for each scan
- ✅ Audit trail in GitHub Security tab
- ✅ Weekly scan cadence
- ✅ Automated remediation workflow

### Standards Supported

| Standard | Coverage |
|----------|----------|
| **OWASP Top 10** | XSS, Injection, Auth, etc. |
| **CWE** | Common Weakness Enumeration |
| **CVE** | Common Vulnerabilities and Exposures |
| **GitHub Advisory DB** | Dependency vulnerabilities |

---

## 10. Cost & Performance

### Cost

**CodeQL:**
- ✅ **FREE** for public repositories
- ✅ **FREE** for private repositories (included in GitHub Team/Enterprise)

**Dependabot:**
- ✅ **FREE** for all repositories

### Performance Impact

**CodeQL:**
- Runs in parallel with tests (no delay)
- Typical scan time: 2-5 minutes
- Does NOT block deployment

**Dependabot:**
- Runs on schedule (not triggered by pushes)
- No impact on development workflow
- PRs can be reviewed/merged at developer's convenience

---

## 11. Next Steps

### Immediate (Week 1)
- ✅ CodeQL running automatically
- ✅ Dependabot creating PRs
- ⏳ Review initial security findings
- ⏳ Merge Dependabot PRs

### Short-term (Month 1)
- [ ] Enable branch protection requiring CodeQL
- [ ] Set up auto-merge for patch updates
- [ ] Create security incident response plan
- [ ] Add secret scanning (GitHub feature)

### Long-term (Month 2+)
- [ ] Add custom CodeQL queries for business logic
- [ ] Implement security training for team
- [ ] Set up security metrics dashboard
- [ ] Integrate with SIEM/security tools

---

## 12. Resources

### Documentation
- [CodeQL Documentation](https://codeql.github.com/docs/)
- [Dependabot Documentation](https://docs.github.com/en/code-security/dependabot)
- [GitHub Security Features](https://docs.github.com/en/code-security)

### Query Libraries
- [CodeQL JavaScript Queries](https://github.com/github/codeql/tree/main/javascript)
- [Security Query Pack](https://github.com/github/codeql/blob/main/javascript/ql/src/Security/)

### Community
- [CodeQL Discussions](https://github.com/github/codeql/discussions)
- [GitHub Security Lab](https://securitylab.github.com/)

---

## Summary

✅ **CodeQL** - Analyzes YOUR code for vulnerabilities
✅ **Dependabot** - Analyzes DEPENDENCIES for vulnerabilities
✅ **ESLint** - Enforces code quality
✅ **Automated** - Runs on every commit + weekly
✅ **Free** - No cost for any repository
✅ **Integrated** - Works with existing CI/CD

**Security posture significantly improved with minimal developer overhead.**

---

**Document Version:** 1.0
**Last Updated:** 2025-11-14
**Next Review:** 2025-12-14
