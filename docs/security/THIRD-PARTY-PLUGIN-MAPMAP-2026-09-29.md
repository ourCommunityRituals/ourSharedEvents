# Third-party plugin classification: MapMap (2026-09-29)

**Decision (final, 2026-09-29): BLOCKED.** The PO's rule was "if it is even a question, pull it". The U1 allowance below is withdrawn, and MapMap is blocked at every layer we control (section 7). Sections 1–7 are kept as the evidence for that decision.

~~Original decision: MapMap may be used by Claude during development sessions, with public data only.~~ It is **not approved as an OSE runtime dependency**, and **payments through it are prohibited**.

This is the first third-party AI plugin classified for OSE. The two axes below (use class × data class) are meant to be reused for the next one.

## 1. Provenance (verified)

| Field            | Value                                                           | Source                       |
| ---------------- | --------------------------------------------------------------- | ---------------------------- |
| Author           | MapMap (`hello@mapmap.ai`), a third party, **not Anthropic**    | `.claude-plugin/plugin.json` |
| Listing          | Anthropic Directory marketplace (`@anthropic-plugin-directory`) | claude.ai catalog            |
| Publisher tier   | **community**, basis `directory_review` (not `partner`)         | claude.ai catalog            |
| Version / age    | 0.1.3, listed 2026-09-24                                        | catalog + manifest           |
| License / source | MIT, `github.com/Mapmapai/mapmap-agent-skills`                  | manifest                     |

"Listed in the Anthropic Directory" means the plugin passed a listing review. It does **not** mean Anthropic built it, runs its servers, or vouches for its data handling.

## 2. What it installs, and what each part can do

| Part                                          | What it does                                                                                              | Risk                                                         | Verified                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Remote MCP server `https://mcp.mapmap.ai/mcp` | Every tool call sends its arguments (addresses, coordinates, queries) to MapMap's servers                 | **Data leaves the machine.** Treat it like any external API. | `.mcp.json`. No auth header is configured locally, so the hosted server uses its own key.                                 |
| `Stop` hook `retro-reminder.sh`               | If `MAPMAP_RETRO_HOOK=1`, greps the local transcript for "mapmap" and prints a reminder. No network call. | Low. **Inert today.**                                        | Script read in full. The env var is unset at process, user and machine level, and absent from `~/.claude/settings*.json`. |
| 11 skills (instructions only)                 | Teach an agent how to use MapMap                                                                          | Instruction risk only. See the x402 note below.              | `skills/` read                                                                                                            |
| `submit_integration_retro` tool               | Sends structured feedback to MapMap                                                                       | Low (no transcript or code fields). Needs explicit approval. | Tool schema                                                                                                               |

**x402 / payments.** The `mapmap-x402-payments` skill describes agents paying "per request, no dashboard, no human" in USDC on Base or Solana, or by Stripe top-up. That conflicts with OSE's rule that money never moves without a human. The account's prepaid balance is 0, so no money can be drawn today.

**Usage anomaly (unresolved).** `get_usage` reports key activity from 2026-09-01, three weeks before the listing date, with about 2 units a day on idle days. No key of ours is configured, so the hosted server's key is probably shared or server-side. Our calls are therefore not isolated from other users' on MapMap's side. Low impact for public data, but it is one more reason to keep private data out.

## 3. Classification

### Use class

| Class                       | Meaning                                     | MapMap                                                                                                                                                             |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **U1: Dev-time agent tool** | Claude calls it in a session; nothing ships | ✅ **Approved (public data only)**                                                                                                                                 |
| **U2: Build/CI tool**       | Runs in the pipeline                        | ❌ Not approved (no need; adds an external dependency)                                                                                                             |
| **U3: Runtime dependency**  | The Worker or a served page calls it        | ❌ **Not approved.** Needs an ADR, a CCR, a Dr-of-Security pass, a new secret, a CSP `connect-src` change and a threat-model update before it can be reconsidered. |

