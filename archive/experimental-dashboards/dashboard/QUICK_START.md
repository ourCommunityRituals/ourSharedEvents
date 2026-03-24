# DevOps Dashboard - Quick Start Guide

## 🚀 Start the Dashboard (3 Easy Steps)

### Option 1: Using npm from project root
```bash
npm run dashboard
```

### Option 2: Using the startup script
```bash
cd dashboard
./start-dashboard.sh
```

### Option 3: Directly
```bash
cd dashboard
npm start
```

Then open: **http://localhost:3001**

---

## 📊 What You'll See

### Visual Status Flow
```
Local → GitHub → Actions → Deploy → Tests
```

- 🟢 Green = Everything synced
- 🟡 Yellow = Out of sync
- 🔴 Red = Error/Failed

### 8 Environment Layers

1. **💻 Local** - Your working directory status
2. **🐙 GitHub** - Repository and branches
3. **⚙️ Actions** - CI/CD workflows
4. **📜 Apps Script** - Production deployment
5. **🧪 QA** - Testing environment
6. **🔄 Clasp** - Apps Script CLI sync
7. **🧪 Testing** - Test results & coverage
8. **🌐 Hostinger** - Custom domain deployment

---

## 🎮 Common Actions

### When Local is Out of Sync with GitHub
```
Click: "Sync to GitHub" button in Local layer
```
This runs: `git add -A && git commit && git push`

### After Making Code Changes
```
1. Click "Sync to GitHub" (Local layer)
2. Wait for Actions to run (watch Actions layer turn green)
3. Check deployment status (Apps Script layer)
4. Run tests (Testing layer)
```

### To Deploy to Production
```
Click: "Deploy to Apps Script" (Apps Script layer)
Or: "Trigger Deploy" (GitHub Actions layer)
```

### To Run Tests
```
Click: "Run Smoke Tests" (quick)
Or: "Run E2E Tests" (comprehensive)
```

---

## 🔍 Understanding Status Badges

Each layer has a status badge:

- **Synced** - ✅ Everything is up to date
- **Out of Sync** - ⚠️ Changes need propagation
- **Error** - ❌ Something failed
- **Unknown** - ❓ Status can't be determined

---

## 💡 Pro Tips

### 1. Hover Before You Click
Hover over any button to see the exact command it will execute.

### 2. Watch the Command Output
The bottom section shows real-time output from your commands.

### 3. Auto-Refresh
Status updates every 30 seconds automatically.

### 4. Manual Refresh
Click the 🔄 button in the header to refresh immediately.

### 5. Check Before Committing
Before pushing code, ensure:
- ✅ Local tests pass
- ✅ No uncommitted changes
- ✅ GitHub Actions are green

---

## 🔧 Prerequisites

Install these if you haven't already:

```bash
# GitHub CLI
brew install gh
gh auth login

# Clasp (Google Apps Script CLI)
npm install -g @google/clasp
clasp login
```

---

## 🐛 Quick Troubleshooting

### "Error" status everywhere
- Check internet connection
- Run: `gh auth login` and `clasp login`

### Can't connect to dashboard
- Make sure port 3001 is available
- Try stopping and restarting: `npm run dashboard`

### Commands not working
- Check if command is in whitelist (see README.md)
- Check terminal for error messages

---

## 📖 Need More Help?

See the full [README.md](./README.md) for:
- Detailed feature documentation
- API endpoints
- Security information
- Customization options
- Complete troubleshooting guide

---

## 🎯 Typical Development Workflow

```
1. Open Dashboard → http://localhost:3001
2. Make code changes locally
3. Check Local layer shows uncommitted changes
4. Click "Sync to GitHub"
5. Watch GitHub Actions run
6. Monitor deployment status
7. Verify tests pass
8. ✅ Done!
```

---

**Keep the dashboard open while developing for real-time visibility! 👀**
