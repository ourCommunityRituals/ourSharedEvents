# Error Handling Guide for Support Team

**Story 4.3: Graceful Error Handling in UI**

This guide explains the user-facing error messages introduced in Story 4.3 and how to gather additional information from logs when users report issues.

---

## Table of Contents

1. [Overview](#overview)
2. [User-Facing Error Messages](#user-facing-error-messages)
3. [Error Reference Codes (corrId)](#error-reference-codes-corrid)
4. [Troubleshooting by Error Type](#troubleshooting-by-error-type)
5. [Gathering Debug Information](#gathering-debug-information)
6. [Common Scenarios](#common-scenarios)
7. [Escalation Procedures](#escalation-procedures)

---

## Overview

The MVP Event Toolkit now includes comprehensive error handling that:

- Shows user-friendly messages instead of technical errors
- Provides reference codes for tracking issues
- Automatically retries failed requests when appropriate
- Logs detailed error information for debugging

**Key Principle**: Users see friendly messages; developers see detailed logs.

---

## User-Facing Error Messages

### Error Types and Their Meanings

| Error Title | What It Means | User Action |
|-------------|---------------|-------------|
| **"Oops, Something Went Wrong"** | Generic unexpected error | Click "Try Again" or refresh the page |
| **"Connection Problem"** | Network connectivity issue | Check internet connection, try again |
| **"Event Not Found"** | Invalid event ID or deleted event | Verify URL, check if event exists |
| **"Access Denied"** | Permission issue | Check access link, contact organizer |
| **"Temporary Issue"** | Server temporarily unavailable | Wait 1-2 minutes, then retry |
| **"Taking Too Long"** | Request timeout | Retry or check connection speed |
| **"Unable to Save"** | Save operation failed | Try again, check form data |
| **"Unable to Load Data"** | Data fetch failed | Refresh page, check connection |

### Error Dialog Components

When users see an error dialog, it includes:

```
+----------------------------------+
|              Icon                |
|      Error Title                 |
|                                  |
|   Error description message      |
|                                  |
|   Reference: abc123-def4         |
|                                  |
|  [Try Again]    [Dismiss]        |
|                                  |
|  Need help? Contact support      |
+----------------------------------+
```

---

## Error Reference Codes (corrId)

### What is a corrId?

A **Correlation ID** (corrId) is a unique reference code that links user-visible errors to detailed server logs. Format: `timestamp-random` (e.g., `lqx5m8k-a7b2`)

### How to Use corrIds

1. **User reports error**: Ask for the reference code shown in the error message
2. **Search logs**: Use the corrId to find the corresponding log entry
3. **Find details**: The log contains full error details including stack traces

### Log Search Commands

```bash
# Search in Google Apps Script logs (Stackdriver)
# Filter by corrId in the Log Viewer

# Search in Cloudflare Worker logs
wrangler tail --search "abc123-def4"
```

---

## Troubleshooting by Error Type

### 1. Network Errors

**User sees**: "Connection Problem" or "Unable to connect to server"

**Common causes**:
- User's internet connection is down
- DNS issues
- Firewall blocking requests
- Server temporarily unreachable

**Resolution steps**:
1. Ask user to check their internet connection
2. Ask user to try a different browser/device
3. Check server status in Cloudflare dashboard
4. Check Google Apps Script execution logs

### 2. Not Found Errors

**User sees**: "Event Not Found"

**Common causes**:
- Event was deleted
- Event ID is incorrect
- URL was mistyped
- Shortlink expired

**Resolution steps**:
1. Verify the event ID exists in the database
2. Check if the event was recently deleted
3. Verify the brand configuration is correct

### 3. Authorization Errors

**User sees**: "Access Denied"

**Common causes**:
- Invalid or expired access token
- User doesn't have permission for this brand
- Session expired

**Resolution steps**:
1. Ask user to log in again
2. Verify user has correct brand access
3. Check JWT token validity

### 4. Server Errors (5xx)

**User sees**: "Temporary Issue" with reference code

**Common causes**:
- Database connection issues
- Rate limiting triggered
- Server resource exhaustion
- Deployment in progress

**Resolution steps**:
1. Use corrId to find detailed error in logs
2. Check server health metrics
3. Check rate limiting status
4. Verify recent deployments

### 5. Timeout Errors

**User sees**: "Taking Too Long"

**Common causes**:
- Large data operation taking too long
- Database slow query
- Network latency

**Resolution steps**:
1. Check for slow queries in logs
2. Verify database health
3. Ask user to retry with smaller data set

---

## Gathering Debug Information

### From User's Browser

Ask the user to open the browser console and run:

```javascript
// Get recent error logs
JSON.stringify(window.__NU_LOGS__ || [], null, 2)

// Get error handler stats
GlobalErrorHandler?.getStats()

// Get recent errors specifically
GlobalErrorHandler?.getRecentErrors()
```

### From NUSDK Diagnostics

```javascript
// Run health check
await NU_DIAG.healthCheck()

// Get SDK stats
NU_DIAG.getStats()

// Export all logs
NU_DIAG.exportLogs()
```

### Information to Collect

When a user reports an issue, collect:

1. **Reference Code** (corrId) if shown
2. **Browser Console Output** (F12 > Console)
3. **Error Screenshot**
4. **Steps to Reproduce**
5. **URL** where error occurred
6. **Timestamp** of the error
7. **Browser/Device** information

---

## Common Scenarios

### Scenario 1: User Reports "Something Went Wrong"

1. Get the reference code from the error message
2. Search logs for the corrId
3. Review the full error details:
   - Error code
   - Stack trace
   - Request payload
   - User context

### Scenario 2: User Can't Load Events List

1. Ask user to try refreshing the page
2. If retry fails:
   - Check if issue is isolated to this user
   - Verify server is responding
   - Check for any rate limiting
3. Ask user to export browser logs

### Scenario 3: User Gets "Event Not Found" for Valid Event

1. Verify the event ID in the URL
2. Check the brand configuration
3. Verify the event exists in the database
4. Check if there's a caching issue (ask user to hard refresh)

### Scenario 4: Recurring Errors from Multiple Users

1. Check server health dashboard
2. Review recent deployments
3. Check for database issues
4. Monitor error rates in logs

---

## Escalation Procedures

### When to Escalate

| Situation | Action |
|-----------|--------|
| Multiple users affected | Escalate to on-call engineer |
| Server returning 5xx consistently | Escalate immediately |
| Data corruption suspected | Escalate to tech lead |
| Security-related error | Escalate to security team |
| Error persists after standard troubleshooting | Escalate to engineering |

### Escalation Information Template

When escalating, provide:

```
Subject: [PRIORITY] Error Report - [Error Type]

Affected Users: [Number/Names]
Time Started: [Timestamp]
Reference Codes: [List of corrIds]

Error Description:
[What users are seeing]

Steps to Reproduce:
1. ...
2. ...

Troubleshooting Attempted:
- [List steps taken]

Logs Collected:
[Attach or link to logs]

Impact:
[Business impact description]
```

---

## Error Codes Reference

### API Error Codes

| Code | Meaning | HTTP Status |
|------|---------|-------------|
| `BAD_INPUT` | Invalid request data | 400 |
| `UNAUTHORIZED` | Authentication failed | 401 |
| `NOT_FOUND` | Resource not found | 404 |
| `RATE_LIMITED` | Too many requests | 429 |
| `INTERNAL` | Server error | 500 |
| `SERVICE_UNAVAILABLE` | Temporary outage | 503 |
| `TIMEOUT` | Request took too long | 504 |
| `NETWORK_ERROR` | Connection failed | N/A |
| `CONTRACT` | API contract violation | 500 |

### Client Error Types

| Type | User Message | Developer Action |
|------|--------------|------------------|
| `event_not_found` | "Event Not Found" | Check event exists |
| `network_error` | "Connection Problem" | Check connectivity |
| `unauthorized` | "Access Denied" | Check permissions |
| `service_unavailable` | "Temporary Issue" | Check server health |
| `timeout` | "Taking Too Long" | Check performance |
| `no_data` | "No Data Yet" | Check data exists |
| `generic` | "Something Went Wrong" | Review logs with corrId |

---

## Log Locations

| Log Type | Location | Access |
|----------|----------|--------|
| Client-side errors | Browser console + `window.__NU_LOGS__` | User's browser |
| API errors | Google Apps Script Stackdriver | GCP Console |
| Proxy errors | Cloudflare Workers logs | Cloudflare Dashboard |
| Analytics | LOG_ANALYTICS sheet | Google Sheets |
| Diagnostic errors | DIAG sheet | Google Sheets |

---

## Quick Reference Card

### For Tier 1 Support

1. **User reports error** → Get reference code (corrId)
2. **"Connection Problem"** → Ask user to check internet, retry
3. **"Event Not Found"** → Verify URL is correct
4. **"Access Denied"** → Have user log in again
5. **Error persists** → Collect browser logs, escalate

### For Tier 2 Support

1. Use corrId to search server logs
2. Check error code in API Error Codes table
3. Review stack trace for root cause
4. Check if issue is isolated or widespread
5. Follow escalation procedures if needed

---

*Last Updated: Story 4.3 - Graceful Error Handling in UI*
