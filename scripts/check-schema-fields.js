#!/usr/bin/env node
/**
 * Surface → Schema Fields Linter
 *
 * Ensures no MVP HTML surface reads fields not defined in the JSON schema.
 * Kills schema drift by failing the build when a surface references
 * a field that doesn't exist in the canonical schema.
 *
 * Surface → Schema Mapping:
 *   - Admin.html    → event.schema.json
 *   - Public.html   → event.schema.json
 *   - Display.html  → event.schema.json
 *   - Poster.html   → event.schema.json
 *   - SharedReport.html → shared-analytics.schema.json (accessed via 'data.')
 *
 * Usage:
 *   node scripts/check-schema-fields.js
 *   node scripts/check-schema-fields.js --verbose
 *
 * Exit codes:
 *   0 - All field references are valid
 *   1 - Found references to fields not in schema
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHEMAS_DIR = path.join(ROOT, 'schemas');
const SRC_MVP = path.join(ROOT, 'src', 'mvp');

// CLI args
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

// ============================================================================
// Known Exceptions (documented backwards-compatibility patterns)
// ============================================================================
// These field references are intentionally allowed even though they're not
// in the schema. They represent documented backwards-compatibility patterns
// or graceful degradation for legacy data.
//
// To add a new exception:
// 1. Document WHY the exception is needed (backwards compatibility, etc.)
// 2. Ensure the code handles the field being undefined gracefully
// 3. Add the exception here with a comment explaining the reason
//
const KNOWN_EXCEPTIONS = {
  'SharedReport.html': [
    // Backwards-compat: fallback for legacy data before field was renamed
    // Code: const lastUpdated = data.lastUpdatedISO || data.lastUpdated || null;
    // Safe: Falls back gracefully when undefined, uses schema-compliant field first
    'lastUpdated',
  ],
};

// Surface → Schema mapping
const SURFACE_SCHEMA_MAP = {
  'Admin.html': { schema: 'event.schema.json', prefix: 'event' },
  'Public.html': { schema: 'event.schema.json', prefix: 'event' },
  'Display.html': { schema: 'event.schema.json', prefix: 'event' },
  'Poster.html': { schema: 'event.schema.json', prefix: 'event' },
  'SharedReport.html': { schema: 'shared-analytics.schema.json', prefix: 'data' },
};

// ============================================================================
// Schema Path Extraction
// ============================================================================

/**
 * Recursively extract all valid field paths from a JSON schema
 * @param {object} schema - JSON schema object
 * @param {string} currentPath - Current path prefix
 * @param {Set<string>} paths - Accumulator set
 * @param {object} defs - Schema $defs for resolving $ref
 * @returns {Set<string>} Set of valid paths
 */
function extractSchemaPaths(schema, currentPath = '', paths = new Set(), defs = null) {
  // Store root $defs for reference resolution
  if (!defs && schema.$defs) {
    defs = schema.$defs;
  }

  // Handle $ref
  if (schema.$ref) {
    const refPath = schema.$ref.replace('#/$defs/', '');
    if (defs && defs[refPath]) {
      extractSchemaPaths(defs[refPath], currentPath, paths, defs);
    }
    return paths;
  }

  // Handle oneOf (nullable types, union types)
  if (schema.oneOf) {
    for (const option of schema.oneOf) {
      if (option.$ref) {
        const refPath = option.$ref.replace('#/$defs/', '');
        if (defs && defs[refPath]) {
          extractSchemaPaths(defs[refPath], currentPath, paths, defs);
        }
      } else if (option.type !== 'null') {
        extractSchemaPaths(option, currentPath, paths, defs);
      }
    }
    return paths;
  }

  // Handle array items
  if (schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array'))) {
    // Add the array path itself
    if (currentPath) {
      paths.add(currentPath);
      // Also add [] notation for array access patterns
      paths.add(currentPath + '[]');
    }
    if (schema.items) {
      // Extract paths from array items (they'll be accessed via index or forEach)
      extractSchemaPaths(schema.items, currentPath, paths, defs);
    }
    return paths;
  }

  // Handle object properties
  if (schema.properties) {
    // Add the current object path itself
    if (currentPath) {
      paths.add(currentPath);
    }

    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const newPath = currentPath ? `${currentPath}.${propName}` : propName;
      paths.add(newPath);
      extractSchemaPaths(propSchema, newPath, paths, defs);
    }
  }

  // Handle primitive types - just add the path
  if (currentPath && !schema.properties) {
    paths.add(currentPath);
  }

  return paths;
}

/**
 * Load and parse a JSON schema, returning all valid field paths
 * @param {string} schemaName - Schema filename
 * @returns {Set<string>} Set of valid field paths
 */
