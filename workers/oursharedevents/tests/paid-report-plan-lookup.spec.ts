/**
 * OSE-682 — the plan lookup behind the SharedReport depth cap fails CLOSED.
 *
 * `isFeatureEnabled` fails open (an unreadable flag table reads as every flag
 * on), which is right for "pre-migration, keep features working" but wrong for
 * an entitlement: an unreadable forms database would hand a Free event the paid
 * report. `isPaidReportEnabled` reads the same flag with the same precedence
 * (event override, then global, then the contract default for no row) and reads
 * an error as "not paid", so the report falls back to Local.
 *
 * Runs in the node project: a fake D1 stands in, no runtime bound.
 *
 * @born-red OSE-682 | method: swap-to-fail-open | verified: making
 *   isPaidReportEnabled's catch return true turns "a database error reads as
 *   not paid" red.
 */
import { describe, it, expect } from 'vitest';
import { isPaidReportEnabled } from '../src/lib/feature-flags';

type Row = { scope: 'event' | 'global'; scope_id: string; enabled: 0 | 1 };

/** A D1 stand-in that answers the adapter's two flag queries from `rows`. */
function fakeDb(rows: Row[]): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              const isEvent = sql.includes("scope = 'event'");
              const hit = rows.find((r) =>
                isEvent
                  ? r.scope === 'event' && r.scope_id === args[1]
                  : r.scope === 'global' && r.scope_id === ''
              );
              return hit ? { enabled: hit.enabled } : null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function brokenDb(): D1Database {
  return {
    prepare() {
      throw new Error('D1_ERROR: no such table: feature_flags');
    },
  } as unknown as D1Database;
}

describe('OSE-682 | isPaidReportEnabled: the paid-report plan lookup fails closed', () => {
  it('a database error reads as not paid (Local), never as paid', async () => {
    expect(await isPaidReportEnabled(brokenDb(), 'evt_1')).toBe(false);
  });

  it('global off (the Free preset) → not paid', async () => {
    expect(
      await isPaidReportEnabled(fakeDb([{ scope: 'global', scope_id: '', enabled: 0 }]), 'evt_1')
    ).toBe(false);
  });

  it('global on (Mid and up) → paid', async () => {
    expect(
      await isPaidReportEnabled(fakeDb([{ scope: 'global', scope_id: '', enabled: 1 }]), 'evt_1')
    ).toBe(true);
  });

  it('an event override wins over global, both ways', async () => {
    const onForOne = fakeDb([
      { scope: 'global', scope_id: '', enabled: 0 },
      { scope: 'event', scope_id: 'evt_1', enabled: 1 },
    ]);
    expect(await isPaidReportEnabled(onForOne, 'evt_1')).toBe(true);
    expect(await isPaidReportEnabled(onForOne, 'evt_2')).toBe(false);
    const offForOne = fakeDb([
      { scope: 'global', scope_id: '', enabled: 1 },
      { scope: 'event', scope_id: 'evt_1', enabled: 0 },
    ]);
    expect(await isPaidReportEnabled(offForOne, 'evt_1')).toBe(false);
  });

  it('no row at all keeps the flags-contract default (on)', async () => {
    expect(await isPaidReportEnabled(fakeDb([]), 'evt_1')).toBe(true);
  });
});
