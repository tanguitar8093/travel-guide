# Trip collaboration: staged rollout and recovery

## Status and scope

The original collaboration **preview** provides invitation/member management
and a read-only projection. A separately gated shared-itinerary editing slice
now supports item editing and hybrid queued drafts after explicit activation.
It does not provide shared saved route-map editing, offline cold login or
instant multi-user push updates.

### Cancellation, revocation and retry convergence

Source and this document were compared for cancellation copy-back, access
revocation, retained drafts, old invitations, account isolation and receipt
replay. The existing SQL already implements atomic latest-content copy-back
and checks current write rights before replaying a shared-save receipt. No
SQL or live database change is part of this correction.

Implemented client corrections. The seven separately authorized focused test
files passed (90 tests), and TypeScript project checking (`tsc -b`) passed.
The initial type check found an overly narrow inferred UUID parameter in a
test helper; its explicit string type was corrected and all 29 shared SQL
integration tests passed again. Build, lint, E2E and live database validation
were not run for this correction.

- Cancellation now makes at most one automatic receipt retry after a transport
  failure or code-less network error. It uses the same operation ID, trip and
  base version, and must still be the original signed-in user. Definite SQL,
  permission and missing-migration errors are not retried automatically.
  If confirmation still fails, the UI explicitly says cancellation may already
  have completed and requires reload/sync rather than implying failure or
  automatically enabling sharing again. This is bounded in-call confirmation,
  not a persistent offline cancellation queue.
- Hybrid cancellation checks for pending operations both before and after
  fetching the shared version. A write queued during that read prevents the
  cancellation request. A confirmed cloud cancellation followed by a failed
  local download retains the existing distinct completed-cloud/unfinished-local
  error.
- After retrying an eligible frozen request, sync downloads shared snapshots
  before personal events. A personal download conflict therefore cannot hide
  a revocation or downgrade during that manual sync. Revoked readable cache is
  cleared, viewer cache becomes read-only, and pending drafts remain separate.
  Personal conflicts still pause automatic sync; the user can explicitly
  reload/sync shared trips to obtain current access while resolving them.
- Shared conflict resolution captures the original hybrid account before
  fetching the latest snapshot and rechecks it before applying a choice. It
  cannot apply an old account's response to a newly selected workspace, and
  standalone/cloud mode cannot invoke local-draft resolution.

Added isolated regressions cover identical cancellation retry payloads,
bounded retries and account changes, pending writes during cancellation,
completed-cloud/failed-local reporting, exit/removal/cancellation with private
conflicts, retained drafts, viewer downgrades after a lost successful response,
explicit recovery after regrant, and old invitation/receipt replay. An old
cancellation receipt acknowledges only that past operation; it cannot cancel
a freshly activated shared generation.

The earlier local/cloud/hybrid section describes the original preview slice.
Its no-cache/future-coediting statements do not describe the subsequently
implemented shared-editing slice below. The original-renderer/cancellation
section remains the copy-back contract; this section records its new client
retry and access-refresh corrections. None of these checks establish live
deployment/version consistency, browser behavior or cross-device timing.

### Shared-conflict isolation correction

Implemented in source. The seven separately authorized focused test files
passed (96 tests). TypeScript checking, build, lint, E2E and live database
validation were not run for this correction. This is a client-side hybrid
synchronization correction: no migration, live database write or authorization
change is needed.

- A confirmed shared-trip version/access conflict pauses that trip's entire
  queued chain, including dependent drafts. Unrelated personal operations and
  other healthy shared trips remain eligible in their original relative order.
  Both automatic mutation scheduling and foreground polling remain active.
- Shared drafts and their operation IDs/base versions are preserved. Revoked
  access still clears readable shared cache and forbids replaying those drafts.
  Shared conflicts are shown separately and link to the itinerary recovery UI.
- Personal conflicts retain the existing global pause and data-management
  recovery. Unknown failures, network errors and invalid responses are not
  treated as safely isolated shared conflicts.
- An eligible frozen request is retried before downloading events, even when
  it is behind a blocked shared trip. Receipts, frozen payloads and account
  guards remain unchanged; a lost successful response must not become a false
  personal conflict or duplicate write.
