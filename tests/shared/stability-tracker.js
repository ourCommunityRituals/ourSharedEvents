#!/usr/bin/env node
/**
 * Test Stability Tracker (Story 3.5)
 *
 * Tracks test stability metrics to demonstrate reliable test suite:
 * - Consecutive successful runs
 * - Flaky test identification
 * - Stability score calculation
 * - Stability streak tracking
 *
 * Goal: Achieve 5+ consecutive green pipeline runs to demonstrate reliability.
 *
 * Usage:
 *   node tests/shared/stability-tracker.js status        # Show current stability status
 *   node tests/shared/stability-tracker.js streak        # Show current streak
 *   node tests/shared/stability-tracker.js report        # Generate full report
 *   node tests/shared/stability-tracker.js flaky         # List flaky tests
 *   npm run test:stability:status                        # Via npm script
 */

const fs = require('fs');
const path = require('path');
const TestResultsDatabase = require('./test-results-database');

// Stability thresholds
const STABILITY_THRESHOLDS = {
  EXCELLENT: 5,    // 5+ consecutive passes = excellent
  GOOD: 3,         // 3-4 consecutive passes = good
  FAIR: 1,         // 1-2 consecutive passes = fair
  POOR: 0,         // No consecutive passes = needs attention
};

const STABILITY_GOAL = 5; // Target: 5 consecutive successful runs

class StabilityTracker {
  constructor() {
    this.db = new TestResultsDatabase();
    this.stabilityFile = path.join(process.cwd(), '.test-data', 'stability-metrics.json');
  }

  /**
   * Load stability metrics from file
   */
  loadMetrics() {
    try {
      if (fs.existsSync(this.stabilityFile)) {
        return JSON.parse(fs.readFileSync(this.stabilityFile, 'utf8'));
      }
    } catch (error) {
      console.warn(`Could not load metrics: ${error.message}`);
    }

    return {
      lastUpdated: null,
      currentStreak: 0,
      longestStreak: 0,
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      streakHistory: [],
      flakyTests: {},
    };
  }

  /**
   * Save stability metrics to file
   */
  saveMetrics(metrics) {
    try {
      const dir = path.dirname(this.stabilityFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.stabilityFile, JSON.stringify(metrics, null, 2));
    } catch (error) {
      console.warn(`Could not save metrics: ${error.message}`);
    }
  }

  /**
   * Calculate current stability metrics from test history
   */
  calculateMetrics() {
    const recentRuns = this.db.getRecentRuns(50); // Get last 50 runs

    if (recentRuns.length === 0) {
      return this.loadMetrics();
    }

    const metrics = this.loadMetrics();

    // Calculate current streak (consecutive passes from most recent)
    let currentStreak = 0;
    for (const run of recentRuns) {
      if (run.failed === 0) {
        currentStreak++;
      } else {
        break;
      }
    }

    // Calculate total stats
    const totalRuns = recentRuns.length;
    const successfulRuns = recentRuns.filter(r => r.failed === 0).length;
    const failedRuns = totalRuns - successfulRuns;

    // Track flaky tests
    const flakyTests = {};
    recentRuns.forEach(run => {
      if (run.flaky && run.flaky > 0) {
        run.failures?.forEach(failure => {
          const key = `${failure.suite}::${failure.test}`;
          if (!flakyTests[key]) {
            flakyTests[key] = {
              suite: failure.suite,
              test: failure.test,
              flakyCount: 0,
              lastSeen: null,
            };
          }
          flakyTests[key].flakyCount++;
          flakyTests[key].lastSeen = run.startTime;
        });
      }
    });

    // Update metrics
    metrics.lastUpdated = new Date().toISOString();
    metrics.currentStreak = currentStreak;
    metrics.longestStreak = Math.max(metrics.longestStreak || 0, currentStreak);
    metrics.totalRuns = totalRuns;
    metrics.successfulRuns = successfulRuns;
    metrics.failedRuns = failedRuns;
    metrics.flakyTests = flakyTests;

    // Update streak history if streak changed
    if (currentStreak > 0 && metrics.streakHistory.length === 0 ||
        metrics.streakHistory[metrics.streakHistory.length - 1]?.streak !== currentStreak) {
      metrics.streakHistory.push({
        streak: currentStreak,
        date: new Date().toISOString(),
      });

      // Keep last 20 streak records
      if (metrics.streakHistory.length > 20) {
        metrics.streakHistory = metrics.streakHistory.slice(-20);
      }
    }

    this.saveMetrics(metrics);
    return metrics;
  }

