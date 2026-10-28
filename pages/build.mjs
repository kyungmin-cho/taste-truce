// Assemble the Pages output: the built interface at /, the previous page at /classic, and the
// same static paths server.py serves. Run `npm run build` in ../web first.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const web = join(here, '..', 'web', 'dist')
const classic = join(here, '..', 'static')
const out = join(here, 'dist')
if (!existsSync(join(web, 'index.html'))) throw new Error('Build the interface first: (cd ../web && npm ci && npm run build)')

rmSync(out, { recursive: true, force: true })
mkdirSync(out)
cpSync(join(web, 'index.html'), join(out, 'index.html'))
cpSync(join(web, 'assets'), join(out, 'assets'), { recursive: true })
// Pages serves classic.html at /classic.
cpSync(join(classic, 'index.html'), join(out, 'classic.html'))
for (const name of ['styles.css', 'app.js', 'copy.js', 'steps.js']) cpSync(join(classic, name), join(out, name))
for (const name of ['leaflet.js', 'leaflet.css', 'LICENSE', 'images/layers.png', 'images/layers-2x.png', 'images/marker-icon.png', 'images/marker-icon-2x.png', 'images/marker-shadow.png']) {
  mkdirSync(dirname(join(out, 'vendor', 'leaflet', name)), { recursive: true })
  cpSync(join(classic, 'vendor', 'leaflet', name), join(out, 'vendor', 'leaflet', name))
}

// Only these paths run a Function; every other request is a free static asset.
writeFileSync(join(out, '_routes.json'), JSON.stringify({ version: 1, include: ['/', '/classic', '/api/*', '/scene/*', '/health'], exclude: [] }, null, 2) + '\n')
// The headers server.py sends. Hashed bundle files never change, so they may be cached for a year.
writeFileSync(join(out, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Cache-Control: no-store

/assets/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
`)
// With a top-level 404.html, unknown paths answer 404 instead of falling back to the app.
writeFileSync(join(out, '404.html'), '{"error": "Not found"}\n')
console.log('built ' + out)
