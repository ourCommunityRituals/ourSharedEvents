/**
 * Custom Playwright Reporter
 * Captures test results and stores them in the test history database
 */

const TestResultsDatabase = require('./test-results-database');
const { execSync } = require('child_process');

class HistoryReporter {
  constructor(options = {}) {
    this.db = new TestResultsDatabase();
    this.suite = options.suite || this.detectSuite();
    this.startTime = null;
    this.results = {
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      failures: []
    };
  }

  detectSuite() {
    // Detect which suite is running based on test path
    const testPath = process.env.PLAYWRIGHT_HTML_REPORT || '';
    if (testPath.includes('api')) return 'api';
    if (testPath.includes('smoke')) return 'smoke';
    if (testPath.includes('pages')) return 'pages';
    if (testPath.includes('flows')) return 'flows';
    return 'playwright';
  }

  getGitInfo() {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
      const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
      return { branch, commit };
    } catch (error) {
      return { branch: 'unknown', commit: 'unknown' };
    }
  }

  onBegin(_config, _suite) {
    this.startTime = new Date();
    console.log(`\n📊 Test History Reporter: Recording ${this.suite} suite results...`);
  }

  onTestEnd(test, result) {
    this.results.totalTests++;

    if (result.status === 'passed') {
      this.results.passed++;
    } else if (result.status === 'failed') {
      this.results.failed++;

      // Capture failure details
      this.results.failures.push({
        suite: test.parent.title,
        test: test.title,
        error: result.error?.message || 'Unknown error',
        stack: result.error?.stack,
        duration: result.duration,
        retry: result.retry
      });
    } else if (result.status === 'skipped') {
      this.results.skipped++;
    } else if (result.status === 'timedOut') {
      this.results.failed++;
      this.results.failures.push({
        suite: test.parent.title,
        test: test.title,
        error: 'Test timed out',
        duration: result.duration,
        retry: result.retry
      });
    }

    // Track flaky tests (passed on retry)
    if (result.retry > 0 && result.status === 'passed') {
      this.results.flaky++;
    }
  }

  onEnd(_result) {
    const endTime = new Date();
    const duration = endTime - this.startTime;
    const gitInfo = this.getGitInfo();

    const reportPath = process.env.PLAYWRIGHT_HTML_REPORT ||
                       `playwright-report-${this.suite}`;

    const runData = {
      id: `${this.suite}-${this.startTime.getTime()}`,
      suite: this.suite,
      startTime: this.startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration,
      totalTests: this.results.totalTests,
      passed: this.results.passed,
      failed: this.results.failed,
      skipped: this.results.skipped,
      flaky: this.results.flaky,
      failures: this.results.failures,
      reportPath,
      metadata: {
        branch: gitInfo.branch,
        commit: gitInfo.commit,
        environment: process.env.TEST_ENV || 'local',
        baseUrl: process.env.BASE_URL || process.env.GOOGLE_SCRIPT_URL || 'unknown',
        ci: !!process.env.CI,
        platform: process.platform,
        node: process.version
      }
    };

    this.db.addRun(runData);

    console.log(`\n✅ Test results saved to history database`);
    console.log(`   Suite: ${this.suite}`);
    console.log(`   Tests: ${this.results.passed}/${this.results.totalTests} passed`);
    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);

    if (this.results.flaky > 0) {
      console.log(`   Flaky: ${this.results.flaky} tests`);
    }

    console.log(`\n🔗 View history dashboard: npm run test:dashboard`);
  }

  printsToStdio() {
    return false; // Don't interfere with other reporters
  }
}

module.exports = HistoryReporter;
