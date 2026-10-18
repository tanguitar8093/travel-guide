# Direct PostgreSQL operations

Use this method only when live database access is required and authorized.
Credentials remain in the untracked `.env.local` under `SUPABASE_DB_URL`.
Do not copy the connection string into source, chat, logs, or this document.

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
