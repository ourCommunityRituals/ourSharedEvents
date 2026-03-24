/**
 * Test Prioritizer (NOT a Test Selector)
 *
 * Uses historical test data to prioritize test execution order for fast feedback:
 * - ✅ ALL TESTS STILL RUN (no tests are skipped)
 * - ✅ Reorders tests to run high-risk tests first
 * - ✅ Provides context when stable tests fail
 * - ✅ Flags flaky tests for investigation
 * - ✅ Identifies optimization opportunities
 *
 * ⚠️ IMPORTANT: This does NOT skip tests based on history.
 * Historical patterns don't predict new bugs. Tests catch anomalies, not reinforce patterns.
 *
 * Purpose: Fast feedback (know about failures in 5 seconds, not 50 seconds)
 */

const path = require('path');
const { TestResultsTracker } = require('./test-results-tracker');

/**
 * Test Prioritizer Class
 */
class TestPrioritizer {
  constructor(options = {}) {
    this.resultsDir = options.resultsDir || path.join(__dirname, '../../.test-results');
    this.tracker = new TestResultsTracker({ resultsDir: this.resultsDir });
    this.historyLimit = options.historyLimit || 50;

    // Risk scoring weights
    this.weights = {
      recentFailure: 10,     // Recently failed tests (highest priority)
      flakyTest: 8,          // Flaky tests that need attention
      criticalPath: 7,       // Critical user paths (smoke, API, security)
      changedCode: 9,        // Tests for recently changed code
      performanceIssue: 6,   // Tests with performance degradation
      newTest: 5             // Recently added tests (less history)
    };
  }

  /**
   * Initialize prioritizer
   */
  async initialize() {
    await this.tracker.initialize();
  }

  /**
   * Analyze test history and build test database
   */
  async analyzeHistory() {
    const history = await this.tracker.getHistoricalResults(this.historyLimit);

    const testDatabase = {
      tests: {},
      suites: {},
      stats: {
        totalRuns: history.length,
        totalTests: 0,
        flakyTests: [],
        slowTests: [],
        failingTests: [],
        stableTests: []
      }
    };

    // Analyze each historical run
    history.forEach(run => {
      // Process Jest results
      if (run.results.jest?.testSuites) {
        run.results.jest.testSuites.forEach(suite => {
          const suiteName = path.basename(suite.name);

          if (!testDatabase.suites[suiteName]) {
            testDatabase.suites[suiteName] = {
              name: suiteName,
              runs: 0,
              passes: 0,
              failures: 0,
              avgDuration: 0,
              durations: [],
              lastRun: null,
              flaky: false,
              stable: false
            };
          }

          const suiteData = testDatabase.suites[suiteName];
          suiteData.runs++;
          suiteData.durations.push(suite.duration);
          suiteData.lastRun = run.timestamp;

          if (suite.failures > 0) {
            suiteData.failures++;
          } else {
            suiteData.passes++;
          }
        });
      }

      // Process Playwright results
      if (run.results.playwright?.suites) {
        run.results.playwright.suites.forEach(suite => {
          const suiteName = path.basename(suite.file);

          if (!testDatabase.suites[suiteName]) {
            testDatabase.suites[suiteName] = {
              name: suiteName,
              runs: 0,
              passes: 0,
              failures: 0,
              avgDuration: 0,
              durations: [],
              lastRun: null,
              flaky: false,
              stable: false
            };
          }

          const suiteData = testDatabase.suites[suiteName];
          suiteData.runs++;
          suiteData.lastRun = run.timestamp;

          if (suite.failed > 0) {
            suiteData.failures++;
          } else {
            suiteData.passes++;
          }
        });
      }
    });

    // Calculate statistics
    Object.values(testDatabase.suites).forEach(suite => {
      // Calculate average duration
      if (suite.durations.length > 0) {
        suite.avgDuration = suite.durations.reduce((a, b) => a + b, 0) / suite.durations.length;
      }

      // Detect flaky tests (intermittent failures)
      if (suite.runs >= 5) {
        const failureRate = suite.failures / suite.runs;
        if (failureRate > 0.1 && failureRate < 0.9) {
          suite.flaky = true;
          testDatabase.stats.flakyTests.push(suite.name);
        }
      }

      // Detect stable tests (consistently passing)
      if (suite.runs >= 10) {
        const successRate = suite.passes / suite.runs;
        if (successRate >= 0.95) {
          suite.stable = true;
          testDatabase.stats.stableTests.push(suite.name);
        }
      }

      // Detect slow tests
      if (suite.durations.length >= 5 && suite.avgDuration > 5000) {
        testDatabase.stats.slowTests.push(suite.name);
      }

      // Track currently failing tests
      if (suite.failures > 0 && suite.runs >= 3) {
        const recentFailureRate = suite.failures / Math.min(suite.runs, 5);
        if (recentFailureRate > 0.5) {
          testDatabase.stats.failingTests.push(suite.name);
        }
      }
    });

    testDatabase.stats.totalTests = Object.keys(testDatabase.suites).length;

    return testDatabase;
  }

