/**
 * Route planner: generates alternatives with Dijkstra, evaluates feasibility (deadline, supplies, energy,
 * threats), evaluates supply detours, picks a recommendation and explains it. Pure and deterministic:
 * plan(state, now) always returns the same result for the same inputs.
 *
 * Alternatives: "iterative penalty" method. Run Dijkstra on the composite cost; multiply the cost of
 * every edge on the found route by 1.6 and run again; keep routes that share < 80% of their length with
 * routes already kept. Penalties only steer the search: every route is then scored on its true cost.
 *
 * Recommendation rule:
 *   feasible = passable AND arrives before the deadline AND supplies/energy last the whole route
 *   1. among feasible routes with no level >= 2 hazard, the lowest composite cost
 *   2. otherwise the lowest-cost feasible route (flagged HIGH RISK)
 *   3. otherwise, supply detours that make a route feasible
 *   4. otherwise NO recommendation: the planner reports why every route fails
 *   A supply stop is recommended over a feasible direct route only when it addresses a reserve or medical
 *   need, adds no higher threat level, keeps >= 10 min deadline margin and costs <= 1.6x the direct route.
 */
import type { MissionState, PlanResult, RouteEvaluation, RouteStatus, Severity, SupplyStop, Supplies } from '../types';
import { buildGraph, type RuntimeGraph } from './graph';
import { dijkstra, dijkstraTree, extractPath, type PathResult } from './dijkstra';
import { edgeCost, edgeTravelMin, makeContext, type CostContext, type EdgeCostBreakdown } from './cost';
import { energyCost, groupPace, describeModifiers } from '../survivors/rules';
import { combined, groupReserve } from '../resources/consumption';
import { THREAT_CATALOG } from '../threats/catalog';
import { fmtDuration, fmtL, pct, round2 } from '../utils/format';

export const STOP_MINUTES = 4;

export function missionNow(state: MissionState, realNow: number): number {
  return realNow + state.simElapsedMs;
}

export function costTable(ctx: CostContext): Map<string, EdgeCostBreakdown> {
  const m = new Map<string, EdgeCostBreakdown>();
  for (const e of ctx.graph.edges.values()) m.set(e.id, edgeCost(ctx, e));
  return m;
}

export function remainingSupplies(state: MissionState, amenityId: string): Supplies {
  const a = state.amenities.find((x) => x.id === amenityId);
  if (!a) return {};
  const taken = state.collected[amenityId] ?? {};
  return {
    water: Math.max(0, (a.supplies.water ?? 0) - (taken.water ?? 0)),
    food: Math.max(0, (a.supplies.food ?? 0) - (taken.food ?? 0)),
    medkits: Math.max(0, (a.supplies.medkits ?? 0) - (taken.medkits ?? 0)),
  };
}

/* ------------------------------------------------------------------ evaluation */

export interface EvalOptions {
  id?: string;
  name?: string;
  stops?: SupplyStop[];
  approximate?: boolean;
  notes?: string[];
}

