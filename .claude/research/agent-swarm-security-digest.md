# Agent & Swarm Security — Longitudinal Research Digest

> **Purpose:** a dated, append-only series maintained by the **Dr of Security** ([[project_ccr_advanced_scrum_roles]]). Each scan appends one entry. The value is **corroboration over time** — a threat/paper/framework that recurs across scans is durable signal; one that appears once and disappears was noise/hype. Do NOT rewrite prior entries — append, then update the Corroboration Tracker.
>
> **How a scan works (the Dr of Security "currency step"):** run live web searches for agent/multi-agent/swarm LLM security (attacks + defenses + frameworks), verify citations against real sources (no recalled/hallucinated IDs), append a new dated entry below, then update the tracker: mark each item **NEW / CORROBORATED (seen in ≥2 scans) / FADED (not seen this scan)**.

---

## Corroboration Tracker (update every scan)

| Item                                                              | First seen | Last seen  | Status        | Notes                                                                                          |
| ----------------------------------------------------------------- | ---------- | ---------- | ------------- | ---------------------------------------------------------------------------------------------- |
| Prompt Infection (LLM→LLM injection, self-replicating across MAS) | 2026-09-11 | 2026-10-13 | CORROBORATED  | ESORICS 2025; extended by arXiv 2609.22949 & 2608.00718 (ICML 2026)                           |
| OWASP Top 10 for Agentic Apps (ASI01–ASI10)                       | 2026-09-11 | 2026-10-13 | CORROBORATED  | Widely cited 2026; ASI01 = Goal Hijack ≈ indirect prompt injection; companion LLM 2026 list   |
| MITRE ATLAS (agentic tactics)                                     | 2026-09-11 | 2026-10-13 | CORROBORATED  | v5.3.0 (Jan): MCP case studies; v5.4.0 (Feb): "Publish Poisoned AI Agent Tool"; monthly cadence |
| CaMeL — defeating prompt injection by design                      | 2026-09-11 | 2026-10-13 | CORROBORATED  | Published IEEE SaTML 2026; 77% task rate secured vs 84% unsecured; 2.8× tokens                |
| MCP tool poisoning (descriptions/results)                         | 2026-09-11 | 2026-10-13 | CORROBORATED  | MCPTox AAAI 2026: o1-mini 72.8% ASR on 45 real servers; STDIO systemic flaw adds RCE path     |
| Lethal trifecta (private data + untrusted input + exfil)          | 2026-09-11 | 2026-10-13 | CORROBORATED  | NSA/CISA May 2026 "privilege" risk category; zero-trust agent identity calls for ephemeral creds |
| Infection monitoring (INFA-Guard, VIGIL verify-before-commit)     | 2026-09-11 | 2026-10-08 | CORROBORATED  | INFA-Guard −33% ASR; VIGIL 2601.05755; not prominent Oct 13 — basis remains Oct 8 scan        |
| NSA/CISA Five Eyes "Careful Adoption of Agentic AI"               | 2026-10-08 | 2026-10-13 | CORROBORATED  | May 1 2026; 30 pp; 100+ controls; prompt injection "most persistent and difficult-to-fix"     |
| OWASP MCP Top 10                                                  | 2026-10-08 | 2026-10-13 | CORROBORATED  | MCP03 = Tool Poisoning (indirect injection variant); MCP06 = Intent Flow Subversion            |
| Cross-Agent Campaign Attribution (arXiv 2607.18826)               | 2026-10-08 | 2026-10-13 | CORROBORATED  | ICML 2026; A2FV async fingerprinting across pipeline hops; AUC 0.82                           |
| Beyond Single-Model Injection (arXiv 2609.22949)                  | 2026-10-08 | 2026-10-13 | CORROBORATED  | ICML 2026; 14 vectors; 67% agents vulnerable w/ guardrails; 31%→4%                            |
| SEAgent — MAC for LLM privilege escalation (arXiv 2601.11893)     | 2026-10-08 | 2026-10-08 | CORROBORATED  | Confused deputy in MAS; 0% ASR vs 39.14% baseline; not prominent Oct 13                       |
| MCP CVE surge                                                     | 2026-10-08 | 2026-10-13 | CORROBORATED  | Expanding: CVE-2026-35394 (Mobile MCP RCE); CVE-2026-33032 nginx-ui CVSS 9.8; 7+ critical in major platforms |
| OWASP Top 10 for LLM Applications 2026                            | 2026-10-08 | 2026-10-13 | CORROBORATED  | Aug 2026; distinct from ASI agentic list; widely cross-cited in enterprise guidance            |
| MCPTox benchmark (arXiv 2508.14925)                               | 2026-10-13 | 2026-10-13 | NEW           | AAAI 2026; 45 real MCP servers, 353 tools, 20 LLMs; o1-mini 72.8% ASR; MindGuard defense eval |
| AEGIS: Cross-Domain Resource Abuse in MCP (arXiv 2608.20481)      | 2026-10-13 | 2026-10-13 | NEW           | DSN 2026 (IBM Research); OPA policy enforcement; 937 tool defs from 56 servers                |
| Image-Based Prompt Injection / VPI-Bench (arXiv 2603.03637 + 2506.02456) | 2026-10-13 | 2026-10-13 | NEW    | Typographic injection 64% ASR (black-box); VPI-Bench for computer-use agents; physical-world surface |
| NIST Cyber AI Profile (draft IR 8596) / CAISI                     | 2026-10-13 | 2026-10-13 | NEW           | Feb 2026; extends CSF 2.0; agent least-privilege + continuous auth as baseline; not finalized  |
| MCP STDIO systemic design flaw (OX Security / CSA May 2026)       | 2026-10-13 | 2026-10-13 | NEW           | Architectural RCE in STDIO transport; ~200k vulnerable instances; 10 vulns across major MCP platforms |
| Unicode TAG-Block concealment in MCP (arXiv 2607.05744)           | 2026-10-13 | 2026-10-13 | NEW           | Approval-view fidelity gap: human sees sanitized view, model receives payload; 3 server impls  |

