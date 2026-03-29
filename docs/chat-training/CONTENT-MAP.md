# Live Chat Training — Content Map

> Maps all documentation to training suitability for the live chat / documentation assistant.
> Organized by **audience** (Triangle vertices) and **value tier** (what to train first).

---

## Audience Model — The Triangle

The platform serves 3 primary audiences that mirror the Triangle data model:

```
       Admins (Event Organizers)
          /           \
         /    Events   \
        /               \
  Sponsors ──────── Customers
  (Brands)           (Attendees)
```

### Primary Audiences (Now)

| Audience | Role | Questions They Ask |
|----------|------|-------------------|
| **Customers** | Attendees, community members | "How do I register?", "What events are happening?", "What happens with my email?", "Why can't I submit?" |
| **Sponsors** | Brands supporting events | "How do I see my placement performance?", "What attribution data do I get?", "How do I sponsor an event?", "What branding options exist?" |
| **Admins** | Event organizers, league operators | "How do I see registrations?", "How do I enable surveys?", "What tier do I need?", "How do I manage multiple brands?" |

### Future Audiences (Roadmap)

| Audience | Role | When |
|----------|------|------|
| **Government** | Municipal partners, parks departments | When civic event partnerships launch |
| **Policy** | Compliance officers, data governance | When data sharing agreements formalized |
| **Public Services** | Libraries, community centers, nonprofits | When public-sector event hosting launches |
| **Researchers** | ourEventRings analysts, academics | When research data APIs are built |

---

## Tier 1: Feature Knowledge — Train First

> **What the product does.** Highest-value training content. Answers the most common
> questions from all 3 audiences directly.

### Customer-Facing Features

| Document | Answers Questions Like... |
|----------|--------------------------|
| `docs/features/FORMS.md` | "How do I register?", "What data do you collect?", "How does check-in work?", "What's the survey for?" |
| `docs/features/QR-ROUTING.md` | "I scanned a QR code, what now?", "How do I get to the form?", "What if the QR code doesn't work?" |
| `docs/features/SURFACES.md` | "What pages can I visit?", "Where do I see events?", "How do I sign up for updates?" |
| `docs/features/EVENTS.md` | "What events are happening?", "How do I find events near me?", "What info is on an event?" |
| `docs/features/PRIVACY.md` | "What happens with my email?", "How long do you keep my data?", "Is my info encrypted?" |
| `docs/features/ERROR-REFERENCE.md` | "Why am I getting an error?", "The form won't submit", "The page won't load" |

### Sponsor-Facing Features

| Document | Answers Questions Like... |
|----------|--------------------------|
| `docs/features/EVENTS.md` | "How are events structured?", "What's the event data model?", "How do brands connect to events?" |
| `docs/features/BRANDS.md` | "How does multi-brand work?", "Can I have my own branded experience?", "What's white-label?" |
| `docs/features/TIERS.md` | "What analytics do I get?", "What's in the Enterprise tier?", "Can I get custom reports?" |
| `docs/features/SURFACES.md` | "What does the shared report show?", "Where do sponsors appear?", "What's the display surface?" |
| `docs/features/PRIVACY.md` | "What attendee data can I access?", "How is attribution tracked?", "What PII do you share?" |

### Admin-Facing Features

| Document | Answers Questions Like... |
|----------|--------------------------|
| `docs/features/TIERS.md` | "How do I enable surveys?", "What's the difference between tiers?", "How do I apply Enterprise?" |
| `docs/features/FORMS.md` | "How do I see registration counts?", "Where are the survey results?", "How do email signups work?" |
| `docs/features/QR-ROUTING.md` | "How do I generate QR codes?", "How do I link a form to an event?", "What test-IDs exist?" |
| `docs/features/BRANDS.md` | "How do I set up a new brand?", "How does brand isolation work?", "Can sponsors have their own domain?" |
| `docs/features/AUTH.md` | "How do I access admin?", "What's the Bearer token?", "How does Cloudflare Access work?" |
| `docs/features/ERROR-REFERENCE.md` | "Why is the form disabled?", "What does 503 mean?", "Health check is failing" |

### Core Knowledge (All Audiences)

