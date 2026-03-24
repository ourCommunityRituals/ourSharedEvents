/**
 * Test Results Tracker
 *
 * Comprehensive test results aggregation and metrics tracking system:
 * - Collects results from Jest, Playwright, k6
 * - Tracks metrics over time
 * - Identifies trends and anomalies
 * - Provides data-driven insights
 * - Supports multi-environment tracking
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Test Results Tracker Class
 */
class TestResultsTracker {
  constructor(options = {}) {
    this.resultsDir = options.resultsDir || path.join(__dirname, '../../.test-results');
    this.environment = options.environment || process.env.TEST_ENV || 'unknown';
    this.brand = options.brand || process.env.BRAND_ID || 'root';
    this.ciRun = process.env.CI === 'true';
    this.gitBranch = process.env.GITHUB_REF_NAME || 'local';
    this.gitSha = process.env.GITHUB_SHA || 'unknown';
    this.runId = process.env.GITHUB_RUN_ID || Date.now().toString();

    this.currentRun = {
      id: this.runId,
      timestamp: new Date().toISOString(),
      environment: this.environment,
      brand: this.brand,
      ci: this.ciRun,
      branch: this.gitBranch,
      commit: this.gitSha,
      results: {
        jest: null,
        playwright: null,
        k6: null
      },
      metrics: {},
      duration: 0
    };

    this.startTime = Date.now();
  }

  /**
   * Initialize results directory
   */
  async initialize() {
    try {
      await fs.mkdir(this.resultsDir, { recursive: true });
      await fs.mkdir(path.join(this.resultsDir, 'runs'), { recursive: true });
      await fs.mkdir(path.join(this.resultsDir, 'metrics'), { recursive: true });
      await fs.mkdir(path.join(this.resultsDir, 'trends'), { recursive: true });
      console.log(`✓ Test results directory initialized: ${this.resultsDir}`);
    } catch (error) {
      console.error(`✗ Failed to initialize results directory: ${error.message}`);
      throw error;
    }
  }

  /**
   * Record Jest test results
   */
  async recordJestResults(jestResults) {
    const summary = {
      framework: 'jest',
      timestamp: new Date().toISOString(),
      numTotalTests: jestResults.numTotalTests || 0,
      numPassedTests: jestResults.numPassedTests || 0,
      numFailedTests: jestResults.numFailedTests || 0,
      numPendingTests: jestResults.numPendingTests || 0,
      success: jestResults.success || false,
      coverage: this.extractCoverage(jestResults),
      testSuites: jestResults.testResults?.map(suite => ({
        name: suite.testFilePath,
        status: suite.status,
        duration: suite.perfStats?.runtime || 0,
        tests: suite.testResults?.length || 0,
        failures: suite.numFailingTests || 0
      })) || []
    };

    this.currentRun.results.jest = summary;
    await this.saveRunResults();

    return summary;
  }

  /**
   * Extract coverage information from Jest results
   */
  extractCoverage(jestResults) {
    if (!jestResults.coverageMap) return null;

    const coverage = {
      lines: { total: 0, covered: 0, pct: 0 },
      statements: { total: 0, covered: 0, pct: 0 },
      functions: { total: 0, covered: 0, pct: 0 },
      branches: { total: 0, covered: 0, pct: 0 }
    };

    // Parse coverage from coverageMap if available
    // This is a simplified version
    return coverage;
  }

  /**
   * Record Playwright test results
   */
  async recordPlaywrightResults(playwrightResults) {
    const summary = {
      framework: 'playwright',
      timestamp: new Date().toISOString(),
      totalTests: playwrightResults.suites?.reduce((sum, suite) => sum + suite.specs.length, 0) || 0,
      passed: playwrightResults.stats?.expected || 0,
      failed: playwrightResults.stats?.unexpected || 0,
      flaky: playwrightResults.stats?.flaky || 0,
      skipped: playwrightResults.stats?.skipped || 0,
      duration: playwrightResults.stats?.duration || 0,
      suites: playwrightResults.suites?.map(suite => ({
        title: suite.title,
        file: suite.file,
        tests: suite.specs.length,
        passed: suite.specs.filter(s => s.ok).length,
        failed: suite.specs.filter(s => !s.ok && !s.skipped).length,
        skipped: suite.specs.filter(s => s.skipped).length
      })) || []
    };

    this.currentRun.results.playwright = summary;
    await this.saveRunResults();

    return summary;
  }

