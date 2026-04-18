# DevOps — Knowledge Base

> **Role:** Owns environments, releases, pipelines, infrastructure provisioning, and org-wide product infrastructure
> **Last Reconciled:** 2026-03-27

---

## Environment Inventory

### ourSharedEvents Environments

| Environment     | Domain                         | Worker                    | D1 Database         | Status             |
| --------------- | ------------------------------ | ------------------------- | ------------------- | ------------------ |
| **Development** | `localhost:8787`               | `wrangler dev`            | `ocr-db-local`      | ✅ Works locally   |
| **Staging**     | `stg.oursharedevents.com`      | `workers/oursharedevents` | `ocr-db-staging`    | ❌ Not provisioned |
| **Production**  | `oursharedevents.com`, `www.*` | `workers/oursharedevents` | `ocr-db-production` | ❌ Not provisioned |

### Legacy Environments (eventangle.com)

| Environment | Domain                                         | Status                 |
| ----------- | ---------------------------------------------- | ---------------------- |
| Staging     | `stg.eventangle.com`, `api-stg.eventangle.com` | ⚠️ Active (old domain) |
| Production  | `www.eventangle.com`, `api.eventangle.com`     | ⚠️ Active (old domain) |
| QA          | `zeventbooks.com`                              | ⚠️ Active (old domain) |

### Environment Parity Matrix

| Config                | Dev         | Staging          | Production        |
| --------------------- | ----------- | ---------------- | ----------------- |
| Debug logging         | Full        | Full             | Minimal           |
| Debug endpoints       | Yes         | Yes              | No                |
| Admin key fallback    | N/A         | ✅ Enabled       | ❌ Disabled       |
| Experimental features | On          | On               | Off               |
| D1 database           | Local       | Staging          | Production        |
| Build version         | `dev-local` | `stg-YYYY.MM.DD` | `prod-YYYY.MM.DD` |

---

## Infrastructure Provisioning Checklist (P1-6)

### Google Cloud (not yet done)

- [ ] Create GCP project
- [ ] Enable Google Sheets API
- [ ] Create service account (Viewer role)
- [ ] Download JSON key
- [ ] Create spreadsheet with EVENTS tab + headers
- [ ] Share spreadsheet with service account email

### Cloudflare (not yet done)

- [ ] Create Cloudflare account
- [ ] Add zone: `oursharedevents.com`
- [ ] Point registrar nameservers to Cloudflare
- [ ] DNS A records: `@`, `www`, `stg` → `192.0.2.1` (all proxied)
- [ ] SSL/TLS: Full (strict) + Always Use HTTPS
- [ ] Create API Token: Workers Routes Edit, Account Workers Scripts Edit
- [ ] Generate ADMIN_KEY: `openssl rand -hex 32`

### D1 Databases (not yet done)

```bash
wrangler d1 create ocr-db-staging
wrangler d1 create ocr-db-production
# Apply migrations:
wrangler d1 migrations apply --env staging
wrangler d1 migrations apply --env production
```

---

## Secrets Management

### GitHub Actions Secrets

| Secret                     | Scope       | Rotation | Status     |
| -------------------------- | ----------- | -------- | ---------- |
| `CLOUDFLARE_API_TOKEN_OSE` | Deploy jobs | 90 days  | ❌ Not set |
| `CLOUDFLARE_ACCOUNT_ID`    | Deploy jobs | Static   | ❌ Not set |
| `ADMIN_KEY`                | E2E tests   | 90 days  | ❌ Not set |

### Cloudflare Worker Secrets (per env)

