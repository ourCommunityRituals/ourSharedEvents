# DEFECT · QR encoder emits codes a decoder cannot read

**Severity:** highest in the suite. The QR is the entry point to every flow.
**Layer:** back end (`workers/oursharedevents/src/lib/qr.ts`). **Reported, not patched**, per the
flow spec's instruction.
**Found by:** `tests/qr-roundtrip.spec.ts` — first run. **Missed by:** every existing test.

---

## What happens

`generateQrCode()` produces a PNG that renders as a visually correct QR — finder patterns,
timing, alignment, quiet zone all present and in the right places — that **jsQR cannot
decode**. Tested across every margin (2, 4, 6), scale (4, 8), and EC level (L, M, Q, H):
all null.

Both product defaults are affected. Call sites:

| File | Line | EC level |
|---|---|---|
| `src/handlers/poster-bundle.ts` | 113 | `M` — the poster page's four form QRs |
| `src/handlers/poster-bundle.ts` | 125 | `M` — UEC ENTER (SVG) |
| `src/handlers/poster-deployments.ts` | 216 | `M` — the physical-placement scan token |
| `src/handlers/uec-resolve.ts` | 93 | `H` |

## Root cause A — confirmed by experiment

`EC_LEVEL = { L: 0, M: 1, Q: 2, H: 3 }` (qr.ts:19) is the **table-index** order, used
correctly to index `VERSION_CAPACITY`, `EC_CODEWORDS_PER_BLOCK`, `NUM_EC_BLOCKS`.

`formatBits()` (qr.ts:229) then feeds that same value straight into the format
information: `const data = (ecLevel << 3) | 0;`

But the QR spec's format-info EC indicator is a **different** encoding:

| Level | Table index | Format indicator |
|---|---|---|
| L | 0 | `01` = 1 |
| M | 1 | `00` = 0 |
| Q | 2 | `11` = 3 |
| H | 3 | `10` = 2 |

So every code declares the wrong EC level in its format bits. A decoder reads format info
**first**, derives the wrong data/ECC split, and gives up — which is exactly why the
symbol looks perfect and reads as nothing.

**Proof, not inspection.** Applying only this mapping to a scratch copy made `ec=L`
decode where it previously returned null. Production file restored; `git diff` clean.

```
before fix:  ec=L -> null   ec=M -> null   ec=Q -> null   ec=H -> null
after fix:   ec=L -> DECODED ✓   (M/Q/H still null — see B)
```

Candidate fix, for whoever owns the back end:

```ts
// Format-info EC indicator is NOT the table index. Spec: L=01 M=00 Q=11 H=10.
const EC_FORMAT_INDICATOR: Record<number, number> = { 0: 1, 1: 0, 2: 3, 3: 2 };
const data = (EC_FORMAT_INDICATOR[ecLevel] << 3) | 0;
```

## Root cause B — a second defect, not yet isolated

With A corrected, decode still succeeds only sporadically:

```
payload  25B   L:OK  M:--  Q:--  H:--
payload  30B   L:--  M:OK  Q:--  H:--
payload  40B   L:OK  M:--  Q:--  H:--
payload  50B   L:--  M:--  Q:--  H:--
```

Success tracks payload length and EC level together, which points at the
version/block-count boundaries: `NUM_EC_BLOCKS`, the `addEcc` block split, or the
interleaving order for multi-block symbols. Single-block cases decode; multi-block cases
do not. **The product's real payloads — scan URLs of roughly 40–60 bytes at EC level M —
land in the failing region.**

This one needs the back-end owner and a reference implementation to diff against. It is
not safe to guess at.

## Why this has not caused a field incident

`src/handlers/qr-verify.ts` gates `ready → active` on a human physically scanning the code
and setting `qr_verified = 1`; the reverse transition clears it. That manual step is a real
control and is very likely what has been absorbing this. It also means the failure mode
today is **an event that cannot be activated**, not a poster in a window that silently
fails — which is the better of the two, and worth preserving.

It connects to the D-4 ruling (an event must be `active` before its QR is live): the
verification gate is the mechanism that ruling should be enforced through.

## Why no existing test caught it

The suite's only QR-encoder assertion checks that a handler file **contains the string**
`'../lib/qr'` (`tests/poster-qr.spec.ts:134`). That tests an import statement. The rest of
`poster-qr.spec.ts` asserts markup strings in the page — `loadPosterQR`, `qr-img-register`
— none of which touch the encoder.

A mutation campaign confirmed the gap before the round-trip test existed. Four encoder
mutants, all survivors:

```
SURVIVED  qr-size-formula          17 + 4v -> 17 + 5v
SURVIVED  qr-alignment-threshold   version >= 2 -> >= 3
SURVIVED  qr-codeword-adjust       mods -= 25 -> 24
SURVIVED  qr-ec-level-bits         ecLevel << 3 -> << 2
```

The last one mutates the exact line that carries defect A, and nothing noticed.

## The gate that closes it

`workers/oursharedevents/tests/qr-roundtrip.spec.ts` asserts the bytes the **browser**
receives, through the real chain:

```
GET /api/v2/events/:id/poster-bundle     (what poster.html fetches)
  -> generateQrCode()
  -> data:image/png;base64 in the JSON the page renders into <img>
  -> spec decodes that PNG back to pixels
  -> jsQR reads them the way a phone camera would
  -> assert the decoded string equals the URL we meant to encode
```

It is **born-red on purpose** and currently fails. It should stay red until the encoder is
fixed — a green suite over an unscannable QR is precisely the false green worth avoiding.

Once A and B are fixed it also becomes the regression lock: the four surviving mutants
above all die against it, because each corrupts the symbol in a way a decoder notices.
