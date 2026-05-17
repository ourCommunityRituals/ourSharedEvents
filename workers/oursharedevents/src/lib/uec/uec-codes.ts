/**
 * UEC v1.1 — OSE consumed canonical copy.
 *
 * This is the OSE substrate's local copy of the brain artifact at
 * `OCR-docs/ocr-docs-brain/uec-codes.yaml`. Manually mirrored as a
 * TypeScript module so the Cloudflare Worker bundle has zero runtime
 * YAML parsing cost — all data is statically typed + tree-shakeable.
 *
 * ────────────────────────────────────────────────────────────────────
 * Source of truth: ocr-docs-brain/uec-codes.yaml @ OCR-docs#49 (OSE-318)
 * Source schema:   ocr-docs-brain/uec-codes.schema.json
 * Brain enforced:  Invariant #3 (uec_encoding, status: live)
 * Brain CI gates:  level2_schema.py (structural), OSE-324 (WCAG compute)
 * Drift check:     OSE-323 will CI-compare this file against brain YAML
 * ────────────────────────────────────────────────────────────────────
 *
 * **Editing rule:** never edit this file independently of the brain.
 * Any change must originate in the brain artifact + flow here via the
 * OSE-323 drift-check workflow (or by manual sync until that ships).
 * Hex values, IDs, nums, semantics, verticals — ALL must match the
 * brain artifact byte-for-byte at the data level. CI will catch drift.
 *
 * **Two-palette design (per brain artifact provenance):**
 *   scan_hex    — QR module fill, WCAG-validated (AA minimum)
 *   display_hex — UI/marketing showcase, brand-warm variant
 *
 * Schema enforces these per OCR-docs#49. OSE-322 static gate will
 * ensure scan_hex values appear only via UEC.getCode() — never as
 * hex literals scattered in handler/page code.
 */

export type WcagGrade = 'AAA' | 'AA';
export type UecStatus = 'KEEP' | 'ADD' | 'CHANGE';
export type UecPhase = 'Arrival' | 'During' | 'Post' | 'Anytime';
export type ExtensionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface UECCode {
  /** Semantic identifier — uppercase, hyphens permitted (e.g., ENTER, CHECK-IN). Unique. */
  id: string;
  /** Two-digit zero-padded sequence — 01-07 core, 08-11 extensions. Unique. */
  num: string;
  /** Human-readable color name (e.g., "Green", "Coral", "Dark Teal"). */
  label: string;
  /** QR module fill color. Contrast-validated against white. WCAG AA minimum. */
  scan_hex: string;
  /** UI/marketing showcase color. Brand-warm variant of the same semantic. */
  display_hex: string;
  /** Short semantic formula (e.g., "Go · Access · Safe Passage"). */
  semantics: string;
  /** What the code is used for, plain language. */
  description: string;
  /** Human-readable URL path the code resolves to (e.g., "/enter"). */
  url_path: string;
  /** Event Triangle phase. */
  phase: UecPhase;
  /** Verticals the code applies to. Subset of `VERTICALS`. */
  verticals: ReadonlyArray<string>;
  /** Change-relative-to-prior-version status. */
  status: UecStatus;
  /** WCAG contrast grade on white. FAIL is unrepresentable by design. */
  wcag_grade: WcagGrade;
  /** Extension codes only. Undefined for core (01-07). */
  extension_priority?: ExtensionPriority;
}

export const VERSION = '1.1' as const;

export const VERTICALS: ReadonlyArray<string> = [
  'Sports',
  'School',
  'Church',
  'Museum',
  'Rec Center',
  'Civic',
  'Tourism',
  'Bars',
  'Government',
  'Fundraising',
] as const;

const ALL_VERTICALS = VERTICALS;

