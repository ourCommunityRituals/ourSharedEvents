# Security Scanning & Vulnerability Remediation

> **Purpose:** Document security scanning processes, response SLAs, and the binding process for addressing vulnerabilities as the highest priority.
> **Last Updated:** 2026-03-27
> **Status:** Story 2.4 Implementation + Advanced Security Process

---

## Table of Contents

1. [Overview](#overview)
2. [Security Response Process (SLA)](#security-response-process-sla)
3. [Automated Security Scanning](#automated-security-scanning)
4. [Branch Protection Requirements](#branch-protection-requirements)
5. [Vulnerability Severity Levels](#vulnerability-severity-levels)
6. [Triage and Escalation](#triage-and-escalation)
7. [Remediation Process](#remediation-process)
8. [Handling npm Audit Findings](#handling-npm-audit-findings)
9. [Handling CodeQL Findings](#handling-codeql-findings)
10. [Exception Process](#exception-process)
11. [Security Checklist for PRs](#security-checklist-for-prs)
12. [Quick Reference](#quick-reference)

---

## Overview

This repository uses automated security scanning to identify vulnerabilities before code reaches production. Security scans are **required status checks** that block merging if issues are found. **Any code change on any branch triggers security scanning.**

Security findings are treated as the **highest priority work item**. No feature work proceeds while Critical or High findings remain unresolved.

### Security Gates

| Gate | Tool | Runs On | Blocks Merge? |
|------|------|---------|---------------|
| **CodeQL Analysis** | GitHub CodeQL | All branches, PR, Weekly | Yes (critical/high) |
| **Dependency Audit** | npm audit | All branches, PR, Weekly | Yes (critical/high) |
| **Trivy Vulnerability** | Aqua Trivy | All branches, PR, Weekly | Yes (critical/high) |
| **Semgrep SAST** | Semgrep | All branches, PR | Yes (findings) |
| **Gitleaks Secrets** | Gitleaks | All branches, PR | Yes (any secret) |
| **License Compliance** | license-checker | All branches, PR | Yes (copyleft) |
| **Dependency Review** | GitHub | PR only | Yes (high severity) |
| **SBOM Generation** | CycloneDX | All branches, PR | No (artifact) |
| **OSSF Scorecard** | OpenSSF | main, Weekly | No (tracking) |

### Workflow Files

| File | Purpose |
|------|---------|
| `.github/workflows/security-scan.yml` | CodeQL + npm audit |
| `.github/workflows/advanced-security-scan.yml` | Trivy, Semgrep, Gitleaks, SBOM, License, OSSF, Dep Review |
| `.github/workflows/security-triage.yml` | Auto-creates issues from scan failures |
| `.github/workflows/security-sla-enforcement.yml` | Daily SLA checks + escalation |
| `.github/workflows/security-regression.yml` | Runtime security regression tests |

---

## Security Response Process (SLA)

**This process is binding.** All security findings follow this lifecycle:

```
Scan Failure
    │
    ▼
Auto-Triage (security-triage.yml)
    │ Creates GitHub issue with severity + SLA deadline
    │ Assigns security owner (zeventbooks)
    ▼
Investigate (within Response SLA)
    │ Review scan logs → identify specific finding
    │ Confirm severity (may upgrade/downgrade)
    ▼
Decide: Fix or Except?
    │
    ├─► Fix → Apply remediation → Verify scan passes → Close issue
    │
    └─► Exception → File Security Exception issue
                     Requires justification + compensating controls
                     Critical findings CANNOT be excepted
                     Has mandatory review date
    ▼
Daily SLA Enforcement (security-sla-enforcement.yml)
    │ Posts escalation comments on overdue issues
    │ Adds "sla:overdue" label
    │ Checks exception expiry dates
    ▼
Resolution
    │ Issue closed with summary of actions taken
    │ Exception renewed or finding fixed
```

### SLA Table

| Severity | Response Time | Resolution Time | Exception Eligible? | Escalation |
|----------|--------------|-----------------|---------------------|------------|
| **Critical** | 1 hour | 4 hours | No | Immediate — all feature work stops |
| **High** | 4 hours | 24 hours | Yes (30 day max) | Feature work paused until resolved |
| **Moderate** | 24 hours | 7 days | Yes (90 day max) | Tracked, reviewed weekly |
| **Low** | 7 days | 30 days | Yes (180 day max) | Tracked, reviewed monthly |

### Rules

1. **Critical/High findings stop feature work.** No PRs for new features are merged while Critical or High security issues are open.
2. **Auto-triage is mandatory.** Every scan failure creates a tracked issue. No silent failures.
3. **SLA clock starts at detection**, not at human acknowledgment.
4. **Overdue issues are escalated daily** with comments and labels by the SLA enforcement workflow.
5. **Exceptions require compensating controls.** You cannot except a finding without documenting what mitigates the risk.
6. **Exceptions expire.** If not renewed by the review date, the finding reverts to its original priority.
7. **Critical findings cannot be excepted.** They must be fixed within 4 hours or the affected code is reverted.
8. **Human gate is enforced.** Automated agents (bots, CI, Claude Code) **cannot** merge code with security violations. Only a human reviewer can override by: (a) applying the `security:human-override` label, (b) approving the PR via GitHub review, and (c) posting a justification comment. The `security-human-gate.yml` workflow enforces this as a required status check.
9. **Bot-authored PRs with security failures require human approval.** If a PR is authored by a bot or agent and has security scan failures, a human must submit an approving review — the label alone is not sufficient.

---

## Automated Security Scanning

### CodeQL Analysis

CodeQL performs static analysis of JavaScript code to detect security vulnerabilities.

**Trigger Events:**
- Every push to `main` or `claude/**` branches
- Every PR to `main`
- Weekly scheduled scan (Sundays at 00:00 UTC)
- Manual dispatch for security audits

**Query Packs Used:**
- `security-extended` - Extended security queries
- `security-and-quality` - Security and code quality checks

**Coverage:**
- Backend: Google Apps Script (`.gs` files)
- Frontend: HTML files with embedded JavaScript
- Scripts: Build and deployment scripts (`.js`, `.mjs`)
- Worker: Cloudflare Worker code
- Tests: Test files for code quality

**Checks Include:**
- SQL Injection
- Cross-Site Scripting (XSS)
- Command Injection
- Path Traversal
- Insecure Randomness
- Hardcoded Credentials
- Prototype Pollution
- Regular Expression DoS (ReDoS)
- 200+ additional security patterns

### Dependency Audit

npm audit checks for known vulnerabilities in npm dependencies.

**Trigger Events:**
- Same as CodeQL (push, PR, weekly, manual)

**Policy:**
- **Critical/High severity:** Blocks merge
- **Moderate/Low severity:** Warning only (should be addressed)

---

## Branch Protection Requirements

To enforce security scans as required checks, configure branch protection rules:

### Configuration Steps

1. Navigate to **Settings > Branches > Branch protection rules**
2. Create or edit rule for `main` branch
3. Enable **Require status checks to pass before merging**
4. Add these required checks:
   - `CodeQL Security Scan` (from security-scan.yml)
   - `Dependency Vulnerability Audit` (from security-scan.yml)

### Visual Confirmation

After configuration, PRs should show:

```
Checks
--------------------------------------------
 CodeQL Security Scan              Required
 Dependency Vulnerability Audit    Required
--------------------------------------------
```

---

## Triage and Escalation

### Automated Triage

When any security scan fails, the `security-triage.yml` workflow automatically:

1. **Creates a GitHub issue** with severity label, SLA deadline, and assigned owner
2. **Links to the failed scan run** for immediate investigation
3. **Avoids duplicates** — if an open issue already exists for the same scan, adds a comment instead

### Escalation Chain

```
Detection (scan failure)
  └─► Auto-issue created (security-triage.yml)
       └─► Assigned to: zeventbooks
            └─► Daily SLA check (security-sla-enforcement.yml)
                 ├─► 75% SLA elapsed → warning comment posted
                 └─► SLA exceeded → "sla:overdue" label + escalation comment
                      └─► If Critical: affected code must be reverted
```

### Human Gate Enforcement

The `security-human-gate.yml` workflow runs on every PR and enforces:

- If security scans **pass** → gate is open, merge is allowed
- If security scans **fail** → gate blocks merge until:
  1. A **human** (not bot/agent) applies the `security:human-override` label
  2. A **human** approves the PR via GitHub review (required for bot-authored PRs)
  3. A **human** posts a comment with override justification (recommended)

**Configure as required status check:** Settings > Branches > main > Require status checks > add "Security Human Gate"

### Labels Used

| Label | Purpose |
|-------|---------|
| `security` | All security-related issues |
| `priority:critical` | Critical severity — 4h SLA |
| `priority:high` | High severity — 24h SLA |
| `priority:moderate` | Moderate severity — 7 day SLA |
| `priority:low` | Low severity — 30 day SLA |
| `auto-triage` | Issue auto-created by triage workflow |
| `sla:overdue` | Issue has exceeded its SLA |
| `exception` | Security exception filed |
| `security:human-override` | Human has reviewed and approved override |

---

## Vulnerability Severity Levels

### Classification

| Severity | Description | Blocks Merge? | Response Time |
|----------|-------------|---------------|---------------|
| **Critical** | Active exploitation possible, data breach risk | Yes | 1 hour response / 4 hour fix |
| **High** | Significant security impact, exploitation likely | Yes | 4 hour response / 24 hour fix |
| **Moderate** | Limited impact or complex exploitation | No | 24 hour response / 7 day fix |
| **Low** | Minimal impact, theoretical risk | No | 7 day response / 30 day fix |

### Examples

**Critical:**
- Remote code execution (RCE)
- SQL injection with data access
- Authentication bypass

**High:**
- Cross-site scripting (XSS) with session theft potential
- Prototype pollution affecting security functions
- Hardcoded credentials in source

**Moderate:**
- Information disclosure (non-sensitive)
- Denial of service (limited scope)
- XSS requiring user interaction

**Low:**
- Theoretical vulnerabilities
- Best practice violations
- Minor information leaks

---

## Remediation Process

### Step 1: Identify the Issue

Run security checks locally:

```bash
# Check for npm vulnerabilities
npm audit

# View detailed report
npm audit --json > audit-report.json

# Check specific package
npm audit --package-lock-only
```

### Step 2: Assess Impact

For each vulnerability, determine:

1. **Is it exploitable in our context?** - Some vulnerabilities only affect unused code paths
2. **What's the blast radius?** - Which surfaces/features are affected?
3. **Is there a patch available?** - Check if maintainer has released a fix

### Step 3: Apply Fix

#### Option A: Update Package (Preferred)

```bash
# Automatic fix for compatible updates
npm audit fix

# Force update (may have breaking changes)
npm audit fix --force

# Update specific package
npm update package-name
```

#### Option B: Manual Version Update

Edit `package.json` to specify a fixed version:

```json
{
  "dependencies": {
    "vulnerable-package": "^2.1.0"  // Updated from 2.0.0
  }
}
```

Then:

```bash
npm install
npm audit  # Verify fix
```

#### Option C: Replace Package

If no fix is available, consider alternatives:

1. Search for maintained alternatives on npm
2. Evaluate if the functionality is still needed
3. Replace with a secure alternative

### Step 4: Verify Fix

```bash
# Verify vulnerability is resolved
npm audit

# Run tests to ensure no regressions
npm test

# Run security-specific tests
npm run test:unit -- tests/unit/security.test.js
```

### Step 5: Document Changes

In your PR description, include:

```markdown
## Security Fix

**Vulnerability:** CVE-YYYY-XXXXX
**Package:** package-name
**Previous Version:** 1.0.0
**Fixed Version:** 1.1.0

**Resolution:** Updated package to patched version.
**Testing:** Verified with npm audit and unit tests.
```

---

## Handling npm Audit Findings

### Common Scenarios

#### Scenario 1: Direct Dependency Vulnerable

```bash
# Check which packages depend on the vulnerable package
npm ls vulnerable-package

# Update directly
npm update vulnerable-package
```

#### Scenario 2: Transitive Dependency Vulnerable

```bash
# Find the path to the vulnerability
npm ls vulnerable-package

# Output shows: parent-package -> child-package -> vulnerable-package

# Option 1: Update parent package
npm update parent-package

# Option 2: Use npm overrides (npm 8.3+)
# Add to package.json:
{
  "overrides": {
    "vulnerable-package": "^1.2.3"
  }
}
```

#### Scenario 3: Dev Dependency Only

Dev dependencies only affect the development environment, not production:

```bash
# Check if vulnerability is in devDependencies
npm ls vulnerable-package

# If only in devDependencies and not exploitable during development:
# - Document exception (see Exception Process)
# - Plan update for next maintenance window
```

#### Scenario 4: No Fix Available

If no patch exists:

1. **Check if it affects us:** Review the vulnerability details
2. **Mitigate if possible:** Add input validation or restrictions
3. **Document exception:** Follow the Exception Process
4. **Monitor for fix:** Set up alerts for the package

### Useful Commands

```bash
# Show all vulnerabilities with details
npm audit

# Show only production vulnerabilities
npm audit --omit=dev

# Generate JSON report
npm audit --json > .security-reports/audit.json

# Dry-run fix to see what would change
npm audit fix --dry-run

# Fix only production dependencies
npm audit fix --only=prod
```

---

## Handling CodeQL Findings

### Viewing Results

1. Go to **Security** tab in GitHub repository
2. Click **Code scanning alerts**
3. Review each finding

### Addressing Findings

#### False Positives

If CodeQL flags code that is not actually vulnerable:

1. Review the code path CodeQL identified
2. Verify the input is sanitized/validated elsewhere
3. Add a comment explaining why it's safe:

```javascript
// CodeQL: This input is validated by validateUserInput() above
// False positive - safe to use here
const result = someOperation(userInput);
```

Or use CodeQL's inline suppression:

```javascript
// codeql[js/sql-injection]
const query = buildQuery(input); // Input is parameterized
```

#### True Positives

Fix the vulnerable code:

```javascript
// BEFORE (vulnerable to XSS)
element.innerHTML = userInput;

// AFTER (safe)
element.textContent = userInput;
```

```javascript
// BEFORE (vulnerable to injection)
const query = `SELECT * FROM users WHERE id = ${userId}`;

// AFTER (parameterized)
const query = 'SELECT * FROM users WHERE id = ?';
db.query(query, [userId]);
```

---

## Exception Process

Some vulnerabilities may require temporary exceptions. Use this process sparingly.

### When Exceptions Are Allowed

- No patch available and vulnerability is not exploitable in our context
- Fix requires major breaking changes that need planning
- Development-only dependency with no production impact

### Creating an Exception

1. **Create Exception Entry**

   Add to `.security-exceptions.json` (create if needed):

   ```json
   {
     "exceptions": [
       {
         "id": "CVE-YYYY-XXXXX",
         "package": "package-name",
         "reason": "Only affects server-side rendering which we don't use",
         "addedBy": "developer@example.com",
         "addedDate": "2025-12-10",
         "reviewDate": "2026-01-10",
         "approvedBy": "security-lead@example.com"
       }
     ]
   }
   ```

2. **Document in PR**

   Include in your PR:

   ```markdown
   ## Security Exception Request

   **CVE:** CVE-YYYY-XXXXX
   **Package:** package-name@1.0.0
   **Severity:** High

   **Justification:** This vulnerability affects the server-side rendering
   functionality which our application does not use. The vulnerable code
   path is never executed in our deployment.

   **Mitigation:** Added input validation in api_processInput() to prevent
   malicious payloads from reaching this code.

   **Review Date:** 2026-01-10
   ```

3. **Get Approval**

   Exceptions require approval from:
   - Team lead or security designee
   - Must be documented in the PR

### Exception Review

Exceptions are automatically reviewed:
- **30 days:** Re-evaluate if fix is available
- **90 days:** Exception expires and must be renewed or fixed

---

## Security Checklist for PRs

Before submitting a PR, verify:

### Code Changes

- [ ] No hardcoded secrets or credentials
- [ ] User input is validated/sanitized
- [ ] No SQL/command injection vectors
- [ ] HTML output is properly escaped
- [ ] API endpoints validate authentication
- [ ] Sensitive data is not logged

### Dependencies

- [ ] `npm audit` shows no new high/critical issues
- [ ] New dependencies are from trusted sources
- [ ] Dependencies have recent updates/maintenance
- [ ] No unnecessary dependencies added

### CI Checks

- [ ] CodeQL scan passes
- [ ] Dependency audit passes
- [ ] Security unit tests pass

---

## Quick Reference

### Commands

```bash
# Run full security check locally
npm audit && npm run test:unit -- tests/unit/security.test.js

# Fix vulnerabilities
npm audit fix

# Force fix (review changes carefully)
npm audit fix --force

# Check production only
npm audit --omit=dev

# Generate report
npm audit --json > .security-reports/audit.json
```

### Key Files

| File | Purpose |
|------|---------|
| `.github/workflows/security-scan.yml` | CodeQL + npm audit (all branches) |
| `.github/workflows/advanced-security-scan.yml` | Trivy, Semgrep, Gitleaks, SBOM, License, OSSF (all branches) |
| `.github/workflows/security-triage.yml` | Auto-creates issues from scan failures |
| `.github/workflows/security-sla-enforcement.yml` | Daily SLA checks + escalation |
| `.github/workflows/security-human-gate.yml` | Blocks bot/agent merges on security failures |
| `.github/workflows/security-regression.yml` | Runtime security regression tests |
| `.github/ISSUE_TEMPLATE/security-vulnerability.yml` | Security issue template with SLA |
| `.github/ISSUE_TEMPLATE/security-exception.yml` | Exception request template |
| `tests/unit/security.test.js` | Security unit tests |
| `docs/SECURITY.md` | This document |
| `.security-exceptions.json` | Documented exceptions |
| `.security-reports/` | Generated audit reports |

### GitHub Security Features

| Feature | Location | Purpose |
|---------|----------|---------|
| **Security Alerts** | Security > Dependabot alerts | Automated vulnerability notifications |
| **Code Scanning** | Security > Code scanning alerts | CodeQL findings |
| **Secret Scanning** | Security > Secret scanning alerts | Exposed credentials detection |

### Contact

For security questions or to report vulnerabilities:
- Open an issue with the `security` label
- Or contact the repository maintainers

---

## Related Documentation

- [ci-cd-architecture.md](./ci-cd-architecture.md) - CI/CD pipeline overview
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment procedures
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
