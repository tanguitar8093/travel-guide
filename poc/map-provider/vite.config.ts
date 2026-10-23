import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { osmDevAssets } from '../../scripts/osm-dev-assets.ts'

const root = fileURLToPath(new URL('.', import.meta.url))
const workspace = path.resolve(root, '../..')

export default defineConfig({
  root,
  envDir: workspace,
  plugins: [osmDevAssets(), react()],
  server: { host: '127.0.0.1', port: 5176, strictPort: true, fs: { allow: [workspace] } },
})
