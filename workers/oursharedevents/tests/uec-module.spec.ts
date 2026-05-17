/**
 * OSE-320 — UEC module unit tests
 *
 * Pure-function unit coverage for `src/lib/uec/index.ts` — the canonical
 * lookup surface for UEC codes. These tests don't go through HTTP; they
 * call the lookup helpers directly. Per OCR_STANDARD_perStoryTestPyramid
 * such tests carry no layer qualifier (UNIT bucket).
 *
 * Coverage:
 *   - All 11 codes resolvable by id (case-insensitive) — happy path
 *   - All 11 codes resolvable by label (case-insensitive)
 *   - Whitespace trim — ` GREEN `, `\tENTER\n`, etc.
 *   - Null / undefined / empty-string / non-string → null (not throw)
 *   - Non-canonical strings → null
 *   - allCodes() returns 11 in canonical order (01-11 by num)
 *   - allCodeIds() returns 11 unique uppercase ids
 *   - allCodeLabels() returns 11 labels matching CODES order
 *   - allValidIdentifiers() returns ids + labels (22 total)
 *   - Type narrowing — UECCode interface fields all present on every code
 */

import { describe, test, expect } from 'vitest';
import {
  getCode,
  allCodes,
  allCodeIds,
  allCodeLabels,
  allValidIdentifiers,
  VERSION,
  VERTICALS,
  CODES,
} from '../src/lib/uec';

describe('OSE-320 UEC module — version + structural shape', () => {
  test('OSE-320 | UEC.VERSION | matches brain artifact (1.1)', () => {
    expect(VERSION).toBe('1.1');
  });

  test('OSE-320 | UEC.CODES | exactly 11 codes (7 core + 4 extension)', () => {
    expect(CODES).toHaveLength(11);
  });

  test('OSE-320 | UEC.VERTICALS | exactly 10 canonical verticals', () => {
    expect(VERTICALS).toHaveLength(10);
    expect(VERTICALS).toContain('Sports');
    expect(VERTICALS).toContain('Fundraising');
  });

  test('OSE-320 | UEC.allCodes() | returns 11 codes in canonical num order', () => {
    const codes = allCodes();
    expect(codes).toHaveLength(11);
    const nums = codes.map((c) => c.num);
    expect(nums).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11']);
  });

  test('OSE-320 | UEC.allCodeIds() | returns 11 unique uppercase ids', () => {
    const ids = allCodeIds();
    expect(ids).toHaveLength(11);
    expect(new Set(ids).size).toBe(11);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Z][A-Z0-9-]*[A-Z0-9]$/);
    }
  });

  test('OSE-320 | UEC.allCodeLabels() | returns 11 labels matching CODES order', () => {
    const labels = allCodeLabels();
    expect(labels).toHaveLength(11);
    expect(labels[0]).toBe('Green');
    expect(labels[10]).toBe('Dark Teal');
  });

  test('OSE-320 | UEC.allValidIdentifiers() | returns 22 (ids + labels)', () => {
    expect(allValidIdentifiers()).toHaveLength(22);
  });

  test('OSE-320 | UEC.CODES | every code carries all required UECCode fields', () => {
    for (const code of CODES) {
      expect(code.id).toBeTruthy();
      expect(code.num).toMatch(/^\d{2}$/);
      expect(code.label).toBeTruthy();
      expect(code.scan_hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(code.display_hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(code.semantics).toBeTruthy();
      expect(code.description).toBeTruthy();
      expect(code.url_path).toMatch(/^\/[a-z][a-z0-9-]*$/);
      expect(['Arrival', 'During', 'Post', 'Anytime']).toContain(code.phase);
      expect(['KEEP', 'ADD', 'CHANGE']).toContain(code.status);
      expect(['AAA', 'AA']).toContain(code.wcag_grade);
      expect(code.verticals.length).toBeGreaterThan(0);
      // Every code's verticals must be a subset of canonical VERTICALS
      for (const v of code.verticals) {
        expect(VERTICALS).toContain(v);
      }
    }
  });

  test('OSE-320 | UEC.CODES | extension codes (08-11) carry extension_priority; core (01-07) do not', () => {
    for (const code of CODES) {
      const isExtension = Number(code.num) >= 8;
      if (isExtension) {
        expect(code.extension_priority).toBeDefined();
        expect(['HIGH', 'MEDIUM', 'LOW']).toContain(code.extension_priority);
      } else {
        expect(code.extension_priority).toBeUndefined();
      }
    }
  });
});

