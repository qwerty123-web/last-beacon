/**
 * Group movement along the recommended route. Each traversed segment:
 *   - advances the mission clock by its travel time at the group's current pace (simulated travel)
 *   - consumes water/food per survivor and energy per survivor (resources/consumption.ts)
 *   - becomes verified knowledge (walked)
 * Movement stops at decision points: the shelter exit, the transit line, a planned supply stop,
 * the corridor boundary, the settlement, or after ~`budgetMin` minutes in step mode.
 */
import type { MissionState, PlanResult } from '../types';
import { buildGraph, nodeLatLng } from '../routing/graph';
import { edgeTravelMin } from '../routing/cost';
import { STOP_MINUTES, missionNow, remainingSupplies } from '../routing/planner';
import { energyCost, groupPace } from '../survivors/rules';
import { applyConsumption } from '../resources/consumption';
import { CORRIDOR_RADIUS_M, TRANSIT_LNG } from '../data/scenario';
import { haversine } from '../utils/geo';
import { round2 } from '../utils/format';

export type AdvanceMode = 'step' | 'checkpoint';

export interface AdvanceResult {
  state: MissionState;
  moved: boolean;
  message: string;
}

export function collectAt(state: MissionState, amenityId: string, now: number): { state: MissionState; message: string } {
  const a = state.amenities.find((x) => x.id === amenityId);
  if (!a) return { state, message: 'Unknown location.' };
  if (a.node !== state.position) return { state, message: `The group is not at ${a.name}.` };
  if (a.compromised) return { state, message: `${a.name} is reported compromised. Supplies not collected.` };
  const rem = remainingSupplies(state, amenityId);
  if (!(rem.water || rem.food || rem.medkits)) return { state, message: `${a.name} has no supplies left.` };
  const taken = state.collected[amenityId] ?? {};
  const shared = {
    ...state.shared,
    water: round2(state.shared.water + (rem.water ?? 0)),
    food: round2(state.shared.food + (rem.food ?? 0)),
    medkits: state.shared.medkits + (rem.medkits ?? 0),
  };
  const parts = [rem.water ? `${rem.water} L water` : '', rem.food ? `${rem.food} meals` : '', rem.medkits ? `${rem.medkits} medkit(s)` : ''].filter(Boolean).join(', ');
  return {
    state: {
      ...state,
      shared,
      collected: {
        ...state.collected,
        [amenityId]: { water: (taken.water ?? 0) + (rem.water ?? 0), food: (taken.food ?? 0) + (rem.food ?? 0), medkits: (taken.medkits ?? 0) + (rem.medkits ?? 0) },
      },
      simElapsedMs: state.simElapsedMs + STOP_MINUTES * 60000,
      log: [...state.log, { at: now, kind: 'supply', text: `Collected ${parts} at ${a.name} into the shared pack.` }],
    },
    message: `Collected ${parts} at ${a.name}.`,
  };
}

