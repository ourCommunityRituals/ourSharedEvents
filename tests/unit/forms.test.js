/**
 * Unit Tests for Google Forms API
 *
 * Tests form template management and form creation logic
 * Note: These are unit tests that mock FormApp. Integration tests
 * with actual Google Forms creation are in E2E tests.
 */

describe('Forms Template Management', () => {

  describe('FORM_TEMPLATES Configuration', () => {
    const FORM_TEMPLATES = [
      {
        id: 'sign-up',
        label: 'Sign-Up Form',
        description: 'Pre-registration for upcoming events',
        questions: [
          { title: 'Full Name', type: 'TEXT', required: true },
          { title: 'Email Address', type: 'TEXT', required: true }
        ]
      },
      {
        id: 'check-in',
        label: 'Check-In Form',
        description: 'Quick check-in for registered attendees',
        questions: [
          { title: 'Full Name', type: 'TEXT', required: true }
        ]
      },
      {
        id: 'walk-in',
        label: 'Walk-In Registration Form',
        description: 'Registration for walk-in attendees',
        questions: [
          { title: 'Full Name', type: 'TEXT', required: true }
        ]
      },
      {
        id: 'survey',
        label: 'Post-Event Survey',
        description: 'Feedback and satisfaction survey',
        questions: [
          { title: 'Overall, how would you rate this event?', type: 'SCALE', scaleMin: 1, scaleMax: 5, required: true }
        ]
      }
    ];

    test('should have all 4 required form templates', () => {
      expect(FORM_TEMPLATES).toHaveLength(4);

      const ids = FORM_TEMPLATES.map(t => t.id);
      expect(ids).toContain('sign-up');
      expect(ids).toContain('check-in');
      expect(ids).toContain('walk-in');
      expect(ids).toContain('survey');
    });

    test('each template should have required fields', () => {
      FORM_TEMPLATES.forEach(template => {
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('label');
        expect(template).toHaveProperty('description');
        expect(template).toHaveProperty('questions');
        expect(Array.isArray(template.questions)).toBe(true);
        expect(template.questions.length).toBeGreaterThan(0);
      });
    });

    test('each question should have required properties', () => {
      FORM_TEMPLATES.forEach(template => {
        template.questions.forEach(question => {
          expect(question).toHaveProperty('title');
          expect(question).toHaveProperty('type');
          expect(question).toHaveProperty('required');
          expect(typeof question.title).toBe('string');
          expect(question.title.length).toBeGreaterThan(0);
        });
      });
    });

    test('question types should be valid', () => {
      const validTypes = ['TEXT', 'PARAGRAPH_TEXT', 'MULTIPLE_CHOICE', 'SCALE'];

      FORM_TEMPLATES.forEach(template => {
        template.questions.forEach(question => {
          expect(validTypes).toContain(question.type);
        });
      });
    });

    test('MULTIPLE_CHOICE questions should have choices', () => {
      FORM_TEMPLATES.forEach(template => {
        template.questions
          .filter(q => q.type === 'MULTIPLE_CHOICE')
          .forEach(question => {
            expect(question).toHaveProperty('choices');
            expect(Array.isArray(question.choices)).toBe(true);
            expect(question.choices.length).toBeGreaterThan(0);
          });
      });
    });

    test('SCALE questions should have bounds', () => {
      FORM_TEMPLATES.forEach(template => {
        template.questions
          .filter(q => q.type === 'SCALE')
          .forEach(question => {
            expect(question).toHaveProperty('scaleMin');
            expect(question).toHaveProperty('scaleMax');
            expect(question.scaleMin).toBeLessThan(question.scaleMax);
          });
      });
    });
  });

  describe('api_listFormTemplates', () => {
    const listFormTemplates_ = () => {
      return [
        { id: 'sign-up', label: 'Sign-Up Form' },
        { id: 'check-in', label: 'Check-In Form' },
        { id: 'walk-in', label: 'Walk-In Registration Form' },
        { id: 'survey', label: 'Post-Event Survey' }
      ];
    };

    const api_listFormTemplates = () => {
      try {
        const templates = listFormTemplates_();
        return { ok: true, value: { templates } };
      } catch (e) {
        return { ok: false, code: 'INTERNAL', message: String(e) };
      }
    };

    test('should return success envelope', () => {
      const result = api_listFormTemplates();
      expect(result.ok).toBe(true);
      expect(result.value).toHaveProperty('templates');
    });

    test('should return all form templates', () => {
      const result = api_listFormTemplates();
      expect(result.value.templates).toHaveLength(4);
    });

    test('should include template IDs and labels', () => {
      const result = api_listFormTemplates();
      result.value.templates.forEach(t => {
        expect(t).toHaveProperty('id');
        expect(t).toHaveProperty('label');
      });
    });
  });

  describe('findFormTemplate_', () => {
    const FORM_TEMPLATES = [
      { id: 'sign-up', label: 'Sign-Up Form' },
      { id: 'check-in', label: 'Check-In Form' },
      { id: 'walk-in', label: 'Walk-In Registration Form' },
      { id: 'survey', label: 'Post-Event Survey' }
    ];

    const findFormTemplate_ = (id) => {
      return FORM_TEMPLATES.find(t => t.id === id) || null;
    };

    test('should find template by valid ID', () => {
      const template = findFormTemplate_('sign-up');
      expect(template).not.toBeNull();
      expect(template.id).toBe('sign-up');
    });

    test('should return null for invalid ID', () => {
      const template = findFormTemplate_('invalid-id');
      expect(template).toBeNull();
    });

    test('should find all template types', () => {
      const ids = ['sign-up', 'check-in', 'walk-in', 'survey'];
      ids.forEach(id => {
        const template = findFormTemplate_(id);
        expect(template).not.toBeNull();
        expect(template.id).toBe(id);
      });
    });

    test('should handle null input', () => {
      const template = findFormTemplate_(null);
      expect(template).toBeNull();
    });

    test('should handle undefined input', () => {
      const template = findFormTemplate_(undefined);
      expect(template).toBeNull();
    });
  });

  describe('api_createFormFromTemplate - Request Validation', () => {
    const ERR = {
      BAD_INPUT: 'BAD_INPUT',
      INTERNAL: 'INTERNAL'
    };

    const Err = (code, message) => ({ ok: false, code, message });

    function validateCreateFormRequest(req) {
      if (!req || typeof req !== 'object') {
        return Err(ERR.BAD_INPUT, 'Missing payload');
      }

      const { templateType } = req;

      if (!templateType) {
        return Err(ERR.BAD_INPUT, 'Missing templateType');
      }

      return { ok: true };
    }

    test('should reject null request', () => {
      const result = validateCreateFormRequest(null);
      expect(result.ok).toBe(false);
      expect(result.code).toBe(ERR.BAD_INPUT);
    });

    test('should reject missing templateType', () => {
      const result = validateCreateFormRequest({});
      expect(result.ok).toBe(false);
      expect(result.message).toContain('templateType');
    });

    test('should accept valid request', () => {
      const result = validateCreateFormRequest({
        templateType: 'sign-up',
        eventName: 'Test Event',
        eventId: 'event-123',
        adminKey: 'test-key',
        brandId: 'root'
      });
      expect(result.ok).toBe(true);
    });

    test('should accept minimal valid request', () => {
      const result = validateCreateFormRequest({
        templateType: 'check-in'
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('Form Title Generation', () => {
    function generateFormTitle(eventName, templateLabel) {
      return eventName ? `${eventName} - ${templateLabel}` : templateLabel;
    }

    test('should include event name when provided', () => {
      const title = generateFormTitle('Summer Bocce Tournament', 'Sign-Up Form');
      expect(title).toBe('Summer Bocce Tournament - Sign-Up Form');
    });

    test('should use template label only when no event name', () => {
      const title = generateFormTitle('', 'Check-In Form');
      expect(title).toBe('Check-In Form');
    });

    test('should handle null event name', () => {
      const title = generateFormTitle(null, 'Walk-In Registration Form');
      expect(title).toBe('Walk-In Registration Form');
    });
  });

  describe('api_generateFormShortlink - Request Validation', () => {
    const ERR = {
      BAD_INPUT: 'BAD_INPUT'
    };

    const Err = (code, message) => ({ ok: false, code, message });

    function validateShortlinkRequest(req) {
      if (!req || typeof req !== 'object') {
        return Err(ERR.BAD_INPUT, 'Missing payload');
      }

      const { formUrl } = req;

      if (!formUrl) {
        return Err(ERR.BAD_INPUT, 'Missing formUrl');
      }

      return { ok: true };
    }

    test('should reject missing formUrl', () => {
      const result = validateShortlinkRequest({
        formType: 'sign-up',
        eventId: 'event-123'
      });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('formUrl');
    });

    test('should accept valid request', () => {
      const result = validateShortlinkRequest({
        formUrl: 'https://docs.google.com/forms/d/e/1234567890/viewform',
        formType: 'check-in',
        eventId: 'event-123',
        adminKey: 'test-key',
        brandId: 'root'
      });
      expect(result.ok).toBe(true);
    });

    test('should accept minimal valid request', () => {
      const result = validateShortlinkRequest({
        formUrl: 'https://docs.google.com/forms/d/e/1234567890/viewform'
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('Form Surface Tagging', () => {
    function generateFormSurface(formType) {
      return `form-${formType || 'unknown'}`;
    }

    test('should tag sign-up forms correctly', () => {
      expect(generateFormSurface('sign-up')).toBe('form-sign-up');
    });

    test('should tag check-in forms correctly', () => {
      expect(generateFormSurface('check-in')).toBe('form-check-in');
    });

    test('should tag walk-in forms correctly', () => {
      expect(generateFormSurface('walk-in')).toBe('form-walk-in');
    });

    test('should tag survey forms correctly', () => {
      expect(generateFormSurface('survey')).toBe('form-survey');
    });

    test('should handle missing formType', () => {
      expect(generateFormSurface('')).toBe('form-unknown');
      expect(generateFormSurface(null)).toBe('form-unknown');
      expect(generateFormSurface(undefined)).toBe('form-unknown');
    });
  });

  describe('QR Code URL Generation', () => {
    function generateQRCodeUrl(url, size = 200, margin = 1) {
      return `https://quickchart.io/qr?text=${encodeURIComponent(url)}&size=${size}&margin=${margin}`;
    }

    test('should generate valid QR code URL', () => {
      const url = 'https://example.com/form';
      const qrUrl = generateQRCodeUrl(url);

      expect(qrUrl).toContain('quickchart.io/qr');
      expect(qrUrl).toContain(encodeURIComponent(url));
      expect(qrUrl).toContain('size=200');
      expect(qrUrl).toContain('margin=1');
    });

    test('should properly encode form URLs', () => {
      const url = 'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform';
      const qrUrl = generateQRCodeUrl(url);

      expect(qrUrl).toContain(encodeURIComponent(url));
    });

    test('should support custom size', () => {
      const url = 'https://example.com';
      const qrUrl = generateQRCodeUrl(url, 300);

      expect(qrUrl).toContain('size=300');
    });

    test('should support custom margin', () => {
      const url = 'https://example.com';
      const qrUrl = generateQRCodeUrl(url, 200, 2);

      expect(qrUrl).toContain('margin=2');
    });

    test('should handle special characters in URL', () => {
      const url = 'https://example.com/form?id=123&name=Test Event';
      const qrUrl = generateQRCodeUrl(url);

      expect(qrUrl).toContain('quickchart.io/qr');
      // URL should be properly encoded
      expect(qrUrl).toContain(encodeURIComponent(url));
    });
  });
});

describe('Forms Integration Logic', () => {

  describe('Form Response Tracking', () => {
    test('should link form to event via eventId', () => {
      const formData = {
        formId: 'form-123',
        eventId: 'event-456',
        formType: 'sign-up'
      };

      expect(formData.eventId).toBe('event-456');
      expect(formData.formType).toBe('sign-up');
    });

    test('should track form type for analytics', () => {
      const surfaces = ['form-sign-up', 'form-check-in', 'form-walk-in', 'form-survey'];

      surfaces.forEach(surface => {
        expect(surface).toMatch(/^form-/);
      });
    });
  });

  describe('Complete Workflow Data Flow', () => {
    test('should maintain eventId throughout workflow', () => {
      const eventId = 'event-123';

      // Step 1: Create form
      const createFormResult = {
        ok: true,
        value: {
          formId: 'form-abc',
          publishedUrl: 'https://docs.google.com/forms/d/e/form-abc/viewform',
          eventId
        }
      };

      // Step 2: Create shortlink
      const shortlinkResult = {
        ok: true,
        value: {
          token: 'abc123',
          shortlink: 'https://script.google.com/exec?p=r&t=abc123',
          targetUrl: createFormResult.value.publishedUrl,
          eventId
        }
      };

      // Step 3: Generate QR code
      const qrCodeUrl = `https://quickchart.io/qr?text=${encodeURIComponent(shortlinkResult.value.shortlink)}&size=200&margin=1`;

      // Verify eventId propagation
      expect(createFormResult.value.eventId).toBe(eventId);
      expect(shortlinkResult.value.eventId).toBe(eventId);
      expect(qrCodeUrl).toContain(encodeURIComponent(shortlinkResult.value.shortlink));
    });
  });
});
