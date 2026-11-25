# Layout skins: report, vote screen, and next the poster

Stories: OSE-2232 (SharedReport skins), OSE-2226 (the host's vote screen). Owner ask, 2026-11-25:

> Make sure there is configurable room to move around the elements to present interchangeable, unique report skins for every event sharedReport if decided. This would be a great template to also think about using for posters too. 1) Priority is the sharedReport 2) think how this can also be applied to the poster layout too.

And on how it is handed over: one base brand; customization for ourSharedEvents goes through a solution engineer, through Bruno, exchanging .md files; ourWKRP users get a small front end to do the same for themselves (ourWKRP#139 mirrors this format).

## The idea in one paragraph

A page is cut into named **parts** (regions). A **layout** says, for one event and one page, the order of every part, which parts run full width, and whether the page uses one column or two on a wide screen. A **skin** is a ready-made layout with a name. The organizer picks a skin and may move parts from there; once moved, the layout is "custom". The layout is stored in the event's settings, so every reader of that event's page gets the same arrangement.

## Rules every skin keeps

1. **It arranges, never recolors.** Colors, fonts and sizes come from the design tokens (`packages/tokens`) through `/ui.css`. A skin file that names a color, font or size is refused with words that say so.
2. **It never hides a part.** A layout lists every part exactly once. What a reader may see is still decided where it always was (the report's depth filter, `lib/report-depth.ts`).
3. **It carries no numbers.** No count, no person, no link. A skin file with a count or votes key is refused: counts under 5 are never shown, and a skin is not a way around that.
4. **Reading order is what you see.** Parts are moved in the DOM, not with CSS `order`, so a screen reader and the Tab key follow the visible order.
5. **A phone is one column.** Two columns start at 720px. A part marked wide spans both.
6. **A named skin is that skin exactly.** A file or a save that says `skin: map_first` but differs from it is refused; it should say `skin: custom`.

## Where it lives

| Piece                                                     | File                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Parts, skins, checks, the one DOM mover, the grid CSS     | `workers/oursharedevents/src/lib/layout-skins.ts`                                                      |
| The .md skin file: read and write                         | `workers/oursharedevents/src/lib/layout-skin-md.ts`                                                    |
| Stored per event                                          | `settings.layouts.<page>` in `events.settings_json` (`lib/event-settings.ts`)                          |
| Admin card                                                | "Page layouts" in `src/templates/admin.html`                                                           |
| Read, and save a .md file                                 | `GET` / `PUT /api/v2/admin/events/:id/layouts`                                                         |
| The report reads it                                       | `GET /api/v2/events/:id/shared-report` answers `layout` beside `report`                                |
| The vote screen                                           | `GET /api/v2/admin/events/:id/vote-screen`                                                             |
| The skins add-on (who may use a look other than standard) | `brand_addons` (migration 0121), `src/lib/brand-addons.ts`, `PUT /api/v2/admin/addons` (platform only) |
| Staging checks                                            | Bruno folder 31                                                                                        |

## Free and paid looks

Owner, 2026-11-25: "I want the base skin as what I use and sell so everyone can use without the skin, then sell the skin and reasonable extra service."

- The **standard** skin is free for every brand, on every page.
- Any other look, a ready-made skin or a custom one, is the **skins add-on**, turned on per brand by the platform (`PUT /api/v2/admin/addons` with `{"brand_id", "addon": "skins", "on": true}`; key actor only, audited as `ADDON_SET`). A brand cannot turn it on for itself.
- Without it, a save of any other look is refused with 403 `ADDON_REQUIRED`: "Custom looks are an add-on. Ask us to turn them on." The card still lets the organizer try other skins, and says so.
- If the add-on is turned off, the saved look is kept and the pages show the standard skin until it is on again. A read that fails counts as off.
- There is no billing yet: the row is the switch.

## The .md skin file

```
---
surface: report
skin: custom
columns: 2
order: map, stats, sponsors, classes, posters, trend, locked
wide: map, trend
---

Notes for whoever edits this file. The system keeps only the lines above.
```

Keys: `surface`, `skin`, `columns` (1 or 2), `order` (every part once), `wide` (some parts, may be empty). Lists are comma separated; `[a, b]` also reads. At most 8 KB. The notes are never stored.

One file may hold one block per page, for this product and for ourWKRP (owner, 2026-11-25: clients on either product, or both, can skin). A block starts at a `---` line whose next line is `surface:`. Each product saves the blocks for its own pages and names the rest in `skipped`; a page named twice is refused. `standard` and `side_by_side` are skin names on every page.

The solution engineer's loop: download the event's skin file from the "Page layouts" card (or `GET .../layouts`, field `markdown`), edit it, and send it back with the Bruno request in folder 31 (`PUT .../layouts`, body `{"markdown": "..."}`), or with "Load a skin file" on the card. A refusal says which line to fix.

## Parts today

**Report** (`report`): `stats` (Scans), `map` (Corridor map), `sponsors` (Sponsor displays), `classes` (Local and paid sponsors), `posters` (Poster attribution), `trend` (Scan trend), `locked` (More on the next report). The event's title and date header is not a part: it always comes first. Skins: `standard` (today's page, one column), `map_first`, `sponsors_first`, `side_by_side`.

**Vote screen** (`vote_screen`): `line` ("Scan to vote", the page's one h1) and `code` (the QR). Skins: `standard`, `code_first`, `side_by_side` (for a wide TV).

## Next: the poster (priority 2, design only)

The poster can take the same shape with no new idea, only new parts:

| Part       | What it holds                                                      |
| ---------- | ------------------------------------------------------------------ |
| `art`      | The event's image or flyer (photo crops to fill, flyer fits whole) |
| `title`    | Title, date and place                                              |
| `sponsors` | The sponsor panel: same size and place for every sponsor           |
| `codes`    | The QR grid (`showQRSection` still turns it off)                   |
| `blurb`    | The short description                                              |

Before it is built, three questions for the owner, because a poster is printed and cannot be fixed afterwards:

1. **Can the sponsor panel move?** The fairness covenant says "same size, same spots for every sponsor". A poster skin could move the panel as a whole (every sponsor moves together), or the panel could be pinned. Recommended: the panel moves as a whole, and its inside never changes.
2. **Is the QR pinned to a printable spot?** A code needs its quiet zone and a minimum printed size. Recommended: `codes` may move but never shrink below the print floor, and never sits on the art (type is never set on an image; a code is treated the same).
3. **Paper sizes.** A layout per paper size (letter, tabloid, half-letter) or one layout for all? Recommended: one layout, with two columns only on tabloid and wider.

The poster template (`src/templates/poster.html`) is already split into header, stage, art, body and footer blocks, so marking them with `data-region` and calling the same mover is a small change once these are answered.

## The ourWKRP side

ourWKRP keeps the same file shape and the same refusals (ourWKRP#139), with its own surface (`profile`) and parts. Surface and part names are per product; the keys, the list syntax, the "custom" rule and the refusal words are shared.
