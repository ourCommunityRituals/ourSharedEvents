/**
 * Test Results Dashboard Generator
 *
 * Generates comprehensive HTML dashboard with:
 * - Real-time test metrics
 * - Historical trends and charts
 * - Anomaly alerts
 * - Environment comparisons
 * - Intelligent recommendations
 */

const fs = require('fs').promises;
const path = require('path');
const { TestResultsTracker } = require('./test-results-tracker');

/**
 * Dashboard Generator Class
 */
class DashboardGenerator {
  constructor(options = {}) {
    this.resultsDir = options.resultsDir || path.join(__dirname, '../../.test-results');
    this.outputDir = options.outputDir || path.join(__dirname, '../../test-dashboard');
    this.tracker = new TestResultsTracker({ resultsDir: this.resultsDir });
  }

  /**
   * Initialize dashboard directory
   */
  async initialize() {
    await fs.mkdir(this.outputDir, { recursive: true });
    await this.tracker.initialize();
  }

  /**
   * Generate complete dashboard
   */
  async generate() {
    console.log('\n📊 Generating Test Dashboard...\n');

    await this.initialize();

    // Gather all data
    const summary = await this.tracker.generateSummary();
    const history = await this.tracker.getHistoricalResults(50);
    const trends = await this.tracker.calculateTrends(30);
    const anomalies = await this.tracker.detectAnomalies();

    // Generate HTML
    const html = this.generateHTML(summary, history, trends, anomalies);

    // Save dashboard
    const filepath = path.join(this.outputDir, 'index.html');
    await fs.writeFile(filepath, html);

    console.log(`✓ Dashboard generated: ${filepath}`);
    console.log(`\n🌐 Open in browser: file://${filepath}\n`);

    return filepath;
  }

