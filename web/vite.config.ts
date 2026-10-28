import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In production server.py serves dist/index.html at / and dist/assets/* at /assets/.
// In development the dev server proxies the API to a separate local Taste Truce server. That server
// only issues its session cookie on GET / and rejects a POST whose Origin differs from Host, so
// /__session is rewritten to / and the Origin header is dropped on the way through.
// No default on purpose: 127.0.0.1:3000 is the live deployment, which holds real provider keys.
// Point this at a local server started without keys (it answers from its cache only).
const backend = process.env.TASTE_TRUCE_BACKEND
if (!backend && process.argv.some((a) => a === 'dev' || a.endsWith('vite') || a === 'serve'))
  console.warn('Set TASTE_TRUCE_BACKEND to a local Taste Truce server; API requests will fail without it.')

const vendor = (name: string, packages: string[]) => ({
  name,
  test: new RegExp(`node_modules[\\\\/](${packages.join('|')})[\\\\/]`),
})

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    proxy: !backend ? undefined : {
      '/__session': { target: backend, rewrite: () => '/' },
      '/api': {
        target: backend,
        configure: (proxy) => proxy.on('proxyReq', (req) => req.removeHeader('origin')),
      },
      '/scene': backend,
      '/health': backend,
    },
  },
  build: {
    // Hashed file names; server.py serves them with a long cache lifetime.
    assetsDir: 'assets',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            vendor('react', ['react', 'react-dom', 'scheduler']),
            vendor('base-ui', ['@base-ui', '@floating-ui']),
            vendor('leaflet', ['leaflet']),
          ],
        },
      },
    },
  },
})
