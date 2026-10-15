import baseJson from '../data/graph.json';
import type { BaseGraph, DiscoveredPath, LatLng, MapNode, RoadEdge } from '../types';
import { haversine, pointPolylineDistance } from '../utils/geo';

export const BASE: BaseGraph = baseJson as unknown as BaseGraph;

export interface RuntimeEdge extends RoadEdge {
  origin: 'osm' | 'discovered';
  pathId?: string;
  pathVerified?: boolean;
}

export interface Adj {
  edge: string;
  to: string;
}

export interface RuntimeGraph {
  nodes: Map<string, MapNode>;
  edges: Map<string, RuntimeEdge>;
  adj: Map<string, Adj[]>;
  landmarks: BaseGraph['landmarks'];
  meta: BaseGraph['meta'];
}

let baseCache: RuntimeGraph | null = null;

function buildBase(): RuntimeGraph {
  const nodes = new Map<string, MapNode>();
  for (const n of BASE.nodes) nodes.set(n.id, n);
  const edges = new Map<string, RuntimeEdge>();
  const adj = new Map<string, Adj[]>();
  for (const e of BASE.edges) {
    edges.set(e.id, { ...e, origin: 'osm' });
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push({ edge: e.id, to: e.b });
    adj.get(e.b)!.push({ edge: e.id, to: e.a });
  }
  return { nodes, edges, adj, landmarks: BASE.landmarks, meta: BASE.meta };
}

/** The OSM street graph plus validated discovered paths. Discovered paths that failed validation are not routable. */
export function buildGraph(paths: DiscoveredPath[]): RuntimeGraph {
  if (!baseCache) baseCache = buildBase();
  const valid = paths.filter((p) => p.validation === 'valid');
  if (valid.length === 0) return baseCache;
  const edges = new Map(baseCache.edges);
  const adj = new Map<string, Adj[]>();
  for (const [k, v] of baseCache.adj) adj.set(k, v.slice());
  for (const p of valid) {
    const a = baseCache.nodes.get(p.a);
    const b = baseCache.nodes.get(p.b);
    if (!a || !b) continue;
    const e: RuntimeEdge = {
      id: `dp:${p.id}`,
      a: p.a,
      b: p.b,
      len: p.len,
      hw: p.terrain === 'stairs' ? 'steps' : p.terrain === 'rough' ? 'path' : 'footway',
      name: p.note || 'Discovered path',
      steps: p.terrain === 'stairs' ? 1 : 0,
      tunnel: 0,
      g: [
        [a.lat, a.lng],
        [b.lat, b.lng],
      ],
      know: p.verified ? 'verified' : 'unexplored',
      age: 0,
      statusKnown: p.verified,
      origin: 'discovered',
      pathId: p.id,
      pathVerified: p.verified,
    };
    edges.set(e.id, e);
    adj.get(p.a)!.push({ edge: e.id, to: p.b });
    adj.get(p.b)!.push({ edge: e.id, to: p.a });
  }
  return { nodes: baseCache.nodes, edges, adj, landmarks: baseCache.landmarks, meta: baseCache.meta };
}

export function baseGraph(): RuntimeGraph {
  if (!baseCache) baseCache = buildBase();
  return baseCache;
}

export function nodeLatLng(g: RuntimeGraph, id: string): LatLng {
  const n = g.nodes.get(id)!;
  return [n.lat, n.lng];
}

export function nearestNode(g: RuntimeGraph, p: LatLng, maxDist = Infinity, exclude?: (id: string) => boolean): { id: string; dist: number } | null {
  let best: { id: string; dist: number } | null = null;
  for (const n of g.nodes.values()) {
    if (exclude && exclude(n.id)) continue;
    if (!g.adj.get(n.id)?.length) continue;
    const d = haversine(p, [n.lat, n.lng]);
    if (d <= maxDist && (!best || d < best.dist)) best = { id: n.id, dist: d };
  }
  return best;
}

export function nearestEdge(g: RuntimeGraph, p: LatLng, maxDist = Infinity): { id: string; dist: number } | null {
  let best: { id: string; dist: number } | null = null;
  for (const e of g.edges.values()) {
    // quick reject using first point (edges are short, < ~600 m)
    if (haversine(p, e.g[0]) > maxDist + e.len) continue;
    const d = pointPolylineDistance(p, e.g);
    if (d <= maxDist && (!best || d < best.dist)) best = { id: e.id, dist: d };
  }
  return best;
}

/** Best human-readable place name near a point: landmark node, then street name. */
export function placeName(g: RuntimeGraph, p: LatLng): string {
  for (const n of g.nodes.values()) {
    if (n.name && haversine(p, [n.lat, n.lng]) < 60) return n.name;
  }
  const e = nearestEdge(g, p, 80);
  if (e) {
    const edge = g.edges.get(e.id)!;
    if (edge.name) return edge.name;
  }
  return `${p[0].toFixed(5)}, ${p[1].toFixed(5)}`;
}

export function edgeOther(e: RoadEdge, from: string): string {
  return e.a === from ? e.b : e.a;
}