export function advance(state: MissionState, p: PlanResult, realNow: number, mode: AdvanceMode, budgetMin = 6): AdvanceResult {
  const r = p.recommended;
  if (!r) return { state, moved: false, message: p.infeasibleReasons[0] ?? 'No feasible route: the group holds position.' };
  if (state.survivors.some((s) => s.health <= 0)) return { state, moved: false, message: 'A survivor cannot continue.' };
  const g = buildGraph(state.paths);
  const settlement = nodeLatLng(g, g.landmarks.settlement);
  let s = state;
  let spent = 0;
  let reason = '';
  const startNow = missionNow(state, realNow);
  const wasEast = state.trail.some((id) => (g.nodes.get(id)?.lng ?? 0) >= TRANSIT_LNG);
  const wasInCorridor = haversine(nodeLatLng(g, state.position), settlement) <= CORRIDOR_RADIUS_M;

  for (let i = 0; i < r.edges.length; i++) {
    const e = g.edges.get(r.edges[i])!;
    const next = r.nodes[i + 1];
    const t = edgeTravelMin({ state: s }, e, groupPace(s.survivors));
    const energy = Object.fromEntries(s.survivors.map((sv) => [sv.id, energyCost(sv, e, s.config.consumption.energyPerKm)]));
    const now = startNow + (spent + t) * 60000;
    const c = applyConsumption(s.survivors, s.shared, t, energy, s.config.consumption, now);
    spent += t;
    s = {
      ...s,
      survivors: c.survivors,
      shared: c.shared,
      position: next,
      trail: [...s.trail, next],
      walkedEdges: s.walkedEdges.includes(e.id) ? s.walkedEdges : [...s.walkedEdges, e.id],
      walkedM: s.walkedM + e.len,
      simElapsedMs: s.simElapsedMs + t * 60000,
    };
    if (c.deficit.water + c.deficit.food > 0.01) {
      reason = 'Supplies ran out on the move.';
      break;
    }
    if (next === g.landmarks.exit && !state.trail.includes(next)) {
      reason = 'Reached the Shelter Exit Point.';
      break;
    }
    if (!wasEast && (g.nodes.get(next)?.lng ?? 0) >= TRANSIT_LNG) {
      reason = 'Crossed the Sainte-Dévote transit line.';
      break;
    }
    const stop = r.stops.find((x) => x.nodeId === next);
    if (stop) {
      const col = collectAt(s, stop.amenityId, now);
      s = col.state;
      if (stop.treat) {
        const hurt = s.survivors.find((x) => x.injured);
        if (hurt && s.shared.medkits + s.survivors.reduce((a, x) => a + x.inventory.medkits, 0) > 0) s = treat(s, hurt.id, now).state;
      }
      reason = `Supply stop: ${col.message}`;
      break;
    }
    if (!wasInCorridor && haversine(nodeLatLng(g, next), settlement) <= CORRIDOR_RADIUS_M) {
      reason = 'Entered the evacuation corridor.';
      break;
    }
    if (next === g.landmarks.settlement) {
      reason = 'Arrived at the Larvotto Settlement.';
      break;
    }
    if (mode === 'step' && spent >= budgetMin) {
      reason = `Moved ${Math.round(spent)} min along ${r.name}.`;
      break;
    }
  }
  const msg = reason || `Moved ${Math.round(spent)} min along ${r.name}.`;
  s = { ...s, log: [...s.log, { at: startNow + spent * 60000, kind: 'move', text: `${msg} (${Math.round(spent)} min, now near ${g.nodes.get(s.position)?.name ?? nearestStreet(g, s.position)}).` }] };
  return { state: s, moved: spent > 0, message: msg };
}

function nearestStreet(g: ReturnType<typeof buildGraph>, node: string): string {
  for (const { edge } of g.adj.get(node) ?? []) {
    const n = g.edges.get(edge)?.name;
    if (n) return n;
  }
  return 'an unnamed path';
}

/** Use one medkit (personal first, then shared) to treat an injured survivor. */
export function treat(state: MissionState, survivorId: string, now: number): { state: MissionState; message: string } {
  const sv = state.survivors.find((x) => x.id === survivorId);
  if (!sv) return { state, message: 'Unknown survivor.' };
  if (!sv.injured && sv.health >= 100) return { state, message: `${sv.name} does not need treatment.` };
  let survivors = state.survivors;
  let shared = state.shared;
  const own = sv.inventory.medkits > 0 ? sv : state.survivors.find((x) => x.inventory.medkits > 0);
  if (own) survivors = survivors.map((x) => (x.id === own.id ? { ...x, inventory: { ...x.inventory, medkits: x.inventory.medkits - 1 } } : x));
  else if (shared.medkits > 0) shared = { ...shared, medkits: shared.medkits - 1 };
  else return { state, message: 'No medkit available. Look for a pharmacy on the map.' };
  survivors = survivors.map((x) =>
    x.id === survivorId ? { ...x, injured: false, health: Math.min(100, x.health + 15), flags: x.flags.filter((f) => f !== 'Injured'), updatedAt: now } : x,
  );
  return {
    state: { ...state, survivors, shared, log: [...state.log, { at: now, kind: 'health', text: `${sv.name} treated with a medkit (injury flag cleared, health +15).` }] },
    message: `${sv.name} treated.`,
  };
}
