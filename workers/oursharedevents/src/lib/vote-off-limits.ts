/**
 * The off-limits list: what a vote label may never hold (OSE-2225, step 5 of
 * OSE-2222; OSE ADR-040 decision 12).
 *
 * An organizer may put anything up for a vote (owner, 2026-11-24: "it is what
 * ever the event organizer sets up to be voted on"). The owner also said: "We
 * may have to designate certain items are off limits." This file is that list,
 * and the only place a label rule lives. `parseVotableLabel` (lib/votes.ts)
 * asks it, and nothing else does. A T0 rule
 * (tests/e2e/0-architecture/votes-never-who.invariant.spec.ts, "off limits")
 * fails when a label rule's pattern appears in any other vote file, the admin
 * Voting card included.
 *
 * THE RULES TODAY (moved here unchanged from lib/votes.ts):
 *   - email: a label holding an email address is refused.
 *   - phone: a label holding a phone number is refused.
 * A contact detail is a person's; a label names a thing. The same shapes a
 * booth name refuses (lib/event-booths.ts).
 *
 * The other off-limits item in decision 12, "a person may be the object only
 * if they opted in as a presenter" (Q9), is held by the kind list
 * (VOTABLE_KINDS in lib/votes.ts has no person kind), not by a label rule.
 *
 * ADDING A RULE. A rule is added only by a decision recorded in ADR-040
 * (decision 12). Each rule names that decision in `decided`. Add it here, with
 * its plain words for the refusal, and a case in tests/vote-tables.spec.ts.
 */

/** One rule: a shape a label may never hold. */
export interface OffLimitsRule {
  /** A short, stable id. The admin answer carries it as `rule`. */
  readonly id: OffLimitsRuleId;
  /** What the label held, in plain words, for the refusal. */
  readonly words: string;
  /** The recorded decision that put the rule on the list. */
  readonly decided: string;
  /** True when the label, as the check reads it, holds the shape. */
  readonly matches: (text: string) => boolean;
}

export type OffLimitsRuleId = 'email' | 'phone';

const EMAIL_SHAPED = /\S@\S/u;
// Any decimal digit (\p{Nd}), so fullwidth or Arabic-Indic digits count too.
const PHONE_SHAPED = /(?:\p{Nd}[\s().-]*){7,}/u;

/** The list. Order is the order a label is checked in. */
export const OFF_LIMITS_RULES: readonly OffLimitsRule[] = [
  {
    id: 'email',
    words: 'an email address',
    decided: 'ADR-040 decision 2 (labels refuse email-shaped text), kept by decision 12',
    matches: (text) => EMAIL_SHAPED.test(text),
  },
  {
    id: 'phone',
    words: 'a phone number',
    decided: 'ADR-040 decision 2 (labels refuse phone-shaped text), kept by decision 12',
    matches: (text) => PHONE_SHAPED.test(text),
  },
];

/**
 * The text the rules read (OSE-2127 security review): NFKC folds a fullwidth
 * ＠ or digit to its plain form, and format characters (\p{Cf}, such as a
 * zero-width space) are dropped, so neither can hide an address or a number.
 * The label is stored as typed; only the check reads this copy.
 */
export function offLimitsText(label: string): string {
  return label.normalize('NFKC').replace(/\p{Cf}/gu, '');
}

/** The first rule the label breaks, or null when it is on no rule. */
export function offLimitsRuleFor(label: string): OffLimitsRule | null {
  const text = offLimitsText(label);
  return OFF_LIMITS_RULES.find((rule) => rule.matches(text)) ?? null;
}

/** The refusal, in plain words, naming the rule that refused the label. */
export function offLimitsRefusal(rule: OffLimitsRule): string {
  return `A name to vote on cannot hold ${rule.words}; that is off limits. Name the work, not the person who made it.`;
}
