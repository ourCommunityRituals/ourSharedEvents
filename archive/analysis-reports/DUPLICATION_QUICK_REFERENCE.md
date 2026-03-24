# Code Duplication - Quick Reference Card

## Top 5 Duplication Issues to Fix

| Rank | Issue | Location | Savings | Priority | Effort |
|------|-------|----------|---------|----------|--------|
| 1 | Validation tests re-implement Code.gs functions | security.test.js, validation.test.js | 350+ lines | ⭐⭐⭐ HIGH | 3-4h |
| 2 | CRUD test boilerplate (create/update/delete) | events-crud-api.spec.js, sponsors-crud-api.spec.js | 100+ lines | ⭐⭐⭐ HIGH | 2-3h |
| 3 | Sheet initialization functions (3x duplicate) | Code.gs lines 956-1010 | 30-40 lines | ⭐⭐ MEDIUM | 2-3h |
| 4 | Analytics aggregation duplicate logic | Code.gs + SharedReporting.gs | 60 lines | ⭐⭐ MEDIUM | 3-4h |
| 5 | CRUD test setup/teardown | events-crud-api.spec.js, sponsors-crud-api.spec.js | 20-30 lines | ⭐ LOW | 1-2h |

## Critical Files with Highest Duplication

```
✅ tests/unit/security.test.js (884 lines)
   - Duplicates 4+ production functions
   - 350+ lines of duplicate implementations
   - Lines 98-170, 235-281, 283-338, 340-440
   
✅ tests/unit/validation.test.js (585 lines)
   - Duplicates validation functions
   - 120+ lines of duplicate implementations
   - Lines 254-309, 386-476

✅ tests/e2e/api/events-crud-api.spec.js (398 lines)
   - Identical setup as sponsors-crud-api.spec.js
   - Identical test patterns
   - 80-100 lines duplicated

✅ tests/e2e/api/sponsors-crud-api.spec.js (316 lines)
   - Same issues as events-crud-api.spec.js
   - 60-80 lines duplicated

✅ Code.gs (1685 lines)
   - 3 sheet functions with identical patterns (50 lines)
   - Analytics aggregation logic duplicated (60 lines)
   - CTR calculation inlined instead of using helper
```

## Implementation Checklist (In Priority Order)

### Week 1: Test Consolidation (490-520 lines saved)

- [ ] **Extract CRUD fixtures (4-5h)**
  - [ ] Create `tests/shared/fixtures/crud-setup.js`
  - [ ] Create `tests/shared/fixtures/crud-tests.js`
  - [ ] Update events-crud-api.spec.js
  - [ ] Update sponsors-crud-api.spec.js
  - [ ] Verify all tests pass

- [ ] **Remove validation function duplicates (5-6h)** ⭐ HIGHEST IMPACT
  - [ ] Import Code.gs functions into security.test.js
  - [ ] Remove sanitizeInput_() implementation
  - [ ] Remove isUrl() implementation
  - [ ] Remove sanitizeId_() implementation
  - [ ] Remove sanitizeSpreadsheetValue_() implementation
  - [ ] Import Code.gs functions into validation.test.js
  - [ ] Remove safeJSONParse_() implementation
  - [ ] Verify all tests pass

- [ ] **Extract brand isolation fixtures (2-3h)**
  - [ ] Create `tests/shared/fixtures/brand-isolation.js`
  - [ ] Update security.test.js (lines 603-629)
  - [ ] Update validation.test.js (lines 386-476)
  - [ ] Verify all tests pass

**Phase 1 Total: 11-14 hours | Savings: 490-520 lines**

### Week 2: Production Code Consolidation (100 lines saved)

- [ ] **Create ensureSheet_() helper (2-3h)**
  - [ ] Extract common sheet initialization pattern
  - [ ] Update getStoreSheet_()
  - [ ] Update _ensureAnalyticsSheet_()
  - [ ] Update _ensureShortlinksSheet_()
  - [ ] Test all sheet operations
  - [ ] Verify data integrity

- [ ] **Consolidate analytics aggregation (3-4h)**
  - [ ] Create aggregateByDimension_() or reuse SharedReporting functions
  - [ ] Update api_getReport()
  - [ ] Update engagement rate calculation
  - [ ] Test all analytics functionality
  - [ ] Verify report accuracy

