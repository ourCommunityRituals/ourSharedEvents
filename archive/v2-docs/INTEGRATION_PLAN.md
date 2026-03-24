# Integration Plan: Webhooks & Internationalization

**Version:** 1.0.0
**Date:** 2025-11-18
**Status:** Ready for Implementation

---

## Executive Summary

Both **WebhookService.gs** and **i18nService.gs** already exist in the codebase with comprehensive functionality. This plan focuses on **integrating** these services into the application rather than building them from scratch.

### What Exists:
- ✅ WebhookService.gs (660 lines) - Full webhook infrastructure
- ✅ i18nService.gs (615 lines) - Complete i18n system with 8 locales

### What's Needed:
- 🔄 Integrate webhooks into Code.gs to trigger events
- 🔄 Integrate i18n into front-end HTML files
- 🔄 Add webhook management UI (optional)
- 🔄 Add locale switcher UI (optional)

---

## Part 1: Webhook Integration

### 1.1 Current State

**Existing Features:**
- ✅ Webhook registration and management
- ✅ HMAC-SHA256 payload signing (Zapier-compatible)
- ✅ Event types: `event.created`, `event.updated`, `event.deleted`, `form.submitted`, `sponsor.performance`, etc.
- ✅ Delivery tracking in `WEBHOOK_DELIVERIES` sheet
- ✅ Retry logic built-in
- ✅ Test delivery endpoint

**Storage:**
- `WEBHOOKS` sheet: webhook configurations
- `WEBHOOK_DELIVERIES` sheet: delivery history

**API Functions:**
- `WebhookService_register(params)` - Register webhook
- `WebhookService_unregister(params)` - Remove webhook
- `WebhookService_list(params)` - List all webhooks
- `WebhookService_deliver(eventType, payload, brandId)` - **Main integration point**
- `WebhookService_test(params)` - Test delivery
- `WebhookService_getDeliveries(params)` - Get delivery history

### 1.2 Integration Points

**File:** `Code.gs`

#### 1.2.1 Event Creation Webhook (Line ~1815)

**Current Code:**
```javascript
diag_('info','api_create','created',{id,brandId,scope});
return Ok({ id, links });
```

**Add After Line 1815:**
```javascript
diag_('info','api_create','created',{id,brandId,scope});

// 🔥 NEW: Trigger webhook for event creation
try {
  WebhookService_deliver(
    WEBHOOK_EVENTS.EVENT_CREATED,
    {
      id: id,
      brandId: brandId,
      scope: scope,
      templateId: templateId,
      data: sanitizedData,
      slug: slug,
      createdAt: new Date().toISOString(),
      links: links
    },
    brandId
  );
} catch (webhookError) {
  // Non-blocking: log error but don't fail the request
  Logger.log('Webhook delivery error: ' + webhookError);
  diag_('error', 'api_create', 'webhook_failed', { error: webhookError.message });
}

return Ok({ id, links });
```

#### 1.2.2 Event Update Webhook (Line ~1889)

**Current Code:**
```javascript
diag_('info','api_updateEventData','updated',{id: sanitizedId,brandId,scope,data});

return api_get({ brandId, scope: scope||'events', id: sanitizedId });
```

**Add After Line 1889:**
```javascript
diag_('info','api_updateEventData','updated',{id: sanitizedId,brandId,scope,data});

// 🔥 NEW: Trigger webhook for event update
try {
  const eventData = api_get({ brandId, scope: scope||'events', id: sanitizedId });
  if (eventData.ok) {
    WebhookService_deliver(
      WEBHOOK_EVENTS.EVENT_UPDATED,
      {
        id: sanitizedId,
        brandId: brandId,
        scope: scope || 'events',
        updatedFields: Object.keys(data || {}),
        data: eventData.value.data,
        updatedAt: new Date().toISOString()
      },
      brandId
    );
  }
} catch (webhookError) {
  // Non-blocking: log error but don't fail the request
  Logger.log('Webhook delivery error: ' + webhookError);
  diag_('error', 'api_updateEventData', 'webhook_failed', { error: webhookError.message });
}

return api_get({ brandId, scope: scope||'events', id: sanitizedId });
```

#### 1.2.3 Additional Integration Points (Optional)

