import { Fragment, useEffect, useMemo, useState } from 'react';
import { MapContainer, Polyline, CircleMarker, Circle, Marker, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useStore } from '../app/store';
import { buildGraph, nodeLatLng, BASE } from '../routing/graph';
import { computeThreatEffects, threatStatus } from '../threats/effects';
import { THREAT_CATALOG, SEVERITY_LABEL } from '../threats/catalog';
import { routeLatLngs, nodesToEdges } from './geometry';
import { BaseMap, OnlineTiles } from './BaseMap';
import { AMENITY_COLOR, ALT, BLOCKED, COMPARE, DISCOVERED, PREV, ROUTE, ROUTE_CASING, SEV_COLOR } from '../styles/tokens';
import { iconSvg, type IconName } from '../components/Icon';
import { missionNow, remainingSupplies } from '../routing/planner';
import { CORRIDOR_RADIUS_M, TRANSIT_LNG } from '../data/scenario';
import { fmtAgo } from '../utils/format';
import type { Amenity, LatLng, ThreatReport } from '../types';

const [S, W, N, E] = BASE.meta.bbox;
const BOUNDS = L.latLngBounds([S, W], [N, E]);

function amenityIcon(a: Amenity, collectedOut: boolean) {
  const name: IconName = a.type;
  const color = AMENITY_COLOR[a.type];
  const cls = `amen-pin${a.compromised ? ' compromised' : ''}${collectedOut ? ' empty' : ''}${a.origin !== 'scenario' ? ' new' : ''}`;
  return L.divIcon({ className: cls, html: `<span style="--c:${color}">${iconSvg(name, 12, color)}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
}

const settlementIcon = L.divIcon({ className: 'beacon-pin', html: `<span>${iconSvg('beacon', 18, '#0b1520')}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] });
const shelterIcon = L.divIcon({ className: 'shelter-pin', html: `<span>${iconSvg('home', 13, '#cfd8e2')}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] });
const groupIcon = L.divIcon({ className: 'group-pin', html: '<span></span>', iconSize: [20, 20], iconAnchor: [10, 10] });
const gpsIcon = L.divIcon({ className: 'gps-pin', html: '<span></span>', iconSize: [14, 14], iconAnchor: [7, 7] });

function threatIcon(t: ThreatReport, fresh: boolean) {
  const sim = t.source === 'simulated';
  return L.divIcon({
    className: `threat-pin sev${t.severity}${fresh ? ' fresh' : ''}${t.status === 'resolved' ? ' resolved' : ''}${sim ? ' sim' : ''}`,
    html: `<span>${t.severity}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function FocusController() {
  const map = useMap();
  const { focus } = useStore();
  useEffect(() => {
    if (focus) map.flyTo(focus.latlng, focus.zoom ?? Math.max(map.getZoom(), 17), { duration: 0.6 });
  }, [focus, map]);
  return null;
}

function InteractionLayer() {
  const { mode, setMode, dispatch, setPicked } = useStore();
  const map = useMapEvents({
    dblclick(e) {
      if (mode.kind === 'simulate') {
        const r = dispatch({ type: 'simulate', category: mode.category, severity: mode.severity, latlng: [e.latlng.lat, e.latlng.lng] });
        if (r.ok) setMode({ kind: 'idle' });
      }
    },
    click(e) {
      const p: LatLng = [e.latlng.lat, e.latlng.lng];
      if (mode.kind === 'compare') setMode({ kind: 'compare', points: [...mode.points, p] });
      else if (mode.kind === 'path') {
        const pts = [...mode.points, p];
        setMode({ kind: 'path', points: pts.slice(-2) });
      } else if (mode.kind === 'pick') {
        setPicked(p);
        setMode({ kind: 'idle' });
      }
    },
  });
  // While a threat is armed, double-click places it instead of zooming.
  useEffect(() => {
    if (mode.kind === 'simulate' || mode.kind === 'compare' || mode.kind === 'path') map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    map.getContainer().classList.toggle('armed', mode.kind !== 'idle');
  }, [mode, map]);
  return null;
}

/** Re-measure when the layout changes (tab switch on mobile, panel resize). */
function SizeWatcher() {
  const map = useMap();
  // exposed for automated UI tests only
  (window as unknown as { __lbMap?: L.Map }).__lbMap = map;
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export function MapView({ onlineTiles, gps }: { onlineTiles: boolean; gps: LatLng | null }) {
  const { state, plan, layers, mode, compare, previewRoute, mapStatus, picked } = useStore();
  const g = useMemo(() => buildGraph(state.paths), [state.paths]);
  const now = missionNow(state, Date.now());
  const effects = useMemo(() => computeThreatEffects(g, state, now), [g, state.threats, state.config]); // eslint-disable-line react-hooks/exhaustive-deps
  const rec = plan.recommended;
  const recLine = useMemo(() => (rec ? routeLatLngs(g, rec.nodes, rec.edges) : []), [g, rec]);
  const alts = useMemo(() => plan.alternatives.filter((r) => r.id !== rec?.id).map((r) => ({ id: r.id, name: r.name, status: r.status, line: routeLatLngs(g, r.nodes, r.edges) })), [g, plan, rec]);
  const prevLine = useMemo(() => (state.previousRoute ? routeLatLngs(g, state.previousRoute, nodesToEdges(g, state.previousRoute)) : []), [g, state.previousRoute]);
  const compareLine = useMemo(() => (compare?.route ? routeLatLngs(g, compare.route.nodes, compare.route.edges) : []), [g, compare]);
  const walked = useMemo(() => routeLatLngs(g, state.trail, nodesToEdges(g, state.trail)), [g, state.trail]);
  const blocked = useMemo(() => [...effects.entries()].filter(([, v]) => v.blocked).map(([id]) => g.edges.get(id)!.g), [effects, g]);
  const danger = useMemo(() => [...effects.entries()].filter(([, v]) => !v.blocked && v.level >= 2).map(([id]) => g.edges.get(id)!.g), [effects, g]);
  const latestSim = state.simulatedIds[state.simulatedIds.length - 1];
  const [animKey, setAnimKey] = useState(0);
  useEffect(() => setAnimKey((k) => k + 1), [rec?.id]);
  const pos = nodeLatLng(g, state.position);
  const settlement = nodeLatLng(g, g.landmarks.settlement);
  const shelter = nodeLatLng(g, g.landmarks.shelter);

  return (
    <MapContainer
      className="map"
      center={[43.7355, 7.4235]}
      zoom={15}
      minZoom={14}
      maxZoom={19}
      maxBounds={BOUNDS.pad(0.15)}
      zoomControl={false}
      attributionControl
      preferCanvas={false}
    >
      <OnlineTiles enabled={onlineTiles} />
      <BaseMap hidden={onlineTiles && mapStatus.online === 'available'} />
      <FocusController />
      <InteractionLayer />
      <SizeWatcher />

      {/* zones: transit line and evacuation corridor */}
      {layers.zones && (
        <>
          <Polyline positions={[[43.7290, TRANSIT_LNG], [43.7445, TRANSIT_LNG]]} pathOptions={{ color: '#9fb0c2', weight: 1, dashArray: '2 6', opacity: 0.7, interactive: false }} />
          <Circle center={settlement} radius={CORRIDOR_RADIUS_M} pathOptions={{ color: ROUTE, weight: 1, dashArray: '3 5', fillOpacity: 0.04, interactive: false }} />
        </>
      )}

      {/* blocked and dangerous segments */}
      {layers.threats && danger.map((line, i) => <Polyline key={`d${i}`} positions={line} pathOptions={{ color: SEV_COLOR[2], weight: 5, opacity: 0.45, interactive: false }} />)}
      {layers.threats && blocked.map((line, i) => <Polyline key={`b${i}`} positions={line} pathOptions={{ color: BLOCKED, weight: 6, opacity: 0.9, dashArray: '2 5', lineCap: 'butt', interactive: false }} />)}

      {/* discovered paths */}
      {layers.paths &&
        state.paths.map((p) => {
          const a = g.nodes.get(p.a);
          const b = g.nodes.get(p.b);
          if (!a || !b) return null;
          const style = p.validation !== 'valid' ? { color: '#8a98a8', dashArray: '1 6' } : p.verified ? { color: DISCOVERED } : { color: DISCOVERED, dashArray: '6 5' };
          return (
            <Polyline key={p.id} positions={[[a.lat, a.lng], [b.lat, b.lng]]} pathOptions={{ ...style, weight: 3 }}>
              <Tooltip sticky>{`${p.note}: ${p.validation === 'valid' ? (p.verified ? 'verified path' : 'new path, unverified') : 'not routable'}`}</Tooltip>
            </Polyline>
          );
        })}

      {/* walked trail */}
      {walked.length > 1 && <Polyline positions={walked} pathOptions={{ color: '#cfd8e2', weight: 3, opacity: 0.55, interactive: false }} />}

      {/* alternatives, previous route, recommended route */}
      {layers.alternatives &&
        alts.map((a) => (
          <Polyline key={a.id} positions={a.line} pathOptions={{ color: previewRoute === a.id ? '#e6eef7' : ALT, weight: previewRoute === a.id ? 5 : 3.5, opacity: previewRoute === a.id ? 1 : 0.85, dashArray: '7 6' }}>
            <Tooltip sticky>{`${a.name}: ${a.status.toLowerCase()}`}</Tooltip>
          </Polyline>
        ))}
      {prevLine.length > 1 && <Polyline positions={prevLine} pathOptions={{ color: PREV, weight: 4, opacity: 0.45, dashArray: '1 7', interactive: false }} />}
      {layers.route && recLine.length > 1 && (
        <>
          <Polyline positions={recLine} pathOptions={{ color: ROUTE_CASING, weight: 9, opacity: 0.9, interactive: false }} />
          <Polyline key={`r${animKey}`} positions={recLine} pathOptions={{ color: ROUTE, weight: 5, opacity: 1, className: 'route-draw', interactive: false }} />
        </>
      )}
      {compareLine.length > 1 && <Polyline positions={compareLine} pathOptions={{ color: COMPARE, weight: 4, dashArray: '8 6', opacity: 0.95, interactive: false }} />}
      {mode.kind === 'compare' && mode.points.length > 0 && (
        <>
          <Polyline positions={mode.points} pathOptions={{ color: COMPARE, weight: 3, dashArray: '2 6', interactive: false }} />
          {mode.points.map((p, i) => (
            <CircleMarker key={i} center={p} radius={3} pathOptions={{ color: COMPARE, fillOpacity: 1, interactive: false }} />
          ))}
        </>
      )}
      {mode.kind === 'path' && mode.points.map((p, i) => <CircleMarker key={i} center={p} radius={5} pathOptions={{ color: DISCOVERED, fillOpacity: 1, interactive: false }} />)}
      {picked && <CircleMarker center={picked} radius={7} pathOptions={{ color: '#ffffff', weight: 2, fillOpacity: 0, interactive: false }} />}

      {/* amenities */}
      {state.amenities
        .filter((a) => layers[a.type])
        .map((a) => {
          const rem = remainingSupplies(state, a.id);
          const out = !(rem.water || rem.food || rem.medkits);
          return (
            <Marker key={a.id} position={[a.lat, a.lng]} icon={amenityIcon(a, out)}>
              <Popup>
                <div className="pop">
                  <strong>{a.name}</strong>
                  <div className="pop-sub">
                    {a.type === 'cache' ? 'Supply cache' : a.type[0].toUpperCase() + a.type.slice(1)}
                    {a.origin !== 'scenario' ? `, ${a.origin}` : ''}
                    {a.compromised ? ', compromised' : ''}
                  </div>
                  <div>
                    Supplies: {[rem.water ? `${rem.water} L water` : '', rem.food ? `${rem.food} meals` : '', rem.medkits ? `${rem.medkits} medkit` : ''].filter(Boolean).join(', ') || 'none left'}
                  </div>
                  <div className="pop-sub">Last report {fmtAgo(now - a.reportedAt)}. Scenario quantities.</div>
                  {a.notes && <div className="pop-sub">{a.notes}</div>}
                </div>
              </Popup>
            </Marker>
          );
        })}

      {/* threats */}
      {layers.threats &&
        state.threats
          .filter((t) => THREAT_CATALOG[t.category].kind !== 'cache')
          .map((t) => {
            const st = threatStatus(t, now, state.config.staleAfterMin);
            const spec = THREAT_CATALOG[t.category];
            return (
              <Fragment key={t.id}>
                {t.status === 'active' && spec.spillRadiusM > 0 && (
                  <Circle center={[t.lat, t.lng]} radius={spec.spillRadiusM} pathOptions={{ color: SEV_COLOR[t.severity], weight: 1, opacity: 0.5, fillOpacity: t.id === latestSim ? 0.16 : 0.08, interactive: false, className: t.id === latestSim ? 'zone-pulse' : undefined }} />
                )}
                <Marker position={[t.lat, t.lng]} icon={threatIcon(t, t.id === latestSim)} zIndexOffset={t.severity * 100}>
                  <Popup>
                    <div className="pop">
                      <strong>
                        {spec.label}, level {t.severity}
                      </strong>
                      <div className="pop-sub">
                        {SEVERITY_LABEL[t.severity]}
                        {t.impassable && t.severity === 3 ? ', impassable' : ''}. {t.place}
                      </div>
                      <div>{t.description}</div>
                      <div className="pop-sub">
                        {t.source === 'simulated' ? 'SIMULATED event' : `Source: ${t.reporter}`}, confidence {Math.round(t.confidence * 100)}%, {st}, {fmtAgo(now - t.updatedAt)}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              </Fragment>
            );
          })}

      <Marker position={shelter} icon={shelterIcon}>
        <Tooltip direction="top" offset={[0, -10]}>Fontvieille Shelter (start)</Tooltip>
      </Marker>
      <Marker position={settlement} icon={settlementIcon} zIndexOffset={500}>
        <Tooltip direction="top" offset={[0, -16]}>Larvotto Settlement, evacuation beacon</Tooltip>
      </Marker>
      <Marker position={pos} icon={groupIcon} zIndexOffset={1000}>
        <Tooltip direction="right" offset={[10, 0]}>Aarav and Mira (simulated position)</Tooltip>
      </Marker>
      {gps && (
        <Marker position={gps} icon={gpsIcon} zIndexOffset={900}>
          <Tooltip>This device (GPS)</Tooltip>
        </Marker>
      )}
    </MapContainer>
  );
}
