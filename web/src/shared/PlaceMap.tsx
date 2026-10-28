import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { Place } from './types'

export type PlaceMapProps = {
  places: Place[]
  pickId?: string
  activeId?: string | null
  onSelect?: (id: string) => void
  className?: string
  padding?: [number, number]
  // Extra space on the left for a floating panel (map-first layouts).
  paddingTopLeft?: [number, number]
  // Phones keep the credits at the top, clear of the bottom sheet.
  attribution?: 'topright' | 'bottomright'
}

// Numbered pins in list order; the fair pick is drawn last and larger.
// Default export so the app can load Leaflet in its own chunk.
export default function PlaceMap({ places, pickId, activeId, onSelect, className, padding = [36, 36], paddingTopLeft, attribution = 'bottomright' }: PlaceMapProps) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const select = useRef(onSelect)
  select.current = onSelect

  useEffect(() => {
    if (!host.current || map.current) return
    map.current = L.map(host.current, { scrollWheelZoom: false, zoomControl: true, attributionControl: false }).setView([40.7081, -73.9571], 14)
    L.control.attribution({ position: attribution, prefix: '<a href="https://leafletjs.com">Leaflet</a>' }).addTo(map.current)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      className: 'tt-tiles',
      maxZoom: 19,
    }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    const observer = new ResizeObserver(() => map.current?.invalidateSize())
    observer.observe(host.current)
    return () => {
      observer.disconnect()
      map.current?.remove()
      map.current = null
    }
  }, [attribution])

  // Pins follow the list and the highlighted row.
  useEffect(() => {
    const group = layer.current
    if (!group) return
    group.clearLayers()
    const ordered = places.map((p, i) => ({ p, n: i + 1 })).sort((a, b) => Number(a.p.id === pickId) - Number(b.p.id === pickId))
    for (const { p, n } of ordered) {
      if (!p.location || !Number.isFinite(p.location.lat)) continue
      const pick = p.id === pickId
      const active = p.id === activeId
      const size = pick ? 34 : 26
      const icon = L.divIcon({
        className: '',
        html: `<span class="tt-pin${pick ? ' tt-pin-pick' : ''}${active ? ' tt-pin-active' : ''}" style="width:${size}px;height:${size}px">${n}</span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      })
      const marker = L.marker([p.location.lat, p.location.lon], { icon, zIndexOffset: pick ? 1000 : active ? 900 : 0, title: p.name, alt: p.name, keyboard: true })
      marker.on('click', () => select.current?.(p.id))
      marker.bindTooltip(p.name, { direction: 'top', offset: [0, -size / 2] })
      group.addLayer(marker)
    }
  }, [places, pickId, activeId])

  // The view moves only when the set of places changes, not on hover.
  useEffect(() => {
    const m = map.current
    const points = places.filter((p) => p.location && Number.isFinite(p.location.lat)).map((p) => [p.location!.lat, p.location!.lon] as L.LatLngTuple)
    if (!m || !points.length) return
    m.fitBounds(L.latLngBounds(points), {
      ...(paddingTopLeft ? { paddingTopLeft, paddingBottomRight: padding } : { padding }),
      maxZoom: 15,
      animate: false,
    })
  }, [places, padding, paddingTopLeft])

  return <div ref={host} className={cn('isolate', className)} role="region" aria-label="Map of the shortlist" />
}