  /**
   * Generate HTML dashboard
   */
  generateHTML(summary, history, trends, anomalies) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MVP Event Toolkit - Test Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #333;
            padding: 20px;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
        }

        header {
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }

        h1 {
            color: #667eea;
            font-size: 32px;
            margin-bottom: 10px;
        }

        .subtitle {
            color: #666;
            font-size: 16px;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }

        .stat-value {
            font-size: 36px;
            font-weight: bold;
            margin: 10px 0;
        }

        .stat-label {
            color: #666;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .stat-trend {
            font-size: 12px;
            margin-top: 5px;
            padding: 4px 8px;
            border-radius: 4px;
            display: inline-block;
        }

        .trend-improving {
            background: #d4edda;
            color: #155724;
        }

        .trend-degrading {
            background: #f8d7da;
            color: #721c24;
        }

        .trend-stable {
            background: #d1ecf1;
            color: #0c5460;
        }

        .success { color: #10b981; }
        .warning { color: #f59e0b; }
        .danger { color: #ef4444; }
        .info { color: #3b82f6; }

        .chart-container {
            background: white;
            padding: 25px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }

        .chart-container h2 {
            color: #667eea;
            margin-bottom: 20px;
            font-size: 20px;
        }

        .alerts {
            background: white;
            padding: 25px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }

        .alert {
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 15px;
            border-left: 4px solid;
        }

        .alert-critical {
            background: #fee;
            border-color: #ef4444;
        }

        .alert-high {
            background: #fef3cd;
            border-color: #f59e0b;
        }

        .alert-medium {
            background: #d1ecf1;
            border-color: #3b82f6;
        }

        .alert-low {
            background: #d4edda;
            border-color: #10b981;
        }

        .alert-title {
            font-weight: bold;
            margin-bottom: 5px;
        }

        .recommendations {
            background: white;
            padding: 25px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }

        .recommendation {
            padding: 15px;
            border-left: 4px solid #3b82f6;
            background: #f8f9fa;
            margin-bottom: 15px;
            border-radius: 4px;
        }

        .recommendation-title {
            font-weight: bold;
            color: #667eea;
            margin-bottom: 5px;
        }

        .recommendation-action {
            color: #666;
            font-size: 14px;
            font-style: italic;
        }

        .priority-critical { border-color: #ef4444; }
        .priority-high { border-color: #f59e0b; }
        .priority-medium { border-color: #3b82f6; }
        .priority-low { border-color: #10b981; }

        .badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            margin-left: 10px;
        }

        .badge-ci {
            background: #667eea;
            color: white;
        }

        .badge-local {
            background: #6c757d;
            color: white;
        }

        .environment-badge {
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: bold;
            display: inline-block;
            margin: 5px;
        }

        .env-qa { background: #fef3cd; color: #856404; }
        .env-production { background: #f8d7da; color: #721c24; }
        .env-local { background: #d1ecf1; color: #0c5460; }

        footer {
            text-align: center;
            color: white;
            margin-top: 30px;
            padding: 20px;
        }

        .timestamp {
            color: #999;
            font-size: 12px;
        }

        canvas {
            max-height: 400px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }

        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #dee2e6;
        }

        th {
            background: #f8f9fa;
            font-weight: bold;
            color: #667eea;
        }

        tr:hover {
            background: #f8f9fa;
        }

        .progress-bar {
            height: 20px;
            background: #e9ecef;
            border-radius: 10px;
            overflow: hidden;
            margin-top: 5px;
        }

        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #10b981, #059669);
            transition: width 0.3s ease;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🎯 MVP Event Toolkit - Test Dashboard</h1>
            <p class="subtitle">Comprehensive Testing Infrastructure & Analytics</p>
            <div style="margin-top: 15px;">
                <span class="environment-badge env-${summary.run.environment}">
                    ${summary.run.environment.toUpperCase()}
                </span>
                ${summary.run.ci ? '<span class="badge badge-ci">CI/CD</span>' : '<span class="badge badge-local">LOCAL</span>'}
                <span class="timestamp">Generated: ${new Date().toLocaleString()}</span>
            </div>
        </header>

        <!-- Key Metrics -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Success Rate</div>
                <div class="stat-value ${summary.metrics.successRate >= 90 ? 'success' : summary.metrics.successRate >= 70 ? 'warning' : 'danger'}">
                    ${summary.metrics.successRate}%
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${summary.metrics.successRate}%"></div>
                </div>
                ${trends ? `<div class="stat-trend trend-${trends.successRate.trend}">
                    ${trends.successRate.trend === 'improving' ? '📈 Improving' : trends.successRate.trend === 'degrading' ? '📉 Degrading' : '➡️ Stable'}
                </div>` : ''}
            </div>

            <div class="stat-card">
                <div class="stat-label">Total Tests</div>
                <div class="stat-value info">${summary.metrics.totalTests}</div>
                <div style="margin-top: 10px; color: #666;">
                    ✅ ${summary.metrics.totalPassed} passed<br>
                    ❌ ${summary.metrics.totalFailed} failed
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-label">Test Duration</div>
                <div class="stat-value">${(summary.metrics.duration / 1000).toFixed(1)}s</div>
                ${trends ? `<div style="color: #666; font-size: 14px; margin-top: 10px;">
                    Avg: ${(trends.duration.average / 1000).toFixed(1)}s
                </div>` : ''}
            </div>

            <div class="stat-card">
                <div class="stat-label">Coverage</div>
                <div class="stat-value ${summary.metrics.coverage ? 'success' : 'warning'}">
                    ${summary.metrics.coverage ? summary.metrics.coverage.lines.pct + '%' : 'N/A'}
                </div>
                ${summary.metrics.coverage ? `<div style="color: #666; font-size: 12px; margin-top: 10px;">
                    Lines: ${summary.metrics.coverage.lines.pct}%<br>
                    Functions: ${summary.metrics.coverage.functions.pct}%<br>
                    Branches: ${summary.metrics.coverage.branches.pct}%
                </div>` : ''}
            </div>
        </div>

        <!-- Anomaly Alerts -->
        ${anomalies && anomalies.length > 0 ? `
        <div class="alerts">
            <h2>🚨 Detected Anomalies</h2>
            ${anomalies.map(anomaly => `
            <div class="alert alert-${anomaly.severity}">
                <div class="alert-title">${anomaly.type.replace(/_/g, ' ').toUpperCase()}</div>
                <div>${anomaly.message}</div>
            </div>
            `).join('')}
        </div>
        ` : ''}

        <!-- Recommendations -->
        ${summary.recommendations && summary.recommendations.length > 0 ? `
        <div class="recommendations">
            <h2>💡 Recommendations</h2>
            ${summary.recommendations.map(rec => `
            <div class="recommendation priority-${rec.priority}">
                <div class="recommendation-title">
                    ${rec.category.toUpperCase()} - ${rec.priority.toUpperCase()} Priority
                </div>
                <div>${rec.message}</div>
                <div class="recommendation-action">→ ${rec.action}</div>
            </div>
            `).join('')}
        </div>
        ` : ''}

        <!-- Success Rate Trend -->
        <div class="chart-container">
            <h2>📈 Success Rate Trend (Last 30 Runs)</h2>
            <canvas id="successRateChart"></canvas>
        </div>

        <!-- Test Duration Trend -->
        <div class="chart-container">
            <h2>⏱️ Test Duration Trend (Last 30 Runs)</h2>
            <canvas id="durationChart"></canvas>
        </div>

        <!-- Test History Table -->
        <div class="chart-container">
            <h2>📜 Recent Test Runs</h2>
            <table>
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Environment</th>
                        <th>Branch</th>
                        <th>Tests</th>
                        <th>Passed</th>
                        <th>Failed</th>
                        <th>Success Rate</th>
                        <th>Duration</th>
                    </tr>
                </thead>
                <tbody>
                    ${history.slice(0, 10).map(run => `
                    <tr>
                        <td>${new Date(run.timestamp).toLocaleString()}</td>
                        <td><span class="environment-badge env-${run.environment}">${run.environment}</span></td>
                        <td>${run.branch}</td>
                        <td>${run.metrics.totalTests}</td>
                        <td class="success">${run.metrics.totalPassed}</td>
                        <td class="danger">${run.metrics.totalFailed}</td>
                        <td>${run.metrics.successRate}%</td>
                        <td>${(run.duration / 1000).toFixed(1)}s</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <!-- Framework Breakdown -->
        <div class="stats-grid">
            ${summary.run ? `
            <div class="stat-card">
                <h3 style="color: #667eea; margin-bottom: 15px;">Jest (Unit & Contract)</h3>
                ${this.currentRun?.results?.jest ? `
                <div>Total: ${this.currentRun.results.jest.numTotalTests}</div>
                <div class="success">Passed: ${this.currentRun.results.jest.numPassedTests}</div>
                <div class="danger">Failed: ${this.currentRun.results.jest.numFailedTests}</div>
                ` : '<div>No data</div>'}
            </div>

            <div class="stat-card">
                <h3 style="color: #667eea; margin-bottom: 15px;">Playwright (E2E)</h3>
                ${this.currentRun?.results?.playwright ? `
                <div>Total: ${this.currentRun.results.playwright.totalTests}</div>
                <div class="success">Passed: ${this.currentRun.results.playwright.passed}</div>
                <div class="danger">Failed: ${this.currentRun.results.playwright.failed}</div>
                <div class="warning">Flaky: ${this.currentRun.results.playwright.flaky}</div>
                ` : '<div>No data</div>'}
            </div>

            <div class="stat-card">
                <h3 style="color: #667eea; margin-bottom: 15px;">k6 (Performance)</h3>
                ${summary.metrics.performance ? `
                <div>Avg Response: ${summary.metrics.performance.avgResponseTime}ms</div>
                <div>P95: ${summary.metrics.performance.p95ResponseTime}ms</div>
                <div>RPS: ${summary.metrics.performance.requestsPerSecond}</div>
                <div>Error Rate: ${summary.metrics.performance.errorRate}%</div>
                ` : '<div>No data</div>'}
            </div>
            ` : ''}
        </div>

        <footer>
            <p>Generated by MVP Event Toolkit Test Infrastructure</p>
            <p style="margin-top: 10px; font-size: 12px;">
                Environment: ${summary.run.environment} | Branch: ${summary.run.branch} |
                ${summary.run.ci ? 'CI/CD Run' : 'Local Run'}
            </p>
        </footer>
    </div>

    <script>
        // Success Rate Chart
        const successRateCtx = document.getElementById('successRateChart').getContext('2d');
        new Chart(successRateCtx, {
            type: 'line',
            data: {
                labels: ${JSON.stringify(trends?.successRate?.dataPoints?.map(dp => new Date(dp.timestamp).toLocaleDateString()).reverse() || [])},
                datasets: [{
                    label: 'Success Rate (%)',
                    data: ${JSON.stringify(trends?.successRate?.dataPoints?.map(dp => dp.value).reverse() || [])},
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: true },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: { callback: value => value + '%' }
                    }
                }
            }
        });

        // Duration Chart
        const durationCtx = document.getElementById('durationChart').getContext('2d');
        new Chart(durationCtx, {
            type: 'bar',
            data: {
                labels: ${JSON.stringify(trends?.duration?.dataPoints?.map(dp => new Date(dp.timestamp).toLocaleDateString()).reverse() || [])},
                datasets: [{
                    label: 'Duration (ms)',
                    data: ${JSON.stringify(trends?.duration?.dataPoints?.map(dp => dp.value).reverse() || [])},
                    backgroundColor: 'rgba(102, 126, 234, 0.7)',
                    borderColor: '#667eea',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: true },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: value => (value / 1000).toFixed(1) + 's' }
                    }
                }
            }
        });
    </script>
</body>
</html>`;
  }
}

/**
 * CLI interface
 */
async function cli() {
  const args = process.argv.slice(2);
  const command = args[0] || 'generate';

  const generator = new DashboardGenerator();

  try {
    switch (command) {
      case 'generate':
        await generator.generate();
        break;

      default:
        console.log(`
Test Dashboard Generator CLI

Usage:
  node generate-dashboard.js [command]

Commands:
  generate    Generate HTML dashboard (default)

Examples:
  node generate-dashboard.js
  node generate-dashboard.js generate
        `);
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run CLI if executed directly
if (require.main === module) {
  cli();
}

module.exports = {
  DashboardGenerator,
  cli
};
