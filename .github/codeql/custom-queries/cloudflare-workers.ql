/**
 * @name Cloudflare Worker: Unsafe request body consumption
 * @description Consuming request.json() or request.text() without try/catch
 *              can crash the Worker on malformed input.
 * @kind problem
 * @problem.severity warning
 * @security-severity 5.0
 * @precision medium
 * @id js/cloudflare-unsafe-body-parse
 * @tags security
 *       cloudflare
 *       external/cwe/cwe-20
 */

import javascript

from MethodCallExpr call, string methodName
where
  methodName = call.getMethodName() and
  (methodName = "json" or methodName = "text" or methodName = "formData") and
  call.getReceiver().getType().toString().matches("%Request%") and
  not exists(TryStmt ts | ts.getBody() = call.getEnclosingStmt().getParent*())
select call, "Request body parsed via ." + methodName + "() without try/catch — malformed input will crash the Worker."
