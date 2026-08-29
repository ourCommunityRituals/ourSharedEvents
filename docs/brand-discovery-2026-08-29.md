# Brand Discovery Report — OurSharedEvents (OSE)

**Date:** 2026-08-29
**Scope:** Local monorepo only (Google Drive excluded by user; Gong/Granola/Slack/Figma not connected)
**Method:** Autonomous discovery sweep (brand-voice plugin), coordinated from the robot-knowledge session

---

## 1. Sources inventory

| Path                                                                                                   | What it is                                                                                                                         | Confidence                     |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `ourSharedEvents/.claude/brand-voice-guidelines.md`                                                    | Canonical brand-voice doc, v1.4, 764 lines, effective 2026-05-16. Three repo copies verified byte-identical                        | **Canonical**                  |
| `ourSharedEvents/.claude/brand-voice-audit-context.md`                                                 | Founder-input doc that fed the guidelines                                                                                          | Canonical (source)             |
| `ourSharedEvents/docs/brand-voice-audit-2026-05-16.md`                                                 | Underlying audit                                                                                                                   | Backing source (not deep-read) |
| `docs/positioning/COMPETITIVE-BRIEF-2026-05-14.md` / `BEACHHEAD-ICP-2026-05-14.md` / `PRICING-PLAN.md` | Sales positioning, ICP, pricing                                                                                                    | Secondary                      |
| `src/templates/landing.html`, `src/templates/public.html`, `src/handlers/pages.ts`                     | Live implementation                                                                                                                | Live copy                      |
| `OCR-docs/ocr-docs-brain/uec-codes.yaml`                                                               | UEC visual identity (note: lives in `OCR-docs/`, not `OCR-docs-ocr40/`)                                                            | Canonical (visual)             |
| `config/brand-config.js`                                                                               | Multi-tenant identity config (root=Zeventbook, abc, cbc, cbl) — tenant "brand", not voice                                          | Contextual                     |
| `OSE Admin App.html` (monorepo root)                                                                   | Latest Claude Design output serving as main admin app; 1.29MB minified bundle — low text yield; audit its JSX/TSX source next pass | Current / generated draft      |

## 2. Brand elements

- **Core promise:** "You're part of the group, anonymously. OurSharedEvents tracks when groups gather — never who you are." Live on all four event-page phases (`pages.ts:616/778/815/988`).
- **Voice constants (§2):** warm-but-precise · neighborhood-rooted · privacy-forward-by-design (anti-promises, not disclaimers) · action-verb-led · plain-language-technical · first-person-inclusive · confident-without-overclaim.
- **Customer mental model:** _event triangle / event flow / event cycle_ (Pre / Event / Post). **`flywheel` is internal-only** (Q2, confirmed 2026-05-16).
- **Terminology:** `host` (never "organizer"/"bar owner" customer-facing) · `Pro plan` (never "Mid") · errors say `having trouble` (never "error"/"down") · success shape `You're [state]!`
- **Visual identity:** UEC color-semantic QR system. SPONSOR blue is doctrine ("the most valuable pixel… permanent"): base `--uec-sponsor: #1D3557`, scan variant `#1A3A8A`.
- **Pitch frames:** sponsors = anonymous corridor density; organizers = RSVPs without the surveillance tax; community leaders = respect how the community operates.

## 3. Conflicts & drift found → resolution

| #   | Finding                                                                                                                          | Evidence                                                                                    | Status                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Forbidden `flywheel` shipped on landing                                                                                          | `landing.html:572` "One connected flywheel." (guidelines §8 HIGH migration)                 | ✅ **FIXED 2026-08-29** → "One connected event cycle."                     |
| 2   | Anonymity affordance (the "universal block", §3) missing from `/` and `/events` — a gap the guidelines' own backlog did not list | no anonym* string in either template; not wired in `handleLandingPage` / `handlePublicPage` | ✅ **FIXED 2026-08-29** → `.ose-anonymity` section added to both templates |
| 3   | Brand-governance material split across `OCR-docs/` vs `OCR-docs-ocr40/`                                                          | `uec-codes.yaml` location                                                                   | ⚠️ Open — declare the canonical brain                                      |
| 4   | No doc-vs-doc conflicts between guidelines and audit-context                                                                     | diff-verified                                                                               | —                                                                          |

**Fix record (per §8 "small surgical PR + regression-guard vitest"):**

- `src/templates/landing.html` — flywheel line rewritten; affordance section + styles added
- `src/templates/public.html` — affordance section + styles added
- `tests/brand-voice-surfaces.spec.ts` — NEW: 4 regression guards (no "flywheel" on landing; event-cycle line present; affordance + core promise on `/landing` and `/events`). **All 4 pass**; `landing-colorblind-safe.spec.ts` still 5/5.

## 4. Open questions

1. Which of `OCR-docs/` vs `OCR-docs-ocr40/` is the canonical org brain?
2. Admin-surface voice compliance: audit the admin app from source (the root bundle is unreadable minified output).
3. Landing hero remains generic ("bring people together") — the 2026-08-12 consistency audit suggested weaving the privacy anchor into the hero itself (§2 "We Are Not: geography-agnostic SaaS-shaped"). The affordance block now ships, but a hero rewrite is a separate voice decision.

## 5. Coverage gaps

Google Drive excluded by user. Gong/Granola/Slack/Figma/Notion/Confluence/Box not connected. Time-boxed out: `packages/ui` tokens, `OCR_VISION.md` full text, invariant #1 full text, the full May audit doc.