- Remaining shared conflicts still count as unfinished synchronization. The
  last complete-sync timestamp is not advanced while drafts remain queued.
  Standalone local mode and direct cloud mode keep their existing data paths.

Passing regression cases cover downloaded and upload-time shared conflicts,
ordered private updates, an independent shared trip, upload-time revocation,
lost private/shared responses, automatic scheduling and conflict-status links.
These cases use isolated PGlite/IndexedDB and UI mocks; they do not validate
live Auth, browser concurrency or cross-device delivery.

### Shared-trip deletion correction — 2026-10-20

The incremental `20261020000000_shared_trip_delete_order.sql` was separately
authorized, rehearsed and applied to live Supabase. The four authorized
focused test files passed (49 tests). Build, lint, browser checks and deletion
tests against live business data were not run for this correction.

- Hybrid trip deletion queues child deletions before the trip deletion. The
  original sync RPC executes that order, so the active shared itinerary guard
  rejects deletion of retained items and rolls back the cloud transaction.
- The correction changes only execution order inside `app_sync_push`: trip
  deletions run first, allowing the existing foreign-key cascades and
  versioned revocation delivery to handle dependent data. Other changes retain
  their relative order. Ownership/version checks still run before any writes.
- Request bodies, operation IDs and stored receipts are unchanged. Already
  frozen failed deletion tasks can retry without rewriting uncertain requests;
  a lost successful response can still be acknowledged through its receipt.
- Standalone local deletion and direct cloud deletion retain their existing
  paths. Private places, regions and unrelated trips/maps are not deleted.
  Revoked collaborators cannot upload; pending drafts remain exportable.
- The migration takes the existing transaction lock and refuses an unexpected
  sync execution-loop shape rather than blindly replacing that loop.
  It adds no tables, changes no grants and does not replay old migrations.
- Live reconciliation confirmed that the sync function and shared-item guard
  matched the repository. The original function and a fresh application/auth
  backup were preserved privately for recovery. Do not work around this bug by
  disabling the shared-item guard or deleting users' outbox tasks.

The regression reproduces the original cloud rollback with the previous
function, then applies the new migration in PGlite and retries the same frozen
task. It also loses a successful response deliberately and confirms that retry
uses the same operation/payload without duplicate execution. Coverage includes
linked map/item deletion, unaffected private places/regions and unrelated
trips/maps, revoked editor reads/uploads, retained offline drafts, stale-version
and cross-owner rejection, direct cloud deletion, local outbox-failure rollback,
and existing automatic personal synchronization. HTTP/Auth and browser locks
remain test boundaries.

The private backup was restored into network-isolated PostgreSQL 17, matching
all 47 table fingerprints across the public, sync, collaboration and auth
schemas. The exact guarded installation and synthetic deletion, same-request
retry and collaborator-revocation rehearsal passed there. Synthetic business
operations were rolled back, and the original table fingerprints still matched.
The first restore attempt stopped on the empty default public schema already
existing; the isolated restore setup was corrected before the successful
rehearsal. No live migration was attempted until that rehearsal passed.

Only this incremental correction was then committed live. Installation checked
the reconciled function and verified backup fingerprints before replacing the
function, and verified all 47 table fingerprints remained unchanged within the
same transaction. Read-only postchecks confirmed the exact corrected body and
unchanged owner, grants, security settings and shared-item guard. No real trip
was deleted as a deployment test; browser/cross-device behavior remains outside
this validation.

The first run exposed two fixtures passing raw SQL snapshots into the hybrid
draft writer instead of the normalized cache snapshots used by the UI. The
fixtures now use the cache; production stale-draft protection was not weakened.

### Current correction: original itinerary UI and cancellation

The UI correction is implemented in source. The cancellation migration has
been separately authorized, rehearsed and installed. Frontend tests, build
and browser checks were declined for this correction and were not run.
The earlier 90-test/build results below do not cover the new frontend code.

- Personal and activated shared trips now use the original `ItineraryModule`
  renderer and normal trip selector. The owner trip is deduplicated, not
  hidden. The separate shared card renderer and scope selector are removed.
  Dates, ordering, item forms, focus mode, original map and responsive layout
  remain in that renderer.
