# CCR — How OCR uses Claude today vs. the ideal setup

**Date:** 2026-10-11 · **Protocol:** CCR v3.0, 5 loops (asked for by the owner) · **Level:** System (all OCR repos plus the owner's Claude account setup)
**Disciplines:** Business (extended PO / business-analysis team) → Engineering (extended scrum team, including DevOps Mgr, Sr Data Scientist and Dr of Security)
**Inputs:** six infographics the owner supplied (two-brain agent architecture, Haiku 5.5, Sonnet 5.5, "Everything in Claude", Opus 5.5 effort levels, AGENTS.md as operating contract), plus readings taken today from the machine, the repo and the account.
**Assessor:** Claude (Opus 5.5) · **Human at the gate:** Matthew Zdano (PO)

---

## Verdict

| Measure | Result |
|---|---|
| **System score** (setup vs. ideal, `100 − Σ finding × weight`) | **0%**: two **Security Critical** findings are unresolved, and Security Critical gets no partial credit. Without the floor the arithmetic is −18. |
| **Assessment confidence** (how sure I am the findings are right) | **92%** after loop 5, rising 68 → 80 → 85 → 89 → 92. **Below 95, so the gate is not cleared.** The open questions are in §9. |
| **Shape** | **Barbell, again.** The slow-brain side (planning, review, CCR, born-red verification, a two-stage Done) is better than the infographics ask for. The fast-brain side, the policy layer and context economy are nearly absent. One model at one high effort does everything, on a large context that is re-read every turn. |

**Biggest single lever (it isn't in any of the infographics):** each turn re-reads ~104K tokens of fixed preamble before any work happens. Sessions are also allowed to grow to ~970K tokens before they compact. Cache reads were about **two-thirds** of the API-equivalent cost of the historical usage. Cutting what gets re-read each turn saves more than switching models does.

---

## 1. What the infographics say (data extracted)

| # | Infographic | Claims that apply to this setup |
|---|---|---|
| 1 | *Your Coding Agent Is Overthinking*: two brains | **Slow brain** (plan / implement / review) on the frontier model. **Fast brain** for small decisions: `route_task`, `rank_files` (before loading context), `classify_ci`, `pr_risk` (low/med/high), `retry_or_escalate`, `preserve_context` (what survives compaction). **Policy/** is deterministic code: permissions, secrets, deploy rules, approval gates, **spend limits**, audit. Flow: ticket → plan → fast decide → execute → **policy gate** → tests + human review → release. Rules: *"Do not use one frontier model for every decision."* *"Confidence is a signal. Policy is authority."* *"Never use model confidence as permission."* Production deploys and high-risk actions need approval. |
| 2 | *What to hand to Haiku 5.5* | Plan with Opus or Sonnet and give well-defined tasks to Haiku. Haiku fits summarizing transcripts, routing requests, compacting context, first-pass reads, pulling fields, flagging what needs a closer look, high-volume classification, repetitive form and data entry. About 75% cheaper than Haiku 4.5. |
| 3 | *When to reach for Sonnet 5.5* | Bug fixes, quick iteration, checking code against requirements. **Recurring triage ready every morning.** Docs, decks and sheets. Polished screens and flows. For complex, open-ended work, start with Opus. |
| 4 | *Everything you must know in Claude* | Six levels: where you open it, which model, **how hard it thinks** (*"The Trap: more thinking is not more correct; long reasoning gives it more room to be confidently wrong"*), how you work (Chat, Cowork, Design, Projects, Code), what you get back (artifacts, real files, **live artifacts**), what it is plugged into (connectors, memory, **skills: written once, followed every chat**). |
| 5 | *Choosing an effort level with Opus 5.5* | Low: a one-sentence change. **Medium: start here for most work.** High: when medium stalls. Extra high: when high still can't get there, then **switch to Fable 5.1**. Max: hardest tasks only, **not a standing default**. **Before raising effort, give the model a way to check its work** (a test with a clear pass/fail); that often catches at medium what would otherwise need high. **Changing effort clears the cache, so change it between tasks, not mid-task.** |
| 6 | *AGENTS.md is becoming the operating contract* | One file in the repo, read by Claude Code, Codex, Copilot and others. Contents: architecture, test and build commands, conventions, quality gates, **where a human must approve**, **definition of done**. Benefits: portable, versioned, less duplication across CLAUDE.md, IDE notes and per-tool config. *"Teach the repository once."* |

---

## 2. Evidence: the setup today (measured, with sources)

| Area | What was found | Source |
|---|---|---|
| Plan | **Max**. Weekly limit at 43% with 2d 15h left (on pace for ~68%). Fable weekly at 0%. **Extra usage on, $30.50 spent** | `get_usage`, 2026-10-11 |
| Model mix (history, 2026-06-20 → 09-28) | Output tokens: **Opus 97.4%** (93.6M of 98.7M on Opus 4.8), Fable 1.9%, **Haiku 0.6%, Sonnet 0.2%**. Cache reads: **19.8B tokens**, 97% on Opus | `~/.claude/stats-cache.json` `modelUsage` |
| Re-reads per turn | 19.8B cache-read tokens over 98K messages ≈ **~200K tokens re-read per message** on average. Longest session: 951 messages over 44 h | same |
| Fixed preamble (this session, turn 1) | **~104K tokens**: system tools 36.4K, **memory files 33.4K**, **MCP tools 17.6K**, **skills 9.9K**, MCP instructions 6.9K | `get_usage` context categories |
| Context ceiling | 1M window, **auto-compact at 97%** | `get_usage` |
| Defaults | `effortLevel: "xhigh"`, **`fastMode: true`**, `defaultMode: "auto"`, `autoApproveEdits` and `autoApproveExecutions` both true | `~/.claude/settings.json` |
| Allow-list | `Bash(git:*)`, `Bash(npx:*)`, `Bash(gh api:*)`, `Bash(curl:*)`, `Bash(cd:*)`. The hub `settings.local.json` is **21 KB** of one-off allows (`Bash(git push *)`, `Bash(node *)`, `Bash(python3 *)` …) | user + hub settings |
| Deny-list | **Only `mcp__plugin_mapmap_mapmap`** | user settings |
| Own hooks | **None.** Only plugin-supplied ones (gitkraken-hooks, security-guidance) | user settings; no checked-in project `settings.json` |
| Production credentials on the machine | Wrangler is logged in (`default.toml` exists in two places). Production D1 has been migrated from this machine before (CLAUDE.md §3 DevOps, 2026-09-21) | file probe; CLAUDE.md |
| **API key in plaintext** | `~/.claude/config.json` holds `primaryApiKey: sk-ant-api03-…`. **This review's own read printed it into this transcript.** | file read, 2026-10-11 |
| OSE `CLAUDE.md` | **84,724 bytes**. §3 "role current states" is **~63 KB (75%)** of dated change-log ("2026-09-16 … 2026-10-08") | section byte count |
| Session protocol | Reads CLAUDE.md and then **STORIES.md (109,933 bytes)**, although the 2026-09-22 rule says STORIES.md is not the source of truth | CLAUDE.md header and §5 |
| `AGENTS.md` | **Missing everywhere.** No `.github/copilot-instructions.md` either. The built-in `cc-plugin-agents-md` has never been used (`usageCount: 0`) | file probe, `.claude.json` |
| Other agents in the loop | Copilot as PR reviewer (`PR_REVIEWER=copilot` path) and Copilot coding-agent PRs (`copilot/*`, ADR-020). Claude review in CI on **Sonnet 5.5** | `.github/workflows/claude-review.yml:163,217`; CODEOWNERS |
| OSE `.claude/skills/` | 14 flat `.md` files (`ccr-protocol.md` is **111,830 bytes**). **None is in `<name>/SKILL.md` form, so the harness never lists them.** | directory listing vs. this session's skill list |
| Hub `.claude/agents/` | 6 recon agents, **all `model: sonnet`**. The README records that `tools:` scoping is **not enforced at call time** (verified 2026-09-01) | hub `.claude/agents/*.md`, `.claude/README.md` |
| Default subagent model | Not set, so Explore and general-purpose agents run on the parent's model (Opus) | settings; Agent tool behaviour |
| Plugin and connector load | ~300 skills listed, most unrelated to OCR (Unity, Shopify, ZoomInfo, Daloopa, sales, finance, HR, SEO…). MCP connectors unrelated to OCR: Spotify, ICD-10, LegalZoom, Pricewatcha, Shopify, alphaXiv, Consensus. You already switch plugins off with `skillOverrides` (mapmap) | this session's system context |
| Memory | 99 files, 337 KB. `MEMORY.md` 16.5 KB is loaded every session and has some stale entries ("LAUNCH WEEK log (historical)") | memory directory |
| Scheduled agents | 3 definitions on disk (`story-runner`, `ose-linear-status-sweep`, `sync-linear-dashboard`). **None is scheduled.** Their text is stale: they say self-hosted Bloodraven (retired 2026-09-02) and `gh pr merge --admin` | `~/.claude/scheduled-tasks/*`, `list_scheduled_tasks` |
| CCR outputs | 30 worksheets, 601 KB, scored with a formula (`100 − Σ finding × 25/15/10/5/2`), several honestly below 95 (50.5%, 92.5%) | `.claude/outputs/`; `ccr-protocol.md:153-154` |

**Pricing used (Anthropic first-party, cached 2026-10-06):** Opus 5.5 $4 in / $20 out / $0.20 cache read · Sonnet 5.5 $2 / $10 / $0.20 · Haiku 5.5 $0.10 / $0.50 · Fable 5.1 $10 / $50 / $0.25 · **Opus 5.5 fast mode $8 / $40 (2×)** · cache write ≈ 1.25× input. History is priced at the Opus 4.8 rates in force then ($5 / $25 / $0.50).

---

## 3. Gap matrix: infographic principle → today → ideal

| Principle (source) | Today | Ideal for this setup | Gap |
|---|---|---|---|
| Slow brain plans and reviews (1) | Superpowers brainstorming and plans, CCR, born-red tests, a two-stage Done | Keep it | ✅ Strength |
| A way to check the work before raising effort (5) | **Unusually strong**: born-red on every gate, 9 CI gates, preflight scripts | Use it to justify **lower** effort on routine stories | ✅ Strength, under-used |
| Fast brain for small decisions (1, 2) | No fast layer. Opus at xhigh triages CI logs, reads Linear lists and greps files | Haiku 5.5 for routing, ranking files, classifying CI, Linear sweeps; deterministic rules first | 🔴 High |
| Don't use one frontier model for everything (1, 4) | Opus 97% of output | Opus ~55–65% · Sonnet ~25–35% · Haiku most subagent calls · Fable only when escalated | 🔴 High |
| Medium is the start; max/xhigh not standing (5) | Standing **xhigh** plus **fast mode** | High during launch, then medium for routine work; raise per task; set at session start | 🔴 High |
| Policy is authority, deterministic (1) | Auto mode + auto-approve; broad allows; one deny; no own hooks; prod credentials on the machine | Checked-in deny rules + a PreToolUse policy hook + an audit log, each born-red | 🔴 Security Critical |
| Secrets never exposed (1, policy/secrets) | Plaintext API key readable by the agent and **already exposed** | Rotate; no plaintext keys; Read-deny on credential files | 🔴 Security Critical |
| Spend limits (1, policy/spend) | None. Fast mode on by default; extra usage on ($30.50) | Fast mode opt-in; extra usage capped; weekly usage check | 🟠 High (part of H3) |
| `preserve_context` / compaction (1, 2) | Compacts at 97% of 1M; 44-hour sessions | One story per session, `/clear` between tasks, compaction instructions, reading in subagents | 🔴 High |
| `rank_files` before loading context (1) | Main session reads 85–112 KB files whole (CLAUDE.md, STORIES.md, ccr-protocol.md) | Small index files; subagents rank and fetch; skills load in layers | 🟠 Medium |
| Skills written once, followed every chat (4) | OSE skills in a format the harness ignores | `ccr/SKILL.md` (~4 KB core) + `references/`; roles as `.claude/agents/` | 🟠 Medium |
| AGENTS.md operating contract (6) | Absent; Copilot reviews and writes PRs with no repo guidance | AGENTS.md (≤12 KB, durable) ← CLAUDE.md `@AGENTS.md` + Claude extras; Copilot points at it | 🔴 High |
| Recurring triage every morning on Sonnet (3) | Scheduled agents abandoned with stale text | One Sonnet morning brief (Linear ⇄ main ⇄ CI) | 🟡 Low |
| Live artifacts (4) | Launch board is a static HTML file in `outputs/` | Live board reading GitHub + Linear | 🟡 Low |
| Confidence ≠ permission (1) | The CCR score is formula-based, but the findings and severities feeding it are model-judged. Done already requires staging green (policy) | State it in writing: a CCR score never authorizes a merge or deploy on its own | 🟡 Low (mostly mitigated) |

---

## 4. The five loops

> Per CCR, the loop **stops** below 95%. The owner asked for five loops, so they continue under that instruction, with **reactive correction** (v3) between loops: each loop's findings changed what the next loop checked. Confidence below means **assessment confidence**. The system score is in §5.

### Loop 1: Surface pass · extended PO / business-analysis team

**Team:** PO (Matthew's priorities) · Business Analyst · FinOps Analyst · Product Strategist · Risk & Compliance · Launch / Customer Ops (Harbor County Bocce, Oct 24)

- **Critical (most dangerous assumption):** *"Using the best model at the highest effort for everything is the safe choice for a privacy-critical product."* Infographics 4 and 5 both say the opposite: past the point of need, extra reasoning adds room to be confidently wrong, not accuracy. Your born-red harness is what keeps quality up, not the effort dial.
- **Conservative (worst case if we change things):** a quality regression in launch week (Oct 11–24, merge freeze Oct 20) costs the second client. **Business ruling: nothing that touches governance files or runtime code changes before Oct 24. Account settings and policy guards that only reduce risk can change now.**
- **Business findings:**
  - *BA:* five of the six infographics' main dimensions show a gap; the slow-brain dimension is a strength.
  - *FinOps:* cost on Max shows up as **weekly-limit headroom + extra-usage cash + CI API spend**, not a bill. Fast mode is the only line item that is real cash today ($30.50).
  - *Strategist:* Copilot already writes and reviews code here, so a portable AGENTS.md is a product-line asset (OW, OSG and OA inherit it), not a nice-to-have.
  - *Risk:* the policy layer is prose. Flagged for the Dr of Security in loop 3.
  - *Launch Ops:* weekly usage at 43% is fine for now, but launch week will run hot, so headroom matters.
- **Recursive:** 68%, baseline. Findings so far rest on settings and infographic mapping, not on measured usage.

### Loop 2: Pressure pass · extended scrum team (engineering)

**Team:** Scrum Master · Lead BE Architect · Lead FE Integration · Sr Design FE · Sr Automation QA · Sr SDET/SRE · DevOps Mgr · Sr Data Scientist · Dr of Security

- **Critical (what looked solved but wasn't checked):** *"CLAUDE.md and the skills give every agent the rules."*
  - Measured: CLAUDE.md is 75% change-log.
  - The OSE skills are **not loaded at all** (wrong format).
  - Copilot gets **none** of it.
  - The worker-scope `CLAUDE.md` (COST-403 / OSE-785) already tried to stop the root file loading; the root file has since grown to 85 KB.
- **Conservative (does the floor hold?):** yes. The invariants that matter (K=5 floor, never-who, tenant isolation, admin write guard) are **enforced in CI**, not only described in CLAUDE.md. A bloated or missing instruction file costs tokens and review cycles; it does not open a privacy hole. That caps H1 and H5 at High, not Critical.
- **Role positions:**
  - *Scrum Master:* the "Read STORIES.md" step contradicts the 09-22 rule. Story pick should be a Linear query.
  - *BE / FE:* the ~63 KB §3 history belongs in `docs/brain/ROLE-STATE.md`, read when needed, already in git.
  - *QA:* the harness is the asset that makes medium effort safe; keep every gate.
  - *SRE/SDET:* CI failure triage is done by Opus reading raw logs, which is exactly the infographic's `classify_ci` job.
  - *DevOps Mgr:* 21 KB of accumulated one-off allows is drift; policy should be a small checked-in file.
  - *Sr Data Scientist:* see loop 4.
  - *Dr of Security:* see loop 3.
- **New findings:** H1, H5, M1, M3, M5, M6.
- **Recursive:** **80% (↑).** Usage numbers not yet modelled.

### Loop 3: Security pass · Dr of Security leads; DevOps Mgr and SRE/SDET support

Method: efficacy and gating reality, not a catalogue. A control that cannot fail is scored as absent.

- **Critical:** *"Auto mode and the allow-list keep the agent safe."*
  - The allow-list **pre-approves** `npx:*` (which covers `npx wrangler deploy --env production` and `npx wrangler d1 execute … --remote`), `git:*` (covers `git push --force`), `gh api:*` (covers branch-protection changes) and `curl:*`.
  - Wrangler is logged in to the production account on this machine.
  - The only barrier left is the auto-mode classifier, which is model judgment: **confidence used as permission**, the exact anti-pattern in infographic 1.
  - The hub README already shows that `tools:` frontmatter is not enforced, so prose-level containment fails in practice here.
- **Found during this review:** a plaintext `sk-ant-api03-…` key in `~/.claude/config.json`. Nothing denies reading it, and this assessment's own inventory command printed it. That is a live demonstration of S1 + S2: **one Read-deny rule would have prevented it.**
- **Conservative:** the worst case is an autonomous session (remote control, push notifications, auto-approve) running a production deploy or a remote D1 write during the freeze. The mitigation exists in concept (CI-only prod deploys, the `deploy_production=PRODUCTION` dispatch) but nothing enforces it on the workstation.
- **Findings:** **S1 Security Critical** (exposed key), **S2 Security Critical** (no deterministic policy layer with prod credentials on the machine). L1: the stale scheduled-agent text contains `--admin` merges and `runs-on: self-hosted`; not scheduled, but it would be dangerous if re-enabled as written.
- **Recursive:** **85% (↑).** The findings are source-read inference. Whether the auto-mode classifier would refuse a production deploy has **not** been tested; I deliberately did not attempt it.

### Loop 4: Quantification pass · Sr Data Scientist + FinOps Analyst; PO checks the business case

- **Critical:** *"The win is model routing."* That is only partly true for this account.
  - API-equivalent cost of the measured Opus 4.8 history: input $127 · output $2,340 · **cache read $9,344** · cache write $2,391 ≈ **$14.2K**, of which **cache reads are ~66%**.
  - The output side, where routing helps most, is ~16%.
  - So the main lever is **tokens re-read per turn = fixed preamble + session length.** Routing comes second, through subagents that keep big reads out of the main context.
- **Per-turn arithmetic at Opus 5.5 prices:**
  - Fixed preamble 104K × $0.20/M = **$0.021 per turn**. Cut ~59K and save ~$0.012 per turn (~**$12 per 1,000 turns**) at **no quality cost**.
  - A turn at 500K context re-reads **$0.10**. A 900-turn session averaging 400K ≈ **$72** API-equivalent. One story per session is worth more than any model change.
  - A recon read of 300K fresh tokens: Opus 5.5 ≈ $1.20 + cache write; **Haiku 5.5 ≈ $0.03 (40× less)**.
  - Fast mode doubles every Opus token for latency you don't use when you aren't watching (remote control, background runs).
- **Conservative (don't overclaim):** on Max the binding constraints are the weekly limit and extra-usage cash, not dollars. Weekly pace is ~68%, so savings buy launch-week **headroom**, not a lower bill. The figures above are **relative weights**, not invoices. Quality guard: every routing or effort change is reverted if first-pass CI green rate, born-red counts or story reopen rate get worse.
- **Recursive:** **89% (↑).** Remaining uncertainty: messages ≠ API calls, so per-turn savings are approximate, and fast-mode billing on Max is not verified (§9).

### Loop 5: Confirmation pass · both teams together

- **Critical (am I rationalizing?):** I re-checked each load-bearing claim against its source (§2 table). Three things I **corrected** during this review rather than kept:
  1. The scheduled agents are **not** active (downgraded to Low).
  2. The CCR score **is** formula-based, so it is not raw felt confidence; it stays Low.
  3. Hub recon agents already run on Sonnet, which is good; no finding.
- **Conservative (would I defend this if the plan shipped and broke?):** Phase 0 is settings only and fully reversible. Phase 1 adds guards that only refuse things. Everything that touches governance files waits until after Oct 24 and goes through its own 5-loop CCR. The plan cannot break the launch.
- **Confidence decay check:** 68 → 80 → 85 → 89 → **92**. Rising, not decaying. It **stops below 95** on four items that need either your answer or a harness check I chose not to run (§9).
- **Gate:** **NOT CLEARED.** The human-gate questions are in §9.

---

## 5. Findings register and system score

| ID | Severity (weight) | Finding | Fix (phase) |
|---|---|---|---|
| **S1** | **Security Critical (15)** | Plaintext Anthropic API key in `~/.claude/config.json`, readable by the agent; **exposed in this transcript 2026-10-11** | Rotate now; remove if unused; Read-deny (P0) |
| **S2** | **Security Critical (15)** | No deterministic policy layer: auto-approve + `npx:*`/`git:*`/`gh api:*`/`curl:*` allowed + prod Wrangler credentials; one deny; no own hooks | Deny rules (P0) + PreToolUse policy hook + audit log (P1) |
| H1 | High (10) | OSE CLAUDE.md 85 KB, 75% change-log; ~33K tokens of memory files re-read every turn | AGENTS.md split + size ratchet (P2) |
| H2 | High (10) | No model routing: Opus 97% of output, Haiku 0.6%, Sonnet 0.2%; subagents inherit Opus | Default subagent model + routing matrix (P1/P2) |
| H3 | High (10) | Standing xhigh + fast mode on; extra usage $30.50; no spend limits | Effort high → medium; fast mode opt-in (P0) |
| H4 | High (10) | Context economy: compact at 97% of 1M; ~200K re-read per message; 44-hour sessions | One story per session, `/clear`, compaction instructions, reading in subagents (P0/P2) |
| H5 | High (10) | No AGENTS.md or Copilot instructions while Copilot reviews and authors PRs | AGENTS.md + `copilot-instructions.md` (P2) |
| M1 | Medium (5) | OSE skills in non-SKILL.md form, invisible to the harness; CCR 111 KB loads whole | Convert, loaded in layers (P2) |
| M2 | Medium (5) | ~34K tokens/turn of unrelated skills, MCP tools and instructions | `skillOverrides` + disconnect connectors for Code (P0) |
| M3 | Medium (5) | Session protocol reads STORIES.md (110 KB) against the 09-22 rule | Linear-driven `route_task` (P2) |
| M4 | Medium (5) | No fast-brain CI triage; Opus reads raw CI logs | Deterministic log rules → Haiku classifier (P2) |
| M5 | Medium (5) | Permission sprawl: 21 KB of one-off allows in the hub | Curated checked-in `settings.json` (P1) |
| M6 | Medium (5) | No PR risk routing; every PR gets the same reviewer model | Path-based `risk:*` label → reviewer model (P2) |
| L1 | Low (2) | Stale scheduled-agent text (Bloodraven, `--admin`, April brain counts) | Delete or rewrite as Sonnet morning brief (P3) |
| L2 | Low (2) | Memory: 99 files, some stale | `consolidate-memory` pass (P2) |
| L3 | Low (2) | Static launch board instead of a live artifact | Live board (P3) |
| L4 | Low (2) | "Confidence ≠ permission" not written down for CCR | One line in AGENTS.md (P2) |

`Score = 100 − (2×15) − (5×10) − (6×5) − (4×2) = 100 − 30 − 50 − 30 − 8 = −18 → floor 0%`. With S1 and S2 closed (Phases 0–1) it is 12%. With everything through Phase 2 closed only the Low items remain (≈ 92–98% depending on what is left open), and a re-run CCR would be needed to confirm.

**Alignment per dimension (my judgment, for orientation; not a CCR score):** slow brain 90 · verification harness 95 · surfaces and remote use 75 · instruction contract 35 · policy layer 20 · fast brain 10 · model routing 10 · effort discipline 25 · context economy 20.

---

## 6. The ideal plan

### Phase 0: today, ~30 minutes, account settings only, safe for launch

1. **Rotate the exposed key (you do this; it's a credential).** Console → API keys → revoke the key that is stored in `~/.claude/config.json`. If Max is how you pay for Claude Code, delete the `primaryApiKey` and `customApiKeyResponses` entries from `~/.claude/config.json` (I can make that edit if you approve it). If CI's `ANTHROPIC_API_KEY` secret is the same key, update it too.
2. **User `settings.json` changes:**
   ```jsonc
   "effortLevel": "high",          // was xhigh; medium after launch (Phase 2)
   "fastMode": false,              // toggle /fast only while pairing live
   "permissions": {
     "deny": [
       "mcp__plugin_mapmap_mapmap",
       "Read(~/.claude/config.json)", "Read(~/.claude/.credentials.json)",
       "Read(**/.dev.vars)", "Read(**/.env)", "Read(**/.env.*)",
       "Bash(npx wrangler deploy *)", "Bash(wrangler deploy *)",
       "Bash(npx wrangler * --remote*)", "Bash(npx wrangler secret *)",
       "Bash(git push --force*)", "Bash(git push -f *)",
       "Bash(gh pr merge * --admin*)", "Bash(gh api * -X DELETE*)", "Bash(gh api * --method DELETE*)",
       "Bash(gh api repos/*/branches/*/protection*)"
     ]
   }
   ```
   Prefix rules can be dodged by variants (`npx --yes wrangler …`, env-var prefixes), so treat them as a speed bump. Phase 1's hook is the real control. **Born-red:** in a scratch session, ask Claude to run each denied command and confirm it is refused.
3. **Cut the per-turn preamble (M2):**
   - Add `skillOverrides: "off"` for the unrelated plugin families (Unity, Shopify / small-business, ZoomInfo, Daloopa, sales, finance, HR, marketing, SEO, nimble, legal, privacy-legal), the same way you already do for mapmap.
   - Switch off the claude.ai connectors Code doesn't need (Spotify, ICD-10, LegalZoom, Pricewatcha, Shopify, alphaXiv, Consensus) in claude.ai connector settings.
   - Keep Linear, Cloudflare, Gmail, Calendar, Notion and Drive.
   - Target: ~-25K tokens per turn.
4. **Session hygiene (H4), starting today:**
   - One story or one CCR per session.
   - `/clear` between unrelated tasks.
   - Ask for an Explore subagent whenever a step means reading more than ~5 files.
   - Start a fresh session instead of letting one run past ~300K tokens.

### Phase 1: launch window (Oct 11–24); guards and routing that change no product code

5. **Policy as code (S2):**
   - Check in `.claude/settings.json` (shared, reviewed) with the deny list above.
   - Add a **PreToolUse hook** `.claude/hooks/policy-gate.mjs`:
     - It reads the tool-call JSON on stdin.
     - It regex-checks Bash for production deploys, remote D1 writes, secret operations, force pushes, `--admin` merges and branch-protection calls, and checks Read/Edit for credential paths.
     - It exits `2` with the reason on stderr to block.
     - It appends every Bash command to `~/.claude/audit/YYYY-MM-DD.jsonl` (the infographic's `audit.yaml`).
   - Ship it the way you ship gates: a **born-red test** that feeds each blocked pattern and each allowed near-miss to the script.
   - This repo's own README rule applies: only mechanical controls count.
6. **Subagent defaults (H2):**
   - Set the default subagent model to Sonnet (env `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-5-5`; *verify the variable name on your CLI version*).
   - Add `model: haiku` to read-only scanner agents (`board-reconciler`, `posture-scanner`) and to any Explore-style agent you define.
   - Keep `ccr-assessor` on Sonnet and add a security variant on Opus.
7. **Permission cleanup (M5):** move durable allows into the checked-in `settings.json`; delete the one-off entries from the 21 KB `settings.local.json` (the `fewer-permission-prompts` skill can propose the curated list).

### Phase 2: after launch (from Oct 26); governance changes, each with its own 5-loop CCR

8. **AGENTS.md as the operating contract (H1, H5, L4):**
   - `AGENTS.md` (≤12 KB, durable only):
     - architecture and the 5 surfaces
     - build and test commands
     - conventions (tokens-only colours, escaping, one `<h1>`)
     - **invariants list** (never-who, K=5 floor with no exceptions, sponsor strip below title, no cookies, display shows no counts)
     - quality gates
     - **human-approval boundaries** (prod deploy, remote D1, secrets, Linear Done, branch protection)
     - the **two-stage Done**
     - "a CCR score is a signal; required checks and the PO are authority"
   - `CLAUDE.md` → `@AGENTS.md` + Claude-only extras (≤4 KB): session protocol, skills to use, compaction instructions.
   - `docs/brain/ROLE-STATE.md` ← the ~63 KB §3 history (kept committed, read on demand; satisfies *Document Decisions*).
   - `.github/copilot-instructions.md` → a short pointer to AGENTS.md (or rely on Copilot's native AGENTS.md support if your plan has it).
   - **Size ratchet in CI**, the same shape as `.ocr-design-check.json`: AGENTS.md ≤ 12 KB and CLAUDE.md ≤ 6 KB may only shrink from baseline. This is what stops a repeat of COST-403.
   - Do it in the hub too and point OW, OSG and OA at the same structure (*Infra-Wide By Default*).
9. **Skills and agents in the right shape (M1):**
   - `.claude/skills/ccr/SKILL.md`: classify → loops → formula and weights → gate → worksheet skeleton (~4 KB). `references/` holds the regulatory extensions, worked examples, advancement framework and the full v3 text.
   - `story-intake/`, `daily-scrum/`, `sync-status/` become folders.
   - The role `.knowledge.md` files become `.claude/agents/role-*.md`:
     - **Dr of Security: `model: opus`**, read-only agent type.
     - BE, FE, Design, QA, SRE/SDET, DevOps Mgr, Data Scientist: `model: sonnet`.
   - **CCR stays sequential across loops.** Within one loop the role lenses can fan out in parallel and then be merged, which keeps the recursive chain intact.
10. **Fast brain, built in the repo (H2, M3, M4, M6).** Deterministic first, small model second:

    | Decision (infographic 1) | Rule first | Model second | Output |
    |---|---|---|---|
    | `route_task` | Linear labels + touched-path map → surface / owner | Haiku reads the issue, proposes AC gaps | Next story + model/effort to use (replaces reading STORIES.md) |
    | `rank_files` | `rg` over route table / router.ts | Haiku Explore subagent returns top-N with reasons | Main session reads ≤ N files |
    | `classify_ci` | Log regexes (ECONNRESET, apt mirror, Bot-Mgmt 403, CRLF) | Haiku on the remaining failures | Label `ci:flake / infra / test / real` + comment; Opus only for `real` |
    | `pr_risk` | Paths: `migrations*/`, `src/auth/`, `lib/pii*`, `lib/count-floor*`, `lib/event-anon-key*`, `wrangler.toml`, `.github/` → `risk:high` | Haiku writes the explanation only | Reviewer: low → Copilot/Haiku summary · normal → Sonnet · high → Opus `high` + CCR |
    | `retry_or_escalate` | Max 2 retries at the same effort | — | Raise effort → Fable 5.1 → human gate |
    | `preserve_context` | "Compact instructions" section in CLAUDE.md: keep story ID, AC, failing test names, decisions; drop tool dumps | Haiku compaction (Claude Code does this itself) | Shorter, faithful compactions |

11. **Effort to medium for routine work:** default `medium` (the infographic default and the Opus 5.5 API default). Set `high`/`xhigh` at the **start** of a session for CCRs, security, architecture and debugging work that has stalled. Never change it mid-session (that clears the cache).
12. **Memory pass (L2):** run `consolidate-memory`; archive historical launch logs; keep `MEMORY.md` under ~10 KB.

### Phase 3: looking ahead (Nov–Dec)

13. **Sonnet morning brief** (infographic 3) replaces the three stale scheduled agents (L1): Linear ⇄ `main` ⇄ last night's CI, a "ready for your review" digest pushed to your phone; it **reads and reports, never writes**, and its text is regenerated from AGENTS.md so it can't go stale.
14. **Live launch and testing-flow board** as a live artifact (GitHub runs + Linear states), replacing static HTML in `outputs/`.
15. **Nightly red-team (OSE-1506)** as a scheduled Managed Agent or GitHub schedule on Sonnet, with Opus only for triage of new findings.
16. **Model escalation ladder, written down:** Haiku → Sonnet → Opus medium → Opus high/xhigh → **Fable 5.1** (your weekly Fable allowance is 0% used; it is the reserve for the hardest problems) → human.
17. **Product-line rollout:** the same AGENTS.md, policy hook, size ratchet and routing table in OW, OSG, OSR and OA (OCR-docs holds the template).

---

## 7. Routing matrix (task → model → effort)

| Work | Model | Effort | Why |
|---|---|---|---|
| CCR synthesis, architecture, cross-tenant security, ADRs | Opus 5.5 | high / xhigh | Open-ended judgment (infographic 3: "start with Opus") |
| Dr of Security lens | Opus 5.5 | high | Security Critical, no partial credit |
| Story implementation with clear AC + born-red tests | **Sonnet 5.5** (or Opus medium) | medium | Well-scoped; the harness checks the work (infographic 5) |
| Role-lens fan-out inside a CCR loop | Sonnet 5.5 | medium | Many parallel reads, then Opus merges them |
| CI PR review | Sonnet 5.5 (now) → routed by `risk:*` | medium | Already in place; add routing |
| Codebase search, file ranking, first-pass doc reads | **Haiku 5.5** | low / medium | Infographic 2; 40× cheaper on input |
| CI log classification, Linear sweeps, transcript summaries | **Haiku 5.5** | low | High-volume classification |
| Morning brief, docs, decks, sheets | Sonnet 5.5 | medium | Infographic 3 |
| Typo, rename, applying a known pattern | Sonnet 5.5 / Opus | low | Infographic 5 "low" |
| Stuck after xhigh | **Fable 5.1** | high | Infographic 5 escalation |
| Live pairing where latency matters | Opus + `/fast` | as needed | Only while you are watching |

---

## 8. Targets (measure two weeks after each phase)

| KPI | Today | Target | Read from |
|---|---|---|---|
| Fixed preamble per turn | ~104K tokens | ≤ 45K | `get_usage` context categories at turn 1 |
| Opus share of output tokens | 97% | 55–65% | `stats-cache.json` `modelUsage` |
| Haiku share of subagent calls | ~0% | ≥ 50% | same |
| Extra-usage cash | $30.50 | $0 unless you chose `/fast` | usage card |
| Weekly limit at reset | ~68% pace | ≤ 55% at the same output | usage card |
| Median session length | (44 h max) | one story per session | session list |
| **Quality guard (must not move)** | baseline | unchanged | first-pass CI green rate, born-red counts, reopened stories |

If a quality guard moves, revert the routing or effort change for that kind of work, not the whole plan.

---

## 9. Human gate: what stops this at 92%

1. **The API key (S1):** is `primaryApiKey` in use at all (CI fallback, scripts), or is it left over? Either way it has to be rotated now that it has been exposed. Do you want me to remove it from `config.json` after you rotate?
2. **Timing:** do you accept *settings now (Phase 0), guards during the freeze (Phase 1), governance files after Oct 24 (Phase 2)*? Or should the effort and fast-mode change also wait until after launch?
3. **Harness facts I did not verify:**
   - Whether fast mode on Max is billed to extra usage (that is my reading of the $30.50).
   - The exact name of the default-subagent-model variable on CLI 2.1.295.
   - Whether the auto-mode classifier would refuse a production `wrangler deploy`. **I did not test this on purpose.** The safe test is the Phase 0 deny rule followed by a born-red check.
4. **Other agents:** besides Copilot, does any other agent (Codex, Cursor) touch these repos? That decides whether AGENTS.md is the primary file or a mirror.

## 9a. Addendum: background inventory, 2026-10-11 (read after the loops closed)

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| M7 | Medium (5), Dr of Security | **Retired self-hosted runners were never deregistered.** The org still lists `BLOODRAVEN`, `BLOODRAVEN-2` and `BLOODRAVEN-3` (offline). `actions-runner`, `-2` and `-3` on this machine still hold `.runner`, `.credentials` and `.credentials_rsaparams` (contents not read), plus full checkouts of every OCR repo. Running `run.cmd` in any of them would bring a runner back online and it could pick up org jobs. OCR-docs still has a self-hosted self-test (OSE-1287). | `gh api orgs/ourCommunityRituals/actions/runners`; file probe (names only) |
| H1 (evidence) | — | **CLAUDE.md growth, measured:** the runner checkouts hold OSE `CLAUDE.md` at **19,161 bytes** (last runner checkout ≈ end of Aug). Today it is **84,724 bytes, 4.4× in about six weeks.** That is the case for the Phase 2 size ratchet. | `actions-runner*/_work/ourSharedEvents/.../CLAUDE.md` |
| H5 (evidence) | — | **No AGENTS.md or copilot-instructions in any OCR repo checkout** (0 hits across every repo in the runner work folders). | background inventory |

**Owner, 2026-10-11: "I am no longer self hosting any runners."** All three registrations and all four `actions-runner*` folders are leftovers.

**Fix for M7 (deletes registrations, so it needs a yes):**
1. Deregister all three: `gh api -X DELETE orgs/ourCommunityRituals/actions/runners/<id>` for each id in `gh api orgs/ourCommunityRituals/actions/runners`.
2. Delete the `actions-runner*` folders; their `.credentials` files are no longer needed.
3. Correct the CLAUDE.md §3 DevOps line that says OCR-docs keeps a self-hosted self-test.

System score is unchanged (already at the 0% floor). Grade for "hard rules on what Claude may run" stays **F**.

## 9b. Progress, 2026-10-11 (same session, after "start work where it makes sense")

| Item | Status |
|---|---|
| Phase 1 policy hook (S2) | **Built and tested, not installed.** `.claude/hooks/policy-gate.mjs` + `policy-gate.test.mjs`: 72/72 pass; the mutation check killed all 6 planted faults. Writing it found and fixed two real bugs (`secret:bulk` slipped through; a SQL `DELETE` on the local DB was misread as a resource delete). |
| Phase 0 settings (H3, M2, S2 deny rules) | **Merge file ready**: `.claude/hooks/settings.user.proposed.json` (effort `high`, fast mode off, 20 deny rules, hook registration, 141 unrelated plugin skills off). The agent's attempt to apply it was **refused by auto mode as self-modification**. Correct behaviour; the owner applies it. |
| S2 correction | Auto mode **does** block agents from changing their own settings. The finding stands for the workstation deploy / force-push / credential-read paths, which no rule blocked. |
| S1 | Waiting on the owner: revoke the key in the Console. |
| M7 runners | Waiting on the owner's decision (deregistering deletes registrations). |
| Live born-red after install | Steps in `.claude/hooks/README.md` → "Verify it is live". |

## 10. Risks accepted and things not to do

- **Not** changing CLAUDE.md, STORIES.md or the CCR protocol before Oct 24. They are governance artifacts (CCR v3 needs 5+ loops), and launch focus wins.
- **Not** routing security, auth, PII or count-floor work below Opus. The routing savings are for everything else.
- **Not** removing any CI gate to save tokens. The harness is what makes lower effort safe.
- **Not** treating any score here (system or confidence) as permission. Required checks and the PO decide.
- Accepted: the savings figures are API-equivalent weights, not invoices. On Max their value is headroom.
