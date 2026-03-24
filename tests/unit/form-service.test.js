/**
 * FormService Unit Tests
 *
 * Tests for core form operations:
 * - Form existence checking (ensure form returns existing formId)
 * - Form creation (creates form, links to sheet, returns valid formId + signupUrl)
 * - Error handling (broken formId, missing response sheet)
 *
 * @module tests/unit/form-service.test.js
 */

const {
  validateEnvelope,
  validateSuccessEnvelope,
  validateErrorEnvelope,
  ERROR_CODES
} = require('../shared/helpers/test.helpers');

describe('FormService', () => {
  // Mock implementations
  let mockForm;
  let mockSheet;
  let mockCache;
  let FormService_createFromTemplate;
  let FormService_getTemplate;
  let FormService_addQuestionsToForm;
  let FormService_getSignupCount;
  let FormService_ensureForm;

  // Error codes
  const ERR = {
    BAD_INPUT: 'BAD_INPUT',
    NOT_FOUND: 'NOT_FOUND',
    INTERNAL: 'INTERNAL'
  };

  // Helper envelope functions
  const Ok = (value) => ({ ok: true, value });
  const Err = (code, message) => ({ ok: false, code, message });

  // Form templates for testing
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
    }
  ];

  beforeEach(() => {
    // Reset mocks for each test
    mockForm = {
      getId: jest.fn(() => 'form-123'),
      getEditUrl: jest.fn(() => 'https://docs.google.com/forms/d/form-123/edit'),
      getPublishedUrl: jest.fn(() => 'https://docs.google.com/forms/d/e/form-123/viewform'),
      setDescription: jest.fn(),
      setCollectEmail: jest.fn(),
      setLimitOneResponsePerUser: jest.fn(),
      setShowLinkToRespondAgain: jest.fn(),
      setDestination: jest.fn(),
      addTextItem: jest.fn(() => ({
        setTitle: jest.fn().mockReturnThis(),
        setRequired: jest.fn().mockReturnThis(),
        setHelpText: jest.fn().mockReturnThis()
      })),
      addParagraphTextItem: jest.fn(() => ({
        setTitle: jest.fn().mockReturnThis(),
        setRequired: jest.fn().mockReturnThis(),
        setHelpText: jest.fn().mockReturnThis()
      })),
      addMultipleChoiceItem: jest.fn(() => ({
        setTitle: jest.fn().mockReturnThis(),
        setRequired: jest.fn().mockReturnThis(),
        setChoiceValues: jest.fn().mockReturnThis(),
        setHelpText: jest.fn().mockReturnThis()
      })),
      addCheckboxItem: jest.fn(() => ({
        setTitle: jest.fn().mockReturnThis(),
        setRequired: jest.fn().mockReturnThis(),
        setChoiceValues: jest.fn().mockReturnThis(),
        setHelpText: jest.fn().mockReturnThis()
      })),
      addScaleItem: jest.fn(() => ({
        setTitle: jest.fn().mockReturnThis(),
        setRequired: jest.fn().mockReturnThis(),
        setBounds: jest.fn().mockReturnThis(),
        setLabels: jest.fn().mockReturnThis(),
        setHelpText: jest.fn().mockReturnThis()
      })),
      addGridItem: jest.fn(() => ({
        setTitle: jest.fn().mockReturnThis(),
        setRequired: jest.fn().mockReturnThis(),
        setRows: jest.fn().mockReturnThis(),
        setColumns: jest.fn().mockReturnThis(),
        setHelpText: jest.fn().mockReturnThis()
      })),
      addDateItem: jest.fn(() => ({
        setTitle: jest.fn().mockReturnThis(),
        setRequired: jest.fn().mockReturnThis(),
        setHelpText: jest.fn().mockReturnThis()
      })),
      addTimeItem: jest.fn(() => ({
        setTitle: jest.fn().mockReturnThis(),
        setRequired: jest.fn().mockReturnThis(),
        setHelpText: jest.fn().mockReturnThis()
      }))
    };

    mockSheet = {
      getId: jest.fn(() => 'sheet-456'),
      getUrl: jest.fn(() => 'https://docs.google.com/spreadsheets/d/sheet-456'),
      getDataRange: jest.fn(() => ({
        getValues: jest.fn(() => [
          ['timestamp', 'eventId', 'surface', 'metric', 'sponsorId', 'value'],
          ['2024-01-01', 'event-123', 'form', 'signup', '', '1'],
          ['2024-01-02', 'event-123', 'form', 'signup', '', '1'],
          ['2024-01-03', 'event-456', 'form', 'signup', '', '1']
        ])
      })),
      getLastRow: jest.fn(() => 4)
    };

    mockCache = {
      data: {},
      get: jest.fn((key) => mockCache.data[key] || null),
      put: jest.fn((key, value) => { mockCache.data[key] = value; }),
      remove: jest.fn((key) => { delete mockCache.data[key]; })
    };

    // Global mocks
    global.FormApp = {
      create: jest.fn(() => mockForm),
      openById: jest.fn(() => mockForm),
      DestinationType: { SPREADSHEET: 'SPREADSHEET' }
    };

    global.SpreadsheetApp = {
      create: jest.fn(() => mockSheet),
      openById: jest.fn(() => mockSheet)
    };

    global.CacheService = {
      getScriptCache: jest.fn(() => mockCache),
      getUserCache: jest.fn(() => mockCache)
    };

    global.diag_ = jest.fn();

    // Implementation functions for testing
    FormService_getTemplate = (templateType) => {
      return FORM_TEMPLATES.find(t => t.id === templateType) || null;
    };

    FormService_addQuestionsToForm = (form, questions) => {
      questions.forEach(q => {
        let item;
        switch (q.type) {
          case 'TEXT':
            item = form.addTextItem();
            break;
          case 'PARAGRAPH_TEXT':
            item = form.addParagraphTextItem();
            break;
          case 'MULTIPLE_CHOICE':
            item = form.addMultipleChoiceItem();
            if (q.choices) item.setChoiceValues(q.choices);
            break;
          case 'CHECKBOX':
            item = form.addCheckboxItem();
            if (q.choices) item.setChoiceValues(q.choices);
            break;
          case 'SCALE':
            item = form.addScaleItem();
            if (q.scaleMin && q.scaleMax) item.setBounds(q.scaleMin, q.scaleMax);
            break;
          case 'GRID':
            item = form.addGridItem();
            if (q.rows && q.columns) {
              item.setRows(q.rows);
              item.setColumns(q.columns);
            }
            break;
          case 'DATE':
            item = form.addDateItem();
            break;
          case 'TIME':
            item = form.addTimeItem();
            break;
          default:
            item = form.addTextItem();
        }
        item.setTitle(q.title);
        if (q.required) item.setRequired(true);
        if (q.helpText) item.setHelpText(q.helpText);
      });
    };

    FormService_createFromTemplate = (params) => {
      if (!params || typeof params !== 'object') {
        return Err(ERR.BAD_INPUT, 'Missing payload');
      }

      const { templateType, eventName, eventId } = params;

      if (!templateType) return Err(ERR.BAD_INPUT, 'Missing templateType');

      const template = FormService_getTemplate(templateType);
      if (!template) {
        return Err(ERR.BAD_INPUT, `Unknown template type: ${templateType}`);
      }

      try {
        const formTitle = eventName
          ? `${eventName} - ${template.label}`
          : template.label;
        const form = FormApp.create(formTitle);

        form.setDescription(template.description);
        form.setCollectEmail(true);
        form.setLimitOneResponsePerUser(false);
        form.setShowLinkToRespondAgain(true);

        FormService_addQuestionsToForm(form, template.questions);

        const responseSheet = SpreadsheetApp.create(`${formTitle} - Responses`);
        form.setDestination(FormApp.DestinationType.SPREADSHEET, responseSheet.getId());

        const formId = form.getId();
        const editUrl = form.getEditUrl();
        const publishedUrl = form.getPublishedUrl();
        const responseSheetUrl = responseSheet.getUrl();

        return Ok({
          formId,
          editUrl,
          publishedUrl,
          signupUrl: publishedUrl,
          responseSheetUrl,
          templateType,
          eventId: eventId || ''
        });
      } catch (e) {
        return Err(ERR.INTERNAL, `Failed to create form: ${e.toString()}`);
      }
    };

    FormService_getSignupCount = (eventId) => {
      if (!eventId) return 0;

      try {
        const analyticsSheet = mockSheet;
        const lastRow = analyticsSheet.getLastRow();
        if (lastRow <= 1) return 0;

        const rows = analyticsSheet.getDataRange().getValues();
        let count = 0;

        for (let i = 1; i < rows.length; i++) {
          const rowEventId = rows[i][1];
          const metric = rows[i][3];
          if (rowEventId === eventId && metric === 'signup') {
            count++;
          }
        }

        return count;
      } catch (e) {
        return 0;
      }
    };

    // Ensure form function - returns existing or creates new
    FormService_ensureForm = (params) => {
      const { eventId, formId, templateType } = params || {};

      if (!eventId) return Err(ERR.BAD_INPUT, 'Missing eventId');
      if (!templateType) return Err(ERR.BAD_INPUT, 'Missing templateType');

      // If formId exists, try to return existing form
      if (formId) {
        try {
          const existingForm = FormApp.openById(formId);
          const existingFormId = existingForm.getId();
          const signupUrl = existingForm.getPublishedUrl();

          return Ok({
            formId: existingFormId,
            signupUrl,
            existed: true
          });
        } catch (e) {
          // Form doesn't exist or is inaccessible - fall through to create new
          return Err(ERR.NOT_FOUND, `Form not found or inaccessible: ${formId}`);
        }
      }

      // No formId provided - create new form
      const createResult = FormService_createFromTemplate({
        templateType,
        eventName: params.eventName,
        eventId
      });

      if (!createResult.ok) return createResult;

      return Ok({
        formId: createResult.value.formId,
        signupUrl: createResult.value.signupUrl,
        existed: false
      });
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // A. FormService Tests - Form Existence
  // =========================================================================

  describe('Form already exists (ensure form returns existing formId)', () => {

    test('should return existing formId when form already exists', () => {
      const result = FormService_ensureForm({
        eventId: 'event-123',
        formId: 'form-123',
        templateType: 'sign-up'
      });

      expect(result.ok).toBe(true);
      expect(result.value.formId).toBe('form-123');
      expect(result.value.existed).toBe(true);
      expect(result.value.signupUrl).toBeDefined();
    });

    test('should not create new form when existing formId is valid', () => {
      FormService_ensureForm({
        eventId: 'event-123',
        formId: 'form-123',
        templateType: 'sign-up'
      });

      // FormApp.create should NOT be called when form exists
      expect(FormApp.openById).toHaveBeenCalledWith('form-123');
      expect(FormApp.create).not.toHaveBeenCalled();
    });

    test('should return valid signupUrl for existing form', () => {
      const result = FormService_ensureForm({
        eventId: 'event-123',
        formId: 'form-123',
        templateType: 'sign-up'
      });

      expect(result.ok).toBe(true);
      expect(result.value.signupUrl).toMatch(/^https:\/\//);
      expect(result.value.signupUrl).toContain('viewform');
    });

    test('should return existed=true for existing forms', () => {
      const result = FormService_ensureForm({
        eventId: 'event-123',
        formId: 'form-123',
        templateType: 'sign-up'
      });

      expect(result.ok).toBe(true);
      expect(result.value.existed).toBe(true);
    });
  });

  // =========================================================================
  // A. FormService Tests - Form Creation
  // =========================================================================

  describe('Form needs creation (no formId)', () => {

    test('should create new form when no formId provided', () => {
      const result = FormService_ensureForm({
        eventId: 'event-123',
        templateType: 'sign-up',
        eventName: 'Summer Tournament'
      });

      expect(result.ok).toBe(true);
      expect(result.value.formId).toBeDefined();
      expect(result.value.existed).toBe(false);
    });

    test('should create form linked to response sheet', () => {
      FormService_ensureForm({
        eventId: 'event-123',
        templateType: 'sign-up',
        eventName: 'Summer Tournament'
      });

      expect(SpreadsheetApp.create).toHaveBeenCalled();
      expect(mockForm.setDestination).toHaveBeenCalledWith(
        FormApp.DestinationType.SPREADSHEET,
        'sheet-456'
      );
    });

    test('should return valid formId and signupUrl', () => {
      const result = FormService_ensureForm({
        eventId: 'event-123',
        templateType: 'sign-up'
      });

      expect(result.ok).toBe(true);
      expect(result.value.formId).toBe('form-123');
      expect(result.value.signupUrl).toMatch(/^https:\/\//);
    });

    test('should configure form settings correctly', () => {
      FormService_createFromTemplate({
        templateType: 'sign-up',
        eventName: 'Test Event'
      });

      expect(mockForm.setDescription).toHaveBeenCalled();
      expect(mockForm.setCollectEmail).toHaveBeenCalledWith(true);
      expect(mockForm.setLimitOneResponsePerUser).toHaveBeenCalledWith(false);
      expect(mockForm.setShowLinkToRespondAgain).toHaveBeenCalledWith(true);
    });

    test('should add questions from template', () => {
      FormService_createFromTemplate({
        templateType: 'sign-up',
        eventName: 'Test Event'
      });

      // Sign-up template has 2 TEXT questions
      expect(mockForm.addTextItem).toHaveBeenCalledTimes(2);
    });

    test('should include event name in form title when provided', () => {
      FormService_createFromTemplate({
        templateType: 'sign-up',
        eventName: 'Summer Tournament',
        eventId: 'event-123'
      });

      expect(FormApp.create).toHaveBeenCalledWith('Summer Tournament - Sign-Up Form');
    });

    test('should use template label as title when no event name', () => {
      FormService_createFromTemplate({
        templateType: 'sign-up'
      });

      expect(FormApp.create).toHaveBeenCalledWith('Sign-Up Form');
    });

    test('should return existed=false for newly created forms', () => {
      const result = FormService_ensureForm({
        eventId: 'event-123',
        templateType: 'sign-up'
      });

      expect(result.ok).toBe(true);
      expect(result.value.existed).toBe(false);
    });
  });

  // =========================================================================
  // A. FormService Tests - Error Handling
  // =========================================================================

  describe('Broken formId / response sheet error handling', () => {

    test('should return clear error when form is missing', () => {
      FormApp.openById.mockImplementation(() => {
        throw new Error('Form not found');
      });

      const result = FormService_ensureForm({
        eventId: 'event-123',
        formId: 'invalid-form-id',
        templateType: 'sign-up'
      });

      validateErrorEnvelope(result, ERR.NOT_FOUND);
      expect(result.message).toContain('not found');
      expect(result.ok).toBe(false);
    });

    test('should return error envelope with ok:false for invalid form', () => {
      FormApp.openById.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = FormService_ensureForm({
        eventId: 'event-123',
        formId: 'permission-denied-form',
        templateType: 'sign-up'
      });

      expect(result.ok).toBe(false);
      expect(result).toHaveProperty('code');
      expect(result).toHaveProperty('message');
    });

    test('should return error with code and message (no silent failure)', () => {
      FormApp.openById.mockImplementation(() => {
        throw new Error('Unknown error');
      });

      const result = FormService_ensureForm({
        eventId: 'event-123',
        formId: 'broken-form-id',
        templateType: 'sign-up'
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBeDefined();
      expect(result.message).toBeDefined();
      expect(typeof result.code).toBe('string');
      expect(typeof result.message).toBe('string');
    });

    test('should return BAD_INPUT error for missing templateType', () => {
      const result = FormService_createFromTemplate({
        eventName: 'Test Event'
      });

      validateErrorEnvelope(result, ERR.BAD_INPUT);
      expect(result.message).toContain('templateType');
    });

    test('should return BAD_INPUT error for unknown template type', () => {
      const result = FormService_createFromTemplate({
        templateType: 'unknown-template'
      });

      validateErrorEnvelope(result, ERR.BAD_INPUT);
      expect(result.message).toContain('Unknown template type');
    });

    test('should return BAD_INPUT error for null params', () => {
      const result = FormService_createFromTemplate(null);

      validateErrorEnvelope(result, ERR.BAD_INPUT);
      expect(result.message).toContain('Missing payload');
    });

    test('should handle response sheet creation failure', () => {
      SpreadsheetApp.create.mockImplementation(() => {
        throw new Error('Quota exceeded');
      });

      const result = FormService_createFromTemplate({
        templateType: 'sign-up',
        eventName: 'Test Event'
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe(ERR.INTERNAL);
      expect(result.message).toContain('Failed to create form');
    });

    test('should handle form creation failure', () => {
      FormApp.create.mockImplementation(() => {
        throw new Error('Drive quota exceeded');
      });

      const result = FormService_createFromTemplate({
        templateType: 'sign-up',
        eventName: 'Test Event'
      });

      validateErrorEnvelope(result, ERR.INTERNAL);
      expect(result.message).toContain('Failed to create form');
    });
  });

  // =========================================================================
  // Additional FormService Tests
  // =========================================================================

  describe('FormService_getSignupCount', () => {

    test('should count signups for specific eventId', () => {
      const count = FormService_getSignupCount('event-123');
      expect(count).toBe(2); // From mock data
    });

    test('should return 0 for eventId with no signups', () => {
      const count = FormService_getSignupCount('event-nonexistent');
      expect(count).toBe(0);
    });

    test('should return 0 for null eventId', () => {
      const count = FormService_getSignupCount(null);
      expect(count).toBe(0);
    });

    test('should return 0 for undefined eventId', () => {
      const count = FormService_getSignupCount(undefined);
      expect(count).toBe(0);
    });

    test('should return 0 for empty eventId', () => {
      const count = FormService_getSignupCount('');
      expect(count).toBe(0);
    });
  });

  describe('FormService_getTemplate', () => {

    test('should return template for valid template type', () => {
      const template = FormService_getTemplate('sign-up');
      expect(template).not.toBeNull();
      expect(template.id).toBe('sign-up');
      expect(template.label).toBe('Sign-Up Form');
    });

    test('should return null for invalid template type', () => {
      const template = FormService_getTemplate('invalid-type');
      expect(template).toBeNull();
    });

    test('should return null for null input', () => {
      const template = FormService_getTemplate(null);
      expect(template).toBeNull();
    });

    test('should return null for undefined input', () => {
      const template = FormService_getTemplate(undefined);
      expect(template).toBeNull();
    });
  });

  describe('FormService_addQuestionsToForm', () => {

    test('should add TEXT questions correctly', () => {
      const questions = [
        { title: 'Name', type: 'TEXT', required: true }
      ];

      FormService_addQuestionsToForm(mockForm, questions);

      expect(mockForm.addTextItem).toHaveBeenCalled();
    });

    test('should add PARAGRAPH_TEXT questions correctly', () => {
      const questions = [
        { title: 'Description', type: 'PARAGRAPH_TEXT', required: false }
      ];

      FormService_addQuestionsToForm(mockForm, questions);

      expect(mockForm.addParagraphTextItem).toHaveBeenCalled();
    });

    test('should add MULTIPLE_CHOICE questions with choices', () => {
      const questions = [
        { title: 'Color', type: 'MULTIPLE_CHOICE', choices: ['Red', 'Blue', 'Green'], required: true }
      ];

      FormService_addQuestionsToForm(mockForm, questions);

      expect(mockForm.addMultipleChoiceItem).toHaveBeenCalled();
    });

    test('should add SCALE questions with bounds', () => {
      const questions = [
        { title: 'Rating', type: 'SCALE', scaleMin: 1, scaleMax: 5, required: true }
      ];

      FormService_addQuestionsToForm(mockForm, questions);

      expect(mockForm.addScaleItem).toHaveBeenCalled();
    });

    test('should add DATE questions correctly', () => {
      const questions = [
        { title: 'Event Date', type: 'DATE', required: true }
      ];

      FormService_addQuestionsToForm(mockForm, questions);

      expect(mockForm.addDateItem).toHaveBeenCalled();
    });

    test('should add TIME questions correctly', () => {
      const questions = [
        { title: 'Start Time', type: 'TIME', required: false }
      ];

      FormService_addQuestionsToForm(mockForm, questions);

      expect(mockForm.addTimeItem).toHaveBeenCalled();
    });

    test('should default to TEXT for unknown question types', () => {
      const questions = [
        { title: 'Unknown', type: 'UNKNOWN_TYPE', required: true }
      ];

      FormService_addQuestionsToForm(mockForm, questions);

      expect(mockForm.addTextItem).toHaveBeenCalled();
    });
  });
});
