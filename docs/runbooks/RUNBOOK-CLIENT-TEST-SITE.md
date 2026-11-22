# Runbook: the client test site (test.oursharedevents.com)

OSE-2211. Owner request, 2026-11-22.

## What it is

A private copy of staging for outside testers. It changes once a week, so the app
does not move under someone in the middle of testing.

| Site             | Address                  | Changes when                                                                                                          | Who sees it                           |
| ---------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Staging          | stg.oursharedevents.com  | Every merge to `main`                                                                                                 | Anyone (organizer pages need sign-in) |
| Client test site | test.oursharedevents.com | Mondays 11:00 UTC (5 AM Central in winter, 6 AM in summer), only from a commit whose staging chain T1 to T4 was green | Only people on its Access list        |
| Production       | oursharedevents.com      | Owner only; closed                                                                                                    | Nobody yet                            |

- Its own Worker (`oursharedevents-test`), its own two databases, its own KV and
  uploads bucket. Testers' data never mixes with CI's and carries over from week
  to week. Nothing resets it.
- The street map reads the same tile bucket as staging. Nothing extra to load.
- It runs as a staging-class Worker (`WORKER_ENV = "staging"`) with none of
  staging's CI shortcuts: no key fallback, no internal header, no "see every
  brand". Everyone signs in through Cloudflare Access.
- Config: `workers/oursharedevents/wrangler.client-test.toml` (a file of its own,
  so the staging/production parity checks are untouched).
- Workflows: `.github/workflows/client-test-setup.yml` (once) and
  `.github/workflows/client-test-site.yml` (weekly and by hand).
- Cost: one more Worker and two small databases on the current Workers plan.
  Expected under $1 a month.

## Owner setup (once, about 20 minutes)

Do these in order. Each line is one action.

### Step 1. Add the address (Cloudflare DNS)

1. Open dash.cloudflare.com and click the **oursharedevents.com** site.
2. Click **DNS**, then **Records**.
3. Click **Add record**.
4. Set **Type** to `AAAA`.
5. Set **Name** to `test`.
6. Set **IPv6 address** to `100::`.
7. Leave **Proxy status** on (orange cloud).
8. Click **Save**.

### Step 2. Make the whole site private (Cloudflare Zero Trust)

1. In the Cloudflare dashboard, click **Zero Trust**.
2. Click **Access**, then **Applications**.
3. Click **Add an application**.
4. Click **Self-hosted**.
5. Set **Application name** to `OSE client test site`.
6. Under **Public hostname**, set the subdomain to `test` and the domain to `oursharedevents.com`. Leave the path empty, so the whole site is covered.
7. Click **Next** (or **Add policy**).
8. Create a policy named `Testers`, **Action** `Allow`.
9. Under **Include**, pick **Emails** and type your own email.
10. Add each tester's email the same way (you can add more later).
11. Save the policy.
12. Create a second policy named `CI check`, **Action** `Service Auth`.
13. Under **Include**, pick **Service Token** and choose `ose-staging-t4-admin` (the token GitHub already uses for staging).
14. Save the policy.
15. On the login methods screen, keep **One-time PIN** turned on.
16. Click **Save** (or **Add application**).
17. Open the new application again and copy its **Application Audience (AUD) Tag**. Paste it in the project thread. It is not a secret; it goes in the config so the Worker checks each sign-in belongs to this app.

### Step 3. Create the databases and keys (GitHub)

1. Open github.com/ourCommunityRituals/ourSharedEvents/actions.
2. Click **Client test site setup** in the left list.
3. Click **Run workflow**.
4. Type `TEST` in the confirm box.
5. Click the green **Run workflow** button.
6. Wait for the green check (about 2 minutes). Its summary lists what it made.

It makes the secret keys inside the job. Nobody sees them, and running it again
never replaces one.

### Step 4. Put the app on the site (GitHub)

1. In the Actions tab, click **Client test site** in the left list.
2. Click **Run workflow**.
3. Leave **action** on `update`.
4. Click the green **Run workflow** button.
5. Wait for the green check (about 5 minutes).

The run fails on purpose if the site answers a visitor who has not signed in.
That means step 2 is not covering the whole site.

### Step 5. Let testers create events

Testers sign in with the one-time code Cloudflare emails them. To create events
they also need a practice brand, through the `STAGING_TESTERS` secret (PR #1521,
"staging testers"). Once that PR is merged, the test site gets the same secret.
That step is written up in that PR's runbook.

## Everyday use

All of these are in the Actions tab under **Client test site**, **Run workflow**.

| You want to                                      | Choose                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Update now instead of waiting for Monday         | action `update`                                                                     |
| Update to one specific commit                    | action `update`, paste the commit in `sha` (it must still have a green staging run) |
| Go back to last week's version                   | action `rollback` (leave `version_id` empty)                                        |
| See what it runs, and what an update would bring | action `look`                                                                       |

To **pause** the Monday update (for example during a tester's session):

1. Open the repository's **Settings**.
2. Click **Secrets and variables**, then **Actions**.
3. Click the **Variables** tab.
4. Click **New repository variable**.
5. Set **Name** to `CLIENT_TEST_HOLD` and **Value** to `true`.
6. Click **Add variable**.

To resume, edit it to `false` or delete it. A hand-run update still works while it is on hold.

## Notes

- **Rollback is code only.** The databases keep testers' data and stay migrated.
  Migrations are written to work with the code before them
  (`scripts/ci/release-rollbackability.mjs`), so a one-week rollback is safe.
- **A red staging week** means the site stays where it is; the Monday run says
  so and deploys nothing.
- **The archive key** (`MAP_TILES_ARCHIVE`) and the street-map and voting switches
  follow staging. The test `tests/unit/ci/client-test-site.test.js` fails if they
  differ, so a PR that changes staging's changes this file too.
- **Not production.** Nothing here touches production's Worker, databases or
  settings, and production's posture is unchanged.
