# SETTINGS_AS_CODE_PLAN.md — Infrastructure Settings as Code Plan

> **PROMPTSPEC-SEC-10.2** — Settings as Code Plan
> Role: Director of Security
> Created: 2026-01-05
> Status: **PLAN** (Highest Grade — Optional)

---

## 1. Purpose

Reduce dashboard drift with reviewable, reproducible configuration changes. This plan defines a phased approach to managing Cloudflare infrastructure settings through version-controlled code.

| Attribute | Value |
|-----------|-------|
| **Scope** | Cloudflare edge configuration: DNS, routes, rulesets, Access apps |
| **Non-Goals** | Worker code (already in git), Google Sheets backend, application logic |
| **Prerequisites** | SEC-1.2 (API Tokens Policy), SEC-0.1 (Security Baseline) |

### Problem Statement

| Issue | Risk | Current State |
|-------|------|---------------|
| **Dashboard Drift** | Config diverges between staging/prod | Manual dashboard changes not tracked |
| **No Audit Trail** | Who changed what, when? | Cloudflare audit logs only (90 days retention) |
| **No Peer Review** | Security changes bypass PR process | Direct dashboard access |
| **No Rollback** | Reverting changes requires manual work | No version history |
| **Documentation Lag** | Docs don't match live config | Specs describe intent, not actual state |

---

## 2. North Star Compliance

### 2.1 NS-1: Edge-First Security

> **NS-1:** Every public request hits Cloudflare first

Settings as Code ensures edge configuration remains consistent and auditable:

| Layer | Current State | Target State |
|-------|---------------|--------------|
| **DNS Records** | Dashboard-managed | Version-controlled, PR-reviewed |
| **Worker Routes** | wrangler.toml (partial) | Fully declarative |
| **WAF Rulesets** | Dashboard-managed | Export+diff or Terraform |
| **Access Policies** | Dashboard-managed | Export+diff or Terraform |

### 2.2 Defense-in-Depth

Version-controlled configuration adds a review layer before production changes:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    CURRENT CHANGE FLOW (Dashboard)                           │
├──────────────────────────────────────────────────────────────────────────────┤
│  Engineer → Dashboard Login → Change → Production (immediate)                │
│                                                                              │
│  RISKS: No review, no audit in git, no rollback, drift possible             │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                    TARGET CHANGE FLOW (Settings as Code)                     │
├──────────────────────────────────────────────────────────────────────────────┤
│  Engineer → Branch → Code Change → PR Review → Merge → CI Apply → Production│
│                                                                              │
│  BENEFITS: Peer review, git audit trail, rollback via revert, drift alerts  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Approach Comparison

### 3.1 Terraform vs Export+Diff

| Criterion | Terraform | Export+Diff |
|-----------|-----------|-------------|
| **Learning Curve** | High (HCL, state management) | Low (JSON/YAML, scripts) |
| **Tooling Maturity** | Excellent (cloudflare provider) | Custom scripts required |
| **State Management** | Built-in (remote state) | Manual tracking |
| **Drift Detection** | `terraform plan` | Custom diff scripts |
| **Rollback** | State-based, reliable | Manual revert |
| **CI/CD Integration** | Excellent | Custom implementation |
| **Partial Adoption** | Difficult (state conflicts) | Easy (per-resource) |
| **Team Familiarity** | Requires training | Builds on existing skills |
| **Blast Radius Risk** | Higher (state-driven) | Lower (explicit changes) |

### 3.2 Recommendation: Phased Hybrid Approach

**Phase 1-2:** Export+Diff for learning and low-risk resources
**Phase 3+:** Terraform for resources benefiting from state management

| Resource Type | Recommended Approach | Rationale |
|---------------|---------------------|-----------|
| DNS Records | Export+Diff → Terraform | Start simple, migrate when stable |
| Worker Routes | wrangler.toml (current) | Already version-controlled |
| WAF Rulesets | Export+Diff | Complex, rare changes, review-focused |
| Access Apps | Export+Diff → Terraform | Identity-critical, benefits from state |
| Page Rules | Export+Diff | Being deprecated by Cloudflare |
| Rate Limiting | Export+Diff | Tied to WAF workflow |

---

## 4. Minimum Viable Scope (Phase 1)

### 4.1 DNS Records

**Priority:** HIGH — Foundation for all other services

