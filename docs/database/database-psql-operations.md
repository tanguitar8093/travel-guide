# Direct PostgreSQL operations

Use this method only when live database access is required and authorized.
Credentials remain in the untracked `.env.local` under `SUPABASE_DB_URL`.
Do not copy the connection string into source, chat, logs, or this document.

## Current handoff — 2026-10-20

### NEW VERSION WRITTEN / NOT TESTED / NOT INSTALLED

The approved narrowed package preserves the exact supabase_admin public matrix
(PG17: 24 cells, 3 rows; absent platform rows also supported). It clears only
postgres client defaults, converges the inventoried existing app ACLs and adds
the private reorder RPC. Unknown/global/PUBLIC/inherited/grant-option/grantor/type
drift still blocks; no platform role access or temporary CREATE grant is added.

Capture v2 records database owner, raw/semantic database ACL, connection attributes,
effective database/schema rights and implicit pg_database_owner access, without
database names/connection identifiers. Restore reproduces that initial context
before comparisons. The actual postgres owns the database and has public CREATE;
the old bootstrap-owned rehearsal missed this. Only the equivalent NOSUPERUSER
operator may execute all three migrations and frozen exact recovery.

Recovery changes only captured postgres defaults/app ACLs and drops the guarded
new RPC. It guards platform raw defaults, database authority, role graph, original
function source/config, schema/column ACLs, RPC source/owner/config/ACL and version.
Complete migration, rollback and tooling hashes must match; old captures lacking
v2 metadata fail closed and require separately approved fresh capture, not guessing.

No commands, checks, tests, Git, connections, writes, backup/rehearsal or installation
ran in this implementation round. Old 51-test and synthetic-platform results are
historical only. Next obtain focused offline validation approval; fresh read-only
capture/backup, isolated equivalent-operator rehearsal and exact installation each
need separate approval. Platform support is not a prerequisite for this narrowed
scope; future platform-created public objects still need explicit ACL review.

The next work is [database version convergence](database-version-convergence.md),
not reinstalling collaboration. Its independent handoff prompt, exact drift
objects, approval gates, estimates and acceptance criteria are recorded there.

Read-only comparison confirmed the current shared/sync/cancellation/delete
functions match working-tree migrations, but baseline grants, some columns and
constraints, legacy objects and the missing reorder RPC still differ.
There is no live `supabase_migrations` schema. Do not fabricate an applied
history or replay the baseline to make versions appear equal.

This documentation update performs no live access or installation.
The earlier catalog inspection read no business/account rows and checked no
Git or frontend deployment revision. Old installation row counts/empty-table
observations below are historical, not current business inventory.

### A/B source implementation — not validated or installed

Three incremental migrations now exist in the working tree:
[postgres default convergence](../../supabase/migrations/20261020005000_public_default_privilege_convergence.sql),
[permission convergence](../../supabase/migrations/20261020010000_privilege_convergence.sql)
and [atomic private reorder](../../supabase/migrations/20261020020000_atomic_itinerary_reorder.sql).
Their focused isolated tests are written but have not been run. No new live
connection, backup, restore rehearsal, installation or deployment occurred.

The [catalog-only inventory](../../supabase/inspection/privilege_convergence.sql)
requires separate live-read approval. Capture its complete output privately,
including raw ACLs, grantors, memberships and creator/global/schema default ACLs.
The permission migration intentionally blocks unapproved defaults or unexpected
effective/inherited grants. The preceding creator-specific patch now clears only
approved postgres defaults, retaining the exact allowlisted platform matrix.
Do not remove that gate just to make installation pass.

The permission rollback is a blocked recovery template, not an executable exact
inverse. Prepare and rehearse object/grantor-specific recovery from the fresh
preinstall capture. The reorder rollback only shuts down RPC access; it does
not reverse completed sorts or restore a replaced function definition.
All previous backup/rehearsal/exact-install approval requirements still apply.

## SQL file classification

| Files | Use and limits |
| --- | --- |
| `supabase/migrations/*.sql` | Reviewed incremental source; reconcile actual live definitions before exact authorized apply |
| `docs/supabase-schema-from-indexeddb.sql`, `supabase-basic-role-rls.sql`, `supabase-owner-isolation.sql`, `supabase-phase2-safe-import.sql` | Historical bootstrap/phase sources, not a replay sequence for current sync/shared/maps DB; newer migrations supersede definitions |
| `docs/supabase-role-ops.sql` | Manual role operations; may inspect personal accounts or change roles, so requires explicit scope/approval |
| `docs/supabase-isolation-diagnose.sql` | Account-specific diagnostic that reads emails, owners and counts; not a catalog-only query or general-purpose structural audit |
| `docs/supabase-rls-smoke-test.sql` | Legacy editor-UID collaboration test incompatible with current private isolation/shared-workspace contract; writes fixed fixtures, do not run on live |

