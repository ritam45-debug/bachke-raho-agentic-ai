import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build:preview` makes one self-contained HTML file (backend runs in-browser) for claude.ai.
// In dev, /api and /health are proxied to the FastAPI backend so the browser talks to one origin.
const preview = process.env.VITE_PREVIEW === '1'

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(preview ? [viteSingleFile()] : [])],
  base: preview ? './' : '/',
  build: preview ? { outDir: 'dist-preview' } : {},
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.VITE_API_PROXY ?? 'http://localhost:8000',
      '/health': process.env.VITE_API_PROXY ?? 'http://localhost:8000',
    },
  },
})
