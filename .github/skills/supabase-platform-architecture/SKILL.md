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
- New account self-registration is disabled. The administrator manually invites
  known members from Supabase Dashboard → Authentication → Users. An invited
  Supabase Auth user is an authorized application member; do not add public
  registration or treat arbitrary authenticated accounts as members.
- Email authentication is enabled and email confirmation is enabled.
- Unauthenticated visitors must not read application data.
- Authenticated members may read and edit regions, places, labels, and their
  associations.
- Authenticated members may read every trip. “Private edit” means only the
  trip owner may edit it; it does not mean that the trip is hidden from other
  invited members. Shared-edit trips may be edited by the owner and its
  explicitly assigned collaborators.
- Only the trip owner may change its edit mode or collaborator list, or delete
  the trip. Collaborators may edit trip content and itinerary items only while
  the trip is in shared-edit mode.
- Enforce all access rules in Postgres grants and RLS. Frontend visibility or
  disabled controls are UX only and are never authorization.

## Current Supabase environment

The Supabase project has been configured outside the application repository:

- Email provider enabled; user self-signup disabled; email confirmation enabled.
- Empty `public` tables created: `regions`, `labels`, `places`,
  `place_regions`, `place_labels`, `trips`, and `itinerary_items`.
- RLS is enabled on all seven tables. Anonymous access is revoked. Policies
  grant authenticated members access according to the product decisions above.
- The data model includes region/place and place/label join tables,
  `trips.owner_uid`, `trips.edit_mode`, `trips.editor_uids`, and itinerary item
  ordering and date constraints.
- The schema and RLS were applied in Supabase Dashboard SQL Editor. The
  anonymous API was verified to reject access to the protected tables, and the
  table catalog confirmed RLS enabled on all seven. Logged-in read/write and
  each owner/editor role have not yet been end-to-end tested.
- The current app still uses Dexie/IndexedDB. Supabase Auth, cloud data access,
  and synchronization have not been integrated into the application. Do not
  claim that cross-device persistence or application login is implemented.

Do not include project URLs, API keys, passwords, invite addresses, or other
environment-specific secrets in this skill, source control, logs, or chat.

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
- The persistence strategy is not yet finalized. Before implementing
  synchronization, decide explicitly between:
  1. Dexie-first local data with an outbox, retry, remote pull, account
     isolation, deletion tombstones, conflict policy, and visible sync status;
     or
  2. A Supabase-backed repository with Supabase's browser/offline behavior,
     without treating the existing Dexie database as the mandatory bridge.
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
- Keep trip reads available to all authenticated invited members. Restrict
  trip row mutation so collaborators cannot change owner or ACL fields. Route
  owner-only ACL changes through an owner-checked database operation/RPC.
- Revisit RLS policies whenever adding a table, view, RPC, or storage bucket.
  Default to no access for `anon`; grant only the required operations to
  `authenticated`. For `SECURITY DEFINER` functions, set a safe `search_path`,
  validate caller identity and inputs, and narrowly grant execute permission.
- Test anonymous denial, authenticated CRUD for shared reference data,
  all-member trip reads, owner-only edits for private trips, assigned-editor
  edits for shared trips, non-editor denial, and owner-only ACL/deletion
  behavior.

## Migrations and backups

- The current schema was created from the Dashboard SQL Editor; there is not
  yet a checked-in migration source of truth. Before further schema changes,
  capture the effective schema/policies in a versioned Supabase migration and
  verify it can be applied to a clean project. Avoid relying on undocumented
  dashboard-only edits.
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
