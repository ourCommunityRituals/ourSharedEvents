/**
 * Admin authentication guard.
 *
 * Method 1: Cloudflare Access JWT (Cf-Access-Jwt-Assertion header)
 * Method 2: X-OCR-Internal header against X_OCR_INTERNAL (when ALLOW_OCR_INTERNAL=true)
 * Method 3: Bearer token against ADMIN_KEY (when ALLOW_ADMIN_KEY_FALLBACK=true)
 *
 * Usage:
 *   const deny = requireAdmin(request, env, requestId);
 *   if (deny) return deny;
 */

export interface AdminEnv {
  ADMIN_KEY?: string;
  ADMIN_TOKEN?: string; // legacy alias
  ALLOW_ADMIN_KEY_FALLBACK?: string;
  X_OCR_INTERNAL?: string; // CI/CD internal auth secret
  ALLOW_OCR_INTERNAL?: string; // gate for X-OCR-Internal header
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function extractBearer(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function getAdminKey(env: AdminEnv): string | null {
  return (env.ADMIN_KEY?.trim() || env.ADMIN_TOKEN?.trim()) ?? null;
}

function decodeCfAccessJwt(jwt: string): boolean {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return false;
    const padding = '='.repeat((4 - (parts[1].length % 4)) % 4);
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/') + padding)) as {
      exp?: number;
      iat?: number;
    };
    if (!payload.exp || !payload.iat) return false;
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function requireAdmin(request: Request, env: AdminEnv, requestId: string): Response | null {
  // Method 1: Cloudflare Access JWT
  const cfJwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (cfJwt && decodeCfAccessJwt(cfJwt)) return null;

  // Method 2: X-OCR-Internal header (CI/CD automation)
  if (env.ALLOW_OCR_INTERNAL === 'true') {
    const ocrSecret = env.X_OCR_INTERNAL?.trim() ?? null;
    const ocrHeader = request.headers.get('X-OCR-Internal');
    if (ocrSecret && ocrHeader && constantTimeEqual(ocrHeader, ocrSecret)) return null;
  }

  // Method 3: Bearer token fallback
  if (env.ALLOW_ADMIN_KEY_FALLBACK === 'true') {
    const key = getAdminKey(env);
    const token = extractBearer(request.headers.get('Authorization'));
    if (key && token && constantTimeEqual(token, key)) return null;
  }

  return new Response(JSON.stringify({ ok: false, status: 401, code: 'UNAUTH', requestId }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="OurSharedEvents Admin"',
      'X-Request-Id': requestId,
    },
  });
}
