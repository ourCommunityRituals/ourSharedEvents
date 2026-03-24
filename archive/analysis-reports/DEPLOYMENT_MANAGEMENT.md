# Deployment Management Guide

## The 20 Deployment Limit

Google Apps Script has a hard limit of **20 versioned deployments** per project. Once you hit this limit, you cannot create new deployments until you remove old ones.

### Error Message

```
Scripts may only have up to 20 versioned deployments at a time.
```

## Automated Solution

We've created automated tools to handle this:

### Quick Fix

```bash
# This script automatically cleans up old deployments and creates a new one
./scripts/manage-deployments.sh
```

### What It Does

1. **Checks deployment count** - Counts current deployments
2. **Identifies old deployments** - Finds deployments that can be safely removed
3. **Keeps recent deployments** - Preserves the 3 most recent versions
4. **Removes old deployments** - Unedeploys versions you no longer need
5. **Creates new deployment** - Deploys with the correct access settings
6. **Tests the deployment** - Verifies it returns HTTP 200

### Integrated Into Main Script

The main deployment script now automatically detects this issue:

```bash
./create-new-anonymous-deployment.sh
```

If you have 20+ deployments, it will:
- Detect the limit
- Automatically call `./scripts/manage-deployments.sh`
- Clean up old deployments
- Create the new deployment

## Manual Management

### List All Deployments

```bash
npx clasp deployments
```

Output example:
```
3 Deployments.
- @HEAD
- @20 Version 20
- @19 Version 19
- @18 Version 18
...
```

### Remove a Specific Deployment

```bash
# Remove a specific version
npx clasp undeploy @1

# Remove multiple versions
npx clasp undeploy @1
npx clasp undeploy @2
npx clasp undeploy @3
```

### Best Practice: Keep Only Recent Deployments

Recommended approach:
- **Keep:** The 3-5 most recent deployments
- **Remove:** Everything older

This gives you:
- Current production deployment
- Previous version (for quick rollback)
- A few older versions (for emergency rollback)

## Deployment Strategy

### Development Workflow

1. **During Development:**
   - Use `@HEAD` deployment for testing
   - Don't create versioned deployments for every change

2. **Before Production:**
   - Create a versioned deployment: `npx clasp deploy -d "Description"`
   - Test thoroughly
   - Update `DEPLOYMENT_ID` secret in GitHub

3. **Regular Cleanup:**
   - Every few weeks, clean up old deployments
   - Run `./scripts/manage-deployments.sh`

### CI/CD Integration

The CI/CD pipeline updates an existing deployment rather than creating new ones:

```yaml
# .github/workflows/ci.yml
npx clasp deploy -i "$DEPLOYMENT_ID"  # Updates existing deployment
```

This avoids creating 20+ deployments from CI runs.

## Troubleshooting

### "Cannot undeploy @HEAD"

`@HEAD` is special and cannot be undeployed. Instead:

```bash
# Create a new version as HEAD
npx clasp deploy
```

### "Deployment not found"

The deployment may have already been removed. This is safe to ignore.

```bash
npx clasp undeploy @5
# Error: Deployment not found
# → This is fine, it's already gone
```

### Still Hitting the Limit

If automated cleanup isn't working:

1. **List deployments:**
   ```bash
   npx clasp deployments
   ```

2. **Manually remove old ones:**
   ```bash
   # Remove deployments @1 through @15 (keep recent ones)
   for i in {1..15}; do npx clasp undeploy @$i 2>/dev/null || true; done
   ```

3. **Verify count:**
   ```bash
   npx clasp deployments | grep -c "Version"
   ```

## Deployment IDs Explained

### Types of Deployment IDs

| ID | Type | Description | Can Remove? |
|----|------|-------------|-------------|
| `@HEAD` | Special | Always points to latest code | No (auto-updates) |
| `@1`, `@2`, etc. | Versioned | Immutable snapshot | Yes |
| `AKfycby...` | Web App URL | The actual deployment URL | N/A |

### Which ID to Use

- **For CI/CD:** Use a versioned ID like `@3` (set in `DEPLOYMENT_ID` secret)
- **For Testing:** Use `@HEAD` (always latest)
- **For Production:** Use a versioned ID (stable, won't change unexpectedly)

## Automation Features

### Auto-Detection

The `create-new-anonymous-deployment.sh` script now includes:

```bash
# Checks deployment count BEFORE attempting deployment
DEPLOYMENT_COUNT=$(npx clasp deployments | grep -c "Version")

if [ "$DEPLOYMENT_COUNT" -ge 20 ]; then
    # Automatically run cleanup
    ./scripts/manage-deployments.sh
fi
```

### Error Recovery

If deployment fails due to limit:

```bash
# Script detects the error and automatically retries with cleanup
if echo "$OUTPUT" | grep -q "may only have up to 20"; then
    ./scripts/manage-deployments.sh
fi
```

## Quick Reference

### Common Commands

```bash
# List deployments
npx clasp deployments

# Create new deployment
npx clasp deploy -d "Description"

# Remove old deployment
npx clasp undeploy @1

# Update existing deployment
npx clasp deploy -i @5 -d "Updated"

# Clean up automatically
./scripts/manage-deployments.sh
```

### File Locations

```
scripts/
├── manage-deployments.sh       # Automated cleanup + deploy
└── get-deployment-id.sh        # Extract deployment info

create-new-anonymous-deployment.sh  # Main deployment script (auto-cleanup)
verify-deployment.sh                # Test deployment
```

## Best Practices

### DO ✅

- ✅ Use `@HEAD` for active development
- ✅ Create versioned deployments for releases
- ✅ Clean up old deployments regularly
- ✅ Keep 3-5 recent deployments for rollback
- ✅ Use automation scripts to avoid manual errors

### DON'T ❌

- ❌ Create a new deployment for every code change
- ❌ Keep all 20 deployments indefinitely
- ❌ Manually manage deployments when scripts exist
- ❌ Delete recent deployments (keep for rollback)

## Summary

**Problem:** 20 deployment limit
**Solution:** Automated cleanup via `manage-deployments.sh`
**Prevention:** Integrated into main deployment script
**Recovery:** Automatic detection and cleanup on error

You should never have to worry about this limit again! 🎉

---

**Related Files:**
- `scripts/manage-deployments.sh` - Automated deployment cleanup
- `create-new-anonymous-deployment.sh` - Main deployment script (now includes auto-cleanup)
- `DEPLOYMENT_AUTH_FIX_GUIDE.md` - Fix for 302 redirect issue
- `.github/workflows/ci.yml` - CI/CD pipeline (updates existing deployment)
