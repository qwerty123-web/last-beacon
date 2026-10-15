import type { LatLng } from '../types';
import type { RuntimeGraph } from '../routing/graph';

/** Polyline for a route: each edge's real street geometry, oriented in travel direction. */
export function routeLatLngs(g: RuntimeGraph, nodes: string[], edges: string[]): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < edges.length; i++) {
    const e = g.edges.get(edges[i]);
    if (!e) continue;
    const geo = e.a === nodes[i] ? e.g : [...e.g].reverse();
    for (const p of out.length ? geo.slice(1) : geo) out.push(p);
  }
  return out;
}

/** Polyline for a node list (used for the faint previous route where edges are unknown). */
export function nodesToEdges(g: RuntimeGraph, nodes: string[]): string[] {
  const edges: string[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const options = (g.adj.get(nodes[i]) ?? []).filter((x) => x.to === nodes[i + 1]);
    if (!options.length) return edges;
    options.sort((a, b) => g.edges.get(a.edge)!.len - g.edges.get(b.edge)!.len);
    edges.push(options[0].edge);
  }
  return edges;
}
