/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_SUPABASE_EMAIL_REDIRECT_TO?: string
  readonly VITE_ADMIN_SYNC_INFO_ENABLED?: string
  readonly VITE_OSM_ASSET_BASE_URL?: string
  readonly VITE_OSM_STYLE_URL?: string
  readonly VITE_OSM_SERVICE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
