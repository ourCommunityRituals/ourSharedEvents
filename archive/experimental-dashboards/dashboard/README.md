# DevOps Environment Monitoring Dashboard

A comprehensive real-time monitoring dashboard for tracking and synchronizing all environmental layers in the MVP Event Toolkit development pipeline.

## 🎯 Overview

This dashboard provides a visual representation of your entire DevOps pipeline, showing the sync status between:

- **Local Development** - Your working directory, git status, uncommitted changes
- **GitHub Repository** - Remote repository status, branches, PRs
- **GitHub Actions/CI** - Workflow runs, test results, deployments
- **Google Apps Script (Production)** - Production deployment status and health
- **QA Environment** - QA deployment and testing environment
- **Clasp Sync** - Google Apps Script CLI synchronization
- **Testing Status** - Jest unit tests, Playwright E2E tests, coverage
- **Hostinger Deployment** - Custom domain deployment status

## ✨ Features

- **Real-time Monitoring** - Auto-refreshes every 30 seconds
- **Visual Sync Status** - See at a glance which layers are in sync
- **One-Click Actions** - Execute common DevOps commands with a single click
- **Command Tooltips** - Hover over buttons to see exactly what command will run
- **Command Output** - View live output from executed commands
- **Sync Detection** - Automatically detects when local is out of sync with any layer
- **Health Checks** - Monitor the health of all deployments
- **URL Quick Access** - Direct links to GitHub, Apps Script, test reports, etc.

## 🚀 Quick Start

### Prerequisites

1. **Node.js** (v16 or higher)
2. **GitHub CLI** (`gh`) - Install with: `brew install gh` or visit https://cli.github.com/
3. **Clasp** - Install with: `npm install -g @google/clasp`
4. **Git** - Should already be installed

### Installation

```bash
# Navigate to the dashboard directory
cd dashboard

# Install dependencies
npm install

# Start the dashboard
./start-dashboard.sh

# Or use npm
npm start
```

The dashboard will be available at: **http://localhost:3001**

## 📊 Dashboard Sections

### 1. Synchronization Overview

Visual flow diagram showing the sync status between all layers:
```
Local → GitHub → Actions → Deploy → Tests
```

Each node shows:
- 🟢 **Green** - Synced and healthy
- 🟡 **Yellow** - Out of sync or pending
- 🔴 **Red** - Error or failed

### 2. Local Environment

**Monitors:**
- Current git branch
- Uncommitted changes
- Unpushed commits
- Node modules installation status
- Environment file presence

**Actions:**
- Check git status
- Sync to GitHub (stage, commit, push)
- Update dependencies

### 3. GitHub Repository

**Monitors:**
- Main branch commit hash
- Current branch
- Last commit message
- Open pull requests
- Repository URL

**Actions:**
- Fetch latest changes
- Pull from main branch
- Push current branch

### 4. GitHub Actions / CI

**Monitors:**
- Stage 1 (Deploy) workflow status
- Stage 2 (Testing) workflow status
- CodeQL security analysis status
- Last workflow run time

**Actions:**
- List all workflows
- View recent runs
- Trigger deployment workflow

### 5. Google Apps Script (Production)

**Monitors:**
- Script ID
- Deployment ID
- Health check status
- Last deployment time

**Actions:**
- Open Apps Script editor
- Pull code from Apps Script
- Deploy to Apps Script

### 6. QA Environment

**Monitors:**
- QA Script ID
- QA Deployment ID
- Health check status
- Last deployment time

**Actions:**
- Run tests against QA
- Deploy to QA
- Rollback QA deployment

### 7. Clasp Sync

**Monitors:**
- Clasp version
- Local vs remote sync status
- Authentication status
- Configuration file presence

**Actions:**
- Check authentication
- Pull from Apps Script
- Push to Apps Script

### 8. Testing Status

**Monitors:**
- Jest unit test results
- Playwright E2E test results
- Code coverage percentage
- Last test run time

**Actions:**
- Run unit tests
- Run smoke tests
- Run full E2E suite

### 9. Hostinger Deployment

**Monitors:**
- Domain name
- Proxy status
- Health check
- Last deployment time

**Actions:**
- Test deployment
- Deploy via GitHub Actions

## 🎮 Using the Dashboard

### Viewing Status

The dashboard automatically loads and displays the current status of all layers when you open it. Status updates every 30 seconds automatically.

### Executing Commands

1. **Click any action button** to execute the associated command
2. **Hover over the button** to see the exact command that will be executed
3. **View output** in the Command Output section at the bottom
4. **Status refreshes automatically** after command execution

### Manual Refresh

Click the 🔄 button in the header to manually refresh all status information.

### Command Output

The Command Output section shows:
- Commands being executed (in blue)
- Successful output (in green)
- Errors (in red)
- Timestamps for each operation

Click the 🗑️ button to clear the output history.

