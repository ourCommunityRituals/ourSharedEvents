# Agent & Swarm Security — Longitudinal Research Digest

> **Purpose:** a dated, append-only series maintained by the **Dr of Security** ([[project_ccr_advanced_scrum_roles]]). Each scan appends one entry. The value is **corroboration over time** — a threat/paper/framework that recurs across scans is durable signal; one that appears once and disappears was noise/hype. Do NOT rewrite prior entries — append, then update the Corroboration Tracker.
>
> **How a scan works (the Dr of Security "currency step"):** run live web searches for agent/multi-agent/swarm LLM security (attacks + defenses + frameworks), verify citations against real sources (no recalled/hallucinated IDs), append a new dated entry below, then update the tracker: mark each item **NEW / CORROBORATED (seen in ≥2 scans) / FADED (not seen this scan)**.

---

## Corroboration Tracker (update every scan)

| Item                                                              | First seen | Last seen  | Status | Notes                                              |
| ----------------------------------------------------------------- | ---------- | ---------- | ------ | -------------------------------------------------- |
| Prompt Infection (LLM→LLM injection, self-replicating across MAS) | 2026-09-11 | 2026-09-11 | NEW    | ESORICS 2025; >80% success GPT-4-class             |
| OWASP Top 10 for Agentic Apps (ASI01–ASI10)                       | 2026-09-11 | 2026-09-11 | NEW    | Dec 2025, peer-reviewed; NIST/MSFT/NVIDIA endorsed |
| MITRE ATLAS (agentic tactics; C2 added v5.1.0)                    | 2026-09-11 | 2026-09-11 | NEW    | Nov 2025, 16 tactics / 84 techniques               |
| CaMeL — defeating prompt injection by design                      | 2026-09-11 | 2026-09-11 | NEW    | capability/IFC + dual-LLM; solves AgentDojo        |
| MCP tool poisoning (descriptions/results)                         | 2026-09-11 | 2026-09-11 | NEW    | MCP-ITP, MCP Pitfall Lab, TRUSTDESC                |
| Lethal trifecta (private data + untrusted input + exfil)          | 2026-09-11 | 2026-09-11 | NEW    | Willison framing; applies to our swarm             |
| Infection monitoring (INFA-Guard, VIGIL verify-before-commit)     | 2026-09-11 | 2026-09-11 | NEW    | defenses for MAS propagation                       |

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
