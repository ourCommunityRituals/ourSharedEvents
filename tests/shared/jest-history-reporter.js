/**
 * Custom Jest Reporter
 * Captures Jest test results and stores them in the test history database
 */

const TestResultsDatabase = require('./test-results-database');
const { execSync } = require('child_process');

class JestHistoryReporter {
  constructor(globalConfig, options) {
    this.globalConfig = globalConfig;
    this.options = options;
    this.db = new TestResultsDatabase();
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

  detectSuite(results) {
    // Detect if this is unit or contract tests based on file paths
    const testFiles = results.testResults.map(r => r.testFilePath);
    const hasContract = testFiles.some(f => f.includes('/contract/'));
    const hasUnit = testFiles.some(f => f.includes('/unit/'));

    if (hasContract && !hasUnit) return 'contract';
    if (hasUnit && !hasContract) return 'unit';
    if (hasContract && hasUnit) return 'unit+contract';
    return 'jest';
  }

  onRunComplete(contexts, results) {
    const suite = this.detectSuite(results);
    const gitInfo = this.getGitInfo();

    const failures = [];
    results.testResults.forEach(testResult => {
      testResult.testResults.forEach(test => {
        if (test.status === 'failed') {
          failures.push({
            suite: testResult.testFilePath.split('/').pop().replace('.test.js', ''),
            test: test.fullName,
            error: test.failureMessages.join('\n'),
            duration: test.duration
          });
        }
      });
    });

    const runData = {
      id: `${suite}-${results.startTime}`,
      suite,
      startTime: new Date(results.startTime).toISOString(),
      endTime: new Date().toISOString(),
      duration: Date.now() - results.startTime,
      totalTests: results.numTotalTests,
      passed: results.numPassedTests,
      failed: results.numFailedTests,
      skipped: results.numPendingTests,
      flaky: 0,
      failures,
      reportPath: null,
      metadata: {
        branch: gitInfo.branch,
        commit: gitInfo.commit,
        environment: process.env.TEST_ENV || 'local',
        ci: !!process.env.CI,
        platform: process.platform,
        node: process.version
      }
    };

    this.db.addRun(runData);

    console.log(`\n✅ Test results saved to history database`);
    console.log(`   Suite: ${suite}`);
    console.log(`   Tests: ${results.numPassedTests}/${results.numTotalTests} passed`);
    console.log(`   Duration: ${((Date.now() - results.startTime) / 1000).toFixed(2)}s`);
    console.log(`\n🔗 View history dashboard: npm run test:dashboard`);
  }
}

module.exports = JestHistoryReporter;
