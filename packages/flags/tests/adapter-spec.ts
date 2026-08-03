import { describe, expect, it, beforeEach } from 'vitest';
import type { StorageAdapter } from '../src/types.js';
import {
  isFeatureEnabled,
  resolveFlags,
  applyTier,
  ALL_FLAG_KEYS,
  TIER_PRESETS,
} from '../src/index.js';

// Every adapter MUST pass this suite. It is the quality gate — shipping a
// new adapter means making this spec green. Contract conformance lives here.
export function runAdapterSpec(adapterName: string, makeAdapter: () => StorageAdapter): void {
  describe(`StorageAdapter contract: ${adapterName}`, () => {
    let adapter: StorageAdapter;

    beforeEach(() => {
      adapter = makeAdapter();
    });

    describe('identity', () => {
      it('exposes a non-empty id', () => {
        expect(adapter.id).toBeTruthy();
        expect(typeof adapter.id).toBe('string');
      });
    });

    describe('scope precedence (event -> global -> default ON)', () => {
      it('returns default ON when no row exists', async () => {
        expect(await isFeatureEnabled(adapter, 'forms.register')).toBe(true);
      });

      it('returns global value when global row exists and no event row', async () => {
        await adapter.setFlag('forms.register', false, 'global', '');
        expect(await isFeatureEnabled(adapter, 'forms.register')).toBe(false);
      });

      it('event row overrides global row when eventId provided', async () => {
        await adapter.setFlag('forms.register', false, 'global', '');
        await adapter.setFlag('forms.register', true, 'event', 'evt_1');
        expect(await isFeatureEnabled(adapter, 'forms.register', 'evt_1')).toBe(true);
      });

      it('event row does not leak across eventIds (tenant isolation)', async () => {
        await adapter.setFlag('forms.register', false, 'event', 'evt_A');
        expect(await isFeatureEnabled(adapter, 'forms.register', 'evt_B')).toBe(true);
      });
    });

    describe('setFlag + removeEventFlag', () => {
      it('upserts the same (scope, scope_id, flag_key) tuple without duplicates', async () => {
        await adapter.setFlag('forms.register', false, 'global', '');
        await adapter.setFlag('forms.register', true, 'global', '');
        const rows = await adapter.listFlags({ scope: 'global' });
        const matching = rows.filter((r) => r.flag_key === 'forms.register');
        expect(matching).toHaveLength(1);
        expect(matching[0]!.enabled).toBe(true);
      });

      it('removeEventFlag returns true when a row was removed, false otherwise', async () => {
        await adapter.setFlag('forms.register', true, 'event', 'evt_1');
        expect(await adapter.removeEventFlag('evt_1', 'forms.register')).toBe(true);
        expect(await adapter.removeEventFlag('evt_1', 'forms.register')).toBe(false);
      });

      it('removing event row reverts to global value', async () => {
        await adapter.setFlag('forms.register', false, 'global', '');
        await adapter.setFlag('forms.register', true, 'event', 'evt_1');
        await adapter.removeEventFlag('evt_1', 'forms.register');
        expect(await isFeatureEnabled(adapter, 'forms.register', 'evt_1')).toBe(false);
      });
    });

    describe('resolveAll / resolveFlags', () => {
      it('returns every contract flag key in resolveFlags with defaults when store is empty', async () => {
        const resolved = await resolveFlags(adapter);
        for (const k of ALL_FLAG_KEYS) expect(resolved[k]).toBe(true);
      });

      it('resolveAll returns a Map covering only present rows', async () => {
        await adapter.setFlag('forms.register', false, 'global', '');
        const map = await adapter.resolveAll();
        expect(map.get('forms.register')).toBe(false);
        expect(map.has('forms.checkin')).toBe(false);
      });

      it('resolveFlags applies event -> global -> default precedence', async () => {
        await adapter.setFlag('forms.register', false, 'global', '');
        await adapter.setFlag('forms.register', true, 'event', 'evt_1');
        await adapter.setFlag('forms.checkin', false, 'global', '');
        const resolved = await resolveFlags(adapter, 'evt_1');
        expect(resolved['forms.register']).toBe(true);
        expect(resolved['forms.checkin']).toBe(false);
        expect(resolved['forms.survey']).toBe(true);
      });
    });

    describe('batchApplyTier', () => {
      it('seeds all global flags for the selected tier', async () => {
        const { applied } = await applyTier(adapter, 'free');
        expect(applied).toBe(ALL_FLAG_KEYS.length);
        const resolved = await resolveFlags(adapter);
        for (const k of ALL_FLAG_KEYS) {
          expect(resolved[k]).toBe(TIER_PRESETS.free[k]);
        }
      });

      it('applyTier does not touch event-scoped overrides', async () => {
        await adapter.setFlag('branding.white-label', true, 'event', 'evt_1');
        await applyTier(adapter, 'free'); // free has branding.white-label=false globally
        expect(await isFeatureEnabled(adapter, 'branding.white-label', 'evt_1')).toBe(true);
      });

      it('applyTier is idempotent', async () => {
        await applyTier(adapter, 'mid');
        const first = await resolveFlags(adapter);
        await applyTier(adapter, 'mid');
        const second = await resolveFlags(adapter);
        expect(second).toEqual(first);
      });
    });

    describe('listFlags', () => {
      it('returns rows stable-sorted by (flag_key, scope, scope_id)', async () => {
        await adapter.setFlag('forms.register', true, 'global', '');
        await adapter.setFlag('forms.checkin', true, 'global', '');
        await adapter.setFlag('forms.register', false, 'event', 'evt_1');
        const rows = await adapter.listFlags();
        const keys = rows.map((r) => r.flag_key);
        const sorted = [...keys].sort();
        expect(keys).toEqual(sorted);
      });

      it('scope filter restricts results', async () => {
        await adapter.setFlag('forms.register', true, 'global', '');
        await adapter.setFlag('forms.register', false, 'event', 'evt_1');
        const globals = await adapter.listFlags({ scope: 'global' });
        expect(globals.every((r) => r.scope === 'global')).toBe(true);
        const events = await adapter.listFlags({ scope: 'event', eventId: 'evt_1' });
        expect(events.every((r) => r.scope === 'event' && r.scope_id === 'evt_1')).toBe(true);
      });
    });

    describe('value type constraint (security)', () => {
      it('adapter stores and returns booleans only (no truthy/falsy coercion)', async () => {
        await adapter.setFlag('forms.register', true, 'global', '');
        const row = (await adapter.listFlags({ scope: 'global' }))[0]!;
        expect(typeof row.enabled).toBe('boolean');
        expect(row.enabled).toBe(true);
      });
    });
  });
}
