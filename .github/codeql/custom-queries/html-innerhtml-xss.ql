/**
 * @name HTML surface: innerHTML with dynamic content
 * @description Setting innerHTML with dynamic data in HTML surface templates
 *              (admin.html, public.html, etc.) enables XSS attacks.
 *              Use textContent or DOM APIs instead.
 * @kind problem
 * @problem.severity error
 * @security-severity 8.0
 * @precision high
 * @id js/html-surface-innerhtml-xss
 * @tags security
 *       html
 *       external/cwe/cwe-79
 */

import javascript

from PropWrite pw
where
  pw.getPropertyName() = "innerHTML" and
  // Flag when the RHS is not a string literal (i.e., it's dynamic)
  not pw.getRhs() instanceof StringLiteral
select pw, "innerHTML set with dynamic content — use textContent or sanitize input to prevent XSS."
