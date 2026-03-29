# Documentation Index

> Master navigation for all ourSharedEvents documentation.
> Organized for developers, operators, and the live-chat training corpus.

---

## How to Use This Index

| Audience | Start Here |
|----------|-----------|
| **New developer** | [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) then [mvp/QUICK_REFERENCE.md](mvp/QUICK_REFERENCE.md) |
| **Deploying** | [deployment/DEPLOYMENT.md](deployment/DEPLOYMENT.md) then [runbooks/RUNBOOK-DEPLOYMENT.md](runbooks/RUNBOOK-DEPLOYMENT.md) |
| **QA / Testing** | [qa/QA-FLOWS.md](qa/QA-FLOWS.md) then [qa/E2E_PLAYWRIGHT_GUIDE.md](qa/E2E_PLAYWRIGHT_GUIDE.md) |
| **Security review** | [security/SECURITY.md](security/SECURITY.md) then [security/SECURITY_BASELINE.md](security/SECURITY_BASELINE.md) |
| **Understanding the product** | [mvp/MVP_SCOPE.md](mvp/MVP_SCOPE.md) then [mvp/MVP_SURFACES.md](mvp/MVP_SURFACES.md) |

---

## Directory Map

### [`architecture/`](architecture/) — System Design & Contracts (20 files)

Core technical decisions, API contracts, and integration patterns.

| File | Description |
|------|------------|
| ARCHITECTURE.md | System architecture overview |
| API_CONTRACT.md | Public + admin API specification |
| EVENT_CONTRACT.md | Event data model contract |
| SCHEMA_GUIDELINES.md | Data schema conventions |
| CODING-STYLE.md | Code style and conventions |
| INTEGRATION-FLOWS.md | End-to-end integration flows |
| integration-map.md | Service integration map |
| worker-routing.md | Cloudflare Worker route design |
| ci-cd-architecture.md | CI/CD pipeline architecture |
| PAGES.md | HTML surface page architecture |
| FRIENDLY_URLS.md | URL design and routing |
| APPS_SCRIPT_PROJECT.md | Google Apps Script project structure |
| BASELINE.md | Architectural baseline |
| DATA_POLICY.md | Data handling policy |
| IMPLEMENTATION_GUIDE.md | Implementation patterns |
| ARCHITECT-CHECKLIST.md | Architecture review checklist |
| VISUAL_FLOW_COMPARISON.md | Visual flow diagrams |
| origins.md | Origin server configuration |

### [`security/`](security/) — Security Baselines & Policies (28 files)

Hardening runbooks, access control, and security configurations.

| File | Description |
|------|------------|
| SECURITY.md | Security overview |
| SECURITY_BASELINE.md | Security baseline requirements |
| SECURITY_RUNBOOK.md | Security incident runbook |
| CF_ACCOUNT_HARDENING_RUNBOOK.md | Cloudflare account hardening |
| CF_API_TOKENS_POLICY.md | API token scoping policy |
| CF_ZONE_CONFIG_BASELINE.md | Zone configuration baseline |
| CLOUDFLARE_ACCESS_PRIVILEGED.md | Privileged access controls |
| SECRETS_POLICY.md | Secrets management policy |
| CI_SECRET_NAMING.md | CI secret naming conventions |
| CI_DEPLOY_HARDENING.md | CI/CD deploy hardening |
| TLS_STRICT_BASELINE.md | TLS configuration |
| HSTS_ROLLOUT.md | HSTS phased rollout |
| DNSSEC_RUNBOOK.md | DNSSEC configuration |
| CANONICAL_HOST_SPEC.md | Canonical host enforcement |
| ORIGIN_BYPASS_PREVENTION.md | Origin bypass prevention |
| WAF_BASELINE.md | WAF rule baseline |
| BOT_CONTROLS_BASELINE.md | Bot management |
| RATE_LIMITING_SPEC.md | Rate limiting specification |
| ROUTE_CLASSIFICATION_POLICY.md | Route auth classification |
| SERVICE_AUTH_PATTERN.md | Service authentication pattern |
| REGISTRAR_HARDENING_CHECKLIST.md | Domain registrar hardening |
| WORKER_ROUTE_COLLAPSE_RUNBOOK.md | Worker route consolidation |
| WORKER_VARS_AUDIT.md | Worker environment variable audit |
| GAS_EDGE_PROOF_GATE.md | GAS edge proof gate |
| NO_GAS_GUARD.md | No-GAS guard pattern |
| LOGGING_STANDARD.md | Structured logging standard |
| SETTINGS_AS_CODE_PLAN.md | Settings-as-code plan |