export function evaluateRoute(ctx: CostContext, table: Map<string, EdgeCostBreakdown>, path: { nodes: string[]; edges: string[] }, opts: EvalOptions = {}): RouteEvaluation {
  const { state, graph } = ctx;
  const cfg = state.config.consumption;
  let survivors = ctx.survivors.map((s) => ({ ...s }));
  const n = survivors.length;
  const start = combined(state);
  let water = start.water;
  let food = start.food;
  let medkits = start.medkits;
  const energyLeft: Record<string, number> = Object.fromEntries(survivors.map((s) => [s.id, s.energy]));
  const energyUsed: Record<string, number> = Object.fromEntries(survivors.map((s) => [s.id, 0]));
  let travel = 0;
  let dist = 0;
  let waterNeed = 0;
  let foodNeed = 0;
  let cost = 0;
  let wU = 0;
  let maxSeverity: Severity = 0;
  let blockedSegments = 0;
  let waterShort = false;
  let foodShort = false;
  const terms = { T: 0, R: 0, S: 0, U: 0, H: 0 };
  const hazardIds = new Set<string>();
  const significant = new Set<string>();
  const stops = opts.stops ?? [];

  for (let i = 0; i < path.edges.length; i++) {
    const e = graph.edges.get(path.edges[i]);
    if (!e) continue;
    const b = table.get(e.id) ?? edgeCost(ctx, e);
    const t = edgeTravelMin(ctx, e, groupPace(survivors));
    travel += t;
    dist += e.len;
    cost += b.C;
    terms.T += b.T;
    terms.R += b.R;
    terms.S += b.S;
    terms.U += b.U;
    terms.H += b.H;
    wU += b.uncertainty * e.len;
    const th = ctx.effects.get(e.id);
    if (th) {
      if (th.level > maxSeverity) maxSeverity = th.level;
      if (th.blocked) blockedSegments++;
      for (const id of th.threatIds) {
        hazardIds.add(id);
        const rep = state.threats.find((x) => x.id === id);
        if (rep && rep.severity >= 2) significant.add(id);
      }
    }
    const wNeed = (cfg.waterPerHour * t * n) / 60;
    const fNeed = (cfg.foodPerHour * t * n) / 60;
    waterNeed += wNeed;
    foodNeed += fNeed;
    water -= wNeed;
    food -= fNeed;
    if (water < -1e-6) waterShort = true;
    if (food < -1e-6) foodShort = true;
    for (const s of survivors) {
      const c = energyCost(s, e, cfg.energyPerKm);
      energyUsed[s.id] += c;
      energyLeft[s.id] -= c;
    }
    // supply stop at the node we just reached
    const at = path.nodes[i + 1];
    for (const st of stops.filter((x) => x.nodeId === at)) {
      water += st.gain.water ?? 0;
      food += st.gain.food ?? 0;
      medkits += st.gain.medkits ?? 0;
      travel += STOP_MINUTES;
      if (st.treat && medkits > 0) {
        const hurt = survivors.find((s) => s.injured);
        if (hurt) {
          medkits -= 1;
          survivors = survivors.map((s) => (s.id === hurt.id ? { ...s, injured: false } : s));
        }
      }
    }
  }

  const arrivalAt = ctx.now + travel * 60000;
  const deadlineMarginMin = (state.deadline - arrivalAt) / 60000;
  const deadlineOk = deadlineMarginMin >= 0;
  const shortages: string[] = [];
  if (waterShort) shortages.push(`Water: needs ${fmtL(waterNeed)}, group carries ${fmtL(start.water)}`);
  if (foodShort) shortages.push(`Food: needs ${foodNeed.toFixed(2)} meals, group carries ${start.food.toFixed(2)}`);
  for (const s of ctx.survivors) if (energyLeft[s.id] < 0) shortages.push(`${s.name} runs out of energy (needs ${Math.round(energyUsed[s.id])}, has ${Math.round(s.energy)})`);
  const reserve = groupReserve(cfg, n);
  const belowReserve: string[] = [];
  if (!waterShort && water < reserve.water) belowReserve.push(`Water ends at ${fmtL(Math.max(0, water))}, below the ${fmtL(reserve.water)} reserve`);
  if (!foodShort && food < reserve.food) belowReserve.push(`Food ends at ${Math.max(0, food).toFixed(2)} meals, below the ${reserve.food.toFixed(1)} reserve`);
  for (const s of ctx.survivors) if (energyLeft[s.id] >= 0 && energyLeft[s.id] < 15) belowReserve.push(`${s.name} arrives with energy ${Math.round(energyLeft[s.id])}`);
  const resourcesOk = shortages.length === 0;

  const threatScore = terms.R;
  let threatLabel: RouteEvaluation['threatLabel'] =
    threatScore <= 0.001 ? 'Clear' : threatScore < 0.6 ? 'Low' : threatScore < 2 ? 'Moderate' : threatScore < 5 ? 'High' : 'Critical';
  if (maxSeverity >= 3 && (threatLabel === 'Low' || threatLabel === 'Moderate')) threatLabel = 'High';
  if (blockedSegments > 0) threatLabel = 'Critical';

  let status: RouteStatus;
  if (blockedSegments > 0) status = 'HIGH RISK';
  else if (!deadlineOk) status = 'DEADLINE INFEASIBLE';
  else if (!resourcesOk) status = 'RESOURCE SHORTAGE';
  else if (maxSeverity >= 2 || threatLabel === 'High' || threatLabel === 'Critical') status = 'HIGH RISK';
  else status = 'FEASIBLE';

  const notes = [...(opts.notes ?? [])];
  if (blockedSegments > 0) notes.push(`Crosses ${blockedSegments} impassable segment${blockedSegments > 1 ? 's' : ''}`);
  const uncertainty = dist > 0 ? wU / dist : 0;

  // main streets: named streets covering >= 120 m, in travel order
  const lenBy = new Map<string, number>();
  const order: string[] = [];
  for (const id of path.edges) {
    const e = graph.edges.get(id);
    if (!e?.name || e.name.startsWith('Shelter') || e.name.startsWith('Settlement')) continue;
    if (!lenBy.has(e.name)) order.push(e.name);
    lenBy.set(e.name, (lenBy.get(e.name) ?? 0) + e.len);
  }
  const streets = order.filter((nm) => (lenBy.get(nm) ?? 0) >= 120).slice(0, 6);

  return {
    id: opts.id ?? routeId(path.edges),
    name: opts.name ?? 'Route',
    streets,
    nodes: path.nodes,
    edges: path.edges,
    distanceM: dist,
    travelMin: travel,
    arrivalAt,
    cost,
    threatScore,
    threatLabel,
    maxSeverity,
    significantHazards: significant.size,
    hazardIds: [...hazardIds],
    uncertainty,
    confidence: 1 - uncertainty,
    water: round2(waterNeed),
    food: round2(foodNeed),
    energy: Object.fromEntries(Object.entries(energyUsed).map(([k, v]) => [k, round2(v)])),
    resourcesOk,
    belowReserve,
    shortages,
    deadlineOk,
    deadlineMarginMin,
    status,
    stops,
    terms,
    blockedSegments,
    approximate: opts.approximate,
    notes,
  };
}

