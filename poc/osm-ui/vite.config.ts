import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const root = fileURLToPath(new URL('.', import.meta.url))
const workspace = path.resolve(root, '../..')
const maps = process.env.OSM_PROJECT_DIR || '/home/tanguitar/workspaces/maps'
const local = (name: string) => JSON.stringify(path.join(root, name))

// Preview-only substitutions: render the production page, not a copied layout.
export default defineConfig({
  root,
  plugins: [{
    name: 'travel-osm-ui-preview',
    enforce: 'pre',
    transform(code, id) {
      const filename = id.split('?')[0]
      if (filename.endsWith('/src/modules/itinerary/ItineraryModule.tsx')) {
        return code
          .replace('import { mountWorkspaceMap } from "../../geo/workspace-map";', 'import { mountGoogleMap } from ' + local('osm-map.ts') + ';')
          .replace('import { useMapProvider } from "../../geo/provider-preference";', '')
          .replace('const { provider: mapProvider, error: mapPreferenceError } = useMapProvider();', 'const mapProvider = "google"; const mapPreferenceError = undefined;')
          .replace('mountWorkspaceMap(mapProvider, container, {', 'mountGoogleMap(container, {')
          .replace('from "./itinerary.controller";', 'from ' + local('workspace-controllers.ts') + ';')
          .replace('from "../label/label.controller";', 'from ' + local('workspace-controllers.ts') + ';')
          .replace('from "../place/google-places.service";', 'from ' + local('osm-map.ts') + ';')
          .replace('from "../../database/useHybridDataRevision";', 'from ' + local('preview-support.tsx') + ';')
          .replace("from '../../database/useDatabaseMode';", 'from ' + local('preview-support.tsx') + ';')
          .replace("from '../public-itinerary/public-itinerary.controller';", 'from ' + local('preview-support.tsx') + ';')
          .replace("from '../public-itinerary/PublicationDialog';", 'from ' + local('preview-support.tsx') + ';')
          .replace('from "./TripCollaborationPanel";', 'from ' + local('preview-support.tsx') + ';')
          .replace(/function getPlaceMapUrl\(place: Place\): string \| undefined \{[\s\S]*?\n\}/, 'function getPlaceMapUrl(place: Place): string | undefined { return place.mapsUrl; }')
          .replace(/Google Maps/g, 'OpenStreetMap').replace(/Google 地圖/g, 'OSM 地圖')
      }
      if (filename.endsWith('/src/modules/place/PlaceModule.tsx')) {
        return 'import { PlaceSearchHeading } from ' + local('PlaceSearchHeading.tsx') + ';\n' + code
          .replace('from "./place.controller";', 'from ' + local('workspace-controllers.ts') + ';')
          .replace('import { placeIcons } from "../../database";', 'import { placeIcons } from "../../database/models";')
          .replace('from "../../database/useHybridDataRevision";', 'from ' + local('preview-support.tsx') + ';')
          .replace(/選擇結果可連結或更換 Google 地點；資料庫只保存\s+place_id，地點名稱請填寫你自己的名稱。/, '選擇 OSM 結果可連結或更換位置；此預覽暫存在記憶體，地點名稱請填寫你自己的名稱。')
          .replace(/`https:\/\/www.google.com\/maps\/search\/\?api=1&query=\$\{encodeURIComponent\(selectedPlace.name\)\}&query_place_id=\$\{encodeURIComponent\(selectedPlace.googlePlaceId\)\}`/, 'selectedPlace.mapsUrl')
          .replace(/Google Maps/g, 'OpenStreetMap').replace(/Google Places/g, 'OSM 搜尋').replace(/Google 地點/g, 'OSM 地點').replace(/Google 搜尋/g, 'OSM 搜尋').replace(/向 Google/g, '向 OSM')
          .replace('<span className="search-field-label">OpenStreetMap 搜尋</span>', '<span className="search-field-label"><PlaceSearchHeading /></span>')
          .replace('<span>地圖網址 {!draft.googlePlaceId && <b>*</b>}</span>', '<span>地圖網址</span>')
          .replace('required={!draft.googlePlaceId}', '')
          .replace('placeholder="https://maps.google.com/..."', 'placeholder="選填：Google 地圖連結"')
          .replace(/若未選 OSM 搜尋結果，請貼上 OpenStreetMap\s+分享連結或其他地圖網址。/, '可不填；需要時貼上 Google 地圖連結。')
          .replaceAll('setDraft(emptyDraft);', 'setDraft({ ...emptyDraft, regionIds: regions.length === 1 ? [regions[0].id] : [] });')
          .replace('在 OpenStreetMap 開啟 ↗', '在 Google Maps 開啟 ↗')
      }
      if (filename.endsWith('/src/modules/route-calculator/RouteCalculatorModule.tsx')) {
        return code
          .replace('from "./route-calculator.controller"', 'from ' + local('controller.ts'))
          .replace('from "../../database";', 'from ' + local('errors.ts') + ';')
          .replace('from "../../database/useHybridDataRevision"', 'from ' + local('preview-support.tsx'))
          .replace('travel-planner:route-calculator:active-map-id', 'travel-osm-ui-preview:active-map-id')
          .replace(/Google\s+搜尋/g, 'OSM 搜尋')
          .replace(/Google Maps\s+路線估算，非保證抵達時間；實際時間受路況與班次影響。修改條件後需重新計算。/g, 'OSM 靜態道路估算，不含即時路況。修改條件後需重新計算。')
      }
      if (filename.endsWith('/src/modules/route-calculator/RoutePreviewMap.tsx')) {
        return code.replace('from "../place/google-places.service";', 'from ' + local('osm-map.ts') + ';')
          .replace('{ lat: 25.033, lng: 121.5654 }', '{ lat: 26.43, lng: 127.9 }')
      }
      if (filename.endsWith('/src/modules/route-calculator/RouteEndpointField.tsx')) {
        return 'import { NewPlaceSearch } from ' + local('NewPlaceSearch.tsx') + ';\n' + code.replace(/Google 搜尋/g, '新地點搜尋').replace(/Google 建議/g, '搜尋')
          .replace(/<div className="route-google-search" ref=\{container\}[\s\S]*?<p className="route-field-hint">請從 搜尋結果選取；只輸入文字不會作為計算地點。<\/p>/,
            '<NewPlaceSearch controller={controller} disabled={disabled} onConfirm={(place) => { setError(\'\'); onChange({ source: \'google\', place }); setDialogSource(null); trigger.current?.focus(); }} />')
      }
      if (filename.endsWith('/src/common/WorkspaceLayout.tsx')) {
        return code.replace('from \'./HybridStatus\'', 'from ' + local('preview-support.tsx'))
          .replace('from \'./WorkspaceInfoBar\'', 'from ' + local('preview-support.tsx'))
      }
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = (request.url || '').split('?')[0]
        const asset = /^\/osm-assets\/(land|water|roads)\.geojson$/.exec(pathname)
        const vendor = /^\/osm-vendor\/(maplibre-gl(?:-worker|-shared)?\.mjs|maplibre-gl\.css)$/.exec(pathname)
        if (!asset && !vendor) return next()
        const filename = asset ? path.join(maps, 'data', `okinawa-${asset[1]}.geojson`)
          : path.join(maps, 'node_modules/maplibre-gl/dist', vendor![1])
        try {
          const body = await readFile(filename)
          response.setHeader('Content-Type', asset ? 'application/geo+json' : pathname.endsWith('.css') ? 'text/css' : 'text/javascript')
          response.end(body)
        } catch {
          response.statusCode = 503
          response.end('缺少 maps 專案的現有圖資或 MapLibre 檔案。')
        }
      })
    },
  }, react()],
  server: {
    host: '127.0.0.1', port: 5174,
    fs: { allow: [workspace] },
    proxy: { '/local-map': { target: process.env.OSM_SERVICE_URL || 'http://127.0.0.1:3000', rewrite: p => p.replace(/^\/local-map/, '') } },
  },
})
