# Agent & Swarm Security — Longitudinal Research Digest

> **Purpose:** a dated, append-only series maintained by the **Dr of Security** ([[project_ccr_advanced_scrum_roles]]). Each scan appends one entry. The value is **corroboration over time** — a threat/paper/framework that recurs across scans is durable signal; one that appears once and disappears was noise/hype. Do NOT rewrite prior entries — append, then update the Corroboration Tracker.
>
> **How a scan works (the Dr of Security "currency step"):** run live web searches for agent/multi-agent/swarm LLM security (attacks + defenses + frameworks), verify citations against real sources (no recalled/hallucinated IDs), append a new dated entry below, then update the tracker: mark each item **NEW / CORROBORATED (seen in ≥2 scans) / FADED (not seen this scan)**.

---

## Corroboration Tracker (update every scan)

| Item                                                              | First seen | Last seen  | Status        | Notes                                                                                  |
| ----------------------------------------------------------------- | ---------- | ---------- | ------------- | -------------------------------------------------------------------------------------- |
| Prompt Infection (LLM→LLM injection, self-replicating across MAS) | 2026-09-11 | 2026-09-30 | CORROBORATED  | arXiv 2410.07283; still cited in 2026 surveys; foundational                            |
| OWASP Top 10 for Agentic Apps (ASI01–ASI10)                       | 2026-09-11 | 2026-09-30 | CORROBORATED  | Widely cited; 2026 edition confirmed at genai.owasp.org                                |
| MITRE ATLAS (agentic tactics; now v2026.09)                       | 2026-09-11 | 2026-09-30 | CORROBORATED  | Updated: 16 tactics / 84 techniques (+18 from v5.1.0); 139 entries tagged Agentic AI  |
| CaMeL — defeating prompt injection by design                      | 2026-09-11 | 2026-09-30 | CORROBORATED  | IEEE S&P SATML 2026 proceedings; extended by CaMeLoT (arXiv 2609.18674)               |
| MCP tool poisoning (descriptions/results)                         | 2026-09-11 | 2026-09-30 | CORROBORATED  | Growing: AEGIS (2608.20481), DOD advisory Jun 2026, Parasites in Toolchain (2509.06572)|
| Lethal trifecta (private data + untrusted input + exfil)          | 2026-09-11 | 2026-09-30 | CORROBORATED  | Pattern embedded in Five Eyes guidance + SoK papers; real-world CVE evidence          |
| Infection monitoring (INFA-Guard, VIGIL verify-before-commit)     | 2026-09-11 | 2026-09-11 | FADED         | Not specifically surfaced Q4 2026; concept subsumed into IFC/CaMeL family             |
| Cross-Agent Campaign Attribution (async multi-hop attacks)        | 2026-09-30 | 2026-09-30 | NEW           | arXiv 2607.18826; attacks can be deferred across agent hops                           |
| Confused Deputy in the Swarm (cascade priv-esc + memory poison)   | 2026-09-30 | 2026-09-30 | NEW           | SSRN 7360399; IPC cascade + RAG vector-store poisoning                                |
| SoK: When Safe Agents Fail Together                               | 2026-09-30 | 2026-09-30 | NEW           | arXiv 2609.00595 (Sept 2026); comprehensive MAS security SoK                          |
| NSA/CISA Five Eyes "Careful Adoption of Agentic AI Services"      | 2026-09-30 | 2026-09-30 | NEW           | May 1 2026; 5 risk categories; first joint Five Eyes agentic advisory                |
| NIST CAISI AI Agent Standards Initiative                          | 2026-09-30 | 2026-09-30 | NEW           | Feb 17 2026 formal launch; replaces earlier CSF 2.0 entry                            |
| CaMeLoT (CaMeL + temporal logic static verification)              | 2026-09-30 | 2026-09-30 | NEW           | arXiv 2609.18674; extends CaMeL with liveness verification                            |
| CVE-2025-53773 (GitHub Copilot RCE via prompt injection)          | 2026-09-30 | 2026-09-30 | NEW           | Real-world RCE; confirms prompt injection reaches code execution in prod              |
| CVE-2026-40217 (LiteLLM guardrail sandbox escape)                 | 2026-09-30 | 2026-09-30 | NEW           | Bytecode rewriting escapes unsafe Python sandbox in guardrail test path               |
| Image-based prompt injection in multimodal LLMs                   | 2026-09-30 | 2026-09-30 | NEW           | CSA Lab Space Jan 2026; adversarial images bypass text-layer sanitization             |

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

