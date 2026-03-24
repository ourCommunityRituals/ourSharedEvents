#!/usr/bin/env node
/**
 * Integration Wiring Diagram Generator
 *
 * Generates a JSON wiring diagram showing how surfaces connect to APIs and Analytics.
 * The diagram is derived from actual source code analysis of:
 *   - NU.rpc() calls in surface HTML files
 *   - logEvent() calls for analytics feeding
 *   - SharedReporting.gs for analytics reading
 *   - Code.gs _listMvpApis_() for API registry
 *
 * Output: docs/wiring-admin-public-display-poster-report.json
 *
 * Usage:
 *   node scripts/generate-wiring-diagram.js [--check]
 *
 * Flags:
 *   --check   Validate that existing diagram matches generated (for CI)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_MVP = path.join(ROOT, 'src', 'mvp');
// Story 5.3: GAS files archived to archive/gas/
const GAS_ARCHIVE = path.join(ROOT, 'archive', 'gas');
const DOCS = path.join(ROOT, 'docs');
const OUTPUT_FILE = path.join(DOCS, 'wiring-admin-public-display-poster-report.json');

// Surface files to analyze
const SURFACES = {
  Admin: 'Admin.html',
  Public: 'Public.html',
  Display: 'Display.html',
  Poster: 'Poster.html',
  SharedReport: 'SharedReport.html'
};

// ============================================================================
// Extract APIs from Code.gs
// ============================================================================

function extractMvpApis() {
  // Story 5.3: Read from archive directory
  const codeGsPath = path.join(GAS_ARCHIVE, 'Code.gs');
  const content = fs.readFileSync(codeGsPath, 'utf8');

  // Match the _listMvpApis_ function
  const pattern = /function\s+_listMvpApis_\s*\(\s*\)\s*\{\s*return\s*\[([\s\S]*?)\];/;
  const match = content.match(pattern);

  if (!match) {
    console.error('ERROR: Could not find _listMvpApis_() in Code.gs');
    process.exit(1);
  }

  // Parse the array contents
  const apis = match[1]
    .split(',')
    .map(s => s.trim().replace(/['"]/g, ''))
    .filter(s => s.length > 0);

  return apis;
}

// ============================================================================
// Extract RPC calls from a surface file
// ============================================================================

function extractRpcCalls(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const calls = new Set();

  // Match NU.rpc('api_name', ...) and NU.safeRpc('api_name', ...) patterns
  // S13: Added safeRpc for graceful degradation
  const rpcPattern = /NU\.(?:rpc|safeRpc)\s*\(\s*['"]([a-zA-Z_]+)['"]/g;
  let match;

  while ((match = rpcPattern.exec(content)) !== null) {
    calls.add(match[1]);
  }

  // Also look for dynamic RPC patterns like: rpcName = 'api_xxx'
  // SharedReport.html uses: const rpcName = IS_SPONSOR_VIEW ? 'api_getSponsorAnalytics' : 'api_getSharedAnalytics'
  const dynamicRpcPattern = /['"]api_[a-zA-Z_]+['"]/g;
  const dynamicContext = /(?:rpcName|apiName|endpoint|method)\s*[=:?]\s*.*?['"]([a-zA-Z_]+)['"]/g;

  while ((match = dynamicRpcPattern.exec(content)) !== null) {
    const apiName = match[0].replace(/['"]/g, '');
    // Verify it's in a dynamic assignment context (not just a string)
    const idx = match.index;
    const before = content.substring(Math.max(0, idx - 100), idx);
    if (before.match(/(?:rpcName|apiName|endpoint|method)\s*[=:?]|NU\.(?:rpc|safeRpc)\s*\(/)) {
      calls.add(apiName);
    }
  }

  return Array.from(calls).sort();
}

// ============================================================================
// Extract analytics events fed by a surface
// ============================================================================

function extractAnalyticsFed(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const metrics = new Set();

  // Match logEvent({ ... metric: 'name' ... }) patterns
  // Pattern 1: metric: 'value'
  const metricPattern = /logEvent\s*\(\s*\{[^}]*metric:\s*['"]([a-zA-Z_]+)['"]/g;
  let match;

  while ((match = metricPattern.exec(content)) !== null) {
    metrics.add(match[1]);
  }

  // Also look for metric patterns in SponsorUtils patterns
  // These are common across surfaces that use sponsor rendering
  const sponsorMetrics = /metric:\s*['"]([a-zA-Z_]+)['"]/g;
  while ((match = sponsorMetrics.exec(content)) !== null) {
    // Only add if it's in context of logEvent (check surrounding context)
    const idx = match.index;
    const before = content.substring(Math.max(0, idx - 100), idx);
    if (before.includes('logEvent')) {
      metrics.add(match[1]);
    }
  }

  // Surfaces that include SponsorUtils.html get impression/click from sponsor rendering
  // Check if this surface uses SponsorUtils or renderSponsors
  if (content.includes('renderSponsors') || content.includes('SponsorRenderer')) {
    metrics.add('impression');
    metrics.add('click');
  }

  return Array.from(metrics).sort();
}

// ============================================================================
// Extract surfaced links from Admin.html
// ============================================================================

function extractSurfacedLinks(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const links = new Set();

  // Match page= references that Admin links to
  const pagePattern = /page=([a-zA-Z]+)/g;
  let match;

  while ((match = pagePattern.exec(content)) !== null) {
    const page = match[1].toLowerCase();
    // Only include the MVP surfaces
    if (['public', 'display', 'poster', 'report'].includes(page)) {
      links.add(page);
    }
  }

  // Also detect links via links.xxxUrl pattern (e.g., links.publicUrl, links.displayUrl)
  const urlPattern = /links\.([a-zA-Z]+)Url/g;
  while ((match = urlPattern.exec(content)) !== null) {
    const surface = match[1].toLowerCase();
    // Map sharedReport to report
    const normalized = surface === 'sharedreport' ? 'report' : surface;
    if (['public', 'display', 'poster', 'report'].includes(normalized)) {
      links.add(normalized);
    }
  }

  // Also detect lnkXxx patterns (e.g., lnkPublic, lnkDisplay)
  const lnkPattern = /lnk(Public|Display|Poster|Report)/g;
  while ((match = lnkPattern.exec(content)) !== null) {
    links.add(match[1].toLowerCase());
  }

  return Array.from(links).sort();
}

// ============================================================================
// Extract analytics fields read by SharedReport
// ============================================================================

function extractAnalyticsRead() {
  // SharedReport reads from SharedAnalytics shape per schema contract
  // This is derived from shared-analytics.schema.json
  const schemaPath = path.join(ROOT, 'schemas', 'shared-analytics.schema.json');

  if (fs.existsSync(schemaPath)) {
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      const props = schema.properties || {};
      const reads = [];

      // Extract top-level property names that represent data sections
      for (const key of Object.keys(props)) {
        if (key !== 'lastUpdatedISO') { // Skip metadata
          reads.push(key);
        }
      }

      return reads.sort();
    } catch (e) {
      console.warn('Warning: Could not parse shared-analytics.schema.json');
    }
  }

  // Fallback: known analytics sections from SharedReporting.gs
  return ['summary', 'surfaces', 'sponsors', 'events', 'topSponsors'];
}

// ============================================================================
// Generate the wiring diagram
// ============================================================================

function generateWiringDiagram() {
  console.log('Generating integration wiring diagram...\n');

  // Get MVP APIs for reference
  const mvpApis = extractMvpApis();
  console.log(`MVP APIs from Code.gs: ${mvpApis.join(', ')}`);

  const diagram = {
    _meta: {
      generated: new Date().toISOString(),
      description: 'Integration wiring diagram showing how surfaces connect to APIs and Analytics',
      source: 'Generated by scripts/generate-wiring-diagram.js from source code analysis'
    },
    mvpApis: mvpApis,
    surfaces: {}
  };

  // Process each surface
  for (const [surfaceName, fileName] of Object.entries(SURFACES)) {
    const filePath = path.join(SRC_MVP, fileName);

    if (!fs.existsSync(filePath)) {
      console.warn(`Warning: ${fileName} not found, skipping`);
      continue;
    }

    console.log(`\nAnalyzing ${surfaceName} (${fileName})...`);

    const surfaceData = {
      file: fileName,
      calls: extractRpcCalls(filePath)
    };

    console.log(`  RPC calls: ${surfaceData.calls.join(', ') || '(none)'}`);

    // Special handling for different surface types
    if (surfaceName === 'Admin') {
      // Admin links to other surfaces
      surfaceData.surfacedLinks = extractSurfacedLinks(filePath);
      console.log(`  Surfaced links: ${surfaceData.surfacedLinks.join(', ')}`);
    } else if (surfaceName === 'SharedReport') {
      // SharedReport reads analytics
      surfaceData.readsAnalytics = extractAnalyticsRead();
      console.log(`  Reads analytics: ${surfaceData.readsAnalytics.join(', ')}`);
    } else {
      // Other surfaces feed analytics
      const analyticsFed = extractAnalyticsFed(filePath);
      if (analyticsFed.length > 0) {
        surfaceData.feedsAnalytics = analyticsFed;
        console.log(`  Feeds analytics: ${analyticsFed.join(', ')}`);
      }
    }

    diagram.surfaces[surfaceName] = surfaceData;
  }

  // Add API usage summary
  diagram.apiUsage = {};
  for (const api of mvpApis) {
    const usedBy = [];
    for (const [surfaceName, surfaceData] of Object.entries(diagram.surfaces)) {
      if (surfaceData.calls && surfaceData.calls.includes(api)) {
        usedBy.push(surfaceName);
      }
    }
    diagram.apiUsage[api] = {
      usedBy: usedBy,
      isOrphan: usedBy.length === 0
    };
  }

  // Find orphaned APIs (in mvpApis but not called by any surface)
  const orphanedApis = mvpApis.filter(api => diagram.apiUsage[api].isOrphan);
  if (orphanedApis.length > 0) {
    diagram.orphanedApis = orphanedApis;
    console.log(`\nWarning: Orphaned APIs (not called by any surface): ${orphanedApis.join(', ')}`);
  }

  return diagram;
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const args = process.argv.slice(2);
  const checkMode = args.includes('--check');

  console.log('Integration Wiring Diagram Generator');
  console.log('=====================================\n');

  const diagram = generateWiringDiagram();

  const jsonOutput = JSON.stringify(diagram, null, 2);

  if (checkMode) {
    // Check mode: compare with existing file
    console.log('\n--check mode: Validating existing diagram...');

    if (!fs.existsSync(OUTPUT_FILE)) {
      console.error(`\nERROR: ${OUTPUT_FILE} does not exist.`);
      console.error('Run without --check to generate it.');
      process.exit(1);
    }

    const existing = fs.readFileSync(OUTPUT_FILE, 'utf8');

    // Parse both and compare (ignoring _meta.generated timestamp)
    const existingParsed = JSON.parse(existing);
    const generatedParsed = JSON.parse(jsonOutput);

    // Remove timestamps for comparison
    delete existingParsed._meta?.generated;
    delete generatedParsed._meta?.generated;

    const existingNormalized = JSON.stringify(existingParsed, null, 2);
    const generatedNormalized = JSON.stringify(generatedParsed, null, 2);

    if (existingNormalized !== generatedNormalized) {
      console.error('\nERROR: Wiring diagram is out of sync!');
      console.error('The generated diagram differs from the committed version.');
      console.error(`\nPlease run: node scripts/generate-wiring-diagram.js`);
      console.error('And commit the updated diagram.\n');

      // Show a simple diff summary
      const existingKeys = Object.keys(existingParsed.surfaces || {});
      const generatedKeys = Object.keys(generatedParsed.surfaces || {});

      const added = generatedKeys.filter(k => !existingKeys.includes(k));
      const removed = existingKeys.filter(k => !generatedKeys.includes(k));

      if (added.length) console.log(`Surfaces added: ${added.join(', ')}`);
      if (removed.length) console.log(`Surfaces removed: ${removed.join(', ')}`);

      process.exit(1);
    }

    console.log('\nSUCCESS: Wiring diagram is in sync with source code.');
    process.exit(0);
  }

  // Generate mode: write the file
  console.log(`\nWriting wiring diagram to: ${OUTPUT_FILE}`);
  fs.writeFileSync(OUTPUT_FILE, jsonOutput);

  console.log('\nDone! Wiring diagram generated successfully.');

  // Print summary
  const surfaces = Object.keys(diagram.surfaces);
  const totalApis = diagram.mvpApis.length;
  const orphanCount = diagram.orphanedApis?.length || 0;

  console.log(`\nSummary:`);
  console.log(`  Surfaces analyzed: ${surfaces.length} (${surfaces.join(', ')})`);
  console.log(`  MVP APIs: ${totalApis}`);
  console.log(`  Orphaned APIs: ${orphanCount}`);
}

main();