**Form Submissions** - Add to form submission handler:
```javascript
WebhookService_deliver(
  WEBHOOK_EVENTS.FORM_SUBMITTED,
  { formId, responses, submittedAt, eventId },
  brandId
);
```

**Analytics Thresholds** - Add to analytics service:
```javascript
// When CTR crosses threshold
if (ctr > HIGH_CTR_THRESHOLD) {
  WebhookService_deliver(
    WEBHOOK_EVENTS.SPONSOR_CTR_HIGH,
    { sponsorId, ctr, threshold, eventId },
    brandId
  );
}
```

### 1.3 API Endpoint Integration

**Add to `doPost(e)` handler** (around line 409) to expose webhook management:

```javascript
case 'webhooks/register':
  return jsonResponse_(WebhookService_register(payload));

case 'webhooks/unregister':
  return jsonResponse_(WebhookService_unregister(payload));

case 'webhooks/list':
  return jsonResponse_(WebhookService_list(payload));

case 'webhooks/test':
  return jsonResponse_(WebhookService_test(payload));

case 'webhooks/deliveries':
  return jsonResponse_(WebhookService_getDeliveries(payload));
```

### 1.4 Webhook Management UI (Optional)

Create `WebhookManager.html` for admin interface:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Webhook Management</title>
  <?!= include('Styles'); ?>
  <?!= include('NUSDK'); ?>
</head>
<body>
  <?!= include('Header'); ?>

  <main class="container">
    <h1>Webhook Management</h1>

    <!-- Register Webhook Form -->
    <section class="card">
      <h2>Register New Webhook</h2>
      <form id="registerForm">
        <div class="form-group">
          <label>Event Type</label>
          <select name="eventType" required>
            <option value="event.created">Event Created</option>
            <option value="event.updated">Event Updated</option>
            <option value="event.deleted">Event Deleted</option>
            <option value="form.submitted">Form Submitted</option>
            <option value="sponsor.performance">Sponsor Performance</option>
          </select>
        </div>

        <div class="form-group">
          <label>Target URL</label>
          <input type="url" name="url" placeholder="https://your-app.com/webhook" required />
        </div>

        <div class="form-group">
          <label>Secret (optional)</label>
          <input type="text" name="secret" placeholder="Auto-generated if blank" />
        </div>

        <button type="submit">Register Webhook</button>
      </form>
    </section>

    <!-- Webhook List -->
    <section class="card">
      <h2>Registered Webhooks</h2>
      <div id="webhookList"></div>
    </section>

    <!-- Delivery History -->
    <section class="card">
      <h2>Recent Deliveries</h2>
      <div id="deliveryList"></div>
    </section>
  </main>

  <script>
    const SDK = window.NuSDK;

    // Register webhook
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);

      const result = await SDK.callAPI('webhooks/register', {
        brandId: SDK.getBrandId(),
        eventType: formData.get('eventType'),
        url: formData.get('url'),
        secret: formData.get('secret') || undefined,
        adminKey: SDK.getAdminKey()
      });

      if (result.ok) {
        alert('Webhook registered successfully!');
        loadWebhooks();
      } else {
        alert('Error: ' + result.error);
      }
    });

    // Load webhooks
    async function loadWebhooks() {
      const result = await SDK.callAPI('webhooks/list', {
        brandId: SDK.getBrandId(),
        adminKey: SDK.getAdminKey()
      });

      if (result.ok) {
        const html = result.value.webhooks.map(wh => `
          <div class="webhook-item">
            <strong>${wh.eventType}</strong> → ${wh.url}
            <button onclick="testWebhook('${wh.id}')">Test</button>
            <button onclick="deleteWebhook('${wh.id}')">Delete</button>
          </div>
        `).join('');

        document.getElementById('webhookList').innerHTML = html;
      }
    }

    // Test webhook
    async function testWebhook(webhookId) {
      const result = await SDK.callAPI('webhooks/test', {
        brandId: SDK.getBrandId(),
        webhookId: webhookId,
        adminKey: SDK.getAdminKey()
      });

      if (result.ok) {
        alert(`Test delivery ${result.value.success ? 'succeeded' : 'failed'}: ${result.value.statusCode}`);
      }
    }

    // Delete webhook
    async function deleteWebhook(webhookId) {
      if (!confirm('Delete this webhook?')) return;

      const result = await SDK.callAPI('webhooks/unregister', {
        brandId: SDK.getBrandId(),
        webhookId: webhookId,
        adminKey: SDK.getAdminKey()
      });

      if (result.ok) {
        loadWebhooks();
      }
    }

    // Initial load
    loadWebhooks();
  </script>
