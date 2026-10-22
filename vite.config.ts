import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { osmDevAssets } from './scripts/osm-dev-assets.ts'

export default defineConfig({
  plugins: [osmDevAssets(), react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
