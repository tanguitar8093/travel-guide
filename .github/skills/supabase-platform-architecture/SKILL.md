---
name: supabase-platform-architecture
description: Use when configuring or implementing Supabase Auth, Postgres, RLS, persistence, or cross-device data behavior for Travel Planner.
---

# Travel Planner Supabase architecture

Use this skill before changing Supabase configuration, authentication,
authorization, database schema, synchronization, or backup behavior. Keep
Supabase-specific behavior behind the data boundary and preserve the Travel
Planner module architecture.

## Product decisions

- Supabase is the selected platform for authentication and cross-device
  persistence. Vercel is the selected hosting platform; deployment settings are
  managed in Vercel, not in the application repository.
- The app implements email/password sign-in and sign-up. Actual provider and
  confirmation settings must be verified in the target Supabase environment;
  do not infer them from old setup notes.
- Unauthenticated visitors must not read application data.
- `member` may read/write only their own business records; `admin` may
  read/write all owners; `basic` and unauthenticated callers have no business
  data access. AuthGate allows only member/admin into the workspace.
- Sharing/collaboration is not enabled by current owner-isolation policies.
  Stored edit mode/editor fields do not grant cross-owner access. Preserve
  ownership, same-owner references and the prohibition on owner reassignment.
- Enforce all access rules in Postgres grants and RLS. Frontend visibility or
  disabled controls are UX only and are never authorization.

## Current Supabase environment

Use current code and checked-in SQL as the repository baseline:

- Supabase Auth and cloud repositories are integrated. The database facade
  selects `indexeddb` or `supabase`; the default is Supabase.
- `docs/supabase-schema-from-indexeddb.sql`,
  `docs/supabase-basic-role-rls.sql` and `docs/supabase-owner-isolation.sql`
  define the seven business tables, owner constraints, roles and RLS.
- `docs/supabase-phase2-safe-import.sql` and the cloud backup repository
  implement preview/token-guarded account-scoped replacement and clearing.
  Replacement regenerates UUIDs; it is not incremental synchronization.
- Tests use PGlite for PostgreSQL/RLS and mocks for application APIs. Passing
  these does not verify the live project's deployed schema or auth settings.
- Local-first phase 3 connects AuthProvider to account-scoped local storage
  and adds a DEV-only hybrid facade/mode, queue status and operation timing.
  Production retains the original modes/default. Read
  `docs/local-first-sync-phase3-review.md` before continuing.
- Phase 4 adds repository baseline/sync migrations, three sync RPCs and a
  cloud adapter. On 2026-10-18, after explicit user approval and live schema
  reconciliation, only the sync migration was applied through psql to the
  configured database (not the baseline). Live authenticated-role SQL smoke
  tests passed with all test writes rolled back; PostgREST exposes all three
  endpoints and rejects unauthenticated calls. Read the installation record
  in `docs/local-first-sync-phase5-review.md`. This does not validate browser
  login, cross-device sync, concurrency or full advisors. Read
  `docs/local-first-sync-phase4-review.md` for explicit
  SECURITY DEFINER checks, global transaction-lock tradeoffs, retained events,
  migration reconciliation and validation limits. Phase 5 is authorized.

Do not include project URLs, API keys, passwords, invite addresses, or other
environment-specific secrets in this skill, source control, logs, or chat.

## Authorized direct database access

- When a task requires live SQL and the user explicitly authorizes it, use
  `psql` with `SUPABASE_DB_URL` loaded from the project's untracked `.env.local`.
  Never read credentials into chat output or put them in command arguments,
  source files, logs, or documentation. Never source an environment file as
  executable shell code.
- The client can be installed on Ubuntu with `sudo apt-get update` followed by
  `sudo apt-get install -y postgresql-client`. If sudo requires a password, ask
  the user to install it; do not attempt to bypass privileges.
- Run `node --env-file=.env.local scripts/db-psql.mjs -c 'BEGIN READ ONLY; SELECT 1; COMMIT;'`
  for an authorized connection check. The wrapper passes PostgreSQL connection
  fields through environment variables, disables psql startup files/password
  prompting, and stops on SQL errors. Do not print connection information.
- If the direct endpoint requires unavailable IPv6, ask the user to configure a
  reachable Session pooler URL in `.env.local`; do not guess hosts/credentials.
- Reconcile live schema/functions before applying only the new migration.
  Use transaction-scoped migration SQL with bounded lock/statement timeouts.
  Do not replay the baseline, overwrite differing live functions, or record a
  connection or migration as successful unless it actually completed.
- On 2026-10-18, the user installed psql 16, updated the connection endpoint,
  and authorized the distance extension. Read-only access succeeded and
  `20261018220000_itinerary_travel_distance.sql` committed successfully.
  No live business-data or RLS smoke tests were run for this change.
- Operational instructions and installation commands are recorded in
  `docs/database-psql-operations.md`. Ask permission before reading that project
  document, as required by the development workflow.

## Client configuration and key handling

- Browser-visible settings use Vite's `VITE_` prefix:
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- A Supabase `sb_publishable_...` key (or legacy anon key) is intentionally
  public and may be used in the browser. It is not an authorization boundary;
  grants and RLS must remain correct even if the key is copied.
- Never expose `sb_secret_...`, `service_role`, database passwords, or other
  privileged credentials in a `VITE_` variable or client bundle. Keep privileged
  operations in a trusted server environment if ever required.
- `.env.local` is for local development and must remain untracked. Configure
  production/preview browser variables in Vercel and redeploy after changes.
