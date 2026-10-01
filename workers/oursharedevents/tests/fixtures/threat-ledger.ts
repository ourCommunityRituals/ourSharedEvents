/**
 * OSE-564 — Threat ledger: enumerated adversarial coverage per infrastructure layer.
 *
 * This file IS the authoritative threat ledger. The YAML at docs/security/threat-ledger.yaml
 * mirrors it for human consumption. TypeScript is authoritative because:
 *   a) Type-checked — entries can't be malformed
 *   b) Directly imported by born-red-harness.spec.ts for CI validation
 *   c) Feeds OSE-560 conformance report generator via [OSE-564-LEDGER] log output
 *
 * Annotation convention for test files:
 *   Add the comment IMMEDIATELY above the test() call:
 *     // @born-red TL-XXX | method: <method> | date: YYYY-MM-DD
 *
 * Red birth methods:
 *   'design-time-negative-assertion'  — structural test that would fail if the guard were removed;
 *                                       "red" = running test with guard disabled
 *   'historical-ci-failure'           — caught a real bug in a previous CI run
 *   'deliberate-fixture-break'        — run against a deliberately broken fixture before merge
 *   'red-team-fleet-finding'          — OSE-568 red team fleet identified this as exploitable
 *
 * Adding a new threat:
 *   1. Append entry below (keep layers grouped)
 *   2. Set status: 'open'
 *   3. Create/update test file, add @born-red annotation
 *   4. Run test against broken fixture to confirm it catches the violation
 *   5. Set status: 'tested', fill test_ref and red_birth
 */

export type ThreatLayer =
  | 'd1_boundary'
  | 'worker_surface'
  | 'permission_layer'
  | 'pipeline'
  | 'secrets_layer'
  | 'repo_wall'
  | 'export_boundary'
  | 'audit_layer';

export type ThreatStatus = 'open' | 'tested' | 'mitigated' | 'accepted';
export type RedBirthMethod =
  | 'design-time-negative-assertion'
  | 'historical-ci-failure'
  | 'deliberate-fixture-break'
  | 'red-team-fleet-finding';

export interface TargetInvariant {
  number: number;
  name: string;
}

export interface RedBirth {
  date: string; // YYYY-MM-DD
  method: RedBirthMethod;
  notes?: string;
}