These historical SQL files were deliberately not edited during documentation
refresh. Use existing owner/shared/sync isolated tests as current behavior
evidence; passing a test does not authorize its live equivalent.

## Install the client (Ubuntu)

Run these commands in the remote workspace terminal:

```bash
sudo apt-get update
sudo apt-get install -y postgresql-client
psql --version
```

If sudo requires a password, the user must perform installation. Do not attempt
to bypass permissions. A direct Supabase endpoint may require IPv6; if the
workspace lacks IPv6 routing, obtain a Session pooler connection from the
Supabase dashboard and update `.env.local` privately. Do not invent a pooler
hostname or reuse a direct-endpoint username with a different endpoint.

## Connect without exposing credentials

Node.js must support `--env-file` (available in the current Node.js 20 runtime).
The [psql wrapper](../scripts/db-psql.mjs) loads no files itself: Node loads the
environment, and the wrapper passes parsed connection fields via PostgreSQL
environment variables rather than command-line credentials.

Authorized read-only connection check:

```bash
node --env-file=.env.local scripts/db-psql.mjs \
  -c 'BEGIN READ ONLY; SELECT 1 AS connection_ok; COMMIT;'
```

Do not run `echo` on the URL, `psql \conninfo`, shell tracing, or queries that
print credentials. Do not use `source .env.local`: the environment file is data,
not executable shell code. An environment-file change requires a new invocation.

## Apply a migration

1. Obtain authorization for the exact live change. Connection authorization
   alone does not authorize arbitrary writes.
2. Inspect relevant live columns, constraints and function definitions, without
   exposing account data. Preserve replaced definitions for recovery; if the
   live implementation differs from the expected source, reconcile it first.
3. Apply only the new incremental migration. Never replay the repository
   baseline or rewrite migration history to make it appear applied.
4. Use SQL transactions and bounded lock/statement timeouts. The wrapper sets
   `ON_ERROR_STOP=1`, disables startup files, and disables password prompts.
5. Request separate test approval under the project's development workflow.
   A committed migration is not proof of application, RLS, or cross-device tests.

Example for the distance migration (already applied; do not run it again):

```bash
node --env-file=.env.local scripts/db-psql.mjs \
  -f supabase/migrations/20261018220000_itinerary_travel_distance.sql
```

## Distance extension record — 2026-10-18

- User installed psql 16.15. Initial direct connection failed because the
  workspace had no IPv6 route; after the user updated the endpoint, a read-only
  connection succeeded against PostgreSQL 17.11.
- Reconciled the existing sync record, sync push and backup replacement
  function bodies with repository SQL. The optional reorder RPC was absent;
  the migration preserves its absence and updates it only where it exists.
- The [incremental migration](../supabase/migrations/20261018220000_itinerary_travel_distance.sql)
  committed successfully. It adds nullable `itinerary_items.travel_distance_meters`
  in meters, bounded to JavaScript's non-negative safe integers, and updates
  sync/backup serialization. Existing rows are not backfilled or replaced.
- The itinerary UI requests distance and duration in a single Routes call.
  Distances below 1 km display in meters, otherwise in kilometers with up to
  one decimal. Old estimates without a distance remain valid until recalculated.
- Local records use optional `travelDistanceMeters`; no Dexie schema version
  increase is needed for a non-indexed optional property. Hybrid mutations
  include it in the existing outbox. Route changes invalidate both estimates.
- Prior function definitions were saved outside the repository in session
  storage before applying. Recovery requires a reviewed migration using those
  definitions, not baseline replay. Do not drop the new column once distances
  have been saved without considering data loss and pending sync tasks.
- Authorized focused validation completed: 5 test files, 40 tests passed
  (Google route estimates, itinerary service, local sync store, backup
  validation, and PGlite automatic-sync integration). Node.js 20 used
  `NODE_OPTIONS=--experimental-websocket`; no dependencies were added.
- The first run exposed a test completion-wait race: an empty outbox did not
  mean the final pull had completed. The integration test now also waits for
  `lastSyncedAt` to advance before beginning its next debounce assertion.
  Production scheduling was not changed to accommodate that test.
- Build, lint, browser validation and live business-data/RLS smoke tests were
  not run for this extension. Passing isolated SQL tests does not establish
  real Google Routes results or live cross-device correctness.

## Route-map persistence record — 2026-10-19

- Reconciled the incremental SQL with the existing live sync and backup
  functions before applying. The migration adds `route_maps` and
  `route_map_places`, a dedicated owner-assignment trigger function, route-map
  sync serialization, backup validation/replacement support, and grants/RLS for
  owner/admin access. It does not replay the baseline, distance, or prior sync
  migrations.
