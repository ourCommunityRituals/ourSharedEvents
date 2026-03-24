/**
 * Poster QR Render Module
 *
 * Story E2: Verified-QR-Only Enforcement (Hard Invariant)
 *
 * HARD RULE: If qr.verified !== true, QR container is NOT rendered.
 *            A placeholder message is shown instead.
 *
 * This is the MOST IMPORTANT INVARIANT:
 *   NO QR IS EVER DISPLAYED UNLESS IT HAS BEEN VERIFIED BY BACKEND.
 *   Forcing QR via frontend manipulation does NOTHING.
 *
 * Backend Contract Expected:
 *   { qr: { verified: true, url: "https://..." } }
 *   OR
 *   { qr: { verified: false } }
 *
 * @module poster/render
 * @see Story E2 - Verified-QR-Only Enforcement (Hard Invariant)
 */

(function(global) {
  'use strict';

  // ==========================================================================
  // HARD INVARIANT: QR Verification Check
  // ==========================================================================

  /**
   * Check if QR data is verified by backend
   *
   * HARD RULE: Returns true ONLY if qr.verified === true (strict equality)
   *
   * @param {Object} qr - QR verification data from backend
   * @returns {boolean} true only if backend explicitly verified the QR
   */
  function isQRVerified(qr) {
    // HARD RULE: Must be strictly true, not truthy
    return qr !== null &&
           qr !== undefined &&
           qr.verified === true;
  }

  /**
   * Get verified QR URL safely
   *
   * HARD RULE: Returns URL only if verified === true
   *
   * @param {Object} qr - QR verification data from backend
   * @returns {string|null} URL if verified, null otherwise
   */
  function getVerifiedQRUrl(qr) {
    if (!isQRVerified(qr)) {
      return null;
    }
    return qr.url || null;
  }

  // ==========================================================================
  // Placeholder Rendering
  // ==========================================================================

  /**
   * Create placeholder element for unverified QR
   *
   * @param {string} type - QR type ('public' or 'signup')
   * @returns {string} HTML string for placeholder
   */
  function createQRPlaceholder(type) {
    const typeLabel = type === 'signup' ? 'Sign Up' : 'Event Page';
    return `
      <div class="qr-code qr-placeholder" data-qr-type="${escapeHtml(type)}" data-verified="false">
        <div class="qr-placeholder-content">
          <div class="qr-placeholder-icon">&#128274;</div>
          <p class="qr-placeholder-title">${escapeHtml(typeLabel)} QR</p>
          <p class="qr-placeholder-message">QR code not yet available</p>
          <p class="qr-placeholder-hint">Event must be active to display QR</p>
        </div>
      </div>
    `;
  }

  /**
   * Create verified QR element
   *
   * @param {Object} options - QR options
   * @param {string} options.type - QR type ('public' or 'signup')
   * @param {string} options.url - Verified URL
   * @param {string} options.image - Base64 QR image data URI
   * @param {string} options.title - Title text
   * @param {string} options.subtitle - Subtitle text
   * @returns {string} HTML string for QR element
   */
  function createVerifiedQR(options) {
    const { type, url, image, title, subtitle } = options;

    // Double-check verification - defense in depth
    if (!url || !image) {
      return createQRPlaceholder(type);
    }

    return `
      <div class="qr-code" data-qr-type="${escapeHtml(type)}" data-verified="true">
        <h3>${escapeHtml(title)}</h3>
        <h4>${escapeHtml(subtitle)}</h4>
        <img alt="${escapeHtml(title)} QR Code" src="${escapeHtml(image)}">
        <p>${escapeHtml(url)}</p>
      </div>
    `;
  }

  // ==========================================================================
  // Main Render Functions
  // ==========================================================================

  /**
   * Render QR codes section for poster
   *
   * HARD RULE: QR is ONLY rendered if backend marks verified === true
   *            Forcing QR via frontend manipulation does NOTHING.
   *
   * @param {HTMLElement} container - Container element for QR grid
   * @param {Object} event - Event data from backend
   * @param {Object} event.qr - QR verification data
   * @param {Object} event.qr.public - Public QR { verified: boolean, url?: string, image?: string }
   * @param {Object} event.qr.signup - Signup QR { verified: boolean, url?: string, image?: string }
   * @param {Object} event.links - Event links
   * @param {Object} event.ctas - Call-to-action data
   */
  function renderQRSection(container, event) {
    if (!container) {
      console.error('[QR_RENDER] Container element not found');
      return;
    }

    container.innerHTML = '';

    // Safety check - event must exist
    if (!event) {
      container.innerHTML = createNoEventPlaceholder();
      logQRRenderDecision('NO_EVENT', null, null, false, false);
      return;
    }

    const qr = event.qr || {};
    const ctas = event.ctas || { primary: { label: 'Sign Up' } };

    // Extract verification results
    const publicQR = qr.public || { verified: false };
    const signupQR = qr.signup || { verified: false };

    // Check verification status - HARD RULE
    const publicVerified = isQRVerified(publicQR);
    const signupVerified = isQRVerified(signupQR);

    // Log verification decision for audit trail
    logQRRenderDecision(event.id, publicQR, signupQR, publicVerified, signupVerified);

    let html = '';

    // Render Sign Up QR (primary CTA)
    if (signupVerified) {
      html += createVerifiedQR({
        type: 'signup',
        url: signupQR.url,
        image: signupQR.image || qr.signup, // Fallback for legacy format
        title: ctas.primary?.label || 'Sign Up',
        subtitle: 'Register Now'
      });
    } else {
      html += createQRPlaceholder('signup');
    }

    // Render Public Event Page QR
    if (publicVerified) {
      html += createVerifiedQR({
        type: 'public',
        url: publicQR.url,
        image: publicQR.image || qr.public, // Fallback for legacy format
        title: 'Event Page',
        subtitle: 'View Details'
      });
    } else {
      html += createQRPlaceholder('public');
    }

    container.innerHTML = html;
  }

  /**
   * Check if QR section should be visible
   *
   * Section is visible if at least one QR is verified OR
   * if we want to show placeholders
   *
   * @param {Object} event - Event data
   * @param {Object} settings - Event settings
   * @returns {boolean} true if section should be visible
   */
  function shouldShowQRSection(event, settings) {
    // Check settings first
    if (settings && settings.showQRSection === false) {
      return false;
    }

    // Always show section (with placeholders if not verified)
    // This makes it clear to users that QR will appear when event is active
    return true;
  }

  // ==========================================================================
  // Utility Functions
  // ==========================================================================

  /**
   * Escape HTML special characters
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Create placeholder for no event scenario
   * @returns {string} HTML string
   */
  function createNoEventPlaceholder() {
    return `
      <div style="text-align:center; color:#64748b; grid-column: 1 / -1; padding: 24px;">
        <div style="font-size: 2rem; margin-bottom: 12px; opacity: 0.5;">&#128269;</div>
        <p style="margin: 0 0 8px; font-weight: 600; color: #475569;">No Event Data</p>
        <p style="margin: 0; font-size: 0.9rem; color: #94a3b8;">Event data is required to display QR codes.</p>
      </div>
    `;
  }

  /**
   * Log QR render decision for debugging/audit
   *
   * @param {string} eventId - Event ID
   * @param {Object} publicQR - Public QR data
   * @param {Object} signupQR - Signup QR data
   * @param {boolean} publicVerified - Whether public QR was verified
   * @param {boolean} signupVerified - Whether signup QR was verified
   */
  function logQRRenderDecision(eventId, publicQR, signupQR, publicVerified, signupVerified) {
    console.log('[QR_RENDER]', {
      eventId: eventId || 'unknown',
      invariant: 'E2_VERIFIED_QR_ONLY',
      publicVerified: publicVerified,
      signupVerified: signupVerified,
      timestamp: new Date().toISOString()
    });

    // Warn if QR has URL but is not verified (potential issue)
    if (!publicVerified && publicQR?.url) {
      console.warn('[QR_INVARIANT] Public QR has URL but verified !== true - QR blocked');
    }
    if (!signupVerified && signupQR?.url) {
      console.warn('[QR_INVARIANT] Signup QR has URL but verified !== true - QR blocked');
    }
  }

  // ==========================================================================
  // Export
  // ==========================================================================

  /**
   * PosterQRRender module
   * Enforces Story E2 Hard Invariant: No QR unless verified by backend
   */
  const PosterQRRender = {
    // Core verification
    isQRVerified: isQRVerified,
    getVerifiedQRUrl: getVerifiedQRUrl,

    // Rendering
    renderQRSection: renderQRSection,
    shouldShowQRSection: shouldShowQRSection,
    createQRPlaceholder: createQRPlaceholder,
    createVerifiedQR: createVerifiedQR,

    // Version info
    VERSION: '1.0.0',
    INVARIANT: 'E2_VERIFIED_QR_ONLY'
  };

  // Export to global scope
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PosterQRRender;
  } else {
    global.PosterQRRender = PosterQRRender;
  }

})(typeof window !== 'undefined' ? window : this);