export function isFeasible(r: RouteEvaluation): boolean {
  return r.blockedSegments === 0 && r.deadlineOk && r.resourcesOk;
}

function routeId(edges: string[]): string {
  let h = 2166136261;
  for (const e of edges) for (let i = 0; i < e.length; i++) h = Math.imul(h ^ e.charCodeAt(i), 16777619);
  return `r${(h >>> 0).toString(36)}`;
}

/** Evaluate an arbitrary path (e.g. the previous recommendation or a user-drawn route) against the current state. */
export function evaluatePath(state: MissionState, realNow: number, path: { nodes: string[]; edges: string[] }, opts: EvalOptions = {}): RouteEvaluation {
  const ctx = makeContext(buildGraph(state.paths), state, missionNow(state, realNow));
  return evaluateRoute(ctx, costTable(ctx), path, opts);
}

/* ------------------------------------------------------------------ alternatives */

function overlap(a: PathResult, b: PathResult, g: RuntimeGraph): number {
  const sb = new Set(b.edges);
  let shared = 0;
  let total = 0;
  for (const id of a.edges) {
    const l = g.edges.get(id)?.len ?? 0;
    total += l;
    if (sb.has(id)) shared += l;
  }
  return total > 0 ? shared / total : 1;
}

export function candidatePaths(ctx: CostContext, table: Map<string, EdgeCostBreakdown>, from: string, to: string, k = 3): PathResult[] {
  const penalty = new Map<string, number>();
  const out: PathResult[] = [];
  for (let it = 0; it < 8 && out.length < k; it++) {
    const p = dijkstra(ctx.graph, from, to, (e) => {
      const b = table.get(e.id)!;
      if (b.blocked) return null;
      return b.C * (penalty.get(e.id) ?? 1);
    });
    if (!p) break;
    if (out.every((q) => overlap(p, q, ctx.graph) < 0.8)) out.push(p);
    for (const id of p.edges) penalty.set(id, (penalty.get(id) ?? 1) * 1.6);
  }
  return out;
}