- Applied the [incremental migration](../supabase/migrations/20261019010000_route_maps.sql)
  successfully with:

  ```bash
  node --env-file=.env.local scripts/db-psql.mjs \
    -f supabase/migrations/20261019010000_route_maps.sql
  ```

- Post-apply read-only verification confirmed both new tables exist, both are
  initially empty, and the previously checked business-table row counts remain
  `regions=2`, `places=22`, `labels=19`, `trips=1`, `itinerary_items=17`.
  Read-only catalog checks also confirmed the updated sync/backup functions are
  present in `public`/`sync_private`.
- Authorized focused validation completed before live apply:
  `npm run build` passed, and 13 focused Vitest files (106 tests) passed using
  `NODE_OPTIONS=--experimental-websocket`. Coverage included local repositories,
  hybrid outbox/sync behavior, backup validation, PGlite sync SQL, route-map
  cloud migration tests, and automatic-sync integration.
- During validation we fixed two SQL edge cases in the migration source before
  applying:
  1. the route-map owner trigger now branches by table before touching
     table-specific columns, avoiding `NEW.trip_id` access on route-map-place
     writes;
  2. backup payload validation no longer reuses the PL/pgSQL `item` variable
     name in aggregate subqueries, avoiding ambiguous-column failures.
- This phase still does **not** include the route-calculator UI saving/restoring
  data, user-facing trip-delete warnings for stored route maps, or any live
  business-data write smoke test beyond the migration transaction itself.
  Cross-device/manual browser validation was not run here.

This describes the database-installation phase only. The current route-calculator
service/UI subsequently wires saved maps and extra markers through the facade,
and trip deletion includes the linked-map warning/cascade. Those features are
not still missing; their current browser/cross-device behavior is not established
by this old installation record.

## Cancel-sharing installation record — 2026-10-19

- The user declined frontend tests/build/browser validation but explicitly
  authorized a fresh private backup, isolated restore rehearsal and installation
  of only `20261019090000_cancel_trip_sharing.sql` after that rehearsal passed.
- Read-only reconciliation confirmed the shared API and required itinerary
  columns existed and that the new cancellation API/archive did not.
- A PostgreSQL 17 application-scope backup restored successfully in a
  network-isolated container. All 46 existing table fingerprints matched.
  The incremental migration and shutdown rollback preserved the original rows.
- Rolled-back synthetic operations in the isolated restore verified
  owner-only/stale-version checks, latest-content copy-back, non-overwriting
  private-place mapping, idempotent retry, restored private editing, revoked
  reads/uploads, rejected old invitations and fresh activation.
- The new migration committed live under the shared transaction advisory lock.
  All 46 pre-existing tables matched the verified backup before and after the
  installation. No old migrations were replayed and no existing trip was
  automatically cancelled.
- Post-installation read-only checks confirmed authenticated execute permission,
  anonymous denial, `SECURITY DEFINER` with an empty `search_path`, archive RLS
  and no authenticated archive SELECT permission. The private cancellation
  archive was empty. No live business-data write smoke test was performed.
- The shutdown rollback revokes only the cancellation RPC and preserves
  completed copy-backs and private recovery records; it does not restore
  sharing permissions or an old itinerary.

## Shared-trip deletion correction — 2026-10-20

- Only `20261020000000_shared_trip_delete_order.sql` was separately authorized,
  reconciled, backed up, rehearsed and installed; prior migrations were not replayed.
- The private backup restored in network-isolated PostgreSQL 17 and all 47
  scoped table fingerprints matched. Installation preserved those fingerprints.
- The correction changes trip-delete execution order inside `app_sync_push`,
  retaining original permission/version checks, operation IDs and receipts.
  Shared legacy guards were not disabled.
- Four approved focused files / 49 tests passed. Live postchecks were read-only;
  no real trip was deleted as a deployment smoke test.
- Full record and recovery limits are in
  [trip collaboration rollout](trip-collaboration-rollout.md).

## Subsequent client corrections and catalog comparison

Shared-conflict isolation and cancellation/revocation/retry convergence are
client changes, not additional SQL installations. Their focused test results
(96 tests; then 90 tests plus type checking) are recorded in [testing](testing.md).
An earlier user-reported manual success is followed by a newer failed E2E
attachment, so no blanket current E2E/cleanup success is claimed.

The 2026-10-20 catalog comparison confirms the installed shared core matches
source, but is not proof that the latest frontend was committed or deployed.
Any next live access, fresh backup, rehearsal, migration, tests or deployment
requires its own explicit authorization; old credentials/approval are not a
standing permission to continue in a new conversation.
