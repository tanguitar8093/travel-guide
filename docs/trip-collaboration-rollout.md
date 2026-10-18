# Trip collaboration: staged rollout and recovery

## Status and scope

This is a disabled-by-default collaboration **preview**, not a completed
co-editing release. It provides an online control plane for invitations,
membership and a narrowly scoped read-only trip projection. Editor membership
is represented, but the application does not yet permit collaborative content
editing, shared offline edits, or shared route-map editing.

No live Supabase connection, backup, migration, or production deployment is
performed by implementing these files. Passing isolated tests is not proof of
live permissions or cross-device behavior.

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
4. Open **Itinerary -> Collaboration preview**. The recipient can provide
   their own account UUID from this dialog; no directory of private emails is
   exposed.
5. Invite that UUID as a viewer. Confirm access is denied before acceptance.
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