</body>
</html>
```

### 1.5 Zapier Integration Guide

**For Users:**

1. **Create a Zap** in Zapier with "Webhooks by Zapier" trigger
2. **Get Webhook URL** from Zapier (e.g., `https://hooks.zapier.com/hooks/catch/12345/abcde/`)
3. **Register in MVP-EVENT-TOOLKIT:**
   ```javascript
   {
     "brandId": "root",
     "eventType": "event.created",
     "url": "https://hooks.zapier.com/hooks/catch/12345/abcde/",
     "adminKey": "your-admin-key"
   }
   ```
4. **Test the webhook** using the test button
5. **Configure Zapier actions** (Send to Slack, Add to CRM, etc.)

**Signature Verification:**

Webhooks include `X-Webhook-Signature` header (HMAC-SHA256). Use `WebhookService_verifySignature()` to validate:

```javascript
const payload = request.body;
const signature = request.headers['X-Webhook-Signature'];
const secret = 'your-webhook-secret';

const isValid = WebhookService_verifySignature(payload, signature, secret);
```

### 1.6 Testing Plan

**Unit Tests:**
- ✅ WebhookService already has comprehensive tests
- 🔄 Add integration tests for webhook triggers

**Integration Tests:**
```javascript
// Test webhook delivery on event creation
function test_webhookOnEventCreate() {
  // Register test webhook
  const webhook = WebhookService_register({
    brandId: 'root',
    eventType: 'event.created',
    url: 'https://webhook.site/unique-id',
    adminKey: getAdminSecret_('root')
  });

  // Create event
  const event = api_create({
    brandId: 'root',
    scope: 'events',
    templateId: 'event',
    data: { name: 'Test Event' },
    adminKey: getAdminSecret_('root')
  });

  // Wait for delivery
  Utilities.sleep(2000);

  // Check delivery history
  const deliveries = WebhookService_getDeliveries({
    brandId: 'root',
    webhookId: webhook.value.id,
    adminKey: getAdminSecret_('root')
  });

  assert(deliveries.value.deliveries.length > 0);
  assert(deliveries.value.deliveries[0].success);
}
```

---

## Part 2: Internationalization (i18n) Integration

### 2.1 Current State

**Existing Features:**
- ✅ 8 supported locales: en-US, es-ES, fr-FR, de-DE, pt-BR, zh-CN, ja-JP, ko-KR
- ✅ Locale detection from URL params, user preferences, Accept-Language header
- ✅ Translation key resolution with fallback chains
- ✅ Date/number/currency formatting
- ✅ Parameterized translations (e.g., `"Minimum length is {min} characters"`)

**API Functions:**
- `i18n_detectLocale(params)` - Auto-detect user's locale
- `i18n_translate(key, locale, params)` - Get translation
- `i18n_formatDate(date, locale, options)` - Format dates
- `i18n_formatNumber(number, locale, options)` - Format numbers
- `i18n_formatCurrency(amount, locale, options)` - Format currency
- `i18n_setUserLocale(locale)` - Save user preference
- `i18n_getSupportedLocales()` - Get available locales

**Translation Structure:**
```javascript
TRANSLATIONS[locale][category][key]

// Example:
TRANSLATIONS['es-ES']['events']['createButton'] // → "Crear Evento"
```

### 2.2 Backend Integration

#### 2.2.1 Add Locale Detection to `doGet(e)` (Line ~233)

**Current Code:**
```javascript
function doGet(e){
  return runSafe('doGet', () => {
    const { p, page, brand, ...rest } = e.parameter || {};
```

**Add Locale Detection:**
```javascript
function doGet(e){
  return runSafe('doGet', () => {
    const { p, page, brand, lang, ...rest } = e.parameter || {};

    // 🔥 NEW: Detect user locale
    const locale = i18n_detectLocale({
      langParam: lang,
      acceptLanguage: e.headers?.['Accept-Language']
    });
```

#### 2.2.2 Pass Locale to Templates

**Modify `routePage_()` function:**