describe('OSE-320 UEC module — getCode() canonical id lookup', () => {
  // Every code resolvable by its exact canonical id
  for (const code of CODES) {
    test(`OSE-320 | UEC.getCode("${code.id}") | returns canonical ${code.id}`, () => {
      const result = getCode(code.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(code.id);
      expect(result?.scan_hex).toBe(code.scan_hex);
    });
  }
});

describe('OSE-320 UEC module — getCode() canonical label lookup', () => {
  // Every code resolvable by its label (this is the AC example: "green" → ENTER)
  for (const code of CODES) {
    test(`OSE-320 | UEC.getCode("${code.label}") | returns canonical ${code.id} (matched by label)`, () => {
      const result = getCode(code.label);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(code.id);
      expect(result?.label).toBe(code.label);
    });
  }
});

describe('OSE-320 UEC module — getCode() case-insensitive', () => {
  test('OSE-320 | UEC.getCode("green") | resolves to ENTER (lowercase label)', () => {
    const result = getCode('green');
    expect(result?.id).toBe('ENTER');
  });

  test('OSE-320 | UEC.getCode("GREEN") | resolves to ENTER (uppercase label)', () => {
    const result = getCode('GREEN');
    expect(result?.id).toBe('ENTER');
  });

  test('OSE-320 | UEC.getCode("Green") | resolves to ENTER (titlecase label)', () => {
    const result = getCode('Green');
    expect(result?.id).toBe('ENTER');
  });

  test('OSE-320 | UEC.getCode("enter") | resolves to ENTER (lowercase id)', () => {
    const result = getCode('enter');
    expect(result?.id).toBe('ENTER');
  });

  test('OSE-320 | UEC.getCode("EnTeR") | resolves to ENTER (mixed-case id)', () => {
    const result = getCode('EnTeR');
    expect(result?.id).toBe('ENTER');
  });

  test('OSE-320 | UEC.getCode("dark teal") | resolves to SHOP (multi-word label)', () => {
    const result = getCode('dark teal');
    expect(result?.id).toBe('SHOP');
  });

  test('OSE-320 | UEC.getCode("check-in") | resolves to CHECK-IN (hyphenated id)', () => {
    const result = getCode('check-in');
    expect(result?.id).toBe('CHECK-IN');
  });
});

describe('OSE-320 UEC module — getCode() whitespace tolerance', () => {
  test('OSE-320 | UEC.getCode(" green ") | trims leading/trailing space', () => {
    expect(getCode(' green ')?.id).toBe('ENTER');
  });

  test('OSE-320 | UEC.getCode("\\tENTER\\n") | trims tabs/newlines', () => {
    expect(getCode('\tENTER\n')?.id).toBe('ENTER');
  });

  test('OSE-320 | UEC.getCode("  SPONSOR  ") | trims multi-space padding', () => {
    expect(getCode('  SPONSOR  ')?.id).toBe('SPONSOR');
  });
});

describe('OSE-320 UEC module — getCode() refusal paths', () => {
  test('OSE-320 | UEC.getCode(null) | returns null without throwing', () => {
    expect(getCode(null)).toBeNull();
  });

  test('OSE-320 | UEC.getCode(undefined) | returns null without throwing', () => {
    expect(getCode(undefined)).toBeNull();
  });

  test('OSE-320 | UEC.getCode("") | returns null', () => {
    expect(getCode('')).toBeNull();
  });

  test('OSE-320 | UEC.getCode("   ") | returns null (whitespace-only)', () => {
    expect(getCode('   ')).toBeNull();
  });

  test('OSE-320 | UEC.getCode("xyz") | returns null (non-canonical)', () => {
    expect(getCode('xyz')).toBeNull();
  });

  test('OSE-320 | UEC.getCode("VIOLET") | returns null (color not in palette)', () => {
    expect(getCode('VIOLET')).toBeNull();
  });

  test('OSE-320 | UEC.getCode(42) | returns null (non-string input)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getCode(42 as any)).toBeNull();
  });

  test('OSE-320 | UEC.getCode({}) | returns null (object input)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getCode({} as any)).toBeNull();
  });
});

describe('OSE-320 UEC module — canonical hex values match brain artifact', () => {
  // Regression guard: these are the byte-exact hex values from
  // ocr-docs-brain/uec-codes.yaml. Drift here = drift from canonical.
  // OSE-323 (drift check) will catch this systematically; this test is
  // the per-PR defensive layer.
  const expectedHexes: Record<string, { scan: string; display: string }> = {
    ENTER: { scan: '#1A6B2F', display: '#2D6A4F' },
    LIVE: { scan: '#C04048', display: '#E07A5F' },
    SPONSOR: { scan: '#1A3A8A', display: '#1D3557' },
    ARCHIVE: { scan: '#5E1A9A', display: '#6C3483' },
    HELP: { scan: '#B01468', display: '#D4668E' },
    FEEDBACK: { scan: '#8A5A00', display: '#C4930A' },
    UTILITY: { scan: '#2A2A3A', display: '#4A4A4A' },
    ALERT: { scan: '#B8960A', display: '#B8960A' },
    STAFF: { scan: '#A00020', display: '#A00020' },
    'CHECK-IN': { scan: '#006B6B', display: '#006B6B' },
    SHOP: { scan: '#1A4A48', display: '#1A4A48' },
  };
  for (const [id, expected] of Object.entries(expectedHexes)) {
    test(`OSE-320 | UEC ${id} | scan_hex matches brain canonical ${expected.scan}`, () => {
      expect(getCode(id)?.scan_hex).toBe(expected.scan);
    });
    test(`OSE-320 | UEC ${id} | display_hex matches brain canonical ${expected.display}`, () => {
      expect(getCode(id)?.display_hex).toBe(expected.display);
    });
  }
});
