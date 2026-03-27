/**
 * @name Postman: Hardcoded secrets in collection variables
 * @description Postman/Newman collection files should not contain real
 *              API keys, tokens, or passwords. Use environment variables.
 * @kind problem
 * @problem.severity error
 * @security-severity 7.5
 * @precision high
 * @id js/postman-hardcoded-secrets
 * @tags security
 *       postman
 *       external/cwe/cwe-798
 */

import javascript

from JsonValue val, JsonObject parent
where
  parent.getPropValue("key").getStringValue().regexpMatch("(?i).*(key|token|secret|password|auth|admin).*") and
  val = parent.getPropValue("value") and
  val instanceof JsonString and
  not val.getStringValue().regexpMatch("(?i).*(\\{\\{.*\\}\\}|change_me|placeholder|your_.*|xxx|todo|env\\.).*") and
  val.getStringValue().length() > 5 and
  val.getFile().getBaseName().matches("%.postman_collection.json")
select val, "Possible hardcoded secret in Postman collection variable — use {{environment_variable}} placeholders instead."
