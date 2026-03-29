# Live Chat Training — Content Map

> Maps documentation to training suitability for the live chat / documentation assistant.
> Documents are rated by training value: how well they teach the system vs. record point-in-time state.

---

## Training Value Tiers

### Tier 1: High Value — Core Knowledge (train first)

These documents explain **how the system works** and are stable over time.

| Document | Topic | Why High Value |
|----------|-------|---------------|
| `docs/architecture/ARCHITECTURE.md` | System architecture | Explains the full system design |
| `docs/architecture/API_CONTRACT.md` | API specification | Defines all public + admin endpoints |
| `docs/architecture/EVENT_CONTRACT.md` | Event data model | Core data structure definition |
| `docs/architecture/INTEGRATION-FLOWS.md` | Integration patterns | How components connect |
| `docs/architecture/worker-routing.md` | Route design | How requests flow through the Worker |
| `docs/architecture/SCHEMA_GUIDELINES.md` | Schema conventions | Data modeling rules |
| `docs/architecture/CODING-STYLE.md` | Code conventions | How code should be written |
| `docs/architecture/PAGES.md` | Surface architecture | How HTML surfaces work |
| `docs/security/SECURITY.md` | Security overview | Security model explanation |
| `docs/security/ROUTE_CLASSIFICATION_POLICY.md` | Auth classification | Which routes need what auth |
| `docs/security/SERVICE_AUTH_PATTERN.md` | Auth patterns | How authentication works |
| `docs/security/SECRETS_POLICY.md` | Secrets management | How secrets are handled |
| `docs/security/LOGGING_STANDARD.md` | Logging patterns | How structured logging works |
| `docs/migration/PHASE-1-OURSHAREDEVENTS.md` | Phase 1 design | Current architecture rationale |
| `docs/migration/PHASE-2-D1-DATABASE.md` | Phase 2 plan | D1 migration design |
| `docs/migration/PHASE-3-FIREBASE.md` | Phase 3 plan | Firebase integration design |
| `docs/mvp/MVP_SCOPE.md` | Product scope | What the MVP includes |
| `docs/mvp/MVP_SURFACES.md` | Surface specs | 5 MVP surface definitions |
| `docs/architecture/DATA_POLICY.md` | Data handling | Privacy and data rules |
| `docs/support/ERROR_HANDLING_GUIDE.md` | Error patterns | How errors are handled |
| `CLAUDE.md` | Project context | Full project brain |
| `README.md` | Project overview | Entry point for all understanding |
| `CONTRIBUTING.md` | Contribution guide | How to contribute |

### Tier 2: Medium Value — Operational Knowledge (train second)

These documents explain **how to operate** the system. Useful for support and troubleshooting.

| Document | Topic | Why Medium Value |
|----------|-------|-----------------|
| `docs/runbooks/RUNBOOK.md` | Master runbook | Operational procedures |
| `docs/runbooks/RUNBOOK-DEPLOYMENT.md` | Deploy procedure | How to deploy |
| `docs/runbooks/RUNBOOK-SECRETS.md` | Secrets rotation | How to rotate secrets |
| `docs/runbooks/ROLLBACK.md` | Rollback procedure | How to rollback |
| `docs/deployment/DEPLOYMENT.md` | Deploy overview | Deployment architecture |
| `docs/deployment/STAGING_SETUP.md` | Staging setup | How staging works |
| `docs/deployment/CLOUDFLARE_SECRETS.md` | CF secrets | Cloudflare secret reference |
| `docs/deployment/ENVIRONMENT_MATRIX.md` | Env comparison | Environment differences |
| `docs/qa/QA-FLOWS.md` | QA workflows | How to test |
| `docs/qa/E2E_PLAYWRIGHT_GUIDE.md` | E2E guide | How E2E tests work |
| `docs/qa/QA-ADMIN-QUICK-START.md` | Admin QA | How to QA admin surface |
| `docs/monitoring/SYNTHETIC_MONITORING.md` | Monitoring | How monitoring works |
| `docs/monitoring/UPTIME_MONITORING.md` | Uptime | Uptime check setup |
| `docs/mvp/QUICK_REFERENCE.md` | Quick ref | Fast lookup card |
| `docs/architecture/ci-cd-architecture.md` | CI/CD design | Pipeline architecture |
| `docs/env/GOOGLE_SERVICE_ACCOUNT_SETUP.md` | GCP setup | Google SA configuration |

### Tier 3: Low Value — Point-in-Time Records (train last or skip)

These documents record **specific states** that may be outdated. Use selectively.

| Category | File Count | Reason |
|----------|-----------|--------|
| `docs/audits/` | 5 | Snapshot audits — useful for patterns, not current state |
| `docs/verification/` | 7 | Milestone verification — historical record |
| `docs/security/` (hardening runbooks) | ~15 | Procedural — useful only if infra matches |
| `docs/runbooks/RUNBOOK-SEC-*` | 8 | Security setup procedures — infra-dependent |
| `docs/deployment/` (migration-specific) | 4 | Migration procedures — one-time use |

### Tier 4: Archive Only — Do Not Train

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

| Tier | Files | Training Strategy |
|------|-------|-------------------|
| **Tier 1** | ~23 | Full ingestion — core knowledge base |
| **Tier 2** | ~16 | Full ingestion — operational knowledge |
| **Tier 3** | ~35 | Selective ingestion — extract patterns only |
| **Tier 4** | ~190 | Skip — archive reference only |

**Recommended training order**: Tier 1 (architecture + contracts) → Tier 2 (operations) → Tier 3 (selectively, for edge cases)

---

## Content Refresh Cadence

| Tier | Refresh When |
|------|-------------|
| Tier 1 | After any architecture change or phase transition |
| Tier 2 | After deployment procedure changes |
| Tier 3 | After new audits or verification milestones |
| Tier 4 | Never — archive is frozen |
