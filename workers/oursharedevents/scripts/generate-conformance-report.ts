/**
 * OSE-560 — Conformance report generator.
 *
 * Produces CONFORMANCE.md (human-readable) and conformance.json (machine-readable)
 * from three sources of truth — never hand-written:
 *   1. tests/fixtures/threat-ledger.ts  — 28 threats, invariant mappings, red birth dates
 *   2. Test source files                — @born-red TL-XXX annotations (test → ledger → invariant)
 *   3. OCR-docs architectural-invariants.yaml (optional, richer claims when path provided)
 *
 * Usage:
 *   npx tsx scripts/generate-conformance-report.ts \
 *     [--invariants-yaml <path>] \
 *     [--test-dir <path>]        \
 *     [--out-dir <path>]         \
 *     [--commit <sha>]           \
 *     [--run-url <url>]          \
 *     [--run-date <YYYY-MM-DD>]
 *
 * CI invocation (see .github/workflows/conformance-report.yml):
 *   npx tsx scripts/generate-conformance-report.ts \
 *     --invariants-yaml ../../../../OCR-docs/ocr-docs-brain/architectural-invariants.yaml \
 *     --commit $GITHUB_SHA \
 *     --run-url "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
 *
 * Empty rows are the product: invariants with no mapped enforcement render as ❌ GAP.
 * The report failing loudly on gaps is its primary function.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { THREAT_LEDGER } from '../tests/fixtures/threat-ledger.ts';
import type { ThreatEntry } from '../tests/fixtures/threat-ledger.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const INVARIANTS_YAML_PATH = getArg('--invariants-yaml');
const TEST_DIR = getArg('--test-dir') ?? path.resolve(__dirname, '../tests');
const OUT_DIR = getArg('--out-dir') ?? path.resolve(__dirname, '../docs/security');
const COMMIT_SHA = getArg('--commit') ?? 'local';
const RUN_URL = getArg('--run-url') ?? '';
const RUN_DATE = getArg('--run-date') ?? new Date().toISOString().slice(0, 10);

// ─── Invariant registry ───────────────────────────────────────────────────────

interface InvariantEntry {
  id: number;
  name: string;
  label: string;
  group: string;
  status: 'live' | 'partial' | 'planned' | 'retired';
  protective_statement?: string;
  enforcement_statement?: string;
  test_file?: string;
}

/**
 * Inline fallback registry — the bootstrap base. When the brain YAML is provided,
 * `buildInvariantRegistry` enriches these field-by-field AND adds any higher ids
 * (e.g. #25) the brain declares. Exported for OSE-1031 unit tests. NOTE: this is a
 * BOOTSTRAP base, not the source of truth — it deliberately stops at #24; the brain
 * owns the canonical count. A CI run that falls back to this alone (no brain) is a
 * defect the workflow now fails loud on.
 */
