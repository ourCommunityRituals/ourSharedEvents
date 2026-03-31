# Research Prompt — Event Type Framework Deep Dive

> **Instructions**: Use this prompt with Claude Research (or equivalent deep-research tool) to fill gaps in `EVENT-TYPE-FRAMEWORK.md`. The skeleton is already built — Research should fill, not rebuild.

---

## Context for the Researcher

You are researching for **ourSharedEvents**, a community event management platform built on Cloudflare Workers. The platform serves community organizers — rec league directors, church social coordinators, small-town festival committees, neighborhood association event chairs.

The platform is NOT Eventbrite. It's infrastructure for recurring community gatherings where sponsors support events and SharedReports prove ROI. Think: Tuesday night volleyball league at the YMCA, monthly potluck at First Presbyterian, annual Harvest Festival on Main Street.

**Geographic focus**: United States, with emphasis on:
- Midwest metro areas (Columbus OH, Indianapolis IN, Cincinnati OH, Pittsburgh PA, Louisville KY)
- Midwest small towns (pop. 5,000-25,000)
- Suburban communities in the above metros

A skeleton document with 108 event types across 5 platform phases has been created. 26 specific research gaps are flagged. Your job is to fill those gaps with sourced, specific findings.

---

## Research Tasks

### Block A: Regulatory Landscape (Priority 1)

**R-01: Charitable Solicitation Registration**
- Which states require registration before soliciting donations at events?
- What are the thresholds (e.g., under $25K exempt)?
- Focus states: OH, IN, KY, PA, IL, MI, WI
- Deliverable: Table with state, requirement, threshold, registration body, URL

**R-02: Raffle/Bingo/Gaming Laws**
- For each focus state: Can nonprofits run raffles? Bingo? Under what license?
- Are there annual revenue caps?
- What about for-profit event organizers — can they run raffles at all?
- Deliverable: Table with state, raffle legal (Y/N/conditional), bingo legal (Y/N/conditional), license required, issuing body

**R-03: Liquor Licensing for Tasting Events**
- Can a community event organizer host a wine/beer tasting without a liquor license?
- What about "bring your own" events at private venues?
- Special event permits — cost, lead time, restrictions?
- Focus states: OH, IN, KY, PA
- Deliverable: Table with state, special event permit available (Y/N), cost, lead time, restrictions

**R-04: Youth Sports Coaching Background Checks**
- Which states mandate background checks for volunteer youth coaches?
- What type (state police, FBI fingerprint, sex offender registry)?
- SafeSport Act — what does it actually require of community organizers vs. national governing bodies?
- Focus states: OH, IN, KY, PA, IL
- Deliverable: Summary of requirements by state + SafeSport applicability analysis

**R-05: COPPA Compliance for Youth Events**
- If a community event collects a child's name + parent email via QR code check-in, does COPPA apply?
- What about if the parent fills out the form on behalf of the child?
- What's the minimum viable COPPA compliance for a check-in form?
- Deliverable: Decision tree for "does COPPA apply to this youth event check-in?"

**R-06: Ticketed Event Sales Tax**
- For focus states: Is admission to a community event subject to sales tax?
- Exemptions for nonprofits? For events under a certain size?
- What about "suggested donation" vs. "ticket price"?
- Focus states: OH, IN, KY, PA
- Deliverable: Table with state, taxable (Y/N/conditional), nonprofit exempt (Y/N), threshold, rate

### Block B: Community Differentiation (Priority 2)

**R-07: Cottage Food & Community Kitchen Laws**
- Focus states: OH, IN, KY, PA
- Can someone sell food at a community event (potluck, bake sale) without a food handler's license?
- What are the revenue caps?
- What about shared commercial kitchen requirements for cooking classes?
- Deliverable: Table with state, cottage food law summary, revenue cap, allowed venues, cooking class requirements

**R-08: Public Performance Licensing**
- What does a community movie night actually cost to license legally?
- MPLC annual site license vs. Swank per-showing — price ranges?
- ASCAP/BMI blanket license for a small venue hosting live music — cost?
- Is a one-time community event treated differently than a recurring series?
- Deliverable: Licensing option comparison table with cost ranges

**R-09: Municipal Event Permitting (Sample 5 Cities)**
- Pick: Columbus OH, Indianapolis IN, Cincinnati OH, a Midwest small town (e.g., Granville OH or Zionsville IN), one wildcard
- For each: What's the process for a community parade? Road closure for a 5K? A festival in a public park?
- Lead time, cost, insurance requirements?
- Deliverable: City-by-city comparison table

**R-10: Outdoor Events on Public Land**
- BLM, state parks, national forests — what permits are needed for a group hike (25+ people)? A fishing tournament? A community bike ride?
- Focus on Ohio and Indiana state parks
- Deliverable: Summary by land type with permit requirements

**R-11: Summer Camp Day Program Licensing**
- Focus states: OH, IN, KY, PA
- Does a 1-week community day camp need a state license?
- What about a single-day sports clinic for kids?
- Where's the line between "event" and "camp"?
- Deliverable: State comparison table with definitions and thresholds

### Block C: Patterns & Positioning (Priority 3)

**R-12: Midwest Community Event Calendar**
- What's the natural rhythm of community events in a Midwest suburb through the year?
- Map the "dead zones" and "peak zones" month by month
- Include: weather constraints, school calendar, holiday anchors, sport seasons
- Deliverable: 12-month calendar overlay showing event density by category

**R-13: Small Town vs Urban Event Preferences**
- What event types dominate in small towns (pop. 5K-25K) vs. urban neighborhoods?
- Are there event types that ONLY work in one context?
- Sources: community calendars from 3 small towns + 3 urban neighborhoods
- Deliverable: Comparison matrix

**R-14: Community Event Insurance**
- What does general liability insurance cost for a one-day community event?
- For a season-long rec league?
- Common providers in the community event space?
- Deliverable: Cost range table by event type and duration

**R-15: Volunteer Liability & Good Samaritan Coverage**
- Focus states: OH, IN, KY, PA
- What legal protection do community event volunteers have?
- Does the Volunteer Protection Act (federal) cover community event organizers?
- Deliverable: State-by-state summary with practical implications

---

## Output Format

For each research task, provide:

1. **Summary** (2-3 sentences — the headline finding)
2. **Detail table** (structured data as specified in deliverable)
3. **Sources** (URLs, statute numbers, or document references)
4. **Confidence level** (High / Medium / Low — based on source quality)
5. **Platform implication** (1 sentence — what this means for ourSharedEvents)

---

## What NOT to Research

- Technical implementation (we handle that)
- Competitor analysis (separate workstream)
- Pricing strategy (separate workstream)
- International markets (US only for now)
- Federal event regulations that don't apply to community-scale events
