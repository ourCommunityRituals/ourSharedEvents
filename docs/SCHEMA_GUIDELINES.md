# API Schema Guidelines (Story 3.1)

> **Version:** 1.0
> **Created:** 2025-12-11
> **Purpose:** Guide for managing JSON schemas and API response validation

This document describes how to work with API response schemas in the MVP Event Toolkit. Schemas ensure API contract compliance and catch breaking changes early in CI.

---

## Overview

The toolkit uses JSON Schema (draft 2020-12) for validating API responses. All schemas are:

- **Version controlled** in `/schemas/` directory
- **Validated in CI** via `npm run test:schema-validation`
- **Enforced with strict mode** (`additionalProperties: false`)

---

## Schema Files

### Location

All schema files are in `/schemas/*.schema.json`:

```
schemas/
├── api-envelope.schema.json       # Success/Error envelope wrapper
├── list-response.schema.json      # List endpoint responses
├── bundle-response.schema.json    # Bundle endpoint responses
├── get-response.schema.json       # Single entity GET responses
├── save-response.schema.json      # Create/Update responses
├── delete-response.schema.json    # Delete responses
├── analytics-response.schema.json # Analytics endpoint responses
├── event.schema.json              # Event entity (MVP v1.0 FROZEN)
├── sponsor.schema.json            # Sponsor entity
├── shared-analytics.schema.json   # SharedAnalytics (MVP v1.1 FROZEN)
├── status.schema.json             # Flat status response
├── status-mvp.schema.json         # Flat MVP status response
├── status-envelope.schema.json    # Envelope status response
├── sponsor-report-qr.schema.json  # QR code response
├── setupcheck.schema.json         # Setup check response
├── checkpermissions.schema.json   # Permissions check response
├── form-config.schema.json        # Form configuration
└── deploy-manifest.schema.json    # Deployment manifest
```

### Schema Categories

| Category | Schemas | Purpose |
|----------|---------|---------|
| **API Responses** | `api-envelope`, `list-response`, `bundle-response`, `get-response`, `save-response`, `delete-response`, `analytics-response` | Validate API response structures |
| **Entities** | `event`, `sponsor`, `shared-analytics` | Validate domain entities |
| **Flat Responses** | `status`, `status-mvp` | Health endpoint responses (no envelope) |
| **Utilities** | `form-config`, `deploy-manifest`, etc. | Configuration and tooling |

---

## How to Validate Responses

### In Tests

```javascript
const {
  validateResponse,
  validateAgainstSchema,
  validateEvent,
  extendJestWithSchemaMatchers
} = require('../shared/helpers/schema-validator');

// Option 1: Validate with assertion (throws on failure)
validateResponse(apiResponse, 'api-envelope');

// Option 2: Get validation result
const { valid, errors } = validateAgainstSchema(data, 'event');
if (!valid) {
  console.error('Validation errors:', errors);
}

// Option 3: Jest matcher
extendJestWithSchemaMatchers();
expect(response).toMatchSchema('api-envelope');

// Option 4: Entity-specific validators
const { valid, errors } = validateEvent(eventData);
```

### Available Validators

| Function | Purpose |
|----------|---------|
| `validateResponse(data, schemaId)` | Throws if validation fails |
| `validateAgainstSchema(data, schemaId)` | Returns `{ valid, errors }` |
| `validateEndpointResponse(data, endpoint)` | Auto-selects schema by endpoint |
| `validateEvent(data)` | Validates event entity |
| `validateSponsor(data)` | Validates sponsor entity |
| `validateSharedAnalytics(data)` | Validates analytics data |
| `validateFlatStatus(data)` | Validates flat status response |

### Schema IDs

Use these IDs with validation functions:

```javascript
// API Responses
'api-envelope'        // Generic envelope
'list-response'       // List with pagination
'bundle-response'     // Bundle (event + config)
'get-response'        // Single entity
'save-response'       // Create/update result
'delete-response'     // Delete result
'analytics-response'  // Analytics data

// Entities
'event'              // Event entity
'sponsor'            // Sponsor entity
'shared-analytics'   // Analytics report

// Status (Flat)
'status'             // Health check
'status-mvp'         // MVP health check
```

---

## How to Update Schemas

### Step 1: Identify the Change Type

| Change Type | Impact | Process |
|-------------|--------|---------|
| Add optional field | Non-breaking | Update schema, add tests |
| Add required field | **BREAKING** | Requires migration plan |
| Remove field | **BREAKING** | Deprecate first, then remove |
| Change field type | **BREAKING** | Requires migration plan |
| Rename field | **BREAKING** | Add new field, deprecate old |

### Step 2: Update the Schema

1. Edit the schema file in `/schemas/`
2. Add `$comment` with version info:
   ```json
   {
     "$comment": "v1.1 updated 2025-12-11: Added optional 'newField' property"
   }
   ```

