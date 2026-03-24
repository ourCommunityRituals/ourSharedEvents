# GitHub Codespaces Configuration

This configuration sets up a complete testing environment for MVP Event Toolkit in GitHub Codespaces.

## What's Included

- **Node.js 18**: JavaScript runtime
- **Playwright**: Automatically installed with Chromium browser
- **VS Code Extensions**:
  - ESLint for code linting
  - Prettier for code formatting
  - Playwright Test for VS Code

## Free Tier

GitHub provides free Codespaces usage:
- **120 core-hours/month** for personal accounts
- **15 GB storage**
- Perfect for running E2E tests without local setup

### Usage Calculation
- 2-core machine: 60 hours/month free
- 4-core machine: 30 hours/month free

**Recommended:** Use 2-core for tests (sufficient for Playwright)

## Getting Started

### Option 1: Open in Codespace (from GitHub)

1. Go to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT
2. Click: **Code** → **Codespaces** → **Create codespace on [branch]**
3. Wait for container to build (~2-3 minutes)
4. All dependencies auto-install via `postCreateCommand`

### Option 2: Open Existing Codespace

```bash
# List codespaces
gh codespace list

# Connect to existing
gh codespace code
```

### Option 3: VS Code Desktop

1. Install "GitHub Codespaces" extension
2. Open Command Palette: `Codespaces: Connect to Codespace`
3. Select your codespace

## Running Tests in Codespace

Once codespace is ready:

```bash
# Run smoke tests (quick, ~1 minute)
npm run test:smoke

# Run E2E tests (requires BASE_URL)
export BASE_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
export ADMIN_KEY="your-admin-secret"
npm run test:e2e

# Run all tests
npm run test:all

# Run in headed mode (see browser in VNC)
npm run test:e2e -- --headed
```

## Environment Variables

Set in Codespace secrets or `.env` file:

```bash
BASE_URL=https://script.google.com/macros/s/.../exec
ADMIN_KEY=CHANGE_ME_root
```

**Setting Codespace Secrets:**
1. Repository Settings → Secrets and variables → Codespaces
2. Add: `BASE_URL` and `ADMIN_KEY`
3. These auto-load in all codespaces

## Cost Optimization

### Keep Costs Low
- Use 2-core machine (default)
- Stop codespace when not in use (auto-stops after 30 min idle)
- Delete unused codespaces

### Check Usage
- Go to: https://github.com/settings/billing
- View: Codespaces usage this month

### Auto-stop Settings
Default: 30 minutes idle
Change: GitHub Settings → Codespaces → Default idle timeout

## VS Code Testing UI

Playwright extension provides:
- Test explorer in sidebar
- Run/debug individual tests
- View test results inline
- Record new tests

**Usage:**
1. Click Testing icon in sidebar
2. See all test files
3. Click ▶️ to run specific tests
4. View results with stack traces

## Debugging Tests

```bash
# Debug mode (step through)
npx playwright test --debug

# Show browser (headed mode)
npx playwright test --headed

# Show trace viewer
npx playwright show-trace trace.zip
```

## CI/CD Integration

Codespaces work great with GitHub Actions:
- Develop/test in Codespace
- Push to branch → CI runs same tests
- Same environment = consistent results

## Common Issues

### Playwright not installed
```bash
npx playwright install --with-deps chromium
```

### Port forwarding not working
- Check Ports tab in VS Code
- Make port public if needed

### Out of free hours
- Check billing: https://github.com/settings/billing
- Upgrade to paid plan if needed
- Or wait until next month

## Performance Tips

- **Use smaller machine**: 2-core is sufficient for tests
- **Run specific tests**: Don't run full suite every time
- **Use watch mode**: `npm run test:watch` (Jest only)
- **Stop when done**: Don't leave running overnight

## Alternative: Local Development

If you prefer local:
```bash
git clone https://github.com/zeventbooks/MVP-EVENT-TOOLKIT.git
cd MVP-EVENT-TOOLKIT
npm install
npx playwright install --with-deps chromium
npm run test:e2e
```

## Resources

- [Codespaces Docs](https://docs.github.com/en/codespaces)
- [Playwright Docs](https://playwright.dev)
- [Billing & Usage](https://github.com/settings/billing)