---

## Scan 2026-09-11 (baseline)

**Verified sources (live scan, Sept 2026):**

- Prompt Infection: LLM-to-LLM Prompt Injection within Multi-Agent Systems — arXiv 2410.07283 (ESORICS 2025)
- INFA-Guard: Infection-Aware Safeguarding — arXiv 2601.14667
- Multi-Agent Systems Execute Arbitrary Malicious Code — arXiv 2503.12188
- Security Considerations for Multi-agent Systems — arXiv 2603.09002
- SoK: The Attack Surface of Agentic AI — arXiv 2603.22928
- Toward Secure LLM Agents: Threat Surfaces, Attacks, Defenses, Evaluation — arXiv 2606.10749
- OWASP Agentic AI Threats & Mitigations (Feb 2025) + OWASP Top 10 for Agentic Applications (Dec 2025, ASI01–ASI10) — secops.group overview
- MITRE ATLAS v5.1.0 (Nov 2025) — vectra.ai/topics/mitre-atlas
- NIST CSF 2.0 for agentic AI — eleco.org.tr ELECO2025 paper 196
- CaMeL — Defeating Prompt Injections by Design — arXiv 2503.18813
- VIGIL (verify-before-commit on tool streams) — arXiv 2601.05755
- MCP: MCP-ITP 2601.07395, MCP Pitfall Lab 2604.21477, MCP threat modeling 2603.22489, TRUSTDESC 2604.07536

**Foundational (from training, verify on use):** Greshake et al. indirect prompt injection (2023); Zou et al. GCG universal adversarial (2023); Anthropic many-shot jailbreaking & sleeper agents (2024); AgentDojo benchmark; personhood credentials (2024).

**Threat map applied to OUR swarm (Workflow/subagents + MCP):**

1. Lethal trifecta present in single agents (repo/web/Gmail read + git-push/Gmail-send/CF/Firebase write).
2. Prompt Infection propagates via `pipeline`/`parallel` agent→agent result passing.
3. MCP tool poisoning via Cloudflare/Firebase/Gmail/Airtable/Linear servers.
4. Sandbox/code-exec escape on the `Bash`/sandbox/npm path (S2 integrity check is our defense here).
5. Self-organizing risks: cascading failure (ASI08), rogue agent (ASI10), insecure inter-agent comms (ASI07), human-agent trust exploitation (ASI09).
6. Agent identity: MFA-analog = scoped short-lived creds + capability restriction + confused-deputy prevention (ASI03).