| Document | Audience | Answers Questions Like... |
|----------|----------|--------------------------|
| `README.md` | All | "What is ourSharedEvents?", "How does it work?", "What's the ecosystem?" |
| `docs/architecture/API_CONTRACT.md` | Admin, Sponsor | "What are the API endpoints?", "How do I integrate?" |
| `docs/architecture/FRIENDLY_URLS.md` | Customer, Admin | "What URL do I use?", "How do brand URLs work?" |
| `docs/mvp/MVP_SCOPE.md` | Admin, Sponsor | "What's available now?", "What's coming next?" |
| `docs/support/ERROR_HANDLING_GUIDE.md` | Admin, Support | "User reported an error — how do I investigate?" |

---

## Tier 2: Operational Knowledge — Train Second

> **How to operate the system.** Primarily for Admins and internal support,
> but Sponsors may need some of this for integration.

### Platform Operations (12 docs)

| Document | Audience | Topic |
|----------|----------|-------|
| `docs/architecture/ARCHITECTURE.md` | Admin, Internal | System architecture overview |
| `docs/architecture/worker-routing.md` | Internal | Route design and request flow |
| `docs/architecture/INTEGRATION-FLOWS.md` | Internal, Sponsor | Integration patterns |
| `docs/architecture/ci-cd-architecture.md` | Internal | CI/CD pipeline design |
| `docs/runbooks/RUNBOOK.md` | Internal | Master operational runbook |
| `docs/runbooks/RUNBOOK-DEPLOYMENT.md` | Internal | How to deploy |
| `docs/runbooks/RUNBOOK-SECRETS.md` | Internal | How to rotate secrets |
| `docs/runbooks/ROLLBACK.md` | Internal | Rollback procedure |
| `docs/deployment/DEPLOYMENT.md` | Internal | Deployment architecture |
| `docs/deployment/STAGING_SETUP.md` | Internal | Staging setup |
| `docs/deployment/ENVIRONMENT_MATRIX.md` | Internal | Env comparison |
| `docs/monitoring/SYNTHETIC_MONITORING.md` | Internal | Monitoring setup |

### Security Fundamentals (8 docs)

| Document | Audience | Topic |
|----------|----------|-------|
| `docs/security/SECURITY.md` | Internal, Admin | Security overview |
| `docs/security/ROUTE_CLASSIFICATION_POLICY.md` | Internal | Which routes need auth |
| `docs/security/SERVICE_AUTH_PATTERN.md` | Internal | Auth implementation |
| `docs/security/SECRETS_POLICY.md` | Internal | Secrets management |
| `docs/security/LOGGING_STANDARD.md` | Internal | Structured logging |
| `docs/security/RATE_LIMITING_SPEC.md` | Admin, Support | Rate limiting rules — "why is my request blocked?" |
| `docs/security/BOT_CONTROLS_BASELINE.md` | Admin, Support | Bot management — "my form submission was rejected" |
| `docs/security/WAF_BASELINE.md` | Admin, Support | WAF rules — "my API call is blocked" |

### QA & Testing (4 docs)

| Document | Audience | Topic |
|----------|----------|-------|
| `docs/qa/QA-FLOWS.md` | Internal | QA workflows |
| `docs/qa/E2E_PLAYWRIGHT_GUIDE.md` | Internal | E2E test guide |
| `docs/qa/QA-ADMIN-QUICK-START.md` | Internal | Admin QA quick start |
| `docs/mvp/QUICK_REFERENCE.md` | Internal | Quick reference card |

---

## Tier 3: Reference Knowledge — Train Selectively

> **Point-in-time records and deep reference.** Useful for edge cases.

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
| `docs/env/` | 4 | Internal | Environment configuration |

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

| Tier | Files | Training Strategy | Primary Audiences |
|------|-------|-------------------|-------------------|
| **Tier 1: Features** | ~22 | Full ingestion — feature knowledge + core | Customers, Sponsors, Admins |
| **Tier 2: Operations** | ~24 | Full ingestion — ops + security + QA | Admins, Internal |
| **Tier 3: Reference** | ~50 | Selective — edge cases and deep dives | Internal only |
| **Tier 4: Archive** | ~190 | Skip — frozen reference | Nobody |

---

