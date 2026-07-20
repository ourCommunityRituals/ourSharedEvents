// Type declaration for Wrangler [[rules]] type="Text" HTML imports.
// Wrangler bundles *.html files as plain string modules; this tells
// TypeScript to treat them as strings so tsc --noEmit passes.
declare module '*.html' {
  const content: string;
  export default content;
}
