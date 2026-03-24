/**
 * Centralized Test Data Manager
 *
 * Provides comprehensive test data management across all environments:
 * - Data seeding and cleanup
 * - Multi-brand data isolation
 * - Event phase-specific data generation
 * - Test data versioning and snapshots
 * - Automatic cleanup after test runs
 */

const { EventBuilder, createBasicEvent, createCompleteEvent, createEventWithSponsors, createEventWithDisplay } = require('./fixtures/events.fixtures');
const { createSponsorTier } = require('./fixtures/sponsors.fixtures');
const fs = require('fs').promises;
const path = require('path');

/**
 * Test Data Manager Class
 */
class TestDataManager {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.BASE_URL;
    this.adminKey = options.adminKey || process.env.ADMIN_KEY_ROOT;
    this.environment = options.environment || this.detectEnvironment();
    this.brand = options.brand || 'root';
    this.dataDir = options.dataDir || path.join(__dirname, '../../.test-data');

    // Track created resources for cleanup
    this.createdResources = {
      events: [],
      sponsors: [],
      analytics: []
    };

    // Data generation strategies
    this.strategies = {
      minimal: this.generateMinimalData.bind(this),
      standard: this.generateStandardData.bind(this),
      comprehensive: this.generateComprehensiveData.bind(this),
      triangleBefore: this.generateBeforeEventData.bind(this),
      triangleDuring: this.generateDuringEventData.bind(this),
      triangleAfter: this.generateAfterEventData.bind(this),
    };
  }

  /**
   * Detect environment based on BASE_URL
   * Uses proper URL parsing to avoid substring matching vulnerabilities
   */
  detectEnvironment() {
    if (!this.baseUrl) return 'unknown';

    try {
      const url = new URL(this.baseUrl);
      const hostname = url.hostname;

      // Match exact hostname or subdomain
      if (hostname === 'qa.zeventbooks.com') return 'qa';
      if (hostname === 'zeventbooks.com' || hostname === 'www.zeventbooks.com') return 'production';
      if (hostname === 'script.google.com') return 'googleAppsScript';
      if (hostname === 'localhost' || hostname === '127.0.0.1') return 'local';

      return 'unknown';
    } catch (error) {
      // Invalid URL format
      return 'unknown';
    }
  }

  /**
   * Initialize test data directory
   */
  async initialize() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'snapshots'), { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'seeds'), { recursive: true });
      console.log(`✓ Test data directory initialized: ${this.dataDir}`);
    } catch (error) {
      console.error(`✗ Failed to initialize test data directory: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate minimal test data (1 event)
   */
  generateMinimalData() {
    return {
      events: [createBasicEvent()],
      sponsors: [],
      analytics: []
    };
  }

  /**
   * Generate standard test data (multiple events, sponsors)
   */
  generateStandardData() {
    return {
      events: [
        createBasicEvent({ name: 'Standard Event 1' }),
        createCompleteEvent({ name: 'Standard Event 2' }),
        createEventWithSponsors({ name: 'Standard Event 3' })
      ],
      sponsors: [
        createSponsorTier('platinum', 1),
        createSponsorTier('gold', 2),
        createSponsorTier('silver', 3)
      ],
      analytics: []
    };
  }

  /**
   * Generate comprehensive test data (all scenarios)
   */
  generateComprehensiveData() {
    const now = new Date();
    const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days ahead
    const pastDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    return {
      events: [
        // Future events (various configurations)
        new EventBuilder()
          .withName('Comprehensive Event - Future')
          .withDate(futureDate.toISOString().split('T')[0])
          .withSponsors([
            { name: 'Platinum Sponsor A', tier: 'platinum', logo: 'https://via.placeholder.com/300x100' }
          ])
          .build(),

        // Event with forms
        new EventBuilder()
          .withName('Event with Forms')
          .withDate(futureDate.toISOString().split('T')[0])
          .withForms({
            registrationUrl: 'https://forms.example.com/register',
            checkinUrl: 'https://forms.example.com/checkin',
            walkinUrl: 'https://forms.example.com/walkin',
            surveyUrl: 'https://forms.example.com/survey'
          })
          .build(),

        // Event with display
        createEventWithDisplay({
          name: 'Event with Display',
          dateISO: futureDate.toISOString().split('T')[0]
        }),

        // Past event (for analytics)
        new EventBuilder()
          .withName('Past Event for Analytics')
          .withDate(pastDate.toISOString().split('T')[0])
          .withStatus('completed')
          .build(),

        // Current/today event
        new EventBuilder()
          .withName('Current Event Today')
          .withDate(now.toISOString().split('T')[0])
          .withStatus('active')
          .build()
      ],
      sponsors: [
        createSponsorTier('platinum', 2),
        createSponsorTier('gold', 4),
        createSponsorTier('silver', 6),
        createSponsorTier('bronze', 8)
      ],
      analytics: this.generateAnalyticsData()
    };
  }

  /**
   * Generate Before Event phase data (📋 Pre-event preparation)
   */
  generateBeforeEventData() {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    return {
      events: [
        // Events being set up with sponsors
        new EventBuilder()
          .withName('Before Phase - Sponsor Setup')
          .withDate(futureDate.toISOString().split('T')[0])
          .withSponsors([
            { name: 'Setup Sponsor 1', tier: 'platinum', logo: 'https://via.placeholder.com/300x100/FFD700' },
            { name: 'Setup Sponsor 2', tier: 'gold', logo: 'https://via.placeholder.com/300x100/C0C0C0' }
          ])
          .build(),

        // Event with forms configuration
        new EventBuilder()
          .withName('Before Phase - Forms Config')
          .withDate(futureDate.toISOString().split('T')[0])
          .withForms({
            registrationUrl: 'https://forms.example.com/register',
            checkinUrl: 'https://forms.example.com/checkin',
            walkinUrl: 'https://forms.example.com/walkin',
            surveyUrl: 'https://forms.example.com/survey'
          })
          .build(),

        // Event with map/poster
        new EventBuilder()
          .withName('Before Phase - Map Setup')
          .withDate(futureDate.toISOString().split('T')[0])
          .withMap('https://maps.google.com/embed?pb=test')
          .build()
      ],
      sponsors: [
        createSponsorTier('platinum', 2),
        createSponsorTier('gold', 3)
      ],
      analytics: []
    };
  }

  /**
   * Generate During Event phase data (▶️ Live event execution)
   */
  generateDuringEventData() {
    const today = new Date().toISOString().split('T')[0];

    return {
      events: [
        // Live event with display
        new EventBuilder()
          .withName('During Phase - Live Display')
          .withDate(today)
          .withStatus('active')
          .withDisplay('dynamic', [
            'https://www.youtube.com/embed/example1',
            'https://player.vimeo.com/video/example2'
          ], 15000)
          .withSponsors([
            { name: 'Live Sponsor 1', tier: 'platinum', logo: 'https://via.placeholder.com/300x100' }
          ])
          .build(),

        // Check-in active event
        new EventBuilder()
          .withName('During Phase - Check-in Active')
          .withDate(today)
          .withStatus('active')
          .withForms({
            checkinUrl: 'https://forms.example.com/checkin',
            walkinUrl: 'https://forms.example.com/walkin'
          })
          .build()
      ],
      sponsors: [],
      analytics: this.generateLiveEventMetrics()
    };
  }

  /**
   * Generate After Event phase data (📊 Post-event analytics)
   */
  generateAfterEventData() {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 7);

    return {
      events: [
        // Completed event with analytics
        new EventBuilder()
          .withName('After Phase - Completed Event')
          .withDate(pastDate.toISOString().split('T')[0])
          .withStatus('completed')
          .build(),

        // Event with survey
        new EventBuilder()
          .withName('After Phase - Survey Event')
          .withDate(pastDate.toISOString().split('T')[0])
          .withStatus('completed')
          .withForms({
            surveyUrl: 'https://forms.example.com/survey'
          })
          .build()
      ],
      sponsors: [],
      analytics: this.generateCompletedEventAnalytics()
    };
  }

  /**
   * Generate analytics data
   */
  generateAnalyticsData() {
    return {
      pageViews: Math.floor(Math.random() * 1000) + 100,
      uniqueVisitors: Math.floor(Math.random() * 500) + 50,
      sponsorClicks: Math.floor(Math.random() * 200) + 20,
      formSubmissions: Math.floor(Math.random() * 100) + 10,
      displayRotations: Math.floor(Math.random() * 50) + 5
    };
  }

  /**
   * Generate live event metrics
   */
  generateLiveEventMetrics() {
    return {
      currentViewers: Math.floor(Math.random() * 100) + 10,
      checkins: Math.floor(Math.random() * 50) + 5,
      walkins: Math.floor(Math.random() * 20) + 2,
      displayRotations: Math.floor(Math.random() * 30) + 3
    };
  }

  /**
   * Generate completed event analytics
   */
  generateCompletedEventAnalytics() {
    return {
      totalAttendees: Math.floor(Math.random() * 200) + 50,
      registrations: Math.floor(Math.random() * 150) + 30,
      checkins: Math.floor(Math.random() * 120) + 25,
      walkins: Math.floor(Math.random() * 30) + 5,
      surveyResponses: Math.floor(Math.random() * 80) + 15,
      sponsorImpressions: Math.floor(Math.random() * 500) + 100,
      sponsorClicks: Math.floor(Math.random() * 50) + 10,
      averageEngagement: (Math.random() * 5 + 3).toFixed(2) // 3-8 minutes
    };
  }

  /**
   * Seed test data using a strategy
   */
  async seed(strategy = 'standard') {
    console.log(`\n🌱 Seeding test data using strategy: ${strategy}`);
    console.log(`📍 Environment: ${this.environment}`);
    console.log(`🏢 Brand: ${this.brand}\n`);

    const strategyFn = this.strategies[strategy];
    if (!strategyFn) {
      throw new Error(`Unknown strategy: ${strategy}. Available: ${Object.keys(this.strategies).join(', ')}`);
    }

    const data = strategyFn();

    // Save seed data snapshot
    await this.saveSnapshot(`seed-${strategy}`, data);

    // Track created resources
    this.createdResources = {
      events: data.events.map(e => e.name),
      sponsors: data.sponsors.map(s => s.name),
      analytics: data.analytics
    };

    console.log(`✓ Generated ${data.events.length} events`);
    console.log(`✓ Generated ${data.sponsors.length} sponsors`);
    console.log(`✓ Test data ready for use\n`);

    return data;
  }

  /**
   * Save data snapshot
   */
  async saveSnapshot(name, data) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}-${timestamp}.json`;
    const filepath = path.join(this.dataDir, 'snapshots', filename);

    await fs.writeFile(filepath, JSON.stringify(data, null, 2));
    console.log(`📸 Snapshot saved: ${filename}`);

    return filepath;
  }

  /**
   * Load data snapshot
   */
  async loadSnapshot(name) {
    const snapshotsDir = path.join(this.dataDir, 'snapshots');
    const files = await fs.readdir(snapshotsDir);

    // Find most recent snapshot matching name
    const matchingFiles = files
      .filter(f => f.startsWith(name))
      .sort()
      .reverse();

    if (matchingFiles.length === 0) {
      throw new Error(`No snapshot found matching: ${name}`);
    }

    const filepath = path.join(snapshotsDir, matchingFiles[0]);
    const content = await fs.readFile(filepath, 'utf8');

    console.log(`📂 Loaded snapshot: ${matchingFiles[0]}`);
    return JSON.parse(content);
  }

  /**
   * Cleanup test data
   */
  async cleanup() {
    console.log('\n🧹 Cleaning up test data...');

    const cleaned = {
      events: this.createdResources.events.length,
      sponsors: this.createdResources.sponsors.length
    };

    // In a real implementation, this would make API calls to delete resources
    // For now, we just track what would be cleaned
    console.log(`✓ Would clean ${cleaned.events} events`);
    console.log(`✓ Would clean ${cleaned.sponsors} sponsors`);

    // Reset tracking
    this.createdResources = { events: [], sponsors: [], analytics: [] };

    return cleaned;
  }

  /**
   * List all snapshots
   */
  async listSnapshots() {
    const snapshotsDir = path.join(this.dataDir, 'snapshots');
    try {
      const files = await fs.readdir(snapshotsDir);
      return files.filter(f => f.endsWith('.json')).sort().reverse();
    } catch (error) {
      return [];
    }
  }

  /**
   * Get data statistics
   */
  getStats() {
    return {
      environment: this.environment,
      brand: this.brand,
      createdResources: {
        events: this.createdResources.events.length,
        sponsors: this.createdResources.sponsors.length
      },
      strategies: Object.keys(this.strategies)
    };
  }

  /**
   * Validate test data against schema
   */
  validateData(data) {
    const errors = [];

    // Validate events
    if (data.events) {
      data.events.forEach((event, index) => {
        if (!event.name) errors.push(`Event ${index}: Missing name`);
        if (!event.dateISO) errors.push(`Event ${index}: Missing dateISO`);
        if (!event.location) errors.push(`Event ${index}: Missing location`);
      });
    }

    // Validate sponsors
    if (data.sponsors) {
      data.sponsors.forEach((sponsor, index) => {
        if (!sponsor.name) errors.push(`Sponsor ${index}: Missing name`);
        if (!sponsor.tier) errors.push(`Sponsor ${index}: Missing tier`);
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

/**
 * CLI interface for test data management
 */
async function cli() {
  const args = process.argv.slice(2);
  const command = args[0];

  const manager = new TestDataManager();
  await manager.initialize();

  try {
    switch (command) {
      case 'seed': {
        const strategy = args[1] || 'standard';
        await manager.seed(strategy);
        console.log('\n📊 Seed Summary:');
        console.log(JSON.stringify(manager.getStats(), null, 2));
        break;
      }

      case 'cleanup':
        await manager.cleanup();
        break;

      case 'snapshots': {
        const snapshots = await manager.listSnapshots();
        console.log('\n📸 Available Snapshots:');
        snapshots.forEach(s => console.log(`  - ${s}`));
        break;
      }

      case 'stats':
        console.log('\n📊 Data Manager Statistics:');
        console.log(JSON.stringify(manager.getStats(), null, 2));
        break;

      case 'validate': {
        const snapshotName = args[1];
        if (!snapshotName) {
          console.error('❌ Please provide snapshot name');
          process.exit(1);
        }
        const snapshotData = await manager.loadSnapshot(snapshotName);
        const validation = manager.validateData(snapshotData);
        if (validation.valid) {
          console.log('✓ Data is valid');
        } else {
          console.error('✗ Validation errors:');
          validation.errors.forEach(err => console.error(`  - ${err}`));
          process.exit(1);
        }
        break;
      }

      default:
        console.log(`
Test Data Manager CLI

Usage:
  node test-data-manager.js <command> [options]

Commands:
  seed <strategy>    Seed test data (strategies: minimal, standard, comprehensive, triangleBefore, triangleDuring, triangleAfter)
  cleanup            Clean up all created test data
  snapshots          List all available snapshots
  stats              Show data manager statistics
  validate <name>    Validate a snapshot

Examples:
  node test-data-manager.js seed standard
  node test-data-manager.js seed triangleBefore
  node test-data-manager.js cleanup
  node test-data-manager.js snapshots
        `);
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Run CLI if executed directly
if (require.main === module) {
  cli();
}

module.exports = {
  TestDataManager,
  cli
};
