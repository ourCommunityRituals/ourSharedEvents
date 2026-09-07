# OCR_STANDARD_storyClassification

**Status:** ACTIVE · **Owner:** platform · **Last updated:** 2026-09-06

> Every story is classified by **what its deliverable IS**, before it is filed:
> **Action** (a shipped change — right now) · **Spike** (a decision/answer from investigation —
> future) · **Field** (a real-world community/venue/campaign outcome) · **Ops** (a real-world
> owner/infra act — billing, secrets, console, provisioning) · **Vision** (a doctrine/concept/
> reference note, no shippable deliverable).
> A ticket whose deliverable spans two of these is a **Hybrid** and MUST be split.
>
> This is the *first* cut on any story because it sets everything downstream: the shape of the
> Definition of Done, the estimate, what "done" means, *when* it is scheduled, and whether it
> belongs on the board at all. It is the intake twin of [[OCR_STANDARD_reconciliationLoop]] and
> composes with the four-field work-intake contract (Stated Problem · DoD · Verification · Formatting).

---

## 0. The cut

| Class | The deliverable is… | Temporal | DoD shape |
|-------|---------------------|----------|-----------|
| **Action** | a **shipped change** that lands (code · config · doc · infra · migration) | **now** — committed work | "X now does / fails / returns Y" |
| **Spike** | a **decision or answer** produced by investigation | **future** — taken up when warranted | "the question is resolved + a recommendation recorded" (NOT code) |
| **Field** | a **real-world outcome** the team causes off-keyboard that is **community/venue/campaign** | its own real-world / GTM calendar | "the outcome happened, evidence recorded" (a signed sponsor, a printed poster scanned, a formed committee) |
| **Ops** | a **real-world owner/infra act**, not code and not community: billing/plan, secret/key rotation, branch-protection, DNS, console/connector/runner provisioning | when the owner does it (often auth-boundary) | "the infra/account state changed" (a token rotated, a cap lifted, a namespace provisioned) |
| **Vision** | a **doctrine/vision/concept/reference note** — no shippable change, no live question | none — a durable home, not sprint work | "the idea/reference is captured and findable" |

The cut is **temporal as much as structural**: Action = *now*, Spike = *future*, Field = *real-world
clock*. Classifying a story therefore also places it in time.

---

## 1. The decision procedure (run this on a blank ticket)

1. **Ask: what is the single artifact that proves this ticket done?**
   - A diff / a deployed change / a migrated schema → **Action.**
   - A written decision, ADR, recommendation, benchmark number, audit report, gap map → **Spike.**
   - A real-world event: a person said yes, ink was scanned, a lawyer opined, a rig was built,
     a committee was seated → **Field.**
2. **If the ticket names more than one of those artifacts** ("*decide* X **then** build it";
   "*confirm* Y **then** retire it") → it is a **Hybrid.** Do not file it as one ticket. **Split:**
   the decision becomes a Spike; the build/act becomes an Action or Field, `blocked-by` the Spike.
3. **If it is a Spike, ask: is the question LIVE?** Is something forcing the decision *now*
   (a gate going red, a real bloat signal, a launch date)? If **no live question**, it is **not a
   board item** — it is a *note* in the owning ticket + the relevant standard, and it re-files itself
   the moment a threshold trips. (Contrast: a deferred *Action* is a legitimate backlog item — the
   work is known, just not now.)
4. **Record the class as a label** (§3) at creation time.

### Signal verbs (heuristic, not authority — the *deliverable* is authority)

- **Action:** add · build · fix · wire · implement · migrate · retire · split · enforce · delete · provision.
- **Spike:** evaluate · investigate · decide · assess · measure · audit · benchmark · reconcile-which-is-canonical · "figure out" · "decide whether" · "no code".
- **Field:** recruit · ask · walk-in · email · print-and-scan · seat-a-committee · obtain-an-opinion.

> ⚠️ Verbs are a *hint*. A Spike phrased "**Add** a decision doc" is still a Spike; an Action titled
> "**Decide** the CSP header" that ships a config is still an Action. When title and deliverable
> disagree, the **deliverable wins** — and fix the title.

---

## 2. The label taxonomy (the machine-readable signal)

Classification is carried by a **committed label set**, so it is parseable, not prose-only:

| Label | Meaning | Casing |
|-------|---------|--------|
| `action` | deliverable = shipped change | lowercase |
| `spike` | deliverable = decision/answer from investigation | lowercase |
| `field` | deliverable = real-world outcome | lowercase |
| `hybrid` | decision glued to a build/act — **transient**, clears when split | lowercase |
| `ops` | deliverable = real-world owner/infra act (billing · secrets · console · DNS · provisioning) | lowercase |
| `vision` | deliverable = doctrine/vision/concept/reference note (not sprint work) | lowercase |

**Rules.**
- **Every active story carries exactly one class label.** `UNLABELED = not yet classified` — never
  silently "Action." (Before this standard, "Action = the unlabeled default" made a classified
  Action indistinguishable from an unreviewed ticket; that ambiguity is banned.)
- **One word per axis.** `spike` means *pure undecided investigation only*. A ticket that also
  contains a build obligation gets `hybrid`, never `spike` — reusing one word across two axes is the
  `local`/`is_local` legibility anti-pattern ([[OCR_STANDARD_namingConvention]]).
- **`hybrid` is a work-marker, not a resting class.** A story may not enter a sprint carrying
  `hybrid`; it must be split first.