  /**
   * Calculate test risk score (for prioritization)
   */
  calculateRiskScore(suite, context = {}) {
    let score = 0;

    // Recent failure (HIGH RISK)
    if (suite.failures > 0) {
      const recentFailureRate = suite.failures / suite.runs;
      score += this.weights.recentFailure * recentFailureRate * 10;
    }

    // Flaky test (HIGH RISK - needs attention)
    if (suite.flaky) {
      score += this.weights.flakyTest;
    }

    // Critical path tests (smoke, API, security)
    const criticalPaths = ['smoke', 'critical', 'api', 'security'];
    if (criticalPaths.some(path => suite.name.toLowerCase().includes(path))) {
      score += this.weights.criticalPath;
    }

    // Recently changed code (if context provided)
    if (context.changedFiles && context.changedFiles.length > 0) {
      const matchesChangedFile = context.changedFiles.some(file =>
        suite.name.includes(path.basename(file, path.extname(file)))
      );
      if (matchesChangedFile) {
        score += this.weights.changedCode;
      }
    }

    // Performance issues
    if (suite.avgDuration > 10000) {
      score += this.weights.performanceIssue;
    }

    // New tests (less history)
    if (suite.runs < 5) {
      score += this.weights.newTest;
    }

    return score;
  }

  /**
   * Prioritize ALL tests (does NOT skip any tests)
   *
   * @returns {Object} All tests in priority order (high-risk first)
   */
  async prioritizeTests(context = {}) {
    const testDatabase = await this.analyzeHistory();

    // Get ALL tests from database
    const allTests = Object.values(testDatabase.suites).map(suite => ({
      name: suite.name,
      riskScore: this.calculateRiskScore(suite, context),
      reason: this.getRiskReason(suite, context),
      estimatedDuration: suite.avgDuration,
      flaky: suite.flaky,
      stable: suite.stable,
      recentFailures: suite.failures
    }));

    // Sort by risk score (highest first = run first)
    allTests.sort((a, b) => b.riskScore - a.riskScore);

    return {
      tests: allTests,
      totalTests: allTests.length,
      stats: testDatabase.stats,
      message: `⚠️ ALL ${allTests.length} TESTS WILL RUN. This prioritization only affects execution order for faster feedback.`
    };
  }

  /**
   * Get human-readable risk reason
   */
  getRiskReason(suite, context) {
    const reasons = [];

    if (suite.failures > 0) {
      reasons.push(`${suite.failures} recent failure(s)`);
    }

    if (suite.flaky) {
      reasons.push('Flaky test');
    }

    const criticalPaths = ['smoke', 'critical', 'api', 'security'];
    if (criticalPaths.some(path => suite.name.toLowerCase().includes(path))) {
      reasons.push('Critical path');
    }

    if (context.changedFiles && context.changedFiles.length > 0) {
      const matchesChangedFile = context.changedFiles.some(file =>
        suite.name.includes(path.basename(file, path.extname(file)))
      );
      if (matchesChangedFile) {
        reasons.push('Related to code changes');
      }
    }

    if (suite.avgDuration > 10000) {
      reasons.push('Performance concern');
    }

    if (suite.stable) {
      reasons.push('Historically stable');
    }

    return reasons.length > 0 ? reasons.join(', ') : 'Standard test';
  }

  /**
   * Generate execution plan with prioritized order
   * ⚠️ All tests included, just reordered
   */
  async generateExecutionPlan(context = {}) {
    const prioritization = await this.prioritizeTests(context);

    const plan = {
      timestamp: new Date().toISOString(),
      totalTests: prioritization.totalTests,
      estimatedDuration: prioritization.tests.reduce((sum, t) => sum + (t.estimatedDuration || 0), 0),
      tests: prioritization.tests,
      phases: this.createPhases(prioritization.tests),
      stats: prioritization.stats,
      note: '⚠️ ALL TESTS RUN - This is prioritization for fast feedback, not test selection.'
    };

    return plan;
  }

  /**
   * Create execution phases (for fast feedback)
   */
  createPhases(tests) {
    const phases = {
      critical: [],      // Run first (high risk)
      high: [],          // Run second
      medium: [],        // Run third
      low: []            // Run last (stable tests)
    };

    tests.forEach(test => {
      if (test.riskScore >= 15) {
        phases.critical.push(test.name);
      } else if (test.riskScore >= 10) {
        phases.high.push(test.name);
      } else if (test.riskScore >= 5) {
        phases.medium.push(test.name);
      } else {
        phases.low.push(test.name);
      }
    });

    return phases;
  }

