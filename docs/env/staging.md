# Staging Environment Configuration

**Last Verified:** 2025-12-09
**Status:** Active
**Owner:** zeventbook@gmail.com

---

## Canonical Staging EXEC URL

```
https://script.google.com/macros/s/AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm/exec
```

---

## Google Apps Script Project

| Property | Value |
|----------|-------|
| **Script ID** | `1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ` |
| **Deployment ID** | `AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm` |
| **Project Editor URL** | https://script.google.com/home/projects/1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ/edit |

---

## Ownership

| Property | Value |
|----------|-------|
| **Owner** | `zeventbook@gmail.com` |
| **NOT owned by** | `mzdano` (personal account) |
| **Google Cloud Project** | `zeventbooks` |

### Ownership Verification

To verify ownership:
1. Open the [Project Editor URL](https://script.google.com/home/projects/1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ/edit)
2. Click **Project Settings** (gear icon)
3. Confirm **Owner** shows `zeventbook@gmail.com`

---

## Permissions

| Property | Value |
|----------|-------|
| **Web App Access** | Anyone |
| **Execute As** | Me (zeventbook@gmail.com) |

The web app deployment is configured with "Anyone" access, meaning no Google authentication is required to access the staging endpoints.

---

## Public URLs (via Cloudflare)

| URL | Purpose |
|-----|---------|
| `https://stg.eventangle.com` | Main staging site |
| `https://api-stg.eventangle.com` | Staging API endpoint |

These URLs are proxied through Cloudflare Workers (`[env.staging]` in `wrangler.toml`).

---

## Configuration Files

| File | Purpose |
|------|---------|
| `.clasp-staging.json` | Clasp configuration for staging script |
| `config/deployment-ids.js` | Single source of truth for deployment IDs |
| `cloudflare-proxy/wrangler.toml` | Cloudflare Worker staging config (`[env.staging]`) |

---

## Source of Truth

The canonical deployment IDs are maintained in:

```
config/deployment-ids.js
```

This module exports:
- `STAGING_SCRIPT_ID` - Permanent project ID
- `STAGING_DEPLOYMENT_ID` - Current active deployment ID
- `STAGING_WEB_APP_URL` - Constructed exec URL
- `STAGING_GAS_EDIT_URL` - Project editor URL

---

## Verification Commands

```bash
# Check staging status
npm run staging:status

# Verify staging endpoint responds
npm run staging:verify

# Health check via curl
curl https://stg.eventangle.com/status
```

---

## Quick Reference

| Item | Value |
|------|-------|
| **Canonical URL** | `https://script.google.com/macros/s/AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm/exec` |
| **Cloudflare URL** | `https://stg.eventangle.com` |
| **Script ID** | `1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ` |
| **Deployment ID** | `AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm` |
| **Owner** | `zeventbook@gmail.com` |
| **Access** | Anyone |

---

## Related Documentation

- [`STAGING_SETUP.md`](../../STAGING_SETUP.md) - Full staging setup guide
- [`APPS_SCRIPT_PROJECT.md`](../../APPS_SCRIPT_PROJECT.md) - Apps Script project details
- [`ENVIRONMENT_MATRIX.md`](../../ENVIRONMENT_MATRIX.md) - Environment comparison matrix
- [`config/deployment-ids.js`](../../config/deployment-ids.js) - Deployment ID source of truth