```javascript
function routePage_(e, page, brand, demoMode, options) {
  // ... existing code ...

  // 🔥 NEW: Add locale to template variables
  const locale = options.locale || DEFAULT_LOCALE;

  const tpl = HtmlService.createTemplateFromFile(htmlFile);
  tpl.appTitle = ZEB.APP_TITLE;
  tpl.brand = brand;
  tpl.brandId = brand.id;
  tpl.demoMode = demoMode;
  tpl.locale = locale; // 🔥 NEW

  // ... rest of function ...
}
```

### 2.3 Front-End Integration

#### 2.3.1 Enhance NUSDK.html

**Add to `NUSDK.html` (~line 100):**

```javascript
// 🔥 NEW: i18n Support
const _i18nCache = {};
let _currentLocale = 'en-US';

/**
 * Initialize i18n with locale detection
 */
async function initI18n() {
  try {
    // Try to get locale from URL or server
    const urlParams = new URLSearchParams(window.location.search);
    const langParam = urlParams.get('lang');

    if (langParam) {
      _currentLocale = langParam;
      sessionStorage.setItem('locale', langParam);
    } else {
      _currentLocale = sessionStorage.getItem('locale') || 'en-US';
    }

    // Load translations for current locale
    await loadTranslations(_currentLocale);

    // Apply translations to page
    applyTranslations();

  } catch (err) {
    console.error('i18n init error:', err);
  }
}

/**
 * Load translations from server
 */
async function loadTranslations(locale) {
  if (_i18nCache[locale]) return _i18nCache[locale];

  // For Apps Script, translations are already in i18nService.gs
  // We'll expose them via an API endpoint
  const result = await callAPI('i18n/translations', { locale });

  if (result.ok) {
    _i18nCache[locale] = result.value.translations;
    return result.value.translations;
  }

  return {};
}

/**
 * Translate a key
 */
function t(key, params = {}) {
  const translations = _i18nCache[_currentLocale] || {};

  // Navigate through key path (e.g., 'events.createButton')
  const parts = key.split('.');
  let value = translations;

  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      return key; // Fallback to key
    }
  }

  // Interpolate parameters
  if (typeof value === 'string' && params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }

  return value || key;
}

/**
 * Apply translations to elements with data-i18n attribute
 */
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translated = t(key);

    // Update text content or placeholder
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.hasAttribute('placeholder')) {
        el.placeholder = translated;
      } else {
        el.value = translated;
      }
    } else {
      el.textContent = translated;
    }
  });
}

/**
 * Format date according to current locale
 */
async function formatDate(date, style = 'medium') {
  const result = await callAPI('i18n/formatDate', {
    date: date instanceof Date ? date.toISOString() : date,
    locale: _currentLocale,
    style: style
  });

  return result.ok ? result.value.formatted : date;
}

/**
 * Format number according to current locale
 */
function formatNumber(number, decimals = 0) {
  return new Intl.NumberFormat(_currentLocale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(number);
}

/**
 * Format currency according to current locale
 */
function formatCurrency(amount, currency = 'USD') {
  return new Intl.NumberFormat(_currentLocale, {
    style: 'currency',
    currency: currency
  }).format(amount);
}

/**
 * Change locale
 */
async function setLocale(locale) {
  _currentLocale = locale;
  sessionStorage.setItem('locale', locale);

  // Save to server
  await callAPI('i18n/setUserLocale', { locale });

  // Reload translations
  await loadTranslations(locale);
  applyTranslations();

  // Reload page with new locale
  const url = new URL(window.location);
  url.searchParams.set('lang', locale);
  window.location.href = url.toString();
}

// Expose i18n functions on SDK
window.NuSDK.t = t;
window.NuSDK.formatDate = formatDate;
window.NuSDK.formatNumber = formatNumber;
window.NuSDK.formatCurrency = formatCurrency;
window.NuSDK.setLocale = setLocale;
window.NuSDK.getCurrentLocale = () => _currentLocale;
window.NuSDK.getSupportedLocales = async () => {
  const result = await callAPI('i18n/supportedLocales');
  return result.ok ? result.value.locales : [];
};

// Auto-initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initI18n);
} else {
  initI18n();
}
```

#### 2.3.2 Add API Endpoints for i18n

**Add to `doPost(e)` handler in Code.gs:**