### [`runbooks/`](runbooks/) — Operational Runbooks (15 files)

Step-by-step procedures for deployment, debugging, and incident response.

| File | Description |
|------|------------|
| RUNBOOK.md | Master operational runbook |
| RUNBOOK-DEPLOYMENT.md | Deployment procedure |
| RUNBOOK-CI-DEBUG.md | CI pipeline debugging |
| RUNBOOK-LOCAL-TESTING.md | Local development testing |
| RUNBOOK-SECRETS.md | Secrets rotation procedure |
| ROLLBACK.md | Rollback procedure |
| RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md | Cloudflare account setup |
| RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md | Scoped API token setup |
| RUNBOOK-SEC-2.1-REGISTRAR-LOCK-MFA.md | Registrar lock + MFA |
| RUNBOOK-SEC-2.2-DNSSEC.md | DNSSEC enablement |
| RUNBOOK-SEC-3.1-STRICT-TLS.md | Strict TLS setup |
| RUNBOOK-SEC-3.2-HSTS-PHASED.md | HSTS phased rollout |
| RUNBOOK-SEC-4.1-CANONICAL-HOST.md | Canonical host setup |
| RUNBOOK-SEC-4.2-SINGLE-WORKER-ROUTE.md | Single worker route setup |

### [`deployment/`](deployment/) — Deploy & Infrastructure (12 files)

Deployment guides, environment setup, and migration procedures.

| File | Description |
|------|------------|
| DEPLOYMENT.md | Deployment overview |
| PRODUCTION_DEPLOYMENT_POLICY.md | Production deploy policy |
| STAGING_SETUP.md | Staging environment setup |
| ENVIRONMENT_MATRIX.md | Environment comparison matrix |
| CLOUDFLARE_SECRETS.md | Cloudflare secrets reference |
| CLOUDFLARE_WORKER_MIGRATION.md | Worker migration guide |
| DNS_CUTOVER.md | DNS cutover procedure |
| GAS-TO-CLOUDFLARE-MIGRATION.md | GAS to Cloudflare migration |
| KV_TEMPLATES_SETUP.md | KV template configuration |
| MIGRATION_EPICS.md | Migration epic breakdown |
| SETUP_DIAGNOSTICS.md | Setup diagnostic procedures |

### [`qa/`](qa/) — Testing & Quality Assurance (10 files)

Test strategies, E2E guides, and test data management.

| File | Description |
|------|------------|
| QA-FLOWS.md | QA workflow documentation |
| QA-ADMIN-QUICK-START.md | Admin QA quick start |
| QA_ENVIRONMENT_MANAGEMENT.md | Test environment management |
| E2E_PLAYWRIGHT_GUIDE.md | Playwright E2E guide |
| E2E-LAUNCH.md | E2E launch checklist |
| E2E_TEST_DATA.md | E2E test data reference |
| TEST_MATRIX.md | Test coverage matrix |
| TEST_FAILURE_ANALYSIS.md | Test failure analysis |
| NEGATIVE_TEST_PLAN.md | Negative test plan |

### [`monitoring/`](monitoring/) — Observability & Performance (4 files)

Monitoring setup, uptime checks, and performance baselines.

| File | Description |
|------|------------|
| SYNTHETIC_MONITORING.md | Synthetic monitoring setup |
| UPTIME_MONITORING.md | Uptime monitoring configuration |
| ENVIRONMENT_PARITY_REPORT.md | Environment parity report |
| PERFORMANCE_NOTES.md | Performance observations |

### [`mvp/`](mvp/) — MVP Scope & Surfaces (6 files)

MVP definition, surface specs, and production readiness.

