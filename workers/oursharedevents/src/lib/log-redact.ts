/**
 * Log redaction: what every console line the Worker writes passes through.
 *
 * Since 2026-11-28 this lives in the hub package `@ocr/signals` (OCR's shared
 * observability, level 1), so OSE, OW and every other app mask logs the same
 * way. This file keeps OSE's names so existing imports do not change.
 *
 * `installLogRedaction()` wraps the six console levels once, at the top of
 * `src/index.ts`. Nothing has to opt in, and nothing can forget to.
 *
 * Two layers now run on every argument (packages/signals/docs/RULES.md):
 *   1. Credentials, unchanged from OSE's own version: the value under a
 *      credential header name, the same pair written into text, any
 *      `Bearer <value>`, any `eyJ…` run (JWTs and this Worker's signed links).
 *      A `Request` is written as its method, path and masked headers.
 *   2. Personal data, new: values under personal field names (email, name, ip,
 *      anon id, user agent, token, url, query …) and, in strings, email
 *      addresses, IPs, UUIDs and long hex ids, phone-like numbers and URLs.
 *
 * Limits, stated so nobody leans on this for more than it does: a secret with
 * no shape under an ordinary key is not recognised, and a name in a sentence
 * is not either. The source gates (credential-emission, log-redaction) stay
 * the first layer.
 */

import {
  installConsoleRedaction,
  isConsoleRedactionInstalled,
  redact as sharedRedact,
} from '@ocr/signals';

export { REDACTED, CREDENTIAL_HEADERS, isCredentialKey, redactText } from '@ocr/signals';

type ConsoleLike = Parameters<typeof installConsoleRedaction>[0];

/** A copy of `value` with every credential and personal value masked. Never throws, never mutates. */
export function redact(value: unknown): unknown {
  return sharedRedact(value);
}

/**
 * Wrap the six console levels of `target` so every argument is redacted before
 * it is written. Once per console: calling it again does nothing.
 * (credential-emission.invariant.spec.ts reads for this function here.)
 */
export function installLogRedaction(target?: ConsoleLike): void {
  installConsoleRedaction(target);
}

/** True when `target` has been wrapped by installLogRedaction. */
export function isLogRedactionInstalled(target?: ConsoleLike): boolean {
  return isConsoleRedactionInstalled(target);
}
