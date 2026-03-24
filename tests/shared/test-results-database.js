/**
 * Test Results Database Manager
 * Stores test execution results over time with metadata
 * Provides querying capabilities for dashboard
 */

const fs = require('fs');
const path = require('path');

class TestResultsDatabase {
  constructor(dbPath = '.test-results/test-history.json') {
    // Validate and sanitize path to prevent path traversal
    const resolvedPath = path.resolve(dbPath);
    const projectRoot = path.resolve(process.cwd());

    // Ensure the path is within the project directory
    if (!resolvedPath.startsWith(projectRoot)) {
      throw new Error('Security: Database path must be within project directory');
    }

    // Prevent access to sensitive directories
    const normalizedPath = path.normalize(resolvedPath);
    if (normalizedPath.includes('node_modules') ||
        normalizedPath.includes('.git') ||
        normalizedPath.includes('.env')) {
      throw new Error('Security: Cannot create database in restricted directory');
    }

    this.dbPath = resolvedPath;
    this.ensureDbExists();
  }

  ensureDbExists() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.dbPath)) {
      fs.writeFileSync(this.dbPath, JSON.stringify({ runs: [] }, null, 2));
    }
  }

  load() {
    try {
      const data = fs.readFileSync(this.dbPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading test database:', error);
      return { runs: [] };
    }
  }

  save(data) {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving test database:', error);
    }
  }

  /**
   * Add a test run to the database
   * @param {Object} run - Test run data
   * @param {string} run.id - Unique run ID (timestamp-based)
   * @param {string} run.suite - Test suite name (api, smoke, pages, flows, unit, contract)
   * @param {Date} run.startTime - Test run start time
   * @param {Date} run.endTime - Test run end time
   * @param {number} run.duration - Duration in milliseconds
   * @param {number} run.totalTests - Total number of tests
   * @param {number} run.passed - Number of passed tests
   * @param {number} run.failed - Number of failed tests
   * @param {number} run.skipped - Number of skipped tests
   * @param {Array} run.failures - Array of failure details
   * @param {string} run.reportPath - Path to HTML report (if applicable)
   * @param {Object} run.metadata - Additional metadata (branch, commit, env, etc.)
   */
  addRun(run) {
    const db = this.load();

    // Ensure run has required fields
    const runData = {
      id: run.id || `run-${Date.now()}`,
      suite: run.suite || 'unknown',
      startTime: run.startTime || new Date().toISOString(),
      endTime: run.endTime || new Date().toISOString(),
      duration: run.duration || 0,
      totalTests: run.totalTests || 0,
      passed: run.passed || 0,
      failed: run.failed || 0,
      skipped: run.skipped || 0,
      flaky: run.flaky || 0,
      failures: run.failures || [],
      reportPath: run.reportPath || null,
      metadata: {
        branch: run.metadata?.branch || 'unknown',
        commit: run.metadata?.commit || 'unknown',
        environment: run.metadata?.environment || 'local',
        platform: run.metadata?.platform || process.platform,
        node: run.metadata?.node || process.version,
        ...(run.metadata || {})
      }
    };

    db.runs.unshift(runData); // Add to beginning (most recent first)

    // Keep only last 1000 runs to prevent database from growing too large
    if (db.runs.length > 1000) {
      db.runs = db.runs.slice(0, 1000);
    }

    this.save(db);
    return runData;
  }

  /**
   * Get test runs within a date range
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @param {string} suite - Optional suite filter
   */
  getRunsByDateRange(startDate, endDate, suite = null) {
    const db = this.load();
    let runs = db.runs.filter(run => {
      const runDate = new Date(run.startTime);
      return runDate >= startDate && runDate <= endDate;
    });

    if (suite) {
      runs = runs.filter(run => run.suite === suite);
    }

    return runs;
  }

  /**
   * Get recent runs
   * @param {number} limit - Number of runs to return
   * @param {string} suite - Optional suite filter
   */
  getRecentRuns(limit = 50, suite = null) {
    const db = this.load();
    let runs = db.runs;

    if (suite) {
      runs = runs.filter(run => run.suite === suite);
    }

    return runs.slice(0, limit);
  }

  /**
   * Get statistics for a date range
   */
  getStatistics(startDate, endDate, suite = null) {
    const runs = this.getRunsByDateRange(startDate, endDate, suite);

    if (runs.length === 0) {
      return {
        totalRuns: 0,
        totalTests: 0,
        totalPassed: 0,
        totalFailed: 0,
        totalSkipped: 0,
        totalFlaky: 0,
        successRate: 0,
        avgDuration: 0,
        failingTests: []
      };
    }

    const stats = {
      totalRuns: runs.length,
      totalTests: runs.reduce((sum, r) => sum + r.totalTests, 0),
      totalPassed: runs.reduce((sum, r) => sum + r.passed, 0),
      totalFailed: runs.reduce((sum, r) => sum + r.failed, 0),
      totalSkipped: runs.reduce((sum, r) => sum + r.skipped, 0),
      totalFlaky: runs.reduce((sum, r) => sum + (r.flaky || 0), 0),
      successRate: 0,
      avgDuration: 0,
      failingTests: []
    };

    stats.successRate = stats.totalTests > 0
      ? ((stats.totalPassed / stats.totalTests) * 100).toFixed(2)
      : 0;

    stats.avgDuration = runs.reduce((sum, r) => sum + r.duration, 0) / runs.length;

    // Aggregate failing tests
    const failureMap = new Map();
    runs.forEach(run => {
      run.failures.forEach(failure => {
        const key = `${failure.suite}::${failure.test}`;
        if (!failureMap.has(key)) {
          failureMap.set(key, {
            suite: failure.suite,
            test: failure.test,
            count: 0,
            lastSeen: run.startTime,
            errors: []
          });
        }
        const entry = failureMap.get(key);
        entry.count++;
        entry.lastSeen = run.startTime;
        if (failure.error && !entry.errors.includes(failure.error)) {
          entry.errors.push(failure.error);
        }
      });
    });

    stats.failingTests = Array.from(failureMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 20); // Top 20 failing tests

    return stats;
  }

  /**
   * Get test trend data (for charts)
   */
  getTrend(days = 30, suite = null) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const runs = this.getRunsByDateRange(startDate, endDate, suite);

    // Group by day
    const dailyStats = {};
    runs.forEach(run => {
      const day = new Date(run.startTime).toISOString().split('T')[0];
      if (!dailyStats[day]) {
        dailyStats[day] = {
          date: day,
          runs: 0,
          passed: 0,
          failed: 0,
          totalTests: 0
        };
      }
      dailyStats[day].runs++;
      dailyStats[day].passed += run.passed;
      dailyStats[day].failed += run.failed;
      dailyStats[day].totalTests += run.totalTests;
    });

    return Object.values(dailyStats).sort((a, b) =>
      new Date(a.date) - new Date(b.date)
    );
  }

  /**
   * Clean up old runs
   */
  cleanup(daysToKeep = 90) {
    const db = this.load();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const originalCount = db.runs.length;
    db.runs = db.runs.filter(run =>
      new Date(run.startTime) >= cutoffDate
    );

    this.save(db);
    return originalCount - db.runs.length; // Number of runs removed
  }
}

