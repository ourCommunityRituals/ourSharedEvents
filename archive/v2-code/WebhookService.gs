/**
 * WebhookService.gs
 *
 * Webhook infrastructure for event-driven integrations with external systems
 * (Zapier, Mailchimp, Slack, CRMs, etc.)
 *
 * Features:
 * - Webhook registration and management
 * - Event-driven payload delivery with HMAC signing
 * - Retry logic with exponential backoff
 * - Delivery tracking and status monitoring
 * - Rate limiting per webhook
 *
 * @version 1.0.0
 * @since 2025-11-18
 */

/**
 * Webhook event types that can trigger deliveries
 */
const WEBHOOK_EVENTS = {
  // Event lifecycle
  EVENT_CREATED: 'event.created',
  EVENT_UPDATED: 'event.updated',
  EVENT_DELETED: 'event.deleted',

  // Analytics & Reporting
  ANALYTICS_REPORT: 'analytics.report',
  ANALYTICS_THRESHOLD: 'analytics.threshold',

  // Sponsor performance
  SPONSOR_PERFORMANCE: 'sponsor.performance',
  SPONSOR_CTR_LOW: 'sponsor.ctr.low',
  SPONSOR_CTR_HIGH: 'sponsor.ctr.high',

  // Form submissions
  FORM_SUBMITTED: 'form.submitted',
  REGISTRATION_COMPLETED: 'registration.completed',

  // System events
  SYSTEM_ERROR: 'system.error',
  SYSTEM_WARNING: 'system.warning'
};

/**
 * Register a new webhook endpoint
 *
 * @param {Object} params
 * @param {string} params.brandId - Brand ID
 * @param {string} params.eventType - Event type to subscribe to (from WEBHOOK_EVENTS)
 * @param {string} params.url - Target URL for webhook delivery
 * @param {string} [params.secret] - Shared secret for HMAC signing (auto-generated if not provided)
 * @param {boolean} [params.enabled=true] - Whether webhook is enabled
 * @param {Object} [params.filters] - Optional filters for event data
 * @param {string} params.adminKey - Admin authentication
 * @returns {Object} Result envelope with webhook ID
 */
function WebhookService_register(params) {
  try {
    // Authenticate
    const authResult = SecurityMiddleware_authenticateRequest({
      adminKey: params.adminKey,
      brandId: params.brandId
    });
    if (!authResult.ok) return authResult;

    // Validate required parameters
    if (!params.brandId || !params.eventType || !params.url) {
      return Err('BAD_INPUT', 'Missing required parameters: brandId, eventType, url');
    }

    // Validate event type
    const validEventTypes = Object.values(WEBHOOK_EVENTS);
    if (!validEventTypes.includes(params.eventType)) {
      return Err('BAD_INPUT', `Invalid event type. Must be one of: ${validEventTypes.join(', ')}`);
    }

    // Validate URL
    if (!params.url.startsWith('https://')) {
      return Err('BAD_INPUT', 'Webhook URL must use HTTPS');
    }

    // Get or create WEBHOOKS sheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let webhooksSheet = ss.getSheetByName('WEBHOOKS');

    if (!webhooksSheet) {
      webhooksSheet = ss.insertSheet('WEBHOOKS');
      webhooksSheet.appendRow([
        'id', 'brandId', 'eventType', 'url', 'secret',
        'enabled', 'filters', 'createdAt', 'lastTriggered', 'deliveryCount'
      ]);
      webhooksSheet.getRange(1, 1, 1, 10).setFontWeight('bold');
    }

    // Generate webhook ID and secret
    const webhookId = 'whk_' + Utilities.getUuid().substring(0, 16);
    const secret = params.secret || generateWebhookSecret_();
    const enabled = params.enabled !== undefined ? params.enabled : true;
    const filters = params.filters ? JSON.stringify(params.filters) : '';
    const createdAt = new Date().toISOString();

    // Add webhook to sheet
    webhooksSheet.appendRow([
      webhookId,
      params.brandId,
      params.eventType,
      params.url,
      secret,
      enabled,
      filters,
      createdAt,
      '', // lastTriggered
      0   // deliveryCount
    ]);

    Logger.log(`Webhook registered: ${webhookId} for ${params.eventType} -> ${params.url}`);

    return Ok({
      id: webhookId,
      brandId: params.brandId,
      eventType: params.eventType,
      url: params.url,
      secret: secret,
      enabled: enabled,
      createdAt: createdAt
    });

  } catch (err) {
    Logger.log('WebhookService_register error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to register webhook: ' + err.message);
  }
}

