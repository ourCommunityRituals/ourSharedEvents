/**
 * @name Playwright: Credentials in test source
 * @description Playwright test files should not contain hardcoded credentials,
 *              API keys, or bearer tokens. Use environment variables.
 * @kind problem
 * @problem.severity warning
 * @security-severity 5.0
 * @precision medium
 * @id js/playwright-hardcoded-credentials
 * @tags security
 *       playwright
 *       external/cwe/cwe-798
 */

import javascript

from StringLiteral str
where
  str.getFile().getRelativePath().matches("%tests%") and
  (str.getFile().getRelativePath().matches("%.spec.ts") or
   str.getFile().getRelativePath().matches("%.spec.js") or
   str.getFile().getRelativePath().matches("%.test.ts") or
   str.getFile().getRelativePath().matches("%.test.js")) and
  str.getValue().regexpMatch("(?i)(Bearer\\s+[a-zA-Z0-9._\\-]{20,}|sk_live_[a-zA-Z0-9]+|AKIA[0-9A-Z]{16}|eyJ[a-zA-Z0-9._\\-]{50,})")
select str, "Possible hardcoded credential in test file — use process.env or Playwright fixtures."