  /**
   * Get stability status string
   */
  getStabilityStatus(streak) {
    if (streak >= STABILITY_THRESHOLDS.EXCELLENT) return 'EXCELLENT';
    if (streak >= STABILITY_THRESHOLDS.GOOD) return 'GOOD';
    if (streak >= STABILITY_THRESHOLDS.FAIR) return 'FAIR';
    return 'NEEDS_ATTENTION';
  }

  /**
   * Get stability score (0-100)
   */
  getStabilityScore(metrics) {
    if (metrics.totalRuns === 0) return 0;

    // Factors:
    // - Success rate (40% weight)
    // - Current streak vs goal (40% weight)
    // - Flaky test count (20% weight)

    const successRate = (metrics.successfulRuns / metrics.totalRuns) * 100;
    const streakProgress = Math.min(metrics.currentStreak / STABILITY_GOAL, 1) * 100;
    const flakyCount = Object.keys(metrics.flakyTests).length;
    const flakyPenalty = Math.min(flakyCount * 5, 100); // -5 points per flaky test, max -100

    const score = (
      (successRate * 0.4) +
      (streakProgress * 0.4) +
      (Math.max(100 - flakyPenalty, 0) * 0.2)
    );

    return Math.round(score);
  }

  /**
   * Print stability status
   */
  printStatus() {
    const metrics = this.calculateMetrics();
    const status = this.getStabilityStatus(metrics.currentStreak);
    const score = this.getStabilityScore(metrics);

    console.log('\n' + '='.repeat(60));
    console.log('  TEST STABILITY STATUS (Story 3.5)');
    console.log('='.repeat(60));

    // Progress bar for streak
    const streakProgress = Math.min(metrics.currentStreak / STABILITY_GOAL, 1);
    const progressBar = this.renderProgressBar(streakProgress, 30);

    console.log(`\n  Goal: ${STABILITY_GOAL} consecutive green runs`);
    console.log(`  Current Streak: ${metrics.currentStreak} / ${STABILITY_GOAL}`);
    console.log(`  Progress: ${progressBar}`);
    console.log(`\n  Status: ${status}`);
    console.log(`  Stability Score: ${score}/100`);

    console.log('\n  Statistics:');
    console.log(`    Total Runs: ${metrics.totalRuns}`);
    console.log(`    Successful: ${metrics.successfulRuns}`);
    console.log(`    Failed: ${metrics.failedRuns}`);
    console.log(`    Success Rate: ${metrics.totalRuns > 0 ? ((metrics.successfulRuns / metrics.totalRuns) * 100).toFixed(1) : 0}%`);
    console.log(`    Longest Streak: ${metrics.longestStreak}`);
    console.log(`    Flaky Tests: ${Object.keys(metrics.flakyTests).length}`);

    if (metrics.currentStreak >= STABILITY_GOAL) {
      console.log('\n  GOAL ACHIEVED! Test suite is stable.');
    } else {
      const remaining = STABILITY_GOAL - metrics.currentStreak;
      console.log(`\n  ${remaining} more green run${remaining > 1 ? 's' : ''} needed to reach goal.`);
    }

    console.log('\n' + '='.repeat(60) + '\n');

    return metrics;
  }