**Already defending us:** CCR adversarial-verify (anti-propagation), worktree isolation, Invariant #22 module isolation, human-in-the-loop gates, S2 post-execution integrity.

**Open gaps in our swarm:** no explicit trifecta break (reader vs actor agents); broad per-subagent tool inheritance (not least-privilege); cross-agent messages treated as trusted instructions (no spotlighting/provenance); no infection monitoring on the pipeline.

---

## Scan 2026-10-08

**Verified sources (live search, October 2026; fetch note: all external domains blocked by proxy — citations verified by live web search snippets only, not full-text fetches):**

**Corroborated — baseline items confirmed active:**

- Prompt Infection (arXiv 2410.07283, ESORICS 2025) — still the primary MAS injection reference; extended by arXiv 2609.22949 and arXiv 2608.00718 at ICML 2026
- OWASP Top 10 for Agentic Applications ASI01–ASI10 (Dec 2025) — widely cited; companion OWASP Top 10 for LLM Applications 2026 released Aug 2026 (separate document; genai.owasp.org)
- MITRE ATLAS v2026.09 (Sept 15, 2026) — 16 tactics, 120 techniques (+36 from v5.1.0), 88 sub-techniques, 40 mitigations, 73 case studies; 139 of 208 technique entries tagged "Agentic AI" (since May 2026 platform tags); Zenity contributed agentic-browser/orchestration techniques to first 2026 update — zenity.io blog, vectra.ai/topics/mitre-atlas
- CaMeL (arXiv 2503.18813) — in MIT 6.858 Spring 2026 readings; 2026 analysis: Gemini 2.5 Pro 300→0 attacks, ~2.8× token overhead; no confirmed "CaMeLoT" follow-up paper found
- MCP tool poisoning — OWASP MCP Top 10 launched as official project (owasp.org/projects/mcp-top-10); Palo Alto Unit 42: 78.3% ASR with 5 MCP servers; 40+ CVEs in 2026 (UltraViolet Cyber advisory, May 27 2026)
- Lethal trifecta — NSA/CISA Five Eyes independently names same read+untrusted-input+exfil structure as "privilege" risk category
- INFA-Guard (arXiv 2601.14667) — confirmed active, −33% ASR, ~7–9% token overhead vs substantially higher for Inspector/AgentXposed
- VIGIL tool-stream (arXiv 2601.05755) — confirmed; ablation: verifier+sanitizer components each reduce attack success; 74.49% BU on Qwen3max vs 79.59% baseline

**New sources:**

- **NSA/CISA/ASD/ACSC/NCSC/CCCS "Careful Adoption of Agentic AI Services"** (May 1, 2026) — 30-page Five Eyes joint guidance; 100+ controls; 5 risk categories: privilege, design/configuration, behavioral, structural, accountability; prompt injection named "most persistent and difficult-to-fix" (a design constraint, not sanitizable away); cautious phased rollout + zero-trust extension recommended — crowell.com client alert, jdsupra.com, CSA research note at labs.cloudsecurityalliance.org
- **OWASP MCP Top 10** (2026) — official OWASP project page owasp.org/projects/mcp-top-10; covers tool poisoning, token mismanagement, shadow MCP servers, context oversharing, SSRF, supply-chain attacks via community-published servers; indirect prompt injection cited as #1 threat
- **MCP CVE surge** — CVE-2025-6514 (mcp-remote, CVSS 9.6, 437k+ downloads pre-disclosure); CVE-2026-5058 (aws-mcp-server, CVSS 9.8, RCE via crafted input, no auth required) — heyuan110.com "30 CVEs in 60 days" post; uvcyber.com ThreatAdvisory May 27 2026
- **Cross-Agent Campaign Attribution** (arXiv 2607.18826, ICML 2026 — icml.cc/virtual/2026/67973) — A2FV (Asynchronous Attribution Fingerprint Vectors): proxy-side structural/temporal/stylometric fingerprints link attacks spread across agent sessions with no shared runtime; AUC 0.82 on SCD-v1 benchmark; per-session detectors stay near chance; addresses the gap that existing defenses are tested within one session only
- **"Beyond Single-Model Injection"** (arXiv 2609.22949, ICML 2026 AIWILD — icml.cc/virtual/2026/67971) — 14 attack vectors in 4 categories: direct (3), indirect via tool output (4), inter-agent message (4), cascading via orchestrator (3); 67% agents vulnerable even with system-prompt guardrails; indirect tool-output injection: 43% success; layered defenses (signing + sanitization + privilege-scoped access + anomaly detection) reduce 31.2%→4.2%; signing+sanitization cuts inter-agent/indirect by 91%/78%
- **SEAgent — MAC for LLM privilege escalation** (arXiv 2601.11893, Jan 2026) — mandatory access control via information flow graph; explicitly models confused deputy as a novel MAS variant; 0% ASR vs 39.14% baseline on AgentDojo; case-study methodology (no large-scale benchmark yet)
- **Adversarial Attacks in Multi-Agent LLM Pipelines** (arXiv 2608.00718) — structural vulnerability survey; ICML 2026 context; amplification through inter-agent passing, shared tools, and trust propagation to orchestrators
- **Agent Data Injection Attacks** (arXiv 2607.05120) — realistic injection threat via data sources agents consume
- **CASPIAN** (arXiv 2605.19240) — online detection and attribution of cascade attacks in MAS via cross-channel causal monitoring

