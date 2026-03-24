const express = require('express');
const cors = require('cors');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;

const execPromise = util.promisify(exec);

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Project root directory
const PROJECT_ROOT = path.join(__dirname, '../..');

// Helper function to execute commands
async function executeCommand(command, options = {}) {
    try {
        const { stdout, stderr } = await execPromise(command, {
            cwd: options.cwd || PROJECT_ROOT,
            maxBuffer: 1024 * 1024 * 10, // 10MB buffer
            ...options
        });
        return { success: true, stdout, stderr };
    } catch (error) {
        return { success: false, error: error.message, stdout: error.stdout, stderr: error.stderr };
    }
}

// Helper function to check if file exists
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// API Routes

// Local Environment Status
app.get('/api/status/local', async (req, res) => {
    try {
        const status = {};

        // Get current branch
        const branchResult = await executeCommand('git rev-parse --abbrev-ref HEAD');
        status.branch = branchResult.success ? branchResult.stdout.trim() : 'unknown';

        // Get uncommitted changes
        const statusResult = await executeCommand('git status --porcelain');
        const uncommittedLines = statusResult.success ? statusResult.stdout.trim().split('\n').filter(line => line.length > 0) : [];
        status.uncommittedChanges = uncommittedLines.length;

        // Get unpushed commits
        const unpushedResult = await executeCommand(`git log origin/${status.branch}..HEAD --oneline 2>/dev/null || git log HEAD --oneline`);
        const unpushedLines = unpushedResult.success && unpushedResult.stdout.trim() ? unpushedResult.stdout.trim().split('\n').filter(line => line.length > 0) : [];
        status.unpushedCommits = unpushedLines.length;

        // Check node_modules
        status.nodeModules = await fileExists(path.join(PROJECT_ROOT, 'node_modules'));

        // Check .env file
        status.envFile = await fileExists(path.join(PROJECT_ROOT, '.env'));

        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GitHub Repository Status
app.get('/api/status/github', async (req, res) => {
    try {
        const status = {};

        // Get main branch commit
        const mainCommitResult = await executeCommand('git rev-parse origin/main');
        status.mainCommit = mainCommitResult.success ? mainCommitResult.stdout.trim() : null;

        // Get current branch
        const branchResult = await executeCommand('git rev-parse --abbrev-ref HEAD');
        status.currentBranch = branchResult.success ? branchResult.stdout.trim() : null;

        // Get last commit message
        const lastCommitResult = await executeCommand('git log -1 --pretty=format:"%h - %s (%cr)"');
        status.lastCommit = lastCommitResult.success ? lastCommitResult.stdout.trim() : null;

        // Get open PRs (requires gh CLI)
        const prsResult = await executeCommand('gh pr list --json number --jq "length"');
        status.openPRs = prsResult.success ? parseInt(prsResult.stdout.trim()) : 0;

        // Get repo URL
        const repoUrlResult = await executeCommand('git config --get remote.origin.url');
        let repoUrl = repoUrlResult.success ? repoUrlResult.stdout.trim() : '';
        if (repoUrl.endsWith('.git')) {
            repoUrl = repoUrl.slice(0, -4);
        }
        if (repoUrl.startsWith('git@github.com:')) {
            repoUrl = repoUrl.replace('git@github.com:', 'https://github.com/');
        }
        status.repoUrl = repoUrl;

        // Determine sync status
        const localCommit = await executeCommand('git rev-parse HEAD');
        const remoteCommit = await executeCommand(`git rev-parse origin/${status.currentBranch}`);
        status.status = (localCommit.stdout === remoteCommit.stdout) ? 'synced' : 'out-of-sync';

        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GitHub Actions Status
app.get('/api/status/actions', async (req, res) => {
    try {
        const status = {};

        // Get workflow runs (requires gh CLI)
        const workflowsResult = await executeCommand('gh run list --limit 10 --json conclusion,name,createdAt');

        if (workflowsResult.success) {
            const workflows = JSON.parse(workflowsResult.stdout);

            // Find latest runs for each workflow
            const stage1 = workflows.find(w => w.name.includes('Stage 1') || w.name.includes('deploy'));
            const stage2 = workflows.find(w => w.name.includes('Stage 2') || w.name.includes('testing'));
            const codeql = workflows.find(w => w.name.includes('CodeQL'));

            status.stage1 = stage1 ? stage1.conclusion : 'unknown';
            status.stage2 = stage2 ? stage2.conclusion : 'unknown';
            status.codeql = codeql ? codeql.conclusion : 'unknown';

            status.lastRun = workflows.length > 0 ? new Date(workflows[0].createdAt).toLocaleString() : 'N/A';

            status.allPassing = workflows.filter(w => w.conclusion === 'success').length === workflows.length;
            status.hasFailed = workflows.some(w => w.conclusion === 'failure');
        } else {
            status.stage1 = 'unknown';
            status.stage2 = 'unknown';
            status.codeql = 'unknown';
            status.lastRun = 'N/A';
            status.allPassing = false;
            status.hasFailed = false;
        }

        // Get actions URL
        const repoUrlResult = await executeCommand('git config --get remote.origin.url');
        let repoUrl = repoUrlResult.success ? repoUrlResult.stdout.trim() : '';
        if (repoUrl.endsWith('.git')) repoUrl = repoUrl.slice(0, -4);
        if (repoUrl.startsWith('git@github.com:')) {
            repoUrl = repoUrl.replace('git@github.com:', 'https://github.com/');
        }
        status.actionsUrl = `${repoUrl}/actions`;

        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Google Apps Script Status
app.get('/api/status/apps-script', async (req, res) => {
    try {
        const status = {};

        // Read .clasp.json
        const claspConfigPath = path.join(PROJECT_ROOT, '.clasp.json');
        if (await fileExists(claspConfigPath)) {
            const claspConfig = JSON.parse(await fs.readFile(claspConfigPath, 'utf-8'));
            status.scriptId = claspConfig.scriptId;
            status.scriptUrl = `https://script.google.com/d/${claspConfig.scriptId}/edit`;
        } else {
            status.scriptId = null;
            status.scriptUrl = null;
        }

        // Get deployment ID from environment or GitHub secrets
        const envPath = path.join(PROJECT_ROOT, '.env');
        if (await fileExists(envPath)) {
            const envContent = await fs.readFile(envPath, 'utf-8');
            const deploymentMatch = envContent.match(/DEPLOYMENT_ID=(.+)/);
            status.deploymentId = deploymentMatch ? deploymentMatch[1] : null;
        } else {
            status.deploymentId = null;
        }

        // Try to get health status from the deployment
        if (status.scriptId) {
            // This would require actual HTTP call to the deployed script
            // For now, we'll mark as unknown
            status.health = 'unknown';
        } else {
            status.health = 'unknown';
        }

        // Get last deploy time from git log
        const lastDeployResult = await executeCommand('git log -1 --all --grep="deploy" --pretty=format:"%cr"');
        status.lastDeploy = lastDeployResult.success ? lastDeployResult.stdout.trim() : 'N/A';

        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// QA Environment Status
app.get('/api/status/qa', async (req, res) => {
    try {
        const status = {};

        // Read QA environment variables
        const envPath = path.join(PROJECT_ROOT, '.env');
        if (await fileExists(envPath)) {
            const envContent = await fs.readFile(envPath, 'utf-8');

            const qaScriptMatch = envContent.match(/QA_SCRIPT_ID=(.+)/);
            const qaDeployMatch = envContent.match(/QA_DEPLOYMENT_ID=(.+)/);

            status.scriptId = qaScriptMatch ? qaScriptMatch[1] : null;
            status.deploymentId = qaDeployMatch ? qaDeployMatch[1] : null;
        } else {
            status.scriptId = null;
            status.deploymentId = null;
        }

        // Health check
        status.health = 'unknown';

        // Get last deploy time
        const lastDeployResult = await executeCommand('git log -1 --all --grep="qa" --pretty=format:"%cr"');
        status.lastDeploy = lastDeployResult.success ? lastDeployResult.stdout.trim() : 'N/A';

        status.qaUrl = status.scriptId ? `https://script.google.com/d/${status.scriptId}/edit` : null;

        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Clasp Sync Status
app.get('/api/status/clasp', async (req, res) => {
    try {
        const status = {};

        // Get clasp version
        const versionResult = await executeCommand('clasp --version');
        status.version = versionResult.success ? versionResult.stdout.trim() : 'N/A';

        // Check authentication
        const clasprcPath = path.join(require('os').homedir(), '.clasprc.json');
        status.authenticated = await fileExists(clasprcPath);
        status.configExists = await fileExists(path.join(PROJECT_ROOT, '.clasp.json'));

        // Check sync status (would need to compare local vs remote)
        status.sync = 'unknown';

        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Testing Status
app.get('/api/status/testing', async (req, res) => {
    try {
        const status = {};

        // Check for test results files
        const jestResultsPath = path.join(PROJECT_ROOT, 'test-results', 'jest-results.json');
        if (await fileExists(jestResultsPath)) {
            const jestResults = JSON.parse(await fs.readFile(jestResultsPath, 'utf-8'));
            status.jest = {
                passed: jestResults.numPassedTests || 0,
                failed: jestResults.numFailedTests || 0,
                total: jestResults.numTotalTests || 0
            };
        } else {
            status.jest = { passed: 0, failed: 0, total: 0 };
        }

        // Check Playwright results
        const playwrightResultsPath = path.join(PROJECT_ROOT, 'test-results', 'playwright-results.json');
        if (await fileExists(playwrightResultsPath)) {
            const playwrightResults = JSON.parse(await fs.readFile(playwrightResultsPath, 'utf-8'));
            status.playwright = {
                passed: playwrightResults.passed || 0,
                failed: playwrightResults.failed || 0,
                total: playwrightResults.total || 0
            };
        } else {
            status.playwright = { passed: 0, failed: 0, total: 0 };
        }

        // Check coverage
        const coveragePath = path.join(PROJECT_ROOT, 'coverage', 'coverage-summary.json');
        if (await fileExists(coveragePath)) {
            const coverage = JSON.parse(await fs.readFile(coveragePath, 'utf-8'));
            status.coverage = coverage.total?.lines?.pct || 0;
        } else {
            status.coverage = 0;
        }

        // Get last test run time
        const lastTestResult = await executeCommand('git log -1 --all --grep="test" --pretty=format:"%cr"');
        status.lastRun = lastTestResult.success ? lastTestResult.stdout.trim() : 'N/A';

        status.allPassing = (status.jest.failed === 0) && (status.playwright.failed === 0);
        status.hasFailed = (status.jest.failed > 0) || (status.playwright.failed > 0);

        status.reportsUrl = './test-results';

        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Hostinger Deployment Status
app.get('/api/status/hostinger', async (req, res) => {
    try {
        const status = {};

        status.domain = 'zeventbooks.com';
        status.proxyStatus = 'unknown';
        status.health = 'unknown';

        // Get last deploy time
        const lastDeployResult = await executeCommand('git log -1 --all --grep="hostinger" --pretty=format:"%cr"');
        status.lastDeploy = lastDeployResult.success ? lastDeployResult.stdout.trim() : 'N/A';

        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Execute Command
app.post('/api/execute', async (req, res) => {
    try {
        const { command } = req.body;

        if (!command) {
            return res.status(400).json({ success: false, error: 'No command provided' });
        }

        // Security: Whitelist of allowed commands
        const allowedCommands = [
            'git status',
            'git fetch',
            'git pull',
            'git push',
            'git add',
            'git commit',
            'npm install',
            'npm test',
            'npm run',
            'clasp',
            'gh workflow',
            'gh run',
            'gh pr'
        ];

        const isAllowed = allowedCommands.some(allowed => command.startsWith(allowed));

        if (!isAllowed) {
            return res.status(403).json({
                success: false,
                error: 'Command not allowed. Only git, npm, clasp, and gh commands are permitted.'
            });
        }

        console.log(`Executing command: ${command}`);
        const result = await executeCommand(command);

        res.json({
            success: result.success,
            output: result.stdout || result.stderr,
            error: result.error
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 DevOps Dashboard Server running on http://localhost:${PORT}`);
    console.log(`📊 Dashboard available at http://localhost:${PORT}\n`);
});