| Secret                      | Purpose         | Rotation | Status     |
| --------------------------- | --------------- | -------- | ---------- |
| `ADMIN_KEY`                 | Bearer auth     | 90 days  | ❌ Not set |
| `SHEETS_SPREADSHEET_ID`     | Data source     | Static   | ❌ Not set |
| `GOOGLE_SA_CLIENT_EMAIL`    | Service account | 90 days  | ❌ Not set |
| `GOOGLE_SA_PRIVATE_KEY_PEM` | Signing key     | 90 days  | ❌ Not set |
| `GOOGLE_MAPS_API_KEY`       | Maps            | 90 days  | ❌ Not set |
| `BIGQUERY_DATASET_ID`       | Analytics       | Static   | ❌ Not set |
| `GCP_PROJECT_ID`            | GCP project     | Static   | ❌ Not set |
| `VERTEX_AI_MODEL_ID`        | AI features     | Static   | ❌ Not set |

### Secret Rotation Runbook

```bash
# 1. Generate new value
openssl rand -hex 32  # for ADMIN_KEY

# 2. Update Cloudflare
cd workers/oursharedevents
echo "NEW_VALUE" | wrangler secret put SECRET_NAME --env staging
echo "NEW_VALUE" | wrangler secret put SECRET_NAME --env production

# 3. Update GitHub
gh secret set SECRET_NAME --body "NEW_VALUE"

# 4. Verify
curl https://stg.oursharedevents.com/health
curl https://oursharedevents.com/health

# 5. Delete old value (service accounts)
# Via Google Cloud Console
```

---

## Release Process

### Staging Release

```bash
git push origin main
# CI auto-deploys to staging via oursharedevents-ci.yml
# Verify: curl https://stg.oursharedevents.com/health
```

### Production Release

```bash
# Tag with semver
git tag v1.0.0
git push origin v1.0.0
# CI auto-deploys to production
# Verify: curl https://oursharedevents.com/health
```

### Rollback

```bash
# Option 1: Revert commit + push
git revert HEAD
git push origin main

# Option 2: Deploy previous version
wrangler deployments list --env production
wrangler rollback --env production
```

### Version Convention

```
v{MAJOR}.{MINOR}.{PATCH}
  │       │       └── Bug fixes, patches
  │       └────────── New features, non-breaking
  └──────────────────  Breaking changes, phase transitions
```

- `v1.0.0` — Phase 1 production launch
- `v2.0.0` — Phase 2 D1 migration complete
- `v3.0.0` — Phase 3 Firebase + React

---

## CI/CD Pipeline Architecture

### Active Pipelines

| Workflow              | File                           | Trigger        | Deploys                    |
| --------------------- | ------------------------------ | -------------- | -------------------------- |
| **Worker CI/CD**      | `oursharedevents-ci.yml`       | PR/push/tag    | `workers/oursharedevents/` |
| **Security Scan**     | `security-scan.yml`            | Push/PR/weekly | N/A (analysis)             |
| **Security Triage**   | `security-triage.yml`          | Scan failure   | N/A (issues)               |
| **SLA Enforcement**   | `security-sla-enforcement.yml` | Daily          | N/A (labels)               |
| **Human Gate**        | `security-human-gate.yml`      | Scan blocks    | N/A (approval)             |
| **Dependency Review** | `dependency-review.yml`        | PR             | N/A (review)               |

### Pipeline Flow

```
PR opened
  └── typecheck ── schema-verify
                        └── (merge to main)
                              └── deploy-staging
                                    └── e2e-staging
                                          └── (tag vX.Y.Z)
                                                └── deploy-production
                                                      └── e2e-production
```

### Cleanup Needed

| Item                   | Action                                    |
| ---------------------- | ----------------------------------------- |
| `stage1.yml`           | Archive — targets legacy `worker/`        |
| `stage2.yml`           | Archive — targets legacy `worker/`        |
| `worker/wrangler.toml` | Archive — conflicts with canonical Worker |
| Root `wrangler.toml`   | Archive — points to `worker/`             |

---

## Org-Wide Infrastructure Planning

### Per-Product Infrastructure

> **Source of truth**: `OCR-docs/docs/VISION.md` — all product repos derive from that document.

