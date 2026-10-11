/**
 * @vitest-environment jsdom
 */
import { describe, expect, test } from 'vitest';
import { handleFormPage } from '../../workers/oursharedevents/src/handlers/form-pages';

describe('OSE-R-009 — form privacy notice disclosure', () => {
  test('registration form leads with plain-English retention copy and collapses legal details', async () => {
    const response = await handleFormPage(
      new Request('https://stg.oursharedevents.com/forms/evt_privacy?type=register'),
      {},
      'evt_privacy'
    );
    const html = await response.text();
    const root = document.createElement('div');
    root.innerHTML = html;

    const notice = root.querySelector('[data-testid="privacy-notice"]');
    const summary = root.querySelector('[data-testid="privacy-summary"]');
    const details = root.querySelector('[data-testid="privacy-details"]');
    const detailsSummary = details?.querySelector('summary');

    expect(notice).not.toBeNull();
    // Owner 2026-10-11: what the code does, the night after the day after the event.
    expect(summary?.textContent).toBe('Your name and email are cleared the day after the event.');
    expect(detailsSummary?.textContent).toBe('Privacy details');
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.textContent).toContain('GDPR Art. 6(1)(a)');
    expect(
      details?.querySelector('[data-testid="privacy-policy-link"]')?.getAttribute('href')
    ).toBe('/privacy');
  });
});
