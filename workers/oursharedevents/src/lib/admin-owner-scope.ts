/**
 * OSE-1561 — the OWNER rule inside the platform's public brand (OSE ADR-022,
 * decision 2a; owner decisions 2026-11-18).
 *
 * THE GAP THIS CLOSES. "No brand" is stored as one shared brand, `root`
 * (PUBLIC_BRAND_ID). Every organizer without a brand of their own is a member of
 * it, so the brand wall (admin-brand-scope.ts, admin-object-scope.ts) cannot keep
 * two of them apart: organizer A could list, read and rename organizer B's
 * events, sponsors and campaigns, and reach B's registrations.
 *
 * THE RULE. Inside `root`, the row's creator is the boundary:
 *
 *   own rows     every member of `root` except its brand owner: `organizer`,
 *                `staff`, `sponsor_manager`, a role this code does not know, and
 *                a member with no recorded role (the interim env map carries
 *                none). They reach a `root` row only when its `created_by` is
 *                their own server-verified identity. A row with no creator
 *                matches nobody.
 *   brand owner  the `brand_owner` of `root` reaches `root` rows as before
 *                (support), EXCEPT form data: the forms reads and the export
 *                are the creator's alone.
 *   none         the caller is not a scoped member of `root`. Nothing here
 *                applies: a brand of its own keeps the brand as its whole
 *                boundary, and the automation scope 'all' (a `key:` actor with
 *                ADMIN_SCOPE_ALL, absent in production) is unchanged.
 *
 * NOT THE SAME BRAND AS PLATFORM_BRAND_ID. `ose-platform` is the reserved brand
 * for platform-owned data (AUD-3). `root` is the public brand free organizers
 * share. This module is about `root` only.
 *
 * IT ONLY EVER NARROWS. The brand wall is not rewritten: every brand predicate
 * stays where it was, character for character, and this module adds one more
 * bound condition beside it (ownerPredicate). A caller can lose rows to this
 * rule; nobody can gain one. It is one bound SQL predicate, never a filter over
 * fetched rows and never a value a client supplied.
 *
 * FAIL-CLOSED. A role is read from admin_brand_memberships only. No row, an
 * unknown role or a failed read all resolve to 'own-rows', never to brand owner.
 */

import { extractAdminActor, type AdminEnv } from '../auth/admin';
import {
  PUBLIC_BRAND_ID,
  resolveAdminBrandScopeAsync,
  resolveAdminRoles,
  type AdminBrandScope,
  type AdminBrandScopeEnv,
} from './admin-brand-scope';

export type AdminOwnerScopeEnv = AdminEnv & AdminBrandScopeEnv;

/** Where a caller stands in the public brand. */
export type PublicBrandStanding = 'none' | 'brand-owner' | 'own-rows';

export interface OwnerRule {
  standing: PublicBrandStanding;
  /** The server-verified actor id; the only value an owner predicate binds. */
  actor: string;
}

const NO_RULE: OwnerRule = { standing: 'none', actor: '' };

/**
 * The owner rule for this request's caller. Pass the brand scope when the caller
 * has already resolved it (it is not read twice); otherwise it is resolved here.
 */
export async function resolveOwnerRule(
  request: Request,
  env: AdminOwnerScopeEnv,
  resolved?: AdminBrandScope
): Promise<OwnerRule> {
  const actor = extractAdminActor(request, env);
  const scope = resolved ?? (await resolveAdminBrandScopeAsync(actor, env));
  // 'all' is automation and 'deny' reaches nothing; neither is a member of `root`.
  if (scope.mode !== 'scoped' || !scope.brandIds.includes(PUBLIC_BRAND_ID)) return NO_RULE;
  const roles = await resolveAdminRoles(actor, env);
  const isBrandOwner = roles.some((r) => r.brandId === PUBLIC_BRAND_ID && r.role === 'brand_owner');
  // A scoped scope is only ever built for a verified actor (admin-brand-scope.ts).
  return { standing: isBrandOwner ? 'brand-owner' : 'own-rows', actor: actor as string };
}

export interface OwnerPredicateOptions {
  /**
   * The row is form data (registrations, check-ins, surveys, sign-ups, the
   * export). In the public brand it is the creator's alone, the brand owner
   * included.
   */
  formsData?: boolean;
}

/** Is this caller held to the rows they created in the public brand? */
export function ownRowsOnly(rule: OwnerRule, opts: OwnerPredicateOptions = {}): boolean {
  if (rule.standing === 'own-rows') return true;
  return rule.standing === 'brand-owner' && opts.formsData === true;
}

/**
 * The extra bound condition for a table that carries a brand column and a
 * creator column (or is joined to one that does), or null when the rule does not
 * apply to this caller:
 *
 *   (<brandCol> <> 'root' OR <creatorCol> = <actor>)
 *
 * It goes BESIDE the brand predicate with AND, never in place of it. Outside the
 * public brand it is always true. Inside it, only the creator's rows pass; a
 * NULL creator never equals the bound actor, so a row nobody created passes for
 * no one. `brandCol` and `creatorCol` are column names written by the caller's
 * own code, never request input.
 */
export function ownerPredicate(
  rule: OwnerRule,
  brandCol: string,
  creatorCol: string,
  opts: OwnerPredicateOptions = {}
): { sql: string; binds: string[] } | null {
  if (!ownRowsOnly(rule, opts)) return null;
  return {
    sql: `(${brandCol} <> ? OR ${creatorCol} = ?)`,
    binds: [PUBLIC_BRAND_ID, rule.actor],
  };
}

/** The same condition as ` AND (…)`, or an empty string when it does not apply. */
export function ownerAndSql(
  rule: OwnerRule,
  brandCol: string,
  creatorCol: string,
  opts: OwnerPredicateOptions = {}
): { sql: string; binds: string[] } {
  const p = ownerPredicate(rule, brandCol, creatorCol, opts);
  return p ? { sql: ` AND ${p.sql}`, binds: p.binds } : { sql: '', binds: [] };
}

/**
 * Of `brandIds`, the brands this caller may read as a WHOLE brand: all of them,
 * minus the public brand for a caller held to their own rows. For reads that sum
 * a brand and have no per-row creator condition (the brand dashboards).
 */
export function wholeBrandIds(rule: OwnerRule, brandIds: readonly string[]): string[] {
  return rule.standing === 'own-rows'
    ? brandIds.filter((b) => b !== PUBLIC_BRAND_ID)
    : [...brandIds];
}
