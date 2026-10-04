/**
 * The red-story rule itself. A red test layer is only worth having if a broken red
 * test cannot hide, so the three outcomes are pinned here: red for the right reason
 * (ok), already passing (must say promote), failing for another reason (must say broken).
 */
import { describe, it, expect } from 'vitest';
import { assertRed } from './helpers/red-story';

describe('assertRed', () => {
  it('accepts a body that fails on its own tagged assertion', async () => {
    await expect(
      assertRed('OSE-1', async () => {
        expect(1, '[OSE-1] one is two').toBe(2);
      })
    ).resolves.toBeUndefined();
  });

  it('refuses a body that passes, and says to promote it', async () => {
    await expect(assertRed('OSE-1', async () => {})).rejects.toThrow(/now passes: promote/);
  });

  it('refuses a body that fails for another reason', async () => {
    await expect(
      assertRed('OSE-1', async () => {
        throw new TypeError('x is not a function');
      })
    ).rejects.toThrow(/wrong reason/);
  });

  it('refuses a failure tagged with a different story', async () => {
    await expect(
      assertRed('OSE-1', async () => {
        expect(1, '[OSE-2] other').toBe(2);
      })
    ).rejects.toThrow(/wrong reason/);
  });
});
