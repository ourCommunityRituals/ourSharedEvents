#!/usr/bin/env node
/**
 * A production change names its ticket (AGENTS.md, "Human approval", and the
 * CCR 2026-10-12 finding B5: the ticket rule was text, and nothing refused a
 * production deploy that named none).
 *
 *   node scripts/ci/require-ticket.mjs --input "$TICKET" --tag-message "$TAG_MESSAGE"
 *
 * The ticket is the dispatch input when one was given, otherwise the first
 * Linear id in the annotated tag's message. A value that is not a ticket id,
 * or no value at all, exits 1 with what to do. The id is written to the job
 * summary so the deploy and its ticket are joined in one place.
 */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TICKET = /\b(OSE|OW|OCR)-\d{1,6}\b/;

/** The ticket id a deploy names, or null. Dispatch input first, then the tag message. */
export function ticketFor({ input, tagMessage }) {
  for (const text of [input, tagMessage]) {
    const m = TICKET.exec(String(text ?? ''));
    if (m) return m[0];
  }
  return null;
}

export function explain() {
  return [
    'This production deploy names no ticket.',
    '- Dispatch: set the `ticket` input to the Linear id, e.g. OSE-1511.',
    '- Tag: write the id in the annotated tag message: git tag -a v1.2.3 -m "OSE-1511 first production update".',
    'Every production change has a ticket, with the post-deploy evidence recorded on it (AGENTS.md).',
  ].join('\n');
}

function main(argv) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const found = ticketFor({ input: arg('--input'), tagMessage: arg('--tag-message') });
  if (!found) {
    console.log(`::error::${explain().split('\n')[0]}`);
    console.log(explain());
    return 1;
  }
  console.log(`Production change ticket: ${found}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Production change\n\nTicket: **${found}**\n\n`
    );
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  process.exitCode = main(process.argv.slice(2));
