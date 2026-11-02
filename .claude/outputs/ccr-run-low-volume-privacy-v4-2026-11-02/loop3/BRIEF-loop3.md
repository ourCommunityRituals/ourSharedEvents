# Loop 3 (Adversarial) brief: CCR run on epic OSE-1766, subject v4 frozen

You are one lens of the extended scrum team in loop 3 of a five-loop CCR run (owner's run model, 2026-11-02: loop 1 Critical, 2 Conservative, 3 Adversarial, 4 Compliance, 5 Recursive, all on ONE frozen subject; nothing is changed between loops; one cumulative score after loop 5). You give NO score and NO gate decision. You do not fix anything. You do not edit the subject.

## Inputs (read all three before anything else)

- The frozen subject: `/c/Users/mzdan/AppData/Local/Temp/claude/C--Users-mzdan-dev-ourCommunityRituals-ourSharedEvents/bb2c645f-b46e-4e4c-b542-907c20042726/scratchpad/ccr-run/subject-v4-frozen.md` (sha256 dd9b85225ce79ebd3d53c5f4f7b35a1706e1ec79aa8d37207ab269a45225b7f4; do not modify). Slices retained: S2, S3, S4, S5, S6, S7, S14, S15, S16, plus OSE-1496 (signing). Sections A to K. <!-- pragma: allowlist secret -->
- The loop-1 register: `/c/Users/mzdan/AppData/Local/Temp/claude/C--Users-mzdan-dev-ourCommunityRituals-ourSharedEvents/bb2c645f-b46e-4e4c-b542-907c20042726/scratchpad/ccr-run/loop1/MERGED-loop1.md` (R1-01 to R1-46).
- The loop-2 cumulative register: `/c/Users/mzdan/AppData/Local/Temp/claude/C--Users-mzdan-dev-ourCommunityRituals-ourSharedEvents/bb2c645f-b46e-4e4c-b542-907c20042726/scratchpad/ccr-run/loop2/MERGED-loop2.md` (R1 rows with the loop-2 column, R2-01 to R2-29, clusters C1 to C6, out-of-scope records). Read its section 0 (facts checked twice) and section 1 in full.

Code is read in the worktree `C:\Users\mzdan\dev\ourCommunityRituals\ose-clock-gate` (`workers/oursharedevents/src` equals `origin/main` 39a63d67; the extra commits are the clock-gate spec only). Paths in the registers are under `workers/oursharedevents/` unless prefixed. Nothing runs against staging or production. No deploys, no secrets, no writes outside your one output file.

## What loop 3 asks of you

Adversarial: for the Highs in your lens, you are the attacker. For each one, write an **attack card**:

- Actor (one of: attendee, hostile organizer, sponsor, platform operator or insider, outsider with a D1/KV export, a CI step on a same-repo PR, a bot swarm, or a colluding pair of these; organizers are in the threat model as adversaries of attendees, owner 2026-10-31).
- Goal (what they learn or poison: a person, a trail, an exact count below 5, a false published figure, a bypassed gate).
- Steps, concrete and numbered, with file:line for every claim about code or CI. Say what the attacker needs (access, cost, timing) and what the subject's criterion would show while the attack runs.
- Success condition: what the attacker holds at the end; whether the under-5 floor, never-who, place-not-person, or a CI gate is broken; and whether any criterion in the subject (an AC, a staging step, a born-red test) goes red. If none goes red, say so in those words.
- Verdict: attack **works on main**, **works after the subject ships**, **blocked by the subject** (name the AC that blocks it), or **not reachable** (say why, with evidence). Severity stays the register's base tier; you may propose a change with a reason.

The 14 Highs after loop 2: R1-01, R1-02, R1-03, R1-04, R1-05, R1-06, R1-07, R1-08, R1-09, R1-10, R1-16, R1-23, R2-01, R2-02. Cover every High that touches your lens; name the ones you leave to other lenses. Then attack the subject's own controls: pick at least three criteria from loop 2's "criteria that cannot catch their own failure" list that are in your lens and show the fault that passes them (an injected fault that leaves the AC green).

Also test, as the attacker: the correlation clusters C1 (scan order as a join key), C2 (withheld vocabulary), C3 (scans are not people), C5 (privacy notice), C6 (staging evidence). Say whether combining two rows in a cluster gives the attacker more than either alone, with a worked example.

Open platform facts the run has not settled (do not guess; if your lens can settle one from docs or repo config, say how): whether a KV listing returns expiry; what Workers Logs keep for `/q`; dead-letter queue retention; the staging token's real scope and the GitHub secret level of `CLOUDFLARE_API_TOKEN_OSE`; production migration level (77 last read) versus 104.

New findings only when the root cause is new (not in R1 or R2): give id `L3-<ROLE>-n`, severity, slice, claim, evidence (file:line), basis (proven / arithmetic / source-read / inferred), root cause, and why it is not already a row. Out of scope for the epic (OSE-1780 padding/forged cookies/presence bit/noise; OSE-1783/1784/1787 who-side count publication; OSE-1496 signing): record once, never rate.

Basis discipline: mark every claim proven (a command's result), arithmetic, source-read, or inferred. Never state an inferred platform fact as true.

## Output

Write your report to `/c/Users/mzdan/AppData/Local/Temp/claude/C--Users-mzdan-dev-ourCommunityRituals-ourSharedEvents/bb2c645f-b46e-4e4c-b542-907c20042726/scratchpad/ccr-run/loop3/<role>.md` with sections: 1. Attack cards (one per High in your lens), 2. Attacks on the subject's own controls, 3. Cluster tests, 4. New findings table, 5. Re-rates with reasons, 6. Not checked, 7. Commands run (all read-only; say if any was refused). If your rules forbid writing a file, return the whole report as your final message and the lead will save it verbatim to that path. Keep the report under 300 lines. Do not run tests that write to the repo; do not create branches, commits, or stashes.
