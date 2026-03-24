/**
 * QR Code Domain Module
 *
 * Story E2: Verified-QR-Only Enforcement (Hard Invariant)
 *
 * INVARIANT: No QR is ever displayed unless it has been verified by backend.
 * This is the most important invariant - it must be impossible to violate accidentally.
 *
 * Backend Contract:
 *   If assetState === 'ACTIVE':
 *     { qr: { verified: true, url: "https://..." } }
 *   Otherwise:
 *     { qr: { verified: false } }
 *
 * @module domain/qr
 * @see Story E2 - Verified-QR-Only Enforcement (Hard Invariant)
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Valid asset states for QR verification
 * Only ACTIVE events can have verified QR codes
 */
export const ASSET_STATE = {
  /** Event is active and visible - QR codes allowed */
  ACTIVE: 'active',
  /** Event is archived/hidden - QR codes NOT allowed */
  ARCHIVED: 'archived',
  /** Event is in draft/ready state - QR codes NOT allowed */
  READY: 'ready',
  /** Event is in draft state - QR codes NOT allowed */
  DRAFT: 'draft',
} as const;

export type AssetState = typeof ASSET_STATE[keyof typeof ASSET_STATE];

/**
 * Verified QR response shape - when QR is verified and allowed
 */
export interface VerifiedQR {
  verified: true;
  url: string;
}

/**
 * Unverified QR response shape - when QR is NOT allowed
 */
export interface UnverifiedQR {
  verified: false;
}

/**
 * QR verification result union type
 * Backend MUST return one of these two shapes
 */
export type QRVerificationResult = VerifiedQR | UnverifiedQR;

/**
 * Full QR data shape for events (public + signup URLs)
 */
export interface EventQRData {
  /** Public event page QR verification result */
  public: QRVerificationResult;
  /** Sign-up page QR verification result */
  signup: QRVerificationResult;
}

/**
 * Legacy QR format (base64 PNG data URIs)
 * Used internally before verification transformation
 */
export interface LegacyEventQR {
  public?: string;
  signup?: string;
}

/**
 * Event links required for QR generation
 */
export interface EventLinks {
  publicUrl?: string;
  signupUrl?: string;
}

// =============================================================================
// QR Verification Logic
// =============================================================================

/**
 * Check if an asset state allows QR codes to be displayed
 *
 * INVARIANT: Only ACTIVE events can have verified QR codes.
 *
 * @param assetState - Current state of the event asset
 * @returns true if QR codes are allowed for this state
 */
export function isQRAllowed(assetState: string | undefined | null): boolean {
  // Only ACTIVE state allows QR codes
  return assetState === ASSET_STATE.ACTIVE;
}

/**
 * Verify a single QR URL based on asset state
 *
 * BACKEND GUARD: If assetState !== ACTIVE, QR URL is stripped.
 *
 * @param url - The URL that would be encoded in QR
 * @param assetState - Current state of the event asset
 * @returns VerifiedQR if allowed, UnverifiedQR otherwise
 */
export function verifyQRUrl(
  url: string | undefined | null,
  assetState: string | undefined | null
): QRVerificationResult {
  // Check if QR is allowed for this asset state
  if (!isQRAllowed(assetState)) {
    return { verified: false };
  }

  // Check if URL is valid
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return { verified: false };
  }

  // URL must be HTTPS for security
  if (!url.startsWith('https://')) {
    return { verified: false };
  }

  // QR is verified - URL can be displayed
  return {
    verified: true,
    url: url.trim(),
  };
}

/**
 * Build verified QR data for an event
 *
 * BACKEND GUARD: If assetState !== ACTIVE, all QR URLs are stripped.
 * Attempts to force QR via frontend manipulation do nothing because
 * the backend strips QR data before sending.
 *
 * @param links - Event links containing public and signup URLs
 * @param assetState - Current state of the event asset
 * @returns EventQRData with verification status for each QR
 */
