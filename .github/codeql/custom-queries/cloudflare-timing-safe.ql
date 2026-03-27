/**
 * @name Cloudflare Worker: Non-timing-safe token comparison
 * @description Comparing secrets/tokens with === is vulnerable to timing
 *              attacks. Use crypto.subtle.timingSafeEqual() instead.
 * @kind problem
 * @problem.severity error
 * @security-severity 7.5
 * @precision medium
 * @id js/cloudflare-timing-unsafe-comparison
 * @tags security
 *       cloudflare
 *       cryptography
 *       external/cwe/cwe-208
 */

import javascript

from EqualityTest eq, DataFlow::Node lhs, DataFlow::Node rhs
where
  eq.getAnOperand() = lhs.asExpr() and
  eq.getAnOperand() = rhs.asExpr() and
  lhs != rhs and
  (
    // One side references a token/secret/key variable
    exists(string name |
      name = lhs.asExpr().(PropAccess).getPropertyName() or
      name = lhs.asExpr().(VarAccess).getName() |
      name.regexpMatch("(?i).*(token|secret|key|password|admin|auth|bearer|hmac).*")
    )
    or
    exists(string name |
      name = rhs.asExpr().(PropAccess).getPropertyName() or
      name = rhs.asExpr().(VarAccess).getName() |
      name.regexpMatch("(?i).*(token|secret|key|password|admin|auth|bearer|hmac).*")
    )
  )
select eq, "Token/secret compared with === instead of crypto.subtle.timingSafeEqual() — vulnerable to timing attacks."