function loadSchemaFields(schemaName) {
  const schemaPath = path.join(SCHEMAS_DIR, schemaName);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  return extractSchemaPaths(schema);
}

// ============================================================================
// HTML Field Reference Extraction
// ============================================================================

// DOM event methods that should be ignored when prefix is 'event'
// These are JavaScript event object methods, not schema fields
const DOM_EVENT_METHODS = [
  'preventDefault',
  'stopPropagation',
  'stopImmediatePropagation',
  'target',
  'currentTarget',
  'type',
  'bubbles',
  'cancelable',
  'defaultPrevented',
  'key',
  'keyCode',
  'which',
  'clientX',
  'clientY',
  'screenX',
  'screenY',
  'detail',
];

// Skip patterns - file references, schema contract mentions, etc.
const SKIP_FIELD_PATTERNS = [
  /^schema\.json$/,  // event.schema.json is a filename, not a field
];

/**
 * Extract field references from HTML content using regex patterns
 * Matches patterns like: event.name, event.settings.showSchedule, data.summary.totalClicks
 *
 * @param {string} content - HTML file content
 * @param {string} prefix - The variable prefix to look for (e.g., 'event', 'data')
 * @returns {Array<{line: number, field: string, fullMatch: string}>}
 */
function extractFieldReferences(content, prefix) {
  const results = [];
  const lines = content.split('\n');

  // Track if we're inside an HTML comment block
  let inHtmlComment = false;

  // Pattern explanation:
  // (?<![a-zA-Z_$]) - Negative lookbehind: not preceded by identifier chars
  // prefix - The exact variable name (event or data)
  // \??\.           - Optional chaining or regular dot
  // ([a-zA-Z_$][a-zA-Z0-9_$]*(?:\??\.[a-zA-Z_$][a-zA-Z0-9_$]*)*) - Field path chain
  const pattern = new RegExp(
    `(?<![a-zA-Z_$])${prefix}(\\??\\.([a-zA-Z_$][a-zA-Z0-9_$]*(?:\\??\\.[a-zA-Z_$][a-zA-Z0-9_$]*)*))`,
    'g'
  );

  lines.forEach((line, index) => {
    // Track HTML comment blocks
    if (line.includes('<!--')) {
      inHtmlComment = true;
    }
    if (line.includes('-->')) {
      inHtmlComment = false;
      return; // Skip lines that close HTML comments
    }

    // Skip if we're in an HTML comment block (schema documentation)
    if (inHtmlComment) {
      return;
    }

    // Skip lines that are pure schema contract documentation
    // These start with spaces and contain → or : as schema field documentation
    if (line.match(/^\s*-?\s*(?:event|data|summary|surface|sponsor|analytics)\.\S+\s*[→:]/)) {
      return;
    }

    // Skip JSDoc/block comment lines and JS single-line comments
    const trimmed = line.trim();
    if (trimmed.startsWith('*') && !trimmed.includes('=')) {
      return;
    }

    // Skip lines that are entirely JS comments
    if (trimmed.startsWith('//')) {
      return;
    }

    let match;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(line)) !== null) {
      const fullMatch = match[0];
      const fieldPath = match[2]; // The captured path after the prefix

      // Skip DOM event methods when checking 'event' prefix
      if (prefix === 'event' && DOM_EVENT_METHODS.includes(fieldPath.split('.')[0])) {
        continue;
      }

      // Skip known non-field patterns
      if (SKIP_FIELD_PATTERNS.some(p => p.test(fieldPath))) {
        continue;
      }

      // Skip if this is inside a JS comment on this line
      const beforeMatch = line.substring(0, match.index);
      if (beforeMatch.includes('//')) {
        // This reference is in a comment - skip it
        continue;
      }

      // Skip if in a block comment
      if (beforeMatch.includes('/*') && !beforeMatch.includes('*/')) {
        continue;
      }

      // Skip file path references like "/schemas/event.schema.json"
      if (beforeMatch.match(/\/schemas?\//)) {
        continue;
      }

      results.push({
        line: index + 1,
        field: fieldPath,
        fullMatch: fullMatch,
      });
    }
  });

  return results;
}

/**
 * Also extract references from array iteration patterns
 * e.g., sponsors.forEach(s => s.name) → validates s.name against Sponsor schema
 * But for simplicity, we'll validate against the array item schema
 *
 * NOTE: This is intentionally conservative to avoid false positives.
 * We only check iterator variables that are clearly from schema arrays
 * and have explicit, unambiguous mappings.
 *
 * @param {string} content - HTML file content
 * @param {Set<string>} validPaths - Valid schema paths
 * @returns {Array<{line: number, field: string, fullMatch: string, type: string}>}
 */
