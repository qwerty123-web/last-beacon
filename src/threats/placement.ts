/**
 * Map a clicked coordinate to a road segment or location. Never corrupts the graph: a click too far
 * from any mapped road is rejected with an instruction to choose the nearest road instead.
 */
import type { Amenity, LatLng, MissionState, ThreatCategory, ThreatTarget } from '../types';
import { type RuntimeGraph, nearestEdge, nearestNode, nodeLatLng, placeName } from '../routing/graph';
import { THREAT_CATALOG } from './catalog';
import { haversine } from '../utils/geo';

export const SNAP_MAX_M = 60;

export type Placement =
  | { ok: true; target: ThreatTarget; lat: number; lng: number; place: string; snappedM: number }
  | { ok: false; error: string };

const EXCLUDED = new Set(['shelter', 'settlement']);

export function placeOnGraph(g: RuntimeGraph, p: LatLng, prefer: 'node' | 'edge'): Placement {
  const node = nearestNode(g, p, SNAP_MAX_M, (id) => EXCLUDED.has(id));
  const edge = nearestEdge(g, p, SNAP_MAX_M);
  if (!node && !edge) {
    return { ok: false, error: `No mapped road within ${SNAP_MAX_M} m of that point. Double-click on or next to a street or intersection.` };
  }
  // A node is used when preferred, or when it is clearly closer than any segment (intersections).
  const useNode = node && (prefer === 'node' ? node.dist <= SNAP_MAX_M * 0.75 || !edge : edge ? node.dist < edge.dist * 0.5 && node.dist < 15 : true);
  if (useNode && node) {
    const [lat, lng] = nodeLatLng(g, node.id);
    return { ok: true, target: { kind: 'node', id: node.id }, lat, lng, place: placeName(g, [lat, lng]), snappedM: node.dist };
  }
  const e = g.edges.get(edge!.id)!;
  // anchor the marker on the segment's closest geometry vertex
  let best = e.g[0];
  for (const q of e.g) if (haversine(p, q) < haversine(p, best)) best = q;
  return { ok: true, target: { kind: 'edge', id: e.id }, lat: p[0], lng: p[1], place: e.name || placeName(g, best), snappedM: edge!.dist };
}

export function placeThreat(g: RuntimeGraph, p: LatLng, category: ThreatCategory): Placement {
  return placeOnGraph(g, p, THREAT_CATALOG[category].snap);
}

export function findSafehouse(state: MissionState, p: LatLng, maxM = 150): Amenity | null {
  let best: { a: Amenity; d: number } | null = null;
  for (const a of state.amenities) {
    if (a.type !== 'safehouse') continue;
    const d = haversine(p, [a.lat, a.lng]);
    if (d <= maxM && (!best || d < best.d)) best = { a, d };
  }
  return best?.a ?? null;
}