- `CollaborativeItineraryService` adapts the existing controller operations:
  private operations retain the original persistence facade; activated item
  operations use the shared repository and existing hybrid outbox/scheduler.
  A form or reorder draft keeps its opening snapshot for version checking.
  Background refresh does not reset an open form or date selection. Shared
  conflict preview/export and per-trip resolution remain available separately
  from the itinerary renderer.
- Viewers cannot use item-write controls, editors cannot edit/delete trip
  metadata, and the server remains the authority. Private place notes/labels
  are shown only from the current user's own collection, never shared.
  The existing map mount, initial fit and explicit default-display behavior
  are unchanged; a shared trip uses the same region/map service.
- The new, separately approved installation is
  `20261019090000_cancel_trip_sharing.sql`; do not replay prior migrations.
  Its authenticated owner/admin-only RPC checks the expected shared version
  under the existing global transaction lock. It archives the workspace,
  original items, membership and invitation records in a private,
  non-client-readable cancellation receipt before atomic copy-back.
- Cancellation keeps the latest shared itinerary as normal owner-only rows,
  not the activation-time baseline. Unchanged owner places retain IDs, private
  notes and labels. New or changed shared places are materialized as separate
  owner places rather than overwriting unrelated private definitions; an
  owner's original notes/labels are retained when applicable. Item IDs are
  retained unless another trip already owns the ID.
- The same transaction removes the active workspace, members and invitations,
  clears the editor list, returns the trip to private mode and publishes
  versioned revocations. Invitation history remains in the private archive;
  an old accepted invitation cannot restore access. Re-enabling starts from
  the current private itinerary and a new shared revision.
- Standalone local mode has no sharing to cancel. Cloud cancellation is an
  explicit online action. Hybrid refuses cancellation while any local tasks
  are pending, then downloads the private records and revocation through the
  existing sync engine. If that download fails after cloud commit, the UI
  explicitly reports that cancellation completed but local sync did not.
  Other users' pending drafts remain exportable conflicts; revoked users
  cannot upload or requeue them.
- The cancellation rollback revokes only the new RPC. It does not delete
  receipts, restore invitations, undo a completed cancellation or discard
  current trip data. A data restore requires a separately reviewed operation.

The fresh private backup and isolated PostgreSQL 17 restore matched all 46
existing table fingerprints. The new migration and its API-shutdown rollback
also preserved those rows. In the isolated restored database, a synthetic
trip exercised editor edits, owner-only and stale-version denial, atomic
cancellation, changed-place mapping without private-place overwrite, preserved
private notes, idempotent cancellation retry, restored private writes,
revoked reads/uploads, old-invitation rejection and fresh activation using the
latest private content. These operations were rolled back and never performed
against live business data.

Only the new migration was then committed live. Transaction fingerprint guards
verified all 46 pre-existing tables before/after installation. Subsequent
read-only catalog checks confirmed authenticated RPC execute permission,
anonymous denial, an empty safe function search path, archive RLS and no client
archive SELECT permission. The archive contained zero cancellation records:
installation did not cancel any user's trip.

Original-renderer frontend regressions remain unrun, including owner visibility
and shared operations through the original controller, frozen form versions,
viewer denial and map inputs. The private hybrid download/revoked-draft SQL
and storage regressions were subsequently run in the deletion correction above.
Frontend build and authenticated two-browser acceptance remain unverified;
isolated PostgreSQL results do not establish frontend or cross-device behavior.

The initial implementation did not connect to or change live Supabase.
Subsequently authorized read-only inspection and a private backup/isolated
restore rehearsal and separately approved live migration are recorded below.
No application deployment has been performed by this work. Passing isolated tests is not proof of live
permissions or cross-device behavior.

The source baseline before this work is commit `b7fd6a3` (`feat: debug mode`).
It already contains the RWD changes and administrator debug functionality.
Do not revert those as part of collaboration recovery.

## Compatibility and data preservation

- Existing business tables and IDs remain in place. Existing `place_id`
  references are not removed or replaced.
