/**
 * COMPARE ROUTE: map a user-drawn line onto the road graph, then evaluate it like any planner route.
 *
 * Corridor-constrained map matching: one Dijkstra search from the group to the settlement where each
 * segment's weight grows with its distance d from the drawn line:
 *      w(e) = len(e) x (1 + min(40, (d / 30 m)^2))
 * so the cheapest path is the one that follows the drawing along real streets. Blocked segments are
 * allowed (the comparison then shows they are impassable).
 *
 *   coverage  = share of the points the user placed that lie within 45 m of the matched route
 *               (the straight lines between clicks are interpolation, so they are not scored)
 *   inferred  = matched segments more than 45 m from the drawing (needed to connect it to the group,
 *               the settlement or between distant points)
 * The result is labelled approximate when coverage < 60% or inferred > 35% of its length. A drawn line is
 * never treated as a road in itself.
 */
import type { LatLng, MissionState, RouteEvaluation } from '../types';
import { buildGraph, type RuntimeEdge, type RuntimeGraph } from './graph';
import { dijkstra } from './dijkstra';
import { evaluatePath } from './planner';
import { pointPolylineDistance, resample, haversine } from '../utils/geo';
import { routeLatLngs } from '../map/geometry';

export interface MatchResult {
  nodes: string[];
  edges: string[];
  coverage: number;
  inferredM: number;
  drawnM: number;
  notes: string[];
  valid: boolean;
}

const NEAR_M = 45;

function edgeDeviation(e: RuntimeEdge, drawn: LatLng[]): number {
  const pts = e.g.length <= 5 ? e.g : [e.g[0], e.g[Math.floor(e.g.length / 4)], e.g[Math.floor(e.g.length / 2)], e.g[Math.floor((3 * e.g.length) / 4)], e.g[e.g.length - 1]];
  let sum = 0;
  for (const p of pts) sum += pointPolylineDistance(p, drawn);
  return sum / pts.length;
}

export function matchDrawnPath(g: RuntimeGraph, drawn: LatLng[], from: string, to: string): MatchResult {
  const notes: string[] = [];
  const dev = new Map<string, number>();
  // cheap pre-filter: segments far from the drawing's bounding box get the max factor without exact math
  const lats = drawn.map((p) => p[0]);
  const lngs = drawn.map((p) => p[1]);
  const pad = 0.003;
  const [s, n, w, e] = [Math.min(...lats) - pad, Math.max(...lats) + pad, Math.min(...lngs) - pad, Math.max(...lngs) + pad];
  for (const edge of g.edges.values()) {
    const [la, ln] = edge.g[0];
    dev.set(edge.id, la < s || la > n || ln < w || ln > e ? 1e4 : edgeDeviation(edge, drawn));
  }
  const p = dijkstra(g, from, to, (edge) => edge.len * (1 + Math.min(40, (dev.get(edge.id)! / 30) ** 2)));
  if (!p) return { nodes: [], edges: [], coverage: 0, inferredM: 0, drawnM: 0, notes: ['The drawing could not be connected to the settlement on the mapped road network.'], valid: false };

  let inferredM = 0;
  let total = 0;
  for (const id of p.edges) {
    const edge = g.edges.get(id)!;
    total += edge.len;
    if (dev.get(id)! > NEAR_M) inferredM += edge.len;
  }
  const line = routeLatLngs(g, p.nodes, p.edges);
  const samples = drawn.length >= 2 ? drawn : resample(drawn, 25);
  const covered = samples.filter((q) => pointPolylineDistance(q, line) <= NEAR_M).length;
  const coverage = samples.length ? covered / samples.length : 0;
  const drawnM = total - inferredM;
  if (coverage < 0.6) notes.push(`Only ${Math.round(coverage * 100)}% of the drawing follows mapped roads. Redraw along streets for an exact comparison.`);
  if (inferredM > 0) notes.push(`${Math.round(inferredM)} m inferred to connect the drawing to the group and the settlement.`);
  const startGap = haversine(drawn[0], line[0]);
  if (startGap > 150) notes.push(`Your drawing starts ${Math.round(startGap)} m from the group; the connection was inferred.`);
  return { nodes: p.nodes, edges: p.edges, coverage, inferredM, drawnM, notes, valid: true };
}

export function compareDrawn(state: MissionState, realNow: number, drawn: LatLng[]): { route: RouteEvaluation | null; match: MatchResult } {
  const g = buildGraph(state.paths);
  const match = matchDrawnPath(g, drawn, state.position, g.landmarks.settlement);
  if (!match.valid || match.edges.length === 0) return { route: null, match };
  const approximate = match.coverage < 0.6 || match.inferredM > 0.35 * (match.inferredM + match.drawnM);
  const route = evaluatePath(state, realNow, { nodes: match.nodes, edges: match.edges }, { name: 'Your route', approximate, notes: match.notes });
  return { route, match };
}