| Code | Product          | Worker        | D1              | Domain              | Status                         |
| ---- | ---------------- | ------------- | --------------- | ------------------- | ------------------------------ |
| OSE  | OurSharedEvents  | ✅ Coded      | ✅ Schema ready | oursharedevents.com | Active development             |
| OW   | OurWKRP          | ✅ Coded      | ✅ Schema ready | ourwkrp.com         | Active development             |
| OSG  | OurSharedGames   | Needed        | Inherits OSE    | TBD                 | Docs-as-code                   |
| OSR  | OurSharedRecords | Needed        | Own DB          | TBD                 | Docs-as-code                   |
| OSP  | OurSharedPulse   | Not required  | Not required    | TBD                 | Human-delivered, tech-optional |
| OSM  | OurSharedMagnets | Not required  | Not required    | TBD                 | Docs-as-code (Postman/Newman)  |
| OA   | OurAirwaves      | Fork template | Per-client      | Per-client          | Docs-as-code                   |
| OER  | OurEventRings    | Needed        | BigQuery target | TBD                 | Not started                    |

### Key architectural boundaries

- **OSE is anonymized.** Anonymous ID architecture. No PII in database.
- **OW is not anonymized.** Named identity. Separate D1, separate KV, separate Worker.
- **OSE + OW converge under OCR** but the identity boundary is architectural and permanent.
- **All product data flows to BigQuery.** OER accesses via RAG.

### Shared Infrastructure Decisions Needed

1. **Shared vs. isolated D1:** Products with code get their own D1. OSE and OW are already separate.
2. **Shared Firebase project:** One Firebase project for auth across OSE products, or one per product?
3. **Domain strategy:** Separate domains per product (oursharedevents.com, ourwkrp.com already registered).
4. **Cloudflare zone:** One zone with multiple Workers, or one zone per product?
5. **CI/CD template:** Shared reusable workflow or copy-paste per repo?
6. **BigQuery pipeline:** How product data flows to the warehouse for OER/RAG.

### Architecture

```
ourCommunityRituals (GitHub Org)
├── OCR-docs (org brain — VISION.md source of truth)
├── ourSharedEvents — OSE (anonymous ID platform)
│   ├── Cloudflare Worker (API + admin)
│   ├── D1 Database (events, sponsors, customers)
│   ├── Firebase Auth (Phase 3)
│   └── Firebase Hosting (Phase 3)
├── ourWKRP — OW (named identity music platform)
│   ├── Cloudflare Worker (Spotify + catalog API)
│   ├── D1 Database (contributors, playlists, tracks)
│   └── KV (auth state, sessions)
├── ourSharedGames — OSG (activation format, inherits OSE)
├── ourSharedRecords — OSR (archive layer)
├── ourSharedPulse — OSP (consulting, tech-optional)
├── ourSharedMagnets — OSM (developer/franchise docs)
├── ourAirwaves — OA (deployment/white label)
└── [OurEventRings — OER (analytics, not started)]
```

---

## Monitoring & Observability (Planned)

| Tool                     | Purpose                     | Status                 |
| ------------------------ | --------------------------- | ---------------------- |
| **Cloudflare Analytics** | Request volume, error rates | Available after deploy |
| **Wrangler tail**        | Real-time Worker logs       | Available after deploy |
| **Datadog Synthetics**   | Endpoint monitoring         | Not provisioned        |
| **GitHub Actions**       | Pipeline health             | ✅ Active              |

---

## Known Gaps

1. **No infrastructure provisioned:** Google Cloud, Cloudflare zone, D1 databases all need creation
2. **No monitoring:** Datadog not set up, no alerting
3. **Legacy workflows active:** `stage1.yml`/`stage2.yml` should be archived
4. **Root wrangler.toml conflict:** Points to `worker/` not `workers/oursharedevents/`
5. **No shared CI templates:** Each future product will need its own pipeline — consider reusable workflows
6. **No domain purchased:** `oursharedevents.com` status unknown
7. **No secret rotation automation:** Manual process documented, no scheduled reminders
