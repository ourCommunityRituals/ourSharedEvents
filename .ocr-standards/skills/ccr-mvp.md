# Skill: CCR MVP Audit

# Sprint Story Protocol: CCR-Gated, Discipline-Complete

## When to Use

User says: "ccr", "ccr audit", "ccr mvp", "run ccr", "production readiness", "recursive review", "pressure test"

## Prerequisites

- Read `.claude/skills/ccr-protocol.knowledge.md` for full protocol reference
- Read `.claude/skills/ccr-template.md` for discipline/level selection
- Read `CLAUDE.md` for project context and role POVs
- Read `STORIES.md` for current story state

---

## Start Here — Answer These Four Questions

### Role — _pick one_

- [ ] **PO** — Acceptance criteria, business case, user value, privacy requirements
- [ ] **Lead BE Architect** — Code correctness, DB design, API contracts, auth, testing pyramid
- [ ] **Lead FE Integration** — Surface coverage, front-back seams, QR routing, feature flags
- [ ] **Sr Design FE** — Mobile-first UX, Kaizen uniformity, accessibility, test-IDs
- [ ] **Sr Automation QA** — Test coverage, E2E flows, usability, error handling
- [ ] **SRE / SDET** — CI/CD gates, observability, quality pipeline, destruction jobs
- [ ] **DevOps** — DB provisioning, service config, release pipeline, security standards
- [ ] **Finance** — Token cost, ROI, infrastructure spend, sustainability
- [ ] **Compliance** — Regulatory requirements, data handling, audit readiness
- [ ] **Legal** — Liability, IP, contractual risk
- [ ] **Security** — Vulnerabilities, threat model, boundary integrity
- [ ] **Scrum Team** — Cross-discipline story health, sequencing, team unblocked
- [ ] **Custom:** `[ write your own ]`

### Level — _pick one_

- [ ] **Local** — One file, function, component, or story
- [ ] **Feature** — One feature across its full surface (routes, UI, tests, docs)
- [ ] **Product** — One product repo end-to-end
- [ ] **System** — Cross-product, full OCR product line

### Prompt

```
[ Describe what you're reviewing — or paste a saved prompt from another file ]
```

### Output — _pick one_

- [ ] **Summary** — One line per loop, score, gate decision. Quick scan.
- [ ] **Detail** — Full findings, evidence, open questions. Deep dive.

---

That's it. These four answers configure the entire run.

- **Role** sets the lens — what you're looking for
- **Level** sets the scope — how wide you're looking
- **Prompt** sets the target — what's under review
- **Output** sets the format — lean or deep

### Previous Selections (auto-saved)

_Your last run's choices are saved here. Accept them or change what's different._

```
Last Role:   [ auto-filled from previous run ]
Last Level:  [ auto-filled from previous run ]
Last Output: [ auto-filled from previous run ]
Last Prompt: [ auto-filled from previous run ]

Use same selections?  [ Yes — skip to prompt / No — update above ]
```

### Optional: Load a Previous Run

_Continue where you left off. Prior findings become input — no repeated work._

```
Previous run: [ path or filename, e.g., ccr-admin-cards-2026-04-01.md ]
Resume from:  [ Loop 1 / Loop 2 / Loop 3 / Step 3 / Step 4 ]
```

---

## How This Works

The quality of what you ship is a direct reflection of how well you investigated before you built. This process enforces that. It is not here to validate your assumptions — it is here to stress-test them. Default posture is critical. Default mode is Kaizen. You are always in a refinement loop until the confidence score says otherwise.

---

## Step 1 — Chunk, Batch, Chain, Cache

Never go straight to the full output. Break it down first.

- **Chunk** the work into bounded sections — one feature area, one discipline, one tier at a time. Never the whole thing in one pass.
- **Batch** similar work together. Stories of the same type, same team, same dependency layer run as a group. This is how you stay performant and avoid timeouts on large file generation.
- **Chain** the outputs forward. Each batch result is the verified input to the next step. Nothing moves forward unvalidated.
- **Cache** everything useful. Refined context from earlier loops gets reused, not regenerated. This keeps costs down and keeps the thread coherent across long sessions.

This is not optional structure — it is what makes the system actually work at scale without falling apart mid-run.

**Answer these before moving on:**

```
What are the chunks? (list each bounded section)
[ e.g., admin.html, public.html, display.html ... ]

What batches together? (which chunks share concerns?)
[ e.g., admin + config = management surfaces; public + poster + display = public-facing ]

What chains forward from a previous run? (any prior CCR output to build on?)
[ path to prior run, or "fresh start" ]

What's cached from context already loaded? (what do you already know that doesn't need re-reading?)
[ e.g., "CLAUDE.md loaded, STORIES.md loaded, router.ts read in prior session" ]
```