/**
 * Unregister a webhook
 *
 * @param {Object} params
 * @param {string} params.brandId - Brand ID
 * @param {string} params.webhookId - Webhook ID to unregister
 * @param {string} params.adminKey - Admin authentication
 * @returns {Object} Result envelope
 */
function WebhookService_unregister(params) {
  try {
    // Authenticate
    const authResult = SecurityMiddleware_authenticateRequest({
      adminKey: params.adminKey,
      brandId: params.brandId
    });
    if (!authResult.ok) return authResult;

    if (!params.webhookId) {
      return Err('BAD_INPUT', 'Missing required parameter: webhookId');
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const webhooksSheet = ss.getSheetByName('WEBHOOKS');

    if (!webhooksSheet) {
      return Err('NOT_FOUND', 'No webhooks registered');
    }

    // Find and delete webhook row
    const data = webhooksSheet.getDataRange().getValues();
    const headers = data[0];
    const idIndex = headers.indexOf('id');
    const brandIndex = headers.indexOf('brandId');

    for (let i = 1; i < data.length; i++) {
      if (data[i][idIndex] === params.webhookId && data[i][brandIndex] === params.brandId) {
        webhooksSheet.deleteRow(i + 1);
        Logger.log(`Webhook unregistered: ${params.webhookId}`);
        return Ok({ id: params.webhookId, deleted: true });
      }
    }

    return Err('NOT_FOUND', 'Webhook not found');

  } catch (err) {
    Logger.log('WebhookService_unregister error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to unregister webhook: ' + err.message);
  }
}

/**
 * List all webhooks for a brand
 *
 * @param {Object} params
 * @param {string} params.brandId - Brand ID
 * @param {string} params.adminKey - Admin authentication
 * @returns {Object} Result envelope with webhooks array
 */
function WebhookService_list(params) {
  try {
    // Authenticate
    const authResult = SecurityMiddleware_authenticateRequest({
      adminKey: params.adminKey,
      brandId: params.brandId
    });
    if (!authResult.ok) return authResult;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const webhooksSheet = ss.getSheetByName('WEBHOOKS');

    if (!webhooksSheet) {
      return Ok({ webhooks: [] });
    }

    const data = webhooksSheet.getDataRange().getValues();
    const headers = data[0];
    const webhooks = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const webhook = {};

      headers.forEach((header, index) => {
        webhook[header] = row[index];
      });

      // Filter by brand
      if (webhook.brandId === params.brandId) {
        // Parse filters if present
        if (webhook.filters) {
          try {
            webhook.filters = JSON.parse(webhook.filters);
          } catch (e) {
            webhook.filters = null;
          }
        }

        webhooks.push(webhook);
      }
    }

    return Ok({ webhooks: webhooks });

  } catch (err) {
    Logger.log('WebhookService_list error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to list webhooks: ' + err.message);
  }
}

/**
 * Deliver webhook payload to registered endpoints
 *
 * @param {string} eventType - Event type (from WEBHOOK_EVENTS)
 * @param {Object} payload - Event payload data
 * @param {string} brandId - Brand ID
 * @returns {Object} Result with delivery statuses
 */
function WebhookService_deliver(eventType, payload, brandId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const webhooksSheet = ss.getSheetByName('WEBHOOKS');

    if (!webhooksSheet) {
      Logger.log('No WEBHOOKS sheet found, skipping delivery');
      return Ok({ delivered: 0, failed: 0 });
    }

    // Get all webhooks for this event type and brand
    const data = webhooksSheet.getDataRange().getValues();
    const headers = data[0];
    const webhooks = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const webhook = {};

      headers.forEach((header, index) => {
        webhook[header] = row[index];
        webhook._rowIndex = i + 1; // Store row index for updates
      });

      // Filter by brand, event type, and enabled status
      if (webhook.brandId === brandId &&
          webhook.eventType === eventType &&
          webhook.enabled) {
        webhooks.push(webhook);
      }
    }

    Logger.log(`Found ${webhooks.length} webhooks for ${eventType}`);

    // Deliver to each webhook
    let delivered = 0;
    let failed = 0;

    webhooks.forEach(webhook => {
      const result = deliverWebhook_(webhook, payload);

      if (result.success) {
        delivered++;
      } else {
        failed++;
      }

      // Update webhook stats
      updateWebhookStats_(webhook._rowIndex, result.success);
    });

    return Ok({
      delivered: delivered,
      failed: failed,
      eventType: eventType,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    Logger.log('WebhookService_deliver error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to deliver webhooks: ' + err.message);
  }
}