  /**
   * Print streak information
   */
  printStreak() {
    const metrics = this.calculateMetrics();

    console.log('\n' + '='.repeat(60));
    console.log('  STABILITY STREAK TRACKING');
    console.log('='.repeat(60));

    console.log(`\n  Current Streak: ${metrics.currentStreak}`);
    console.log(`  Longest Streak: ${metrics.longestStreak}`);
    console.log(`  Goal: ${STABILITY_GOAL}`);

    if (metrics.streakHistory.length > 0) {
      console.log('\n  Recent Streak History:');
      metrics.streakHistory.slice(-10).forEach(entry => {
        const date = new Date(entry.date).toLocaleDateString();
        const bar = '|'.repeat(Math.min(entry.streak, 20));
        console.log(`    ${date}: ${bar} (${entry.streak})`);
      });
    }

    console.log('\n' + '='.repeat(60) + '\n');
  }

  /**
   * Print full stability report
   */
  printReport() {
    const metrics = this.calculateMetrics();
    const score = this.getStabilityScore(metrics);
    const status = this.getStabilityStatus(metrics.currentStreak);

    console.log('\n' + '='.repeat(70));
    console.log('  COMPREHENSIVE TEST STABILITY REPORT');
    console.log('  Generated: ' + new Date().toISOString());
    console.log('='.repeat(70));

    // Executive Summary
    console.log('\n  EXECUTIVE SUMMARY');
    console.log('  ' + '-'.repeat(50));
    console.log(`  Stability Score: ${score}/100`);
    console.log(`  Status: ${status}`);
    console.log(`  Streak Progress: ${metrics.currentStreak}/${STABILITY_GOAL} (${Math.round(metrics.currentStreak / STABILITY_GOAL * 100)}%)`);

    // Key Metrics
    console.log('\n  KEY METRICS');
    console.log('  ' + '-'.repeat(50));
    console.log(`  Total Test Runs Analyzed: ${metrics.totalRuns}`);
    console.log(`  Successful Runs: ${metrics.successfulRuns} (${metrics.totalRuns > 0 ? ((metrics.successfulRuns / metrics.totalRuns) * 100).toFixed(1) : 0}%)`);
    console.log(`  Failed Runs: ${metrics.failedRuns}`);
    console.log(`  Current Streak: ${metrics.currentStreak}`);
    console.log(`  Longest Streak: ${metrics.longestStreak}`);

    // Flaky Tests
    const flakyTests = Object.values(metrics.flakyTests);
    if (flakyTests.length > 0) {
      console.log('\n  FLAKY TESTS (Requiring Attention)');
      console.log('  ' + '-'.repeat(50));
      flakyTests
        .sort((a, b) => b.flakyCount - a.flakyCount)
        .slice(0, 10)
        .forEach(test => {
          console.log(`  - ${test.suite} > ${test.test}`);
          console.log(`    Flaky occurrences: ${test.flakyCount}`);
        });
    } else {
      console.log('\n  FLAKY TESTS: None identified');
    }

    // Recommendations
    console.log('\n  RECOMMENDATIONS');
    console.log('  ' + '-'.repeat(50));

    if (metrics.currentStreak >= STABILITY_GOAL) {
      console.log('  - Goal achieved! Continue maintaining stability.');
      console.log('  - Consider increasing the goal to 10 consecutive runs.');
    } else {
      if (metrics.currentStreak === 0) {
        console.log('  - URGENT: Investigate recent test failures.');
        console.log('  - Review test-results/failure reports for root cause.');
      } else {
        const remaining = STABILITY_GOAL - metrics.currentStreak;
        console.log(`  - ${remaining} more successful run(s) needed.`);
      }

      if (flakyTests.length > 0) {
        console.log('  - Address flaky tests to improve stability.');
        console.log('  - Consider adding retry logic or fixing race conditions.');
      }
    }

    console.log('\n' + '='.repeat(70) + '\n');

    return { metrics, score, status };
  }