| Record Type | Example | Include in Phase 1 |
|-------------|---------|-------------------|
| A/AAAA | Root and www pointing to CF proxy | Yes |
| CNAME | Subdomains (stg, api, api-stg) | Yes |
| TXT | SPF, DKIM, domain verification | Yes |
| MX | Email routing (if applicable) | Yes |
| CAA | Certificate authority authorization | Yes |

**Implementation:** `cloudflare/dns/eventangle.com.json`

```json
{
  "zone": "eventangle.com",
  "records": [
    {
      "type": "A",
      "name": "@",
      "content": "192.0.2.1",
      "proxied": true,
      "comment": "Apex to CF proxy"
    },
    {
      "type": "CNAME",
      "name": "www",
      "content": "eventangle.com",
      "proxied": true,
      "comment": "Canonical host"
    },
    {
      "type": "CNAME",
      "name": "stg",
      "content": "eventangle.com",
      "proxied": true,
      "comment": "Staging environment"
    }
  ]
}
```

### 4.2 Worker Routes

**Priority:** MEDIUM — Already partially managed via wrangler.toml

**Current State:**
- Routes defined in `worker/wrangler.toml` per environment
- Deployed via `wrangler deploy`

**Gap:** Route definitions spread across multiple wrangler files.

**Target:** Centralized route manifest with environment override capability.

### 4.3 WAF Rulesets (Export+Diff Only)

**Priority:** MEDIUM — Security-critical, but rare changes

**Approach:** Read-only export for review, not automated apply.

| Ruleset | Export Method | Apply Method |
|---------|---------------|--------------|
| Managed Ruleset config | API export → JSON | Manual dashboard (Phase 1) |
| Custom rules | API export → JSON | Manual dashboard (Phase 1) |
| Rule overrides | API export → JSON | Manual dashboard (Phase 1) |

**Rationale:** WAF changes are high-risk; human review of export diffs provides value without automation risk.

### 4.4 Cloudflare Access Apps

**Priority:** HIGH — Identity-gated surfaces (NS-2)

| Access Resource | Phase 1 Scope |
|-----------------|---------------|
| Access Applications | Export configuration |
| Access Policies | Export policy rules |
| Service Tokens | Document existence (not secrets) |
| Identity Providers | Export config (OAuth connections) |

**Security Note:** Service token values must NEVER be exported. Export metadata only.

---

## 5. Phased Implementation Plan

### 5.1 Phase Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SETTINGS AS CODE PHASES                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Phase 1: EXPORT + VISIBILITY                                               │
│  ├─ Export current state to JSON/YAML                                       │
│  ├─ Store in git (cloudflare/ directory)                                    │
│  ├─ CI job to detect drift (export vs committed)                            │
│  └─ No automated apply; manual changes with PR documentation                │
│                                                                             │
│  Phase 2: DIFF + REVIEW                                                     │
│  ├─ PR workflow for config changes                                          │
│  ├─ CI generates diff preview on PR                                         │
│  ├─ Required approval for security-sensitive changes                        │
│  └─ Manual apply after merge (documented runbook)                           │
│                                                                             │
│  Phase 3: AUTOMATED APPLY (DNS Only)                                        │
│  ├─ CI applies DNS changes on merge to main                                 │
│  ├─ WAF/Access remain manual apply                                          │
│  ├─ Rollback via git revert + CI re-apply                                   │
│  └─ Evaluate Terraform migration for DNS                                    │
│                                                                             │
│  Phase 4: TERRAFORM MIGRATION (Optional)                                    │
│  ├─ Import existing resources to Terraform state                            │
│  ├─ Migrate DNS to Terraform                                                │
│  ├─ Evaluate Access app migration                                           │
│  └─ WAF remains export+diff (complexity)                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Phase 1: Export + Visibility

**Goal:** Establish baseline visibility into current configuration.

| Task | Owner | Output |
|------|-------|--------|
| Create `cloudflare/` directory structure | Security Lead | Directory tree |
| Write DNS export script | Security Lead | `scripts/cf-export-dns.sh` |
| Write WAF export script | Security Lead | `scripts/cf-export-waf.sh` |
| Write Access export script | Security Lead | `scripts/cf-export-access.sh` |
| Export current production state | Security Lead | JSON files in `cloudflare/` |
| Create CI job for drift detection | Security Lead | `.github/workflows/cf-drift.yml` |
| Document export format | Security Lead | `cloudflare/README.md` |

**Directory Structure:**

