# Demo Site Doctrine — DRAFT for OCR-docs (OSE-606)

> **Status: DRAFT / human-gated.** This is the proposed brain landing for OSE-606.
> The canonical home is the OCR-docs brain; a human (Matt) lands it there.
> It is staged here so the code and the doctrine are written together and the
> PO can copy a ratified version into OCR-docs. **Constitution before code** —
> OSE-606 blocks the remaining build children of OSE-605.

## 1. Permanent reference doctrine

The demo sites are the platform's **permanent reference installation**. Everything
points at them — sales conversations, onboarding, documentation, essays, memos.
They are never stood up per-meeting and never allowed to go stale. A prospect who
never gets a meeting can ride the loop alone; the demo gives itself.

## 2. Three-site trio

`demo-free`, `demo-mid`, `demo-premium` — three standing installations of the
**same venue and dataset**, each rendering the full experience at its tier depth.
Same data underneath, three depths on top: **Invariant #5 (Tier Equity) as a
permanent live exhibit**. The differences a visitor sees between tabs ARE the real
feature flags rendering differently — one platform being configured, not three
builds. A hardcoded demo would be a picture of tier gating rather than tier
gating; refused.

## 3. Demo flag doctrine — the third data class

Demo rows live in production, **labeled `data_class='demo'` at write time** per the
epoch/moratorium doctrine, permanently excluded from vintage, reports-for-sale,
and the research corpus. Demo is the **third data class beside `production` and
`synthetic`** — one enum, three classes, defined once:

```
data_class: 'production' | 'synthetic' | 'demo'
```

Enforced fail-closed at the pool-routing boundary: a row whose class/phase cannot
be resolved is withheld, never leaked to the least-protected pool (OSE-677).

## 4. The tier value model (ratified 2026-08-10)

Two axes, made legible:

- **Value axis (the map):** everyone gets a real SharedReport. **Free** is an honest
  "smoke test" — headcount + own impressions, complete at its level, never a
  crippled teaser. **The visible map is the paid value line** — Mid and Premium
  both get it; free does not.
- **Governance axis (share of voice):** Premium reaches furthest — a couple extra
  features + the largest covenant share — but the **local floor (≥30%, never
  zeroed)** means reaching furthest never means excluding anyone.

The equity rule: a free sponsor feels **served, not upsold**; upgrade is pulled by
real value, never pushed by making free worse.

## 5. Break the demo = break the build

Demo URLs and tokens are **standing CI fixtures**. A release that breaks any demo
surface is a broken release. Demo currency is enforced by machinery, not by
remembering (OSE-609). The checked URLs and the published URLs are the same list
by construction — the canonical link registry (OSE-610).

## 6. Onboarding-by-relabeling

A founding client's real venue replaces the demo venue; the flag flips from
`demo` to `production`. The demo URL a prospect saw is structurally the URL they
receive as a client.

## 7. Naming decision (OPEN — land with this doctrine)

The public demo URL scheme is path-based and slug-permanent: `/demo`, `/demo/free`,
`/demo/mid`, `/demo/premium` (Invariant #18 spirit). **Open:** whether the venue is
presented under its real RIPH identity or a fictionalized name for the public
URLs. The RIPH meeting itself shows Jen her own recognizable shop; the public demo
may want a fictionalized venue. Decide when landing this doctrine.

---

### Implementation cross-reference (already built, OSE-605 branch)

| Doctrine line                 | Where it lives in code                                          |
| ----------------------------- | --------------------------------------------------------------- |
| Three-site trio, flag-driven  | `src/handlers/demo.ts` (`/demo/{free,mid,premium}`)             |
| `data_class` third class      | `src/lib/mock-data.ts` (`DataClass`, all RIPH rows `demo`)      |
| Fail-closed pool routing      | `src/lib/pool-contract.ts` (`phaseToPool` / `PoolRoutingError`) |
| Tier value model (map = paid) | `src/lib/report-depth.ts` (`corridor_map` in mid+premium)       |
| Break-demo-break-build        | `tests/demo-ci-gate.spec.ts`                                    |
| Canonical link registry       | `src/lib/demo-registry.ts`                                      |

**Remaining to fully honor this doctrine in production:** the `data_class` column
migration on `events` (+ api-schema snapshot update), a `wrangler d1` seed that
writes the canonical RIPH dataset with `data_class='demo'`, and standing
production URLs after the first signed-off deploy.
