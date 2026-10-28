import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { Place } from './types'

type Props = {
  places: Place[]
  pickId?: string
  activeId?: string | null
  onSelect?: (id: string) => void
  className?: string
  padding?: [number, number]
  // Extra space on the left for a floating panel (map-first layouts).
  paddingTopLeft?: [number, number]
}

// Numbered pins in list order; the fair pick is drawn last and larger.
export function PlaceMap({ places, pickId, activeId, onSelect, className, padding = [36, 36], paddingTopLeft }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!host.current || map.current) return
    map.current = L.map(host.current, { scrollWheelZoom: false, zoomControl: true, attributionControl: true }).setView([40.7081, -73.9571], 14)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      className: 'tt-tiles',
      maxZoom: 19,
    }).addTo(map.current)
    map.current.attributionControl.setPrefix(false)
    layer.current = L.layerGroup().addTo(map.current)
    const observer = new ResizeObserver(() => map.current?.invalidateSize())
    observer.observe(host.current)
    return () => {
      observer.disconnect()
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    const group = layer.current
    if (!m || !group) return
    group.clearLayers()
    const points: L.LatLngExpression[] = []
    const ordered = places.map((p, i) => ({ p, n: i + 1 })).sort((a, b) => Number(a.p.id === pickId) - Number(b.p.id === pickId))
    for (const { p, n } of ordered) {
      if (!p.location || !Number.isFinite(p.location.lat)) continue
      const point: L.LatLngExpression = [p.location.lat, p.location.lon]
      points.push(point)
      const pick = p.id === pickId
      const active = p.id === activeId
      const size = pick ? 34 : 26
      const icon = L.divIcon({
        className: '',
        html: `<span class="tt-pin${pick ? ' tt-pin-pick' : ''}${active ? ' tt-pin-active' : ''}" style="width:${size}px;height:${size}px">${n}</span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      })
      const marker = L.marker(point, { icon, zIndexOffset: pick ? 1000 : active ? 900 : 0, title: p.name, keyboard: true })
      marker.on('click', () => onSelect?.(p.id))
      marker.bindTooltip(p.name, { direction: 'top', offset: [0, -size / 2] })
      group.addLayer(marker)
    }
    if (points.length)
      m.fitBounds(L.latLngBounds(points), {
        ...(paddingTopLeft ? { paddingTopLeft, paddingBottomRight: padding } : { padding }),
        maxZoom: 15,
        animate: false,
      })
  }, [places, pickId, activeId, onSelect, padding, paddingTopLeft])

  return <div ref={host} className={cn('isolate', className)} role="region" aria-label="Map of the shortlist" />
}