export interface ThreatEntry {
  id: string; // TL-001 format
  layer: ThreatLayer;
  threat: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  target_invariant: TargetInvariant | null;
  mitigation_story: string | null; // Linear ID if mitigated/tested
  test_ref: string | null; // "filename > describe > test" or "CI gate: <name>"
  status: ThreatStatus;
  red_birth: RedBirth | null;
  last_run_green: string | null; // YYYY-MM-DD
  notes?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 1: D1 boundary
// ═══════════════════════════════════════════════════════════════════════════════

const D1_BOUNDARY: ThreatEntry[] = [
  {
    id: 'TL-001',
    layer: 'd1_boundary',
    threat:
      'Cross-database join: attacker correlates FORMS_DB PII records with main DB scan records via shared anonymous_id field',
    severity: 'HIGH',
    target_invariant: { number: 1, name: 'anonymous_id' },
    mitigation_story: null,
    test_ref: 'tests/anti-logging-proof.spec.ts > P5: Cross-database join structurally impossible',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Test would fail if any handler file referenced tables from both databases in the same function scope',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-002',
    layer: 'd1_boundary',
    threat:
      'FK smuggling: attacker inserts a FORMS_DB record ID as a foreign key value in a main DB table, creating an implicit cross-DB link',
    severity: 'MEDIUM',
    target_invariant: { number: 1, name: 'anonymous_id' },
    mitigation_story: null,
    test_ref: 'tests/forms-security.spec.ts > S2: Form handlers NEVER reference main DB',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Static gate: forms.ts cannot reference env.DB; main handlers cannot reference FORMS_DB',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-003',
    layer: 'd1_boundary',
    threat:
      'TTL bypass: attacker queries FORMS_DB for expired registrations/email records that the destruction job has not yet purged',
    severity: 'MEDIUM',
    target_invariant: { number: 8, name: 'bounded_pii_retention' },
    mitigation_story: null,
    test_ref: 'tests/forms-security.spec.ts > S5: registration data destroyed after expires_at',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-004',
    layer: 'd1_boundary',
    threat:
      'Direct binding misuse: attacker exploits a handler that imports and uses both DB bindings directly, bypassing isolation abstraction',
    severity: 'HIGH',
    target_invariant: { number: 1, name: 'anonymous_id' },
    mitigation_story: null,
    test_ref:
      'tests/forms-security.spec.ts > S3: forms-db.ts utility has ZERO references to main DB',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
    },
    last_run_green: '2026-08-03',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 2: Worker surface
// ═══════════════════════════════════════════════════════════════════════════════

const WORKER_SURFACE: ThreatEntry[] = [
  {
    id: 'TL-005',
    layer: 'worker_surface',
    threat:
      'Auth-less admin access: attacker hits /api/v2/admin/* with no Bearer token and no CF-Access JWT; admin endpoint returns data',
    severity: 'CRITICAL',
    target_invariant: null,
    mitigation_story: 'OSE-573',
    test_ref: 'tests/admin-allowlist.spec.ts',
    status: 'mitigated',
    red_birth: {
      date: '2026-08-03',
      method: 'red-team-fleet-finding',
      notes:
        'OSE-568 red team fleet: CF Access JWT signature was never cryptographically verified. OSE-573 added verifyCfAccessJWT() pre-flight.',
    },
    last_run_green: '2026-08-03',
    notes: 'Mitigated by OSE-573: CF Access JWT signature pre-flight added to router.ts',
  },
  {
    id: 'TL-006',
    layer: 'worker_surface',
    threat:
      'Malformed UEC code injection: attacker sends non-hex, oversized, or null-byte-containing UEC codes to scan endpoints',
    severity: 'MEDIUM',
    target_invariant: { number: 3, name: 'uec_encoding' },
    mitigation_story: 'OSE-322',
    test_ref: 'tests/architecture.spec.ts > UEC hex literals gate (OSE-322)',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Structural gate: UEC hex literals must come from getCode().scan_hex, not raw string literals',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-007',
    layer: 'worker_surface',
    threat:
      'Form field injection: attacker injects SQL, script, or instruction-shaped payloads via survey responses or registration free-text fields',
    severity: 'HIGH',
    target_invariant: null,
    mitigation_story: 'OSE-578',
    test_ref:
      'tests/forms-security.spec.ts > S13: no raw email stored in any FORMS_DB table schema',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
    },
    last_run_green: '2026-08-03',
    notes: 'AI sanitization layer added (OSE-578); D1 parameterized queries prevent SQL injection',
  },
  {
    id: 'TL-008',
    layer: 'worker_surface',
    threat:
      'Signed-link token forgery: attacker crafts a token with a valid-looking HMAC signature for a different event_id or elevated role',
    severity: 'HIGH',
    target_invariant: null,
    mitigation_story: null,
    test_ref: 'tests/signed-link-token-forgery.spec.ts — TL-008 describe block (15 tests)',
    status: 'tested',
    red_birth: {
      date: '2026-08-06',
      method: 'design-time-negative-assertion',
      notes:
        'verifySignedLinkToken() uses HMAC-SHA256 + constant-time compare. Tests cover event_id swap, role escalation, sig bit-flip, wrong secret, expired, missing claims, depth escalation, sponsor_id swap.',
    },
    last_run_green: null,
    notes:
      'verifySignedLinkToken() uses HMAC-SHA256 + constant-time compare. Tests added 2026-08-06.',
  },
  {
    id: 'TL-009',
    layer: 'worker_surface',
    threat:
      'Briefing page unauthenticated access: attacker GETs /briefing, /overview, or /summary without admin credentials and receives the briefing page',
    severity: 'CRITICAL',
    target_invariant: null,
    mitigation_story: 'OSE-574',
    test_ref: null,
    status: 'mitigated',
    red_birth: {
      date: '2026-08-03',
      method: 'red-team-fleet-finding',
      notes:
        'OSE-568 red team fleet: briefing page had no auth gate. OSE-574 added requireAdmin() guard in router.ts.',
    },
    last_run_green: null,
    notes: 'Code mitigated (OSE-574). Unit test pending: unauthenticated GET /briefing → 401.',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 3: Permission layer
// ═══════════════════════════════════════════════════════════════════════════════

const PERMISSION_LAYER: ThreatEntry[] = [
  {
    id: 'TL-010',
    layer: 'permission_layer',
    threat:
      'Depth escalation: attacker uses a local-depth signed-link token to request premium-depth SharedReport fields',
    severity: 'HIGH',
    target_invariant: { number: 21, name: 'shared_report_schema_stability' },
    mitigation_story: null,
    test_ref: 'tests/report-depth.spec.ts — TL-010 describe block (6 tests)',
    status: 'tested',
    red_birth: {
      date: '2026-08-06',
      method: 'design-time-negative-assertion',
      notes:
        'resolveDepth() caps sponsor depth at SPONSOR_MAX (mid); premium claim fails-closed to local. filterReportByDepth() strips by omission only.',
    },
    last_run_green: null,
    notes:
      'resolveDepth() caps sponsor depth at SPONSOR_MAX (mid); premium fails-closed to local. filterReportByDepth() strips fields not in resolved tier. Tests added 2026-08-06.',
  },
  {
    id: 'TL-011',
    layer: 'permission_layer',
    threat:
      'Token enumeration: attacker brute-forces signed-link token space; rate limiting not enforced on SharedReport read endpoint',
    severity: 'HIGH',
    target_invariant: null,
    mitigation_story: 'OSE-576',
    test_ref: null,
    status: 'mitigated',
    red_birth: {
      date: '2026-08-03',
      method: 'red-team-fleet-finding',
      notes:
        'OSE-568 red team fleet: rate limiting absent. OSE-576 added 30/min batch + 10/min mint limits.',
    },
    last_run_green: null,
    notes: 'Rate limiting code landed (OSE-576); KV namespace provisioning pending (OSE-575).',
  },
  {
    id: 'TL-012',
    layer: 'permission_layer',
    threat:
      'Cross-sponsor leakage: sponsor A signed-link token used to access event reports scoped to sponsor B',
    severity: 'HIGH',
    target_invariant: { number: 9, name: 'tenant_isolation' },
    mitigation_story: 'OSE-577',
    test_ref: null,
    status: 'mitigated',
    red_birth: {
      date: '2026-08-03',
      method: 'red-team-fleet-finding',
      notes:
        'OSE-568 red team fleet: sponsor_id claim not validated server-side. OSE-577 added DB validation before mint.',
    },
    last_run_green: null,
    notes: 'Validation added at mint time (OSE-577). Test pending: mismatched sponsor_id → 400.',
  },
  {
    id: 'TL-013',
    layer: 'permission_layer',
    threat:
      'Rate limit bypass: attacker rotates source IPs or CF-Ray headers to exceed per-endpoint rate limits without triggering 429',
    severity: 'HIGH',
    target_invariant: null,
    mitigation_story: 'OSE-576',
    test_ref: 'tests/rate-limit-bypass.spec.ts — TL-013 describe blocks (7 tests)',
    status: 'tested',
    red_birth: {
      date: '2026-08-06',
      method: 'design-time-negative-assertion',
      notes:
        'Rate limiter keys on CF-Connecting-IP + eventId composite key. KNOWN BYPASS documented: IP rotation gives fresh bucket — full fix pending SR-23.',
    },
    last_run_green: null,
    notes:
      'Rate limiter uses CF-Connecting-IP (not injectable headers). IP-rotation bypass documented as @known-bypass TL-013, pending SR-23 (CF Rate Limiting Rules).',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 4: Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

const PIPELINE: ThreatEntry[] = [
  {
    id: 'TL-014',
    layer: 'pipeline',
    threat:
      'Unreviewed workflow: a CI workflow or GitHub Actions file is merged to main without required review, reaching production',
    severity: 'HIGH',
    target_invariant: null,
    mitigation_story: null,
    test_ref: 'CI gate: branch protection + required reviewers on .github/workflows/',
    status: 'accepted',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'GitHub branch protection with required reviews. No automated code-level test possible.',
    },
    last_run_green: null,
    notes: 'Mitigated by repository branch protection rules, not by Worker code.',
  },
  {
    id: 'TL-015',
    layer: 'pipeline',
    threat:
      'PR mutates its own CI: a PR modifies a GitHub Actions workflow file and the modified workflow runs on that same PR, enabling self-approval',
    severity: 'MEDIUM',
    target_invariant: null,
    mitigation_story: null,
    test_ref: 'CI gate: workflow files pinned to SHA; CODEOWNERS enforces review',
    status: 'accepted',
    red_birth: null,
    last_run_green: null,
    notes:
      'GitHub Actions pull_request trigger uses base branch workflow, not head. Structural defense from GitHub.',
  },
  {
    id: 'TL-016',
    layer: 'pipeline',
    threat:
      'Secrets committed to tree: a credential-shaped string (Bearer token, API key, private key) is committed to any branch',
    severity: 'CRITICAL',
    target_invariant: null,
    mitigation_story: null,
    test_ref: 'tests/gitleaks-ci-gate.spec.ts — TL-016 describe block (7 tests)',
    status: 'tested',
    red_birth: {
      date: '2026-08-06',
      method: 'design-time-negative-assertion',
      notes:
        'Committed-secret gate wired in oursharedevents-ci.yml S0 + S2. OSE-911: gate moved gitleaks → detect-secrets (scripts/check-secrets-baseline.py + .secrets.baseline; gitleaks wazero JIT flaked on Windows). Threat unchanged; test retargeted to the enforcing detect-secrets gate to prevent silent removal.',
    },
    last_run_green: null,
    notes:
      'Gitleaks wired in CI (S0 Security job, lines 248-271) with --exit-code 1 and --config .gitleaks.toml. Gate test added 2026-08-06 to prevent silent removal. Ledger was stale.',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 5: Secrets layer
// ═══════════════════════════════════════════════════════════════════════════════

const SECRETS_LAYER: ThreatEntry[] = [
  {
    id: 'TL-017',
    layer: 'secrets_layer',
    threat:
      'Credential-shaped string in commit: any wrangler.toml, .env, or source file contains a secret value instead of a placeholder',
    severity: 'CRITICAL',
    target_invariant: null,
    mitigation_story: null,
    test_ref: 'CI gate: production isolation check (rejects placeholder strings in wrangler.toml)',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'historical-ci-failure',
      notes:
        'The admin key was accidentally committed during early dev. CI prod-isolation check was added as a result.',
    },
    last_run_green: '2026-08-03',
    notes:
      'Wrangler.toml prod isolation CI gate rejects PROVISION-* placeholder strings on production deploy.',
  },
  {
    id: 'TL-018',
    layer: 'secrets_layer',
    threat:
      'Key rotation age: FORMS_ENCRYPTION_KEY exceeds 90-day rotation window without a rotation event',
    severity: 'HIGH',
    target_invariant: { number: 8, name: 'bounded_pii_retention' },
    mitigation_story: 'OSE-579',
    test_ref: 'tests/key-rotation-age.spec.ts — TL-018 describe block (11 tests)',
    status: 'mitigated',
    red_birth: null,
    last_run_green: null,
    notes:
      'FORMS_KEY_ROTATED_AT env var records rotation timestamp. Security cron alerts HIGH at 90 days, MEDIUM at 75 days. RouterEnv + SecurityCronEnv extended. Tests added 2026-08-06.',
  },
  {
    id: 'TL-019',
    layer: 'secrets_layer',
    threat:
      'Global-scope CF API key: CF_API_KEY (unrestricted zone access) present in any env var instead of scoped token',
    severity: 'HIGH',
    target_invariant: null,
    mitigation_story: null,
    test_ref: 'tests/born-red-harness.spec.ts > Secrets layer: no CF_API_KEY in wrangler.toml',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes: 'SEC-1.2 constraint: CF_API_KEY (global) is prohibited; scoped token required.',
    },
    last_run_green: '2026-08-03',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 6: Repo wall
// ═══════════════════════════════════════════════════════════════════════════════

const REPO_WALL: ThreatEntry[] = [
  {
    id: 'TL-020',
    layer: 'repo_wall',
    threat:
      'Cross-repo import violation: OSE Worker code directly imports a module from WKRP, OAW, or OSR repo (bypasses the HTTP seam)',
    severity: 'HIGH',
    target_invariant: { number: 22, name: 'cross_repo_import_isolation' },
    mitigation_story: 'OSE-388',
    test_ref: 'tests/architecture.spec.ts > Invariant 22: cross-repo import gate',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes: 'Structural gate: import paths must not contain ../ourWKRP, ../ourAirwaves, etc.',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-021',
    layer: 'repo_wall',
    threat:
      'Shared module misuse: a utility function is imported from a path that resolves across repo boundary via symlink, workspace alias, or monorepo package',
    severity: 'MEDIUM',
    target_invariant: { number: 22, name: 'cross_repo_import_isolation' },
    mitigation_story: null,
    test_ref: 'tests/architecture.spec.ts > Invariant 22: cross-repo import gate',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
    },
    last_run_green: '2026-08-03',
    notes:
      'package.json has no workspace alias pointing to sibling repos. tsconfig paths checked in architecture gate.',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 7: Export boundary
// ═══════════════════════════════════════════════════════════════════════════════

const EXPORT_BOUNDARY: ThreatEntry[] = [
  {
    id: 'TL-022',
    layer: 'export_boundary',
    threat:
      'Sub-floor export: attacker crafts a query or export request that returns a row representing fewer than minCount individuals without suppression',
    severity: 'HIGH',
    target_invariant: { number: 7, name: 'aggregate_only_reporting' },
    mitigation_story: null,
    test_ref: 'tests/anti-logging-proof.spec.ts > P7: Suppression floor constant is safe',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Static gate asserts corridor-map.ts minCount >= 5; shared-report-builder applies suppression',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-023',
    layer: 'export_boundary',
    threat:
      'Sub-window timestamp in export: attacker injects boundary-time scans to extract exact check-in times; export row contains minute or second precision',
    severity: 'HIGH',
    target_invariant: { number: 8, name: 'bounded_pii_retention' },
    mitigation_story: null,
    test_ref: 'tests/anti-logging-proof.spec.ts > P4: Sub-window timestamps absent',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'bucketTimestamp() behavioral test: hour-only precision enforced, minute/second stripped',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-024',
    layer: 'export_boundary',
    threat:
      'Wrong-pool routing: FORMS_DB data (email signups, registrations) included in OCR export manifest alongside anonymous scan data',
    severity: 'HIGH',
    target_invariant: { number: 1, name: 'anonymous_id' },
    mitigation_story: null,
    test_ref: 'tests/forms-security.spec.ts > S1/S2: cross-contamination gates',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
    },
    last_run_green: '2026-08-03',
    notes: 'FORMS_CSV excluded from export_manifest CHECK constraint (prior session correction).',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 8: Audit layer
// ═══════════════════════════════════════════════════════════════════════════════

const AUDIT_LAYER: ThreatEntry[] = [
  {
    id: 'TL-025',
    layer: 'audit_layer',
    threat:
      'PII survival in audit log: admin_audit_log or report_access_log stores attendee email, name, or anon_id in a column',
    severity: 'HIGH',
    target_invariant: { number: 24, name: 'auditability' },
    mitigation_story: null,
    test_ref:
      'tests/anti-logging-proof.spec.ts > P8: admin_audit_log table has no attendee-identifying columns',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'PRAGMA table_info schema probe: forbidden attendee columns absent from both audit tables',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-026',
    layer: 'audit_layer',
    threat:
      'IP address in audit log: logReportAccess() or logAdminAction() captures and stores the requesting IP address in the audit record',
    severity: 'MEDIUM',
    target_invariant: { number: 24, name: 'auditability' },
    mitigation_story: null,
    test_ref:
      'tests/anti-logging-proof.spec.ts > P8: audit-log.ts does not write raw IP into any INSERT',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes: 'Static gate: audit-log.ts contains no clientIp() or getClientIp() calls',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-027',
    layer: 'audit_layer',
    threat:
      'Precise timestamp in attendee-facing audit trail: an export manifest or audit log includes sub-hour timestamps traceable to individual attendees',
    severity: 'MEDIUM',
    target_invariant: { number: 24, name: 'auditability' },
    mitigation_story: null,
    test_ref: 'tests/anti-logging-proof.spec.ts > P4: forms.ts uses bucketTimestamp()',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
    },
    last_run_green: '2026-08-03',
    notes:
      'admin_audit_log records operator actions (full timestamp OK); form tables use hour bucket only.',
  },
  {
    id: 'TL-028',
    layer: 'audit_layer',
    threat:
      'AI prompt injection via audit log: survey responses containing instruction-shaped text are passed to an AI model without sanitization',
    severity: 'HIGH',
    target_invariant: null,
    mitigation_story: 'OSE-578',
    test_ref: null,
    status: 'mitigated',
    red_birth: {
      date: '2026-08-03',
      method: 'red-team-fleet-finding',
      notes:
        'OSE-568 red team fleet: no AI sanitization layer. OSE-578 added sanitizeForAI() + sanitizeJsonForAI().',
    },
    last_run_green: null,
    notes: 'Sanitization utility exists (OSE-578); wire-up test pending when AI path is added.',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Full ledger export
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// Existing CI/test coverage wired into ledger (OSE-560 gap closure)
// These invariants were already enforced — the threat map just didn't reference them.
// Added 2026-08-03 to close conformance report gaps for #11,#12,#13,#15,#16,#19,#21,#23.
// ═══════════════════════════════════════════════════════════════════════════════

const EXISTING_COVERAGE: ThreatEntry[] = [
  {
    id: 'TL-029',
    layer: 'worker_surface',
    threat:
      'CORS wildcard or new unlisted origin: attacker adds a permissive origin to the CORS allowlist or smuggles a wildcard, enabling cross-origin data exfiltration',
    severity: 'HIGH',
    target_invariant: { number: 15, name: 'cors_allowlist_immutability' },
    mitigation_story: null,
    test_ref: 'tests/architecture.spec.ts > CORS allowlist gate',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Structural gate: cors.ts allowlist must not change without updating the gate; any wildcard fails CI',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-030',
    layer: 'pipeline',
    threat:
      'API response schema drift: a handler returns a field with a different name, missing field, or wrong type, breaking downstream consumers silently',
    severity: 'HIGH',
    target_invariant: { number: 16, name: 'api_response_schema_stability' },
    mitigation_story: null,
    test_ref: 'CI gate: schema-verify (oursharedevents-ci.yml)',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes: 'CI schema-verify gate; JSON schema files checked on every push',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-031',
    layer: 'pipeline',
    threat:
      'Out-of-order migration: a migration applied with a lower sequence number than an already-applied migration, corrupting the schema state',
    severity: 'HIGH',
    target_invariant: { number: 19, name: 'migration_monotonicity' },
    mitigation_story: null,
    test_ref: 'CI gate: migration-apply with sequence check (oursharedevents-ci.yml)',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes: 'CI gate fails if migration numbering regresses; D1 migrations numbered sequentially',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-032',
    layer: 'permission_layer',
    threat:
      'SharedReport envelope schema break: a field rename, removal, or type change in the SharedReport response envelope invalidates signed links for all current token holders',
    severity: 'HIGH',
    target_invariant: { number: 21, name: 'shared_report_schema_stability' },
    mitigation_story: null,
    test_ref: 'tests/shared-report-pipeline-invariants.spec.ts > Gate 7: read API never writes',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes: 'Pipeline invariant spec asserts schema stability gate; any field removal fails CI',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-033',
    layer: 'audit_layer',
    threat:
      'Red team theater: a test carries @born-red annotation and claims to be a red team test, but was never run against a broken fixture — it provides false assurance',
    severity: 'HIGH',
    target_invariant: { number: 23, name: 'red_team_coverage' },
    mitigation_story: 'OSE-564',
    test_ref:
      'tests/born-red-harness.spec.ts > every "tested" ledger entry has at least one @born-red annotation',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'deliberate-fixture-break',
      notes:
        'The harness itself validates that @born-red annotations are not theater: every tested entry must have annotation + red_birth date in the ledger',
    },
    last_run_green: '2026-08-03',
    notes:
      'OSE-564 built the born-red harness. This entry is the meta-threat: the harness catching incomplete red team annotation is the test.',
  },
  {
    id: 'TL-034',
    layer: 'pipeline',
    threat:
      'Runner bash resolution failure: self-hosted runner fails to resolve bash, breaking all shell-step CI jobs silently (e.g., PATH misconfiguration after runner restart)',
    severity: 'MEDIUM',
    target_invariant: { number: 11, name: 'self_hosted_runner_bash_resolution' },
    mitigation_story: null,
    test_ref:
      'RETIRED (OSE-1194, 2026-09-02): self-hosted runner pool decommissioned; CI runs on GitHub-hosted ubuntu-latest where bash resolution is owned by the runner image',
    status: 'accepted',
    red_birth: {
      date: '2026-08-03',
      method: 'historical-ci-failure',
      notes:
        'Runner bash resolution failure was observed during initial self-hosted runner setup. runner-env-validation.yml added as probe. OSE-589 added structural harness test.',
    },
    last_run_green: '2026-08-03',
    notes:
      'Retired with the self-hosted apparatus (OSE-1194): runner-env-validation.yml, tests/runner-env.spec.ts and tools/runner/ deleted; brain invariant #11 is status retired. The threat does not apply to GitHub-hosted runners.',
  },
  {
    id: 'TL-035',
    layer: 'pipeline',
    threat:
      'Runner pool not ready: CI job queues indefinitely because no runner in the pool accepts the job label, causing silent pipeline staleness',
    severity: 'MEDIUM',
    target_invariant: { number: 12, name: 'runner_pool_readiness_probe' },
    mitigation_story: null,
    test_ref:
      'RETIRED (OSE-1194, 2026-09-02): self-hosted runner pool decommissioned; GitHub-hosted runner capacity is managed by GitHub, not by an OSE probe',
    status: 'accepted',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'OSE-589 added structural gate: runner-env-validation.yml must exist, target main, and probe bash.',
    },
    last_run_green: '2026-08-03',
    notes:
      'Retired with the self-hosted apparatus (OSE-1194): janitor probe/watchdog (tools/runner/) deleted; brain invariant #12 is status retired. The threat does not apply to GitHub-hosted runners.',
  },
  {
    id: 'TL-036',
    layer: 'audit_layer',
    threat:
      'Brain enforcement drift: an architectural invariant claim exists in OCR-docs but no CI gate enforces it, and no test references it — claim becomes testimony',
    severity: 'HIGH',
    target_invariant: { number: 13, name: 'brain_enforcement_location' },
    mitigation_story: null,
    test_ref: 'CI gate: brain-contract-check.yml (brain contract check on every push to main)',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'brain-contract-check.yml asserts every invariant marked live has a test_file reference; any claim without enforcement is a CI failure',
    },
    last_run_green: '2026-08-03',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 9: Sponsor audit path (OSE-561)
// Sponsor-facing critical paths: token access, depth gating, report provenance.
// ═══════════════════════════════════════════════════════════════════════════════

const SPONSOR_AUDIT: ThreatEntry[] = [
  {
    id: 'TL-037',
    layer: 'permission_layer',
    threat:
      'Sponsor depth escalation: sponsor with a local-depth signed-link token successfully retrieves premium-depth fields by manipulating token params or header',
    severity: 'HIGH',
    target_invariant: { number: 9, name: 'tenant_isolation' },
    mitigation_story: null,
    test_ref:
      'tests/sponsor-audit.spec.ts > depth escalation: local-scoped token cannot reach premium fields',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Test asserts local-depth token response is missing premium fields; test would fail if resolveDepth() ignored token claim',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-038',
    layer: 'permission_layer',
    threat:
      "Cross-sponsor report access: sponsor A forwards their signed-link token (or URL) to sponsor B, and sponsor B can view sponsor A's scoped report slice",
    severity: 'HIGH',
    target_invariant: { number: 9, name: 'tenant_isolation' },
    mitigation_story: 'OSE-577',
    test_ref:
      'tests/sponsor-audit.spec.ts > sponsor_id claim is always validated before data is served',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'red-team-fleet-finding',
      notes:
        'OSE-568 red team: sponsor_id not validated. OSE-577 added server-side DB validation at mint time.',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-039',
    layer: 'audit_layer',
    threat:
      'Sponsor access unlogged: a sponsor successfully accesses a SharedReport but no entry appears in report_access_log — depth grants are invisible to operators',
    severity: 'HIGH',
    target_invariant: { number: 24, name: 'auditability' },
    mitigation_story: 'OSE-557',
    test_ref:
      'tests/sponsor-audit.spec.ts > every successful SharedReport access writes to report_access_log',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Test verifies logReportAccess() is called (via ctx.waitUntil) on every successful response path',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-040',
    layer: 'permission_layer',
    threat:
      'Demo trio regression: demo-local/mid/premium test tokens no longer gate correctly — a code change inadvertently promotes or demotes a tier without CI catching it',
    severity: 'MEDIUM',
    target_invariant: { number: 21, name: 'shared_report_schema_stability' },
    mitigation_story: null,
    test_ref:
      'tests/sponsor-audit.spec.ts > demo trio token tier assertions (standing red team fixtures)',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Demo trio tokens are the standing red team fixtures. If tier gating regresses, these test assertions fail first.',
    },
    last_run_green: '2026-08-03',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 10: Event manager audit path (OSE-562)
// Organizer-facing mutations: headcount, event lifecycle, log integrity.
// ═══════════════════════════════════════════════════════════════════════════════

const EVENT_MANAGER_AUDIT: ThreatEntry[] = [
  {
    id: 'TL-041',
    layer: 'audit_layer',
    threat:
      'Headcount silently revised: an event manager edits the headcount field and the revision does not appear in admin_audit_log — the Goodhart attack succeeds',
    severity: 'HIGH',
    target_invariant: { number: 24, name: 'auditability' },
    mitigation_story: null,
    test_ref:
      'tests/event-manager-audit.spec.ts > headcount mutation is logged: every set/edit writes audit row',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Test asserts logAdminAction() is called for headcount mutations; missing log entry = Goodhart attack succeeds',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-042',
    layer: 'audit_layer',
    threat:
      'Log tamper: an authenticated admin uses an application code path to UPDATE or DELETE a row in admin_audit_log, erasing evidence of a prior action',
    severity: 'CRITICAL',
    target_invariant: { number: 24, name: 'auditability' },
    mitigation_story: null,
    test_ref:
      'tests/event-manager-audit.spec.ts > audit log is append-only: no UPDATE or DELETE path exists',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Static gate: audit-log.ts contains no UPDATE or DELETE SQL statements; schema has no soft-delete column',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-043',
    layer: 'permission_layer',
    threat:
      'Cross-venue privilege escalation: organizer of venue A sends admin mutations targeting event IDs belonging to venue B',
    severity: 'HIGH',
    target_invariant: { number: 9, name: 'tenant_isolation' },
    mitigation_story: null,
    test_ref:
      'tests/event-manager-audit.spec.ts > cross-venue event mutation: non-owner event returns 403',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Test inserts two events with different brand contexts; mutation against non-owned event must fail + log denial',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-044',
    layer: 'audit_layer',
    threat:
      'Audit log injection: hostile strings in event names or headcount notes attempt to corrupt audit log rendering or downstream report surfaces',
    severity: 'MEDIUM',
    target_invariant: { number: 24, name: 'auditability' },
    mitigation_story: null,
    test_ref:
      'tests/event-manager-audit.spec.ts > log injection: hostile strings in event names are stored as data, not executed',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'D1 parameterized queries prevent SQL injection; audit log stores actor+action+target as columns, not interpolated strings',
    },
    last_run_green: '2026-08-03',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Gap closure stories OSE-581 through OSE-589
// Each block closes one conformance report gap via a threat entry + test file.
// ═══════════════════════════════════════════════════════════════════════════════

const GAP_CLOSURE: ThreatEntry[] = [
  {
    id: 'TL-045',
    layer: 'pipeline',
    threat:
      'Geo coordinate stored at wrong H3 resolution: latLngToCell called with resolution other than 9 (node) or 7 (corridor), producing data that fails geo-join queries in OER and BigQuery exports',
    severity: 'HIGH',
    target_invariant: { number: 2, name: 'hyperlocal_geo_resolution' },
    mitigation_story: null,
    test_ref: 'tests/geo-invariant.spec.ts > H3 resolution constants are node=9 corridor=7',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Static gate: latLngToCell only appears with NODE_RES or CORRIDOR_RES — no other resolution can reach production',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-046',
    layer: 'pipeline',
    threat:
      'NCR accumulation inconsistency: corridor density computed from non-deduplicated scans, or suppression floor bypassed, or ring totals diverge from corridor subtotals — report numbers are untrustworthy',
    severity: 'HIGH',
    target_invariant: { number: 4, name: 'ncr_data_accumulation' },
    mitigation_story: null,
    test_ref:
      'tests/ncr-pipeline.spec.ts > renderCorridorMap suppression floor and density accuracy',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Unit tests confirm suppression floor default=5, cells below floor are excluded from rendered count, valid cells above floor are rendered with correct count',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-047',
    layer: 'permission_layer',
    threat:
      'Premium feature hook active without flag: a free-tier event receives premium-tier data via a code path that bypasses flag resolution — monetization boundary broken',
    severity: 'HIGH',
    target_invariant: { number: 6, name: 'inert_monetization_hooks' },
    mitigation_story: null,
    test_ref: 'tests/monetization-gate.spec.ts > premium features are gated by TIER_PRESETS',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Static + unit gate: TIER_PRESETS.free disables enterprise-only flags; detectCurrentTier + resolveFlags together gate premium paths',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-048',
    layer: 'pipeline',
    threat:
      'Deprecated column dropped too early: a migration removes a column or table before the deprecation lock period expires, breaking live reads from in-flight requests or cached reports',
    severity: 'HIGH',
    target_invariant: { number: 10, name: 'deprecation_lock' },
    mitigation_story: null,
    test_ref:
      'tests/deprecation-lock.spec.ts > all DROP COLUMN/TABLE statements are in the approved list',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Static gate: every DROP COLUMN / DROP TABLE in migrations is whitelisted; any unwhitelisted DROP fails CI',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-049',
    layer: 'worker_surface',
    threat:
      'Admin workflow not completable on mobile: a primary admin action requires a desktop viewport or fails touch target size requirements, breaking field operator workflows',
    severity: 'MEDIUM',
    target_invariant: { number: 14, name: 'mobile_workability' },
    mitigation_story: null,
    test_ref: 'tests/admin-mobile-workability.spec.ts > mobile CSS contract',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'historical-ci-failure',
      notes:
        'OSE-294 captured the original trust-breaker: 360px layout break, 6-col table, no touch targets. Spec asserts the fix is in place.',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-050',
    layer: 'repo_wall',
    threat:
      'OSE writes directly to OER storage bypassing the export_manifest boundary: a handler or scheduled job pushes data to OER without going through logExportManifest, creating invisible data flows',
    severity: 'HIGH',
    target_invariant: { number: 17, name: 'oer_emission_boundary' },
    mitigation_story: null,
    test_ref: 'tests/oer-boundary.spec.ts > all BigQuery export paths call logExportManifest',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Static gate: no source file imports from an OER path; every BIGQUERY export type in router.ts is preceded by logExportManifest call',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-051',
    layer: 'pipeline',
    threat:
      "Event slug mutated post-publish: admin updates an existing event's slug field, silently breaking all QR codes, shortlinks, and poster URLs that encoded the original slug",
    severity: 'HIGH',
    target_invariant: { number: 18, name: 'slug_permanence' },
    mitigation_story: null,
    test_ref:
      'tests/slug-permanence.spec.ts > handleUpdateEvent does not include slug in allowedFields',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Static gate: events.ts allowedFields dict does not contain "slug"; slug can only be set at creation time',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-052',
    layer: 'audit_layer',
    threat:
      'Standards drift: a live invariant in architectural-invariants.yaml has no CI enforcement reference in the threat ledger — the invariant is a claim without proof, invisible to the conformance report',
    severity: 'HIGH',
    target_invariant: { number: 20, name: 'standards_propagation_completeness' },
    mitigation_story: null,
    test_ref:
      'tests/standards-propagation.spec.ts > brain-contract-check.yml exists and covers live invariants',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Static gate: brain-contract-check.yml exists and runs on push to main; every invariant with known ledger coverage has at least one tested/mitigated entry',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-053',
    layer: 'permission_layer',
    threat:
      'Rate limit buckets never fill: admin and mint rate limit keys used CF-Ray (a per-request unique ID) as the KV key — every request creates a fresh bucket, making rate limits entirely non-functional against brute-force or replay attacks',
    severity: 'HIGH',
    target_invariant: { number: 9, name: 'tenant_isolation' },
    mitigation_story: 'OSE-592',
    test_ref: 'tests/rate-limit.spec.ts > isRateLimited > allows the first request for a new IP',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'deliberate-fixture-break',
      notes:
        'Fleet sweep layer 3 (permission_layer): CF-Ray is per-request unique; KV key was admin:${CF-Ray} — every bucket was always at count 0. Fixed by OSE-592 to use clientIp(request) as the key',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-054',
    layer: 'pipeline',
    threat:
      'Batch SharedReport no depth gate: handleBatchSharedReports() returned result.report directly without applying a depth gate — any WKRP_SERVICE_TOKEN bearer received all fields regardless of the requested depth. OSE-577: the deeper defect was keying access on the ENDPOINT, not the token class — so the cross-product (named-identity) WKRP token received full-depth aggregates joinable against a name-bearing roster.',
    severity: 'CRITICAL',
    target_invariant: { number: 1, name: 'anonymous_id' },
    mitigation_story: 'OSE-577',
    test_ref:
      'tests/shared-report-read.spec.ts > OSE-577 — batch service-token class split (cross-product fails closed)',
    status: 'mitigated',
    red_birth: {
      date: '2026-08-03',
      method: 'deliberate-fixture-break',
      notes:
        'Fleet sweep layer 5 (pipeline): batch endpoint returned raw report with no depth gate. OSE-593 applied field-stripping per depth; SR-25 superseded that by removing field-stripping entirely (sponsor_class_breakdown = class-level aggregate intelligence). OSE-577 (ADR-017) then split the "service" role into token CLASSES: the internal in-fleet consumer receives the full report; the cross-product WKRP token FAILS CLOSED (403 CROSS_PRODUCT_ACCESS_PENDING) until the join-risk controls (OCR-61/62, OW-112) ship. Access is now keyed on who holds the token, not on the endpoint.',
    },
    last_run_green: '2026-08-22',
  },
  {
    id: 'TL-055',
    layer: 'repo_wall',
    threat:
      'OER boundary cron gap: runBigQueryBackup() never called logExportManifest() — every nightly BigQuery export violated invariant #17 silently, leaving the export_manifest table missing a row for each cron execution',
    severity: 'HIGH',
    target_invariant: { number: 17, name: 'oer_emission_boundary' },
    mitigation_story: 'OSE-594',
    test_ref:
      'tests/oer-boundary.spec.ts > OSE-594 — TL-055: scheduled BigQuery cron path bounded by logExportManifest',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'design-time-negative-assertion',
      notes:
        'Fleet sweep layer 8 (repo_wall): logExportManifest only wired in the on-demand admin backup route; cron scheduler path (handleScheduled → runBigQueryBackup) had zero manifest writes. Fixed by OSE-594: logExportManifest calls added in both success and failure paths with sentinel event_id cron:batch',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-056',
    layer: 'pipeline',
    threat:
      "Sponsor token without sponsor_id leaks all competitors' impression data: filterReportByDepth had two cases for sponsor_impressions (scoped filter vs pass-all), with no distinction between admin-null (intentional full view) and sponsor-null (missing scope). A sponsor token minted without sponsor_id received every competitor's impression rows.",
    severity: 'CRITICAL',
    target_invariant: { number: 9, name: 'tenant_isolation' },
    mitigation_story: 'OSE-595',
    test_ref:
      'tests/report-depth.spec.ts > sponsor token without sponsor_id receives empty sponsor_impressions',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'deliberate-fixture-break',
      notes:
        'Fleet rank #6: filterReportByDepth lacked a third branch for sponsorScopeRequired=true + sponsorScope=null. Fixed by adding sponsorScopeRequired field to ResolvedDepth and blocking at mint time (role=sponsor requires sponsor_id). Defence-in-depth: both mint gate (400) and read-time gate (empty array) close the leak.',
    },
    last_run_green: '2026-08-03',
  },
  {
    id: 'TL-057',
    layer: 'worker_surface',
    threat:
      'Public check-in and survey forms have no per-event cap: every public form POST is behind the router\'s KV-backed per-IP limiter (60/min, src/router.ts; the KV key is a SHA-256 of the IP), but nothing bounds submissions to one event_id spread across many IPs, so checkin_counts and form_surveys can be inflated by a sender rotating IPs. Registration and email-signup also carry a 10/min per ip:event handler limit (isFormRateLimited); the anonymous handlers do not read the IP themselves (TL-026).',
    severity: 'MEDIUM',
    target_invariant: null, // resource abuse / input handling, not PII retention (#8)
    mitigation_story: 'OSE-1465',
    test_ref:
      'tests/form-rate-limit.spec.ts > TL-057 | route-level limit covers the anonymous form handlers',
    status: 'open',
    red_birth: null,
    last_run_green: null,
    notes:
      'Reclassified 2026-10-01 (conformance refresh review): was marked tested on the strength of A1-A9 injection tests and an always-passing A10 placeholder; the injection coverage now has its own entry, TL-070. Narrowed and lowered from HIGH the same day: the earlier text said check-in and survey had no rate limit at all, but the router limits every public form POST per IP. The test_ref pins that per-IP limit (red when the router check is removed); it does not mitigate the per-event gap, which stays open until OSE-1465.',
  },
  {
    id: 'TL-058',
    layer: 'secrets_layer',
    threat:
      'CF Access JWT forgery: attacker crafts a JWT with a valid-looking payload (email claim) and presents it to the admin endpoint; without signature verification (CF_ACCESS_TEAM_DOMAIN not set), the email-allowlist check is the only gate — a non-allowlisted email gets 403, not bypassing admin access.',
    severity: 'HIGH',
    target_invariant: { number: 9, name: 'tenant_isolation' },
    mitigation_story: null,
    test_ref:
      'tests/admin-allowlist.spec.ts > forged CF Access JWT with invalid RSA signature is rejected',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'deliberate-fixture-break',
      notes:
        'makeForgedJwt() crafts a JWT with deterministic fake RSA sig. When CF_ACCESS_TEAM_DOMAIN is unset, the handler extracts email from payload, checks allowlist, and returns 403 ADMIN_NOT_ALLOWED for unrecognized emails.',
    },
    last_run_green: '2026-08-03',
  },
];

// ─── TL-034 / TL-035: tested via OSE-589, retired via OSE-1194 ─────────────
// Originally accepted (CI-level controls). OSE-589 upgraded them to tested with
// a structural harness (tests/runner-env.spec.ts). OSE-1194 (2026-09-02) retired
// the self-hosted runner pool entirely — CI runs on GitHub-hosted ubuntu-latest —
// so the harness, the probe workflow and tools/runner/ were deleted and both
// entries returned to accepted with a RETIRED test_ref. IDs are never reused.

// ═══════════════════════════════════════════════════════════════════════════════
// Layer: sponsor payment ops (OSE-743 / P0 — out-of-band Payment Links)
// P0 takes money OUT OF BAND with zero code on the money path. These threats
// fence the two committed, inert ops artifacts (frozen contract + operator
// manifest) so the manual flow cannot drift from #25 / #8.
// ═══════════════════════════════════════════════════════════════════════════════

const PAYMENT_OPS: ThreatEntry[] = [
  {
    id: 'TL-059',
    layer: 'permission_layer',
    threat:
      'Non-purchasable dimension sold: an operator adds a Payment Link (or manifest row) that sells size / slot / placement / tier / position, so a paid attribute reaches allocateShares() and breaches the #25 covenant that ONLY rotation frequency is purchasable and placement is uniform.',
    severity: 'HIGH',
    target_invariant: { number: 25, name: 'sponsor_share_covenant' },
    mitigation_story: null,
    test_ref:
      'tests/ops/payment-links-guard.spec.ts > OSE-743 G2 — #25: non-purchasable dimensions cannot be sold > no manifest key names a non-purchasable dimension',
    status: 'tested',
    red_birth: {
      date: '2026-08-13',
      method: 'design-time-negative-assertion',
      notes:
        'Guard scans every payment-manifest record key against FORBIDDEN_PURCHASE_DIMENSIONS (price/amount/tier/sov_tier/slot/size/placement/weight/position/priority). Adding any such key to a manifest row turns the test red before merge. Purchasable dimension is pinned to rotation_frequency.',
    },
    last_run_green: '2026-08-13',
  },
  {
    id: 'TL-060',
    layer: 'export_boundary',
    threat:
      'PII/secret on a committed ops artifact: an operator records an email, phone, contact, full Payment Link URL, or secret/token in the payment-links manifest, leaking bounded PII (#8) into the repo and CI source map.',
    severity: 'MEDIUM',
    target_invariant: { number: 8, name: 'bounded_pii' },
    mitigation_story: null,
    test_ref:
      'tests/ops/payment-links-guard.spec.ts > OSE-743 G4 — #8: the committed manifest carries no PII or secret > no manifest key matches a PII/secret pattern',
    status: 'tested',
    red_birth: {
      date: '2026-08-13',
      method: 'design-time-negative-assertion',
      notes:
        'Guard asserts no manifest key matches PII_KEY_PATTERNS (email/phone/ip/anon_id/name/contact/address/card/pan/secret/token) and that link_ref_last6 is a <=6-char fragment, never a full URL or long token. The manifest interface is also PII-free by type.',
    },
    last_run_green: '2026-08-13',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Layer: sponsor eligibility gate (OSE-744 / P1 — 402 at the promotion seam)
// TL-059/TL-060 are the P0 payment-ops group above; this P1 group starts at
// TL-061 (unique + format, contiguity not required). Every gate test asserts by
// calling the promotion lib directly (no auth path), so it CANNOT false-green
// under DEV_OPEN_ADMIN — production auth posture by construction.
// ═══════════════════════════════════════════════════════════════════════════════

const SPONSOR_ELIGIBILITY_GATE: ThreatEntry[] = [
  {
    id: 'TL-061',
    layer: 'permission_layer',
    threat:
      'Client-forged eligibility: a caller supplies free_tier / eligibility in the promote request to bypass payment. The gate reads only the SERVER-SET sponsor_business_draft.free_tier_eligible column — promoteSponsorDraft takes no client eligibility input — so a forged claim yields 402 regardless.',
    severity: 'HIGH',
    target_invariant: { number: 25, name: 'sponsor_share_covenant' },
    mitigation_story: 'OSE-744',
    test_ref:
      'tests/red-team/sponsor-eligibility-gate.spec.ts > OSE-744 — gate at the promotion seam > server-set only: the gate reads the DB column, not caller intent',
    status: 'tested',
    red_birth: {
      date: '2026-08-13',
      method: 'design-time-negative-assertion',
      notes:
        'Draft seeded free_tier_eligible=0; promoteSponsorDraft returns 402 PAYMENT_REQUIRED. No request-body path can set eligibility — the reducer input is derived from the DB row only.',
    },
    last_run_green: '2026-08-13',
  },
  {
    id: 'TL-062',
    layer: 'd1_boundary',
    threat:
      'Unpaid wall crossing: an ineligible draft is promoted to a live, resolver-visible sponsor without payment. The gate returns 402 BEFORE any write — no sponsors row is minted and the draft stays status=draft (re-submittable), so the #25 wall stays closed for the unpaid.',
    severity: 'CRITICAL',
    target_invariant: { number: 25, name: 'sponsor_share_covenant' },
    mitigation_story: 'OSE-744',
    test_ref:
      'tests/red-team/sponsor-eligibility-gate.spec.ts > OSE-744 — gate at the promotion seam > ineligible draft → 402 PAYMENT_REQUIRED, no sponsor, draft.status untouched',
    status: 'tested',
    red_birth: {
      date: '2026-08-13',
      method: 'design-time-negative-assertion',
      notes:
        'sponsors COUNT(*) unchanged across the 402; draft.status still draft and promoted_sponsor_id null. Would go red if the gate wrote before deciding.',
    },
    last_run_green: '2026-08-13',
  },
  {
    id: 'TL-063',
    layer: 'permission_layer',
    threat:
      'Cross-brand comp token: a signed sponsor-invite/comp token minted for brand X is presented to promote a draft belonging to brand Y. The comp path reads brand_id from the SIGNED claim and requires claim.brand_id === draft.brand_id (#9); a mismatched token is rejected and promotion falls through to 402.',
    severity: 'HIGH',
    target_invariant: { number: 9, name: 'tenant_isolation' },
    mitigation_story: 'OSE-744',
    test_ref:
      'tests/red-team/sponsor-eligibility-gate.spec.ts > OSE-744 — comp invite token is brand-bound > cross-brand comp token is rejected',
    status: 'tested',
    red_birth: {
      date: '2026-08-13',
      method: 'design-time-negative-assertion',
      notes:
        'A valid token for a foreign brand does not admit the draft (402); only a token whose signed brand_id matches the draft brand admits. Signature+expiry verified via verifySponsorInviteToken.',
    },
    last_run_green: '2026-08-13',
  },
  {
    id: 'TL-064',
    layer: 'permission_layer',
    threat:
      'Eligibility source as an allocation dimension: the WAY a promotion was funded (free_tier vs comp vs subscription) leaks into share-of-voice. Promotion server-forces the covenant base tier regardless of source, and allocateShares takes no payment/eligibility input — so identical output tier and {id,sharePct}-only shape hold (#25).',
    severity: 'HIGH',
    target_invariant: { number: 25, name: 'sponsor_share_covenant' },
    mitigation_story: 'OSE-744',
    test_ref:
      'tests/red-team/sponsor-eligibility-gate.spec.ts > OSE-744 — #25 allocation invariant to payment/eligibility > eligibility SOURCE never changes the promoted tier',
    status: 'tested',
    red_birth: {
      date: '2026-08-13',
      method: 'design-time-negative-assertion',
      notes:
        'comp-funded and free_tier-funded promotions both write tier=COVENANT_BASE_TIER; allocateShares output keys are exactly [id, sharePct]. Would go red if a source-derived tier or weight were introduced.',
    },
    last_run_green: '2026-08-13',
  },
  {
    id: 'TL-065',
    layer: 'audit_layer',
    threat:
      'Silent or PII-bearing eligibility decision: the promotion gate admits/denies without an audit trail, or writes personal data into the trail. Every decision emits a SPONSOR_ELIGIBILITY_DECISION admin_audit_log row whose details carry ONLY {decision, source} and resource_id = brand_id (a tenant id) — no email/ip/name/anon_id.',
    severity: 'MEDIUM',
    target_invariant: { number: 24, name: 'auditability' },
    mitigation_story: 'OSE-744',
    test_ref:
      'tests/red-team/sponsor-eligibility-gate.spec.ts > OSE-744 — the eligibility decision is audited, PII-free (#24) > grant writes a SPONSOR_ELIGIBILITY_DECISION row carrying only decision+source',
    status: 'tested',
    red_birth: {
      date: '2026-08-13',
      method: 'design-time-negative-assertion',
      notes:
        'Grant path asserts an audit row with outcome=success, resource_id=brand_id, ip null, and details keys exactly [decision, source]; the 402 path asserts outcome=denied with decision=payment_required. Would go red if the row were missing or carried PII.',
    },
    last_run_green: '2026-08-13',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Layer: impression-privacy red-team (OSE-662 — public-URL impression surface)
// Born-red adversarial coverage for anonymous sponsor impressions. TL-066..069
// (TL-061..065 = the sponsor-eligibility group above). Attack 8 (maps H3 leak)
// is TL-069, tagging the pre-existing geo-link-maps-not-h3 spec.
// ═══════════════════════════════════════════════════════════════════════════════

const IMPRESSION_PRIVACY_REDTEAM: ThreatEntry[] = [
  {
    id: 'TL-066',
    layer: 'worker_surface',
    threat:
      'Impression de-anonymization: recover WHO from device-minute impressions via session/timing/cross-state joins. Refused — sponsor_impressions carries zero attendee-identifying columns (no ip/ua/anon_id/session/device/user_id/email/lat/lon), so there is nothing to correlate to an individual.',
    severity: 'HIGH',
    target_invariant: { number: 7, name: 'aggregate_only_reporting' },
    mitigation_story: 'OSE-661',
    test_ref:
      'tests/red-team/impression-privacy.spec.ts > OSE-662 attack 2 — impression de-anonymization (no identity columns) > sponsor_impressions schema carries zero attendee-identifying columns',
    status: 'tested',
    red_birth: {
      date: '2026-08-22',
      method: 'design-time-negative-assertion',
      notes:
        'PRAGMA table_info(sponsor_impressions) asserted against a forbidden identity-column set. Goes red the moment an ip/anon_id/session/device/lat/lon column is added to the impression table.',
    },
    last_run_green: '2026-08-22',
  },
  {
    id: 'TL-067',
    layer: 'worker_surface',
    threat:
      'Floor probe on impression metrics: request sponsor impression metrics for a tiny cohort to read a sub-K count. Suppressed — impression-derived aggregates route through applyCountFloor (OSE-683 drop-before-sum), so no impression metric renders below the K floor.',
    severity: 'HIGH',
    target_invariant: { number: 7, name: 'aggregate_only_reporting' },
    mitigation_story: 'OSE-683',
    test_ref:
      'tests/red-team/impression-privacy.spec.ts > OSE-662 attack 3 — floor probe on impression metrics (sub-K suppressed) > impression-derived aggregates route through applyCountFloor (OSE-683)',
    status: 'tested',
    red_birth: {
      date: '2026-08-22',
      method: 'design-time-negative-assertion',
      notes:
        'Static gate: shared-report-builder must import/apply applyCountFloor and expose the floored sponsor_class_breakdown surface. Goes red if the floor is removed from the impression aggregation path.',
    },
    last_run_green: '2026-08-22',
  },
  {
    id: 'TL-068',
    layer: 'worker_surface',
    threat:
      'Channel-cap on impressions: read in-event device impressions at a finer geo grain than presence allows. Refused — impressions are captured at h3_res7 (~5 km² corridor cell) ONLY; no finer res8/res9 column exists on sponsor_impressions and the INSERT binds only res7 (OSE-635 res7-cap).',
    severity: 'HIGH',
    target_invariant: { number: 2, name: 'hyperlocal_geo_resolution' },
    mitigation_story: 'OSE-635',
    test_ref:
      'tests/red-team/impression-privacy.spec.ts > OSE-662 attack 9 — channel-cap on impressions (finest grain = res7) > sponsor_impressions carries h3_res7 but NO finer h3_res8/res9 grain',
    status: 'tested',
    red_birth: {
      date: '2026-08-22',
      method: 'design-time-negative-assertion',
      notes:
        'Schema + static gate: sponsor_impressions has h3_res7 and neither h3_res8 nor h3_res9; the impression INSERT column list carries only h3_res7. Goes red if a finer cell column/write is introduced.',
    },
    last_run_green: '2026-08-22',
  },
  {
    id: 'TL-069',
    layer: 'worker_surface',
    threat:
      'Maps link H3 leak: the human maps link carries an H3 cell instead of real coordinates, or a third-party embed logs the viewer. Refused — renderGeoLink emits coordinates only (never an H3 token) and is link-out only (anchor, no embed, no referrer).',
    severity: 'MEDIUM',
    target_invariant: { number: 2, name: 'hyperlocal_geo_resolution' },
    mitigation_story: 'OSE-660',
    test_ref:
      'tests/geo-link-maps-not-h3.spec.ts > OSE-660 | maps != H3 — coordinates only, never an H3 cell > the produced link NEVER contains an H3 cell / precision token',
    status: 'tested',
    red_birth: {
      date: '2026-08-22',
      method: 'design-time-negative-assertion',
      notes:
        'Existing OSE-660 spec ledger-tagged by OSE-662: asserts the geo link contains lat/lon and never the supplied H3 cell, and is an anchor (no embed/referrer). Goes red if an H3 token leaks into the link or an embed is introduced.',
    },
    last_run_green: '2026-08-22',
  },
  {
    id: 'TL-070',
    layer: 'worker_surface',
    threat:
      'Injection and malformed input on the public form endpoints (register, check-in, survey, email-signup): SQL metacharacters in fields and in the event-id path segment, null and array bodies, control and zero-width characters, and over-length emails must not escape parameterisation or crash the handler (no 500).',
    severity: 'HIGH',
    target_invariant: null, // resource abuse / input handling, not PII retention (#8)
    mitigation_story: 'OSE-599',
    test_ref: 'tests/forms-adversarial.spec.ts > A1-A9 injection/boundary coverage',
    status: 'tested',
    red_birth: {
      date: '2026-08-03',
      method: 'deliberate-fixture-break',
      notes:
        'Split out of TL-057 on 2026-10-01. Fleet sweep: A1-A9 adversarial tests confirmed injection resistance; null-body 500 and array-body 200 bugs found and fixed (parseJsonBody + email-over-320 silent truncation).',
    },
    last_run_green: '2026-08-03',
    notes:
      'Scope narrowed 2026-10-01 to what the tests prove (no SQL escape, no 500). Not covered: the A3 homoglyph test sends ASCII twice, so homoglyph email handling is untested; silent name truncation (A4) and nonexistent-event acceptance (A9) are open as TL-071.',
  },
  {
    id: 'TL-071',
    layer: 'worker_surface',
    threat:
      'Public form endpoints accept a submission for an event id that does not exist (A9), and silently truncate a name over 200 characters instead of rejecting it (A4). Both let junk or altered data into the forms tables without an error the submitter can see.',
    severity: 'MEDIUM',
    target_invariant: null,
    mitigation_story: null,
    test_ref:
      'tests/forms-adversarial.spec.ts > A4 name over 200 chars is silently truncated; A9 submitting to non-existent event succeeds (both document current behaviour)',
    status: 'open',
    red_birth: null,
    last_run_green: null,
    notes:
      'Opened 2026-10-01 from the conformance-refresh review: these behaviours were counted as tested coverage under TL-057, but the tests assert the gap, not a mitigation.',
  },
];

export const THREAT_LEDGER: ThreatEntry[] = [
  ...D1_BOUNDARY,
  ...WORKER_SURFACE,
  ...PERMISSION_LAYER,
  ...PIPELINE,
  ...SECRETS_LAYER,
  ...REPO_WALL,
  ...EXPORT_BOUNDARY,
  ...AUDIT_LAYER,
  ...EXISTING_COVERAGE,
  ...SPONSOR_AUDIT,
  ...EVENT_MANAGER_AUDIT,
  ...GAP_CLOSURE,
  ...PAYMENT_OPS,
  ...SPONSOR_ELIGIBILITY_GATE,
  ...IMPRESSION_PRIVACY_REDTEAM,
];

export const THREAT_LEDGER_META = {
  schema_version: '1.0.0',
  story: 'OSE-564',
  last_updated: '2026-09-02',
  total_entries: THREAT_LEDGER.length,
  layers: 8,
} as const;