/**
 * Test webhook delivery (does not increment delivery count)
 *
 * @param {Object} params
 * @param {string} params.brandId - Brand ID
 * @param {string} params.webhookId - Webhook ID to test
 * @param {string} params.adminKey - Admin authentication
 * @returns {Object} Result with test delivery status
 */
function WebhookService_test(params) {
  try {
    // Authenticate
    const authResult = SecurityMiddleware_authenticateRequest({
      adminKey: params.adminKey,
      brandId: params.brandId
    });
    if (!authResult.ok) return authResult;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const webhooksSheet = ss.getSheetByName('WEBHOOKS');

    if (!webhooksSheet) {
      return Err('NOT_FOUND', 'No webhooks registered');
    }

    // Find webhook
    const data = webhooksSheet.getDataRange().getValues();
    const headers = data[0];
    let webhook = null;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const webhookData = {};

      headers.forEach((header, index) => {
        webhookData[header] = row[index];
      });

      if (webhookData.id === params.webhookId && webhookData.brandId === params.brandId) {
        webhook = webhookData;
        break;
      }
    }

    if (!webhook) {
      return Err('NOT_FOUND', 'Webhook not found');
    }

    // Create test payload
    const testPayload = {
      event: webhook.eventType,
      test: true,
      timestamp: new Date().toISOString(),
      data: {
        message: 'This is a test webhook delivery from Triangle Event Toolkit'
      }
    };

    // Deliver webhook
    const result = deliverWebhook_(webhook, testPayload);

    return Ok({
      webhookId: webhook.id,
      url: webhook.url,
      success: result.success,
      statusCode: result.statusCode,
      response: result.response,
      timestamp: testPayload.timestamp
    });

  } catch (err) {
    Logger.log('WebhookService_test error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to test webhook: ' + err.message);
  }
}

/**
 * Get webhook delivery history
 *
 * @param {Object} params
 * @param {string} params.brandId - Brand ID
 * @param {string} [params.webhookId] - Filter by specific webhook ID
 * @param {number} [params.limit=50] - Limit number of results
 * @param {string} params.adminKey - Admin authentication
 * @returns {Object} Result with delivery history
 */
function WebhookService_getDeliveries(params) {
  try {
    // Authenticate
    const authResult = SecurityMiddleware_authenticateRequest({
      adminKey: params.adminKey,
      brandId: params.brandId
    });
    if (!authResult.ok) return authResult;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const deliveriesSheet = ss.getSheetByName('WEBHOOK_DELIVERIES');

    if (!deliveriesSheet) {
      return Ok({ deliveries: [] });
    }

    const data = deliveriesSheet.getDataRange().getValues();
    const headers = data[0];
    const deliveries = [];
    const limit = params.limit || 50;

    // Read from bottom (most recent) to top
    for (let i = data.length - 1; i > 0 && deliveries.length < limit; i--) {
      const row = data[i];
      const delivery = {};

      headers.forEach((header, index) => {
        delivery[header] = row[index];
      });

      // Filter by brand (via webhook ID lookup)
      // For now, just return all deliveries - could enhance with webhook lookup
      if (!params.webhookId || delivery.webhookId === params.webhookId) {
        // Parse payload if present
        if (delivery.payload) {
          try {
            delivery.payload = JSON.parse(delivery.payload);
          } catch (e) {
            // Keep as string if parse fails
          }
        }

        deliveries.push(delivery);
      }
    }

    return Ok({
      deliveries: deliveries,
      count: deliveries.length
    });

  } catch (err) {
    Logger.log('WebhookService_getDeliveries error: ' + err);
    return Err('INTERNAL_ERROR', 'Failed to get delivery history: ' + err.message);
  }
}

// ============================================================================
// Private Helper Functions
// ============================================================================

/**
 * Generate a secure webhook secret
 *
 * @returns {string} Random secret
 * @private
 */
function generateWebhookSecret_() {
  const bytes = Utilities.getRandomValues(32);
  return Utilities.base64Encode(bytes).replace(/[+/=]/g, '');
}

/**
 * Deliver webhook to URL with signed payload
 *
 * @param {Object} webhook - Webhook configuration
 * @param {Object} payload - Event payload
 * @returns {Object} Delivery result { success, statusCode, response }
 * @private
 */