**Threat map update for OUR swarm (Workflow/subagents + MCP):**

1. **Cross-agent campaign gap (new, high):** A2FV (2607.18826) shows attackers chain attacks across pipeline hops with no shared runtime — our `pipeline`/`parallel` topology is exactly this attack surface. An injection in one agent's tool output reaches the next agent, with no proxy-side attribution link between hops and no campaign-detection layer.
2. **Confused deputy sharpened (existing gap, now quantified):** SEAgent (2601.11893) proves the confused deputy in MAS at 39.14% ASR with unscoped tools — matching our "broad per-subagent tool inheritance" open gap. Closing it requires explicit information flow graph enforcement; we have none.
3. **MCP CVE escalation (materially higher risk):** 40+ CVEs in 2026 including CVSS 9.8 RCE (CVE-2026-5058) raises the threat level on our Cloudflare/Firebase/Gmail/Linear MCP servers beyond the original "tool poisoning" framing — server-level compromise is now a realistic path, not just description/result manipulation.
4. **Gov validation of gaps:** NSA/CISA Five Eyes guidance validates our existing defenses (CCR adversarial-verify ≈ "behavioral" controls; worktree isolation ≈ "structural") but explicitly calls out prompt injection as unsanitizable and recommends least-privilege tool scoping — our two most significant open gaps.

**Already defending us (unchanged):** CCR adversarial-verify, worktree isolation, Invariant #22 module isolation, human-in-the-loop gates, S2 post-execution integrity.

**Open gaps (updated):**
- (unchanged from 2026-09-11) No explicit trifecta break (reader vs actor agents); broad per-subagent tool inheritance (not least-privilege); cross-agent messages treated as trusted instructions (no spotlighting/provenance); no infection monitoring on pipeline
- (new 2026-10-08) No campaign-attribution layer — asynchronous multi-hop attacks (A2FV threat model) are undetectable in current architecture
- (new 2026-10-08) No MAC/information-flow enforcement — SEAgent pattern not implemented; confused deputy is exploitable at documented 39% baseline rate

---

## Scan 2026-10-13

**Verified sources (live search, October 2026; fetch note: all external domains blocked by proxy — citations verified by live web search snippets only, not full-text fetches):**

**Corroborated — prior items confirmed active:**