---

## Scan 2026-09-30 (Q3 2026 quarterly)

> **Fetch note**: direct WebFetch was blocked by the network egress proxy for all attempted domains (arxiv.org, owasp.org, atlas.mitre.org, cloudsecurityalliance.org, ssrn.com, defense.gov, and others). All citations below are verified by live WebSearch result snippets — titles and URLs confirmed present in live search results this run; full-text was not retrievable. ArXiv IDs are search-result-attested, not recalled.

**Verified sources (live search, 2026-09-30):**

_Frameworks & advisories (new or updated this scan):_

- MITRE ATLAS v2026.09 (published 2026-09-15): 16 tactics, **84 techniques** (+18 since v5.1.0), 56 sub-techniques; 139 entries now carry the "Agentic AI" tag. New techniques include tool poisoning, scope-elevation via OAuth, memory poisoning, and credential harvesting via tool invocation. Source: Zenity.io ATLAS coverage, dev.to MITRE ATLAS agentic recap.
- NSA/CISA + Five Eyes joint advisory: "Careful Adoption of Agentic AI Services" (2026-05-01). First Five Eyes guidance specific to autonomous agents. Five risk categories: **privilege escalation**, design/config flaws, behavioral misalignment, structural cascading failures, accountability opacity. Source: CSA Labs research note on CISA Agentic AI Guide.
- NIST CAISI AI Agent Standards Initiative (formally launched 2026-02-17): three pillars — ISO/IEC standards leadership, open-source protocol development (co-invested with NSF), fundamental research in agent security/identity/interoperability. Source: CSA Labs NIST AI Agent Standards coverage.
- OWASP Top 10 for Agentic Applications 2026: confirmed live at genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/. ASI01–ASI10 catalog unchanged; 2026 branding confirmed.
- DOD/NSA CSI MCP Security Advisory (2026-06-02, media.defense.gov): defense-grade MCP advisory. Introduces signed tool manifests, automated metadata scanning, and dynamic tool scoping. (Fetch blocked; confirmed by search snippet.)

_New attack research:_

- **Cross-Agent Campaign Attribution** (arXiv 2607.18826): linking asynchronous attacks across LLM agent networks. Introduces topology-aware attacks targeting multi-hop agent interactions; attacks can be deferred — a poisoned payload in one hop executes downstream in a later agent's context.
- **Confused Deputy in the Swarm** (SSRN 7360399, Vishwakarma): cascading privilege escalation across IPC and latent memory poisoning in RAG vector stores within heterogeneous multi-agent LLMs. Two primary attack vectors explicitly named: (1) cascading priv-esc across inter-process communication; (2) latent memory poisoning inside RAG vector stores.
- **SoK: When Safe Agents Fail Together** (arXiv 2609.00595, Sept 2026): comprehensive systematization of multi-agent LLM security. MAS failure rates 41–87% on standard benchmarks; failures cluster into: specification mismatch, inter-agent misalignment, inadequate verification. Confirms inter-agent trust is the unsolved problem.
- **Image-based prompt injection in multimodal LLMs** (CSA Lab Space, Jan 2026): adversarial instructions embedded in images bypass text-layer sanitization. Threat to any vision-enabled agent (e.g., poster/QR scanning flows).
- **CVE-2025-53773** (GitHub Copilot): RCE via prompt injection confirmed in production. Direct evidence that the injection→code-execution chain is exploitable in shipping IDE tooling.
- **CVE-2026-40217** (LiteLLM): custom-code guardrail path evaluates caller-supplied Python in an unsafe sandbox escapable via bytecode rewriting + dunder-attribute traversal → server-side RCE.