export const INLINE_INVARIANTS: InvariantEntry[] = [
  {
    id: 1,
    name: 'anonymous_id',
    label: '#1 — Anonymous ID',
    group: 'privacy_identity',
    status: 'live',
  },
  {
    id: 2,
    name: 'hyperlocal_geo_resolution',
    label: '#2 — Hyperlocal Geo Resolution',
    group: 'product_experience',
    status: 'live',
  },
  {
    id: 3,
    name: 'uec_encoding',
    label: '#3 — UEC Encoding',
    group: 'product_experience',
    status: 'live',
  },
  {
    id: 4,
    name: 'ncr_data_accumulation',
    label: '#4 — NCR Data Accumulation',
    group: 'product_experience',
    status: 'live',
  },
  {
    id: 5,
    name: 'tier_equity',
    label: '#5 — Tier Equity',
    group: 'commercial_governance',
    status: 'partial',
  },
  {
    id: 6,
    name: 'inert_monetization_hooks',
    label: '#6 — Inert Monetization Hooks',
    group: 'commercial_governance',
    status: 'live',
  },
  {
    id: 7,
    name: 'aggregate_only_reporting',
    label: '#7 — Aggregate-Only Reporting',
    group: 'privacy_identity',
    status: 'partial',
  },
  {
    id: 8,
    name: 'bounded_pii_retention',
    label: '#8 — Bounded PII Retention',
    group: 'privacy_identity',
    status: 'live',
  },
  {
    id: 9,
    name: 'tenant_isolation',
    label: '#9 — Tenant Isolation',
    group: 'security_isolation',
    status: 'partial',
  },
  {
    id: 10,
    name: 'deprecation_lock',
    label: '#10 — Deprecation Lock',
    group: 'infrastructure_ci',
    status: 'live',
  },
  {
    id: 11,
    name: 'self_hosted_runner_bash_resolution',
    label: '#11 — Runner Bash Resolution',
    group: 'infrastructure_ci',
    status: 'retired',
  },
  {
    id: 12,
    name: 'runner_pool_readiness_probe',
    label: '#12 — Runner Pool Readiness Probe',
    group: 'infrastructure_ci',
    status: 'retired',
  },
  {
    id: 13,
    name: 'brain_enforcement_location',
    label: '#13 — Brain Enforcement Location',
    group: 'governance_brain',
    status: 'live',
  },
  {
    id: 14,
    name: 'mobile_workability',
    label: '#14 — Mobile Workability',
    group: 'product_experience',
    status: 'partial',
  },
  {
    id: 15,
    name: 'cors_allowlist_immutability',
    label: '#15 — CORS Allowlist Immutability',
    group: 'security_isolation',
    status: 'live',
  },
  {
    id: 16,
    name: 'api_response_schema_stability',
    label: '#16 — API Response Schema Stability',
    group: 'product_experience',
    status: 'live',
  },
  {
    id: 17,
    name: 'oer_emission_boundary',
    label: '#17 — OER Emission Boundary',
    group: 'security_isolation',
    status: 'live',
  },
  {
    id: 18,
    name: 'slug_permanence',
    label: '#18 — Slug Permanence',
    group: 'product_experience',
    status: 'live',
  },
  {
    id: 19,
    name: 'migration_monotonicity',
    label: '#19 — Migration Monotonicity',
    group: 'infrastructure_ci',
    status: 'live',
  },
  {
    id: 20,
    name: 'standards_propagation_completeness',
    label: '#20 — Standards Propagation',
    group: 'governance_brain',
    status: 'partial',
  },
  {
    id: 21,
    name: 'shared_report_schema_stability',
    label: '#21 — SharedReport Schema Stability',
    group: 'product_experience',
    status: 'live',
  },
  {
    id: 22,
    name: 'cross_repo_import_isolation',
    label: '#22 — Cross-Repo Import Isolation',
    group: 'security_isolation',
    status: 'live',
  },
  {
    id: 23,
    name: 'red_team_coverage',
    label: '#23 — Red Team Coverage',
    group: 'security_isolation',
    status: 'partial',
  },
  {
    id: 24,
    name: 'auditability',
    label: '#24 — Auditability',
    group: 'governance_brain',
    status: 'partial',
  },
];

// ─── Simple line-by-line YAML parser for architectural-invariants.yaml ────────
// Not a general parser — handles the specific schema_version 1.2.0 format.