```javascript
case 'i18n/translations':
  return jsonResponse_(Ok({
    locale: payload.locale || DEFAULT_LOCALE,
    translations: TRANSLATIONS[payload.locale || DEFAULT_LOCALE]
  }));

case 'i18n/formatDate':
  return jsonResponse_(Ok({
    formatted: i18n_formatDate(
      payload.date,
      payload.locale,
      { style: payload.style }
    )
  }));

case 'i18n/setUserLocale':
  return jsonResponse_(i18n_setUserLocale(payload.locale));

case 'i18n/supportedLocales':
  return jsonResponse_(i18n_getSupportedLocales());
```

#### 2.3.3 Update HTML Files

**Pattern to Apply Across All HTML Files:**

**Before:**
```html
<h1>Events</h1>
<button>Create Event</button>
<label>Event Name</label>
```

**After:**
```html
<h1 data-i18n="events.title">Events</h1>
<button data-i18n="events.createButton">Create Event</button>
<label data-i18n="events.eventName">Event Name</label>
```

**OR Use SDK Directly:**
```html
<script>
  const SDK = window.NuSDK;

  document.querySelector('h1').textContent = SDK.t('events.title');
  document.querySelector('button').textContent = SDK.t('events.createButton');
</script>
```

#### 2.3.4 Locale Switcher Component

**Create `components/LocaleSwitcher.html`:**

```html
<div class="locale-switcher" style="position: fixed; top: 20px; right: 20px; z-index: 1000;">
  <select id="localeSwitcher" onchange="window.NuSDK.setLocale(this.value)">
    <option value="en-US">🇺🇸 English</option>
    <option value="es-ES">🇪🇸 Español</option>
    <option value="fr-FR">🇫🇷 Français</option>
    <option value="de-DE">🇩🇪 Deutsch</option>
    <option value="pt-BR">🇧🇷 Português</option>
    <option value="zh-CN">🇨🇳 中文</option>
    <option value="ja-JP">🇯🇵 日本語</option>
    <option value="ko-KR">🇰🇷 한국어</option>
  </select>
</div>

<script>
  // Set current locale in dropdown
  document.addEventListener('DOMContentLoaded', () => {
    const currentLocale = window.NuSDK.getCurrentLocale();
    document.getElementById('localeSwitcher').value = currentLocale;
  });
</script>

<style>
  .locale-switcher select {
    padding: 8px 12px;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    font-size: 14px;
  }
</style>
```

**Include in HTML files:**
```html
<?!= include('components/LocaleSwitcher'); ?>
```

### 2.4 Translation Key Extraction

**Files Requiring Translation:**

1. **Admin.html** - Admin interface strings
2. **AdminWizard.html** - Wizard steps and labels
3. **Public.html** - Public event listing
4. **Sponsor.html** - Sponsor portal
5. **SponsorDashboard.html** - Dashboard metrics
6. **Display.html** - Display mode

**Common Strings to Extract:**

| Current String | Translation Key | Category |
|---------------|----------------|----------|
| "Create Event" | `events.createButton` | events |
| "Event Name" | `events.eventName` | events |
| "Save" | `common.save` | common |
| "Cancel" | `common.cancel` | common |
| "Loading..." | `common.loading` | common |
| "Analytics" | `sponsors.analytics` | sponsors |
| "Click-Through Rate" | `sponsors.ctr` | sponsors |
| "Export Report" | `analytics.export` | analytics |

### 2.5 Adding New Locales

**To add a new locale (e.g., Italian):**

1. **Add to `SUPPORTED_LOCALES` in i18nService.gs:**
```javascript
const SUPPORTED_LOCALES = [
  'en-US', 'es-ES', 'fr-FR', 'de-DE',
  'pt-BR', 'zh-CN', 'ja-JP', 'ko-KR',
  'it-IT' // 🔥 NEW
];
```

2. **Add translation dictionary:**
```javascript
TRANSLATIONS['it-IT'] = {
  common: {
    loading: 'Caricamento...',
    save: 'Salva',
    cancel: 'Annulla',
    // ... rest of translations
  },
  events: {
    title: 'Eventi',
    createButton: 'Crea Evento',
    // ... rest of translations
  }
};
```

3. **Update locale switcher:**
```html
<option value="it-IT">🇮🇹 Italiano</option>
```

### 2.6 Testing Plan