  /**
   * Detect anomalies (for reporting, not decision-making)
   */
  async detectAnomalies(currentResults) {
    const testDatabase = await this.analyzeHistory();
    const anomalies = [];

    // Check for stable tests that are now failing
    Object.values(testDatabase.suites).forEach(suite => {
      if (suite.stable && currentResults?.failedTests?.includes(suite.name)) {
        anomalies.push({
          type: 'stable_test_failure',
          severity: 'high',
          test: suite.name,
          message: `⚠️ "${suite.name}" was stable for ${suite.passes} runs but is now failing`,
          context: `This test had a ${((suite.passes / suite.runs) * 100).toFixed(1)}% success rate over ${suite.runs} runs`,
          action: 'Investigate immediately - this indicates a real regression'
        });
      }
    });

    // Check for new flaky behavior
    testDatabase.stats.flakyTests.forEach(testName => {
      anomalies.push({
        type: 'flaky_test',
        severity: 'medium',
        test: testName,
        message: `⚠️ "${testName}" shows flaky behavior`,
        context: 'Intermittent failures detected in recent runs',
        action: 'Stabilize this test or investigate underlying issue'
      });
    });

    return anomalies;
  }

  /**
   * Get optimization recommendations
   */
  async getOptimizationRecommendations() {
    const testDatabase = await this.analyzeHistory();
    const recommendations = [];

    // Flaky tests
    if (testDatabase.stats.flakyTests.length > 0) {
      recommendations.push({
        priority: 'high',
        category: 'stability',
        message: `${testDatabase.stats.flakyTests.length} flaky test(s) detected`,
        tests: testDatabase.stats.flakyTests,
        action: 'Investigate and stabilize these tests - flaky tests erode trust'
      });
    }

    // Slow tests
    if (testDatabase.stats.slowTests.length > 0) {
      recommendations.push({
        priority: 'medium',
        category: 'performance',
        message: `${testDatabase.stats.slowTests.length} slow test(s) detected (>5s)`,
        tests: testDatabase.stats.slowTests,
        action: 'Optimize or split these tests for faster feedback'
      });
    }

    // Consistently failing tests
    if (testDatabase.stats.failingTests.length > 0) {
      recommendations.push({
        priority: 'critical',
        category: 'failures',
        message: `${testDatabase.stats.failingTests.length} consistently failing test(s)`,
        tests: testDatabase.stats.failingTests,
        action: 'Fix these tests immediately or remove if no longer valid'
      });
    }

    return recommendations;
  }
}

/**
 * CLI interface
 */
async function cli() {
  const args = process.argv.slice(2);
  const command = args[0] || 'prioritize';

  const prioritizer = new TestPrioritizer();
  await prioritizer.initialize();

  try {
    switch (command) {
      case 'analyze': {
        const database = await prioritizer.analyzeHistory();
        console.log('\n📊 Test Analysis:');
        console.log(JSON.stringify(database.stats, null, 2));
        break;
      }

      case 'prioritize': {
        const plan = await prioritizer.generateExecutionPlan();
        console.log(`\n🎯 Test Execution Plan (Prioritized):`);
        console.log(`\n${plan.note}\n`);
        console.log(`Total Tests: ${plan.totalTests}`);
        console.log(`Estimated Duration: ${(plan.estimatedDuration / 1000).toFixed(1)}s`);
        console.log(`\n📋 Execution Phases (for fast feedback):`);
        console.log(`   Critical: ${plan.phases.critical.length} tests (run first)`);
        console.log(`   High:     ${plan.phases.high.length} tests`);
        console.log(`   Medium:   ${plan.phases.medium.length} tests`);
        console.log(`   Low:      ${plan.phases.low.length} tests (stable, run last)`);
        console.log(`\n⚠️ Note: This does NOT skip tests. All tests run, just in priority order.\n`);
        break;
      }

      case 'recommendations': {
        const recs = await prioritizer.getOptimizationRecommendations();
        console.log('\n💡 Test Optimization Recommendations:');
        if (recs.length === 0) {
          console.log('No recommendations - tests look healthy! ✅');
        } else {
          console.log(JSON.stringify(recs, null, 2));
        }
        break;
      }

      case 'flaky': {
        const db = await prioritizer.analyzeHistory();
        console.log('\n⚠️  Flaky Tests:');
        if (db.stats.flakyTests.length === 0) {
          console.log('No flaky tests detected ✅');
        } else {
          db.stats.flakyTests.forEach(test => {
            console.log(`  - ${test}`);
          });
        }
        break;
      }

      default:
        console.log(`
Test Prioritizer CLI

⚠️ IMPORTANT: This tool does NOT skip tests. It prioritizes execution order for fast feedback.

Usage:
  node test-prioritizer.js <command>

Commands:
  analyze            Analyze test history and show statistics
  prioritize         Generate prioritized test execution plan (default)
  recommendations    Get test optimization recommendations
  flaky              List flaky tests that need attention

Examples:
  node test-prioritizer.js analyze
  node test-prioritizer.js prioritize
  node test-prioritizer.js recommendations
  node test-prioritizer.js flaky

Purpose:
  - Reorder tests to run high-risk tests first (fast feedback)
  - Flag anomalies when stable tests fail
  - Identify flaky tests for investigation
  - Suggest optimizations

What this does NOT do:
  - ❌ Skip tests based on history
  - ❌ Make decisions to exclude tests
  - ❌ Reduce test coverage

All tests still run. Historical data provides context, not automation.
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
  TestPrioritizer,
  cli
};
