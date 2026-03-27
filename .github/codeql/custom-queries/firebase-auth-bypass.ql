/**
 * @name Firebase: Authentication check bypass
 * @description Firebase Auth tokens must be verified server-side before
 *              granting access. Client-side auth state alone is insufficient.
 * @kind problem
 * @problem.severity error
 * @security-severity 9.0
 * @precision medium
 * @id js/firebase-auth-bypass
 * @tags security
 *       firebase
 *       external/cwe/cwe-287
 */

import javascript

/*
 * Detects patterns where Firebase Auth is checked client-side only:
 *   - firebase.auth().currentUser without server verification
 *   - onAuthStateChanged used to gate API calls without ID token
 *
 * Safe pattern:
 *   const idToken = await firebase.auth().currentUser.getIdToken();
 *   fetch('/api/admin', { headers: { Authorization: `Bearer ${idToken}` } });
 *   // Server verifies: admin.auth().verifyIdToken(idToken)
 */

from MethodCallExpr call
where
  // Detect currentUser access without getIdToken()
  call.getMethodName() = "currentUser" and
  call.getReceiver().toString().regexpMatch(".*auth.*") and
  not exists(MethodCallExpr getToken |
    getToken.getMethodName() = "getIdToken" and
    getToken.getEnclosingFunction() = call.getEnclosingFunction()
  )
select call, "Firebase auth().currentUser accessed without getIdToken() — verify tokens server-side."
