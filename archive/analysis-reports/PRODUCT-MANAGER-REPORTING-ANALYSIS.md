# Product Manager Analysis: Shared Event & Sponsor Reporting

## Executive Summary

**Goal:** Define efficient event/sponsor metrics and shared reporting templates that serve both Event Managers and Sponsors as a single source of truth.

**Current State:** Analytics exist (api_trackAnalytics, api_analyticsReport) but no formal reporting templates.

**Recommendation:** Implement 3 shared templates + 2 role-specific dashboards.

---

## 1. Shared Reporting Templates (Priority)

### Template 1: **Event Performance Dashboard** (Shared)

**Users:** Event Managers + Sponsors
**Purpose:** Single source of truth for event metrics

**Metrics:**
- **Total Registrations** - How many signed up
- **Check-ins** - Actual attendance
- **Conversion Rate** - Check-ins ÷ Registrations
- **Peak Attendance Time** - When most people arrived
- **Average Dwell Time** - How long people stayed
- **Sponsor Engagement** - Clicks per sponsor
- **Form Completions** - Survey responses

**Layout:**
```
┌─────────────────────────────────────────┐
│ Event: TechConf 2025                    │
│ Date: Dec 31, 2025                      │
├─────────────────────────────────────────┤
│                                         │
│  Registrations     Check-ins   Conv %  │
│      250             187        75%    │
│                                         │
│  Peak Time        Dwell Time   Forms   │
│   10:30 AM         3.2 hrs      94     │
│                                         │
│  Top Sponsor Engagement                │
│  ├─ TechCorp: 45 clicks               │
│  ├─ InnoLabs: 32 clicks               │
│  └─ StartupX: 28 clicks               │
│                                         │
└─────────────────────────────────────────┘
```

**Implementation:**
```javascript
// In Code.gs
function api_getSharedEventDashboard(req) {
  const { eventId, brandId, adminKey } = req;
  const g = gate_(brandId, adminKey);
  if (!g.ok) return g;

  // Aggregate metrics
  const metrics = {
    registrations: getRegistrationCount(eventId),
    checkins: getCheckinCount(eventId),
    conversionRate: calculateConversionRate(eventId),
    peakTime: getPeakAttendanceTime(eventId),
    dwellTime: getAverageDwellTime(eventId),
    formCompletions: getFormCompletionCount(eventId),
    sponsorEngagement: getSponsorClicksByEvent(eventId)
  };

  return Ok(metrics);
}
```

---

### Template 2: **Sponsor ROI Report** (Shared)

**Users:** Sponsors + Event Managers
**Purpose:** Prove sponsor value, justify costs

**Metrics:**
- **Impressions** - How many people saw sponsor logo
- **Clicks** - How many clicked sponsor link
- **Click-Through Rate** (CTR) - Clicks ÷ Impressions
- **Engagement Time** - Time spent on sponsor page
- **Lead Generation** - Forms filled via sponsor link
- **Cost Per Lead** - Sponsor fee ÷ Leads
- **Brand Recall** - Survey mentions of sponsor

**Layout:**
```
┌─────────────────────────────────────────┐
│ Sponsor: TechCorp Solutions             │
│ Events: 3  │  Tier: Gold                │
├─────────────────────────────────────────┤
│                                         │
│  Impressions    Clicks      CTR        │
│      1,250        45        3.6%       │
│                                         │
│  Engagement    Leads    Cost/Lead      │
│    2.5 min      12       $83.33       │
│                                         │
│  Events Breakdown:                     │
│  ├─ TechConf: 18 clicks               │
│  ├─ StartupWeek: 15 clicks            │
│  └─ DevSummit: 12 clicks              │
│                                         │
│  Trend: ↑ +23% vs last quarter        │
│                                         │
└─────────────────────────────────────────┘
```

