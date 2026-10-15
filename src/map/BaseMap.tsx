/**
 * Offline base map: vector OpenStreetMap extract bundled with the app (public/map/basemap.json),
 * drawn with Leaflet's canvas renderer. Cached by the service worker, so it renders with no network.
 *
 * Optional online raster tiles (CARTO dark basemap, OSM data) can be layered on top when online.
 * They are NOT cached by the service worker: tile providers restrict bulk/offline caching.
 */
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { BASEMAP } from '../styles/tokens';
import { useStore } from '../app/store';

interface Basemap {
  meta: { source: string; snapshot: string; area: string; bbox: [number, number, number, number] };
  land: [number, number][][] | null;
  buildings: [number, number][][];
  parks: [number, number][][];
  water: [number, number][][];
  piers: [number, number][][];
  roads: { c: 'major' | 'minor' | 'steps' | 'path'; t: 0 | 1; g: [number, number][] }[];
  labels: { t: string; lat: number; lng: number; a: number; z: number }[];
  places: { t: string; lat: number; lng: number }[];
}

let cache: Promise<Basemap> | null = null;
export function loadBasemap(): Promise<Basemap> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}map/basemap.json`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    cache.catch(() => (cache = null));
  }
  return cache;
}

export function BaseMap({ hidden }: { hidden: boolean }) {
  const map = useMap();
  const { setMapStatus } = useStore();
  const groupRef = useRef<L.LayerGroup | null>(null);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  useEffect(() => {
    let alive = true;
    const group = L.layerGroup();
    groupRef.current = group;
    const labels = L.layerGroup();
    if (!map.getPane('base')) {
      map.createPane('base').style.zIndex = '250';
      map.createPane('labels').style.zIndex = '390';
      map.getPane('labels')!.style.pointerEvents = 'none';
    }
    const renderer = L.canvas({ padding: 0.5, pane: 'base' });
    setMapStatus({ offline: 'loading' });
    loadBasemap()
      .then((b) => {
        if (!alive) return;
        const poly = (rings: [number, number][][], o: L.PolylineOptions) => rings.forEach((r) => L.polygon(r, { ...o, renderer, interactive: false }).addTo(group));
        if (b.land) poly(b.land, { stroke: false, fillColor: BASEMAP.land, fillOpacity: 1 });
        poly(b.parks, { stroke: false, fillColor: BASEMAP.park, fillOpacity: 1 });
        poly(b.water, { stroke: false, fillColor: BASEMAP.water, fillOpacity: 1 });
        poly(b.buildings, { color: BASEMAP.buildingStroke, weight: 0.5, fillColor: BASEMAP.building, fillOpacity: 1 });
        b.piers.forEach((g) => L.polyline(g, { renderer, color: BASEMAP.pier, weight: 3, interactive: false }).addTo(group));
        const order = { path: 0, steps: 1, minor: 2, major: 3 } as const;
        [...b.roads]
          .sort((x, y) => order[x.c] - order[y.c])
          .forEach((r) =>
            L.polyline(r.g, {
              renderer,
              interactive: false,
              color: r.t ? BASEMAP.tunnel : r.c === 'major' ? BASEMAP.major : r.c === 'minor' ? BASEMAP.minor : BASEMAP.path,
              weight: r.c === 'major' ? 4 : r.c === 'minor' ? 2.6 : 1.2,
              dashArray: r.t ? '4 4' : r.c === 'steps' ? '1.5 2.5' : undefined,
              opacity: 1,
            }).addTo(group),
          );
        b.labels.forEach((l) =>
          L.marker([l.lat, l.lng], {
            pane: 'labels',
            interactive: false,
            keyboard: false,
            icon: L.divIcon({ className: `street-label z${l.z}`, html: `<span style="transform:translate(-50%,-50%) rotate(${l.a}deg)">${l.t}</span>`, iconSize: [0, 0] }),
          }).addTo(labels),
        );
        b.places.forEach((p) =>
          L.marker([p.lat, p.lng], { pane: 'labels', interactive: false, keyboard: false, icon: L.divIcon({ className: 'place-label', html: `<span>${p.t}</span>`, iconSize: [0, 0] }) }).addTo(labels),
        );
        map.attributionControl?.addAttribution('Offline map: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL), 2016 extract');
        if (!hiddenRef.current) group.addTo(map);
        labels.addTo(map);
        setMapStatus({ offline: 'available' });
      })
      .catch(() => alive && setMapStatus({ offline: 'unavailable' }));
    return () => {
      alive = false;
      group.remove();
      labels.remove();
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    if (hidden) g.remove();
    else if (g.getLayers().length) g.addTo(map);
  }, [hidden, map]);

  // zoom classes control label density
  useEffect(() => {
    const el = map.getContainer();
    const apply = () => {
      const z = Math.round(map.getZoom());
      el.classList.toggle('show-z16', z >= 16);
      el.classList.toggle('show-z17', z >= 17);
    };
    apply();
    map.on('zoomend', apply);
    return () => {
      map.off('zoomend', apply);
    };
  }, [map]);
  return null;
}

/** Online raster tiles, only when the user turns them on and the browser reports a connection. */
export function OnlineTiles({ enabled }: { enabled: boolean }) {
  const map = useMap();
  const { setMapStatus, online } = useStore();
  useEffect(() => {
    if (!enabled) {
      setMapStatus({ online: 'off' });
      return;
    }
    if (!online) {
      setMapStatus({ online: 'unavailable' });
      return;
    }
    setMapStatus({ online: 'loading' });
    const layer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
      opacity: 0.85,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    });
    let ok = false;
    layer.on('tileload', () => {
      if (!ok) {
        ok = true;
        setMapStatus({ online: 'available' });
      }
    });
    layer.on('tileerror', () => !ok && setMapStatus({ online: 'unavailable' }));
    layer.addTo(map);
    layer.bringToBack();
    return () => {
      layer.remove();
    };
  }, [enabled, online, map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
