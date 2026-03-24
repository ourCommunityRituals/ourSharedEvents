/**
 * Public QR Render Module
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
 * @module public/render
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
          <p class="qr-placeholder-message">QR code not available</p>
        </div>
      </div>
    `;
  }

  /**
   * Create verified QR element for public page (mobile-friendly)
   *
   * @param {Object} options - QR options
   * @param {string} options.type - QR type ('public' or 'signup')
   * @param {string} options.url - Verified URL
   * @param {string} options.image - Base64 QR image data URI
   * @param {string} options.title - Title text
   * @returns {string} HTML string for QR element
   */
  function createVerifiedQR(options) {
    const { type, url, image, title } = options;

    // Double-check verification - defense in depth
    if (!url || !image) {
      return createQRPlaceholder(type);
    }

    return `
      <div class="qr-code" data-qr-type="${escapeHtml(type)}" data-verified="true">
        <h4>${escapeHtml(title)}</h4>
        <img alt="${escapeHtml(title)} QR Code" src="${escapeHtml(image)}">
        <a href="${escapeHtml(url)}" class="qr-link" target="_blank" rel="noopener">${escapeHtml(url)}</a>
      </div>
    `;
  }

  // ==========================================================================
  // Main Render Functions
  // ==========================================================================

  /**
   * Render QR codes section for public page
   *
   * HARD RULE: QR is ONLY rendered if backend marks verified === true
   *            Forcing QR via frontend manipulation does NOTHING.
   *
   * @param {HTMLElement} container - Container element for QR display
   * @param {Object} event - Event data from backend
   * @param {Object} options - Render options
   * @param {boolean} options.showPlaceholders - Show placeholders for unverified QR (default: false)
   */
  function renderQRSection(container, event, options) {
    options = options || {};
    const showPlaceholders = options.showPlaceholders || false;

    if (!container) {
      console.error('[QR_RENDER] Container element not found');
      return;
    }

    container.innerHTML = '';

    // Safety check - event must exist
    if (!event) {
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

    // On public page, primarily show signup QR for mobile scanning
    if (signupVerified) {
      html += createVerifiedQR({
        type: 'signup',
        url: signupQR.url,
        image: signupQR.image || qr.signup,
        title: ctas.primary?.label || 'Sign Up'
      });
    } else if (showPlaceholders) {
      html += createQRPlaceholder('signup');
    }

    // Only show container if we have content
    if (html) {
      container.innerHTML = html;
      container.hidden = false;
    } else {
      container.hidden = true;
    }
  }

  /**
   * Render a single QR code
   *
   * HARD RULE: QR is ONLY rendered if backend marks verified === true
   *
   * @param {HTMLElement} container - Container element
   * @param {Object} qrData - QR verification data { verified: boolean, url?: string, image?: string }
   * @param {string} title - Title for the QR
   * @param {string} type - QR type identifier
   */
  function renderSingleQR(container, qrData, title, type) {
    if (!container) {
      console.error('[QR_RENDER] Container element not found');
      return;
    }

    const verified = isQRVerified(qrData);

    logQRRenderDecision(type, qrData, null, verified, false);

    if (verified) {
      container.innerHTML = createVerifiedQR({
        type: type,
        url: qrData.url,
        image: qrData.image,
        title: title
      });
      container.hidden = false;
    } else {
      container.innerHTML = '';
      container.hidden = true;
    }
  }

  /**
   * Check if any QR in event is verified
   *
   * @param {Object} event - Event data
   * @returns {boolean} true if at least one QR is verified
   */
  function hasVerifiedQR(event) {
    if (!event || !event.qr) {
      return false;
    }

    const qr = event.qr;
    return isQRVerified(qr.public) || isQRVerified(qr.signup);
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
   * PublicQRRender module
   * Enforces Story E2 Hard Invariant: No QR unless verified by backend
   */
  const PublicQRRender = {
    // Core verification
    isQRVerified: isQRVerified,
    getVerifiedQRUrl: getVerifiedQRUrl,
    hasVerifiedQR: hasVerifiedQR,

    // Rendering
    renderQRSection: renderQRSection,
    renderSingleQR: renderSingleQR,
    createQRPlaceholder: createQRPlaceholder,
    createVerifiedQR: createVerifiedQR,

    // Version info
    VERSION: '1.0.0',
    INVARIANT: 'E2_VERIFIED_QR_ONLY'
  };

  // Export to global scope
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PublicQRRender;
  } else {
    global.PublicQRRender = PublicQRRender;
  }

})(typeof window !== 'undefined' ? window : this);
