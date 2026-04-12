# Agent Operating Model — OCR Org-Level

> Agents work stories. Humans review releases. Cost follows state.

---

## The model

Agents are the primary workforce. They pick up stories, execute work, validate through CI, and move the Linear board. Humans gate releases, make product decisions, and handle work agents can't do (legal, vendor, physical).

```
Release defined (epics / features / stories)
        │
        ▼
Agent picks next workable story
        │
        ▼
Agent executes: code, test, migration, doc
        │
        ▼
CI validates: green = story moves forward
        │
        ▼
Agent moves Linear state: In Progress → Done
        │
        ▼
Next story ← repeat until release is green
        │
        ▼
Only human work remains → notify, switch to scheduled mode
```

---

## Work hierarchy

All work is organized by release:

```
Release
├── Epic
│   ├── Feature
│   │   ├── Story (agent-workable)
│   │   ├── Story (agent-workable)
│   │   └── Story (human-only: legal, vendor, physical)
│   └── Feature
│       └── ...
└── Epic
    └── ...
```

A release is green when:
- All agent-workable stories are Done
- All repos pass CI
- Only human-gated stories remain

---

## Scrum team roles

Every story carries a role assignment. The role defines who is responsible, what they do, and how agents interact with them. This is the blueprint — when a story is picked up, the role tells the agent (or human) exactly what kind of work is expected.

| Role | Abbreviation | Responsibility | Agent interaction |
|---|---|---|---|
| **Product Owner** | PO | Defines AC, prioritizes backlog, approves scope changes, signs off on agent-assistable work | Agent surfaces decisions, PO approves |
| **Backend Engineer** | BE | API handlers, D1 schema, migrations, worker logic, data layer | Agent executes directly (agent-workable) |
| **Frontend Engineer** | FE | Display surfaces, UI components, public/poster/TV rendering | Agent executes directly (agent-workable) |
| **SRE / DevOps** | SRE | CI/CD, Cloudflare config, Doppler secrets, monitoring, WAF rules | Agent executes CI/config; human for dashboard ops |
| **SDET / QA** | QA | Test strategy, coverage tracking, contract tests, E2E, regression | Agent writes tests; QA reviews strategy |
| **Tech Lead** | TL | Architecture decisions, CCR gate reviews, cross-repo coordination | Agent researches and drafts; TL approves |
| **Legal** | LEGAL | BIPA, compliance, data ownership, contracts | Human-only — agent flags but never executes |
| **Ops / Community** | OPS | Physical setup, venue coordination, volunteer management, corridor activation | Human-only — agent creates checklists |

### Story assignment format

Every story in Linear carries:

| Field | Required | Example |
|---|---|---|
| **Assignee role** | Yes | `BE`, `FE`, `SRE`, `QA`, `TL`, `PO`, `LEGAL`, `OPS` |
| **Classification** | Yes | `agent-workable`, `agent-assistable`, `human-only` |
| **Agent capability** | If agent-workable | Which agent type executes (code, test, doc, migration, CI) |
| **Human gate** | If agent-assistable | What the human approves before Done |

### Example assignments

```
OSE-168  isPrimary schema bug
  Role:           BE
  Classification: agent-workable
  Agent:          code + migration + test
  Human gate:     none — CI validates

OSE-12   P1-7: Secrets + staging deploy
  Role:           SRE + PO
  Classification: agent-assistable
  Agent:          drafts updated AC, audits current state
  Human gate:     PO signs off on AC, SRE verifies secrets in Cloudflare

OCR-18   BIPA legal opinion
  Role:           LEGAL
  Classification: human-only
  Agent:          flags urgency, creates checklist
  Human gate:     full — legal consultation required

OW-30    Event Playlist Linking
  Role:           TL + BE
  Classification: agent-assistable
  Agent:          researches boundary risk, drafts CCR gate review
  Human gate:     TL approves boundary design before code starts

OSM-1    WAF exemption
  Role:           SRE
  Classification: human-only (Cloudflare dashboard)
  Agent:          documents the rule needed
  Human gate:     full — manual dashboard config

OSE-167  Eagles Hall technology blackout
  Role:           OPS
  Classification: human-only
  Agent:          none — physical event
  Human gate:     full
```

---

## Story classification

Every story gets classified before an agent touches it:

| Classification | Who works it | Assigned roles | Examples |
|---|---|---|---|
| **Agent-workable** | Agent executes autonomously | BE, FE, QA, SRE (CI/config only) | Schema fix, test update, doc generation, migration, CI fix, dependency update |
| **Agent-assistable** | Agent prepares, human finishes | TL, PO, SRE (dashboard ops) | AC audit (agent drafts, PO signs off), architecture decision (agent researches, TL decides) |
| **Human-only** | Human executes | LEGAL, OPS, PO (scope decisions) | Legal consultation, vendor negotiation, physical setup, stakeholder meeting |

