# Live Chat Training — Content Map

> Maps all documentation to training suitability for the live chat / documentation assistant.
> Organized by **audience** (who asks) and **value tier** (what to train first).

---

## Audience Dimensions

The chat assistant serves 3 distinct audiences. Each needs different knowledge:

| Audience | Questions They Ask | Primary Sources |
|----------|-------------------|-----------------|
| **End Users** (attendees) | "How do I register?", "What happens with my email?", "Why can't I submit the survey?" | Feature docs, error reference, surfaces |
| **Admins** (organizers) | "How do I see registrations?", "How do I enable surveys?", "What tier do I need?" | Feature docs, tiers, admin API, auth |
| **Internal** (dev/ops/support) | "How do I deploy?", "What's the DB schema?", "How do I rotate secrets?" | Architecture, runbooks, deployment, security |

---

## Tier 1: Feature Knowledge — Train First

> **What the product does.** This is the highest-value training content because it answers
> the most common user questions directly.

### End User + Admin Features (9 docs)

| Document | Audience | Answers Questions Like... |
|----------|----------|--------------------------|
| `docs/features/FORMS.md` | End user, Admin | "How do I register?", "What data do you collect?", "How does check-in work?" |
| `docs/features/QR-ROUTING.md` | End user, Admin | "What happens when I scan the QR code?", "How do I get the form link?" |
| `docs/features/SURFACES.md` | End user, Admin | "What pages are there?", "What does the admin dashboard show?" |
| `docs/features/EVENTS.md` | End user, Admin | "How do I see events?", "What info is on an event?" |
| `docs/features/TIERS.md` | Admin, Sales | "What do I get on Free?", "How do I upgrade?", "What features need Enterprise?" |
| `docs/features/PRIVACY.md` | End user, Admin, Compliance | "What happens with my data?", "How long do you keep emails?", "Is data encrypted?" |
| `docs/features/BRANDS.md` | Admin, Sales | "Can I have my own brand?", "How does multi-tenant work?" |
| `docs/features/AUTH.md` | Admin, DevOps | "How do I access admin?", "What's the Bearer token?" |
| `docs/features/ERROR-REFERENCE.md` | End user, Support | "Why am I getting 403?", "What does DB_ERROR mean?", "The form won't submit" |

### Core Architecture (8 docs)

| Document | Audience | Answers Questions Like... |
|----------|----------|--------------------------|
| `README.md` | All | "What is ourSharedEvents?", "How does it work?" |
| `docs/architecture/ARCHITECTURE.md` | Internal | "What's the system architecture?", "How do components connect?" |
| `docs/architecture/API_CONTRACT.md` | Internal, Admin | "What are the API endpoints?", "What's the request/response format?" |
| `docs/architecture/EVENT_CONTRACT.md` | Internal | "What's the event data model?" |
| `docs/architecture/FRIENDLY_URLS.md` | End user, Admin | "What URL do I use?", "How do brand URLs work?" |
| `docs/mvp/MVP_SCOPE.md` | Internal, Admin | "What's included in the MVP?", "What's coming next?" |
| `docs/mvp/MVP_SURFACES.md` | Internal, Admin | "What are the 5 surfaces?", "What does each page do?" |
| `docs/support/ERROR_HANDLING_GUIDE.md` | Support | "User reported an error — how do I investigate?" |

---

## Tier 2: Operational Knowledge — Train Second

> **How to operate the system.** Answers questions from admins, support staff, and internal ops.

### Ops & Support (12 docs)

| Document | Audience | Topic |
|----------|----------|-------|
| `docs/architecture/worker-routing.md` | Internal | Route design and request flow |
| `docs/architecture/INTEGRATION-FLOWS.md` | Internal | Integration patterns |
| `docs/architecture/ci-cd-architecture.md` | Internal | CI/CD pipeline design |
| `docs/runbooks/RUNBOOK.md` | Internal | Master operational runbook |
| `docs/runbooks/RUNBOOK-DEPLOYMENT.md` | Internal | How to deploy |
| `docs/runbooks/RUNBOOK-SECRETS.md` | Internal | How to rotate secrets |
| `docs/runbooks/ROLLBACK.md` | Internal | Rollback procedure |
| `docs/deployment/DEPLOYMENT.md` | Internal | Deployment architecture |
| `docs/deployment/STAGING_SETUP.md` | Internal | Staging setup |
| `docs/deployment/ENVIRONMENT_MATRIX.md` | Internal | Env comparison |
| `docs/monitoring/SYNTHETIC_MONITORING.md` | Internal | Monitoring setup |
| `docs/env/GOOGLE_SERVICE_ACCOUNT_SETUP.md` | Internal | GCP setup |

### Security Fundamentals (8 docs)