- Casing is uniform lowercase. (Legacy `FIELD` is renamed `field`.)

---

## 3. Enforcement — the pawl (so classification cannot silently drift back)

A classification applied once decays the moment the next ticket is filed ("green is rented").
The standard is not satisfied by a one-time sweep; it requires standing enforcement:

1. **Intake gate.** The Linear story template forces the class choice **at creation**. A story
   created without a class label is caught by (3) below. Classification is a *structural property of
   every new ticket*, not an audit finding on old ones.
2. **Machine-readable field.** The class is a parseable signal (the label set above, or a Linear
   `story-type` enum field) — never re-derived from free-text verb search after the fact.
3. **Mislabel tripwire (fail-closed CI/webhook).** Fires when a `spike`- or `field`-labeled story is
   moved to **Urgent/High** priority or into **In-Progress** without a linked Action — the exact
   "deferred investigation drawing now-urgency" smell — and when an active story carries no class.
4. **Born-red drill.** The tripwire is proven by injecting ≥5 **disguised** spikes (a spike phrased
   "Add X" whose DoD reads "decide whether…") and confirming all 5 are flagged. A gate never observed
   catching its target failure mode is taken on faith ([[OCR_STANDARD_reconciliationLoop]] §
   andon-drill; the kaizen pawl).
5. **Measured precision/recall.** A 30-ticket stratified ground-truth sample, independently
   classified (SoD: the classifier ≠ the labeler), scored against the applied labels. Baseline
   committed; the classifier is not trusted below **P ≥ 0.85 / R ≥ 0.80**.

**Separation of duties.** When an agent fleet performs a classification sweep, the *classify* pass
(read → manifest) is separate from the *apply* pass (human-gated). The measurer is not the measured.

---

## 4. The Field ↔ Spike boundary (open — owner ruling pending)

A genuine boundary case: **obtaining an external opinion** (e.g. a lawyer's BIPA read).

- **Owner ruling 2026-09-06:** a legal opinion is **Field** (a real-world engagement).
- **Ontology dissent (recorded for resolution):** Field = a real-world act the team *performs*;
  external *information the team receives* is a **Spike with an external dependency**. Under this
  reading a legal opinion is a Spike whose answer comes from outside.

Until the owner settles this in a future revision, **legal-opinion tickets are `field`** per the
standing ruling. Affected: OCR-18, OSE-356/357. Do not silently reclassify; cite this section.

---

## 5. Why this is load-bearing

Mixing the classes produces the failure this standard exists to prevent: a Spike's body
("*evaluate* a manifest/marker") filed under an Action's expectation of shipping — it reads as
committed build-work that isn't, bloats the backlog, and either stalls or is closed on the wrong
criterion. Naming the class at intake catches the mismatch up front; the tripwire keeps it caught.

This is the ticket-layer instance of the metric/gate-accretion guard ([[OCR_STANDARD_reconciliationLoop]]:
default-deny until it names a decision) and of "green is rented" — the classification is only true
while the pawl holds.

---

## 6. Board hygiene — the queue vs the record (churn control)

Linear does two jobs at once, and conflating them is the source of ticket churn:

- **The work queue** — what is actively being done. It *should* churn (create → work → close).
- **The durable record** — decisions, concepts, references, "why we didn't." It should be
  *stable and findable*, and must **not** be managed as if it were the queue.

The class labels separate the two so the record stops masquerading as work:

| Surface | Classes | Linear state | Churns? |
|---------|---------|--------------|---------|
| **Work queue** | `action` · `field` · `ops` · live `spike` | Todo / In-Progress | yes — this is the only set you "manage" |
| **Reservoir** | any class | Backlog | no — a holding pen, not active work |
| **Record** | `vision`, decision-records, references | Backlog (or a parked/"Someday" state) | never — documented, filtered out of the queue |

**The canonical work-queue filter** (save it as a Linear view — "Active Work"):

```
status:(Todo, In Progress)  AND  label:(action, field, ops, spike)  AND  -label:vision
```

**The record view** ("Concepts & Reference"): `label:vision`. It exists to be *read*, not triaged.

The ~N-hundred Backlog items are a **reservoir, not a backlog crisis** — counting them as "active
work to manage" is the illusion that creates triage overwhelm. Manage the queue view; let the
reservoir sit.

### What earns a *tracked* ticket (the reconcile-everything refinement)

`OCR_STANDARD_reconciliationLoop` says *file a story for every inconsistency*. Unbounded, that rule
IS a churn engine. Refined by this standard:

- **Only `action` · `field` · `ops` · a live `spike` earns a tracked, churning ticket.**
- **`vision`, decision records, and references are captured as a label + a brain-doc entry — NOT a
  churning board item.** A concept with no live question does not get a ticket it will never close
  (the "spike with no live question = a note" rule, §1 step 3, generalized).

So the reconcile loop still drives drift to zero and records everything — but the *record* half lands
in labels + the brain, and only genuine work lands in the churning queue. Zero-drift without
zero-restraint.

## Provenance

Authored under **OCR-145** from the 3-loop CCR of the 2026-09-06 story-classification session
(Security · Backend-Ontology · Legibility · SDET/SRE · DevOps). Loop-1 40% → Loop-2 60%; this
standard + its enforcement is the path to the 95% gate. Doctrine origin: the Action-vs-Spike cut
(owner, 2026-09-06), extended with **Field** as a third top-level class (owner ruling, same day).