- Existing owner-only business-table RLS and same-owner foreign keys remain
  intact. The new RPC returns only the explicitly authorized trip projection;
  it does not grant a collaborator access to the owner's whole collection.
- Private place notes and label associations are not part of shared place
  projections. Itinerary notes are trip content and may be shared.
- New tables and nullable audit/reference columns are additive. Do not drop
  them after they contain invitations or other collaboration data.
- The existing personal backup format is not a complete database backup and
  is not a backup of collaboration authorization metadata.
- Preserve the existing backup guard for shared trips. Never mark all shared
  trips private merely to make full-account replacement work.

## Local, cloud and hybrid modes

- Standalone IndexedDB data is never implicitly uploaded. The collaboration
  service rejects pure local mode with a visible explanation.
- Cloud mode uses the authenticated collaboration RPC.
- Hybrid mode previews the cloud's latest authorized trip and manages online
  ACL operations; an unsynced local trip is not silently uploaded or copied.
  Personal content writes still use the existing facade/outbox/automatic-sync
  mechanism.
- This preview does not cache shared trip contents or invitations in
  IndexedDB. Closing the preview drops the React state. There is no promise
  of offline access, instant push updates, or deletion of information another
  person has already viewed.
- Opening the preview or reloading it checks access again. Membership removal
  blocks subsequent RPC access. Already displayed information is not
  retroactively erased from another device while it remains offline.
- The future co-editing release must extend the sync protocol with shared
  scope, ACL-version checking, grant/revoke delivery, conflicts and
  account-isolated local caches. Enabling ordinary private outbox uploads
  against another owner's records is not an acceptable substitute.

## Feature flag

`VITE_TRIP_COLLABORATION_ENABLED` must equal the literal string `true` to render
the itinerary's collaboration preview entry and allow client RPC calls.
Unset or `false` leaves current application behavior unchanged.

It is a Vite build-time setting. Update the deployment configuration and
rebuild/redeploy to change it. A feature flag is not authorization; the RPC
must independently check identity, application role and trip membership.

### Shared editing implementation and authorized installation

`VITE_TRIP_SHARED_EDITING_ENABLED=true` is a separate, default-off switch.
It requires the collaboration flag and the separately approved
`20261019080000_shared_trip_editing.sql` and
`20261019081000_shared_trip_maintenance.sql`. Do not enable it against a database
that has only the invitation migrations. The existing personal sync endpoints
and seven personal sync entities remain unchanged.

The user approved explicit per-trip activation with a separate shared source:

- The owner (or an administrator) enables editing online. Only that trip's
  scheduled places and itinerary items are copied once into
  `trip_shared_workspaces`; private place notes, labels and unrelated
  collections are not copied. Itinerary notes are shared trip content.
- The original private itinerary rows remain as the activation-time recovery
  baseline, not a second writable source. A server trigger rejects later
  private scheduling writes for enabled trips. No-op updates and travel-estimate
  maintenance remain allowed, so editing the owner's personal place does not
  fail merely because it is referenced by the retained baseline.
  Repeated activation does not reset
  shared content. Shared writes never rewrite the original item/place IDs.
- The normal itinerary selector opens the same authorized shared document for
  both users using the original itinerary UI. Editors can add a selected personal place (only public map/name
  fields), edit items, move dates, remove items, reorder and estimate travel.
  Viewers cannot mutate. Shared trip metadata/deletion and shared saved route
  maps are not provided by this slice. Owner route-calculator markers read
  the current shared itinerary rather than the retained original rows.
- Cloud writes check the whole document revision and authorization inside the
  same advisory-locked transaction. Concurrent edits produce an explicit
  conflict, not last-writer-wins. Account/operation receipts make retries
  idempotent; rights are checked before returning a receipt.
- Hybrid uses the account/project-specific IndexedDB `sharedItineraries`
  store (version 9). A shared cache write and its `outbox` task commit in the
  same transaction. Shared tasks use a separate typed envelope, not personal
  entity changes, and run in the existing manual/automatic sync scheduler and
  cross-tab lock. Personal RPC payloads and cursors are unchanged.