| File | Description |
|------|------------|
| MVP_SCOPE.md | MVP feature scope |
| MVP_SURFACES.md | 5 MVP surface specifications |
| MVP-FILE-MAP.md | MVP file map |
| MVP-PRODUCTION-READINESS-EVALUATION.md | Production readiness eval |
| README_MVP.md | MVP readme |
| QUICK_REFERENCE.md | Quick reference card |

### [`migration/`](migration/) — Phase Migration Guides (3 files)

Phase-by-phase migration documentation.

| File | Description |
|------|------------|
| PHASE-1-OURSHAREDEVENTS.md | Phase 1: Cloudflare + Sheets |
| PHASE-2-D1-DATABASE.md | Phase 2: D1 edge database |
| PHASE-3-FIREBASE.md | Phase 3: Firebase auth + hosting |

### [`stories/`](stories/) — Epics & Stories (4 files)

Development epic and story specifications.

| File | Description |
|------|------------|
| EPIC-A11Y-ACCESSIBILITY-AUDIT.md | Accessibility audit epic |
| EPIC-ADMIN-PAGE-EVALUATION.md | Admin page evaluation epic |
| STORY-A2-OBSERVABILITY.md | Observability story spec |
| STORY-SCHEMA-TRIANGLE.md | Triangle schema story |

### [`audits/`](audits/) — Audit Reports (5 files)

System, frontend, and design audit results.

| File | Description |
|------|------------|
| FULL_SYSTEM_AUDIT_2025_11_23.md | Full system audit (Nov 2025) |
| DESIGNER_AUDIT_2025-11-23.md | Designer audit (Nov 2025) |
| FRONTEND_AUDIT_2025-11-23.md | Frontend audit (Nov 2025) |
| CCR_SHARED_REPORT_AUDIT.md | Shared report audit |
| SHARED_REPORT_DEEP_DIVE.md | Shared report deep dive |

### [`verification/`](verification/) — Verification & Signoff (7 files)

Milestone verification reports and staging signoff.

| File | Description |
|------|------------|
| VERIFIED-FACT-BASE.md | Verified fact base |
| GAS_BACKEND_VERIFICATION_M1.md | M1: GAS backend verification |
| WORKER_GAS_WIRING_VERIFICATION_M2.md | M2: Worker-GAS wiring |
| STORY_M3_EVENTS_RENDERING_VERIFICATION.md | M3: Events rendering |
| PO_SIGNOFF_STAGING_PARITY.md | PO staging parity signoff |
| STAGING_EVENTS_DIAGNOSIS.md | Staging events diagnosis |
| STAGING_GAS_PERMISSIONS.md | Staging GAS permissions |

### [`env/`](env/) — Environment Configuration (4 files)

| File | Description |
|------|------------|
| GOOGLE_SERVICE_ACCOUNT_SETUP.md | Google SA setup guide |
| gas-projects.md | GAS project references |
| staging-migration.md | Staging migration notes |
| staging.md | Staging environment details |

### [`support/`](support/) — Support & Troubleshooting (1 file)

| File | Description |
|------|------------|
| ERROR_HANDLING_GUIDE.md | Error handling patterns |

---

## Other Documentation Locations

| Location | Contents |
|----------|---------|
| [`/CLAUDE.md`](../CLAUDE.md) | AI assistant persistent brain — project context |
| [`/STORIES.md`](../STORIES.md) | Story registry and work queue |
| [`/CONTRIBUTING.md`](../CONTRIBUTING.md) | Contribution guidelines |
| [`/specs/`](../specs/) | Structured specs (JSON, YAML, MMD) |
| [`/.claude/`](../.claude/) | Claude workspace config and skills |
| [`/archive/`](../archive/) | Historical docs, legacy code, analysis reports |
| [`/tests/`](../tests/) | Test framework documentation |

---

## For Live Chat Training

Documents are tagged by training suitability in [`chat-training/CONTENT-MAP.md`](chat-training/CONTENT-MAP.md).
High-value training documents are those that explain **how things work** (architecture, flows, contracts) vs. those that record **point-in-time state** (audits, verification reports).