3. Update examples if affected:
   ```json
   "examples": [
     { "field": "value", "newField": "optional value" }
   ]
   ```

### Step 3: Update Tests

1. Run existing tests to see failures:
   ```bash
   npm run test:schema-validation
   ```

2. Update test fixtures to include new fields
3. Add new test cases for the change:
   ```javascript
   it('should validate event with new optional field', () => {
     const event = createValidEvent();
     event.newField = 'value';
     const result = validateEvent(event);
     expect(result.valid).toBe(true);
   });
   ```

### Step 4: Update Code

1. Update API handlers to include new fields
2. Update TypeScript types (if applicable)
3. Update client code consuming the API

### Step 5: Create Pull Request

PR must include:
- [ ] Schema file changes
- [ ] Updated tests
- [ ] API handler updates
- [ ] Migration guide (for breaking changes)

---

## Frozen Schemas

Some schemas are **frozen** and require migration for changes:

### event.schema.json (v1.0 FROZEN - 2025-11-30)
- All MVP-required fields are stable
- Adding optional V2 fields is allowed
- Removing/renaming fields requires migration

### shared-analytics.schema.json (v1.1 FROZEN)
- Summary and surfaces structures are stable
- Adding optional metrics is allowed
- Breaking changes require semver bump

### Breaking Change Process for Frozen Schemas

1. Create migration document
2. Add deprecated marker to old field
3. Implement new field alongside old
4. Update all consumers
5. Remove old field in next major version

---

## Running Schema Validation

### Local Commands

```bash
# Run schema validation tests
npm run test:schema-validation

# Run with verbose output
npm run test:schema-validation:verbose

# Run all schema checks
npm run check:schemas:all

# Run as part of guards (CI)
npm run check:guards
```

### CI Pipeline

Schema validation runs automatically in:
- `npm run test` (via check:guards)
- `npm run test:contract` (includes schema tests)
- Stage 1 CI pipeline

### Test Output

```
PASS  tests/contract/api-schema-validation.contract.test.js
  API Schema Validation (Story 3.1)
    Schema Loading & Compilation
      ✓ should load all registered schemas successfully
      ✓ should have all required API response schemas
      ✓ should compile schemas without errors
    API Envelope Schema
      ✓ should validate success envelope with value
      ✓ should validate error envelope with required fields
    Schema Mismatch Detection
      ✓ should detect missing required field
      ✓ should detect wrong field type
      ✓ should detect additional properties in strict schemas
```

---

## Common Validation Errors

### Missing Required Field
```
Schema validation failed for event:
  [1] /: must have required property 'links'
```
**Fix:** Add the missing field to your data.

### Additional Property
```
Schema validation failed for event:
  [1] /: must NOT have additional properties {"additionalProperty":"extraField"}
```
**Fix:** Remove the extra field or update the schema.

### Wrong Type
```
Schema validation failed for list-response:
  [1] /value/pagination/total: must be integer
```
**Fix:** Ensure the field has the correct type.

### Pattern Mismatch
```
Schema validation failed for event:
  [1] /slug: must match pattern "^[a-z0-9-]+$"
```
**Fix:** Ensure string matches the required pattern.

---

## Best Practices

### Do

- Add descriptive `description` to all properties
- Use `examples` array for documentation
- Test edge cases (null, empty, boundary values)
- Use specific patterns for identifiers
- Version schemas with `$comment`

### Don't

- Remove required fields without migration
- Change field types without versioning
- Skip validation in tests
- Ignore validation errors in CI
- Use loose validation (`additionalProperties: true`)

---

## Integration with API_CONTRACT.md

This schema system complements the API contract:

| Contract Rule | Schema Enforcement |
|---------------|-------------------|
| Flat endpoints return no envelope | `validateFlatStatus()` checks no `value` wrapper |
| Envelope endpoints wrap in `value` | `validateAgainstSchema(..., 'api-envelope')` |
| Error responses have code+message | Error envelope schema requires both |
| notModified omits value | NotModified variant allows missing value |

See [API_CONTRACT.md](../API_CONTRACT.md) for full contract details.

---

## Troubleshooting

### Schema Not Found
```
Error: Unknown schema ID: my-schema
```
Check that the schema is registered in `SCHEMA_REGISTRY` in `schema-validator.js`.

### Tests Fail After Schema Update
1. Clear schema cache: `clearSchemaCache()`
2. Check for typos in schema file
3. Validate JSON syntax
4. Run `npm run test:schema-validation:verbose`

### AJV Compilation Error
```
Error: strict mode: unknown keyword: "$foobar"
```
Ensure you're using valid JSON Schema draft 2020-12 keywords.

---

## Support

- **Schema Issues:** Check `/tests/contract/api-schema-validation.contract.test.js`
- **Validation Utility:** See `/tests/shared/helpers/schema-validator.js`
- **API Contract:** See `/API_CONTRACT.md`
- **Event Schema:** See `/EVENT_CONTRACT.md`