- The shared server sends complete authorized snapshots and versioned
  revocations. Revocation removes the readable cached document even if an
  unsent draft exists. The draft remains in the outbox for explicit export or
  discard; this cannot erase information the user already viewed or copied.
  Server authorization blocks uploads while offline permission checks cannot.
- Conflicts are resolved per shared trip, after preview/export and a fresh
  cloud-version check. Adopting cloud discards only that trip's shared tasks;
  keeping local queues a new version-checked operation. Revoked/viewer users
  cannot requeue their drafts. Personal conflict resolution retains shared
  tasks and does not discard them.
- The shared synchronization controls can export its snapshot and pending tasks as a
  JSON draft. This is not a portable backup import format. Existing personal
  JSON backup/export still describes personal data, including the retained
  original itinerary, not current shared contents or authorization metadata.
  Shared full database recovery must include the workspace, deliveries and
  receipts.

The user separately authorized the build, targeted validation, fresh backups,
isolated rehearsals, incremental live installation and the local feature
switch. The production build passed with the shared feature enabled.
Eight targeted files / 90 tests passed, including real PGlite shared writes and
Dexie/engine integration plus the personal synchronization regressions. The
personal regression baseline keeps the shared feature switch off; shared
integration fixtures explicitly inject the shared SQL adapter. Route-marker
regressions also exercise the feature-enabled shared source and preserve shared
place names rather than using the retained private schedule. These are not
browser-authenticated two-account acceptance tests.

Both incremental migrations committed after isolated PostgreSQL 17 rehearsals.
Transaction fingerprint guards verified all 43 pre-existing tables around the
shared-scope installation, and all 46 scoped tables around the maintenance
guard installation. No existing row values or IDs changed during either
migration. The second backup includes the newly installed shared tables as well
as `public`, `sync_private`, `auth` and `collaboration_private`. The maintenance
guard also rejects oversized initial documents before activation, rather than
leaving a trip activated with an unreadable client payload.

Read-only live inspection confirmed authenticated shared snapshot access,
anonymous denial, no direct authenticated table SELECT, and the original sync
snapshot still working. PostgREST recognizes the shared RPC and rejects
anonymous requests with HTTP 401 / SQLSTATE 42501. The local itinerary URL
responded HTTP 200 and served the enabled feature flag. No application
deployment to a hosting provider was performed.

No production trip was activated or shared test content written by this work;
the live shared workspace count was zero at verification. The owner must use
**Collaboration management -> Enable shared editing**. After acceptance, users
choose the shared trip in the itinerary scope selector and can edit if their
role allows it. Initial hybrid recipients may need **Reload/sync shared trips**.

Disabling the switch alone does not undo
activation. The shared rollback only revokes the shared RPC; it preserves
shared content and the legacy-write guard. Reverting to the old private
baseline can omit subsequent legitimate shared edits and requires an explicit
recovery decision after exporting current shared data.

Do not enable the flag in production before separately approving and applying
the incremental SQL and validating it in staging.

## Before any live migration

1. Obtain separate approval for the exact migration and target environment.
   Do not replay the baseline migration.
2. Pause deployments and business writes during backup/reconciliation.
3. Verify an available Supabase backup/PITR recovery point, including the
   plan's actual capabilities and retention. If taking a logical PostgreSQL
   backup instead, include the required application/sync/identity dependencies
   and validate privileges and server/tool compatibility first.
4. Store database backups in private, access-controlled storage outside git.
   Backups may contain personal data and authentication information. Do not
   include them in chat artifacts, commits or public logs.
5. Perform an isolated restore rehearsal. Verify row counts, original record
   IDs, foreign keys, RLS/functions, identity references and pending sync
   compatibility. A successful export alone does not establish recoverability.
6. Reconcile the live catalog against the migration's expected baseline and
   save any differing function/policy definitions privately for recovery.
7. Record pre-migration counts and a consistent integrity fingerprint using
   the approved operational process. A count alone cannot detect changed
   values.
8. Apply only the new migration, with transactions and bounded timeouts.
   Use the existing private-environment psql wrapper, not connection strings
   in commands. See [database operations](./database-psql-operations.md).