- Prompt Infection (arXiv 2410.07283, ESORICS 2025) — still primary MAS injection reference; cited in agentic security surveys and practitioner write-ups as the canonical self-replicating MAS attack
- OWASP Top 10 for Agentic Applications ASI01–ASI10 — widely cited; ASI01 (Agent Goal Hijack) now used as synonym for tool poisoning / indirect prompt injection in practitioner literature
- MITRE ATLAS — intermediate 2026 updates confirmed: v5.3.0 (Jan 2026) added MCP server compromise case studies; v5.4.0 (Feb 2026) added technique "Publish Poisoned AI Agent Tool" (AML.T0098); monthly cadence confirmed; v2026.09 counts (120 techniques, 139 Agentic AI-tagged entries) re-verified — zenity.io blog, vectra.ai/topics/mitre-atlas
- CaMeL (arXiv 2503.18813) — **peer-reviewed publication confirmed: IEEE SaTML 2026**; 77% task-completion with security guarantees vs 84% for undefended baseline; adaptive-attack follow-on paper (arXiv 2606.18530 "Evaluating Prompting-Based Defenses Against Domain-Camouflaged Injection") cites CaMeL as prior work — computer.org/csdl/proceedings-article/satml/2026
- MCP tool poisoning — MCPTox (AAAI 2026) is now the benchmark of record on real servers; OWASP MCP03 = Tool Poisoning confirmed as indirect injection variant; signed tool manifests + automated metadata scanning emerging as mitigations; STDIO systemic design flaw adds architectural RCE vector — cycode.com, labs.cloudsecurityalliance.org
- NSA/CISA Five Eyes guidance — widely cited as primary government standard; CISA.gov page confirmed at cisa.gov/news-events/news/; prompt injection "most persistent and difficult-to-fix" framing corroborated across law firm alerts, CSA notes, enterprise compliance guides — crowell.com, mayerbrown.com, labs.cloudsecurityalliance.org
- OWASP MCP Top 10 — MCP03 (Tool Poisoning) confirmed indirect injection; MCP06 (Intent Flow Subversion) documented; OWASP GitHub repo at github.com/OWASP/www-project-mcp-top-10 confirmed — cycode.com, practical-devsecops.com
- Cross-Agent Campaign Attribution (arXiv 2607.18826) — A2FV still only cross-hop attribution approach; appeared in MAS security search results alongside 2026 agentic security surveys
- Beyond Single-Model Injection (arXiv 2609.22949) — 14-vector taxonomy still cited; appeared in search results; "cascading via orchestrator" category maps directly to our `pipeline`/`parallel` topology
- MCP CVE surge — expanding: CVE-2026-35394 (Mobile MCP RCE, url passed unsanitized before 0.0.50); CVE-2026-33032 (nginx-ui, CVSS 9.8, no-auth command exec via MCP endpoint); CVE-2026-13341 (Kong Konnect, indirect prompt injection via MCP → unintended API requests); OX Security April 2026: 7+ critical CVEs across MCP Inspector, LiteLLM, Cursor IDE, LibreChat, Windsurf — sentinelone.com, thehackernews.com, labs.cloudsecurityalliance.org

**Items not prominently seen this scan (Last seen date not advanced):**
- Infection monitoring (INFA-Guard arXiv 2601.14667, VIGIL arXiv 2601.05755) — not directly cited in Oct 13 results; CORROBORATED status unchanged; basis remains Oct 8 scan
- SEAgent (arXiv 2601.11893) — not directly cited in Oct 13 results; CORROBORATED status unchanged

**New sources:**

