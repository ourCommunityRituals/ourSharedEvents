/**
 * Sponsor asset resolution — pure, zero-I/O core (OSE-734 / T7a).
 *
 * `resolveAssetSource(sponsor, format)` decides WHERE a sponsor's creative for a
 * given format comes from, as a total discriminated union:
 *
 *   { kind: 'r2' }       — a production/derived R2 object exists (sponsors.{format}_url)
 *   { kind: 'proxy' }    — fall back to proxying the sponsor's logo_url
 *   { kind: 'monogram' } — terminal fallback: a generated UEC monogram
 *
 * The monogram branch is TERMINAL and requires no input, so the union is TOTAL:
 * for every one of the four formats the function ALWAYS returns a source and
 * NEVER null/undefined. This is the pure-logic proof of the always-200 guarantee
 * (T7b's route) — it holds even when UPLOADS_BUCKET is unbound (503) and even if
 * the brain UEC palette endpoint is absent (color is an order-12 render concern,
 * not a totality concern). NO I/O, NO hex literal, NO palette read here.
 *
 * The four formats are the single frozen constant shared with migration 0054
 * (CHECK), 0055 (*_url columns), the T6 R2 path segment, and the T7b route enum.
 */

export type AssetFormat = 'poster' | 'banner' | 'vertical' | 'square';

/** The single source of truth for the four render formats. Byte-identical to 0054/0055. */
export const ASSET_FORMATS: readonly AssetFormat[] = ['poster', 'banner', 'vertical', 'square'];

export function isAssetFormat(v: string): v is AssetFormat {
  return (ASSET_FORMATS as readonly string[]).includes(v);
}

/** Discriminated union — the resolution decision. Carries NO size/slot/tier. */
export type AssetSource =
  | { kind: 'r2'; key: string }
  | { kind: 'proxy'; url: string }
  | { kind: 'monogram'; seed: string };

/**
 * Minimal shape resolveAssetSource reads. A full SponsorRow satisfies it; the
 * per-format `*_url` columns are the 0055 additions. Deliberately NO tier /
 * placement / share / weight / rank field — the resolver must have no format
 * dimension to weight by (#25).
 */
export interface AssetResolvable {
  id: string;
  logo_url?: string | null;
  poster_url?: string | null;
  banner_url?: string | null;
  vertical_url?: string | null;
  square_url?: string | null;
}

/**
 * Resolve the asset source for a sponsor + format. Pure and total.
 *
 * COALESCE order (per format):
 *   1. sponsors.{format}_url — an R2 key (override, or the 'derived' render the
 *      promotion path writes). Both live in the same column → one branch.
 *   2. logo_url — proxy the sponsor's logo.
 *   3. monogram — generated UEC monogram (terminal; always available).
 *
 * @throws if `format` is not one of the four frozen formats (programming error,
 *         fail-closed — never silently coerces).
 */
export function resolveAssetSource(sponsor: AssetResolvable, format: AssetFormat): AssetSource {
  if (!isAssetFormat(format)) {
    throw new Error(`resolveAssetSource: invalid format "${String(format)}" (fail-closed)`);
  }

  const formatUrl = sponsor[`${format}_url` as keyof AssetResolvable] as string | null | undefined;
  if (formatUrl) return { kind: 'r2', key: formatUrl };

  if (sponsor.logo_url) return { kind: 'proxy', url: sponsor.logo_url };

  // Terminal branch — deterministic seed (the sponsor id); color is resolved at
  // render time (T7b), never here. This makes the union total → always-200.
  return { kind: 'monogram', seed: sponsor.id };
}