**Manual Testing:**
1. Switch locale via `?lang=es-ES` URL parameter
2. Verify all strings translate correctly
3. Verify date/number formats change
4. Verify locale persists across sessions

**Automated Testing:**
```javascript
function test_i18nTranslation() {
  // Test translation
  const translated = i18n_translate('events.createButton', 'es-ES');
  assert(translated === 'Crear Evento');

  // Test fallback
  const fallback = i18n_translate('nonexistent.key', 'es-ES');
  assert(fallback === 'nonexistent.key');

  // Test parameters
  const parameterized = i18n_translate('validation.minLength', 'en-US', { min: 5 });
  assert(parameterized === 'Minimum length is 5 characters');
}

function test_i18nDateFormatting() {
  const date = new Date('2025-11-18');

  const usFormat = i18n_formatDate(date, 'en-US');
  assert(usFormat === '11/18/2025');

  const esFormat = i18n_formatDate(date, 'es-ES');
  assert(esFormat === '18/11/2025');
}
```

---

## Part 3: Implementation Priority

### Phase 1: Core Webhook Integration (High Priority)
**Estimated Time:** 2-3 hours

1. ✅ Add webhook triggers to `api_create()` in Code.gs:1815
2. ✅ Add webhook triggers to `api_updateEventData()` in Code.gs:1889
3. ✅ Add webhook API endpoints to `doPost()`
4. ✅ Test webhook delivery with webhook.site

**Deliverables:**
- Webhooks fire on event creation/update
- API endpoints accessible
- Test successful delivery

### Phase 2: Basic i18n Integration (High Priority)
**Estimated Time:** 4-6 hours

1. ✅ Enhance NUSDK.html with i18n functions
2. ✅ Add i18n API endpoints to Code.gs
3. ✅ Create LocaleSwitcher component
4. ✅ Update Public.html with `data-i18n` attributes
5. ✅ Test locale switching

**Deliverables:**
- Locale detection working
- Public page translated
- Locale switcher functional

### Phase 3: Extended Integration (Medium Priority)
**Estimated Time:** 6-8 hours

1. ✅ Create WebhookManager.html UI
2. ✅ Update all HTML files with translations
3. ✅ Add form submission webhook triggers
4. ✅ Add analytics webhook triggers
5. ✅ Comprehensive testing

**Deliverables:**
- Full webhook management UI
- All pages translated
- All webhook events firing

### Phase 4: Documentation & Polish (Low Priority)
**Estimated Time:** 2-3 hours

1. ✅ Create Zapier integration guide
2. ✅ Document translation key conventions
3. ✅ Add webhook examples to docs
4. ✅ Create video tutorials (optional)

**Deliverables:**
- User-facing documentation
- Developer guides
- Integration examples

---

## Part 4: Code Changes Summary

### Files to Modify:

| File | Changes | Lines | Priority |
|------|---------|-------|----------|
| `Code.gs` | Add webhook triggers + i18n endpoints | ~50 | High |
| `NUSDK.html` | Add i18n SDK functions | ~150 | High |
| `Config.gs` | Add webhook/i18n config constants | ~20 | Medium |
| `Public.html` | Add `data-i18n` attributes | ~30 | High |
| `Admin.html` | Add `data-i18n` attributes | ~50 | Medium |
| `SponsorDashboard.html` | Add `data-i18n` attributes | ~40 | Medium |
| `AdminWizard.html` | Add `data-i18n` attributes | ~30 | Medium |
| `Display.html` | Add `data-i18n` attributes | ~20 | Low |

### Files to Create:

| File | Purpose | Lines | Priority |
|------|---------|-------|----------|
| `WebhookManager.html` | Webhook management UI | ~200 | Medium |
| `components/LocaleSwitcher.html` | Locale selector component | ~50 | High |
| `docs/WEBHOOK_GUIDE.md` | Webhook integration guide | ~300 | Low |
| `docs/I18N_GUIDE.md` | Translation guide | ~200 | Low |

---

## Part 5: Risk Assessment

### Potential Issues:

1. **Webhook Delivery Failures**
   - **Risk:** External endpoints may be unreachable
   - **Mitigation:** Non-blocking webhook calls, retry logic already built-in
   - **Impact:** Low (core functionality unaffected)

2. **Performance Impact**
   - **Risk:** Webhook delivery may slow down API responses
   - **Mitigation:** Use asynchronous delivery, consider background triggers
   - **Impact:** Low (Apps Script handles well)