function extractIterationReferences(content, validPaths) {
  const results = [];
  const lines = content.split('\n');

  // Track HTML comment blocks
  let inHtmlComment = false;

  // Map known schema array names to their schema paths
  // Only include arrays that are clearly defined in the schemas
  const arrayToSchemaPath = {
    'sponsors': 'sponsors',
    'surfaces': 'surfaces',
    'events': 'events',
    'topSponsors': 'topSponsors',
    'schedule': 'schedule',
    'standings': 'standings',
  };

  // Explicitly named iterator variables that map to schema arrays
  // We only track these specific, unambiguous variable names
  const knownIteratorVars = {
    'sponsor': 'sponsors',
    'surface': 'surfaces',
    'evt': 'events',
    'topSponsor': 'topSponsors',
  };

  // Build a set of schema item fields for quick lookup
  const schemaItemFields = {};
  for (const [varName, schemaPath] of Object.entries(knownIteratorVars)) {
    schemaItemFields[varName] = new Set();
    for (const path of validPaths) {
      if (path.startsWith(schemaPath + '.')) {
        const itemField = path.substring(schemaPath.length + 1);
        // Only add direct fields, not nested paths
        const firstPart = itemField.split('.')[0];
        schemaItemFields[varName].add(firstPart);
      }
    }
  }

  lines.forEach((line, index) => {
    // Track HTML comment blocks
    if (line.includes('<!--')) {
      inHtmlComment = true;
    }
    if (line.includes('-->')) {
      inHtmlComment = false;
      return;
    }

    // Skip HTML comment blocks
    if (inHtmlComment) {
      return;
    }

    // Skip comment lines
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
      return;
    }

    // Check each known iterator variable
    for (const [iterVar, schemaPath] of Object.entries(knownIteratorVars)) {
      // Only match if we see the iterator being used in an array context on this line
      // or if the iterator pattern was established earlier
      const iterPattern = new RegExp(`(?<![a-zA-Z_$])${iterVar}\\.([a-zA-Z_$][a-zA-Z0-9_$]*)`, 'g');

      let match;
      while ((match = iterPattern.exec(line)) !== null) {
        const fieldName = match[1];
        const fullPath = `${schemaPath}.${fieldName}`;
        const fullMatch = match[0];

        // Check if this field exists in the schema
        if (!validPaths.has(fullPath) && !schemaItemFields[iterVar]?.has(fieldName)) {
          // Double-check: make sure this looks like an array iteration context
          // by checking if the schema array is referenced nearby
          if (content.includes(`${schemaPath}.forEach`) ||
              content.includes(`${schemaPath}.map`) ||
              content.includes(`${schemaPath}.filter`) ||
              content.includes(`for (const ${iterVar} of`)) {
            results.push({
              line: index + 1,
              field: fullPath,
              fullMatch: fullMatch,
              type: 'iterator',
              iteratorVar: iterVar,
            });
          }
        }
      }
    }
  });

  return results;
}

// ============================================================================
// Validation Logic
// ============================================================================

/**
 * Normalize a field path for comparison
 * Handles optional chaining (?.) by converting to regular dots
 * @param {string} fieldPath - Field path to normalize
 * @returns {string} Normalized path
 */
function normalizePath(fieldPath) {
  return fieldPath.replace(/\?\./g, '.');
}

/**
 * Check if a field path is valid against the schema paths
 * @param {string} fieldPath - Field path to check
 * @param {Set<string>} validPaths - Set of valid schema paths
 * @returns {boolean} True if valid
 */
function isValidField(fieldPath, validPaths) {
  const normalized = normalizePath(fieldPath);

  // Direct match
  if (validPaths.has(normalized)) {
    return true;
  }

  // Check if it's a prefix of a valid path (accessing a parent object)
  for (const validPath of validPaths) {
    if (validPath.startsWith(normalized + '.')) {
      return true;
    }
  }

  // Check array item access pattern
  // e.g., sponsors[0].name should match sponsors.name
  const withoutArrayIndices = normalized.replace(/\[\d+\]/g, '');
  if (validPaths.has(withoutArrayIndices)) {
    return true;
  }

  return false;
}

/**
 * Check if a field is in the known exceptions list
 * @param {string} fileName - HTML file name
 * @param {string} fieldPath - Field path to check
 * @returns {boolean} True if this is a known exception
 */
function isKnownException(fileName, fieldPath) {
  const exceptions = KNOWN_EXCEPTIONS[fileName] || [];
  // Check if the field or any parent path is in the exception list
  return exceptions.some(exc => fieldPath === exc || fieldPath.startsWith(exc + '.'));
}

/**
 * Validate all field references in an HTML surface
 * @param {string} fileName - HTML file name
 * @param {object} config - Surface configuration {schema, prefix}
 * @returns {{valid: Array, invalid: Array, exceptions: Array}}
 */
