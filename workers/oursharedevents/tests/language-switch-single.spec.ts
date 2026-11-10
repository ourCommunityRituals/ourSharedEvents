/**
 * The footer switch with one language (OSE-1970, epic OSE-1959): no other
 * language means no switch at all, not an empty landmark. Unreachable with
 * today's four languages, so this file swaps in a one-language list.
 *
 * Its own file: `vi.mock` replaces the languages module for the whole file.
 *
 * Born red: return anything but '' when there is no other language (the
 * Stryker string mutant) and the case fails.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/i18n/languages', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/i18n/languages')>();
  return { ...real, LANGUAGES: ['en'] as const };
});

const { renderLanguageSwitch } = await import('../src/lib/i18n/language-switch');

describe('renderLanguageSwitch | one language', () => {
  it('renders nothing when there is no other language to switch to', () => {
    expect(renderLanguageSwitch({ lang: 'en', path: '/events' })).toBe('');
  });
});
