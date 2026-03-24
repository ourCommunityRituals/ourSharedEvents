#!/usr/bin/env node

/**
 * Automated Test Scenario Runner
 *
 * Runs all three scenarios in sequence, discovers bugs, and generates reports
 * Supports continuous testing and bug fixing workflow
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '../../../.test-results/scenarios');
const BUG_TRACKER_FILE = path.join(RESULTS_DIR, 'bug-tracker.json');

// Ensure results directory exists
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

// Bug tracker structure
let bugTracker = {
  discoveredAt: new Date().toISOString(),
  scenarios: {
    'scenario-1': { bugs: [], passed: 0, failed: 0, skipped: 0 },
    'scenario-2': { bugs: [], passed: 0, failed: 0, skipped: 0 },
    'scenario-3': { bugs: [], passed: 0, failed: 0, skipped: 0 }
  },
  summary: {
    totalBugs: 0,
    criticalBugs: 0,
    highPriorityBugs: 0,
    mediumPriorityBugs: 0,
    lowPriorityBugs: 0
  }
};

// Load existing bug tracker if it exists
if (fs.existsSync(BUG_TRACKER_FILE)) {
  try {
    bugTracker = JSON.parse(fs.readFileSync(BUG_TRACKER_FILE, 'utf8'));
    console.log('📋 Loaded existing bug tracker');
  } catch (e) {
    console.log('⚠️  Could not load existing bug tracker, starting fresh');
  }
}

/**
 * Run a test scenario and capture results
 */
function runScenario(scenarioName, scenarioFile) {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🧪 Running ${scenarioName}`);
    console.log(`${'='.repeat(60)}\n`);

    const startTime = Date.now();
    const command = `npx playwright test ${scenarioFile} --reporter=json --reporter=line`;

    exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const duration = Date.now() - startTime;

      console.log(stdout);
      if (stderr) console.error(stderr);

      const result = {
        scenario: scenarioName,
        file: scenarioFile,
        duration: duration,
        exitCode: error ? error.code : 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        bugs: []
      };

      // Parse results from JSON output
      const jsonResultFile = path.join(__dirname, '../../../.test-results/playwright-results.json');
      if (fs.existsSync(jsonResultFile)) {
        try {
          const testResults = JSON.parse(fs.readFileSync(jsonResultFile, 'utf8'));

          testResults.suites.forEach(suite => {
            suite.specs.forEach(spec => {
              spec.tests.forEach(test => {
                if (test.results[0].status === 'passed') {
                  result.passed++;
                } else if (test.results[0].status === 'failed') {
                  result.failed++;

                  // Extract bug information
                  const bug = {
                    test: test.title || spec.title,
                    file: spec.file,
                    error: test.results[0].error?.message || 'Unknown error',
                    priority: 'medium',
                    status: 'open',
                    discoveredAt: new Date().toISOString()
                  };

                  // Categorize bug priority
                  if (bug.error.includes('timeout') || bug.error.includes('not found')) {
                    bug.priority = 'high';
                  } else if (bug.error.includes('performance') || bug.error.includes('slow')) {
                    bug.priority = 'medium';
                  }

                  result.bugs.push(bug);
                } else if (test.results[0].status === 'skipped') {
                  result.skipped++;
                }
              });
            });
          });
        } catch (e) {
          console.log('⚠️  Could not parse JSON results');
        }
      }

      // Update bug tracker
      const scenarioKey = scenarioFile.includes('scenario-1') ? 'scenario-1' :
                          scenarioFile.includes('scenario-2') ? 'scenario-2' : 'scenario-3';

      bugTracker.scenarios[scenarioKey] = {
        bugs: result.bugs,
        passed: result.passed,
        failed: result.failed,
        skipped: result.skipped,
        lastRun: new Date().toISOString(),
        duration: duration
      };

      console.log(`\n📊 ${scenarioName} Results:`);
      console.log(`   ✅ Passed: ${result.passed}`);
      console.log(`   ❌ Failed: ${result.failed}`);
      console.log(`   ⏭️  Skipped: ${result.skipped}`);
      console.log(`   🐛 Bugs Found: ${result.bugs.length}`);
      console.log(`   ⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);

      resolve(result);
    });
  });
}

