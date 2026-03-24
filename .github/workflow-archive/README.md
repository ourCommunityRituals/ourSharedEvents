# Archived GitHub Workflows

This folder contains legacy CI workflows that are no longer part of the active CI/CD pipeline.

**IMPORTANT**: This directory is intentionally located at `.github/workflow-archive/` (NOT inside `.github/workflows/`). GitHub Actions automatically runs ALL `.yml` files found anywhere in `.github/workflows/` including subdirectories. Moving archives outside prevents them from triggering.

Rules:
- Only `stage1.yml`, `stage2.yml`, and `security-scan.yml` should live in `.github/workflows/`.
- All historical workflows must be stored in this `workflow-archive/` directory (outside workflows/).
- Do **not** move these files back into `.github/workflows/` - they will trigger and cause CI conflicts.
- Do **not** edit archived workflows except to add deprecation comments.