---

## Step 2 — Multi-Loop Refinement

Every batch goes through multiple passes before it moves:

1. Generate
2. Critically evaluate — what is wrong, what is missing, what is assumed without basis
3. Refine
4. Re-evaluate
5. Advance only when output is meaningfully better than the prior pass

Ground everything in what is actually real. Pull from industry sources. Reference actual system behavior. If something cannot be grounded in reality, flag it — don't paper over it.

**Answer these for each batch before advancing:**

```
What did the first pass produce?
[ Summary of initial findings ]

What is wrong with the first pass?
[ What's missing, assumed, or ungrounded? ]

What changed in the refined pass?
[ What was added, corrected, or removed? ]

Is the refined pass meaningfully better?
[ Yes — advance / No — refine again / Unclear — flag for human ]

What could not be grounded in reality?
[ List anything assumed without verification. These become Loop 1 pressure points. ]
```

---

## Step 3 — CCR Audit: Process Quality Gate

Before anything goes to human review, run a CCR (Critical, Conservative, Recursive) audit against the process and results.

### Loop 1 — Critical

Challenge every assumption hard. Score what is wrong, not what looks right.

```
What is the most dangerous assumption in this analysis?
[ The one thing that, if wrong, invalidates the rest ]

Has it been verified or only assumed?
[ Verified: how? / Assumed: flag it ]

What obvious gaps exist?
[ What's missing that should be there? ]

Confidence: [ ]%
```

### Loop 2 — Conservative

Take the most defensible, lowest-confidence-inflating read on every finding. When in doubt, mark it down.

```
What did Loop 1 assume was solved that was never actually verified?
[ What looked done but wasn't checked? ]

What is the worst-case outcome if Loop 1's findings are incomplete?
[ If you're wrong, what breaks? ]

Does the floor still hold under pressure?
[ Yes / No / Partially — explain ]

Confidence: [ ]%
Direction: [ Up / Down / Stable from Loop 1 ]
```

**If the score dropped:** That's the protocol working. Don't rationalize it back up.

### Loop 3 — Recursive

Run the two prior passes against each other. Resolve conflicts. Produce a single collective confidence score.

```
Is there anything you are still rationalizing rather than verifying?
[ What are you telling yourself is fine without proof? ]

Would you be comfortable defending this output if it shipped and something broke?
[ Yes / No — if no, what would need to change? ]

Has the score held across all three loops without artificial inflation?
[ Loop 1: __% → Loop 2: __% → Loop 3: __% ]
[ Trend: Rising / Stable / Decaying ]
```

**If decaying:** Do not advance. Return to Loop 2 with new findings.

### Gate

| Score       | Action                                                                |
| ----------- | --------------------------------------------------------------------- |
| Below 95    | Full stop. Surface findings to human. Do not proceed.                 |
| 95 or above | Continue to Step 4. Human approval still required before any commits. |

**If stopped, answer these:**

```
What scored low?
[ Specific finding or gap ]

Why?
[ What's missing or unverified ]

What needs to change before the next attempt?
[ Specific action items ]
```

---

## Step 4 — CCR Audit: Impact Assessment

Once the process gate clears, run a second CCR — same three loops, now aimed at impact:

**Answer these across three loops (Critical → Conservative → Recursive):**

### Business Impact

```
Does this story set reflect real product value?
[ Yes / No / Partially — what's missing? ]

Does it map to actual user and stakeholder outcomes?
[ Which users? Which outcomes? What's assumed? ]

Does it hold up against the three-tier pricing model (Free → Mid → Enterprise)?
[ Which tier does each story serve? Any tier gaps? ]
```

### Engineering Impact

```
Is scope realistic for the team and timeline?
[ Yes / No — what's oversized or underestimated? ]

Are dependencies surfaced?
[ List them. Any hidden ones? ]

Are edge cases called out before they become bugs?
[ Which edge cases? What's still unexamined? ]
```

### Financial Impact

```
Do effort estimates hold?
[ Based on what? Actuals or assumptions? ]

Are there hidden integration costs?
[ Cross-product, infrastructure, third-party? ]

Are there timeline risks embedded in the story set?
[ What could slip? What depends on external factors? ]
```

### Gate

Same logic. Below 95, stop. At 95+, bring it to the human.

```
Collective Score: [ ]%
Business: [ ]% | Engineering: [ ]% | Financial: [ ]%
Gate Decision: [ ADVANCE / STOP — HUMAN GATE ]
```

---

## Step 5 — Full Scrum Team Discipline Pass

The story set is not done until every discipline on the team has been worked through. In batching order:

