/**
 * @name Cloudflare Worker: Math.random() used for security
 * @description Math.random() is not cryptographically secure. Use
 *              crypto.getRandomValues() or crypto.randomUUID() in Workers.
 * @kind problem
 * @problem.severity error
 * @security-severity 7.0
 * @precision high
 * @id js/cloudflare-insecure-random
 * @tags security
 *       cloudflare
 *       cryptography
 *       external/cwe/cwe-338
 */

import javascript

from MethodCallExpr call
where
  call.getMethodName() = "random" and
  call.getReceiver().(PropAccess).getQualifiedName() = "Math.random" or
  (call.getReceiver().toString() = "Math" and call.getMethodName() = "random")
select call, "Math.random() is not cryptographically secure — use crypto.getRandomValues() or crypto.randomUUID() in Cloudflare Workers."