  /**
   * Print flaky tests list
   */
  printFlakyTests() {
    const metrics = this.calculateMetrics();
    const flakyTests = Object.values(metrics.flakyTests);

    console.log('\n' + '='.repeat(60));
    console.log('  FLAKY TESTS ANALYSIS');
    console.log('='.repeat(60));

    if (flakyTests.length === 0) {
      console.log('\n  No flaky tests identified in recent runs.');
      console.log('\n' + '='.repeat(60) + '\n');
      return;
    }

    console.log(`\n  Total Flaky Tests: ${flakyTests.length}`);
    console.log('\n  Tests sorted by flaky occurrences:\n');

    flakyTests
      .sort((a, b) => b.flakyCount - a.flakyCount)
      .forEach((test, index) => {
        console.log(`  ${index + 1}. ${test.suite} > ${test.test}`);
        console.log(`     Flaky Count: ${test.flakyCount}`);
        console.log(`     Last Seen: ${test.lastSeen || 'unknown'}`);
        console.log('');
      });

    console.log('  Recommended Actions:');
    console.log('  - Review test isolation (are tests sharing state?)');
    console.log('  - Check for race conditions or timing issues');
    console.log('  - Consider adding explicit waits or retry logic');
    console.log('  - Verify test data cleanup is working correctly');

    console.log('\n' + '='.repeat(60) + '\n');
  }

  /**
   * Generate JSON report for CI/CD
   */
  generateJsonReport() {
    const metrics = this.calculateMetrics();
    const score = this.getStabilityScore(metrics);
    const status = this.getStabilityStatus(metrics.currentStreak);

    return {
      timestamp: new Date().toISOString(),
      stabilityScore: score,
      status,
      goalMet: metrics.currentStreak >= STABILITY_GOAL,
      goal: STABILITY_GOAL,
      currentStreak: metrics.currentStreak,
      longestStreak: metrics.longestStreak,
      totalRuns: metrics.totalRuns,
      successfulRuns: metrics.successfulRuns,
      failedRuns: metrics.failedRuns,
      successRate: metrics.totalRuns > 0
        ? ((metrics.successfulRuns / metrics.totalRuns) * 100).toFixed(2)
        : '0.00',
      flakyTestCount: Object.keys(metrics.flakyTests).length,
      flakyTests: Object.values(metrics.flakyTests).slice(0, 10),
    };
  }

  /**
   * Render progress bar
   */
  renderProgressBar(progress, width) {
    const filled = Math.round(progress * width);
    const empty = width - filled;
    const bar = '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
    const percent = Math.round(progress * 100);
    return `${bar} ${percent}%`;
  }
}

// CLI
async function main() {
  const command = process.argv[2] || 'status';
  const tracker = new StabilityTracker();

  switch (command) {
    case 'status':
      tracker.printStatus();
      break;

    case 'streak':
      tracker.printStreak();
      break;

    case 'report':
      tracker.printReport();
      break;

    case 'flaky':
      tracker.printFlakyTests();
      break;

    case 'json': {
      const report = tracker.generateJsonReport();
      console.log(JSON.stringify(report, null, 2));
      break;
    }

    case 'ci-check': {
      // Check if stability goal is met (for CI/CD gates)
      const metrics = tracker.calculateMetrics();
      if (metrics.currentStreak >= STABILITY_GOAL) {
        console.log(`Stability goal met: ${metrics.currentStreak}/${STABILITY_GOAL} consecutive passes`);
        process.exit(0);
      } else {
        console.log(`Stability goal NOT met: ${metrics.currentStreak}/${STABILITY_GOAL} consecutive passes`);
        process.exit(1);
      }
      break;
    }

    default:
      console.log(`
Test Stability Tracker (Story 3.5)

Usage:
  node tests/shared/stability-tracker.js <command>

Commands:
  status    Show current stability status (default)
  streak    Show streak tracking information
  report    Generate comprehensive stability report
  flaky     List flaky tests requiring attention
  json      Output stability report as JSON
  ci-check  Check if stability goal is met (exit 0/1 for CI)

Examples:
  node tests/shared/stability-tracker.js status
  node tests/shared/stability-tracker.js report
  node tests/shared/stability-tracker.js ci-check
      `);
  }
}

module.exports = StabilityTracker;

if (require.main === module) {
  main();
}
