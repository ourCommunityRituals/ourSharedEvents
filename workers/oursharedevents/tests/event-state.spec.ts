/**
 * OSE-199 / BE-12 — Event State Machine tests
 *
 * L1: static shape checks (exports, constant values)
 * L2: unit tests for isValidTransition, assertRenderable, parseEventState
 */

import { describe, it, expect } from 'vitest';
import {
  VALID_EVENT_STATES,
  VALID_TRANSITIONS,
  RENDERABLE_SURFACES,
  isValidEventState,
  isValidTransition,
  getAllowedTransitions,
  assertRenderable,
  canRender,
  parseEventState,
  resolveEventStateInfo,
} from '../src/domain/event-state';
import type { EventState, RenderSurface } from '../src/domain/event-state';

// ── L1: Static shape ──────────────────────────────────────────────────────────

describe('EventState — L1 static', () => {
  it('exports the four canonical states', () => {
    expect(VALID_EVENT_STATES).toEqual(['draft', 'ready', 'active', 'archived']);
  });

  it('RENDERABLE_SURFACES: only active renders on public/display/poster', () => {
    for (const state of VALID_EVENT_STATES) {
      const surfaces = RENDERABLE_SURFACES[state];
      if (state === 'active') {
        expect(surfaces).toContain('public');
        expect(surfaces).toContain('display');
        expect(surfaces).toContain('poster');
        expect(surfaces).toContain('admin');
        expect(surfaces).toContain('report');
      } else {
        expect(surfaces).not.toContain('public');
        expect(surfaces).not.toContain('display');
        expect(surfaces).not.toContain('poster');
        expect(surfaces).toContain('admin');
      }
    }
  });

  it('VALID_TRANSITIONS covers all four states', () => {
    for (const state of VALID_EVENT_STATES) {
      expect(Array.isArray(VALID_TRANSITIONS[state])).toBe(true);
    }
  });
});

// ── L2: isValidEventState ────────────────────────────────────────────────────

describe('isValidEventState', () => {
  it.each(VALID_EVENT_STATES as EventState[])('accepts %s', (s) => {
    expect(isValidEventState(s)).toBe(true);
  });

  it.each(['live', 'pending', '', 'ACTIVE', null, undefined, 42])('rejects %s', (s) => {
    expect(isValidEventState(s)).toBe(false);
  });
});

// ── L2: isValidTransition ────────────────────────────────────────────────────

describe('isValidTransition', () => {
  const cases: [EventState, EventState, boolean][] = [
    // draft
    ['draft', 'ready', true],
    ['draft', 'archived', true],
    ['draft', 'active', false],
    ['draft', 'draft', false],
    // ready
    ['ready', 'active', true],
    ['ready', 'draft', true],
    ['ready', 'archived', true],
    ['ready', 'ready', false],
    // active
    ['active', 'archived', true],
    ['active', 'ready', true],
    ['active', 'draft', false],
    ['active', 'active', false],
    // archived
    ['archived', 'active', true],
    ['archived', 'draft', true],
    ['archived', 'archived', false],
    ['archived', 'ready', false],
  ];

  it.each(cases)('%s → %s should be %s', (from, to, expected) => {
    expect(isValidTransition(from, to)).toBe(expected);
  });
});

// ── L2: getAllowedTransitions ─────────────────────────────────────────────────

describe('getAllowedTransitions', () => {
  it('draft → ready | archived', () => {
    expect(getAllowedTransitions('draft')).toEqual(['ready', 'archived']);
  });

  it('ready → active | draft | archived', () => {
    expect(getAllowedTransitions('ready')).toEqual(['active', 'draft', 'archived']);
  });

  it('active → archived | ready', () => {
    expect(getAllowedTransitions('active')).toEqual(['archived', 'ready']);
  });

  it('archived → active | draft', () => {
    expect(getAllowedTransitions('archived')).toEqual(['active', 'draft']);
  });
});

// ── L2: assertRenderable / canRender ─────────────────────────────────────────

describe('assertRenderable', () => {
  const publicSurfaces: RenderSurface[] = ['public', 'display', 'poster', 'report'];

  it.each(publicSurfaces)('active events render on %s', (surface) => {
    expect(assertRenderable('active', surface).allowed).toBe(true);
    expect(canRender('active', surface)).toBe(true);
  });

  it.each(['draft', 'ready', 'archived'] as EventState[])(
    '%s events blocked on public surface',
    (state) => {
      const result = assertRenderable(state, 'public');
      expect(result.allowed).toBe(false);
      expect(typeof result.reason).toBe('string');
      expect(result.reason!.length).toBeGreaterThan(0);
    }
  );

  it.each(['draft', 'ready', 'archived'] as EventState[])(
    '%s events blocked on poster surface',
    (state) => {
      expect(assertRenderable(state, 'poster').allowed).toBe(false);
    }
  );

  it.each(VALID_EVENT_STATES as EventState[])('all states render on admin surface', (state) => {
    expect(assertRenderable(state, 'admin').allowed).toBe(true);
  });
});

// ── L2: parseEventState ──────────────────────────────────────────────────────

describe('parseEventState', () => {
  it.each(VALID_EVENT_STATES as EventState[])('parses valid state %s', (s) => {
    expect(parseEventState(s)).toBe(s);
  });

  it('normalises uppercase to valid state', () => {
    expect(parseEventState('ACTIVE')).toBe('active');
    expect(parseEventState('DRAFT')).toBe('draft');
  });

  it('defaults unknown strings to draft', () => {
    expect(parseEventState('live')).toBe('draft');
    expect(parseEventState('pending')).toBe('draft');
  });

  it('defaults null/undefined to draft', () => {
    expect(parseEventState(null)).toBe('draft');
    expect(parseEventState(undefined)).toBe('draft');
  });

  it('trims whitespace', () => {
    expect(parseEventState('  active  ')).toBe('active');
  });
});

// ── L2: resolveEventStateInfo ────────────────────────────────────────────────

describe('resolveEventStateInfo', () => {
  it('active event is renderable', () => {
    const info = resolveEventStateInfo('active');
    expect(info.state).toBe('active');
    expect(info.isRenderable).toBe(true);
    expect(info.label).toBe('Active');
  });

  it('draft event is not renderable', () => {
    const info = resolveEventStateInfo('draft');
    expect(info.state).toBe('draft');
    expect(info.isRenderable).toBe(false);
  });

  it('ready event is not renderable on public', () => {
    const info = resolveEventStateInfo('ready');
    expect(info.isRenderable).toBe(false);
    expect(info.label).toBe('Ready for Verification');
  });
});