/** Short street name: "Boulevard des Moulins" -> "Moulins", "Tunnel Rocher Palais" -> "Rocher Palais". */
export function shortStreet(name: string): string {
  return name
    .replace(/^(Boulevard|Avenue|Rue|Place|Quai|Rond-Point|Tunnel|Pont|Escalier|Chemin|Allée|Impasse|Square|Montée|Galerie)\s+/i, '')
    .replace(/^(des|de la|de l'|du|de|d')\s*/i, '')
    .trim();
}

/**
 * Name each route after up to three of its longest named streets (>= 150 m) that are not shared by every
 * other candidate, in travel order, e.g. "Via Rainier III, Grimaldi and Louis II". Letters break ties.
 */
export function nameRoutes(g: RuntimeGraph, paths: Array<{ edges: string[] }>): string[] {
  const lens = paths.map((p) => {
    const m = new Map<string, number>();
    const order: string[] = [];
    for (const id of p.edges) {
      const e = g.edges.get(id);
      if (!e?.name || e.name.startsWith('Shelter') || e.name.startsWith('Settlement')) continue;
      if (!m.has(e.name)) order.push(e.name);
      m.set(e.name, (m.get(e.name) ?? 0) + e.len);
    }
    return { m, order };
  });
  const names = lens.map(({ m, order }, i) => {
    const others = lens.filter((_, j) => j !== i);
    const common = (nm: string) => others.length > 0 && others.every((o) => (o.m.get(nm) ?? 0) >= 0.5 * (m.get(nm) ?? 0));
    const ranked = [...m.entries()].filter(([nm, l]) => !common(nm) && l >= 150).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const top = ranked.slice(0, 3).map(([nm]) => shortStreet(nm)).filter((x, k, arr) => arr.indexOf(x) === k);
    const ordered = top.sort((a, b) => order.findIndex((o) => shortStreet(o) === a) - order.findIndex((o) => shortStreet(o) === b));
    if (!ordered.length) return `Route ${String.fromCharCode(65 + i)}`;
    return `Via ${ordered.length > 1 ? `${ordered.slice(0, -1).join(', ')} and ${ordered[ordered.length - 1]}` : ordered[0]}`;
  });
  return names.map((n, i) => (names.indexOf(n) !== i ? `${n} (${String.fromCharCode(65 + i)})` : n));
}

/* ------------------------------------------------------------------ plan */

function pickBest(list: RouteEvaluation[]): RouteEvaluation | null {
  const safe = list.filter((r) => r.maxSeverity < 2).sort((a, b) => a.cost - b.cost);
  if (safe.length) return safe[0];
  const any = list.slice().sort((a, b) => a.cost - b.cost);
  return any[0] ?? null;
}

const TERM_LABEL: Record<string, string> = {
  T: 'longer travel time',
  R: 'higher threat exposure',
  S: 'higher supply use',
  U: 'more uncertain roads',
  H: 'more strenuous for the group',
};

function whyNot(rec: RouteEvaluation, other: RouteEvaluation, state: MissionState): string {
  if (other.blockedSegments > 0) return `${other.name}: crosses an impassable segment.`;
  if (!other.deadlineOk) return `${other.name}: arrives ${fmtDuration(-other.deadlineMarginMin)} after the beacon closes.`;
  if (!other.resourcesOk) return `${other.name}: ${other.shortages[0]}.`;
  if (other.maxSeverity >= 2 && rec.maxSeverity < 2) {
    const t = state.threats.find((x) => other.hazardIds.includes(x.id) && x.severity >= 2);
    return `${other.name}: passes a level ${other.maxSeverity} hazard${t ? ` (${THREAT_CATALOG[t.category].label.toLowerCase()}, ${t.place})` : ''}.`;
  }
  const w = state.config.weights as unknown as Record<string, number>;
  const deltas = (['T', 'R', 'S', 'U', 'H'] as const).map((k) => [k, (other.terms[k] - rec.terms[k]) * w[`w${k}`]] as const);
  deltas.sort((a, b) => b[1] - a[1]);
  const [k] = deltas[0];
  const dt = other.travelMin - rec.travelMin;
  const extra = k === 'T' || Math.abs(dt) >= 1 ? ` (${dt >= 0 ? '+' : ''}${Math.round(dt)} min)` : k === 'U' ? ` (${pct(other.uncertainty)} vs ${pct(rec.uncertainty)} uncertainty)` : '';
  return `${other.name}: ${TERM_LABEL[k]}${extra}, cost ${other.cost.toFixed(1)} vs ${rec.cost.toFixed(1)}.`;
}