## Audience-Specific Training Sets

For targeted chat assistants serving a single audience:

### Customer Chat (attendee-facing — 7 docs)

The minimum set to answer any attendee question:

1. `docs/features/FORMS.md` — how to register, check in, survey, email signup
2. `docs/features/QR-ROUTING.md` — what happens when they scan a QR code
3. `docs/features/SURFACES.md` — what pages exist and what they do
4. `docs/features/EVENTS.md` — how to find and view events
5. `docs/features/PRIVACY.md` — what happens with their data
6. `docs/features/ERROR-REFERENCE.md` — why something isn't working
7. `docs/architecture/FRIENDLY_URLS.md` — what URL to use

### Sponsor Chat (brand-facing — 9 docs)

Everything a sponsor needs to understand the platform and their data:

1. `docs/features/EVENTS.md` — event structure and the Triangle model
2. `docs/features/BRANDS.md` — multi-brand isolation and white-label
3. `docs/features/TIERS.md` — what's available at each tier, analytics
4. `docs/features/SURFACES.md` — shared report, display surface, sponsor visibility
5. `docs/features/PRIVACY.md` — what attendee data sponsors can/cannot access
6. `docs/features/FORMS.md` — form attribution via `source_placement_id`
7. `docs/architecture/API_CONTRACT.md` — integration endpoints
8. `docs/architecture/FRIENDLY_URLS.md` — brand-specific URLs
9. `README.md` — platform overview

### Admin Chat (organizer-facing — 13 docs)

Full operational knowledge for event organizers:

1. `docs/features/TIERS.md` — tier management, flag toggling
2. `docs/features/FORMS.md` — form system, admin endpoints, counts
3. `docs/features/QR-ROUTING.md` — generating QR links, test-IDs
4. `docs/features/BRANDS.md` — brand setup and isolation
5. `docs/features/AUTH.md` — admin access methods
6. `docs/features/EVENTS.md` — event data and APIs
7. `docs/features/SURFACES.md` — all surfaces and admin dashboard
8. `docs/features/PRIVACY.md` — PII lifecycle and compliance
9. `docs/features/ERROR-REFERENCE.md` — troubleshooting
10. `docs/architecture/API_CONTRACT.md` — full API reference
11. `docs/architecture/FRIENDLY_URLS.md` — URL system
12. `docs/support/ERROR_HANDLING_GUIDE.md` — error investigation
13. `README.md` — platform overview

### Future: Government / Policy / Researcher Chat

When these audiences come online, they will need:

| Audience | Key Docs Needed | Status |
|----------|----------------|--------|
| **Government** | Event permitting, public safety data, venue compliance | Not yet written |
| **Policy** | Data governance, PII policies, retention schedules, audit reports | Partially exists (`PRIVACY.md`, `DATA_POLICY.md`) |
| **Public Services** | Self-serve onboarding, free-tier capabilities, community impact | Partially exists (`TIERS.md`, `SURFACES.md`) |
| **Researchers** | Data export APIs, anonymization methods, research access patterns | Not yet written — ourEventRings scope |

---

## Recommended Training Order

```
Phase 1: Feature docs (docs/features/*.md)                    ← 9 docs
   ↓  Chat can answer: "How do I register?", "What tier has surveys?",
   ↓  "How is my data protected?", "What analytics do sponsors get?"

Phase 2: Core architecture (README, API_CONTRACT, FRIENDLY_URLS, MVP_SCOPE)  ← +5 docs
   ↓  Chat can answer: "What's the API?", "How do URLs work?",
   ↓  "What's the platform?", "What's coming next?"

Phase 3: Ops knowledge (runbooks, deployment, security)        ← +24 docs
   ↓  Chat can answer: "How do I deploy?", "Why is my request blocked?",
   ↓  "How do I rotate secrets?"

Phase 4: Reference (selectively, for edge cases)               ← ~50 docs
```

---

## Content Refresh Cadence

| Tier | Refresh When |
|------|-------------|
| Tier 1 | After any feature change, new form type, tier update, or surface change |
| Tier 2 | After deployment procedure or security policy changes |
| Tier 3 | After new audits, verification milestones, or migration phases |
| Tier 4 | Never — archive is frozen |