```
cloudflare/
├── README.md                     # Format documentation
├── dns/
│   └── eventangle.com.json       # DNS records
├── waf/
│   ├── managed-rules.json        # Ruleset configuration
│   └── custom-rules.json         # Custom WAF rules
├── access/
│   ├── applications.json         # Access app definitions
│   └── policies.json             # Access policies
└── scripts/
    ├── export-all.sh             # Export all resources
    ├── diff-dns.sh               # Diff DNS against live
    └── diff-waf.sh               # Diff WAF against live
```

**Acceptance Criteria:**

- [ ] All DNS records exported to `cloudflare/dns/`
- [ ] WAF ruleset configuration exported to `cloudflare/waf/`
- [ ] Access app configuration exported to `cloudflare/access/`
- [ ] CI drift detection runs on schedule (daily)
- [ ] Drift alerts surface in GitHub Issues or Slack

### 5.3 Phase 2: Diff + Review

**Goal:** Establish PR workflow for configuration changes.

| Task | Owner | Output |
|------|-------|--------|
| Create PR template for CF changes | Security Lead | `.github/PULL_REQUEST_TEMPLATE/cloudflare.md` |
| Add CI diff preview to PRs | Security Lead | PR comment with proposed changes |
| Define approval requirements | Security Lead | CODEOWNERS for `cloudflare/` |
| Create manual apply runbook | Security Lead | `docs/runbooks/CF_SETTINGS_APPLY.md` |
| Test rollback procedure | Security Lead | Documented in runbook |

**PR Workflow:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         CLOUDFLARE CONFIG PR WORKFLOW                        │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Engineer creates branch with config changes                              │
│  2. CI: Export current live state                                            │
│  3. CI: Diff proposed vs live → Post as PR comment                           │
│  4. Required review from Security Lead or designated approver                │
│  5. Merge to main                                                            │
│  6. Engineer applies changes via dashboard (Phase 2) or CI (Phase 3+)        │
│  7. CI: Re-export to verify applied state matches committed                  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Acceptance Criteria:**

- [ ] PRs touching `cloudflare/` require Security Lead approval
- [ ] CI posts diff preview as PR comment
- [ ] Apply runbook documented and tested
- [ ] At least one config change successfully processed through PR workflow

### 5.4 Phase 3: Automated Apply (DNS Only)

**Goal:** Automate DNS changes while keeping WAF/Access manual.

| Task | Owner | Output |
|------|-------|--------|
| Create DNS apply script | Security Lead | `scripts/cf-apply-dns.sh` |
| Add apply step to CI | Security Lead | Conditional on `cloudflare/dns/` changes |
| Implement rollback automation | Security Lead | Git revert triggers re-apply |
| Document incident response | Security Lead | Update SECURITY_RUNBOOK.md |

**Safety Controls:**

| Control | Implementation |
|---------|----------------|
| Dry-run by default | CI shows plan, requires manual approval to apply |
| DNS-only scope | WAF and Access excluded from automated apply |
| Rate limiting | Max 10 record changes per CI run |
| Rollback path | Git revert triggers automatic re-apply |

**Acceptance Criteria:**

- [ ] DNS changes auto-apply on merge (with dry-run preview)
- [ ] Rollback tested via git revert
- [ ] WAF/Access remain manual apply
- [ ] No production incidents from automated DNS changes

### 5.5 Phase 4: Terraform Migration (Optional)

**Goal:** Evaluate Terraform for resources benefiting from state management.

**Decision Criteria:**

| Criterion | Threshold for Terraform |
|-----------|------------------------|
| Change frequency | >2 changes/month to resource type |
| Complexity | >20 resources of same type |
| Interdependencies | Resources reference each other |
| Team familiarity | At least one engineer Terraform-proficient |

**Candidate Resources:**

| Resource | Terraform Priority | Rationale |
|----------|-------------------|-----------|
| DNS Records | Medium | State prevents drift, but export+diff working |
| Access Apps | Low | Rare changes, high risk of state conflicts |
| WAF Rules | Not Recommended | Complex, rare changes, review-focused workflow |

**Terraform Prerequisites:**

- [ ] Remote state backend configured (Terraform Cloud or S3+DynamoDB)
- [ ] State locking enabled
- [ ] Import plan for existing resources
- [ ] Runbook for state recovery

---

## 6. PR Workflow and Ownership Model

### 6.1 CODEOWNERS

```
# cloudflare/ directory ownership
/cloudflare/                    @security-lead
/cloudflare/dns/                @security-lead @infra-lead
/cloudflare/waf/                @security-lead
/cloudflare/access/             @security-lead
```

### 6.2 Approval Requirements

