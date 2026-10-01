/**
 * @name Cloudflare Worker: Debug endpoints enabled
 * @description ENABLE_DEBUG_ENDPOINTS should never be "true" in production
 *              wrangler configuration or environment variables.
 * @kind problem
 * @problem.severity error
 * @security-severity 7.0
 * @precision high
 * @id js/cloudflare-debug-endpoints-enabled
 * @tags security
 *       cloudflare
 *       external/cwe/cwe-489
 */

import javascript

from
  DataFlow::PropWrite pw
where
  pw.getPropertyName().regexpMatch("(?i).*debug.*endpoint.*|.*enable.*debug.*") and
  pw.getRhs().getStringValue() = "true"
select pw, "Debug endpoints are enabled — ensure this is not deployed to production."