**Implementation:**
```javascript
function api_getSponsorROI(req) {
  const { sponsorId, brandId, adminKey } = req;
  const g = gate_(brandId, adminKey);
  if (!g.ok) return g;

  const roi = {
    impressions: getImpressionsBySponsor(sponsorId),
    clicks: getClicksBySponsor(sponsorId),
    ctr: calculateCTR(sponsorId),
    engagementTime: getAvgEngagementTime(sponsorId),
    leads: getLeadsBySponsor(sponsorId),
    costPerLead: calculateCostPerLead(sponsorId),
    eventBreakdown: getEventsWithSponsor(sponsorId),
    trend: calculateTrend(sponsorId, 'quarterly')
  };

  return Ok(roi);
}
```

---

### Template 3: **Multi-Event Comparison** (Shared)

**Users:** Event Managers + Sponsors
**Purpose:** Compare performance across events

**Metrics:**
- Event-by-event comparison table
- Bar charts for registrations, check-ins, engagement
- Sponsor performance across events
- Best practices identification

**Layout:**
```
┌─────────────────────────────────────────┐
│ Multi-Event Analysis: Q4 2025          │
├─────────────────────────────────────────┤
│                                         │
│ Event        Reg   Check  Conv%  Spon  │
│ TechConf     250   187    75%    3     │
│ StartupWeek  180   142    79%    5     │
│ DevSummit    320   265    83%    4     │
│                                         │
│ Avg          250   198    79%   4.0    │
│ Best         DevSummit (83% conv)      │
│                                         │
│ Top Sponsor Across Events:             │
│   TechCorp: 45 total clicks           │
│   InnoLabs: 38 total clicks           │
│                                         │
│ Recommendation: DevSummit format      │
│ had best conversion. Replicate.        │
│                                         │
└─────────────────────────────────────────┘
```

---

## 2. Role-Specific Dashboards

### Event Manager Dashboard (Private)

**Additional Metrics (Not shared with sponsors):**
- **Budget vs Actual Spend**
- **Vendor Costs**
- **Profit Margin**
- **Staff Hours**
- **Operational Issues Log**

### Sponsor Dashboard (Private)

**Additional Metrics (Not shared with event managers):**
- **Internal Cost Analysis**
- **ROI vs Other Marketing Channels**
- **Brand Perception Changes**
- **Competitive Intelligence**

---

## 3. Implementation Priority

| Template | Effort | Impact | Priority |
|----------|--------|--------|----------|
| Event Performance Dashboard | 2 days | HIGH | P0 (Now) |
| Sponsor ROI Report | 3 days | HIGH | P0 (Now) |
| Multi-Event Comparison | 4 days | MEDIUM | P1 (Next) |
| Event Manager Dashboard | 3 days | MEDIUM | P1 (Next) |
| Sponsor Dashboard | 3 days | LOW | P2 (Later) |

---

## 4. Technical Specification

### Database Schema (Add to ANALYTICS sheet)

```
┌────────────────────────────────────────┐
│ Current: action | timestamp | details  │
├────────────────────────────────────────┤
│ Add:                                   │
│ - eventId                              │
│ - sponsorId (if sponsor-related)       │
│ - userId (if user-related)             │
│ - surface (admin|display|public)       │
│ - sessionId (group related actions)    │
└────────────────────────────────────────┘
```

### API Endpoints to Add

```javascript
// Code.gs
function api_getSharedEventDashboard(req) { ... }
function api_getSponsorROI(req) { ... }
function api_getMultiEventComparison(req) { ... }
function api_getEventManagerDashboard(req) { ... } // Private
function api_getSponsorDashboard(req) { ... } // Private
```

### Front-End Pages

**Add to Admin.html:**
```html
<section id="reportsSection">
  <h2>Reports</h2>
  <button onclick="loadEventDashboard()">Event Performance</button>
  <button onclick="loadSponsorROI()">Sponsor ROI</button>
  <button onclick="loadMultiEventComparison()">Multi-Event Analysis</button>

  <div id="reportDisplay"></div>
</section>
```

