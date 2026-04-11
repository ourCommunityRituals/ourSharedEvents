# Worker Route Backups

This directory stores Cloudflare Worker route backups created by `scripts/export-worker-routes.sh`.

## Purpose

Before making route changes (SEC-4.2), export current routes to create a rollback point:

```bash
export CLOUDFLARE_ZONE_ID=your-zone-id
export CLOUDFLARE_API_TOKEN_ESE=your-api-token
npm run routes:export
```

## Files Created

- `routes_backup_YYYYMMDD_HHMMSS.json` - Full route data (JSON)
- `routes_summary_YYYYMMDD_HHMMSS.txt` - Human-readable summary

## Rollback

To restore routes from a backup:

```bash
npm run routes:restore route-backups/routes_backup_20251221_120000.json
```

## Note

Backup files are excluded from git (`.gitignore`) as they may contain sensitive route information.
