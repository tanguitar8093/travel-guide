---
name: travel-module-architecture
description: Use when creating or changing Travel Planner modules to preserve the established data, operation, UI, and routing boundaries.
---

# Travel Planner module architecture

Use this skill before implementing or substantially changing a product module in
this repository. Follow the existing architecture rather than introducing a
parallel framework.

## Application structure

- The app is a client-side React and TypeScript application built with Vite.
- `src/App.tsx` is the composition point. `src/routes.ts` owns route paths, and
  `src/router.tsx` provides the lightweight `RouterLink`.
- Each feature belongs under `src/modules/<module>/`. Keep its React UI and
  module-specific styles inside that folder.
- Export each module's UI, controller, service, and public types from its
  `index.ts`. Add the route to `src/routes.ts`, dispatch it in `src/App.tsx`,
  and wire working navigation links in module sidebars.
- Reuse the existing visual language and shared shell patterns in the Label and
  Place modules. Do not replace the app shell with a module-specific root UI.

## Three-layer module pattern

### Data layer

- Persist application records through the existing Dexie database in
  `src/database/`; the database is named `travel-planner` and runs in the
  browser's IndexedDB.
- Keep shared domain interfaces and `New*`/`*Changes` types in
  `src/database/models.ts`.
- Keep persistence, indexes, transactions, referential integrity, and
  cross-entity deletion rules in `src/database/database.ts`,
  `src/database/repositories.ts`, and the focused validation/error files.
- Validate inputs in the data layer. Enforce foreign-key-like references and
  multi-record consistency in repository transactions. Raise the repository's
  explicit `ValidationError`, `EntityNotFoundError`, and `EntityInUseError`
  rather than silently ignoring invalid data.
- Export supported types, repositories, and errors from `src/database/index.ts`.
  Do not access Dexie tables directly from UI components.

### Operation layer

- Put a `<module>.service.ts` beside the module UI. Services orchestrate
  repository operations and contain module-specific queries, transformations,
  and workflows.
- Put a `<module>.controller.ts` beside the service. Keep it as a thin public
  facade that delegates to the service; use constructor injection with a
  default service and export a module singleton where the existing modules do.
- Do not duplicate validation or storage logic already owned by repositories.

### UI layer

- Put `<Module>Module.tsx` and `<Module>Module.css` in the module folder.
- The UI calls the module controller, owns transient view/form state, and
  reports loading, success, and failure explicitly.
- Follow existing async UI patterns: guard stale effects, show errors to users,
  disable conflicting actions while saving, and confirm destructive actions.
- Keep user-generated data editing in forms; present external-provider details
  according to the provider's storage/attribution requirements.

## Existing domain and modules

- `src/modules/label/` manages hierarchical labels and assigning/removing them
  on places. Its service assembles a label tree and queries matching places.
- `src/modules/place/` manages places, region/label associations, and optional
  Google Places integration. Google-derived place details are fetched for
  display; only the Google `place_id` is persisted from that provider. Place
  records do not store latitude/longitude; a non-Google place uses its
  user-provided map URL for navigation. Database upgrades migrate legacy
  coordinate-only places to a Google Maps search URL before removing the
  coordinate fields.
- `src/modules/region/` manages regions with the shared Google Places search.
  Persist the Google `place_id`, not Google-derived coordinates or descriptive
  place data; fetch the location details when needed for display. Legacy regions
  may still contain a manually entered center for backward compatibility.
  Repository rules prevent deleting a region that is still referenced by places
  or trips.
- `src/modules/itinerary/` manages trips and their per-day itinerary items. It
  composes trips, regions, and places through the existing operation APIs. Its
  workspace presents the daily itinerary beside the trip's region map, with
  markers for all located places in that region and an ordered marker for each
  place scheduled on the selected day. Resolve Google place locations at
  runtime from `place_id`; do not persist provider coordinates. Places stored
  only with a custom map URL may not be resolvable and should be listed with
  that limitation rather than silently omitted. A scheduled item may store its
  manually requested incoming-leg travel-time estimate in minutes; clear that
  estimate whenever its predecessor, destination, date, order, or travel mode
  changes. Display the user-entered `arrivalTime` as the planned arrival time;
  derive a reference arrival time from the previous item's planned arrival plus
  this leg's estimate, and do not persist that derived value separately.
- `src/modules/data-management/` provides versioned JSON export and full
  replacement import for every persisted table. Keep parsing, schema and
  reference validation, and atomic replacement in the database/operation
  layers; never clear live data until the complete backup is validated, and
  require explicit confirmation in the UI before replacing it.
- `src/database/models.ts` already defines `Region`, `Trip`, and
  `ItineraryItem`. Existing trip/item repositories and validation are in
  `src/database/repositories.ts` and `src/database/validation.ts`; inspect and
  reuse them before implementing itinerary workflows.
- `Trip.regionId` is currently required and must reference an existing Region.
  A Region needs a name, zoom, and either a Google `place_id` or a legacy center.
  Create/select regions through the Region module; do not hide the requirement
  behind a silent default or invent a region.
- An itinerary item references a trip and a place, its date must fall within
  the trip dates, and its ordering is scoped by trip/date. Existing item fields
  include arrival time, duration, transport, note, and order.
- Place deletion is rejected while itinerary items reference the place. Trip
  deletion requires explicit UI confirmation and atomically deletes that trip's
  itinerary items in the same database transaction. Trip date changes are
  rejected if they would exclude existing itinerary items.

## Change workflow

1. Inspect the relevant models, repositories, validation, module implementation,
   routes, and existing UI patterns before editing.
2. Reuse existing records and APIs where possible; do not create duplicate
   domain concepts or persistence layers.
3. Implement the smallest complete vertical slice across data, operation, UI,
   exports, routing, and navigation.
4. Update directly related documentation or this skill when architectural
   conventions materially change.
5. Run focused validation for the change, typically the production build and
   lint scripts when TypeScript/UI code is affected. Do not run the full test
   and quality-check workflow by default; run it only when requested or when
   the `full-test-check` skill is explicitly invoked.
6. Report what changed and which checks ran. Never claim a skipped test or
   unavailable check passed.
