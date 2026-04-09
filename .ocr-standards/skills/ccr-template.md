# CCR Template

## Run a Critical · Conservative · Recursive Review

---

### How to Use This Template

1. **Copy this file** and rename it for your review (e.g., `ccr-auth-rewrite.md`)
2. **Fill in Section A** — describe what you're reviewing
3. **Run the loops** — work through Section B, one loop at a time
4. **Record your results** — fill in Section C when done
5. **Ship or stop** — the score tells you what to do

That's it. If your score hits 95%, you ship. If it doesn't, you stop and get help. No judgment calls on the gate.

---

## A. Setup

Fill this in before you start.

### Discipline

_Pick one. This is the lens — what you're looking for._

- [ ] **Product** — Does this serve users? Is the UX right? Does the business case hold?
- [ ] **Engineering** — Is the code correct, testable, maintainable, and performant?
- [ ] **QA / Automation** — Is this testable? Are edge cases covered? Will the test pyramid hold?
- [ ] **Finance** — What does this cost? What's the ROI? Are token/infra costs sustainable?
- [ ] **Compliance** — Does this meet regulatory requirements? Are data handling obligations met?
- [ ] **Legal** — Are there liability, IP, or contractual risks?
- [ ] **Security** — Are there vulnerabilities? Does the threat model hold?
- [ ] **Design / UX** — Is this usable? Accessible? Does it follow Kaizen principles?
- [ ] **DevOps / SRE** — Is this deployable, observable, and recoverable?
- [ ] **Scrum Team** — Does this work across all disciplines? Stories sized, sequenced, and testable for the whole team?
- [ ] **Custom:** `[ write your own ]`

### Level

_Pick one. This is the scope — how wide you're looking._

- [ ] **Local** — One file, function, component, or story
- [ ] **Feature** — One feature across its full surface (routes, UI, tests, docs)
- [ ] **Product** — One product repo end-to-end (e.g., OSE or ourWKRP)
- [ ] **System** — Cross-product, full OCR product line
- [ ] **Custom:** `[ write your own ]`

### How Roles Use Levels

Different roles use levels differently. Some park at one level. Others move through them as the work progresses.

| Role                   | Typical level progression            | Why                                                                     |
| ---------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| **PO**                 | Pick one (Story or Feature) and stay | Focused acceptance — is this story/feature done?                        |
| **Engineer**           | Local → Feature → Product → System   | Build up confidence as code integrates outward                          |
| **QA**                 | Local → Feature → System (one-time)  | Vet tests at each tier, then blast radius check                         |
| **Design / UX**        | Feature → Product                    | Does the feature UX hold, then does it stay uniform across the product? |
| **DevOps / SRE**       | Feature → Product → System           | Can it deploy, then does it play nice with everything else?             |
| **Compliance / Legal** | System (usually)                     | Regulations don't care about your file structure                        |
| **Finance**            | Product or System                    | Cost is a product-level or system-level question                        |
| **Scrum Team**         | Feature → Product                    | Is the team unblocked on this feature, then is the backlog healthy?     |

**The progression is the process.** An engineer runs CCR at Local, fixes what's found, moves to Feature, fixes what's found, then Product. Each level's CCR output feeds the next. By the time QA does a System-level blast radius check, most issues are already caught. Nightly automation confirms the process worked — it shouldn't be where defects are first discovered.

**Discipline + Level = your review.** Same three questions, different meaning at every combination:

| Discipline   | Local                                        | Feature                                                 | Product                                       | System                                                          |
| ------------ | -------------------------------------------- | ------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| Product      | Does this component serve the user need?     | Does this feature's UX hold end-to-end?                 | Does this product deliver its value prop?     | Does the product line cohere as one offering?                   |
| Engineering  | Is this code correct?                        | Do all parts of this feature integrate cleanly?         | Is the architecture sound repo-wide?          | Do cross-product contracts hold?                                |
| QA           | Is this unit tested?                         | Is coverage complete across the feature?                | Does the test pyramid hold for this product?  | Does the cross-product integration tier pass?                   |
| Finance      | What does this change cost in tokens?        | What's the feature's build + maintenance cost?          | What's the product's total cost of ownership? | Is the product line financially sustainable?                    |
| Compliance   | Does this function handle data correctly?    | Does this feature meet data obligations?                | Does this product pass audit?                 | Does the full system meet regulatory requirements?              |
| Legal        | Any IP risk in this code?                    | Any liability in this feature?                          | Are product terms enforceable?                | Cross-product contractual exposure?                             |
| Security     | Is this function safe?                       | Is the feature's threat model complete?                 | Does the product's security posture hold?     | Do cross-product boundaries prevent lateral movement?           |
| Design / UX  | Is this component usable?                    | Is the feature's user journey validated?                | Is the product's UX uniform (Kaizen)?         | Is the cross-product experience coherent?                       |
| DevOps / SRE | Is this deployable?                          | Can this feature be rolled back independently?          | Is the product's CI/CD pipeline sound?        | Can products release independently without breaking each other? |
| Scrum Team   | Is this story sized and clear for all roles? | Can all disciplines deliver this feature in one sprint? | Is the backlog sequenced for the whole team?  | Are cross-product dependencies mapped and unblocked?            |

### What are you reviewing?

```
[ One sentence. What is the thing under review? ]
```

### Why does it matter?

```
[ What breaks if this is wrong? Who is affected? ]
```

### What's in scope?

```
[ List the specific files, components, or decisions being reviewed. ]
[ Be precise. If you can't name it, you can't review it. ]
```