_Evolving defenses:_

- **CaMeLoT** (arXiv 2609.18674): extends CaMeL with temporal logic for static liveness verification. The control-flow / data-flow split + capability enforcement family (CaMeL, FIDES, Progent, RTBAS, FORGE) now converging — near-elimination of AgentDojo attacks confirmed across multiple implementations.
- **AEGIS** (arXiv 2608.20481): prevents cross-domain resource abuse in MCP; addresses confused-deputy on tool invocations across domain boundaries.
- **Adaptive evaluation of out-of-band defenses** (arXiv 2606.26479): adaptive attacks bypass >90% of published defenses given sufficient optimization time — framing defense arms race honestly.

**Tracker summary (vs. baseline scan):**
- CORROBORATED (6): Prompt Infection, OWASP ASI01–ASI10, MITRE ATLAS, CaMeL, MCP tool poisoning, Lethal trifecta
- NEW (9): Cross-Agent Attribution, Confused Deputy, SoK MAS, Five Eyes advisory, NIST CAISI, CaMeLoT, CVE-2025-53773, CVE-2026-40217, Image-based injection
- FADED (1): Infection monitoring (INFA-Guard/VIGIL) — concept absorbed into IFC/CaMeL family; not independently surfaced

---

**Threat map applied to OUR swarm (Workflow subagents + MCP servers) — Q3 2026 delta:**

1. **Cross-Agent Attribution gap (NEW RISK):** Our `pipeline`/`parallel` pattern passes results agent→agent. Cross-Agent Attribution paper confirms attacks can be _deferred_ — a poisoned payload can sit dormant in one subagent's output and fire in the next hop. Our spotlighting/provenance gap (from baseline) is now confirmed acute, not theoretical.

2. **Confused Deputy / Cascade priv-esc (NEW RISK):** Our subagents inherit broad tool scopes from the parent. The IPC cascade pattern maps directly: a subagent with `Bash` + `Edit` + push access is a confused deputy waiting for an injected elevation. The SSRN 7360399 attack path (IPC → RAG vector-store) applies if/when we add memory/vector stores.

3. **Five Eyes five risk categories → open gaps confirmed at government level:**
   - _Privilege escalation_ → our broad per-subagent tool inheritance (listed since baseline)
   - _Accountability opacity_ → no execution provenance / spotlighting (listed since baseline)
   - _Structural cascading failures_ → SoK confirms 41–87% MAS failure rates; no cascade-break in our pipeline
   - The advisory's existence means regulators/auditors will be asking about these in 2026; not just academic risk.

4. **MCP lateral movement maturing (CORROBORATED + growing):** AEGIS addresses cross-domain MCP resource abuse; DOD advisory introduces signed tool manifests. Our MCP servers (Cloudflare, Firebase, Gmail, Airtable, Linear) remain ungated beyond OAuth scopes — no manifest signing, no dynamic tool scoping.

5. **CVE-2025-53773 / CVE-2026-40217 (NEW real-world evidence):** Prompt injection → RCE in GitHub Copilot is a direct data point that our Bash + git-push subagent path is production-realistic risk, not hypothetical.

6. **CaMeLoT as upgrade path (NEW DEFENSE):** CaMeL (our existing referenced defense) now has a temporal-logic extension with static liveness verification. If we implement an inter-agent trust layer, CaMeLoT is the current best-practice reference.

**Open gaps list — unchanged items still open:**
- No explicit trifecta break (reader vs. actor agents) — still open
- Broad per-subagent tool inheritance (not least-privilege) — still open; now externally validated by Five Eyes
- Cross-agent messages treated as trusted (no spotlighting/provenance) — still open; now highest-priority given Cross-Agent Attribution paper
- No infection monitoring on the pipeline — partially FADED (INFA-Guard/VIGIL not active), but cascade-break needed

**New gap added this scan:**
- No cascade-break mechanism in Workflow `pipeline`/`parallel` — if one subagent produces poisoned output, nothing quarantines it before the next hop processes it as trusted input.