---

## 5. Success Metrics

**Adoption:**
- 80%+ of event managers use shared dashboard weekly
- 90%+ of sponsors view ROI report monthly

**Value:**
- 30% reduction in "How did my event perform?" support tickets
- 50% faster sponsor renewal decisions
- 25% increase in sponsor retention

**Efficiency:**
- 1 hour saved per event manager per week (automated reports)
- 2 hours saved per sponsor per month (self-service data)

---

## 6. Sample Report Output

```json
{
  "ok": true,
  "value": {
    "eventId": "evt_123",
    "eventName": "TechConf 2025",
    "date": "2025-12-31",
    "metrics": {
      "registrations": 250,
      "checkins": 187,
      "conversionRate": 0.75,
      "peakTime": "10:30 AM",
      "avgDwellTime": 3.2,
      "formCompletions": 94,
      "sponsors": [
        {
          "name": "TechCorp",
          "impressions": 187,
          "clicks": 45,
          "ctr": 0.24,
          "leads": 12
        },
        {
          "name": "InnoLabs",
          "impressions": 187,
          "clicks": 32,
          "ctr": 0.17,
          "leads": 8
        }
      ]
    },
    "insights": [
      "Conversion rate 75% is above industry average (65%)",
      "TechCorp had 2.4x higher CTR than average",
      "Peak attendance at 10:30 AM - schedule keynotes accordingly"
    ]
  }
}
```

---

## 7. Wireframes

### Event Performance Dashboard
```
┌─────────────────────────────────────────────────┐
│ 📊 Event Performance: TechConf 2025            │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │   250   │  │   187   │  │   75%   │        │
│  │  Reg    │  │ Check-in│  │  Conv   │        │
│  └─────────┘  └─────────┘  └─────────┘        │
│                                                 │
│  📈 Attendance Over Time                       │
│  │                        ╱╲                   │
│  │                    ╱╲ ╱  ╲                  │
│  │                ╱╲ ╱  ╲    ╲                 │
│  │            ╱╲ ╱  ╲    ╲    ╲               │
│  └────────────────────────────────            │
│   9AM  10AM  11AM  12PM  1PM  2PM             │
│                                                 │
│  🏆 Top Sponsors                               │
│  1. TechCorp     45 clicks  3.6% CTR           │
│  2. InnoLabs     32 clicks  2.6% CTR           │
│  3. StartupX     28 clicks  2.3% CTR           │
│                                                 │
│  💡 Insights                                   │
│  • Peak: 10:30 AM (83 attendees)              │
│  • Avg dwell: 3.2 hours (industry: 2.5)       │
│  • Form completion: 94 (50% of check-ins)     │
│                                                 │
│  [Export PDF] [Share with Sponsors]           │
└─────────────────────────────────────────────────┘
```

---

## 8. Next Steps

1. **Week 1-2:** Implement Event Performance Dashboard (Template 1)
2. **Week 3-4:** Implement Sponsor ROI Report (Template 2)
3. **Week 5:** Add Multi-Event Comparison (Template 3)
4. **Week 6:** User testing with 3 event managers + 3 sponsors
5. **Week 7:** Iterate based on feedback
6. **Week 8:** Launch shared reporting feature

---

## 9. Revenue Impact

**Current:** Event managers manually compile reports (4 hours/event)
**Future:** Automated shared dashboards (5 minutes/event)

**Time Saved:** 3.9 hours × $50/hour × 20 events/year = **$3,900/year**

**Sponsor Value:** Sponsors renew 25% more often = **+$5,000/year**

**Total ROI:** $8,900/year vs 8 weeks development (~$12,000) = **Break-even in 16 months**

---

**Document Version:** 1.0
**Last Updated:** 2025-11-11
**Owner:** Product Manager
**Status:** Ready for Development
