/**
 * TypeScript module declarations for HTML template imports
 *
 * Allows importing HTML files as text strings using wrangler's Text rule.
 *
 * @see Story 4.1 - Move HTML Surfaces to Cloudflare
 * @see wrangler.toml [[rules]] type = "Text"
 */

declare module '*.html' {
  const content: string;
  export default content;
}

declare module '../../templates/*.html' {
  const content: string;
  export default content;
}
