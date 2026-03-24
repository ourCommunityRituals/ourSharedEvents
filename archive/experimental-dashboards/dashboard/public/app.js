// DevOps Environment Monitor - Frontend Application

class DashboardApp {
    constructor() {
        this.apiBaseUrl = 'http://localhost:3001/api';
        this.refreshInterval = 30000; // 30 seconds
        this.refreshTimer = null;
        this.countdownTimer = null;
        this.nextRefreshSeconds = 30;

        this.init();
    }

    init() {
        this.attachEventListeners();
        this.loadAllStatus();
        this.startAutoRefresh();
    }

    attachEventListeners() {
        // Manual refresh button
        document.getElementById('manual-refresh').addEventListener('click', () => {
            this.loadAllStatus();
            this.resetRefreshTimer();
        });

        // Clear output button
        document.getElementById('clear-output').addEventListener('click', () => {
            this.clearOutput();
        });

        // Action buttons
        document.querySelectorAll('.btn-action').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const command = e.target.getAttribute('data-command');
                this.executeCommand(command, e.target);
            });
        });
    }

    async loadAllStatus() {
        this.updateLastUpdateTime();

        // Load all layer statuses in parallel
        await Promise.all([
            this.loadLocalStatus(),
            this.loadGitHubStatus(),
            this.loadGitHubActionsStatus(),
            this.loadAppsScriptStatus(),
            this.loadQAStatus(),
            this.loadClaspStatus(),
            this.loadTestingStatus(),
            this.loadHostingerStatus()
        ]);

        // Update sync overview
        this.updateSyncOverview();
    }

    async loadLocalStatus() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/status/local`);
            const data = await response.json();

            // Update UI
            document.getElementById('local-branch').textContent = data.branch || 'N/A';
            document.getElementById('local-uncommitted').textContent = data.uncommittedChanges || '0';
            document.getElementById('local-unpushed').textContent = data.unpushedCommits || '0';
            document.getElementById('local-node-modules').textContent = data.nodeModules ? '✓ Installed' : '✗ Missing';
            document.getElementById('local-env-file').textContent = data.envFile ? '✓ Present' : '✗ Missing';

            // Update status badge
            const badge = document.getElementById('badge-local');
            const status = document.getElementById('status-local');

            if (data.uncommittedChanges > 0 || data.unpushedCommits > 0) {
                this.setStatus(badge, status, 'out-of-sync', 'Out of Sync');
            } else {
                this.setStatus(badge, status, 'synced', 'Synced');
            }
        } catch (error) {
            console.error('Error loading local status:', error);
            this.setStatus(
                document.getElementById('badge-local'),
                document.getElementById('status-local'),
                'error',
                'Error'
            );
        }
    }

    async loadGitHubStatus() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/status/github`);
            const data = await response.json();

            // Update UI
            document.getElementById('github-main-commit').textContent = data.mainCommit?.substring(0, 7) || 'N/A';
            document.getElementById('github-current-branch').textContent = data.currentBranch || 'N/A';
            document.getElementById('github-last-commit').textContent = data.lastCommit || 'N/A';
            document.getElementById('github-prs').textContent = data.openPRs || '0';
            document.getElementById('github-url').href = data.repoUrl || '#';

            // Update status badge
            const badge = document.getElementById('badge-github');
            const status = document.getElementById('status-github');

            if (data.status === 'synced') {
                this.setStatus(badge, status, 'synced', 'Synced');
            } else {
                this.setStatus(badge, status, 'out-of-sync', 'Out of Sync');
            }
        } catch (error) {
            console.error('Error loading GitHub status:', error);
            this.setStatus(
                document.getElementById('badge-github'),
                document.getElementById('status-github'),
                'error',
                'Error'
            );
        }
    }

    async loadGitHubActionsStatus() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/status/actions`);
            const data = await response.json();

            // Update UI
            document.getElementById('actions-stage1').innerHTML = this.getWorkflowStatusHTML(data.stage1);
            document.getElementById('actions-stage2').innerHTML = this.getWorkflowStatusHTML(data.stage2);
            document.getElementById('actions-codeql').innerHTML = this.getWorkflowStatusHTML(data.codeql);
            document.getElementById('actions-last-run').textContent = data.lastRun || 'N/A';
            document.getElementById('actions-url').href = data.actionsUrl || '#';

            // Update status badge
            const badge = document.getElementById('badge-actions');
            const status = document.getElementById('status-actions');

            if (data.allPassing) {
                this.setStatus(badge, status, 'synced', 'Passing');
            } else if (data.hasFailed) {
                this.setStatus(badge, status, 'error', 'Failed');
            } else {
                this.setStatus(badge, status, 'out-of-sync', 'Running');
            }
        } catch (error) {
            console.error('Error loading GitHub Actions status:', error);
            this.setStatus(
                document.getElementById('badge-actions'),
                document.getElementById('status-actions'),
                'error',
                'Error'
            );
        }
    }

    async loadAppsScriptStatus() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/status/apps-script`);
            const data = await response.json();

            // Update UI
            document.getElementById('apps-script-id').textContent = data.scriptId || 'N/A';
            document.getElementById('apps-script-deployment-id').textContent = data.deploymentId || 'N/A';
            document.getElementById('apps-script-health').innerHTML = this.getHealthStatusHTML(data.health);
            document.getElementById('apps-script-last-deploy').textContent = data.lastDeploy || 'N/A';
            document.getElementById('apps-script-url').href = data.scriptUrl || '#';

            // Update status badge
            const badge = document.getElementById('badge-apps-script');
            const status = document.getElementById('status-apps-script');
            const deployStatus = document.getElementById('status-deploy');

            if (data.health === 'healthy') {
                this.setStatus(badge, status, 'synced', 'Healthy');
                if (deployStatus) deployStatus.className = 'node-status status-synced';
            } else if (data.health === 'unhealthy') {
                this.setStatus(badge, status, 'error', 'Unhealthy');
                if (deployStatus) deployStatus.className = 'node-status status-error';
            } else {
                this.setStatus(badge, status, 'unknown', 'Unknown');
                if (deployStatus) deployStatus.className = 'node-status';
            }
        } catch (error) {
            console.error('Error loading Apps Script status:', error);
            this.setStatus(
                document.getElementById('badge-apps-script'),
                document.getElementById('status-apps-script'),
                'error',
                'Error'
            );
            const deployStatus = document.getElementById('status-deploy');
            if (deployStatus) deployStatus.className = 'node-status status-error';
        }
    }

    async loadQAStatus() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/status/qa`);
            const data = await response.json();

            // Update UI
            document.getElementById('qa-script-id').textContent = data.scriptId || 'N/A';
            document.getElementById('qa-deployment-id').textContent = data.deploymentId || 'N/A';
            document.getElementById('qa-health').innerHTML = this.getHealthStatusHTML(data.health);
            document.getElementById('qa-last-deploy').textContent = data.lastDeploy || 'N/A';
            document.getElementById('qa-url').href = data.qaUrl || '#';

            // Update status badge
            const badge = document.getElementById('badge-qa');
            const status = document.getElementById('status-qa');

            if (data.health === 'healthy') {
                this.setStatus(badge, status, 'synced', 'Healthy');
            } else if (data.health === 'unhealthy') {
                this.setStatus(badge, status, 'error', 'Unhealthy');
            } else {
                this.setStatus(badge, status, 'unknown', 'Unknown');
            }
        } catch (error) {
            console.error('Error loading QA status:', error);
            this.setStatus(
                document.getElementById('badge-qa'),
                document.getElementById('status-qa'),
                'error',
                'Error'
            );
        }
    }

    async loadClaspStatus() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/status/clasp`);
            const data = await response.json();

            // Update UI
            document.getElementById('clasp-version').textContent = data.version || 'N/A';
            document.getElementById('clasp-sync').innerHTML = this.getSyncStatusHTML(data.sync);
            document.getElementById('clasp-auth').textContent = data.authenticated ? '✓ Authenticated' : '✗ Not Authenticated';
            document.getElementById('clasp-config').textContent = data.configExists ? '✓ Present' : '✗ Missing';

            // Update status badge
            const badge = document.getElementById('badge-clasp');
            const status = document.getElementById('status-clasp');

            if (data.sync === 'synced') {
                this.setStatus(badge, status, 'synced', 'Synced');
            } else if (data.sync === 'out-of-sync') {
                this.setStatus(badge, status, 'out-of-sync', 'Out of Sync');
            } else {
                this.setStatus(badge, status, 'unknown', 'Unknown');
            }
        } catch (error) {
            console.error('Error loading Clasp status:', error);
            this.setStatus(
                document.getElementById('badge-clasp'),
                document.getElementById('status-clasp'),
                'error',
                'Error'
            );
        }
    }

    async loadTestingStatus() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/status/testing`);
            const data = await response.json();

            // Update UI
            document.getElementById('test-jest').innerHTML = this.getTestStatusHTML(data.jest);
            document.getElementById('test-playwright').innerHTML = this.getTestStatusHTML(data.playwright);
            document.getElementById('test-coverage').textContent = data.coverage ? `${data.coverage}%` : 'N/A';
            document.getElementById('test-last-run').textContent = data.lastRun || 'N/A';
            document.getElementById('test-reports').href = data.reportsUrl || '#';

            // Update status badge
            const badge = document.getElementById('badge-testing');
            const status = document.getElementById('status-testing');
            const testSyncStatus = document.getElementById('status-test');

            if (data.allPassing) {
                this.setStatus(badge, status, 'synced', 'Passing');
                if (testSyncStatus) testSyncStatus.className = 'node-status status-synced';
            } else if (data.hasFailed) {
                this.setStatus(badge, status, 'error', 'Failed');
                if (testSyncStatus) testSyncStatus.className = 'node-status status-error';
            } else {
                this.setStatus(badge, status, 'unknown', 'Unknown');
                if (testSyncStatus) testSyncStatus.className = 'node-status';
            }
        } catch (error) {
            console.error('Error loading Testing status:', error);
            this.setStatus(
                document.getElementById('badge-testing'),
                document.getElementById('status-testing'),
                'error',
                'Error'
            );
            const testSyncStatus = document.getElementById('status-test');
            if (testSyncStatus) testSyncStatus.className = 'node-status status-error';
        }
    }

    async loadHostingerStatus() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/status/hostinger`);
            const data = await response.json();

            // Update UI
            document.getElementById('hostinger-domain').textContent = data.domain || 'zeventbooks.com';
            document.getElementById('hostinger-proxy').textContent = data.proxyStatus || 'Unknown';
            document.getElementById('hostinger-health').innerHTML = this.getHealthStatusHTML(data.health);
            document.getElementById('hostinger-last-deploy').textContent = data.lastDeploy || 'N/A';

            // Update status badge
            const badge = document.getElementById('badge-hostinger');
            const status = document.getElementById('status-hostinger');

            if (data.health === 'healthy') {
                this.setStatus(badge, status, 'synced', 'Healthy');
            } else if (data.health === 'unhealthy') {
                this.setStatus(badge, status, 'error', 'Unhealthy');
            } else {
                this.setStatus(badge, status, 'unknown', 'Unknown');
            }
        } catch (error) {
            console.error('Error loading Hostinger status:', error);
            this.setStatus(
                document.getElementById('badge-hostinger'),
                document.getElementById('status-hostinger'),
                'error',
                'Error'
            );
        }
    }

    updateSyncOverview() {
        // This would analyze all layer statuses and update the sync flow visualization
        // For now, we'll update based on individual statuses
        const layers = ['local', 'github', 'actions', 'deploy', 'test'];

        layers.forEach(layer => {
            const statusElement = document.getElementById(`status-${layer}`);
            if (statusElement) {
                // Status already set by individual load functions
            }
        });
    }

    async executeCommand(command, button) {
        if (!command || command.startsWith('#')) {
            this.logOutput(`ℹ️ Info: ${command.replace('#', '').trim()}`, 'info');
            return;
        }

        // Disable button during execution
        button.disabled = true;
        button.classList.add('loading');

        this.logOutput(`$ ${command}`, 'command');

        try {
            const response = await fetch(`${this.apiBaseUrl}/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ command })
            });

            const data = await response.json();

            if (data.success) {
                this.logOutput(data.output || 'Command executed successfully', 'success');
                // Refresh status after command execution
                setTimeout(() => this.loadAllStatus(), 1000);
            } else {
                this.logOutput(data.error || 'Command failed', 'error');
            }
        } catch (error) {
            this.logOutput(`Error: ${error.message}`, 'error');
        } finally {
            button.disabled = false;
            button.classList.remove('loading');
        }
    }

    logOutput(message, type = 'info') {
        const outputDiv = document.getElementById('command-output');
        const timestamp = new Date().toLocaleTimeString();

        // Remove placeholder if it exists
        const placeholder = outputDiv.querySelector('.output-placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        const entry = document.createElement('div');
        entry.className = `output-entry output-${type}`;

        if (type === 'command') {
            entry.innerHTML = `<div class="output-command">${message}</div>`;
        } else {
            entry.innerHTML = `<div class="output-timestamp">[${timestamp}]</div><div class="output-result">${message}</div>`;
        }

        outputDiv.appendChild(entry);
        outputDiv.scrollTop = outputDiv.scrollHeight;
    }

    clearOutput() {
        const outputDiv = document.getElementById('command-output');
        outputDiv.innerHTML = '<p class="output-placeholder">Click any action button to see command output here...</p>';
    }

    setStatus(badgeElement, statusElement, status, text) {
        // Update badge
        badgeElement.className = 'status-badge';
        badgeElement.classList.add(`status-${status}`);
        badgeElement.textContent = text;

        // Update status indicator
        statusElement.className = 'node-status';
        statusElement.classList.add(`status-${status}`);
    }

    getWorkflowStatusHTML(workflowStatus) {
        if (!workflowStatus) return '<span class="indicator-error">N/A</span>';

        const statusClass = workflowStatus === 'success' ? 'success' :
                          workflowStatus === 'failure' ? 'error' : 'warning';
        const icon = workflowStatus === 'success' ? '✓' :
                    workflowStatus === 'failure' ? '✗' : '⏳';

        return `<span class="indicator-${statusClass}">${icon} ${workflowStatus}</span>`;
    }

    getHealthStatusHTML(health) {
        if (!health) return '<span class="indicator-error">Unknown</span>';

        const statusClass = health === 'healthy' ? 'success' :
                          health === 'unhealthy' ? 'error' : 'warning';
        const icon = health === 'healthy' ? '✓' :
                    health === 'unhealthy' ? '✗' : '?';

        return `<span class="indicator-${statusClass}">${icon} ${health}</span>`;
    }

    getSyncStatusHTML(sync) {
        if (!sync) return '<span class="indicator-error">Unknown</span>';

        const statusClass = sync === 'synced' ? 'success' :
                          sync === 'out-of-sync' ? 'warning' : 'error';
        const icon = sync === 'synced' ? '✓' :
                    sync === 'out-of-sync' ? '⚠' : '✗';

        return `<span class="indicator-${statusClass}">${icon} ${sync}</span>`;
    }

    getTestStatusHTML(testResult) {
        if (!testResult) return '<span class="indicator-error">N/A</span>';

        const { passed, failed, total } = testResult;

        if (failed > 0) {
            return `<span class="indicator-error">✗ ${passed}/${total} passed</span>`;
        } else if (passed === total) {
            return `<span class="indicator-success">✓ ${passed}/${total} passed</span>`;
        } else {
            return `<span class="indicator-warning">⏳ ${passed}/${total} passed</span>`;
        }
    }

    startAutoRefresh() {
        // Clear any existing timers
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        if (this.countdownTimer) clearInterval(this.countdownTimer);

        // Start refresh timer
        this.refreshTimer = setInterval(() => {
            this.loadAllStatus();
            this.nextRefreshSeconds = 30;
        }, this.refreshInterval);

        // Start countdown timer
        this.nextRefreshSeconds = 30;
        this.countdownTimer = setInterval(() => {
            this.nextRefreshSeconds--;
            document.getElementById('next-refresh').textContent = `Next refresh in: ${this.nextRefreshSeconds}s`;

            if (this.nextRefreshSeconds <= 0) {
                this.nextRefreshSeconds = 30;
            }
        }, 1000);
    }

    resetRefreshTimer() {
        this.nextRefreshSeconds = 30;
        this.startAutoRefresh();
    }

    updateLastUpdateTime() {
        const now = new Date().toLocaleTimeString();
        document.getElementById('last-update').textContent = `Last updated: ${now}`;
    }
}

// Initialize the dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new DashboardApp();
});
