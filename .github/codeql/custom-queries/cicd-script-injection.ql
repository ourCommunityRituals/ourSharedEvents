/**
 * @name CI/CD: GitHub Actions script injection
 * @description Using ${{ }} expressions directly in run: blocks enables
 *              script injection from PR titles, branch names, etc.
 *              Use environment variables instead.
 * @kind problem
 * @problem.severity error
 * @security-severity 9.0
 * @precision high
 * @id js/github-actions-script-injection
 * @tags security
 *       cicd
 *       github-actions
 *       external/cwe/cwe-78
 */

import javascript

/*
 * Note: CodeQL's JavaScript extractor does not natively parse YAML workflow
 * files. This query documents the pattern for awareness. The actual check
 * is performed by the shell-based scan in the workflow below.
 *
 * Dangerous patterns in GitHub Actions:
 *   run: echo "${{ github.event.pull_request.title }}"
 *   run: echo "${{ github.event.issue.body }}"
 *   run: echo "${{ github.event.comment.body }}"
 *   run: echo "${{ github.head_ref }}"
 *
 * Safe pattern:
 *   env:
 *     PR_TITLE: ${{ github.event.pull_request.title }}
 *   run: echo "$PR_TITLE"
 */

// Placeholder query — actual detection is in the workflow step below
from File f
where f.getBaseName() = "THIS_QUERY_IS_DOCUMENTATION_ONLY" and 1 = 0
select f, "See cicd-injection-check step in security-scan.yml for actual detection."
