/**
 * @name React: dangerouslySetInnerHTML with unsanitized input
 * @description Using dangerouslySetInnerHTML with data that hasn't been
 *              sanitized by DOMPurify or equivalent enables XSS.
 * @kind problem
 * @problem.severity error
 * @security-severity 8.5
 * @precision high
 * @id js/react-dangerous-innerhtml
 * @tags security
 *       react
 *       external/cwe/cwe-79
 */

import javascript

from PropAccess pa
where
  pa.getPropertyName() = "dangerouslySetInnerHTML"
select pa, "dangerouslySetInnerHTML used — ensure input is sanitized with DOMPurify.sanitize() or equivalent."