9. Verify unchanged old data, owner CRUD, anonymous/basic denial, invitation
   acceptance, member access, revocation and backup guards in staging before
   enabling the application flag.

If a verified backup/restore path is unavailable, do not approve a live rollout.

## Application recovery

1. Disable `VITE_TRIP_COLLABORATION_ENABLED` and redeploy. This hides preview UI
   and prevents new application calls.
2. If necessary, deploy the known pre-collaboration revision `b7fd6a3`.
   Do not use a hard reset on a working directory with unrelated edits.
3. Disabling the UI alone does not revoke RPC access. For server-side shutdown,
   separately approve and run the non-destructive rollback script.

## Database recovery

The rollback is a **feature shutdown**, not a data-destroying reverse migration.
It revokes the new API's access while retaining existing and new records,
columns, permissions metadata and owner constraints. Review the checked-in
rollback SQL against the deployed functions before execution.

- Do not drop populated collaboration tables.
- Do not overwrite newly written data with an old JSON export.
- Do not remove `place_id` or change owners.
- Do not reset sharing flags automatically: backup guards must remain safe.
- Stop active clients and sync workers before any full database restore.

If actual data corruption occurs, determine the affected scope and use the
previously rehearsed recovery procedure. Restoring an earlier backup can lose
legitimate writes made after that backup; that requires an explicit recovery
decision, not an automatic script.

## Manual acceptance in an isolated environment

1. With the flag unset, confirm the original itinerary/route calculator and
   local/hybrid sync behave as before.
2. Apply the incremental migration only to the isolated database.
3. Enable the preview flag and use two existing member accounts.
4. Open **Itinerary -> Collaboration preview**. Use the recipient's existing
   registered email; no directory of private emails is exposed.
5. Invite that email as a viewer. Confirm access is denied before acceptance.
6. Accept as the recipient. Confirm only that trip's scheduled places and
   trip content appear, not unrelated collections, private place notes or
   labels.
7. Verify a viewer/editor cannot manage members, impersonate the owner, edit
   private tables directly or accept another account's invitation.
8. Remove the member and confirm a fresh preview request fails. Test expired
   and revoked invitations, leaving, repeated acceptance and account switching.
9. Confirm personal IndexedDB records and pending hybrid tasks were not
   replaced by opening the preview.
10. Disable the flag and apply the approved feature-shutdown script in staging.
    Verify original records and original owner CRUD still work.

The UI explicitly labels this as a read-only preview even for editor members.
Do not present this acceptance list as full collaborative editing acceptance.

## Authorized backup and restore rehearsal — 2026-10-19

- Read-only catalog inspection confirmed PostgreSQL 17.11 and that the
  collaboration tables/API were absent. Original owner-scoped policies remain
  deployed. One existing trip has sharing/editor metadata; it must not be
  reset or silently replaced.
- PostgreSQL 16 backup tools were incompatible with the server major version.
  After explicit approval, the official `postgres:17` container image was
  downloaded and used for backup and an isolated PostgreSQL 17 restore.
- A custom-format archive includes the `public`, `sync_private`, and `auth`
  schemas, including application roles stored in `user_roles`, auth records,
  sync state, definitions and ACLs. It is stored outside the repository in a
  private owner-only directory; the archive has mode `0600`. No backup data
  or credentials are published as a chat artifact.
- The source was unchanged between the before/after checks. All 40 tables in
  this scope matched the isolated restore in row count and content
  fingerprints (sorted hashes of each complete row).
- The restore target had no network access or published ports. Non-login
  placeholder roles and pgcrypto were prepared there. Restore used
  `--no-owner`; original production role memberships, ownership and the
  complete Supabase platform are **not** reproduced by this rehearsal.
- The incremental collaboration migration was then applied to the isolated
  restore only. Comparing all original columns confirmed unchanged original
  row values and IDs. New fields were excluded only from this comparison.
- In rollback-only transactions on the isolated database, original owner
  updates to trips, items, maps and markers and the original sync snapshot
  succeeded after migration and after API shutdown. The collaboration list
  RPC succeeded before shutdown; execute permission for `authenticated`
  was confirmed revoked after shutdown.