export function parseInvariantsYaml(yamlContent: string): InvariantEntry[] {
  const entries: InvariantEntry[] = [];
  const lines = yamlContent.split('\n');
  let inInvariantsBlock = false;
  let current: Partial<InvariantEntry> | null = null;
  let inMultiLine = false;
  let multiLineKey = '';
  let multiLineValue = '';

  const flush = () => {
    if (current && current.id !== undefined) entries.push(current as InvariantEntry);
    current = null;
    inMultiLine = false;
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();

    if (trimmed === 'invariants:') {
      inInvariantsBlock = true;
      continue;
    }
    if (!inInvariantsBlock) continue;

    // Top-level key (not indented) ends the invariants block
    if (
      line.length > 0 &&
      line[0] !== ' ' &&
      line[0] !== '\t' &&
      trimmed !== 'invariants:' &&
      !trimmed.startsWith('-')
    ) {
      flush();
      inInvariantsBlock = false;
      continue;
    }

    // Handle multi-line block scalars (| or >)
    if (inMultiLine) {
      // Continuation lines are indented deeper than the key
      if (trimmed.length > 0 && line.startsWith('      ')) {
        multiLineValue += ' ' + trimmed;
        continue;
      } else {
        // End of multi-line — save it
        if (current) (current as Record<string, unknown>)[multiLineKey] = multiLineValue.trim();
        inMultiLine = false;
      }
    }

    // New entry
    const idMatch = line.match(/^\s*-\s*id:\s*['"]?(\d+)['"]?/);
    if (idMatch) {
      flush();
      current = { id: parseInt(idMatch[1]) };
      continue;
    }

    if (!current) continue;

    // Field extraction helpers
    const field = (key: string): string | null => {
      const re = new RegExp(`^\\s+${key}:\\s*(.+)$`);
      const m = line.match(re);
      if (!m) return null;
      return m[1].replace(/^['"]|['"]$/g, '').trim();
    };

    const name = field('name');
    if (name) {
      current.name = name;
      continue;
    }

    const status = field('status');
    if (status && ['live', 'partial', 'planned', 'retired'].includes(status)) {
      current.status = status as InvariantEntry['status'];
      continue;
    }

    const label = field('label');
    if (label) {
      current.label = label;
      continue;
    }

    const group = field('group');
    if (group) {
      current.group = group;
      continue;
    }

    const testFile = field('test_file');
    if (testFile) {
      current.test_file = testFile;
      continue;
    }

    // Block scalar fields
    const protectiveMatch = line.match(/^\s+protective_statement:\s*[|>]?(.*)$/);
    if (protectiveMatch) {
      const val = protectiveMatch[1].trim().replace(/^[|>]/, '').trim();
      if (val && !val.startsWith('|') && !val.startsWith('>')) {
        current.protective_statement = val.replace(/^['"]|['"]$/g, '');
      } else {
        multiLineKey = 'protective_statement';
        multiLineValue = '';
        inMultiLine = true;
      }
      continue;
    }

    const enforcementMatch = line.match(/^\s+enforcement_statement:\s*[|>]?(.*)$/);
    if (enforcementMatch) {
      const val = enforcementMatch[1].trim().replace(/^[|>]/, '').trim();
      if (val && !val.startsWith('|') && !val.startsWith('>')) {
        current.enforcement_statement = val.replace(/^['"]|['"]$/g, '');
      } else {
        multiLineKey = 'enforcement_statement';
        multiLineValue = '';
        inMultiLine = true;
      }
      continue;
    }
  }

  flush();
  return entries;
}

/** Merge YAML entries into the inline registry, enriching where available. */
export function buildInvariantRegistry(yamlEntries: InvariantEntry[]): Map<number, InvariantEntry> {
  const registry = new Map<number, InvariantEntry>();
  for (const inv of INLINE_INVARIANTS) registry.set(inv.id, { ...inv });
  for (const yamlEntry of yamlEntries) {
    const existing = registry.get(yamlEntry.id);
    if (existing) {
      if (yamlEntry.name) existing.name = yamlEntry.name;
      if (yamlEntry.label) existing.label = yamlEntry.label;
      if (yamlEntry.status) existing.status = yamlEntry.status;
      if (yamlEntry.group) existing.group = yamlEntry.group;
      if (yamlEntry.protective_statement)
        existing.protective_statement = yamlEntry.protective_statement;
      if (yamlEntry.enforcement_statement)
        existing.enforcement_statement = yamlEntry.enforcement_statement;
      if (yamlEntry.test_file) existing.test_file = yamlEntry.test_file;
    } else {
      registry.set(yamlEntry.id, yamlEntry);
    }
  }
  return registry;
}

// ─── Test annotation scanner ──────────────────────────────────────────────────

interface AnnotationMap {
  // TL-XXX → list of "filename:lineNo" references
  bornRedById: Map<string, string[]>;
  // invariant number → list of "filename:lineNo" references (OSE-997).
  // The brain-conformance evidence class: tests that assert the code matches
  // an OCR-docs brain declaration (e.g. demo geo resolves inside its named
  // corridor). Distinct from @born-red TL-XXX (security threat ledger) — this
  // is signal-integrity / brain↔code drift, mapped straight to an invariant.
  brainConformanceByInvariant: Map<number, string[]>;
}

function scanTestAnnotations(testDir: string): AnnotationMap {
  const bornRedById = new Map<string, string[]>();
  const brainConformanceByInvariant = new Map<number, string[]>();
  const ANNOTATION_RE = /@born-red\s+(TL-\d{3})/g;
  const BRAIN_CONFORMANCE_RE = /@brain-conformance\s+(\d+)/g;

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) continue;
      const content = fs.readFileSync(full, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        const re = new RegExp(ANNOTATION_RE.source, ANNOTATION_RE.flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          const id = m[1];
          const ref = `${path.relative(testDir, full).replace(/\\/g, '/')}:${i + 1}`;
          if (!bornRedById.has(id)) bornRedById.set(id, []);
          bornRedById.get(id)!.push(ref);
        }
        const bc = new RegExp(BRAIN_CONFORMANCE_RE.source, BRAIN_CONFORMANCE_RE.flags);
        let b: RegExpExecArray | null;
        while ((b = bc.exec(line)) !== null) {
          const invNum = Number(b[1]);
          const ref = `${path.relative(testDir, full).replace(/\\/g, '/')}:${i + 1}`;
          if (!brainConformanceByInvariant.has(invNum)) brainConformanceByInvariant.set(invNum, []);
          brainConformanceByInvariant.get(invNum)!.push(ref);
        }
      });
    }
  }

  scanDir(testDir);
  return { bornRedById, brainConformanceByInvariant };
}

// ─── Conformance matrix builder ───────────────────────────────────────────────

interface ThreatSummary {
  id: string;
  threat: string;
  severity: string;
  status: string;
  test_ref: string | null;
  red_birth_date: string | null;
  last_run_green: string | null;
  annotations: string[]; // test file references
}

interface ConformanceRow {
  invariant: InvariantEntry;
  threats: ThreatSummary[];
  // Brain-conformance test references (OSE-997) — signal-integrity evidence
  // mapped straight to this invariant, alongside (or instead of) threat tests.
  brain_conformance: string[];
  enforcement_status: 'enforced' | 'partial' | 'gap' | 'retired';
  last_attacked: string | null;
  last_green: string | null;
}

function buildMatrix(
  registry: Map<number, InvariantEntry>,
  annotations: AnnotationMap
): ConformanceRow[] {
  // Group threats by invariant number
  const threatsByInvariant = new Map<number, ThreatEntry[]>();
  for (const entry of THREAT_LEDGER) {
    if (!entry.target_invariant) continue;
    const num = entry.target_invariant.number;
    if (!threatsByInvariant.has(num)) threatsByInvariant.set(num, []);
    threatsByInvariant.get(num)!.push(entry);
  }

  const rows: ConformanceRow[] = [];

  for (const [id, inv] of [...registry.entries()].sort((a, b) => a[0] - b[0])) {
    const threats = threatsByInvariant.get(id) ?? [];
    const threatSummaries: ThreatSummary[] = threats.map((t) => ({
      id: t.id,
      threat: t.threat,
      severity: t.severity,
      status: t.status,
      test_ref: t.test_ref,
      red_birth_date: t.red_birth?.date ?? null,
      last_run_green: t.last_run_green,
      annotations: annotations.bornRedById.get(t.id) ?? [],
    }));

    // Brain-conformance evidence for this invariant (OSE-997)
    const brain_conformance = annotations.brainConformanceByInvariant.get(id) ?? [];

    // Determine enforcement status
    let enforcement_status: 'enforced' | 'partial' | 'gap' | 'retired' = 'gap';
    if (threatSummaries.length > 0) {
      const hasTestedOrMitigated = threatSummaries.some(
        (t) => t.status === 'tested' || t.status === 'mitigated'
      );
      const hasOpen = threatSummaries.some((t) => t.status === 'open');
      if (hasTestedOrMitigated && !hasOpen) enforcement_status = 'enforced';
      else if (hasTestedOrMitigated && hasOpen) enforcement_status = 'partial';
      else enforcement_status = 'gap';
    }

    // A passing brain-conformance test IS enforcement evidence — an invariant
    // enforced only by brain-conformance (no threat mapping) is not a gap.
    if (brain_conformance.length > 0 && enforcement_status === 'gap') {
      enforcement_status = 'enforced';
    }

    // Also factor in the invariant's own status
    if (inv.status === 'partial' && enforcement_status === 'enforced') {
      enforcement_status = 'partial';
    }

    // A retired invariant (OSE-1194: #11/#12 self-hosted runner apparatus) has
    // no enforcement by design — it is neither a gap nor evidence. Kept in the
    // matrix so the numbering stays auditable; never counted against coverage.
    if (inv.status === 'retired') {
      enforcement_status = 'retired';
    }

    // Last dates
    const attackDates = threatSummaries
      .filter((t) => t.red_birth_date)
      .map((t) => t.red_birth_date!);
    const greenDates = threatSummaries
      .filter((t) => t.last_run_green)
      .map((t) => t.last_run_green!);

    const last_attacked = attackDates.length > 0 ? attackDates.sort().reverse()[0] : null;
    const last_green = greenDates.length > 0 ? greenDates.sort().reverse()[0] : null;

    rows.push({
      invariant: inv,
      threats: threatSummaries,
      brain_conformance,
      enforcement_status,
      last_attacked,
      last_green,
    });
  }

  return rows;
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function statusBadge(status: 'enforced' | 'partial' | 'gap' | 'retired'): string {
  if (status === 'enforced') return '✅ Enforced';
  if (status === 'partial') return '⚠️ Partial';
  if (status === 'retired') return '🗄️ Retired';
  return '❌ Gap';
}

function severityBadge(s: string): string {
  if (s === 'CRITICAL') return '🔴';
  if (s === 'HIGH') return '🟠';
  if (s === 'MEDIUM') return '🟡';
  return '⚪';
}

export function shortCommit(commit: string): string {
  return commit === 'local' ? 'local' : commit.slice(0, 8);
}

export function renderMarkdown(rows: ConformanceRow[], meta: Record<string, string>): string {
  const counts = { enforced: 0, partial: 0, gap: 0, retired: 0 };
  for (const r of rows) counts[r.enforcement_status]++;

  const shortSha = shortCommit(meta.commit);
  const runLink = meta.run_url ? `[CI Run](${meta.run_url})` : 'local';

  let md = `# OurSharedEvents — Invariant Conformance Report

> **Generated:** ${meta.run_date} | **Commit:** \`${shortSha}\` | **Run:** ${runLink}
>
> This document is machine-generated by \`scripts/generate-conformance-report.ts\`.
> **Do not edit manually** — changes will be overwritten on next CI run.
> Source: \`tests/fixtures/threat-ledger.ts\` + \`@born-red\` test annotations + architectural-invariants.yaml
>
> **Primary function:** Empty rows are the product. An invariant with no mapped enforcement renders as a gap —
> this is the drift detector. A hand-written conformance doc is testimony wearing a table.

---

## Summary

| Status | Count | Invariants |
|--------|-------|------------|
| ✅ Enforced | ${counts.enforced} | ${
    rows
      .filter((r) => r.enforcement_status === 'enforced')
      .map((r) => `#${r.invariant.id}`)
      .join(', ') || '—'
  } |
| ⚠️ Partial | ${counts.partial} | ${
    rows
      .filter((r) => r.enforcement_status === 'partial')
      .map((r) => `#${r.invariant.id}`)
      .join(', ') || '—'
  } |
| ❌ Gap | ${counts.gap} | ${
    rows
      .filter((r) => r.enforcement_status === 'gap')
      .map((r) => `#${r.invariant.id}`)
      .join(', ') || '—'
  } |
| 🗄️ Retired | ${counts.retired} | ${
    rows
      .filter((r) => r.enforcement_status === 'retired')
      .map((r) => `#${r.invariant.id}`)
      .join(', ') || '—'
  } |

**Total invariants:** ${rows.length} | **Threat ledger entries:** ${THREAT_LEDGER.length} (${THREAT_LEDGER.filter((t) => t.status === 'open').length} open)

---

## Per-Invariant Matrix

`;

  for (const row of rows) {
    const {
      invariant: inv,
      threats,
      brain_conformance,
      enforcement_status,
      last_attacked,
      last_green,
    } = row;
    md += `### ${inv.label} — \`${inv.name}\`\n\n`;
    md += `**Status:** ${statusBadge(enforcement_status)} `;
    if (inv.status !== 'live') md += `_(invariant status: ${inv.status})_`;
    md += '\n';

    if (inv.protective_statement) {
      md += `\n**Claim:** ${inv.protective_statement}\n`;
    }

    if (threats.length === 0 && brain_conformance.length === 0) {
      md += `\n**Enforcement:** ❌ _No threats mapped in the ledger for this invariant._\n`;
      md += `> **To add coverage:** Create a threat entry in \`tests/fixtures/threat-ledger.ts\` with \`target_invariant: { number: ${inv.id}, name: '${inv.name}' }\`, write a test, and add a \`// @born-red TL-XXX\` annotation.\n`;
    } else if (threats.length > 0) {
      md += `\n**Enforcement:**\n\n`;
      for (const t of threats) {
        const statusIcon =
          t.status === 'tested'
            ? '✅'
            : t.status === 'mitigated'
              ? '🛡️'
              : t.status === 'open'
                ? '⚠️ open'
                : '—';
        const testLine = t.test_ref ? `→ \`${t.test_ref}\`` : '→ _no test yet_';
        const annotationLine =
          t.annotations.length > 0
            ? ` _(annotated at: ${t.annotations.join(', ')})_`
            : t.status === 'tested'
              ? ' _(⚠️ no @born-red annotation found)_'
              : '';
        md += `- ${severityBadge(t.severity)} **${t.id}** [${statusIcon}]: ${t.threat.slice(0, 80)}${t.threat.length > 80 ? '…' : ''} ${testLine}${annotationLine}\n`;
      }
    }

    if (brain_conformance.length > 0) {
      md += `\n**Brain-conformance** _(signal-integrity — code matches the OCR-docs brain, OSE-997)_:\n`;
      for (const ref of brain_conformance) {
        md += `- 🧠 \`${ref}\`\n`;
      }
    }

    md += `\n**Last green:** ${last_green ?? '—'} | **Last attacked:** ${last_attacked ?? '—'}\n\n---\n\n`;
  }

  // Threat ledger entries not mapped to any invariant
  const unmappedThreats = THREAT_LEDGER.filter((t) => !t.target_invariant);
  if (unmappedThreats.length > 0) {
    md += `## Threats Not Mapped to an Invariant\n\n`;
    md += `These threats are in the ledger but not tied to a specific invariant. Consider whether a new invariant is needed, or map to an existing one.\n\n`;
    for (const t of unmappedThreats) {
      const statusIcon = t.status === 'tested' ? '✅' : t.status === 'mitigated' ? '🛡️' : '⚠️';
      md += `- ${severityBadge(t.severity)} **${t.id}** [${statusIcon} ${t.status}] _(${t.layer})_: ${t.threat.slice(0, 100)}${t.threat.length > 100 ? '…' : ''}\n`;
    }
    md += '\n';
  }

  md += `---\n\n_Report generated ${meta.run_date}. Next scheduled run: weekly cron or on merge to main._\n`;
  return md;
}

// ─── JSON renderer ─────────────────────────────────────────────────────────────

export function renderJson(rows: ConformanceRow[], meta: Record<string, string>): string {
  const output = {
    generated_at: meta.run_date,
    // The same 8-character short SHA the Markdown shows. A full 40-character
    // SHA reads as a high-entropy hex string to detect-secrets (S0), so every
    // automated refresh PR went red on its own provenance line.
    commit: shortCommit(meta.commit),
    run_url: meta.run_url,
    schema_version: '1.0.0',
    story: 'OSE-560',
    summary: {
      total: rows.length,
      enforced: rows.filter((r) => r.enforcement_status === 'enforced').length,
      partial: rows.filter((r) => r.enforcement_status === 'partial').length,
      gap: rows.filter((r) => r.enforcement_status === 'gap').length,
      retired: rows.filter((r) => r.enforcement_status === 'retired').length,
      threat_entries: THREAT_LEDGER.length,
      open_threats: THREAT_LEDGER.filter((t) => t.status === 'open').length,
    },
    invariants: rows.map((r) => ({
      id: r.invariant.id,
      name: r.invariant.name,
      label: r.invariant.label,
      invariant_status: r.invariant.status,
      enforcement_status: r.enforcement_status,
      last_attacked: r.last_attacked,
      last_green: r.last_green,
      threat_count: r.threats.length,
      open_threat_count: r.threats.filter((t) => t.status === 'open').length,
      brain_conformance: r.brain_conformance,
    })),
  };
  return JSON.stringify(output, null, 2);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[OSE-560] Conformance report generator — ${RUN_DATE}`);

  // Load invariants
  let yamlEntries: InvariantEntry[] = [];
  if (INVARIANTS_YAML_PATH && fs.existsSync(INVARIANTS_YAML_PATH)) {
    try {
      const content = fs.readFileSync(INVARIANTS_YAML_PATH, 'utf-8');
      yamlEntries = parseInvariantsYaml(content);
      console.log(`  Loaded ${yamlEntries.length} invariants from ${INVARIANTS_YAML_PATH}`);
    } catch (e) {
      console.warn(`  Warning: could not parse ${INVARIANTS_YAML_PATH}: ${e}`);
    }
  } else {
    console.log(
      `  Using inline registry (${INLINE_INVARIANTS.length} invariants) — pass --invariants-yaml for richer claims`
    );
  }

  const registry = buildInvariantRegistry(yamlEntries);

  // Scan test annotations
  const annotations = scanTestAnnotations(TEST_DIR);
  const annotatedCount = [...annotations.bornRedById.values()].flat().length;
  console.log(
    `  Found ${annotatedCount} @born-red annotations across ${annotations.bornRedById.size} unique threat IDs`
  );

  // Build matrix
  const rows = buildMatrix(registry, annotations);
  console.log(
    `  Matrix: ${rows.length} invariants — enforced: ${rows.filter((r) => r.enforcement_status === 'enforced').length}, partial: ${rows.filter((r) => r.enforcement_status === 'partial').length}, gap: ${rows.filter((r) => r.enforcement_status === 'gap').length}, retired: ${rows.filter((r) => r.enforcement_status === 'retired').length}`
  );

  const meta = {
    run_date: RUN_DATE,
    commit: COMMIT_SHA,
    run_url: RUN_URL,
  };

  // Write outputs
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const mdPath = path.join(OUT_DIR, 'CONFORMANCE.md');
  const jsonPath = path.join(OUT_DIR, 'conformance.json');

  fs.writeFileSync(mdPath, renderMarkdown(rows, meta), 'utf-8');
  fs.writeFileSync(jsonPath, renderJson(rows, meta), 'utf-8');

  console.log(`  ✅ Written: ${mdPath}`);
  console.log(`  ✅ Written: ${jsonPath}`);

  // Emit structured evidence log for OSE-564-LEDGER consumers
  const gaps = rows.filter((r) => r.enforcement_status === 'gap');
  if (gaps.length > 0) {
    console.warn(
      `  ⚠️  ${gaps.length} invariant(s) with no enforcement: ${gaps.map((r) => `#${r.invariant.id} ${r.invariant.name}`).join(', ')}`
    );
  }

  console.info(
    `[OSE-560-EVIDENCE] ${JSON.stringify({
      story: 'OSE-560',
      generated_at: RUN_DATE,
      total_invariants: rows.length,
      gaps: gaps.map((r) => r.invariant.id),
    })}`
  );
}

// Main-guard: run the report only when invoked directly as a script, NOT when this
// module is imported by a unit test (which would otherwise trigger the full file-writing
// run). This is what makes the pure functions above importable + testable. OSE-1031.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