| Change Type | Required Approvers | Rationale |
|-------------|-------------------|-----------|
| DNS: Add record | 1 from `@security-lead` or `@infra-lead` | Low risk |
| DNS: Modify proxied status | 1 from `@security-lead` | NS-1 compliance |
| DNS: Delete record | 1 from `@security-lead` | Potential outage |
| WAF: Any change | 1 from `@security-lead` | Security-critical |
| Access: Any change | 1 from `@security-lead` | Identity-critical (NS-2) |

### 6.3 Emergency Change Process

For urgent changes that cannot wait for PR review:

| Step | Action | Documentation |
|------|--------|---------------|
| 1 | Make change via dashboard | Required |
| 2 | Create retroactive PR within 24h | Required |
| 3 | Export new state to `cloudflare/` | Required |
| 4 | Document reason in PR description | Required |
| 5 | Security Lead review (post-facto) | Required |

### 6.4 Token Requirements

| Operation | Token Required | Reference |
|-----------|---------------|-----------|
| Export (read) | `CF_AUDIT_TOKEN` (read-only) | SEC-1.2 |
| Apply DNS | `CF_DNS_TOKEN` | SEC-1.2 |
| Apply WAF | Manual dashboard | No token (Phase 1-3) |
| Apply Access | Manual dashboard | No token (Phase 1-3) |

---

## 7. Risk Assessment

### 7.1 Implementation Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Automated apply causes outage | Medium | High | DNS-only scope, dry-run default |
| State drift between git and live | Medium | Medium | Daily drift detection CI |
| Export script misses resource | Low | Medium | Comprehensive API coverage testing |
| Token exposure in CI logs | Low | High | Secret masking, audit token for exports |

### 7.2 Non-Implementation Risks (Status Quo)

| Risk | Likelihood | Impact | Notes |
|------|------------|--------|-------|
| Unreviewed security changes | High | High | Current state |
| Configuration drift | High | Medium | No visibility |
| No rollback capability | High | Medium | Manual reconstruction |
| Audit trail gaps | Medium | Medium | 90-day CF log retention |

---

## 8. API Reference

### 8.1 Cloudflare API Endpoints

| Resource | List Endpoint | Export Complexity |
|----------|---------------|-------------------|
| DNS Records | `GET /zones/{zone_id}/dns_records` | Low |
| WAF Managed Rules | `GET /zones/{zone_id}/rulesets` | Medium |
| WAF Custom Rules | `GET /zones/{zone_id}/firewall/rules` | Medium |
| Access Applications | `GET /accounts/{account_id}/access/apps` | Medium |
| Access Policies | `GET /accounts/{account_id}/access/apps/{app_id}/policies` | Medium |

### 8.2 Export Script Template

```bash
#!/bin/bash
# scripts/cf-export-dns.sh

set -euo pipefail

ZONE_ID="${CF_ZONE_ID:?Zone ID required}"
API_TOKEN="${CF_AUDIT_TOKEN:?Audit token required}"

curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  | jq '.result | sort_by(.name)' \
  > cloudflare/dns/eventangle.com.json
```

---

## 9. Success Metrics

| Metric | Phase 1 Target | Phase 3 Target |
|--------|----------------|----------------|
| Config changes with PR review | 50% | 95% |
| Mean time to detect drift | 24h | 4h |
| Emergency (dashboard) changes | Baseline | <10% of total |
| Rollback time (DNS) | Manual | <5 min |
| Security review coverage | WAF/Access only | All CF config |

---

## 10. Acceptance Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| **AC-1** | Plan is staged (4 phases) | This document |
| **AC-2** | Terraform vs export+diff recommendation provided | Section 3 |
| **AC-3** | Minimum viable scope defined (DNS, routes, rulesets, Access) | Section 4 |
| **AC-4** | PR workflow documented | Section 6 |
| **AC-5** | Ownership model defined (CODEOWNERS) | Section 6.1 |
| **AC-6** | Plan doesn't "boil the ocean" | Phase 1 is export+visibility only |

---

## 11. Related Documents

| Document | Relationship |
|----------|--------------|
| SEC-0.1 SECURITY_BASELINE.md | North Star invariants |
| SEC-1.2 CF_API_TOKENS_POLICY.md | Token scoping for export/apply |
| SEC-6.1 WAF_BASELINE.md | WAF configuration to export |
| SEC-IAC-03 CLOUDFLARE_ACCESS_PRIVILEGED.md | Access apps to export |
| SEC-10.1 SECURITY_REGRESSION_GATE.md | CI integration patterns |

---

## 12. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-05 | Director of Security | Initial plan |