export function buildVerifiedQRData(
  links: EventLinks | undefined | null,
  assetState: string | undefined | null
): EventQRData {
  return {
    public: verifyQRUrl(links?.publicUrl, assetState),
    signup: verifyQRUrl(links?.signupUrl, assetState),
  };
}

/**
 * Transform legacy QR format to verified format
 *
 * Takes existing base64 QR image data and wraps it with verification status.
 * Used for backward compatibility during migration.
 *
 * BACKEND GUARD: If assetState !== ACTIVE, QR images are stripped.
 *
 * @param legacyQR - Legacy QR object with base64 PNG data URIs
 * @param links - Event links for URL extraction
 * @param assetState - Current state of the event asset
 * @returns Object with verified QR structure including image data
 */
export function transformLegacyQR(
  legacyQR: LegacyEventQR | undefined | null,
  links: EventLinks | undefined | null,
  assetState: string | undefined | null
): {
  public: (VerifiedQR & { image?: string }) | UnverifiedQR;
  signup: (VerifiedQR & { image?: string }) | UnverifiedQR;
} {
  const publicResult = verifyQRUrl(links?.publicUrl, assetState);
  const signupResult = verifyQRUrl(links?.signupUrl, assetState);

  return {
    public: publicResult.verified
      ? { ...publicResult, image: legacyQR?.public }
      : publicResult,
    signup: signupResult.verified
      ? { ...signupResult, image: legacyQR?.signup }
      : signupResult,
  };
}

// =============================================================================
// QR Validation Helpers
// =============================================================================

/**
 * Check if a QR verification result is verified
 *
 * Type guard for frontend/backend code to safely check verification status.
 *
 * @param qr - QR verification result
 * @returns true if QR is verified and has a valid URL
 */
export function isVerifiedQR(qr: QRVerificationResult | undefined | null): qr is VerifiedQR {
  return qr !== null && qr !== undefined && qr.verified === true && 'url' in qr;
}

/**
 * Validate QR data structure integrity
 *
 * Ensures the QR data matches the expected contract format.
 * Used by tests and validation code.
 *
 * @param qrData - QR data to validate
 * @returns true if QR data is valid contract format
 */
export function isValidQRContract(qrData: unknown): qrData is EventQRData {
  if (!qrData || typeof qrData !== 'object') {
    return false;
  }

  const data = qrData as Record<string, unknown>;

  // Must have public and signup fields
  if (!('public' in data) || !('signup' in data)) {
    return false;
  }

  // Each field must be a valid verification result
  const isValidResult = (result: unknown): boolean => {
    if (!result || typeof result !== 'object') {
      return false;
    }
    const r = result as Record<string, unknown>;

    // Must have verified boolean
    if (typeof r.verified !== 'boolean') {
      return false;
    }

    // If verified, must have url string
    if (r.verified === true) {
      return typeof r.url === 'string' && r.url.length > 0;
    }

    // If not verified, should not have url
    return !('url' in r) || r.url === undefined;
  };

  return isValidResult(data.public) && isValidResult(data.signup);
}

// =============================================================================
// Logging & Diagnostics
// =============================================================================

/**
 * Log QR verification decision for debugging/audit
 *
 * @param eventId - Event ID being processed
 * @param assetState - Asset state used in decision
 * @param publicVerified - Whether public QR was verified
 * @param signupVerified - Whether signup QR was verified
 */
export function logQRVerification(
  eventId: string,
  assetState: string | undefined | null,
  publicVerified: boolean,
  signupVerified: boolean
): void {
  const timestamp = new Date().toISOString();
  const allowed = isQRAllowed(assetState);

  console.log(JSON.stringify({
    type: 'QR_VERIFICATION',
    timestamp,
    eventId,
    assetState: assetState || 'undefined',
    qrAllowed: allowed,
    publicVerified,
    signupVerified,
    invariant: 'E2_VERIFIED_QR_ONLY',
  }));
}