**PO**
Acceptance criteria locked. Privacy requirements defined. Business cases validated. Each story has a use case before it has a ticket.

```
Are acceptance criteria complete and testable for every story?  [ Yes / No — which stories? ]
Are privacy requirements defined?                               [ Yes / No — what's missing? ]
Does every story have a business case?                          [ Yes / No — which ones don't? ]
Does every story have a use case before it has a ticket?        [ Yes / No ]
```

**Lead BE Architect**
DB schema reviewed. Destruction jobs scoped. API contracts defined per form type. Worker support mapped. Anonymous ID architecture intact. Auth layer covered. Unit, contract, Pact, and integration tests scoped. Feature flags applied at the right layer. Pricing tier logic — Free / Mid / Enterprise — reflected in API flows. Postman / Newman E2E chains planned.

```
DB schema reviewed and current?                    [ Yes / No — what's stale? ]
Destruction jobs scoped for all data types?         [ Yes / No — what's missing? ]
API contracts defined per form type?                [ Yes / No — which forms? ]
Anonymous ID architecture intact?                   [ Yes / No — where does it leak? ]
Auth layer covers all routes?                       [ Yes / No — which routes? ]
Tests scoped (unit, contract, Pact, integration)?   [ Yes / No — what's unscoped? ]
Feature flags at the right layer?                   [ Yes / No — any misplacements? ]
Tier logic (Free/Mid/Enterprise) in API flows?      [ Yes / No — gaps? ]
Postman/Newman E2E chains planned?                  [ Yes / No ]
```

**Lead FE Integration**
Admin, poster, display, public, sharedReports, and doc rendering surfaces covered. QR → form routing tested. Integration between front and back validated at every seam. Feature flags applied. Table-top and digital surface rendering accounted for.

```
All surfaces covered (admin, poster, display, public, sharedReports, doc, config)?  [ Yes / No — which are missing? ]
QR → form routing tested?                                                           [ Yes / No ]
Front-back integration validated at every seam?                                     [ Yes / No — which seams? ]
Feature flags applied on frontend?                                                  [ Yes / No — which flags? ]
Table-top and digital surface rendering accounted for?                              [ Yes / No ]
```

**Sr Design FE**
Mobile-first. Every form. Kaizen on the UX — uniform design, consistent color palette, easy to use, innovative where it earns it, secure, concise, fast. Test IDs baked in from design time, not retrofitted. Automation flows that survive change without breaking.

```
Mobile-first verified on all surfaces?              [ Yes / No — which aren't? ]
Uniform design and color palette consistent?        [ Yes / No — where does it drift? ]
Touch targets 44px+ on all interactive elements?    [ Yes / No ]
Test IDs baked in from design (not retrofitted)?    [ Yes / No — coverage %? ]
Automation flows survive change without breaking?   [ Yes / No — what's brittle? ]
```

**Sr Automation QA**
API test coverage mapped. Playwright E2E scoped. Smoke and functional suites defined. Customer usability is the lens — not just does it work, does it work for the person using it. Error handling covered explicitly.

```
API test coverage mapped for all endpoints?         [ Yes / No — which are uncovered? ]
Playwright E2E scoped for all user flows?           [ Yes / No — which flows? ]
Smoke and functional suites defined?                [ Yes / No ]
Customer usability validated (not just "it works")? [ Yes / No — how? ]
Error handling tested explicitly?                   [ Yes / No — which error paths? ]
```

**SRE / SDET**
Auth gates confirmed. CI/CD deployment gates defined for each form type. Job verification covered. Mock data checks scoped. Form and data destruction jobs monitored. Observability on submission rates and destruction job health. Full quality pipeline established: Linting → Pact → Contract → Unit → Integration → Postman API → Playwright FE → Datadog Synthetic.

```
Auth gates confirmed for all protected routes?                      [ Yes / No — which routes? ]
CI/CD deployment gates defined?                                     [ Yes / No — what's gated? ]
Job verification (destruction, lifecycle) covered?                  [ Yes / No ]
Mock data checks scoped?                                            [ Yes / No ]
Observability on submission rates and destruction job health?        [ Yes / No — what's monitored? ]
Full pipeline established (Lint → Pact → Contract → Unit → Int → Postman → Playwright → Synthetic)? [ Yes / No — where does it break? ]
```

**DevOps**
Separate DB provisioning per environment. Service config locked. CI/CD pipeline release process defined. Industry security standards applied — not assumed.

```
Separate DB provisioning per environment?           [ Yes / No — which environments? ]
Service config locked and documented?               [ Yes / No — what's undocumented? ]
CI/CD pipeline release process defined?             [ Yes / No ]
Industry security standards applied (not assumed)?  [ Yes / No — which standards? How verified? ]
Secrets management documented?                      [ Yes / No — any undocumented secrets? ]
```

