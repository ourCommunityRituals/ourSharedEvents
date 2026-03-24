/**
 * @jest-environment jsdom
 */

/**
 * Unit Tests for Collapsible Sections Functionality
 *
 * Tests the toggleSection function and collapsible section behavior
 * in the Admin interface
 */

describe('Admin - Collapsible Sections Unit Tests', () => {

  // Mock DOM setup
  let mockHeader, mockContent, mockIcon;

  beforeEach(() => {
    // Create mock DOM elements
    document.body.innerHTML = `
      <div class="subsection">
        <div class="collapsible-header" onclick="toggleSection(this)">
          <h3>Test Section</h3>
          <span class="collapsible-icon">▼</span>
        </div>
        <div class="collapsible-content">
          <p>Test content</p>
        </div>
      </div>
    `;

    mockHeader = document.querySelector('.collapsible-header');
    mockContent = document.querySelector('.collapsible-content');
    mockIcon = document.querySelector('.collapsible-icon');

    // Define toggleSection function (from Admin.html)
    window.toggleSection = function(header) {
      header.classList.toggle('collapsed');
      const content = header.nextElementSibling;
      if (content) {
        content.classList.toggle('collapsed');
      }
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete window.toggleSection;
  });

  describe('toggleSection function', () => {

    it('should exist and be callable', () => {
      expect(typeof window.toggleSection).toBe('function');
    });

    it('should toggle collapsed class on header', () => {
      expect(mockHeader.classList.contains('collapsed')).toBe(false);

      window.toggleSection(mockHeader);
      expect(mockHeader.classList.contains('collapsed')).toBe(true);

      window.toggleSection(mockHeader);
      expect(mockHeader.classList.contains('collapsed')).toBe(false);
    });

    it('should toggle collapsed class on content', () => {
      expect(mockContent.classList.contains('collapsed')).toBe(false);

      window.toggleSection(mockHeader);
      expect(mockContent.classList.contains('collapsed')).toBe(true);

      window.toggleSection(mockHeader);
      expect(mockContent.classList.contains('collapsed')).toBe(false);
    });

    it('should handle multiple toggles correctly', () => {
      // Initial state: expanded
      expect(mockHeader.classList.contains('collapsed')).toBe(false);
      expect(mockContent.classList.contains('collapsed')).toBe(false);

      // First toggle: collapse
      window.toggleSection(mockHeader);
      expect(mockHeader.classList.contains('collapsed')).toBe(true);
      expect(mockContent.classList.contains('collapsed')).toBe(true);

      // Second toggle: expand
      window.toggleSection(mockHeader);
      expect(mockHeader.classList.contains('collapsed')).toBe(false);
      expect(mockContent.classList.contains('collapsed')).toBe(false);

      // Third toggle: collapse again
      window.toggleSection(mockHeader);
      expect(mockHeader.classList.contains('collapsed')).toBe(true);
      expect(mockContent.classList.contains('collapsed')).toBe(true);
    });

    it('should find content as next sibling element', () => {
      const content = mockHeader.nextElementSibling;
      expect(content).toBe(mockContent);
      expect(content.classList.contains('collapsible-content')).toBe(true);
    });

    it('should not throw error when called on header element', () => {
      expect(() => {
        window.toggleSection(mockHeader);
      }).not.toThrow();
    });
  });

  describe('Collapsible section structure', () => {

    it('should have correct HTML structure', () => {
      expect(mockHeader).toBeTruthy();
      expect(mockContent).toBeTruthy();
      expect(mockIcon).toBeTruthy();
    });

    it('should have header as previous sibling of content', () => {
      expect(mockContent.previousElementSibling).toBe(mockHeader);
    });

    it('should have icon inside header', () => {
      const iconParent = mockIcon.parentElement;
      expect(iconParent).toBe(mockHeader);
    });

    it('should have correct initial classes', () => {
      expect(mockHeader.classList.contains('collapsible-header')).toBe(true);
      expect(mockContent.classList.contains('collapsible-content')).toBe(true);
      expect(mockIcon.classList.contains('collapsible-icon')).toBe(true);
    });

    it('should start expanded (no collapsed class)', () => {
      expect(mockHeader.classList.contains('collapsed')).toBe(false);
      expect(mockContent.classList.contains('collapsed')).toBe(false);
    });
  });

  describe('Multiple collapsible sections', () => {

    beforeEach(() => {
      document.body.innerHTML = `
        <div class="subsection">
          <div class="collapsible-header" id="header1">
            <h3>Section 1</h3>
            <span class="collapsible-icon">▼</span>
          </div>
          <div class="collapsible-content" id="content1">
            <p>Content 1</p>
          </div>
        </div>
        <div class="subsection">
          <div class="collapsible-header" id="header2">
            <h3>Section 2</h3>
            <span class="collapsible-icon">▼</span>
          </div>
          <div class="collapsible-content" id="content2">
            <p>Content 2</p>
          </div>
        </div>
        <div class="subsection">
          <div class="collapsible-header" id="header3">
            <h3>Section 3</h3>
            <span class="collapsible-icon">▼</span>
          </div>
          <div class="collapsible-content" id="content3">
            <p>Content 3</p>
          </div>
        </div>
      `;
    });

    it('should toggle sections independently', () => {
      const header1 = document.getElementById('header1');
      const header2 = document.getElementById('header2');
      const header3 = document.getElementById('header3');
      const content1 = document.getElementById('content1');
      const content2 = document.getElementById('content2');
      const content3 = document.getElementById('content3');

      // Collapse section 1
      window.toggleSection(header1);
      expect(header1.classList.contains('collapsed')).toBe(true);
      expect(content1.classList.contains('collapsed')).toBe(true);

      // Section 2 and 3 should still be expanded
      expect(header2.classList.contains('collapsed')).toBe(false);
      expect(content2.classList.contains('collapsed')).toBe(false);
      expect(header3.classList.contains('collapsed')).toBe(false);
      expect(content3.classList.contains('collapsed')).toBe(false);

      // Collapse section 3
      window.toggleSection(header3);
      expect(header3.classList.contains('collapsed')).toBe(true);
      expect(content3.classList.contains('collapsed')).toBe(true);

      // Section 2 should still be expanded
      expect(header2.classList.contains('collapsed')).toBe(false);
      expect(content2.classList.contains('collapsed')).toBe(false);
    });

    it('should handle all sections collapsed', () => {
      const headers = document.querySelectorAll('.collapsible-header');

      headers.forEach(header => {
        window.toggleSection(header);
      });

      const collapsedHeaders = document.querySelectorAll('.collapsible-header.collapsed');
      const collapsedContents = document.querySelectorAll('.collapsible-content.collapsed');

      expect(collapsedHeaders.length).toBe(3);
      expect(collapsedContents.length).toBe(3);
    });

    it('should handle all sections expanded', () => {
      const headers = document.querySelectorAll('.collapsible-header');

      // Collapse all first
      headers.forEach(header => {
        window.toggleSection(header);
      });

      // Then expand all
      headers.forEach(header => {
        window.toggleSection(header);
      });

      const collapsedHeaders = document.querySelectorAll('.collapsible-header.collapsed');
      const collapsedContents = document.querySelectorAll('.collapsible-content.collapsed');

      expect(collapsedHeaders.length).toBe(0);
      expect(collapsedContents.length).toBe(0);
    });
  });

  describe('Edge cases', () => {

    it('should handle missing content element gracefully', () => {
      document.body.innerHTML = `
        <div class="collapsible-header" id="orphan-header">
          <h3>Orphan Section</h3>
          <span class="collapsible-icon">▼</span>
        </div>
      `;

      const orphanHeader = document.getElementById('orphan-header');

      // Should not throw even if content is missing
      expect(() => {
        window.toggleSection(orphanHeader);
      }).not.toThrow();
    });

    it('should work with content that has additional classes', () => {
      document.body.innerHTML = `
        <div class="subsection">
          <div class="collapsible-header">
            <h3>Test</h3>
            <span class="collapsible-icon">▼</span>
          </div>
          <div class="collapsible-content custom-class another-class">
            <p>Content with extra classes</p>
          </div>
        </div>
      `;

      const header = document.querySelector('.collapsible-header');
      const content = document.querySelector('.collapsible-content');

      window.toggleSection(header);

      expect(content.classList.contains('collapsed')).toBe(true);
      expect(content.classList.contains('custom-class')).toBe(true);
      expect(content.classList.contains('another-class')).toBe(true);
    });
  });

  describe('CSS classes and styling', () => {

    it('should maintain other classes when toggling', () => {
      mockHeader.classList.add('custom-header-class');
      mockContent.classList.add('custom-content-class');

      window.toggleSection(mockHeader);

      expect(mockHeader.classList.contains('custom-header-class')).toBe(true);
      expect(mockContent.classList.contains('custom-content-class')).toBe(true);
      expect(mockHeader.classList.contains('collapsed')).toBe(true);
      expect(mockContent.classList.contains('collapsed')).toBe(true);
    });

    it('should work with pre-collapsed sections', () => {
      mockHeader.classList.add('collapsed');
      mockContent.classList.add('collapsed');

      // Expanding a pre-collapsed section
      window.toggleSection(mockHeader);

      expect(mockHeader.classList.contains('collapsed')).toBe(false);
      expect(mockContent.classList.contains('collapsed')).toBe(false);
    });
  });
});