function validateSurface(fileName, config) {
  const filePath = path.join(SRC_MVP, fileName);
  const content = fs.readFileSync(filePath, 'utf8');
  const validPaths = loadSchemaFields(config.schema);

  if (verbose) {
    console.log(`\n  Schema paths for ${config.schema}:`);
    const sortedPaths = [...validPaths].sort();
    sortedPaths.slice(0, 20).forEach(p => console.log(`    - ${p}`));
    if (sortedPaths.length > 20) {
      console.log(`    ... and ${sortedPaths.length - 20} more`);
    }
  }

  const references = extractFieldReferences(content, config.prefix);
  const valid = [];
  const invalid = [];
  const exceptions = [];

  for (const ref of references) {
    if (isValidField(ref.field, validPaths)) {
      valid.push(ref);
    } else if (isKnownException(fileName, ref.field)) {
      exceptions.push({
        ...ref,
        file: fileName,
        schema: config.schema,
      });
    } else {
      invalid.push({
        ...ref,
        file: fileName,
        schema: config.schema,
      });
    }
  }

  // Also check iterator patterns (for array item fields)
  const iteratorRefs = extractIterationReferences(content, validPaths);
  for (const ref of iteratorRefs) {
    if (isKnownException(fileName, ref.field)) {
      exceptions.push({
        ...ref,
        file: fileName,
        schema: config.schema,
      });
    } else {
      invalid.push({
        ...ref,
        file: fileName,
        schema: config.schema,
      });
    }
  }

  return { valid, invalid, exceptions };
}

// ============================================================================
// Main
// ============================================================================

function main() {
  console.log('🔍 Surface → Schema Fields Linter\n');
  console.log('   Validates that HTML surfaces only reference fields defined in schemas.');
  console.log('   Prevents schema drift between UI and data contracts.\n');

  const allValid = [];
  const allInvalid = [];
  const allExceptions = [];

  // Process each surface
  for (const [fileName, config] of Object.entries(SURFACE_SCHEMA_MAP)) {
    console.log(`📄 Checking ${fileName} → ${config.schema}`);

    try {
      const { valid, invalid, exceptions } = validateSurface(fileName, config);
      allValid.push(...valid);
      allInvalid.push(...invalid);
      allExceptions.push(...exceptions);

      if (verbose) {
        console.log(`   ✓ ${valid.length} valid references`);
        if (exceptions.length > 0) {
          console.log(`   ⚠ ${exceptions.length} documented exceptions`);
        }
        if (invalid.length > 0) {
          console.log(`   ✗ ${invalid.length} invalid references`);
        }
      }
    } catch (err) {
      console.error(`   ❌ Error processing ${fileName}: ${err.message}`);
      process.exit(1);
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('SUMMARY');
  console.log('═'.repeat(60));

  console.log(`\n✅ Valid field references: ${allValid.length}`);

  if (allExceptions.length > 0) {
    console.log(`⚠️  Documented exceptions: ${allExceptions.length}`);
    if (verbose) {
      console.log('   (backwards-compatibility patterns in KNOWN_EXCEPTIONS)');
      for (const ref of allExceptions) {
        console.log(`   - ${ref.file}: ${ref.field}`);
      }
    }
  }

  if (allInvalid.length === 0) {
    console.log('\n🎉 SUCCESS: All surface field references are valid!');
    console.log('   No schema drift detected. UI matches data contracts.');
    process.exit(0);
  } else {
    console.log(`\n❌ Invalid field references: ${allInvalid.length}`);
    console.log('\nThe following fields are referenced but NOT in the schema:\n');

    // Group by file
    const byFile = {};
    for (const ref of allInvalid) {
      if (!byFile[ref.file]) {
        byFile[ref.file] = [];
      }
      byFile[ref.file].push(ref);
    }

    for (const [file, refs] of Object.entries(byFile)) {
      console.log(`  ${file}:`);
      for (const ref of refs) {
        console.log(`    Line ${ref.line}: ${ref.fullMatch}`);
        console.log(`      Field "${ref.field}" not in ${ref.schema}`);
        if (ref.type === 'iterator') {
          console.log(`      (from iterator variable: ${ref.iteratorVar})`);
        }
      }
      console.log('');
    }

    console.log('To fix:');
    console.log('  1. Add the missing field to the JSON schema, OR');
    console.log('  2. Remove the field reference from the HTML surface, OR');
    console.log('  3. Add to KNOWN_EXCEPTIONS if this is intentional backwards-compat');
    console.log('\nSchema files:');
    console.log('  - /schemas/event.schema.json');
    console.log('  - /schemas/shared-analytics.schema.json');

    console.log('\n❌ FAILED: Schema drift detected. Fix before proceeding.\n');
    process.exit(1);
  }
}

main();
