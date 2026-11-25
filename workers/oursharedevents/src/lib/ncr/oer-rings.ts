/**
 * Ring outlines from ourEventRings that a SharedReport may draw (OSE ADR-041).
 *
 * Empty on purpose. OER's rings today come from practice data, which a report
 * must never show as real; and whether a report may show real ring shapes is
 * the owner's call under OSE ADR-026 rule A (open as of 2026-11-25). When both
 * are settled, a sync fills this list with outlines only: res 7 cells and a
 * size, never a count or a saturation.
 */
import type { RingShape } from './layer-stack';

export const OER_RINGS: readonly RingShape[] = Object.freeze([]);