## 🔧 API Endpoints

The dashboard backend provides the following API endpoints:

### Status Endpoints

- `GET /api/status/local` - Local environment status
- `GET /api/status/github` - GitHub repository status
- `GET /api/status/actions` - GitHub Actions status
- `GET /api/status/apps-script` - Google Apps Script status
- `GET /api/status/qa` - QA environment status
- `GET /api/status/clasp` - Clasp sync status
- `GET /api/status/testing` - Testing status
- `GET /api/status/hostinger` - Hostinger deployment status

### Action Endpoints

- `POST /api/execute` - Execute a command
  ```json
  {
    "command": "git status"
  }
  ```

### Health Check

- `GET /api/health` - Server health check

## 🔐 Security

### Command Whitelisting

For security, only the following command patterns are allowed:

- `git status`, `git fetch`, `git pull`, `git push`, `git add`, `git commit`
- `npm install`, `npm test`, `npm run`
- `clasp` commands
- `gh workflow`, `gh run`, `gh pr` commands

Any other commands will be rejected with a 403 Forbidden error.

## 🛠️ Configuration

### Port Configuration

The dashboard runs on port `3001` by default. To change this, edit `src/server.js`:

```javascript
const PORT = 3001; // Change to your desired port
```

### Auto-Refresh Interval

To change the auto-refresh interval (default: 30 seconds), edit `public/app.js`:

```javascript
this.refreshInterval = 30000; // Change to desired milliseconds
```

## 📁 Project Structure

```
dashboard/
├── public/              # Frontend files
│   ├── index.html       # Main dashboard HTML
│   ├── styles.css       # Dashboard styling
│   └── app.js           # Frontend JavaScript
├── src/                 # Backend files
│   └── server.js        # Express server and API
├── package.json         # Dependencies
├── start-dashboard.sh   # Startup script
└── README.md           # This file
```

## 🐛 Troubleshooting

### Dashboard won't start

1. **Check Node.js version**: `node --version` (should be v16+)
2. **Install dependencies**: `npm install`
3. **Check port availability**: Make sure port 3001 is not in use

### "gh command not found"

Install the GitHub CLI:
```bash
brew install gh  # macOS
# or visit https://cli.github.com/
```

Then authenticate:
```bash
gh auth login
```

### "clasp command not found"

Install clasp globally:
```bash
npm install -g @google/clasp
```

Then authenticate:
```bash
clasp login
```

### Status shows "Unknown" or "Error"

1. **Check authentication**: Make sure you're logged in to `gh` and `clasp`
2. **Check git remote**: Ensure you have a GitHub remote configured
3. **Check environment files**: Ensure `.env` and `.clasp.json` exist
4. **Check network**: Ensure you have internet connectivity

### Commands not executing

1. **Check console**: Open browser DevTools and check for errors
2. **Check server logs**: Look at terminal where dashboard server is running
3. **Verify command**: Hover over button to see the exact command being executed
4. **Check permissions**: Ensure the command is in the whitelist

## 🎨 Customization

### Adding New Layers

1. **Add HTML section** in `public/index.html`
2. **Add CSS styling** in `public/styles.css`
3. **Add status checker** in `src/server.js`
4. **Add frontend loader** in `public/app.js`

### Changing Colors

Edit the CSS variables in `public/styles.css`:

```css
:root {
    --accent-success: #10b981;  /* Success/synced color */
    --accent-warning: #f59e0b;  /* Warning/out-of-sync color */
    --accent-danger: #ef4444;   /* Error/failed color */
    /* ... other colors */
}
```

## 📝 Development

### Running in Development Mode

```bash
npm run dev  # Uses nodemon for auto-restart on changes
```

### Adding New Commands

1. Add command pattern to whitelist in `src/server.js`
2. Add button in appropriate layer section in `public/index.html`
3. Ensure `data-command` attribute contains the full command

## 🤝 Contributing

When adding new features:

1. Keep security in mind - validate all commands
2. Update this README with new features
3. Test thoroughly before committing
4. Follow existing code style

## 📄 License

MIT License - See main project LICENSE file

## 🙏 Support

For issues or questions:

1. Check this README first
2. Check browser console for errors
3. Check server logs
4. Ensure all prerequisites are installed

## 🚦 Status Indicators

- **Synced** (Green) - Everything is up to date
- **Out of Sync** (Yellow) - Changes need to be propagated
- **Error** (Red) - Something failed or is unhealthy
- **Unknown** (Gray) - Status cannot be determined

## 🎯 Best Practices

1. **Keep it running** - Leave the dashboard open while developing
2. **Check before committing** - Ensure tests pass and deployments are healthy
3. **Sync regularly** - Don't let local and remote get too far apart
4. **Monitor after deployments** - Watch for errors after pushing changes
5. **Use tooltips** - Always check what a command does before running it

---

**Happy Monitoring! 🚀**
