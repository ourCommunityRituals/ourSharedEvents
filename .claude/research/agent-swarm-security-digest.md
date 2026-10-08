# Agent & Swarm Security — Longitudinal Research Digest

> **Purpose:** a dated, append-only series maintained by the **Dr of Security** ([[project_ccr_advanced_scrum_roles]]). Each scan appends one entry. The value is **corroboration over time** — a threat/paper/framework that recurs across scans is durable signal; one that appears once and disappears was noise/hype. Do NOT rewrite prior entries — append, then update the Corroboration Tracker.
>
> **How a scan works (the Dr of Security "currency step"):** run live web searches for agent/multi-agent/swarm LLM security (attacks + defenses + frameworks), verify citations against real sources (no recalled/hallucinated IDs), append a new dated entry below, then update the tracker: mark each item **NEW / CORROBORATED (seen in ≥2 scans) / FADED (not seen this scan)**.

---

## Corroboration Tracker (update every scan)

| Item                                                              | First seen | Last seen  | Status        | Notes                                                                   |
| ----------------------------------------------------------------- | ---------- | ---------- | ------------- | ----------------------------------------------------------------------- |
| Prompt Infection (LLM→LLM injection, self-replicating across MAS) | 2026-09-11 | 2026-10-08 | CORROBORATED  | ESORICS 2025; extended by arXiv 2609.22949 & 2608.00718 (ICML 2026)    |
| OWASP Top 10 for Agentic Apps (ASI01–ASI10)                       | 2026-09-11 | 2026-10-08 | CORROBORATED  | Widely cited 2026; companion LLM 2026 list released Aug 2026            |
| MITRE ATLAS (agentic tactics)                                     | 2026-09-11 | 2026-10-08 | CORROBORATED  | v2026.09 (Sept 15): 120 techniques (+36), 139 Agentic AI tagged entries |
| CaMeL — defeating prompt injection by design                      | 2026-09-11 | 2026-10-08 | CORROBORATED  | MIT 6.858 Spring 2026 reading; Gemini 2.5 Pro: 300→0 attacks; 2.8× tokens |
| MCP tool poisoning (descriptions/results)                         | 2026-09-11 | 2026-10-08 | CORROBORATED  | 40+ CVEs in 2026; OWASP MCP Top 10 now official OWASP project           |
| Lethal trifecta (private data + untrusted input + exfil)          | 2026-09-11 | 2026-10-08 | CORROBORATED  | NSA/CISA May 2026 "privilege" risk category independently validates     |
| Infection monitoring (INFA-Guard, VIGIL verify-before-commit)     | 2026-09-11 | 2026-10-08 | CORROBORATED  | INFA-Guard −33% ASR confirmed; VIGIL 2601.05755 active                  |
| NSA/CISA Five Eyes "Careful Adoption of Agentic AI"               | 2026-10-08 | 2026-10-08 | NEW           | May 1 2026; 30 pp; 100+ controls; 5 risk categories; zero-trust ext.   |
| OWASP MCP Top 10                                                  | 2026-10-08 | 2026-10-08 | NEW           | Official OWASP project; indirect injection #1; Unit 42: 78.3% ASR      |
| Cross-Agent Campaign Attribution (arXiv 2607.18826)               | 2026-10-08 | 2026-10-08 | NEW           | ICML 2026; A2FV async fingerprinting across pipeline hops; AUC 0.82    |
| Beyond Single-Model Injection (arXiv 2609.22949)                  | 2026-10-08 | 2026-10-08 | NEW           | ICML 2026; 14 vectors; 67% agents vulnerable w/ guardrails; 31%→4%     |
| SEAgent — MAC for LLM privilege escalation (arXiv 2601.11893)     | 2026-10-08 | 2026-10-08 | NEW           | Confused deputy in MAS; info-flow graph; 0% ASR vs 39.14% baseline     |
| MCP CVE surge (CVE-2026-5058, CVE-2025-6514)                      | 2026-10-08 | 2026-10-08 | NEW           | CVE-2026-5058 CVSS 9.8 (aws-mcp-server RCE, no auth required)          |
| OWASP Top 10 for LLM Applications 2026                            | 2026-10-08 | 2026-10-08 | NEW           | Aug 2026; replaces 2025 LLM list; distinct from ASI agentic list       |

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

<!-- APPEND NEXT SCAN BELOW THIS LINE -->

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
