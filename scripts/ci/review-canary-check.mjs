#!/usr/bin/env node
/**
 * Review check: scores the PR reviewer against fixtures with known answers.
 *
 * .github/workflows/review-canary.yml asks the reviewer (same action, charter and
 * default model as claude-review.yml) to read the five files in
 * tests/fixtures/review-canary/ and end its answer with one line per bug:
 *   CANARY: <file>:<line>
 * or the single line `CANARY: NONE`.
 *
 * The answers live here, not next to the fixtures. Each case with a bug names a
 * marker: text on the bug's line. The expected line is found in the fixture
 * itself, so editing a fixture cannot silently move the answer. A reported line
 * counts when it is within LINE_SLACK of the marker.
 *
 * Pass: every case with a bug is named, and no correct case is named. Anything
 * else fails, including no answer at all, so a reviewer that did not run can
 * never pass. The score (caught, missed, false alarms) and the run's cost, turns
 * and time go to the step summary, so runs can be compared over time.
 *
 * Usage: node scripts/ci/review-canary-check.mjs <execution-file> [summary-file]
 */
/* eslint-disable security/detect-non-literal-fs-filename -- reads the fixtures here and the action's execution file; writes the step summary */
import { readFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURE_DIR = join(ROOT, 'tests', 'fixtures', 'review-canary');
export const LINE_SLACK = 2;

/** One entry per fixture. `marker` is set only on a case that carries a bug. */
export const CASES = [
  { file: 'case-a.ts.txt', marker: "slug = '${slug}'" }, // query built from a URL parameter
  { file: 'case-b.ts.txt' }, // correct: count goes through publishCount
  { file: 'case-c.ts.txt', marker: 'checkIns: r.n' }, // per-session count published unfloored
  { file: 'case-d.ts.txt', marker: '...row' }, // whole row spread into a public response
  { file: 'case-e.ts.txt' }, // correct: bound query, explicit fields
];

/** 1-based line of `marker` in a fixture's text, or 0 when absent. */
export function markerLine(text, marker) {
  return (
    String(text)
      .split('\n')
      .findIndex((l) => l.includes(marker)) + 1
  );
}

/** Cases with their expected line, read from the fixtures on disk. */
export function loadCases(dir = FIXTURE_DIR) {
  return CASES.map((c) => ({
    ...c,
    line: c.marker ? markerLine(readFileSync(join(dir, c.file), 'utf8'), c.marker) : null,
  }));
}

/** The final answer text: the `result` message, else the last assistant text. */
export function answerText(messages) {
  if (!Array.isArray(messages)) return '';
  const results = messages.filter((m) => m && m.type === 'result' && typeof m.result === 'string');
  if (results.length > 0) return results[results.length - 1].result;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const content = m && m.type === 'assistant' && m.message && m.message.content;
    if (Array.isArray(content)) {
      const text = content
        .filter((c) => c && c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      if (text.trim()) return text;
    }
  }
  return '';
}

/** Parse `CANARY:` lines into { none, hits: [{ file, line }] }. */
export function canaryLines(text) {
  const hits = [];
  let none = false;
  for (const raw of String(text).split('\n')) {
    const m = raw
      .trim()
      .replace(/^[`*\-\s]+|[`*\s]+$/g, '')
      .match(/^CANARY:\s*(.+)$/i);
    if (!m) continue;
    const body = m[1].trim();
    if (/^none$/i.test(body)) {
      none = true;
      continue;
    }
    const at = body.match(/([\w./-]+):(\d+)/);
    if (at) hits.push({ file: at[1].split('/').pop(), line: Number(at[2]) });
  }
  return { none, hits };
}

/** Cost, turns and time from the action's result message, when present. */
export function runStats(messages) {
  const r = Array.isArray(messages) ? messages.filter((m) => m && m.type === 'result').pop() : null;
  if (!r) return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    costUsd: num(r.total_cost_usd),
    turns: num(r.num_turns),
    durationMs: num(r.duration_ms),
  };
}

/**
 * Score one run. Returns { pass, reason, caught, missed, falseAlarms, planted }.
 * `cases` defaults to the fixtures on disk.
 */
export function judge(messages, cases = loadCases()) {
  const planted = cases.filter((c) => c.marker);
  const empty = {
    caught: [],
    missed: planted.map((c) => c.file),
    falseAlarms: [],
    planted: planted.length,
  };
  const text = answerText(messages);
  if (!text.trim())
    return { pass: false, reason: 'the reviewer gave no answer (did it run?)', ...empty };
  const { none, hits } = canaryLines(text);
  if (hits.length === 0 && !none)
    return { pass: false, reason: 'no CANARY line in the answer', ...empty };

  const caught = [];
  const missed = [];
  for (const c of planted) {
    const hit = hits.find((h) => h.file === c.file && Math.abs(h.line - c.line) <= LINE_SLACK);
    (hit ? caught : missed).push(c.file);
  }
  const correct = new Set(cases.filter((c) => !c.marker).map((c) => c.file));
  const falseAlarms = [...new Set(hits.filter((h) => correct.has(h.file)).map((h) => h.file))];

  const pass = missed.length === 0 && falseAlarms.length === 0;
  const parts = [`caught ${caught.length} of ${planted.length}`];
  if (missed.length) parts.push(`missed ${missed.join(', ')}`);
  if (falseAlarms.length) parts.push(`flagged correct ${falseAlarms.join(', ')}`);
  return { pass, reason: parts.join('; '), caught, missed, falseAlarms, planted: planted.length };
}

/** Markdown for the step summary. */
export function summary(verdict, stats) {
  const lines = [`### Review check: ${verdict.pass ? 'pass' : 'FAIL'}`, '', verdict.reason, ''];
  lines.push(
    `| caught | missed | false alarms | cost (USD) | turns | seconds |`,
    `|---|---|---|---|---|---|`,
    `| ${verdict.caught.length}/${verdict.planted} | ${verdict.missed.length} | ${verdict.falseAlarms.length} | ${
      stats?.costUsd ?? 'n/a'
    } | ${stats?.turns ?? 'n/a'} | ${stats?.durationMs != null ? Math.round(stats.durationMs / 1000) : 'n/a'} |`
  );
  return lines.join('\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [file, summaryFile] = process.argv.slice(2);
  let messages = null;
  try {
    messages = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    messages = null;
  }
  const verdict = judge(messages);
  const stats = runStats(messages);
  if (summaryFile) appendFileSync(summaryFile, summary(verdict, stats));
  console.log(`${verdict.pass ? 'PASS' : 'FAIL'}: ${verdict.reason}`);
  process.exit(verdict.pass ? 0 : 1);
}