**Phase 2 Total: 5-7 hours | Savings: 100 lines**

### Week 3+: Optional Optimizations (40-60 lines saved)

- [ ] Consolidate contract/smoke test overlap (2-3h)
- [ ] Normalize engagement rate calculations (1h)
- [ ] Final code review and validation (2h)

## Copy-Paste Templates for Consolidation

### Template 1: Extract CRUD Fixture Setup

```javascript
// tests/shared/fixtures/crud-setup.js
import { ApiHelpers } from '../api-helpers';
import { getCurrentEnvironment } from '../../config/environments';

export function setupCrudTests() {
  let api;
  let adminKey;
  const brand = 'root';
  const createdIds = [];

  const beforeEach = async ({ request }) => {
    const env = getCurrentEnvironment();
    api = new ApiHelpers(request, env.baseUrl);
    adminKey = process.env.ADMIN_KEY;
  };

  const afterEach = async (deleteFunction) => {
    for (const id of createdIds) {
      try {
        await deleteFunction(brand, id, adminKey);
      } catch (error) {
        console.warn(`Failed to delete: ${error.message}`);
      }
    }
    createdIds.length = 0;
  };

  return { beforeEach, afterEach, createdIds };
}
```

### Template 2: Remove Function Re-implementation

**Before (WRONG):**
```javascript
describe('Bug #14: Input Sanitization', () => {
  let sanitizeInput_;
  
  beforeEach(() => {
    sanitizeInput_ = function(input, maxLength = 1000) {
      // DUPLICATE CODE FROM Code.gs
      let sanitized = String(input)
        .replace(/[\x00-\x1F\x7F]/g, '')
        .replace(/[<>"'`&]/g, '')
        // ... more duplication
      return sanitized.slice(0, maxLength);
    };
  });
  
  test('should remove HTML', () => {
    expect(sanitizeInput_('<script>')).toBe('script');
  });
});
```

**After (CORRECT):**
```javascript
// Import the real function (adjust path as needed)
import { sanitizeInput_ } from '../../Code.gs';

describe('Bug #14: Input Sanitization', () => {
  test('should remove HTML special characters', () => {
    expect(sanitizeInput_('<script>alert("xss")</script>'))
      .toBe('scriptalert(xss)/script');
  });
  
  test('should remove dangerous protocols', () => {
    expect(sanitizeInput_('javascript:alert(1)'))
      .toBe('alert(1)');
  });
});
```

## Success Metrics

### Current State (Before)
- Total Lines: 11,805 (2,429 prod + 9,376 test)
- Duplication Index: 5.2%
- Duplicate Lines: 610-620

### Target State (After)
- Total Lines: 11,220 (2,370 prod + 8,850 test)
- Duplication Index: <2%
- Reduction: 585+ lines (5%)
- Maintenance Burden: 15-20% lower

## Testing Strategy During Consolidation

1. **Before changes:** Run full test suite, document baseline
   ```bash
   npm run test:all
   ```

2. **After each consolidation task:** Run affected tests
   ```bash
   # Test specific areas
   npm run test:unit:security
   npm run test:unit:validation
   npm run test:e2e:api
   ```

3. **Final validation:** Full test suite + code coverage report
   ```bash
   npm run test:all --coverage
   ```

## Links to Detailed Documentation

- **Full Analysis:** `CODE_DUPLICATION_ANALYSIS.txt` (623 lines)
  - Detailed line-by-line breakdown
  - Code examples for each duplication pattern
  - Risk assessment and mitigation strategies
  - Comprehensive implementation roadmap

- **Executive Summary:** `DUPLICATION_SUMMARY.md`
  - 2-minute overview for stakeholders
  - Priority-ordered findings
  - Expected impact metrics
  - Success criteria

- **This File:** `DUPLICATION_QUICK_REFERENCE.md`
  - Quick lookup guide
  - Implementation checklist
  - Templates for consolidation

---

**Last Updated:** 2025-11-15
**Analysis Method:** Comprehensive static code analysis + manual review
**Analyzed Files:** Code.gs, SharedReporting.gs, Config.gs, 50+ test files
**Total Analysis Time:** 2+ hours of detailed investigation
