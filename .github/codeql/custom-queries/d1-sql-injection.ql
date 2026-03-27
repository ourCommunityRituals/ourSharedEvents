/**
 * @name D1 Database: SQL injection via string concatenation
 * @description Building D1 SQL queries with string concatenation or template
 *              literals using user input enables SQL injection. Use prepared
 *              statements with .bind() instead.
 * @kind path-problem
 * @problem.severity error
 * @security-severity 9.8
 * @precision high
 * @id js/d1-sql-injection
 * @tags security
 *       cloudflare
 *       d1
 *       external/cwe/cwe-89
 */

import javascript
import DataFlow::PathGraph

class D1SqlSink extends DataFlow::Node {
  D1SqlSink() {
    exists(MethodCallExpr call |
      // D1 methods: .prepare(), .exec(), .batch()
      (call.getMethodName() = "prepare" or
       call.getMethodName() = "exec" or
       call.getMethodName() = "batch") and
      this = DataFlow::valueNode(call.getArgument(0))
    )
  }
}

class UserInputSource extends DataFlow::Node {
  UserInputSource() {
    // URL parameters
    exists(MethodCallExpr call |
      call.getMethodName() = "get" and
      call.getReceiver().toString().regexpMatch(".*(?:params|searchParams|query).*") and
      this = DataFlow::valueNode(call)
    )
    or
    // Request body
    exists(MethodCallExpr call |
      (call.getMethodName() = "json" or call.getMethodName() = "text") and
      this = DataFlow::valueNode(call)
    )
  }
}

class D1InjectionConfig extends TaintTracking::Configuration {
  D1InjectionConfig() { this = "D1InjectionConfig" }

  override predicate isSource(DataFlow::Node source) {
    source instanceof UserInputSource
  }

  override predicate isSink(DataFlow::Node sink) {
    sink instanceof D1SqlSink
  }
}

from D1InjectionConfig config, DataFlow::PathNode source, DataFlow::PathNode sink
where config.hasFlowPath(source, sink)
select sink.getNode(), source, sink,
  "User input flows into D1 SQL query without parameterization — use .prepare(sql).bind(params) instead."
