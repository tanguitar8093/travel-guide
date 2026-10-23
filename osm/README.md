# Travel bundled OSM

Runtime code, Okinawa map data, MapLibre 6.15.0 browser assets, and maintenance scripts live in this directory. No sibling maps checkout or its node_modules is required. Original source files remain untouched; copy-manifest.json records their checksums before integration edits.

## Run from the Travel root

- `npm run dev`: starts the local OSM service automatically when needed, using osm/server.py and osm/data. Close any old maps service on port 3000 to ensure this bundled service is used. Existing healthy services on that port are reused.
- `npm run osm:start`: start the Python service explicitly. Uses Python 3.10+ and its standard library; no pip/npm installation is required for the OSM runtime.
- Both osm-ui and map-provider PoCs share the same automatic service startup and proxy as the main app, and read bundled vendor and GeoJSON assets.
- `npm run osm:build:tiles`: rebuild osm/data/okinawa.mbtiles using system-installed tippecanoe; restart the OSM service afterwards.
- `npm run osm:setup`: prepare missing road, tile and place data. Needs network access, tippecanoe, and pip when the place catalog must be extracted. The supplied data already supports runtime without setup.
- `python3 -m pip install -r osm/requirements-build.txt`: optional PBF extraction dependency. The setup script can alternatively install it into a temporary directory.
- `npm run osm:test`: existing Python tests; place-extraction tests require osmium.

OSM_PROJECT_DIR optionally overrides this bundled directory and expects the same data/ and vendor/maplibre-gl/ layout. OSM_SERVICE_PORT chooses the automatically launched service port; OSM_SERVICE_URL selects an existing service. These are process environment variables, not browser VITE variables. HOST and PORT configure an explicitly started Python service.

## Production

This is one repository with a browser frontend and a Python backend. Building the Vite frontend does not embed or start Python. Route /local-map/* to the Python service (removing /local-map), and configure VITE_OSM_SERVICE_URL=/local-map and VITE_OSM_ASSET_BASE_URL=/local-map before building. The Python service serves osm-vendor/, tiles.json, tiles/, search, routing and URL parsing. A same-origin reverse proxy avoids cross-origin worker and CORS configuration. Vercel SPA-only hosting still needs a reachable Python service or an additional suitable backend deployment.

From the Travel root: `docker compose -f osm/compose.yaml up --build -d`. This container serves the OSM backend only; deploy the frontend separately or use a reverse proxy. No image build, container startup or production deployment has been validated as part of the copy.

## Data and licensing

Six supplied Okinawa runtime/PoC data files total approximately 125.4 MiB. Keep osm/data when copying or packaging this repository; Vite dist alone is insufficient. The regional kyushu.osm.pbf source, Zurich tiles, demo screenshots and demo fonts are not runtime dependencies and were not copied. A future setup may download the regional PBF; .gitignore excludes that rebuild input. The bundled runtime data and vendor files are not ignored.

MapLibre's license is preserved in vendor/maplibre-gl/LICENSE.txt; version.json records its pinned source version. These prebuilt vendor files are committed assets, so there is no dependency on a sibling npm installation. Update all four assets, license and version metadata together when upgrading.

OSM data: © OpenStreetMap contributors, ODbL, https://www.openstreetmap.org/copyright . Original extraction sources include Overpass and Geofabrik Kyushu. Preserve attribution and the applicable data license when redistributing.

Historical project notes may still describe the earlier sibling maps arrangement. Active configuration now defaults to this directory. Database backup tools under scripts/convergence-* retain their separate ~/.local paths; they are maintenance tooling unrelated to this OSM integration. Supabase and Google services remain external network dependencies.