The agent operating loop skips human-only stories and flags them for the board. Agent-assistable stories get worked to the human gate, then pause.

---

## The agent work loop

### Phase 1: Active sprint (high frequency)

Agents work continuously until the release is green. Cost is higher but justified — this is the build phase.

```
1. Read release scope from Linear (epics → features → stories)
2. Filter to agent-workable stories not yet Done
3. Sort by:
   a. Critical blockers first (per CCR)
   b. Dependencies (unblock others before independent work)
   c. Highest leverage (most downstream impact)
4. Pick the top story
5. Read the story AC + relevant codebase
6. Execute the work (code, test, migration, doc)
7. Run CI — if green, move story to Done
8. If CI fails, diagnose and retry (max 3 attempts)
9. If stuck, move story to "Blocked" with agent notes, pick next
10. Repeat from step 2
```

### Phase 2: Release green (low frequency)

All agent-workable stories are Done. Repos pass CI. Switch to cost-efficient mode.

```
- Daily nightly sync (existing cron) catches drift
- Event-driven hooks catch new stories or regressions
- Agents idle unless triggered
- Bloodraven runs weekly summary instead of daily
```

### Phase 3: Next release (ramp back up)

New release scope defined. Agent loop restarts at Phase 1.

---

## Linear board states

Agents move stories through these states:

| State | Meaning | Who moves it here |
|---|---|---|
| **Backlog** | Not yet scoped for a release | PO |
| **Todo** | Scoped for current release, not started | PO / agent triage |
| **In Progress** | Agent or human actively working | Agent (auto) or human |
| **In Review** | Work done, awaiting validation | Agent (after CI green) |
| **Done** | AC met, CI green, merged | Agent (auto) or human |
| **Blocked** | Agent hit a wall, needs human input | Agent (with notes) |

### Agent state transitions

```
Todo → In Progress       Agent picks up the story
In Progress → In Review  Agent completes work, CI green
In Review → Done         CI + CCR gate passed
In Progress → Blocked    Agent failed after 3 attempts, needs human
```

Agents never move stories backward (In Progress → Backlog). Only humans revert scope.

---

## Cost management

The operating model has two cost states:

### Sprint mode (active)

- Agents running continuously on workable stories
- Event-driven triggers on every child repo CI completion
- Linear webhooks trigger immediate story pickup
- Higher token usage — justified by velocity
- Target: burn through agent-workable stories until release is green

### Maintenance mode (green)

- Daily cron only (nightly sync check)
- Event-driven hooks for regressions or new stories
- Bloodraven runs weekly
- Minimal token usage
- Target: hold the line, don't burn tokens on idle

### The switch

```
IF all agent-workable stories for current release == Done
   AND all repos CI == green
THEN switch to maintenance mode

IF new release scoped
   OR regression detected (CI red)
   OR new urgent story created
THEN switch to sprint mode
```

---

## CCR integration

Every story goes through CCR before agent execution:

- **Loop 1 (Critical):** Is this story blocked by something else? Does it cross a product boundary?
- **Loop 2 (Conservative):** Is the AC clear enough for an agent to execute? Is confidence > 95%?
- **Loop 3 (Recursive):** Does this story conflict with anything in progress?

If CCR confidence < 95%, the story is classified as **agent-assistable** (agent researches, human decides) rather than agent-workable.

---

## Release definition

A release is defined in Linear as a project or milestone containing:

- Target date
- Epics with features and stories
- Each story classified: agent-workable / agent-assistable / human-only
- Entry criteria: what must be true before sprint mode starts
- Exit criteria: what "green" means for this release

### Current release: June 1 2026 (founding corridor activation)

Critical path per `OCR_STATUS_project.md`:

```
OSE-168 (isPrimary fix) → DONE (agent-executed this session)
  → EPIC-02 sponsor work unlocked
  → Sponsor pipeline ready for June 1

OSE-12 (staging deploy, AC audit) → AC audit DONE (agent-executed)
  → Staging baseline established

OSM-1 (WAF exemption) → HUMAN-ONLY (Cloudflare dashboard)

OW-6 (Mobile Auth) → In Progress (human + agent-assistable)
```

---

## Implementation sequence

### Step 1: Story triage (now)

Classify every story in the current release as agent-workable, agent-assistable, or human-only. This is a one-time pass per release.

### Step 2: Agent work loop (next)

Build the story runner that:
- Reads Linear stories via API
- Filters to agent-workable
- Executes in priority order
- Moves board state
- Stops when green

### Step 3: Event-driven triggers

Wire `repository_dispatch` from child repo CI to OCR-docs. Wire Linear webhooks for story state changes. These feed the agent work loop.

### Step 4: Cost switch

Implement the sprint/maintenance mode toggle. When green, scale down. When new release or regression, scale up.

---

*Last updated: April 9 2026*
*Owner: Matt*
*Status: ACTIVE*
