/**
 * The off-limits list (OSE-2225; OSE ADR-040 decision 12).
 *
 * An organizer may put anything up for a vote: a song, a stall, or an entry
 * they name (a painting, a float, a dish, a business's display). Some things
 * may never be the object of a vote. This module is the one place that says
 * which. `parseVotableLabel` (lib/votes.ts) reads it, and no handler holds a
 * label rule of its own (tests/vote-off-limits.spec.ts checks that).
 *
 * The list starts as the rules already in force before decision 12:
 *
 *   - email   A label holding an email address is refused.
 *   - phone   A label holding a phone number is refused.
 *
 * And one rule that is kept by what is absent, not by a pattern here: a person
 * may be the object only as an opted-in presenter (Q9). OSE has no opt-in yet,
 * so `VOTABLE_KINDS` has no person kind, and a label is the name of a thing.
 * The host's Voting card says so in words: "Name the work, not the person who
 * made it."
 *
 * A rule is added to this list only by a decision recorded in ADR-040.
 */

/** One rule: what it is called, the shape it refuses, and the words a host reads. */
export interface OffLimitsRule {
  /** A short, stable name. Shown nowhere; tests and logs use it. */
  readonly id: string;
  /** True when the label breaks the rule. Reads the folded text (see foldForRules). */
  readonly refuses: (folded: string) => boolean;
  /** Plain words that say which rule refused the label. */
  readonly words: string;
}

// Any decimal digit (\p{Nd}), so fullwidth or Arabic-Indic digits count too.
const EMAIL_SHAPED = /\S@\S/u;
const PHONE_SHAPED = /(?:\p{Nd}[\s().-]*){7,}/u;

/** The off-limits rules, in the order they are checked. */
export const OFF_LIMITS_RULES: readonly OffLimitsRule[] = Object.freeze([
  Object.freeze({
    id: 'email',
    refuses: (folded: string) => EMAIL_SHAPED.test(folded),
    words: 'A label names the thing voted on, so it cannot hold an email address.',
  }),
  Object.freeze({
    id: 'phone',
    refuses: (folded: string) => PHONE_SHAPED.test(folded),
    words: 'A label names the thing voted on, so it cannot hold a phone number.',
  }),
]);

/** The warning under the label box on the Voting card (owner's wording governs). */
export const OFF_LIMITS_WARNING = 'Name the work, not the person who made it.';

/**
 * The text the rules read (OSE-2127 security review): NFKC folds a fullwidth ＠
 * or digit to its plain form, and format characters (\p{Cf}, such as a
 * zero-width space) are dropped, so neither can hide an address or a number.
 * The label is stored as typed; only the rules read this copy.
 */
export function foldForRules(label: string): string {
  return label.normalize('NFKC').replace(/\p{Cf}/gu, '');
}

/** The first rule the label breaks, or null when it breaks none. */
export function offLimitsRuleFor(label: string): OffLimitsRule | null {
  const folded = foldForRules(label);
  for (const rule of OFF_LIMITS_RULES) if (rule.refuses(folded)) return rule;
  return null;
}
