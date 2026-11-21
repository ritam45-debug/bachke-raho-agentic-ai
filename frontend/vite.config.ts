import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In dev, /api and /health are proxied to the FastAPI backend so the browser talks to one origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.VITE_API_PROXY ?? 'http://localhost:8000',
      '/health': process.env.VITE_API_PROXY ?? 'http://localhost:8000',
    },
  },
})