3. **Translation Completeness**
   - **Risk:** Missing translations in some locales
   - **Mitigation:** Fallback to default locale, gradual rollout
   - **Impact:** Medium (user experience affected)

4. **Locale Detection Issues**
   - **Risk:** Incorrect locale detection from browser headers
   - **Mitigation:** Allow manual override via `?lang=` parameter
   - **Impact:** Low (easy user override)

---

## Part 6: Success Metrics

### Webhook Integration:
- ✅ Webhooks fire successfully on event create/update
- ✅ 95%+ delivery success rate
- ✅ Average delivery time < 2 seconds
- ✅ Zero impact on core API response times

### i18n Integration:
- ✅ All supported locales display correctly
- ✅ 90%+ translation coverage for key pages
- ✅ Locale detection accuracy > 95%
- ✅ Zero layout/UI breaks from translations

---

## Part 7: Next Steps

### Immediate Actions:
1. ✅ Review this plan with stakeholders
2. ✅ Get approval for webhook trigger points
3. ✅ Prioritize which HTML pages to translate first
4. ✅ Begin Phase 1 implementation

### Follow-Up Questions:
- Which webhook events are highest priority? (event.created, form.submitted?)
- Which pages should be translated first? (Public.html, Admin.html?)
- Do we need webhook management UI immediately, or can it wait for Phase 3?
- Should we support custom webhook headers for advanced integrations?
- Are there specific locales that are higher priority than others?

---

## Appendix A: Webhook Payload Examples

### Event Created Webhook:
```json
{
  "id": "del_abc123xyz",
  "event": "event.created",
  "timestamp": "2025-11-18T10:30:00.000Z",
  "data": {
    "id": "uuid-event-123",
    "brandId": "root",
    "scope": "events",
    "templateId": "event",
    "data": {
      "name": "Tech Conference 2025",
      "dateISO": "2025-12-01",
      "location": "San Francisco, CA"
    },
    "slug": "tech-conference-2025",
    "createdAt": "2025-11-18T10:30:00.000Z",
    "links": {
      "publicUrl": "https://script.google.com/...",
      "posterUrl": "https://script.google.com/...",
      "displayUrl": "https://script.google.com/..."
    }
  }
}
```

### Event Updated Webhook:
```json
{
  "id": "del_def456uvw",
  "event": "event.updated",
  "timestamp": "2025-11-18T11:00:00.000Z",
  "data": {
    "id": "uuid-event-123",
    "brandId": "root",
    "scope": "events",
    "updatedFields": ["location", "description"],
    "data": {
      "name": "Tech Conference 2025",
      "dateISO": "2025-12-01",
      "location": "Virtual Event",
      "description": "Now online!"
    },
    "updatedAt": "2025-11-18T11:00:00.000Z"
  }
}
```

---

## Appendix B: Translation Coverage Matrix

| Page | Total Strings | Translated (en-US) | Translated (es-ES) | Translated (fr-FR) | Priority |
|------|--------------|-------------------|-------------------|-------------------|----------|
| Public.html | 25 | ✅ 25 | ✅ 25 | ⚠️ 15 | High |
| Admin.html | 50 | ✅ 50 | ✅ 50 | ⚠️ 30 | High |
| Sponsor.html | 30 | ✅ 30 | ✅ 30 | ⚠️ 20 | Medium |
| Display.html | 15 | ✅ 15 | ⚠️ 10 | ⚠️ 5 | Low |

Legend: ✅ Complete | ⚠️ Partial | ❌ Missing

---

## Appendix C: API Endpoint Reference

### Webhook Endpoints:

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/webhooks/register` | POST | Admin | Register new webhook |
| `/webhooks/unregister` | POST | Admin | Remove webhook |
| `/webhooks/list` | POST | Admin | List all webhooks |
| `/webhooks/test` | POST | Admin | Test webhook delivery |
| `/webhooks/deliveries` | POST | Admin | Get delivery history |

### i18n Endpoints:

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/i18n/translations` | POST | None | Get translations for locale |
| `/i18n/formatDate` | POST | None | Format date |
| `/i18n/setUserLocale` | POST | None | Save user locale preference |
| `/i18n/supportedLocales` | POST | None | Get supported locales |

---

**End of Integration Plan**
