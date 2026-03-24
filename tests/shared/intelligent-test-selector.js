/**
 * Intelligent Test Selector
 *
 * Uses historical test data to intelligently select and prioritize tests:
 * - Identifies flaky tests
 * - Prioritizes recently failed tests
 * - Suggests test suite based on code changes
 * - Optimizes test execution order
 * - Reduces test execution time while maintaining coverage
 */

const fs = require('fs').promises;
const path = require('path');
const { TestResultsTracker } = require('./test-results-tracker');

/**
 * Intelligent Test Selector Class
 */
class IntelligentTestSelector {
  constructor(options = {}) {
    this.resultsDir = options.resultsDir || path.join(__dirname, '../../.test-results');
    this.tracker = new TestResultsTracker({ resultsDir: this.resultsDir });
    this.historyLimit = options.historyLimit || 50;

    // Test priority weights
    this.weights = {
      recentFailure: 10,     // Recently failed tests
      flakyTest: 8,          // Flaky tests that need attention
      criticalPath: 7,       // Critical user paths
      changedCode: 9,        // Tests for recently changed code
      neverRun: 5,           // Tests that haven't been run recently
      performanceIssue: 6    // Tests with performance issues
    };
  }

  /**
   * Initialize selector
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
        failingTests: []
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
              flaky: false
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
              flaky: false
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

      // Detect slow tests (>2 standard deviations)
      if (suite.durations.length >= 5) {
        if (suite.avgDuration > 5000) { // Over 5 seconds
          testDatabase.stats.slowTests.push(suite.name);
        }
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
   * Calculate test priority score
   */
  calculatePriority(suite, context = {}) {
    let score = 0;

    // Recent failure
    if (suite.failures > 0) {
      const recentFailureRate = suite.failures / suite.runs;
      score += this.weights.recentFailure * recentFailureRate * 10;
    }

    // Flaky test
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
      // Simple heuristic: if test name matches any changed file
      const matchesChangedFile = context.changedFiles.some(file =>
        suite.name.includes(path.basename(file, path.extname(file)))
      );
      if (matchesChangedFile) {
        score += this.weights.changedCode;
      }
    }

    // Haven't run recently
    if (suite.lastRun) {
      const daysSinceRun = (Date.now() - new Date(suite.lastRun).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceRun > 7) {
        score += this.weights.neverRun * Math.min(daysSinceRun / 7, 3);
      }
    }

    // Performance issues
    if (suite.avgDuration > 10000) { // Over 10 seconds
      score += this.weights.performanceIssue;
    }

