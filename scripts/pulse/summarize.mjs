#!/usr/bin/env node
// Pulse: turn one `bru run --reporter-json` file into one compact record.
//
//   node scripts/pulse/summarize.mjs <bru-json> <environment> > pulse-<env>.json
//
// The record holds only what a dashboard needs: when, which environment, pass or
// fail per request, and latency. It carries no response bodies, headers, tokens or
// addresses, so it is safe to keep and publish. Read-only by construction: the
// Bruno collections already refuse writes to production (ADR-021).
import { readFileSync } from 'node:fs';

const [, , file, environment] = process.argv;
if (!file || !environment) {
  console.error('usage: summarize.mjs <bru-json> <environment>');
  process.exit(2);
}

const runs = JSON.parse(readFileSync(file, 'utf8'));
const results = (Array.isArray(runs) ? runs : [runs]).flatMap((r) => r.results ?? []);

const requests = results.map((r) => ({
  name: String(r.test?.filename ?? 'unknown').replaceAll(String.fromCharCode(92), '/'),
  ok: r.status === 'pass',
  http: r.response?.status ?? null,
  ms: r.response?.responseTime ?? null,
}));

const times = requests
  .map((r) => r.ms)
  .filter((n) => typeof n === 'number')
  .sort((a, b) => a - b);
const pct = (p) =>
  times.length ? times[Math.min(times.length - 1, Math.floor(p * times.length))] : null;

const record = {
  environment,
  at: new Date().toISOString(),
  ok: requests.length > 0 && requests.every((r) => r.ok),
  requests: requests.length,
  failed: requests.filter((r) => !r.ok).map((r) => r.name),
  p50_ms: pct(0.5),
  p95_ms: pct(0.95),
  max_ms: times.length ? times[times.length - 1] : null,
  detail: requests,
};

process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
// A run with zero requests is a failed pulse, not an empty green one.
if (!record.ok) process.exitCode = 1;
