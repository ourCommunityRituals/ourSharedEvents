# D1 canonical-shape deploy gate

OSE-1347 extends the staging and production deploy gates so remote D1 must match
the canonical table and column shape before the Worker deploys.

If the gate fails:

1. Read the failing `::error::` line; it names the binding, environment, table,
   and missing or unexpected column.
2. Re-apply the migration that owns that table/column with Wrangler for the
   failing environment, for example:
   - `npx wrangler d1 migrations apply DB --env staging --remote`
   - `npx wrangler d1 migrations apply FORMS_DB --env staging --remote`
3. If the migration list says nothing remains but the column is still missing,
   inspect the failing table with `PRAGMA table_info(<table>)` and reconcile the
   D1 migration record before rerunning the deploy.

Do not bypass the gate. A missing column can otherwise surface later as a write
path 503 during T3/T4 staging smoke instead of failing at deploy time.
