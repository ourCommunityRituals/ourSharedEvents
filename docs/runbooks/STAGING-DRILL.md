# Staging drill: practise the window, the rollback and the restore

- **For:** the operator, alone, once before production is activated.
- **Why:** [ROLLBACK.md](./ROLLBACK.md) and [DISASTER-RECOVERY.md](./DISASTER-RECOVERY.md) were written from the CI workflow and Cloudflare's documentation. No command on either has been run. This drill runs them on staging, in the order a real day would need them, and records what happened.
- **Touches:** staging only. Nothing here changes production.
- **Written:** 2026-10-12. Not yet run.

The rule being practised (ROLLBACK.md §0): a release is called no-go early, inside a short window, and rolled back; after the window it stands and a problem is fixed forward with a ticketed change.

## Before you start

- A staging deploy from `main` is green, so staging is on a known version. Note its `version` from `https://stg.oursharedevents.com/health`.
- You are signed in to Cloudflare in your own terminal. Do not paste a token into a chat.
- Open a Linear ticket for the drill. Every step below is noted on it.

## Drill 1: call a no-go inside the window, and roll back

Goal: prove the early call is cheap, and time it.

1. Note the time. This is the start of the window.
2. Merge a harmless change to `main` through CI so staging deploys a new version. Note its `version` in `/health`.
3. Pretend the deploy is a no-go. Roll the Worker back using ROLLBACK.md §6, steps for staging (list the deployments, then roll back to the previous version).
4. Check with ROLLBACK.md §7 (staging block): `/health` names the previous version, `/events` answers 200, `/admin` opens in a browser.
5. Revert the change through CI (ROLLBACK.md §3), so `main` and staging agree again.

Pass when: the previous version is live in a few minutes and `main` matches staging after step 5.

## Drill 2: after the window, fix forward

Goal: practise the rule that a release stands once the window has closed.

1. Pick the version from Drill 1 step 2 as "released and past its window".
2. Introduce a visible defect on a branch, merge it through CI, and let staging deploy it.
3. Do **not** roll back. Open a ticket, write the evidence on it, fix the defect in a new change, merge it through CI.
4. Check staging is healthy and the ticket has the run id and SHA.

Pass when: the fix reaches staging through CI, with its own ticket, and no rollback was used.

## Drill 3: restore, and the erasure that must stay erased

Goal: time a database restore and prove an erased person stays erased.

Run DISASTER-RECOVERY.md §11 as written. Its steps and its table are the record for this drill.

Pass when: the registration returns after the restore, then is gone again after §7 part B, and the times are written in the §11 table.

## What to record

| Drill                    | Date        | Who | Time taken | What surprised you | Page text to change |
| ------------------------ | ----------- | --- | ---------- | ------------------ | ------------------- |
| 1 rollback in the window | not yet run |     |            |                    |                     |
| 2 fix forward after it   | not yet run |     |            |                    |                     |
| 3 restore and erasure    | not yet run |     |            |                    |                     |

When a drill shows that a step on either page is wrong or missing, fix the page in the same change set and note the ticket.

## Done

All three rows filled, and ROLLBACK.md and DISASTER-RECOVERY.md no longer say "Not yet practised". Until then, the production rollback procedure is a written plan and should be described that way.
