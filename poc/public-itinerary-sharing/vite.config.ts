import { defineConfig } from 'vite'

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  envDir: false,
  server: { host: '0.0.0.0', port: 5174, strictPort: true },
  build: { outDir: '../../dist/public-itinerary-sharing', emptyOutDir: true },
})