  /**
   * Record k6 load test results
   */
  async recordK6Results(k6Results) {
    const summary = {
      framework: 'k6',
      timestamp: new Date().toISOString(),
      metrics: {
        http_reqs: k6Results.metrics?.http_reqs || {},
        http_req_duration: k6Results.metrics?.http_req_duration || {},
        http_req_failed: k6Results.metrics?.http_req_failed || {},
        vus: k6Results.metrics?.vus || {},
        vus_max: k6Results.metrics?.vus_max || {},
        iterations: k6Results.metrics?.iterations || {}
      },
      thresholds: k6Results.thresholds || {},
      checks: k6Results.root_group?.checks || []
    };

    this.currentRun.results.k6 = summary;
    await this.saveRunResults();

    return summary;
  }

  /**
   * Parse Jest JSON results file
   */
  async parseJestResults(filepath) {
    try {
      const content = await fs.readFile(filepath, 'utf8');
      const results = JSON.parse(content);
      return await this.recordJestResults(results);
    } catch (error) {
      console.error(`Failed to parse Jest results: ${error.message}`);
      return null;
    }
  }

  /**
   * Parse Playwright JSON results file
   */
  async parsePlaywrightResults(filepath) {
    try {
      const content = await fs.readFile(filepath, 'utf8');
      const results = JSON.parse(content);
      return await this.recordPlaywrightResults(results);
    } catch (error) {
      console.error(`Failed to parse Playwright results: ${error.message}`);
      return null;
    }
  }

  /**
   * Parse k6 JSON results file
   */
  async parseK6Results(filepath) {
    try {
      const content = await fs.readFile(filepath, 'utf8');
      const results = JSON.parse(content);
      return await this.recordK6Results(results);
    } catch (error) {
      console.error(`Failed to parse k6 results: ${error.message}`);
      return null;
    }
  }

  /**
   * Calculate aggregated metrics
   */
  calculateMetrics() {
    const jest = this.currentRun.results.jest;
    const playwright = this.currentRun.results.playwright;
    const k6 = this.currentRun.results.k6;

    const metrics = {
      totalTests: 0,
      totalPassed: 0,
      totalFailed: 0,
      successRate: 0,
      duration: Date.now() - this.startTime,
      coverage: null,
      performance: null
    };

    // Aggregate Jest results
    if (jest) {
      metrics.totalTests += jest.numTotalTests;
      metrics.totalPassed += jest.numPassedTests;
      metrics.totalFailed += jest.numFailedTests;
      metrics.coverage = jest.coverage;
    }

    // Aggregate Playwright results
    if (playwright) {
      metrics.totalTests += playwright.totalTests;
      metrics.totalPassed += playwright.passed;
      metrics.totalFailed += playwright.failed;
    }

    // Add k6 performance metrics
    if (k6) {
      metrics.performance = {
        avgResponseTime: k6.metrics.http_req_duration?.avg || 0,
        p95ResponseTime: k6.metrics.http_req_duration?.['p(95)'] || 0,
        requestsPerSecond: k6.metrics.http_reqs?.rate || 0,
        errorRate: k6.metrics.http_req_failed?.rate || 0
      };
    }

    // Calculate success rate
    if (metrics.totalTests > 0) {
      metrics.successRate = (metrics.totalPassed / metrics.totalTests * 100).toFixed(2);
    }

    this.currentRun.metrics = metrics;
    this.currentRun.duration = metrics.duration;

    return metrics;
  }

  /**
   * Save current run results
   */
  async saveRunResults() {
    const filename = `run-${this.runId}.json`;
    const filepath = path.join(this.resultsDir, 'runs', filename);

    // Calculate metrics before saving
    this.calculateMetrics();

    await fs.writeFile(filepath, JSON.stringify(this.currentRun, null, 2));
    console.log(`📊 Test run saved: ${filename}`);

    // Update latest results
    await this.updateLatestResults();

    return filepath;
  }