export function plan(state: MissionState, realNow: number): PlanResult {
  const now = missionNow(state, realNow);
  const graph = buildGraph(state.paths);
  const ctx = makeContext(graph, state, now);
  const table = costTable(ctx);
  const from = state.position;
  const to = graph.landmarks.settlement;
  const result: PlanResult = { recommended: null, alternatives: [], reason: [], infeasibleReasons: [], detourConsidered: false, detourNote: null };

  if (from === to) {
    result.reason.push('The group is at the settlement.');
    return result;
  }

  const paths = candidatePaths(ctx, table, from, to, 3);
  const names = nameRoutes(graph, paths);
  const direct = paths.map((p, i) => evaluateRoute(ctx, table, p, { name: names[i] }));

  if (direct.length === 0) {
    const blockers = state.threats.filter((t) => t.status === 'active' && t.severity === 3 && t.impassable);
    result.infeasibleReasons.push('No passable connection to the settlement exists on the known road network.');
    if (blockers.length) result.infeasibleReasons.push(`Impassable reports: ${blockers.map((b) => `${THREAT_CATALOG[b.category].label} at ${b.place}`).join('; ')}.`);
    result.infeasibleReasons.push('Revise or resolve a report if new information changes it, or mark a discovered path.');
    return result;
  }

  const feasibleDirect = direct.filter(isFeasible);
  let rec = pickBest(feasibleDirect);
  const bestDirect = rec ?? direct.slice().sort((a, b) => a.cost - b.cost)[0];

  // ---- supply detour evaluation
  const c = combined(state);
  const injured = state.survivors.filter((s) => s.injured);
  const needs: string[] = [];
  if (!bestDirect.resourcesOk) needs.push('shortage');
  else if (bestDirect.belowReserve.some((x) => x.startsWith('Water') || x.startsWith('Food'))) needs.push('reserve');
  if (injured.length && c.medkits === 0) needs.push('medical');
  let detours: RouteEvaluation[] = [];
  if (needs.length) {
    result.detourConsidered = true;
    const w = (e: { id: string }) => {
      const b = table.get(e.id)!;
      return b.blocked ? null : b.C;
    };
    const fromTree = dijkstraTree(graph, from, w);
    const toTree = dijkstraTree(graph, to, w);
    const wantMed = needs.includes('medical');
    const wantFood = needs.some((x) => x === 'shortage' || x === 'reserve');
    const options = state.amenities
      .filter((a) => !a.compromised)
      .map((a) => ({ a, rem: remainingSupplies(state, a.id) }))
      .filter(({ rem }) => (wantFood && ((rem.water ?? 0) > 0 || (rem.food ?? 0) > 0)) || (wantMed && (rem.medkits ?? 0) > 0))
      .filter(({ a }) => fromTree.dist.has(a.node) && toTree.dist.has(a.node) && a.node !== from)
      .sort((x, y) => fromTree.dist.get(x.a.node)! + toTree.dist.get(x.a.node)! - (fromTree.dist.get(y.a.node)! + toTree.dist.get(y.a.node)!) || x.a.id.localeCompare(y.a.id))
      .slice(0, 5);
    for (const { a, rem } of options) {
      const p1 = extractPath(fromTree, from, a.node);
      const p2 = extractPath(toTree, to, a.node);
      if (!p1 || !p2) continue;
      const nodes = [...p1.nodes, ...p2.nodes.slice().reverse().slice(1)];
      const edges = [...p1.edges, ...p2.edges.slice().reverse()];
      const stop: SupplyStop = { amenityId: a.id, nodeId: a.node, name: a.name, gain: rem, treat: wantMed && (rem.medkits ?? 0) > 0 };
      detours.push(evaluateRoute(ctx, table, { nodes, edges }, { name: `Supply stop: ${a.name}`, stops: [stop] }));
    }
    detours = detours.sort((x, y) => x.cost - y.cost);
    const fd = detours.filter(isFeasible);
    const bestDetour = pickBest(fd);
    if (!rec && bestDetour) {
      rec = bestDetour;
      result.reason.push(`No direct route is feasible with current supplies. A stop at ${bestDetour.stops[0].name} makes the trip feasible.`);
    } else if (rec && bestDetour && !needs.includes('shortage')) {
      const extraMin = bestDetour.travelMin - rec.travelMin;
      if (bestDetour.maxSeverity <= rec.maxSeverity && bestDetour.deadlineMarginMin >= 10 && bestDetour.cost <= rec.cost * 1.6) {
        result.reason.push(
          needs.includes('medical')
            ? `${injured.map((s) => s.name).join(' and ')} injured with no medkit: a stop at ${bestDetour.stops[0].name} (+${Math.round(extraMin)} min) allows treatment.`
            : `Supplies would end below reserve: a stop at ${bestDetour.stops[0].name} (+${Math.round(extraMin)} min) restores the reserve without adding threat exposure.`,
        );
        rec = bestDetour;
      } else {
        result.detourNote = `Supply stop at ${bestDetour.stops[0].name} evaluated but not recommended: ${
          bestDetour.maxSeverity > rec.maxSeverity ? 'it adds a higher threat level' : bestDetour.deadlineMarginMin < 10 ? 'it leaves under 10 min before the beacon closes' : `it costs ${(bestDetour.cost / rec.cost).toFixed(1)}x the direct route`
        }.`;
      }
    } else if (!bestDetour && needs.length) {
      result.detourNote = detours.length
        ? `Supply stops evaluated (${detours.length}); none is feasible: ${detours[0].shortages[0] ?? (detours[0].deadlineOk ? 'high risk' : 'misses the deadline')}.`
        : 'No reachable supply location has the needed supplies.';
    }
  }

  const all = [...direct];
  if (rec && rec.stops.length) all.unshift(rec);
  result.alternatives = all.map((r) => (rec && r.id === rec.id && r.stops.length === rec.stops.length ? { ...r, status: 'RECOMMENDED' as RouteStatus } : r));

  if (!rec) {
    result.infeasibleReasons.push('No feasible route: every candidate fails a hard constraint.');
    for (const r of [...direct, ...detours.slice(0, 2)]) result.infeasibleReasons.push(whyNot(direct[0], r, state).replace(/, cost.*$/, '.'));
    return result;
  }

  result.recommended = { ...rec, status: 'RECOMMENDED' };
  const others = direct.filter((r) => r.id !== rec!.id);
  if (rec.maxSeverity >= 2) result.reason.push('Every feasible route passes a level 2+ hazard; this one has the lowest overall cost. Proceed with caution.');
  else if (!result.reason.length) result.reason.push(`Lowest composite cost (${rec.cost.toFixed(1)}) of ${direct.filter(isFeasible).length} feasible route${direct.filter(isFeasible).length === 1 ? '' : 's'}, threat exposure ${rec.threatLabel.toLowerCase()}.`);
  for (const o of others.slice(0, 2)) result.reason.push(whyNot(rec, o, state));
  const mods = describeModifiers(state.survivors);
  if (mods.length) result.reason.push(`Survivor condition applied: ${mods.join('; ')}.`);
  if (injured.length && c.medkits > 0) result.reason.push(`A medkit is available: treating ${injured[0].name} would restore normal pace.`);
  result.reason.push(
    rec.resourcesOk
      ? `Supplies cover the trip: ${fmtL(rec.water)} water and ${rec.food.toFixed(2)} meals needed; group carries ${fmtL(c.water)} and ${c.food.toFixed(2)}.`
      : `Supplies do not cover the trip.`,
  );
  return result;
}