- **MCPTox: A Benchmark for Tool Poisoning on Real-World MCP Servers** (arXiv 2508.14925, AAAI 2026 Proceedings) — 45 live real-world MCP servers, 353 authentic tools, 20 LLM agent settings evaluated; o1-mini highest ASR at 72.8%; MindGuard (arXiv 2508.20412) defense evaluated against MCPTox; "Labels Are Not Endpoints" (arXiv 2608.12880) names MCPTox as closest attack comparator — arxiv.org/abs/2508.14925, emergentmind.com/topics/mcptox
- **AEGIS: Preventing Cross-Domain Resource Abuse in MCP** (arXiv 2608.20481, DSN 2026 Supplemental, IBM Research) — addresses resource-exhaustion via MCP tool parameters (oversized queries, large search radii) distinct from injection; LLM normalizes tool invocations to unified representation; OPA enforces policies; evaluated on 937 tool definitions from 56 MCP servers — arxiv.org/abs/2608.20481, research.ibm.com
- **Image-Based Prompt Injection / VPI-Bench** (arXiv 2603.03637, arXiv 2506.02456) — typographic injection: up to 64% ASR (black-box, stealth constraints) against GPT-4V, Claude 3, Gemini, LLaVA; VPI-Bench is first benchmark specifically targeting computer-use agents; single malicious image can propagate adversarial instructions through a multi-agent workflow; physical-world attack surface (signs, product packaging, whiteboards captured by multimodal agents) — labs.cloudsecurityalliance.org (March 2026), tianpan.co
- **NIST Cyber AI Profile (draft IR 8596) / CAISI** (February 2026) — NIST AI Agent Standards Initiative (CAISI) launched Feb 17 2026; NCCoE concept paper on agent identity and authorization released Feb 2026; draft extends CSF 2.0 to AI risk; frames agent least-privilege and continuous authentication as baseline security requirements (not optional design choices); public comment period closed Jan 30 2026; initial public draft expected later 2026; identified gap: no autonomy-tier definitions, no tool-calling capability-composition risk model — labs.cloudsecurityalliance.org (multiple CSA research notes, March–April 2026), kpmg.com
- **MCP STDIO systemic design flaw** (OX Security, April 2026; CSA research note May 2026) — architectural RCE via STDIO transport configuration; 10 vulnerabilities spanning LiteLLM, LangChain, LangFlow, Flowise, LettaAI, LangBot; ~200,000 vulnerable instances estimated; 150M+ package download supply chain; 7+ confirmed critical CVEs across MCP Inspector, LiteLLM, Cursor IDE, LibreChat, Windsurf (CVE-2026-30615, CVE-2026-40933); ad-hoc input filtering insufficient — architectural flaw, not sanitizable away — thehackernews.com, labs.cloudsecurityalliance.org (MCP Security Crisis note, May 2026)
- **Unicode TAG-Block Concealment in MCP** (arXiv 2607.05744) — approval-view fidelity gap: Unicode TAG-block characters conceal tool-metadata payloads from human review UIs across three independent MCP server implementations; human "approve this action" dialogs show sanitized view while the model receives the full payload; renders human-in-the-loop gates partially ineffective at the point where they are supposed to be strongest — arxiv.org/abs/2607.05744

**Threat map update for OUR swarm (Workflow/subagents + MCP):**

1. **MCP infrastructure is tested attack surface, not theoretical risk (existing gap, now measured):** MCPTox (72.8% ASR on 45 real servers at AAAI 2026) + STDIO design flaw (~200k vulnerable instances) together mean our Gmail/Linear/Cloudflare/Firebase MCP servers face a benchmark-calibrated adversarial environment. The STDIO flaw is architectural; filtering does not close it.
2. **Human-in-the-loop gates have a known bypass (new, high):** arXiv 2607.05744 shows Unicode TAG-block concealment allows the model to receive a different payload than what the human reviewer sees in the approval UI. Our human-in-the-loop gates (a primary defense in CCR protocol) are not TAG-block aware and cannot be assumed to show the model's full context.
3. **Computer-use agents have a physical-world attack surface (new, medium):** VPI-Bench and the CSA typographic injection note show that multimodal/computer-use agents are specifically targetable via visual content — not just web pages but physical signs and packaging. Relevant if any swarm agent ever processes visual input from the real environment.
4. **MCP resource-exhaustion abuse vector (new, low-medium):** AEGIS addresses a distinct MCP abuse class — tool parameters crafted to exhaust resources (large search radii, long videos). This is separate from injection but relevant to our rate-limited public read endpoints if MCP tools expose uncapped parameters.
5. **NIST Cyber AI Profile draft raises the compliance bar (informational):** Once finalized, NIST IR 8596 will frame our "broad tool inheritance" open gap not as a security best-practice gap but as a baseline compliance requirement. Tracking the draft publication timeline is warranted.

**Already defending us (unchanged):** CCR adversarial-verify, worktree isolation, Invariant #22 module isolation, human-in-the-loop gates, S2 post-execution integrity.

**Open gaps (updated):**
- (unchanged from 2026-09-11) No explicit trifecta break (reader vs actor agents); broad per-subagent tool inheritance (not least-privilege); cross-agent messages treated as trusted instructions (no spotlighting/provenance); no infection monitoring on pipeline
- (unchanged from 2026-10-08) No campaign-attribution layer; no MAC/information-flow enforcement (confused deputy exploitable at 39% baseline)
- (new 2026-10-13) Human-in-the-loop approval gates are not Unicode TAG-block aware — model may receive a different payload than the human reviews (arXiv 2607.05744)
- (new 2026-10-13) MCP STDIO transport in our server stack may carry architectural RCE exposure (OX Security finding) — not confirmed per our specific servers, but affects major MCP ecosystem platforms including our providers