### What's NOT in scope?

```
[ Name it explicitly. Scope creep kills loops. ]
```

### Who needs to approve?

```
[ Name the human(s) at the gate. ]
```

---

## B. Run the Loops

Work through each loop in order. **Do not skip ahead.** The output of each loop is the input to the next.

---

### Loop 1 — Surface Pass

_Goal: Find what's obviously wrong. Cast wide. Don't try to find everything._

**Critical — What's the most dangerous assumption here?**

```
[ What are you assuming is true that you haven't verified? ]
```

**Conservative — What's the worst case if you're wrong?**

```
[ If your assumption above is false, what happens? ]
```

**Recursive — Score check.**

```
Confidence: [ ]%
Direction:  [ First score — baseline ]
```

**Decision:**

- [ ] Score ≥ 95% → Proceed to Loop 2
- [ ] Score < 95% → **STOP.** Fill in the Human Gate below.

**Human Gate (if stopped):**

```
Question that needs answering:
[ What specific thing do you need a human to confirm? ]

Information needed:
[ What would close this gap? ]
```

---

### Loop 2 — Pressure Pass

_Goal: Find what Loop 1 missed. Target the gaps, edges, and things that looked solved but weren't verified._

**Critical — What did you assume was solved that you never actually verified?**

```
[ What looked done in Loop 1 that you didn't actually check? ]
```

**Conservative — Does the floor still hold?**

```
[ Under Loop 1's findings, does the worst-case scenario still have a mitigation? ]
```

**Recursive — Score check.**

```
Confidence: [ ]%
Direction:  [ Up / Down / Stable from Loop 1 ]
```

**If the score dropped:** That's the protocol working. Don't rationalize it back up.

**Decision:**

- [ ] Score holds or improves → Proceed to Loop 3
- [ ] Score drops below 95% → **STOP.** Fill in the Human Gate below.

**Human Gate (if stopped):**

```
Question that needs answering:
[ What did Loop 2 reveal that Loop 1 missed? ]

Information needed:
[ What would close this gap? ]
```

---

### Loop 3 — Confirmation Pass

_Goal: Confirm the conclusion is stable. You're not looking for new problems. You're confirming the solution survives scrutiny._

**Critical — Are you rationalizing or verifying?**

```
[ Is there anything you're telling yourself is fine that you haven't actually proven? ]
```

**Conservative — Would you defend this if it shipped and broke?**

```
[ If this goes to production and fails, can you point to the work that said it was ready? ]
```

**Recursive — Final score.**

```
Confidence: [ ]%
Direction:  [ Up / Down / Stable from Loop 2 ]
```

**Confidence Decay Check:**

- Loop 1: [ ]%
- Loop 2: [ ]%
- Loop 3: [ ]%
- Trend: [ Rising / Stable / Decaying ]

**If decaying:** Do not ship. Return to Loop 2 with new findings.

**Decision:**

- [ ] Score ≥ 95% and stable → Proceed to Results
- [ ] Score < 95% or decaying → **STOP.** Fill in the Human Gate below.

**Human Gate (if stopped):**

```
Question that needs answering:
[ What is still unresolved after three loops? ]

Information needed:
[ What would close this gap? ]
```

---

## C. Results

Only fill this in when all loops clear at ≥ 95% with stable or rising confidence.

### Loop Summary

| Loop | Score | Key Finding |
| ---- | ----- | ----------- |
| 1    | %     |             |
| 2    | %     |             |
| 3    | %     |             |

### What was reviewed (confirmed scope)

```
- [ file/component ]: [ what was assessed ]
- [ file/component ]: [ what was assessed ]
```

### What must be true before shipping

```
- [ ] [ Pre-condition 1 ]
- [ ] [ Pre-condition 2 ]
```

### What to do (commit sequence)

```
1. [ First commit — what and why ]
2. [ Second commit — what and why ]
3. [ Third commit — what and why ]
```

### How to verify after shipping

```
- [ ] [ Verification step 1 ]
- [ ] [ Verification step 2 ]
```

### Risks accepted

```
- [ Named risk ]: [ Why it's acceptable ] — [ Mitigation in place ]
```

---

## D. Quick Reference

### Scoring

| Score   | What it means                        | What you do                        |
| ------- | ------------------------------------ | ---------------------------------- |
| < 70%   | Too many unknowns                    | Stop. Gather info. Don't loop yet. |
| 70–84%  | Gaps are named but open              | Stop. Close the gaps.              |
| 85–94%  | Almost there, mitigations incomplete | Stop. Finish mitigations.          |
| 95–97%  | Solid. Assumptions documented.       | Ship.                              |
| 98–100% | Clean. No open assumptions.          | Ship.                              |

### How many loops?

| What you're reviewing | Minimum loops             |
| --------------------- | ------------------------- |
| Bug fix, isolated     | 3                         |
| Security fix          | 3–4                       |
| Major upgrade         | 4–5                       |
| Architecture change   | 5+                        |
| Compliance surface    | 5+, human gate every loop |

### Things that break CCR

| If you're doing this...              | ...CCR isn't working                |
| ------------------------------------ | ----------------------------------- |
| Scoring 95%+ on Loop 1               | You stopped looking too early       |
| Running loops in parallel            | You broke the recursive chain       |
| Rounding 93% up to 95%               | The gate is not a negotiation       |
| Skipping the human gate              | Silence is not confirmation         |
| Being supportive instead of critical | Find what's wrong, not what's right |