| Document | Audience | Topic |
|----------|----------|-------|
| `docs/security/SECURITY.md` | Internal | Security overview |
| `docs/security/ROUTE_CLASSIFICATION_POLICY.md` | Internal | Which routes need auth |
| `docs/security/SERVICE_AUTH_PATTERN.md` | Internal | Auth implementation |
| `docs/security/SECRETS_POLICY.md` | Internal | Secrets management |
| `docs/security/LOGGING_STANDARD.md` | Internal | Structured logging |
| `docs/security/RATE_LIMITING_SPEC.md` | Internal, Support | Rate limiting rules |
| `docs/security/BOT_CONTROLS_BASELINE.md` | Internal, Support | Bot management |
| `docs/security/WAF_BASELINE.md` | Internal, Support | WAF rules |

### QA & Testing (4 docs)

| Document | Audience | Topic |
|----------|----------|-------|
| `docs/qa/QA-FLOWS.md` | Internal | QA workflows |
| `docs/qa/E2E_PLAYWRIGHT_GUIDE.md` | Internal | E2E test guide |
| `docs/qa/QA-ADMIN-QUICK-START.md` | Internal | Admin QA quick start |
| `docs/mvp/QUICK_REFERENCE.md` | Internal | Quick reference card |

---

## Tier 3: Reference Knowledge — Train Selectively

> **Point-in-time records and procedural docs.** Useful for edge cases.

| Category | File Count | Audience | Use Selectively For |
|----------|-----------|----------|---------------------|
| `docs/migration/` | 3 | Internal | Phase transition questions |
| `docs/security/` (hardening runbooks) | ~15 | Internal | "Why is this request blocked?" infra questions |
| `docs/runbooks/RUNBOOK-SEC-*` | 8 | Internal | Security setup procedures |
| `docs/deployment/` (migration-specific) | 4 | Internal | Migration procedure questions |
| `docs/audits/` | 5 | Internal | Audit pattern reference |
| `docs/verification/` | 7 | Internal | Milestone verification records |
| `docs/architecture/` (remaining) | ~7 | Internal | Deep architecture reference |
| `CLAUDE.md` | Internal | Full project context |
| `CONTRIBUTING.md` | Internal | Contribution guide |

---

## Tier 4: Archive Only — Do Not Train

| Category | File Count | Reason |
|----------|-----------|--------|
| `archive/analysis-reports/` | 89 | Historical analysis — superseded |
| `archive/v2-docs/` | 35 | Legacy v2 docs — superseded |
| `archive/v2-code/` | 25 | Legacy code — not deployed |
| `archive/gas/` | 16 | Legacy GAS — being migrated |
| `archive/experimental-*` | 14 | Prototypes — not production |
| `archive/postman/` | 6 | Legacy test collections |
| `archive/hostinger-proxy/` | 5 | Fully deprecated |

---

## Training Corpus Summary

| Tier | Files | Training Strategy | Primary Audience |
|------|-------|-------------------|------------------|
| **Tier 1: Features** | ~17 | Full ingestion — feature knowledge + core architecture | End users, Admins, Support |
| **Tier 2: Operations** | ~24 | Full ingestion — operational + security + QA | Internal ops, Support |
| **Tier 3: Reference** | ~50 | Selective — edge cases and deep dives | Internal only |
| **Tier 4: Archive** | ~190 | Skip — frozen reference | Nobody |

### Recommended Training Order

```
Phase 1: Feature docs (docs/features/*.md)
   ↓  The chat can now answer: "How do I register?", "What tier has surveys?",
   ↓  "Why am I getting 403?", "How does privacy work?"
Phase 2: Core architecture (README, ARCHITECTURE, API_CONTRACT, FRIENDLY_URLS)
   ↓  The chat can now answer: "What's the API?", "How do URLs work?"
Phase 3: Ops knowledge (runbooks, deployment, security fundamentals)
   ↓  The chat can now answer: "How do I deploy?", "How do I rotate secrets?"
Phase 4: Reference (selectively, for edge cases)
```

---

## Content Refresh Cadence

| Tier | Refresh When |
|------|-------------|
| Tier 1 | After any feature change, new form type, tier update, or surface change |
| Tier 2 | After deployment procedure or security policy changes |
| Tier 3 | After new audits, verification milestones, or migration phases |
| Tier 4 | Never — archive is frozen |

---

## Audience-Specific Training Sets

For targeted chat assistants serving only one audience:

### End-User Chat (minimum viable training set — 6 docs)
1. `docs/features/FORMS.md`
2. `docs/features/QR-ROUTING.md`
3. `docs/features/SURFACES.md`
4. `docs/features/EVENTS.md`
5. `docs/features/PRIVACY.md`
6. `docs/features/ERROR-REFERENCE.md`

### Admin Chat (+ 4 more docs = 10 total)
All end-user docs plus:
7. `docs/features/TIERS.md`
8. `docs/features/BRANDS.md`
9. `docs/features/AUTH.md`
10. `docs/architecture/API_CONTRACT.md`

### Internal Support Chat (full Tier 1 + Tier 2 = ~41 docs)
All admin docs plus Tier 2 operational and security docs.
