/**
 * OSE-578 — AI input sanitization.
 *
 * All user-supplied content (survey responses, free-text fields) MUST pass
 * through sanitizeForAI() before being embedded in any AI model prompt.
 * Applied at read-time only — original data in D1 is never modified.
 *
 * This is defense-in-depth. Primary controls are:
 *   1. Prompt design — user content in data slots, not instruction slots
 *   2. Model-level sandboxing — no tool calls, no output routing
 * Sanitization is the tertiary layer that catches known pattern bypasses.
 *
 * Structural invariant: every code path that passes user data to an AI model
 * must import and call sanitizeForAI(). The L0 structural test asserts this.
 */

/** Patterns that look like instruction injection attempts. */
const INJECTION_PATTERNS: RegExp[] = [
  // Role overrides
  /\b(system|user|assistant)\s*:/gi,
  // Common prompt injection openers
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /forget\s+(everything|all|what)/gi,
  /new\s+(instruction|directive|task|role|persona)/gi,
  // Jailbreak prefixes
  /\[?\s*(DAN|JAILBREAK|OVERRIDE|SUDO|ROOT|ADMIN)\s*\]?\s*:/gi,
  // Tool-call syntax (XML-style and JSON-style)
  /<\s*(function_calls?|tool_use|invoke|tool)\b/gi,
  /\{\s*"(name|function|tool)"\s*:/gi,
  // Prompt boundary markers
  /^(---+|===+|\*\*\*+)\s*$/gm,
  // Encode-then-execute patterns
  /base64\s*decode/gi,
  /eval\s*\(/gi,
];

/**
 * Sanitize a string before embedding it in an AI model prompt.
 *
 * Strips or neutralises known injection patterns. Normal survey text passes
 * through unchanged. The original value in D1 is never touched.
 *
 * @param input - Raw user-supplied text (survey response, free-text field, etc.)
 * @returns Sanitized string safe for use in an AI prompt data slot
 */
export function sanitizeForAI(input: string): string {
  if (!input || typeof input !== 'string') return '';

  let out = input;
  for (const pattern of INJECTION_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

/**
 * Sanitize a parsed JSON value recursively. Strings are sanitized; other
 * primitives pass through; objects and arrays are traversed.
 *
 * Use when passing structured survey responses (responses_json) to an AI model.
 */
export function sanitizeJsonForAI(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeForAI(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonForAI);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeJsonForAI(v);
    }
    return out;
  }
  return value;
}
