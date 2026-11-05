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

    // OSE-1355 / OSE-1518: the registration CTA is the first of the three plain
    // choices. Its href is present on the public page and absent (inert) in the
    // admin draft preview, and it links to the registration form.
    expect(pagesSource).toContain("renderEventChoices(row, formContext, 'pre', lang, preview)");
    expect(pagesSource).toContain(
      `const first = phase === 'pre' ? 'event-rsvp' : 'event-checkin';`
    );
    expect(pagesSource).toContain('data-preview-inert="true" aria-disabled="true"');
    expect(pagesSource).toContain(
      'eventFormHref(row.id, { type, deploymentId: ctx.deploymentId })'
    );
    expect(pagesSource).toContain("const formContext = opts?.formContext ?? { type: 'register' };");
    // The label is in the language catalog; English reads "Register".
    expect(pagesSource).toContain("return msg(lang, 'cta.register');");
    const catalogSource = readFileSync(
      join(__dirname, '../../workers/oursharedevents/src/lib/i18n/catalog.ts'),
      'utf8'
    );
    expect(catalogSource).toContain("'cta.register': 'Register',");
    expect(pagesSource).not.toContain('>RSVP for this event</a>');
    expect(catalogSource).not.toContain('RSVP for this event');
  });
});