  /**
   * Update latest results symlink/file
   */
  async updateLatestResults() {
    const latestPath = path.join(this.resultsDir, 'latest.json');
    await fs.writeFile(latestPath, JSON.stringify(this.currentRun, null, 2));
  }

  /**
   * Get historical results (last N runs)
   */
  async getHistoricalResults(limit = 10) {
    const runsDir = path.join(this.resultsDir, 'runs');

    try {
      const files = await fs.readdir(runsDir);
      const runFiles = files
        .filter(f => f.startsWith('run-') && f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, limit);

      const runs = [];
      for (const file of runFiles) {
        const content = await fs.readFile(path.join(runsDir, file), 'utf8');
        runs.push(JSON.parse(content));
      }

      return runs;
    } catch (error) {
      console.error(`Failed to get historical results: ${error.message}`);
      return [];
    }
  }

  /**
   * Calculate trends from historical data
   */
  async calculateTrends(limit = 30) {
    const history = await this.getHistoricalResults(limit);

    if (history.length === 0) {
      return null;
    }

    const trends = {
      successRate: {
        current: parseFloat(this.currentRun.metrics.successRate),
        average: 0,
        trend: 'stable',
        dataPoints: []
      },
      duration: {
        current: this.currentRun.duration,
        average: 0,
        trend: 'stable',
        dataPoints: []
      },
      failureRate: {
        current: 0,
        average: 0,
        trend: 'stable',
        dataPoints: []
      }
    };

    // Calculate averages and trends
    let totalSuccessRate = 0;
    let totalDuration = 0;

    history.forEach(run => {
      const successRate = parseFloat(run.metrics.successRate);
      const duration = run.duration;

      totalSuccessRate += successRate;
      totalDuration += duration;

      trends.successRate.dataPoints.push({
        timestamp: run.timestamp,
        value: successRate
      });

      trends.duration.dataPoints.push({
        timestamp: run.timestamp,
        value: duration
      });
    });

    trends.successRate.average = (totalSuccessRate / history.length).toFixed(2);
    trends.duration.average = Math.round(totalDuration / history.length);

    // Determine trend direction
    if (trends.successRate.dataPoints.length >= 5) {
      const recent = trends.successRate.dataPoints.slice(0, 5);
      const older = trends.successRate.dataPoints.slice(5, 10);

      if (older.length > 0) {
        const recentAvg = recent.reduce((sum, dp) => sum + dp.value, 0) / recent.length;
        const olderAvg = older.reduce((sum, dp) => sum + dp.value, 0) / older.length;

        if (recentAvg > olderAvg + 2) trends.successRate.trend = 'improving';
        else if (recentAvg < olderAvg - 2) trends.successRate.trend = 'degrading';
      }
    }

    // Save trends
    const trendsFile = path.join(this.resultsDir, 'trends', `trends-${Date.now()}.json`);
    await fs.writeFile(trendsFile, JSON.stringify(trends, null, 2));

    return trends;
  }

