/**
 * @name Cloudflare Worker: Permissive CORS origin
 * @description Using wildcard "*" or ".workers.dev" in CORS origin allows
 *              any origin to make authenticated requests.
 * @kind problem
 * @problem.severity error
 * @security-severity 8.0
 * @precision high
 * @id js/cloudflare-permissive-cors
 * @tags security
 *       cloudflare
 *       external/cwe/cwe-942
 */

import javascript

from Expr e
where
  (
    // Detect Access-Control-Allow-Origin: *
    exists(MethodCallExpr headers |
      headers.getMethodName() = "set" and
      headers.getArgument(0).getStringValue() = "Access-Control-Allow-Origin" and
      headers.getArgument(1).getStringValue() = "*" and
      e = headers
    )
    or
    // Detect origin check using .workers.dev
    exists(MethodCallExpr includes |
      includes.getMethodName() = "includes" and
      includes.getArgument(0).getStringValue() = ".workers.dev" and
      e = includes
    )
  )
select e, "Permissive CORS configuration detected — restrict allowed origins to known domains only."