module.exports = TestResultsDatabase;

// CLI usage
if (require.main === module) {
  const db = new TestResultsDatabase();
  const command = process.argv[2];

  switch (command) {
    case 'stats': {
      const days = parseInt(process.argv[3]) || 7;
      const suite = process.argv[4] || null;
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const stats = db.getStatistics(startDate, endDate, suite);
      console.log(JSON.stringify(stats, null, 2));
      break;
    }

    case 'recent': {
      const limit = parseInt(process.argv[3]) || 10;
      const recentSuite = process.argv[4] || null;
      const recent = db.getRecentRuns(limit, recentSuite);
      console.log(JSON.stringify(recent, null, 2));
      break;
    }

    case 'cleanup': {
      const keepDays = parseInt(process.argv[3]) || 90;
      const removed = db.cleanup(keepDays);
      console.log(`Removed ${removed} old test runs (kept last ${keepDays} days)`);
      break;
    }

    case 'trend': {
      const trendDays = parseInt(process.argv[3]) || 30;
      const trendSuite = process.argv[4] || null;
      const trend = db.getTrend(trendDays, trendSuite);
      console.log(JSON.stringify(trend, null, 2));
      break;
    }

    default:
      console.log('Usage:');
      console.log('  node test-results-database.js stats [days] [suite]');
      console.log('  node test-results-database.js recent [limit] [suite]');
      console.log('  node test-results-database.js trend [days] [suite]');
      console.log('  node test-results-database.js cleanup [daysToKeep]');
  }
}
