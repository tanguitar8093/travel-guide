# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

## Browser E2E (Playwright)

Requires Node.js 20.19+ (or a current Vite-supported Node.js release). From a
fresh checkout, run `npm ci` and `npm run e2e:install`. On Linux machines missing
browser system libraries, use `npm run e2e:install:linux` instead; installing OS
packages may require administrator approval. Only Chromium is installed.

Configure the app's Supabase/public Google Maps settings in `.env.local` using
`.env.example`. Copy `.env.e2e.example` to `.env.e2e.local`, enter two different
workspace-member accounts, and explicitly set `E2E_ALLOW_LIVE_WRITES=true`.
Never commit credentials, service-role keys, login state or test recordings.

Run `npm run e2e` (headless) or `npm run e2e:headed` (requires a graphical
desktop). `npm run e2e:report` opens the local HTML report. Playwright starts a
dedicated Vite server on loopback port 4173 with collaboration enabled, and
stops it afterward. Existing servers are not reused. The test uses one browser
window: A signs in, creates and shares a trip, signs out, then B signs in in the
same window. It uses the default hybrid/automatic-sync behavior and does not
mock the backend or write fixtures through privileged APIs.

Both commands print numbered Chinese step names with start, completion and
failure messages. While a step is running, a heartbeat prints its name and
elapsed wait every five seconds. Each run also appends its progress/errors to a
separate timestamped file in ignored `e2e-logs/`; older progress logs are not
overwritten. Known password/key/token environment values are redacted. A
heartbeat indicates where execution is waiting, not that the step has passed.
The scenario has a five-minute timeout. HTML reports/videos remain in the
standard Playwright output folders and can be replaced by the next run.

The scenario follows 24 logged steps: A signs in, opens `/itinerary`,
creates a uniquely named trip with the default dates and first region, adds the
first available place, opens collaboration management, enters B's email and
sends an editor invitation. It enables shared editing if that button exists, otherwise
logs `SKIP`. A signs out; B signs in, opens `/itinerary` and collaboration
management, accepts only this run's invitation, waits five seconds, and records
the shared trip/place result. B adds the first different available place, waits
for automatic upload, leaves the trip through collaboration management and
signs out. A signs back in, switches to cloud mode through `/data`, and records
whether B's uniquely noted second item is present without asserting that
observation yet. A switches back to hybrid mode **before deletion**, deletes
only this run's trip, waits for its actual sync-push acknowledgement, reloads
to check that the trip stays absent, and returns to `/data` in hybrid mode.
Only then are the recorded business observations asserted.

A needs administrator access for the UI mode switch. The first region must
already contain a selectable place, and B needs a different selectable place.
No second window, route-calculator navigation or new saved place is involved.
Fixture teardown has a separate two-minute budget to attempt owner login,
hybrid-only deletion and mode restoration if an earlier operation fails. It
does not clear account data, discard outboxes or silently fall back to cloud
deletion. If deletion/restoration fails, the test reports that failure and the
exact test trip name rather than claiming cleanup succeeded. Forced process
termination or unavailable services can prevent teardown from completing.

Screenshots, the single-window video and a structured `scenario-result` JSON
observation/cleanup record are attached to the report under ignored
`playwright-report/` and `test-results/`. Traces are disabled because they can
capture authentication request bodies. These outputs can contain private
account data; review them before sharing. Observation and cleanup messages are
also saved in the per-run progress log. The mixed-mode deletion path is the
one under test; cloud mode is used only to observe B's persisted edit.
These are live-service E2E tests, separate from `npm run test:run`.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
