# DAC Backup Protocol — Documentation as Code

> **Derived from:** OCR-docs `VISION.md` § Documentation as Code
> **Created:** 2026-04-09
> **Owner:** Matt
> **Status:** ACTIVE — applies to all OCR product repos
> **Scope:** Governs how documentation stays alive, accurate, and recoverable

---

## Founding Principle

From VISION.md:

> The documents and files will be used as living documents... DAC along with the Claude, skills, knowledge folder structure will at each level feed the OCR same structure with the Vision.md

Documentation is code. It is committed, versioned, tested for accuracy, and recoverable. A document that contradicts the codebase is a bug — not a low-priority cleanup task.

---

## The Three Rules

### Rule 1: Documentation moves with code

Every PR that changes architecture, data layer, secrets, or API contracts **MUST** include documentation updates in the same PR. Not a follow-up. Not "we'll update docs later."

**Enforcement:** PR review checks that affected docs are updated. If a phase migration lands without a documentation sweep, the next session's first task is the sweep.

### Rule 2: Stale documentation is a defect

A document that tells you to set `GOOGLE_SA_CLIENT_EMAIL` when the codebase uses D1 is not "outdated" — it's **wrong**. Treat it with the same urgency as a failing test.

**Detection:** Each reconciliation (quarterly or after major changes) audits docs against codebase reality. Stale references are tracked, corrected, and recorded in RECONCILIATION.md.

### Rule 3: Documents are recoverable

Every document in the system can be reconstructed from:

1. The git repository (primary — all docs are committed)
2. The migration files (schema is self-documenting)
3. The CI/CD workflow (pipeline config documents the deploy process)
4. The `.ocr-standards/` templates (document structure is standardized)

If a document is deleted, it can be restored from git history. If a document was never written, the codebase and templates provide the skeleton.

---

## Document Lifecycle

```
DRAFT → ACTIVE → SUPERSEDED → ARCHIVED
  │        │          │            │
  │        │          │            └── Moved to archive/, kept in git history
  │        │          └── Header note added, replaced by successor doc
  │        └── Living document, updated with code changes
  └── Not yet reviewed or adopted
```

### Lifecycle Actions

| Transition            | Trigger                                          | Action                                               |
| --------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| DRAFT → ACTIVE        | PR merged with the doc                           | Remove draft notice                                  |
| ACTIVE → SUPERSEDED   | Architecture change makes doc partially obsolete | Add superseded notice with link to replacement       |
| SUPERSEDED → ARCHIVED | Replacement doc is fully adopted                 | Move file to `archive/`, update any cross-references |
| Any → DELETED         | Content is factually wrong with no replacement   | Delete file, record in RECONCILIATION.md             |

---

## Backup Layers

### Layer 1: Git Repository (Primary)

All documentation is committed to the repository. Git is the backup.

- Every doc file has full history via `git log -- <file>`
- Deleted files are recoverable via `git checkout <commit> -- <file>`
- Branch protection on `main` prevents accidental deletion

### Layer 2: Cross-Reference Integrity

Documents reference each other. If one is lost, its existence is discoverable from:

- `docs/INDEX.md` — master documentation index
- CLAUDE.md §7 — file map
- `Related Documentation` sections at the bottom of each doc
- RECONCILIATION.md — audit trail of all documentation changes

### Layer 3: Template Recovery

If a document is lost and git history is unavailable, it can be reconstructed from:

- `.ocr-standards/CLAUDE-base.md` — CLAUDE.md template
- `.ocr-standards/SKILL-template.md` — SKILL.md template
- `.ocr-standards/ADR-template.md` — ADR template
- This protocol — DAC structure and lifecycle rules

### Layer 4: Secrets Backup

Secrets are NOT stored in documentation. They are backed up separately:

| Secret                     | Primary Storage           | Backup Storage                       |
| -------------------------- | ------------------------- | ------------------------------------ |
| `ADMIN_KEY`                | Cloudflare Worker secrets | Doppler / secure vault               |
| `FORMS_ENCRYPTION_KEY`     | Cloudflare Worker secrets | Doppler / secure vault               |
| `CLOUDFLARE_API_TOKEN_OSE` | GitHub Actions secrets    | Doppler / secure vault               |
| `CLOUDFLARE_ACCOUNT_ID`    | GitHub Actions secrets    | Documented in wrangler.toml comments |

**Rule:** If a secret is lost and no backup exists, generate a new one. Accept data loss on encrypted fields if the encryption key is unrecoverable. Document the incident.

---

## Reconciliation Cadence

| Trigger             | Scope                                     | Action                                                   |
| ------------------- | ----------------------------------------- | -------------------------------------------------------- |
| **Phase migration** | All docs referencing changed architecture | Full sweep — update or supersede every affected file     |
| **Quarterly**       | All `docs/` files                         | Spot-check for staleness, update RECONCILIATION.md       |
| **Post-incident**   | DR, runbook, and security docs            | Verify procedures match what actually happened           |
| **New team member** | Onboarding-relevant docs                  | Test docs by following them — if steps fail, fix the doc |

---

## File Hierarchy (DAC Compliance)

Every OCR product repo follows this structure:

```
repo/
├── CLAUDE.md              # Session protocol (REQUIRED)
├── README.md              # Public-facing description (REQUIRED)
├── SKILL.md               # Reusable skills (REQUIRED)
├── STORIES.md             # Work queue
├── .ocr-standards/        # Org-level templates (synced from OCR-docs)
├── .claude/
│   ├── documents/         # Specs, decisions, reconciliation
│   ├── inputs/            # Story intake
│   ├── outputs/           # Generated artifacts
│   ├── research/          # Analysis
│   └── skills/            # Role knowledge files
└── docs/
    ├── INDEX.md           # Master index (REQUIRED)
    ├── adr/               # Architecture Decision Records
    ├── architecture/      # System design
    ├── deployment/        # Deploy guides + INFRA-CHECKLIST
    ├── runbooks/          # Operational procedures + DR
    ├── security/          # Baselines and policies
    ├── qa/                # Testing guides
    └── ...                # Other categories as needed
```

**Vision lives in OCR-docs only. Never duplicate.**

---

## Anti-Patterns

| Anti-Pattern                   | Why It's Wrong                               | What to Do Instead                             |
| ------------------------------ | -------------------------------------------- | ---------------------------------------------- |
| "We'll update docs later"      | Later never comes; docs drift                | Update in the same PR                          |
| Duplicate docs                 | Two sources of truth = zero sources of truth | Single file, cross-reference everywhere else   |
| Docs without dates             | No way to assess staleness                   | Every doc has a "Last Updated" field           |
| Superseded docs without notice | Reader follows wrong instructions            | Add superseded header with link to replacement |
| Secrets in documentation       | Security risk                                | Reference the secret name, never the value     |
| Docs outside the repo          | Not versioned, not recoverable               | All docs committed to git                      |

---

_Derived from OCR-docs/docs/VISION.md_
_Created: 2026-04-09_
_Owner: Matt_
_Status: ACTIVE_