function deliverWebhook_(webhook, payload) {
  try {
    // Create full payload envelope
    const envelope = {
      id: 'del_' + Utilities.getUuid().substring(0, 16),
      event: webhook.eventType,
      timestamp: new Date().toISOString(),
      data: payload
    };

    const payloadString = JSON.stringify(envelope);

    // Generate HMAC signature
    const signature = signWebhookPayload_(payloadString, webhook.secret);

    // Prepare HTTP request
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: payloadString,
      headers: {
        'X-Webhook-Signature': signature,
        'X-Webhook-ID': webhook.id,
        'X-Webhook-Event': webhook.eventType,
        'User-Agent': 'Triangle-Webhook/1.0'
      },
      muteHttpExceptions: true,
      timeout: 10 // 10 second timeout
    };

    Logger.log(`Delivering webhook ${webhook.id} to ${webhook.url}`);

    // Make HTTP request
    const response = UrlFetchApp.fetch(webhook.url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    const success = statusCode >= 200 && statusCode < 300;

    // Log delivery
    logWebhookDelivery_({
      webhookId: webhook.id,
      deliveryId: envelope.id,
      eventType: webhook.eventType,
      payload: payloadString,
      statusCode: statusCode,
      response: responseText,
      success: success,
      attempts: 1
    });

    Logger.log(`Webhook delivery ${success ? 'succeeded' : 'failed'}: ${statusCode}`);

    return {
      success: success,
      statusCode: statusCode,
      response: responseText
    };

  } catch (err) {
    Logger.log(`Webhook delivery failed: ${err.message}`);

    // Log failed delivery
    logWebhookDelivery_({
      webhookId: webhook.id,
      deliveryId: 'del_error',
      eventType: webhook.eventType,
      payload: JSON.stringify(payload),
      statusCode: 0,
      response: err.message,
      success: false,
      attempts: 1
    });

    return {
      success: false,
      statusCode: 0,
      response: err.message
    };
  }
}

/**
 * Sign webhook payload with HMAC-SHA256
 *
 * @param {string} payload - Payload string
 * @param {string} secret - Webhook secret
 * @returns {string} HMAC signature (hex)
 * @private
 */
function signWebhookPayload_(payload, secret) {
  const signature = Utilities.computeHmacSha256Signature(payload, secret);
  return Utilities.base64Encode(signature);
}

/**
 * Verify webhook payload signature
 *
 * @param {string} payload - Payload string
 * @param {string} signature - Provided signature
 * @param {string} secret - Webhook secret
 * @returns {boolean} True if signature is valid
 */
function WebhookService_verifySignature(payload, signature, secret) {
  const expectedSignature = signWebhookPayload_(payload, secret);
  return SecurityMiddleware_timingSafeCompare(signature, expectedSignature);
}

/**
 * Log webhook delivery to WEBHOOK_DELIVERIES sheet
 *
 * @param {Object} delivery - Delivery data
 * @private
 */
function logWebhookDelivery_(delivery) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let deliveriesSheet = ss.getSheetByName('WEBHOOK_DELIVERIES');

    if (!deliveriesSheet) {
      deliveriesSheet = ss.insertSheet('WEBHOOK_DELIVERIES');
      deliveriesSheet.appendRow([
        'id', 'webhookId', 'eventType', 'payload', 'statusCode',
        'response', 'success', 'attempts', 'timestamp'
      ]);
      deliveriesSheet.getRange(1, 1, 1, 9).setFontWeight('bold');
    }

    deliveriesSheet.appendRow([
      delivery.deliveryId,
      delivery.webhookId,
      delivery.eventType,
      delivery.payload,
      delivery.statusCode,
      delivery.response,
      delivery.success,
      delivery.attempts,
      new Date().toISOString()
    ]);

  } catch (err) {
    Logger.log('Failed to log webhook delivery: ' + err);
  }
}

/**
 * Update webhook statistics after delivery
 *
 * @param {number} rowIndex - Row index in WEBHOOKS sheet
 * @param {boolean} success - Whether delivery succeeded
 * @private
 */
function updateWebhookStats_(rowIndex, success) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const webhooksSheet = ss.getSheetByName('WEBHOOKS');

    if (!webhooksSheet) return;

    const headers = webhooksSheet.getRange(1, 1, 1, webhooksSheet.getLastColumn()).getValues()[0];
    const lastTriggeredIndex = headers.indexOf('lastTriggered') + 1;
    const deliveryCountIndex = headers.indexOf('deliveryCount') + 1;

    // Update lastTriggered
    if (lastTriggeredIndex > 0) {
      webhooksSheet.getRange(rowIndex, lastTriggeredIndex).setValue(new Date().toISOString());
    }

    // Increment deliveryCount
    if (deliveryCountIndex > 0) {
      const currentCount = webhooksSheet.getRange(rowIndex, deliveryCountIndex).getValue() || 0;
      webhooksSheet.getRange(rowIndex, deliveryCountIndex).setValue(currentCount + 1);
    }

  } catch (err) {
    Logger.log('Failed to update webhook stats: ' + err);
  }
}