- The non-destructive shutdown script preserved all original data and left
  new schema/metadata in place. This is feature shutdown, **not** exact
  removal of all migration objects.
- Isolated containers and their anonymous volumes were removed afterward.
  The verified archive and private fingerprint/rehearsal records remain.
- This backup does not include storage files, other platform schemas,
  provider configuration, role passwords/memberships or PITR. Supabase
  managed backup/PITR availability has not been established.
- Applying anything to live Supabase still requires separate approval.
  If source data changes before approval, take a new backup and reconcile the
  live catalog again before applying the migration.

## Separately approved live migration — 2026-10-19

- After the backup rehearsal, the user explicitly approved only
  `20261019060000_trip_collaboration.sql` and read-only verification.
- A fresh private archive was restored and rehearsed again before execution.
  The verification tool was corrected to parse complete multiline JSON results
  and compare table arrays independently of database collation. A temporary
  container readiness race was also corrected. These initial failed attempts
  did not run the live migration.
- The live migration ran in one transaction with the existing synchronization
  advisory lock. Before applying DDL, all 40 scoped tables were compared with
  the verified archive's counts and full-row fingerprints. Before commit,
  original columns of all 40 tables were compared again. Both guards passed
  and the transaction committed.
- Post-commit read-only inspection confirmed all three collaboration tables
  exist, are empty, have RLS enabled, and deny direct authenticated SELECT.
  Only the authenticated role can execute the new RPC; anonymous callers
  cannot.
- Business counts remained `regions=2`, `places=22`, `labels=19`, `trips=1`,
  `itinerary_items=17`, `route_maps=2`, `route_map_places=3`. The existing trip's
  sharing/editor metadata was preserved; no automatic membership conversion
  was performed.
- An unauthenticated PostgREST request recognized the new endpoint and returned
  HTTP 401 / SQLSTATE 42501, not a missing-RPC error.
- No production business-data invitation, acceptance, editing or member
  removal smoke tests were performed. Browser-authenticated cross-device
  behavior and collaborative content editing are not established by this
  installation.
- The non-destructive rollback has been rehearsed on the restored copy; it has
  **not** been applied to live Supabase. Production recovery remains a
  separately authorized operation.

## Email invitation update

- The incremental `20261019070000_trip_collaboration_email.sql` adds
  `app_trip_collaboration_v2`, preserving the deployed UUID API and existing
  invitations/member IDs. It does not rewrite business records.
- The frontend accepts email instead of UUID. The server checks the caller's
  owner/admin rights before performing an exact, case-insensitive lookup.
  Only an existing member/admin account may be invited. Unknown and
  ineligible addresses receive the same actionable error.
- This is an in-app invitation, **not** an email delivery system or an
  invitation to register. No email notification is sent.
- Management screens show recipient/member emails to the trip manager.
  Other members receive only their own member email plus the trip owner's
  email; there is no searchable account directory.
- The new client requires the v2 API. Deploy the incremental SQL only after
  separate live approval, then deploy the updated client.
- The user separately approved testing, a fresh backup and this exact Email
  mapping migration. The build and 22 focused tests passed.
- A fresh private archive included `public`, `sync_private`, `auth` and
  `collaboration_private`. All 43 tables in the first three schemas matched
  the isolated restore by row count and full-row fingerprints. The Email
  migration and v2 shutdown were rehearsed there without changing existing
  row values or IDs.
- The live Email migration then committed under the synchronization advisory
  lock. Transaction guards matched all 43 tables against that verified backup
  both before and after DDL, including all existing columns.
- Live verification confirmed authenticated list access and, in a transaction
  that was rolled back, owner details with scoped Email resolution. Anonymous
  execution is denied; PostgREST recognizes v2 and returns HTTP 401 /
  SQLSTATE 42501 to an anonymous request.
- No production invitations were sent or accepted for testing. Browser login,
  two-account acceptance and cross-device behavior still require manual
  acceptance; this update does not enable collaborative content editing.
- The email rollback revokes v2 execution without removing any rows. To roll
  back the application, deploy the pre-email client alongside the original API.
  To shut down collaboration entirely, revoke **both** API versions, not just
  the original function.
