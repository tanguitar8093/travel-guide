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


## Taiwan / multiple OSM datasets

Preferences select Google or OSM; the Regions page selects Okinawa or Taiwan. See
[implementation and acceptance notes](../docs/system/osm-taiwan-implementation.md).

Build Taiwan with `npm run osm:setup -- --dataset taiwan` (Python venv support and
system tippecanoe are required). This downloads Geofabrik's Taiwan PBF, checks MD5,
extracts named places/display layers, builds a compact SQLite road network and
MBTiles, and writes an artifact manifest. Reuse an existing PBF with
`--pbf osm/data/taiwan.osm.pbf`. Restart the map service after a complete build.

`/datasets/taiwan/tiles.json`, `/datasets/taiwan/api/search` and
`/datasets/taiwan/api/route` select Taiwan. Existing unprefixed endpoints select
Okinawa. Map tiles load independently of the large catalog and road graph.
The runtime requires only Python's standard library; pinned osmium/shapely
packages are build dependencies in `osm/.venv`.

Run all Python fixtures with `npm run osm:test`. The browser regression script is
`node scripts/check-osm-datasets.mjs`; it uses `.env.e2e.local`, a separate browser
context and local-only mutations. `OSM_CHECK_HYBRID=1` checks real account sync;
it may create the account's normal fixed OSM regions, but does not create test
places or trips in the cloud.

## Routing and Taiwan search indexes

Taiwan routing reads indexed edges on demand rather than rebuilding a nationwide
in-memory graph for every transport mode. Taiwan place search also uses a disk
index instead of retaining the complete JSON catalog in the HTTP process.
`osm:setup` and server startup prepare disposable indexes automatically; the first
preparation can take about a minute for both datasets of derived information.
Subsequent starts reuse them. Changed source files invalidate their indexes.

To prepare manually before starting the server:

```sh
python3 -B osm/scripts/prepare-routing-index.py osm/data/taiwan-routing.sqlite
python3 -B osm/scripts/prepare-search-index.py osm/data/taiwan-places.json
```

Caches live in ignored `data/.routing-cache/` and `data/.search-cache/` directories.
Keep the original SQLite/JSON inputs; restart after replacing them. See
[measurements and limits](../docs/system/routing-performance.md) for reproducible
benchmarks, resource bounds, first-build costs, and long-route limitations.

## Experimental streaming display extraction

`scripts/prepare-display-stream.py` extracts display-only GeoJSONL layers into a
new output directory. It uses a disk location index, streams road/water features,
and processes coastline topology after finishing way extraction. It does not register a new
dataset, build MBTiles, extract places, or prepare routing. Existing setup and
service paths continue to use their current implementations.

First use the optional native `osmium-tool` to retain display candidates and all
their referenced nodes (do not use `--omit-referenced`):

```sh
osmium tags-filter /path/to/input.osm.pbf \
  w/highway w/natural=coastline,water w/waterway=riverbank \
  -o /path/to/display-input.osm.pbf
osmium check-refs /path/to/display-input.osm.pbf
osm/.venv/bin/python -B osm/scripts/prepare-display-stream.py \
  /path/to/display-input.osm.pbf /path/to/new-output-directory --prefix japan
```

The output contains roads, water, land and coastline `.geojsonl` files plus a
checksum manifest. The input extent is used without production coverage clipping;
these intermediate layers are not a selectable Japan dataset. Run experiments
outside `osm/data`, with measured memory, disk and time limits. See the
[Japan feasibility and experiment log](../docs/system/osm-japan-feasibility.md).