    return score;
  }

  /**
   * Select tests based on strategy
   */
  async selectTests(strategy = 'smart', context = {}) {
    const testDatabase = await this.analyzeHistory();

    let selectedTests = [];

    switch (strategy) {
      case 'smart':
        selectedTests = await this.selectSmartTests(testDatabase, context);
        break;

      case 'critical-only':
        selectedTests = await this.selectCriticalTests(testDatabase);
        break;

      case 'flaky-only':
        selectedTests = await this.selectFlakyTests(testDatabase);
        break;

      case 'failed-only':
        selectedTests = await this.selectFailedTests(testDatabase);
        break;

      case 'fast-only':
        selectedTests = await this.selectFastTests(testDatabase);
        break;

      case 'all':
        selectedTests = Object.values(testDatabase.suites).map(s => ({
          name: s.name,
          priority: this.calculatePriority(s, context),
          reason: 'Full test suite'
        }));
        break;

      default:
        throw new Error(`Unknown strategy: ${strategy}`);
    }

    // Sort by priority
    selectedTests.sort((a, b) => b.priority - a.priority);

    return {
      tests: selectedTests,
      stats: testDatabase.stats,
      strategy,
      context
    };
  }

  /**
   * Smart test selection (prioritized)
   */
  async selectSmartTests(testDatabase, context) {
    const tests = [];

    Object.values(testDatabase.suites).forEach(suite => {
      const priority = this.calculatePriority(suite, context);

      // Only include tests with priority > 5
      if (priority >= 5) {
        tests.push({
          name: suite.name,
          priority,
          reason: this.getSelectionReason(suite, context),
          estimatedDuration: suite.avgDuration
        });
      }
    });

    return tests;
  }

  /**
   * Select critical tests only
   */
  async selectCriticalTests(testDatabase) {
    const tests = [];
    const criticalPaths = ['smoke', 'critical', 'api', 'security'];

    Object.values(testDatabase.suites).forEach(suite => {
      if (criticalPaths.some(path => suite.name.toLowerCase().includes(path))) {
        tests.push({
          name: suite.name,
          priority: 10,
          reason: 'Critical path test',
          estimatedDuration: suite.avgDuration
        });
      }
    });

    return tests;
  }

  /**
   * Select flaky tests only
   */
  async selectFlakyTests(testDatabase) {
    return testDatabase.stats.flakyTests.map(name => ({
      name,
      priority: 8,
      reason: 'Flaky test - needs attention',
      estimatedDuration: testDatabase.suites[name]?.avgDuration || 0
    }));
  }

  /**
   * Select recently failed tests
   */
  async selectFailedTests(testDatabase) {
    return testDatabase.stats.failingTests.map(name => ({
      name,
      priority: 9,
      reason: 'Recently failed test',
      estimatedDuration: testDatabase.suites[name]?.avgDuration || 0
    }));
  }

  /**
   * Select fast tests only (under 5 seconds)
   */
  async selectFastTests(testDatabase) {
    const tests = [];

    Object.values(testDatabase.suites).forEach(suite => {
      if (suite.avgDuration < 5000) {
        tests.push({
          name: suite.name,
          priority: 5,
          reason: 'Fast test (< 5s)',
          estimatedDuration: suite.avgDuration
        });
      }
    });

    return tests;
  }

  /**
   * Get human-readable selection reason
   */
  getSelectionReason(suite, context) {
    const reasons = [];

    if (suite.failures > 0) {
      reasons.push('Recently failed');
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
        reasons.push('Changed code');
      }
    }

    if (suite.avgDuration > 10000) {
      reasons.push('Performance concern');
    }

    return reasons.length > 0 ? reasons.join(', ') : 'Standard test';
  }

  /**
   * Generate test execution plan
   */
  async generateExecutionPlan(strategy = 'smart', context = {}) {
    const selection = await this.selectTests(strategy, context);

    const plan = {
      strategy,
      timestamp: new Date().toISOString(),
      totalTests: selection.tests.length,
      estimatedDuration: selection.tests.reduce((sum, t) => sum + (t.estimatedDuration || 0), 0),
      tests: selection.tests,
      stages: this.createStages(selection.tests),
      stats: selection.stats
    };

    return plan;
  }

  /**
   * Create execution stages (parallel groups)
   */
  createStages(tests) {
    const stages = {
      critical: [],  // Run first
      high: [],      // Run second
      medium: [],    // Run third
      low: []        // Run last
    };

    tests.forEach(test => {
      if (test.priority >= 9) {
        stages.critical.push(test.name);
      } else if (test.priority >= 7) {
        stages.high.push(test.name);
      } else if (test.priority >= 5) {
        stages.medium.push(test.name);
      } else {
        stages.low.push(test.name);
      }
    });

    return stages;
  }

  /**
   * Export test selection to JSON
   */
  async exportSelection(selection, outputPath) {
    await fs.writeFile(outputPath, JSON.stringify(selection, null, 2));
    console.log(`✓ Test selection exported: ${outputPath}`);
  }

  /**
   * Get recommendations for test optimization
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
        action: 'Investigate and stabilize these tests'
      });
    }

    // Slow tests
    if (testDatabase.stats.slowTests.length > 0) {
      recommendations.push({
        priority: 'medium',
        category: 'performance',
        message: `${testDatabase.stats.slowTests.length} slow test(s) detected`,
        tests: testDatabase.stats.slowTests,
        action: 'Optimize or split these tests'
      });
    }

    // Failing tests
    if (testDatabase.stats.failingTests.length > 0) {
      recommendations.push({
        priority: 'critical',
        category: 'failures',
        message: `${testDatabase.stats.failingTests.length} consistently failing test(s)`,
        tests: testDatabase.stats.failingTests,
        action: 'Fix or remove these tests immediately'
      });
    }

    // Test coverage gaps
    const totalSuites = Object.keys(testDatabase.suites).length;
    if (totalSuites < 20) {
      recommendations.push({
        priority: 'low',
        category: 'coverage',
        message: 'Limited test coverage detected',
        action: 'Consider adding more test suites'
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
  const command = args[0] || 'smart';

  const selector = new IntelligentTestSelector();
  await selector.initialize();

  try {
    switch (command) {
      case 'analyze': {
        const database = await selector.analyzeHistory();
        console.log('\n📊 Test Analysis:');
        console.log(JSON.stringify(database.stats, null, 2));
        break;
      }

      case 'smart':
      case 'critical-only':
      case 'flaky-only':
      case 'failed-only':
      case 'fast-only':
      case 'all': {
        const plan = await selector.generateExecutionPlan(command);
        console.log(`\n🎯 Test Execution Plan (${command}):`);
        console.log(JSON.stringify(plan, null, 2));

        // Save plan
        const planPath = path.join(selector.resultsDir, 'test-plan.json');
        await fs.writeFile(planPath, JSON.stringify(plan, null, 2));
        console.log(`\n✓ Plan saved: ${planPath}`);
        break;
      }

      case 'recommendations': {
        const recs = await selector.getOptimizationRecommendations();
        console.log('\n💡 Test Optimization Recommendations:');
        console.log(JSON.stringify(recs, null, 2));
        break;
      }

      default:
        console.log(`
Intelligent Test Selector CLI

Usage:
  node intelligent-test-selector.js <command>

Commands:
  analyze            Analyze test history and show statistics
  smart              Generate smart test selection plan (default)
  critical-only      Select critical tests only
  flaky-only         Select flaky tests only
  failed-only        Select recently failed tests
  fast-only          Select fast tests only (< 5s)
  all                Select all tests
  recommendations    Get test optimization recommendations

Examples:
  node intelligent-test-selector.js analyze
  node intelligent-test-selector.js smart
  node intelligent-test-selector.js critical-only
  node intelligent-test-selector.js recommendations
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
  IntelligentTestSelector,
  cli
};