**Discipline pass complete?**

```
All 7 disciplines answered above?  [ Yes / No ]
Any discipline flagged a blocker?  [ Yes / No — which one? What's blocked? ]
```

A story set that has not cleared every discipline is a draft. Not a candidate for commit.

---

## Step 6 — Three-Tier Feature Flag Alignment

Every story must map cleanly to one of the three tiers. No ambiguity on what is on, what is off, and who controls what.

```
Free (global defaults)
  forms.register ON · forms.checkin ON · forms.survey OFF
  forms.email-signup OFF · config.self-serve OFF
  assets.file-upload OFF · branding.white-label OFF

Mid (global overrides)
  forms.survey ON · forms.email-signup ON
  config.self-serve ON — client manages their own event settings
  assets.file-upload OFF · branding.white-label OFF

Enterprise (event-level overrides)
  config.self-serve ON · assets.file-upload ON — logos, posters, custom QR
  branding.white-label ON — their brand, their colors, their domain
  Any flag per event ON — full control
```

If a story touches a flag boundary, that boundary is the story. Document it explicitly.

---

## Step 7 — Human Approval and Commit

Once both CCR gates clear at 95+, and the full discipline pass is complete:

1. Present the output for human review and explicit approval
2. On approval: write the .md files
3. Commit

Nothing is written. Nothing is committed. Until this sequence is complete in order.

**Human reviewer answers:**

```
Have you reviewed the full output?                    [ Yes / No ]
Do you agree with the CCR confidence scores?          [ Yes / No — what would you score differently? ]
Are there findings you want to override or adjust?    [ Yes / No — which ones? ]
Approved to write .md files?                          [ Yes / No ]
Approved to commit?                                   [ Yes / No ]
Any notes for the commit message or run archive?      [ Free text ]
```

---

## The Loop in One View

```
Chunk → Batch → Chain → Cache
  ↓
Multi-loop refinement per batch
  ↓
CCR: Process Quality  →  <95: stop  /  ≥95: continue
  ↓
CCR: Business / Engineering / Financial  →  <95: stop  /  ≥95: continue
  ↓
Full discipline pass: PO → BE → FE → Design → QA → SRE → DevOps
  ↓
Human approval
  ↓
Write .md → Commit
```

---

## Output Format

_Controlled by your Output choice above. Summary is the default. Detail is on demand._

### Summary (default — quick judgment)

```markdown
## CCR Gate — Step [N]

| Loop | Score | Summary                                 |
| ---- | ----- | --------------------------------------- |
| 1    | XX%   | [ One line — what this loop found ]     |
| 2    | XX%   | [ One line — what this loop found ]     |
| 3    | XX%   | [ One line — what this loop confirmed ] |

**Collective Score:** XX%
**Gate Decision:** ADVANCE / STOP — HUMAN GATE
```

### Detail (on demand — drill down)

_Use when the summary raises a question, the score is borderline, or you chose Detail output._

```markdown
### Loop [N] — Detail

**Critical Finding:**
[ Full description of the assumption challenged ]

**Conservative Assessment:**
[ Full worst-case analysis ]

**Recursive Check:**
[ Confidence trajectory, decay analysis, conflicts between loops ]

**Evidence:**

- [ File/component ]: [ What was found ]
- [ File/component ]: [ What was found ]

**Open Questions (if any):**

- [ Question that needs human input ]
```

### Run Archive Format

_When saving a completed run for future reference:_

```
Filename: ccr-[subject]-[date].md  (e.g., ccr-admin-cards-2026-04-03.md)
Location: .claude/outputs/ccr/
```

```markdown
---
subject: [What was reviewed]
role: [Role used]
level: [Level used]
output: [Summary / Detail]
date: [YYYY-MM-DD]
final_score: [XX%]
gate_result: [ADVANCE / STOP]
prompt_used: [Inline or path to saved prompt]
---

[ Full gate summaries and details from the run ]
```

When a run is saved, the frontmatter (role, level, output, prompt) automatically populates "Previous Selections" for the next run. One answer — "Use same selections? Yes" — and you're straight to work.

---

## MVP Frontend Surfaces (All Must Be Assessed)

1. `admin.html` — Event management control room
2. `public.html` — Mobile-first public event page
3. `display.html` — TV/kiosk live event display
4. `poster.html` — Printable poster with QR codes
5. `sharedReport.html` — Shareable analytics dashboard
6. `doc` rendering — on public/poster/tabletop/digital surfaces
7. `config.html` — Configuration interface

Focus: ease of use across the entire application, uniform UX, Kaizen