  /**
   * Detect anomalies in test results
   */
  async detectAnomalies() {
    const history = await this.getHistoricalResults(20);
    const anomalies = [];

    if (history.length < 5) {
      return anomalies; // Need enough history for anomaly detection
    }

    const current = this.currentRun.metrics;

    // Calculate statistical thresholds
    const successRates = history.map(r => parseFloat(r.metrics.successRate));
    const durations = history.map(r => r.duration);

    const avgSuccessRate = successRates.reduce((a, b) => a + b, 0) / successRates.length;
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

    // Standard deviation
    const successRateStdDev = Math.sqrt(
      successRates.reduce((sum, rate) => sum + Math.pow(rate - avgSuccessRate, 2), 0) / successRates.length
    );

    const durationStdDev = Math.sqrt(
      durations.reduce((sum, dur) => sum + Math.pow(dur - avgDuration, 2), 0) / durations.length
    );

    // Detect anomalies (2 standard deviations)
    const currentSuccessRate = parseFloat(current.successRate);
    if (Math.abs(currentSuccessRate - avgSuccessRate) > 2 * successRateStdDev) {
      anomalies.push({
        type: 'success_rate',
        severity: currentSuccessRate < avgSuccessRate ? 'high' : 'low',
        message: `Success rate (${currentSuccessRate}%) is ${currentSuccessRate < avgSuccessRate ? 'significantly lower' : 'significantly higher'} than average (${avgSuccessRate.toFixed(2)}%)`,
        current: currentSuccessRate,
        average: avgSuccessRate,
        threshold: 2 * successRateStdDev
      });
    }

    if (Math.abs(current.duration - avgDuration) > 2 * durationStdDev) {
      anomalies.push({
        type: 'duration',
        severity: current.duration > avgDuration ? 'medium' : 'low',
        message: `Test duration (${current.duration}ms) is ${current.duration > avgDuration ? 'significantly longer' : 'significantly shorter'} than average (${avgDuration.toFixed(0)}ms)`,
        current: current.duration,
        average: avgDuration,
        threshold: 2 * durationStdDev
      });
    }

    // Sudden spike in failures
    if (current.totalFailed > 0) {
      const recentFailures = history.slice(0, 5).map(r => r.metrics.totalFailed);
      const avgRecentFailures = recentFailures.reduce((a, b) => a + b, 0) / recentFailures.length;

      if (current.totalFailed > avgRecentFailures * 2) {
        anomalies.push({
          type: 'failure_spike',
          severity: 'high',
          message: `Failure count (${current.totalFailed}) is more than double the recent average (${avgRecentFailures.toFixed(1)})`,
          current: current.totalFailed,
          average: avgRecentFailures
        });
      }
    }

    return anomalies;
  }

  /**
   * Generate summary report
   */
  async generateSummary() {
    const metrics = this.calculateMetrics();
    const trends = await this.calculateTrends();
    const anomalies = await this.detectAnomalies();

    const summary = {
      run: {
        id: this.runId,
        timestamp: this.currentRun.timestamp,
        environment: this.environment,
        brand: this.brand,
        branch: this.gitBranch,
        ci: this.ciRun
      },
      metrics,
      trends,
      anomalies,
      recommendations: this.generateRecommendations(metrics, trends, anomalies)
    };

    return summary;
  }

  /**
   * Generate recommendations based on results
   */
  generateRecommendations(metrics, trends, anomalies) {
    const recommendations = [];

    // Success rate recommendations
    const successRate = parseFloat(metrics.successRate);
    if (successRate < 90) {
      recommendations.push({
        priority: 'high',
        category: 'quality',
        message: `Success rate (${successRate}%) is below 90%. Investigate failing tests.`,
        action: 'Review and fix failing tests'
      });
    }

    // Coverage recommendations
    if (metrics.coverage) {
      const lineCoverage = metrics.coverage.lines?.pct || 0;
      if (lineCoverage < 80) {
        recommendations.push({
          priority: 'medium',
          category: 'coverage',
          message: `Line coverage (${lineCoverage}%) is below 80%. Add more tests.`,
          action: 'Increase test coverage'
        });
      }
    }

    // Performance recommendations
    if (metrics.performance) {
      const p95 = metrics.performance.p95ResponseTime;
      if (p95 > 2000) {
        recommendations.push({
          priority: 'medium',
          category: 'performance',
          message: `P95 response time (${p95}ms) exceeds 2000ms threshold.`,
          action: 'Optimize slow endpoints'
        });
      }
    }

    // Trend-based recommendations
    if (trends && trends.successRate.trend === 'degrading') {
      recommendations.push({
        priority: 'high',
        category: 'trend',
        message: 'Success rate is trending downward over recent runs.',
        action: 'Investigate recent code changes'
      });
    }

    // Anomaly-based recommendations
    anomalies.forEach(anomaly => {
      if (anomaly.severity === 'high') {
        recommendations.push({
          priority: 'critical',
          category: 'anomaly',
          message: anomaly.message,
          action: 'Immediate investigation required'
        });
      }
    });

    return recommendations;
  }

