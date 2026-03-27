/**
 * @name Wrangler: Secret value logged or exposed
 * @description Environment secrets (ADMIN_TOKEN, HMAC_SECRET, private keys)
 *              must never be logged, returned in responses, or assigned to
 *              non-secret variables.
 * @kind problem
 * @problem.severity error
 * @security-severity 8.0
 * @precision medium
 * @id js/wrangler-secret-exposure
 * @tags security
 *       cloudflare
 *       wrangler
 *       external/cwe/cwe-532
 */

import javascript

from MethodCallExpr call, DataFlow::Node secretAccess
where
  // Detect console.log/warn/error/debug with secret values
  (call.getMethodName() = "log" or
   call.getMethodName() = "warn" or
   call.getMethodName() = "error" or
   call.getMethodName() = "debug" or
   call.getMethodName() = "info") and
  call.getReceiver().toString() = "console" and
  secretAccess = DataFlow::valueNode(call.getAnArgument()) and
  exists(PropAccess envAccess |
    envAccess = secretAccess.asExpr().getAChildExpr*() and
    envAccess.getPropertyName().regexpMatch("(?i).*(TOKEN|SECRET|KEY|PASSWORD|PRIVATE|HMAC|PEM|CREDENTIAL).*")
  )
select call, "Secret value may be exposed in console output — remove logging of sensitive environment variables."
