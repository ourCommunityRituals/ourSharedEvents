/**
 * OSE-R-008 — single public event page CTA wording.
 *
 * pages.ts imports raw .html templates for Wrangler, so it is intentionally not
 * always node-importable under Vitest. This checks the embedded render snippet
 * directly, like the existing rendered-surface source guards.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('OSE-R-008 — public event page registration CTA copy', () => {
  test('pre-event detail page says Register, not RSVP, when linking to the registration form', () => {
    const pagesSource = readFileSync(
      join(__dirname, '../../workers/oursharedevents/src/handlers/pages.ts'),
      'utf8'
    );

    expect(pagesSource).toContain(
      '<a class="ose-rsvp-btn" data-testid="event-rsvp" href="${esc(eventFormHref(row.id, formContext))}">${eventFormCtaLabel(formContext.type)}</a>'
    );
    expect(pagesSource).toContain("const formContext = opts?.formContext ?? { type: 'register' };");
    expect(pagesSource).toContain("return 'Register for this event';");
    expect(pagesSource).not.toContain('>RSVP for this event</a>');
  });
});