/**
 * Generate bug report
 */
function generateBugReport(results) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('🐛 BUG DISCOVERY REPORT');
  console.log(`${'='.repeat(60)}\n`);

  const allBugs = results.flatMap(r => r.bugs);

  bugTracker.summary.totalBugs = allBugs.length;
  bugTracker.summary.criticalBugs = allBugs.filter(b => b.priority === 'critical').length;
  bugTracker.summary.highPriorityBugs = allBugs.filter(b => b.priority === 'high').length;
  bugTracker.summary.mediumPriorityBugs = allBugs.filter(b => b.priority === 'medium').length;
  bugTracker.summary.lowPriorityBugs = allBugs.filter(b => b.priority === 'low').length;

  console.log(`Total Bugs Discovered: ${allBugs.length}`);
  console.log(`   🔴 Critical: ${bugTracker.summary.criticalBugs}`);
  console.log(`   🟠 High: ${bugTracker.summary.highPriorityBugs}`);
  console.log(`   🟡 Medium: ${bugTracker.summary.mediumPriorityBugs}`);
  console.log(`   🟢 Low: ${bugTracker.summary.lowPriorityBugs}`);

  if (allBugs.length > 0) {
    console.log(`\nTop Bugs to Fix:\n`);

    const priorityOrder = { critical: 1, high: 2, medium: 3, low: 4 };
    const sortedBugs = allBugs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    sortedBugs.slice(0, 10).forEach((bug, index) => {
      const icon = bug.priority === 'critical' ? '🔴' :
                   bug.priority === 'high' ? '🟠' :
                   bug.priority === 'medium' ? '🟡' : '🟢';

      console.log(`${index + 1}. ${icon} [${bug.priority.toUpperCase()}] ${bug.test}`);
      console.log(`   File: ${path.basename(bug.file)}`);
      console.log(`   Error: ${bug.error.substring(0, 100)}...`);
      console.log(``);
    });
  } else {
    console.log(`\n🎉 No bugs found! All tests passing!`);
  }

  // Save bug tracker
  fs.writeFileSync(BUG_TRACKER_FILE, JSON.stringify(bugTracker, null, 2));
  console.log(`\n💾 Bug tracker saved to: ${BUG_TRACKER_FILE}`);
}

/**
 * Main execution
 */
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║         AGILE TEST AUTOMATION - SCENARIO RUNNER             ║
║                                                              ║
║  Discover → Fix → Verify → Repeat                           ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);

  const scenarios = [
    { name: 'SCENARIO 1: First-Time Admin', file: 'tests/e2e/scenarios/scenario-1-first-time-admin.spec.js' },
    { name: 'SCENARIO 2: Mobile User', file: 'tests/e2e/scenarios/scenario-2-mobile-user.spec.js' },
    { name: 'SCENARIO 3: TV Display', file: 'tests/e2e/scenarios/scenario-3-tv-display.spec.js' }
  ];

  const results = [];

  for (const scenario of scenarios) {
    const result = await runScenario(scenario.name, scenario.file);
    results.push(result);
  }

  // Generate comprehensive report
  generateBugReport(results);

  // Final summary
  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
  const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\n${'='.repeat(60)}`);
  console.log('📈 OVERALL SUMMARY');
  console.log(`${'='.repeat(60)}`);
  console.log(`Total Tests Run: ${totalPassed + totalFailed + totalSkipped}`);
  console.log(`   ✅ Passed: ${totalPassed}`);
  console.log(`   ❌ Failed: ${totalFailed}`);
  console.log(`   ⏭️  Skipped: ${totalSkipped}`);
  console.log(`   ⏱️  Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`${'='.repeat(60)}\n`);

  // Exit with appropriate code
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('❌ Runner failed:', error);
  process.exit(1);
});