- Google Maps browser keys also use `VITE_` because Maps JavaScript, Places,
  and Routes run in the browser. Treat these as publicly observable; restrict
  by allowed HTTP referrers and the minimum required APIs in Google Cloud.

## Persistence boundary and synchronization

- Keep feature UI and module services independent of Supabase SDK details.
  Route persistence through the existing database/repository boundary or a
  deliberate provider adapter there; do not import Supabase directly from
  feature components.
- Preserve current module behavior where practical, but do not promise a
  zero-core-change integration: authentication, trip ownership/editor metadata,
  and cloud persistence necessarily affect shared data contracts and
  application composition.
- The reviewed plan is Dexie-first hybrid persistence with Supabase sync.
  Read `docs/local-first-sync-design.md` and
  `docs/local-first-sync-phase2-review.md` for phase status and acceptance.
  Stop at the authorized phase; do not infer approval for later phases.
- Phase 5 includes read-only 5A preview and DEV-only 5B manual initialization
  and push/pull. Read `docs/local-first-sync-phase5-review.md`. The engine
  preserves pending local data, stops conflicting batches, freezes retry
  payloads before requests and acknowledges only complete success responses.
  Push receipt cursors do not advance the pull cursor; event sequences prevent
  replay from regressing newer baselines. Web Locks prevent concurrent sync
  in the same browser across tabs. Automatic sync remains unimplemented.
  Future live SQL changes still need separate approval.
- Phase 5C now provides persisted whole-pending-batch conflict reviews and
  explicit local/cloud choices, not per-record merging. Cloud choice discards
  all pending operations; local choice creates a new version-checked task.
  Both revalidate the local state and cloud snapshot before atomic local
  changes; uncertain upload outcomes block resolution. Automatic sync remains
  unimplemented. This phase does not change live SQL.
- Existing standalone IndexedDB has no per-user data authorization. Phase 2
  adds separate project/user IndexedDB databases, account-context guards and
  persistent outboxes. This is application-managed cache isolation, not RLS,
  authentication, encryption or protection against direct browser storage access.
- `LocalSyncStore.mutate()` commits domain data, cascading changes and one
  ordered task atomically. Repositories accept an injected database; existing
  singleton behavior remains intact. Account switches preserve the old queue.
- In DEV, account context is connected after member/admin role verification
  and invalidated on sign-out/session changes. `prepareLocal()` creates local
  metadata only, not a cloud snapshot. Hybrid starts empty; only an explicit
  manual sync initializes cloud data. Do not automatically import legacy
  records. Cold offline login is not supported by this work.
- The first hybrid release is planned for the current user's own records,
  including admin; admin management of others remains in direct cloud mode.
  This planned restriction does not change current Supabase admin permissions.
- Do not build an implicit dual-write or one-way upload and call it sync.
  Specify first-login migration, sign-out/account-switch isolation, offline
  behavior, conflict resolution, and partial-failure recovery before enabling
  writes from the app.
- Use UUID record IDs compatible with the current `crypto.randomUUID()` model.
  Keep Google-derived coordinates and provider descriptions out of persisted
  records unless the existing domain model explicitly requires them.

## Schema and authorization invariants

- Preserve the current domain entities and relationships: region, place,
  hierarchical label, trip, and per-day itinerary item.
- `place_regions` and `place_labels` represent the current `regionIds` and
  `labelIds` arrays. Keep them transactionally consistent when writing a place
  and its associations.
- A trip has one required region, a valid start/end range, an owner UID, an
  edit mode (`private` or `shared`), and an explicit collaborator UID list.
- A trip item must reference an existing trip and place, have a date within the
  trip range, and have a unique order within its trip/day.
- Prevent label parent cycles. Preserve region/place/trip referential integrity
  and existing delete rules. Do not rely on frontend checks for these rules.
- Preserve owner-only member trip reads/writes and admin access. Do not
  restore obsolete all-member trip reads or collaborator access without an
  explicitly authorized sharing migration.
- Revisit RLS policies whenever adding a table, view, RPC, or storage bucket.
  Default to no access for `anon`; grant only the required operations to
  `authenticated`. For `SECURITY DEFINER` functions, set a safe `search_path`,
  validate caller identity and inputs, and narrowly grant execute permission.
- Test anonymous/basic denial, member owner-scoped CRUD, cross-owner denial,
  admin access, owner spoofing, role escalation and same-owner references.

## Migrations and backups

- Migrations now exist under `supabase/migrations/`, derived from docs SQL
  and verified in an empty isolated database. They are not a dump of live
  Supabase. Reconcile deployed schema/history before authorized cloud apply;
  never blindly replay the baseline or mark migration history as applied.
- Keep JSON backup import/export supported. Treat schema validation,
  relationship validation, and replacement authorization as data-layer
  responsibilities. Never allow imported JSON to assign arbitrary owner or
  collaborator UIDs.
- A cloud full replacement must account for multi-table consistency,
  Postgres transaction boundaries, row-level authorization, and recoverability.
  Do not assume a sequence of client requests is atomic. Validate all input
  before mutation and use a trusted transactional database operation when
  atomic replacement is required.

## Implementation workflow

1. Read this skill and the Travel Planner module architecture skill.
2. Inspect the current schema, RLS policies, migrations, Supabase client setup,
   Dexie repositories, domain types, and backup workflow before editing.
3. State the affected authorization and sync behavior; ask for a product
   decision if an unresolved choice changes access, offline behavior, or data
   ownership.
4. Make the smallest coherent change behind the data boundary. Update migration
   source and directly related documentation together.
5. Validate with focused build/tests and Supabase RLS tests where available.
   Do not claim unrun live Auth or role tests passed.