  /**
   * Export results to CSV
   */
  async exportToCSV(limit = 100) {
    const history = await this.getHistoricalResults(limit);

    const headers = [
      'timestamp',
      'run_id',
      'environment',
      'branch',
      'total_tests',
      'passed',
      'failed',
      'success_rate',
      'duration_ms'
    ];

    const rows = history.map(run => [
      run.timestamp,
      run.id,
      run.environment,
      run.branch,
      run.metrics.totalTests,
      run.metrics.totalPassed,
      run.metrics.totalFailed,
      run.metrics.successRate,
      run.duration
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const filepath = path.join(this.resultsDir, 'export.csv');
    await fs.writeFile(filepath, csv);

    console.log(`📁 Results exported to CSV: ${filepath}`);
    return filepath;
  }
}

/**
 * CLI interface for test results tracking
 */
async function cli() {
  const args = process.argv.slice(2);
  const command = args[0];

  const tracker = new TestResultsTracker();
  await tracker.initialize();

  try {
    switch (command) {
      case 'parse-jest': {
        const jestFile = args[1];
        if (!jestFile) {
          console.error('❌ Please provide Jest results file path');
          process.exit(1);
        }
        await tracker.parseJestResults(jestFile);
        console.log('✓ Jest results parsed');
        break;
      }

      case 'parse-playwright': {
        const playwrightFile = args[1];
        if (!playwrightFile) {
          console.error('❌ Please provide Playwright results file path');
          process.exit(1);
        }
        await tracker.parsePlaywrightResults(playwrightFile);
        console.log('✓ Playwright results parsed');
        break;
      }

      case 'parse-k6': {
        const k6File = args[1];
        if (!k6File) {
          console.error('❌ Please provide k6 results file path');
          process.exit(1);
        }
        await tracker.parseK6Results(k6File);
        console.log('✓ k6 results parsed');
        break;
      }

      case 'summary': {
        const summary = await tracker.generateSummary();
        console.log('\n📊 Test Results Summary:');
        console.log(JSON.stringify(summary, null, 2));
        break;
      }

      case 'trends': {
        const limit = parseInt(args[1]) || 30;
        const trends = await tracker.calculateTrends(limit);
        console.log('\n📈 Test Trends:');
        console.log(JSON.stringify(trends, null, 2));
        break;
      }

      case 'anomalies': {
        const anomalies = await tracker.detectAnomalies();
        console.log('\n🚨 Detected Anomalies:');
        if (anomalies.length === 0) {
          console.log('No anomalies detected');
        } else {
          console.log(JSON.stringify(anomalies, null, 2));
        }
        break;
      }

      case 'export': {
        const exportLimit = parseInt(args[1]) || 100;
        await tracker.exportToCSV(exportLimit);
        break;
      }

      case 'history': {
        const historyLimit = parseInt(args[1]) || 10;
        const history = await tracker.getHistoricalResults(historyLimit);
        console.log(`\n📜 Last ${history.length} Test Runs:`);
        history.forEach(run => {
          console.log(`\n${run.timestamp} (${run.id})`);
          console.log(`  Environment: ${run.environment}`);
          console.log(`  Branch: ${run.branch}`);
          console.log(`  Tests: ${run.metrics.totalTests} (${run.metrics.successRate}% success)`);
          console.log(`  Duration: ${run.duration}ms`);
        });
        break;
      }

      default:
        console.log(`
Test Results Tracker CLI

Usage:
  node test-results-tracker.js <command> [options]

Commands:
  parse-jest <file>       Parse Jest JSON results file
  parse-playwright <file> Parse Playwright JSON results file
  parse-k6 <file>         Parse k6 JSON results file
  summary                 Generate comprehensive summary
  trends [limit]          Calculate trends (default: 30 runs)
  anomalies               Detect anomalies in latest run
  export [limit]          Export results to CSV (default: 100 runs)
  history [limit]         Show historical results (default: 10 runs)

Examples:
  node test-results-tracker.js parse-jest coverage/jest-results.json
  node test-results-tracker.js summary
  node test-results-tracker.js trends 50
  node test-results-tracker.js export 200
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
  TestResultsTracker,
  cli
};