export const CODES: ReadonlyArray<UECCode> = [
  // ── 7 CORE CODES ─────────────────────────────────────────────────
  {
    id: 'ENTER',
    num: '01',
    label: 'Green',
    scan_hex: '#1A6B2F',
    display_hex: '#2D6A4F',
    semantics: 'Go · Access · Safe Passage',
    description: 'Venue entry, gate access, facility check-in, lobby scan, room unlock',
    url_path: '/enter',
    phase: 'Arrival',
    verticals: ALL_VERTICALS,
    status: 'CHANGE',
    wcag_grade: 'AAA',
  },
  {
    id: 'LIVE',
    num: '02',
    label: 'Coral',
    scan_hex: '#C04048',
    display_hex: '#E07A5F',
    semantics: 'Exciting · Warm · Now',
    description:
      'Live scoring, real-time brackets, active event feed, fundraiser thermometer, live auction',
    url_path: '/live',
    phase: 'During',
    verticals: ALL_VERTICALS,
    status: 'CHANGE',
    wcag_grade: 'AA',
  },
  {
    id: 'SPONSOR',
    num: '03',
    label: 'Blue',
    scan_hex: '#1A3A8A',
    display_hex: '#1D3557',
    semantics: 'Trust · Commerce · Partnership',
    description:
      'Sponsor landing page, partner offers, advertiser profile, brand activation, local business deals',
    url_path: '/sponsor',
    phase: 'During',
    verticals: ALL_VERTICALS,
    status: 'KEEP',
    wcag_grade: 'AAA',
  },
  {
    id: 'ARCHIVE',
    num: '04',
    label: 'Purple',
    scan_hex: '#5E1A9A',
    display_hex: '#6C3483',
    semantics: 'Memory · History · Record',
    description:
      'Past results, statistics, event memories, photos, SharedReport, legacy data, season records',
    url_path: '/archive',
    phase: 'Post',
    verticals: ALL_VERTICALS,
    status: 'KEEP',
    wcag_grade: 'AA',
  },
  {
    id: 'HELP',
    num: '05',
    label: 'Pink',
    scan_hex: '#B01468',
    display_hex: '#D4668E',
    semantics: 'Care · Assistance · Accessibility',
    description:
      'ADA assistance, staff contact, first aid location, lost & found, volunteer info, accessibility services',
    url_path: '/help',
    phase: 'Anytime',
    verticals: ALL_VERTICALS,
    status: 'ADD',
    wcag_grade: 'AA',
  },
  {
    id: 'FEEDBACK',
    num: '06',
    label: 'Amber',
    scan_hex: '#8A5A00',
    display_hex: '#C4930A',
    semantics: 'Voice · Opinion · Response',
    description:
      'Attendee surveys, player ratings, post-event input, experience scoring, community voice',
    url_path: '/feedback',
    phase: 'Post',
    verticals: ALL_VERTICALS,
    status: 'CHANGE',
    wcag_grade: 'AA',
  },
  {
    id: 'UTILITY',
    num: '07',
    label: 'Charcoal',
    scan_hex: '#2A2A3A',
    display_hex: '#4A4A4A',
    semantics: 'General · Info · Infrastructure',
    description: 'WiFi password, schedule PDF, venue map, general announcements, admin quick links',
    url_path: '/utility',
    phase: 'Anytime',
    verticals: ALL_VERTICALS,
    status: 'CHANGE',
    wcag_grade: 'AAA',
  },
  // ── 4 EXTENSION CODES ────────────────────────────────────────────
  {
    id: 'ALERT',
    num: '08',
    label: 'Yellow',
    scan_hex: '#B8960A',
    display_hex: '#B8960A',
    semantics: 'Caution · Safety · Urgent',
    description: 'Safety notices, weather delays, venue emergencies, schedule changes',
    url_path: '/alert',
    phase: 'Anytime',
    verticals: ALL_VERTICALS,
    status: 'ADD',
    wcag_grade: 'AA',
    extension_priority: 'HIGH',
  },
  {
    id: 'STAFF',
    num: '09',
    label: 'Red',
    scan_hex: '#A00020',
    display_hex: '#A00020',
    semantics: 'Authority · Restricted · Operational',
    description:
      'Staff-only pages, volunteer check-in, backstage access, admin tools, event worker resources',
    url_path: '/staff',
    phase: 'Anytime',
    verticals: ['Sports', 'School', 'Church', 'Museum', 'Rec Center', 'Civic', 'Government'],
    status: 'KEEP',
    wcag_grade: 'AAA',
    extension_priority: 'HIGH',
  },
  {
    id: 'CHECK-IN',
    num: '10',
    label: 'Teal',
    scan_hex: '#006B6B',
    display_hex: '#006B6B',
    semantics: 'Attendance · Roster · Verification',
    description:
      'Attendance tracking, membership verification, roster check-in, season pass confirmation',
    url_path: '/check-in',
    phase: 'Arrival',
    verticals: ['Sports', 'School', 'Church', 'Museum', 'Rec Center', 'Civic'],
    status: 'KEEP',
    wcag_grade: 'AAA',
    extension_priority: 'MEDIUM',
  },
  {
    id: 'SHOP',
    num: '11',
    label: 'Dark Teal',
    scan_hex: '#1A4A48',
    display_hex: '#1A4A48',
    semantics: 'Commerce · Transaction · Purchase',
    description:
      'Merchandise, ticket upgrades, concession ordering, silent auction, fundraising purchases',
    url_path: '/shop',
    phase: 'During',
    verticals: ['Sports', 'Museum', 'Tourism', 'Bars', 'Fundraising'],
    status: 'KEEP',
    wcag_grade: 'AAA',
    extension_priority: 'MEDIUM',
  },
];
