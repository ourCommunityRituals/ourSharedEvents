/**
 * A sponsor's kind of business (OSE-2207; owner, 2026-11-22, on the decision
 * card: in Create Sponsor the icon slider picks the "kind of business", saved
 * with the sponsor, so attendees can later browse sponsors by kind).
 *
 * STARTER LIST. Twenty kinds a neighborhood sponsor is likely to be. The owner
 * has not ruled on the list itself: it is ours, offered for review, and a kind
 * is added or renamed here (the stored value is the `value`, so a label can
 * change freely; a value never changes once stored).
 *
 * The kind is optional, about the business only (never a person), and public in
 * the same way the sponsor's name is. It is stored in
 * `sponsor_business.business_kind` (migration 0116), checked against this list
 * on every write (lib/business-kinds isBusinessKind, handlers/sponsors.ts).
 *
 * Icons: our own line drawings on a 24 px grid, the same shape as
 * lib/category-slider.ts CATEGORY_ICONS, so the same slider draws them.
 */

import { CATEGORY_ICONS } from './category-slider.js';

export interface BusinessKind {
  /** Stored value. Lower case, never changed once stored. */
  value: string;
  /** What the admin reads under the icon. */
  label: string;
}

export const BUSINESS_KINDS: readonly BusinessKind[] = [
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'bar', label: 'Bar or brewery' },
  { value: 'cafe', label: 'Café or bakery' },
  { value: 'grocery', label: 'Grocery or market' },
  { value: 'retail', label: 'Shop' },
  { value: 'salon', label: 'Salon or barber' },
  { value: 'fitness', label: 'Gym or fitness' },
  { value: 'health', label: 'Health and wellness' },
  { value: 'home_services', label: 'Home repair' },
  { value: 'auto', label: 'Auto repair' },
  { value: 'legal', label: 'Legal services' },
  { value: 'finance', label: 'Bank or insurance' },
  { value: 'real_estate', label: 'Real estate' },
  { value: 'professional', label: 'Professional services' },
  { value: 'entertainment', label: 'Venue or entertainment' },
  { value: 'nonprofit', label: 'Nonprofit or community group' },
  { value: 'faith', label: 'Faith community' },
  { value: 'education', label: 'School or tutoring' },
  { value: 'pets', label: 'Pets and animals' },
  { value: 'other', label: 'Other' },
];

/** One drawing per kind, by value. */
export const BUSINESS_KIND_ICONS: Readonly<Record<string, string>> = {
  restaurant: CATEGORY_ICONS.SOC!,
  // A mug with a head of foam.
  bar: '<path d="M6 7h9v12.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM15 9.5h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2M9 11v6M12 11v6"/><path d="M6 7a2.5 2.5 0 0 1 2.5-3.5A3 3 0 0 1 13 4a2.3 2.3 0 0 1 2 3"/>',
  // A cup with steam.
  cafe: '<path d="M4.5 10h12v4.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM16.5 11.5h1.5a2.25 2.25 0 0 1 0 4.5h-1.8M8 3.5c-.8 1 .8 2 0 3.5M11.5 3.5c-.8 1 .8 2 0 3.5"/>',
  // A basket.
  grocery:
    '<path d="M3.5 9.5h17l-1.8 9.2a1.5 1.5 0 0 1-1.5 1.3H6.8a1.5 1.5 0 0 1-1.5-1.3zM8 9.5 11 4M16 9.5 13 4M9 13v3.5M12 13v3.5M15 13v3.5"/>',
  // A shopping bag.
  retail: '<path d="M5 8h14l-1 12.5H6zM9 10V6.5a3 3 0 0 1 6 0V10"/>',
  // Scissors.
  salon:
    '<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.3 15.7 17 4M15.7 15.7 7 4"/>',
  fitness: CATEGORY_ICONS.FIT!,
  // A heart with a pulse line.
  health:
    '<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/><path d="M7 12h2.5l1.5-2.5 2 4.5 1.5-2h2.5"/>',
  // A house.
  home_services: '<path d="M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5M10 20v-5h4v5"/>',
  // A car.
  auto: '<path d="M4 15.5v-3l2-5a1.5 1.5 0 0 1 1.4-1h9.2a1.5 1.5 0 0 1 1.4 1l2 5v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4.5 12.5h15"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/>',
  // Scales.
  legal: '<path d="M12 4v16M8 20h8M5 7h14M7 7l-3 6a3 3 0 0 0 6 0zM17 7l-3 6a3 3 0 0 0 6 0z"/>',
  // A bank front.
  finance: '<path d="M3.5 9 12 4l8.5 5zM5.5 9v8M9.5 9v8M14.5 9v8M18.5 9v8M3.5 20h17M4.5 17h15"/>',
  // A "for sale" sign on a post.
  real_estate: '<path d="M5 21V4M5 6h13v7H5M9 9.5h5"/>',
  professional: CATEGORY_ICONS.BIZ!,
  // A ticket.
  entertainment:
    '<path d="M3.5 8A1.5 1.5 0 0 0 5 6.5h14A1.5 1.5 0 0 0 20.5 8v2a2 2 0 0 0 0 4v2a1.5 1.5 0 0 0-1.5 1.5H5A1.5 1.5 0 0 0 3.5 16v-2a2 2 0 0 0 0-4z"/><path d="M14 7.5v2M14 11v2M14 14.5v2"/>',
  // Two people.
  nonprofit:
    '<circle cx="9" cy="8" r="3"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.3"/><path d="M15.5 14.2a4.5 4.5 0 0 1 5 4.3"/>',
  faith: CATEGORY_ICONS.FAI!,
  // A graduation cap.
  education:
    '<path d="M2.5 9.5 12 5l9.5 4.5L12 14z"/><path d="M6.5 11.5V16c1.5 1.5 3.5 2.2 5.5 2.2s4-.7 5.5-2.2v-4.5M21.5 9.5v5"/>',
  // A paw print.
  pets: '<circle cx="7" cy="10" r="1.8"/><circle cx="10.5" cy="6.5" r="1.8"/><circle cx="14.5" cy="6.5" r="1.8"/><circle cx="18" cy="10" r="1.8"/><path d="M12 11.5c-2.5 0-5 3.5-5 5.5 0 1.5 1.2 2.5 2.7 2.5 1 0 1.5-.5 2.3-.5s1.3.5 2.3.5c1.5 0 2.7-1 2.7-2.5 0-2-2.5-5.5-5-5.5z"/>',
  other: CATEGORY_ICONS.OTHER!,
};

const VALUES = new Set(BUSINESS_KINDS.map((k) => k.value));

/** True only for a value on the list (exact, case-sensitive). */
export function isBusinessKind(v: unknown): v is string {
  return typeof v === 'string' && VALUES.has(v);
}

/** The label for a stored value, or null for none / an unknown value. */
export function businessKindLabel(v: unknown): string | null {
  return BUSINESS_KINDS.find((k) => k.value === v)?.label ?? null;
}
