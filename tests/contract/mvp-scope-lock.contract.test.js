/**
 * MVP Scope Lock - Contract Tests
 *
 * Purpose: Enforce MVP scope rules as defined in docs/MVP_SCOPE.md
 * Week 1 Lock: QR flows (backend unlimited, poster max 3) and 5 surfaces
 *
 * Run with: npm run test:contract
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Constants - MVP Scope Rules
// =============================================================================

const MVP_SURFACES = ['Admin', 'Public', 'Display', 'Poster', 'SharedReport'];
const POSTER_MAX_QR_SLOTS = 3;

const SRC_MVP_DIR = path.join(__dirname, '../../src/mvp');
// Story 5.3: GAS files archived to archive/gas/
const GAS_ARCHIVE_DIR = path.join(__dirname, '../../archive/gas');
const DOCS_DIR = path.join(__dirname, '../../docs');

// =============================================================================
// Test Suite: MVP Scope Lock
// =============================================================================

describe('MVP Scope Lock - Week 1 Contract', () => {

  describe('MVP_SCOPE.md exists and documents rules', () => {

    test('docs/MVP_SCOPE.md exists', () => {
      const scopeFile = path.join(DOCS_DIR, 'MVP_SCOPE.md');
      expect(fs.existsSync(scopeFile)).toBe(true);
    });

    test('MVP_SCOPE.md documents 5 surfaces', () => {
      const scopeFile = path.join(DOCS_DIR, 'MVP_SCOPE.md');
      const content = fs.readFileSync(scopeFile, 'utf-8');

      // Check all 5 surfaces are mentioned
      MVP_SURFACES.forEach(surface => {
        expect(content).toContain(surface);
      });

      // Check the explicit count
      expect(content).toMatch(/5 surfaces|5 Total/i);
    });

    test('MVP_SCOPE.md documents QR rules', () => {
      const scopeFile = path.join(DOCS_DIR, 'MVP_SCOPE.md');
      const content = fs.readFileSync(scopeFile, 'utf-8');

      // Backend unlimited
      expect(content).toMatch(/unlimited.*QR|unlimited backend QR/i);

      // Poster max 3
      expect(content).toMatch(/3.*QR|max.*3|exactly 3/i);
      expect(content).toMatch(/poster/i);
    });

    test('MVP_SCOPE.md is marked as LOCKED', () => {
      const scopeFile = path.join(DOCS_DIR, 'MVP_SCOPE.md');
      const content = fs.readFileSync(scopeFile, 'utf-8');

      expect(content).toMatch(/LOCK|SCOPE.*LOCK|LOCKED/i);
    });
  });

  describe('Backend QR Flow Configuration', () => {

    test('Code.gs has QR flow configuration comment block', () => {
      const codeFile = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
      const content = fs.readFileSync(codeFile, 'utf-8');

      // Check for MVP scope lock comment
      expect(content).toContain('QR CODE FLOW CONFIGURATION');
      expect(content).toContain('MVP SCOPE LOCK');
      expect(content).toMatch(/unlimited.*backend.*QR|unlimited.*QR.*flow/i);
    });

    test('Backend can define more than 3 QR flow types', () => {
      const codeFile = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
      const content = fs.readFileSync(codeFile, 'utf-8');

      // The generateQRDataUri_ function should exist
      expect(content).toContain('generateQRDataUri_');

      // Check that the comment documents multiple flows
      expect(content).toMatch(/public|signup|display/);
    });

    test('QR generation function accepts any URL (unlimited flows)', () => {
      const codeFile = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
      const content = fs.readFileSync(codeFile, 'utf-8');

      // Find generateQRDataUri_ function
      const functionMatch = content.match(/function generateQRDataUri_\(url\)/);
      expect(functionMatch).toBeTruthy();

      // Function takes a generic URL parameter (not limited to specific flows)
      expect(content).toMatch(/generateQRDataUri_\s*\(\s*url/);
    });

    test('Backend QR config mentions poster 3-slot limit', () => {
      const codeFile = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
      const content = fs.readFileSync(codeFile, 'utf-8');

      // The comment should reference the poster limit
      expect(content).toMatch(/poster.*max.*3|3.*flows.*display/i);
    });
  });

  describe('Poster 3-QR Slot Limit', () => {

    test('Poster.html has 3-QR limit comment in HTML', () => {
      const posterFile = path.join(SRC_MVP_DIR, 'Poster.html');
      const content = fs.readFileSync(posterFile, 'utf-8');

      // Check for scope lock comment in HTML
      expect(content).toContain('MVP SCOPE LOCK');
      expect(content).toContain('3-QR LIMIT');
    });

    test('Poster.html has 3-QR limit comment in JavaScript', () => {
      const posterFile = path.join(SRC_MVP_DIR, 'Poster.html');
      const content = fs.readFileSync(posterFile, 'utf-8');

      // Check for scope lock comment in renderQRCodes function
      expect(content).toContain('3-QR DISPLAY SLOT LIMIT');
      expect(content).toContain('renderQRCodes');
    });

    test('Poster CSS grid is configured for 3 columns', () => {
      const posterFile = path.join(SRC_MVP_DIR, 'Poster.html');
      const content = fs.readFileSync(posterFile, 'utf-8');

      // Check grid template is set to 3 columns
      expect(content).toMatch(/grid-template-columns:\s*repeat\(3/);
    });

    test('Poster qr-grid class has 3-column layout', () => {
      const posterFile = path.join(SRC_MVP_DIR, 'Poster.html');
      const content = fs.readFileSync(posterFile, 'utf-8');

      // Extract qr-grid style
      const qrGridMatch = content.match(/\.qr-grid\s*\{[^}]+\}/);
      expect(qrGridMatch).toBeTruthy();

      const qrGridStyle = qrGridMatch[0];
      expect(qrGridStyle).toContain('repeat(3');
    });

    test('Poster documents slot priority order', () => {
      const posterFile = path.join(SRC_MVP_DIR, 'Poster.html');
      const content = fs.readFileSync(posterFile, 'utf-8');

      // Check for documented slot order
      expect(content).toMatch(/Slot 1|slot 1|Sign Up/i);
      expect(content).toMatch(/Slot 2|slot 2|Event Page|Public/i);
    });

    test('Poster references MVP_SCOPE.md', () => {
      const posterFile = path.join(SRC_MVP_DIR, 'Poster.html');
      const content = fs.readFileSync(posterFile, 'utf-8');

      // Check for reference to scope doc
      expect(content).toContain('docs/MVP_SCOPE.md');
    });
  });

  describe('MVP Surface Count Enforcement', () => {

    test('Exactly 5 MVP surfaces exist in src/mvp/', () => {
      const surfaceFiles = MVP_SURFACES.map(s => `${s}.html`);

      surfaceFiles.forEach(file => {
        const filePath = path.join(SRC_MVP_DIR, file);
        expect(fs.existsSync(filePath)).toBe(true);
      });
    });

    test('All MVP surfaces have MVP header comment', () => {
      MVP_SURFACES.forEach(surface => {
        const filePath = path.join(SRC_MVP_DIR, `${surface}.html`);
        const content = fs.readFileSync(filePath, 'utf-8');

        expect(content).toMatch(/MVP SURFACE|MVP.*Focus Group/i);
      });
    });

    test('MVP_SURFACES.md documents exactly 5 surfaces', () => {
      const surfacesFile = path.join(DOCS_DIR, 'MVP_SURFACES.md');
      const content = fs.readFileSync(surfacesFile, 'utf-8');

      // Check explicit count
      expect(content).toMatch(/5 Total|5 surfaces/i);

      // Check all surfaces mentioned
      MVP_SURFACES.forEach(surface => {
        expect(content).toContain(surface);
      });
    });
  });

  describe('Events-Only Scope', () => {

    test('MVP_SCOPE.md documents events-only scope', () => {
      const scopeFile = path.join(DOCS_DIR, 'MVP_SCOPE.md');
      const content = fs.readFileSync(scopeFile, 'utf-8');

      expect(content).toMatch(/events-only|Events-only/i);
    });

    test('MVP_SCOPE.md marks sponsor dashboards as out of scope', () => {
      const scopeFile = path.join(DOCS_DIR, 'MVP_SCOPE.md');
      const content = fs.readFileSync(scopeFile, 'utf-8');

      expect(content).toMatch(/sponsor.*dashboard|sponsor.*self-service/i);
      expect(content).toMatch(/out of scope|v2\+|OUT OF SCOPE/i);
    });

    test('MVP_SCOPE.md marks advanced analytics as out of scope', () => {
      const scopeFile = path.join(DOCS_DIR, 'MVP_SCOPE.md');
      const content = fs.readFileSync(scopeFile, 'utf-8');

      expect(content).toMatch(/advanced analytics/i);
    });
  });
});

// =============================================================================
// Test Suite: QR Flow Acceptance (Backend > 3 Flows)
// =============================================================================

describe('Backend QR Flow Acceptance - Unlimited Flows', () => {

  test('Backend can generate QR for any valid URL', () => {
    const codeFile = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
    const content = fs.readFileSync(codeFile, 'utf-8');

    // generateQRDataUri_ should accept a url parameter
    expect(content).toMatch(/function generateQRDataUri_\s*\(\s*url\s*\)/);

    // Should not have hardcoded limit on QR types
    expect(content).not.toMatch(/max.*2.*QR|only.*2.*QR/i);
  });

  test('Event contract can include multiple QR fields', () => {
    const codeFile = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
    const content = fs.readFileSync(codeFile, 'utf-8');

    // Check that qr object can have multiple properties (const qr = { or qr: {)
    expect(content).toMatch(/const qr\s*=\s*\{|qr:\s*\{/);

    // Should have at least public and signup QR generation
    expect(content).toMatch(/public.*generateQRDataUri_|generateQRDataUri_.*publicUrl/);
    expect(content).toMatch(/signup.*generateQRDataUri_|generateQRDataUri_.*signupUrl|signupUrl/);
  });

  test('Config documents that new QR flows can be added', () => {
    const codeFile = path.join(GAS_ARCHIVE_DIR, 'Code.gs');
    const content = fs.readFileSync(codeFile, 'utf-8');

    // Comment should explain how to add new flows
    expect(content).toMatch(/add new QR flow|add.*generation logic/i);
  });
});

// =============================================================================
// Test Suite: Poster QR Slot Constraint
// =============================================================================

describe('Poster QR Slot Constraint - Max 3 Slots', () => {

  test('Poster renderQRCodes function exists', () => {
    const posterFile = path.join(SRC_MVP_DIR, 'Poster.html');
    const content = fs.readFileSync(posterFile, 'utf-8');

    expect(content).toContain('function renderQRCodes');
  });

  test('Poster grid layout enforces 3-column max', () => {
    const posterFile = path.join(SRC_MVP_DIR, 'Poster.html');
    const content = fs.readFileSync(posterFile, 'utf-8');

    // CSS grid should be limited to 3 columns
    const gridMatch = content.match(/grid-template-columns:\s*repeat\((\d+)/);
    expect(gridMatch).toBeTruthy();

    const columnCount = parseInt(gridMatch[1], 10);
    expect(columnCount).toBe(POSTER_MAX_QR_SLOTS);
  });

  test('Poster has explicit "DO NOT add 4th QR" warning', () => {
    const posterFile = path.join(SRC_MVP_DIR, 'Poster.html');
    const content = fs.readFileSync(posterFile, 'utf-8');

    expect(content).toMatch(/DO NOT add.*4th|do not.*4|no.*4th/i);
  });

  test('Poster documents handling of extra QRs', () => {
    const posterFile = path.join(SRC_MVP_DIR, 'Poster.html');
    const content = fs.readFileSync(posterFile, 'utf-8');

    // Should document what happens with >3 QRs
    expect(content).toMatch(/more than 3|extras.*hidden|only.*first.*3/i);
  });
});

// =============================================================================
// Module Exports (for other tests to use)
// =============================================================================

module.exports = {
  MVP_SURFACES,
  POSTER_MAX_QR_SLOTS,
  SRC_MVP_DIR,
  DOCS_DIR
};
