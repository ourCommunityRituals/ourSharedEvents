# Uptime Monitoring Setup

External uptime monitoring ensures you're alerted immediately when the system goes down, not when users start complaining.

**External uptime / SLO is measured via `?p=status`.**

## Production Endpoints

| Endpoint | URL | Purpose |
|----------|-----|---------|
| **Ping** | `https://www.eventangle.com/ping` | Ultra-simple uptime check (recommended) |
| **Status** | `https://www.eventangle.com/status` | Detailed status with build info |
| **Health** | `https://www.eventangle.com/health` | Alias for status |

### Endpoint Responses

**`/ping`** (recommended for uptime monitors):
```json
{"status":"ok"}
```

**`/status`** (SLO anchor):
```json
{
  "ok": true,
  "buildId": "mvp-v19",
  "brandId": "root",
  "time": "2025-12-01T10:30:00.000Z",
  "db": { "ok": true }
}
```

---

## UptimeRobot Setup (Free)

[UptimeRobot](https://uptimerobot.com/) offers 50 free monitors with 5-minute checks.

### Step 1: Create Account
1. Go to https://uptimerobot.com/
2. Sign up for a free account
3. Verify your email

### Step 2: Add Monitor
1. Click **"Add New Monitor"**
2. Configure:
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** EventAngle Production
   - **URL:** `https://www.eventangle.com/ping`
   - **Monitoring Interval:** 5 minutes (free) or 1 minute (Pro)

### Step 3: Configure Alert Contacts
1. Go to **My Settings > Alert Contacts**
2. Add your preferred notification method:
   - **Email:** Immediate alerts to your inbox
   - **SMS:** Text message alerts (Pro plan)
   - **Slack:** Webhook integration
   - **Webhook:** Custom HTTP POST to any service

### Step 4: Configure Keyword Monitoring (Optional but Recommended)
1. In monitor settings, enable **Keyword exists**
2. Set keyword to: `ok`
3. This ensures the response content is validated, not just the HTTP status

### Free Plan Limitations
- 5-minute minimum interval
- 50 monitors max
- Email alerts only

### Pro Plan Benefits ($7/month)
- 1-minute intervals
- SMS alerts
- More monitors
- Status pages

---

## Pingdom Setup (Paid)

[Pingdom](https://www.pingdom.com/) offers more features but requires a paid plan.

### Step 1: Create Account
1. Go to https://www.pingdom.com/
2. Start free trial or purchase a plan
3. Verify your email

### Step 2: Add Uptime Check
1. Navigate to **Monitoring > Uptime**
2. Click **"Add new"**
3. Configure:
   - **Name:** EventAngle Production
   - **Check Interval:** 1 minute
   - **URL:** `https://www.eventangle.com/ping`
   - **Request Method:** GET

### Step 3: Add Content Check
1. In the monitor configuration, add a **Content check**
2. Set **Should contain:** `ok`
3. This validates the response body, not just HTTP 200

### Step 4: Configure Alerting
1. Go to **Alerting > Contacts**
2. Add your notification preferences:
   - Email addresses
   - SMS numbers
   - Slack webhook
   - PagerDuty integration

---

## Slack Integration

Both UptimeRobot and Pingdom support Slack webhooks for instant team alerts.

### Setup Slack Incoming Webhook
1. Go to https://api.slack.com/apps
2. Create new app or use existing
3. Add **Incoming Webhooks** feature
4. Create webhook for your alerts channel (e.g., `#ops-alerts`)
5. Copy the webhook URL

### Connect to UptimeRobot
1. Go to **My Settings > Alert Contacts**
2. Add new contact, select **Slack**
3. Paste your webhook URL
4. Test the integration

### Connect to Pingdom
1. Go to **Alerting > Integrations**
2. Add **Slack** integration
3. Paste your webhook URL
4. Assign to your monitor

---

## Alert Response Protocol

When you receive an uptime alert:

### Immediate Actions (0-5 minutes)
1. **Acknowledge the alert** to prevent escalation
2. **Check the ping endpoint manually**:
   ```bash
   curl -s https://www.eventangle.com/ping
   ```
3. **If ping fails, check status for details**:
   ```bash
   curl -s https://www.eventangle.com/status | jq
   ```

### Diagnostic Steps (5-15 minutes)
1. **Check Cloudflare status**: https://www.cloudflarestatus.com/
2. **Check Google Apps Script status**: https://www.google.com/appsstatus
3. **Check the setup diagnostics**:
   ```bash
   curl -s "https://www.eventangle.com/status?p=setup" | jq
   ```

### Escalation Path
If you cannot resolve within 15 minutes:
1. Check the [RUNBOOK.md](./RUNBOOK.md) for common issues
2. Review recent deployments in GitHub Actions
3. Contact the development team

---

## Viewing Uptime History

### UptimeRobot
1. Log in to https://uptimerobot.com/
2. Click on your monitor
3. View uptime percentage and response time graphs
4. Export CSV for detailed analysis

### Pingdom
1. Log in to https://my.pingdom.com/
2. Go to **Monitoring > Uptime**
3. Click on your check
4. View **Uptime** and **Response Time** tabs
5. Set custom date ranges for analysis

---

## Recommended Configuration

For production monitoring, we recommend:

| Setting | Value | Reason |
|---------|-------|--------|
| Check Interval | 1 minute | Fast detection |
| Endpoint | `/ping` | Minimal response, fastest check |
| Keyword Check | `ok` | Validates response content |
| Alert Delay | 2 consecutive failures | Reduces false positives |
| Notification | Slack + Email | Team + personal backup |

---

## Status Page (Optional)

Both services offer public status pages:

### UptimeRobot Status Page
1. Go to **My Settings > Public Status Pages**
2. Create a new status page
3. Add your EventAngle monitor
4. Share the URL with stakeholders

### Pingdom Status Page
1. Go to **Monitoring > Status Pages**
2. Create new public status page
3. Configure branding and monitors
4. Share or embed on your site

---

## Multiple Environment Monitoring

If you have staging and production environments:

| Environment | URL | Check Interval |
|-------------|-----|----------------|
| Production | `https://www.eventangle.com/ping` | 1 minute |
| Staging | `https://staging.eventangle.com/ping` | 5 minutes |

---

## Related Documentation

- [RUNBOOK.md](./RUNBOOK.md) - Incident response procedures
- [SETUP_DIAGNOSTICS.md](./SETUP_DIAGNOSTICS.md) - System health checks
- [DEPLOYMENT.md](../DEPLOYMENT.md) - Deployment procedures
- [CLOUDFLARE_SETUP.md](../cloudflare-proxy/CLOUDFLARE_SETUP.md) - Proxy configuration

---

**Last Updated:** 2025-12-01