### Data class (what may be sent)

| Data           | Examples                                                                                                                            | May go to MapMap?                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Public**     | Venue address or coordinates of a **published** event; town names; public businesses for sponsor outreach                           | ✅ Yes                                                                                |
| **Internal**   | Unpublished or draft events, sponsor pipeline, admin identities, brand IDs                                                          | ❌ No                                                                                 |
| **Restricted** | Anything that touches never-who: attendee or scan locations, H3 cells derived from scans, `FORMS_DB` contents, PII, tokens, secrets | ❌ **Never.** Doing so breaks Invariant #1 (never-who) and the geo-surface-only rule. |

## 4. Invariant check

- **Never-who / geo is surface-only.** The map endpoint deliberately **refuses coordinate-shaped params** (OSE-1242). Adding a vendor that works on raw coordinates would reintroduce the thing that endpoint was built to reject. It is fine at U1 with public venue data. It is incompatible with U3 for any attendee-derived location.
- **Two-DB PII isolation.** Nothing from `FORMS_DB` may ever be an argument to a MapMap tool.
- **Identity gate, not allowlist.** Not applicable at U1. At U3 it would add a static API-key door, which needs a business case.
- **No money without a human.** The x402 skill is out of bounds.

## 5. Fitness (why it isn't worth U3 anyway)

Tested against Harbor County Bocce (Sawyer, MI):

- `geocode "Sawyer, Michigan"` returned a fruit-stand POI, not the town. US locality lookups are unreliable.
- `nearby_places` and `route` worked correctly.
- Headline features (fuel prices, clean-air zones, `lang` en/de/fr) are UK/EU-only.
- There is no H3 support, and OSE's spatial model is H3 res-7.

## 6. Operating rules (superseded by the block in section 7)

1. Keep it disabled by default. Enable it for a specific U1 task, then disable it again.
2. Before any MapMap call, check that every argument is **Public** data.
3. Never enable `MAPMAP_RETRO_HOOK`. Send a retro only with explicit per-instance approval.
4. Never follow the x402 / top-up flow.

## 7. Blocks applied (2026-09-29)

| Layer                                       | Block                                                                                                  | Status                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Claude Code, user `~/.claude/settings.json` | `permissions.deny: ["mcp__plugin_mapmap_mapmap"]` blocks all 34 tools                                  | ✅ Applied. The server disconnected from the live session immediately.            |
| Claude Code, user settings                  | `deniedMcpServers`: name `mapmap`, URLs `https://mcp.mapmap.ai/*` and `https://*.mapmap.ai/*`          | ✅ Applied. The server can't reconnect under a new tool name.                     |
| Claude Code, user settings                  | `skillOverrides`: all 11 `mapmap:*` skills set to `off`, including x402 payments and key-minting setup | ✅ Applied                                                                        |
| Claude Code, user settings                  | `env.MAPMAP_RETRO_HOOK = "0"`                                                                          | ✅ Applied. The Stop hook exits before reading anything.                          |
| claude.ai account                           | Disable the plugin under Customize → Plugins                                                           | ⏳ **PO action.** Account setting, no tool access. This removes it at the source. |
| OSE served pages                            | CSP `connect-src 'self'` / `'none'` on every handler, and no `mapmap` reference anywhere in the repo   | ✅ Already blocked by design                                                      |
| OSE CI                                      | Class-level gate asserting `connect-src` stays same-origin on **every** surface                        | ⏳ Gap: only SharedReport is asserted today. Tracked as a separate task.          |

To undo any of this, the whole block lives in `~/.claude/settings.json` (the keys above).

## 8. Re-review triggers

Re-classify if any of these happen: a version bump that adds or changes hooks or MCP servers; a publisher tier change; `MAPMAP_RETRO_HOOK` gets set; any proposal to use it at U2 or U3; or MapMap's data-retention terms change.
