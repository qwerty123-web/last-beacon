/**
 * Five mission stages with measurable completion conditions. Stages complete only from state
 * (position, trail, supplies, clock), never from a button press.
 *
 *  1 Escape the shelter      trail reaches the Shelter Exit Point node
 *  2 Cross the city          trail reaches a node east of the Sainte-Dévote transit line (lng >= TRANSIT_LNG),
 *                            walked along planned routes
 *  3 Secure supplies         after stage 2: supplies cover the remaining recommended route AND stay above
 *                            the group reserve, OR an explicit exception has been recorded
 *  4 Evacuation corridor     after stage 3: the group stands within CORRIDOR_RADIUS_M of the settlement
 *  5 Final beacon            after stage 4: the group is at the settlement before the deadline, both survivors alive
 */
import type { MissionState, PlanResult, StageId } from '../types';
import { BASE } from '../routing/graph';
import { CORRIDOR_RADIUS_M, TRANSIT_LNG } from '../data/scenario';
import { haversine } from '../utils/geo';
import { combined, groupReserve } from '../resources/consumption';
import { missionNow } from '../routing/planner';
import { THREAT_CATALOG } from '../threats/catalog';
import { fmtL } from '../utils/format';

export interface StageView {
  id: StageId;
  title: string;
  objective: string;
  condition: string;
  status: 'complete' | 'active' | 'pending' | 'failed';
  progress: number;
  requirements: string[];
  threats: string[];
  completedAt?: number;
  note?: string;
}

const nodeById = new Map(BASE.nodes.map((n) => [n.id, n]));
const pos = (id: string): [number, number] => {
  const n = nodeById.get(id)!;
  return [n.lat, n.lng];
};

export function suppliesSufficient(state: MissionState, p: PlanResult): { ok: boolean; detail: string } {
  const r = p.recommended;
  if (!r) return { ok: false, detail: 'No feasible route to measure remaining needs against.' };
  if (r.stops.length) return { ok: false, detail: `Planner recommends a supply stop at ${r.stops[0].name}.` };
  const short = !r.resourcesOk || r.belowReserve.some((x) => x.startsWith('Water') || x.startsWith('Food'));
  const c = combined(state);
  const res = groupReserve(state.config.consumption, state.survivors.length);
  const detail = `Remaining route needs ${fmtL(r.water)} water + ${r.food.toFixed(2)} meals, reserve ${fmtL(res.water)} + ${res.food.toFixed(2)}; group carries ${fmtL(c.water)} + ${c.food.toFixed(2)}.`;
  return { ok: !short, detail };
}

/** Returns stage completions that are newly satisfied by the current state. */
export function checkStages(state: MissionState, p: PlanResult, realNow: number): Partial<Record<StageId, number>> {
  const done = { ...state.stageCompletedAt };
  const now = missionNow(state, realNow);
  const lm = BASE.landmarks;
  const out: Partial<Record<StageId, number>> = {};
  if (!done[1] && state.trail.includes(lm.exit) && state.position !== lm.shelter) out[1] = done[1] = now;
  if (done[1] && !done[2] && state.trail.some((id) => nodeById.get(id) && nodeById.get(id)!.lng >= TRANSIT_LNG)) out[2] = done[2] = now;
  if (done[2] && !done[3] && (state.stage3Exception || suppliesSufficient(state, p).ok)) out[3] = done[3] = now;
  if (done[3] && !done[4] && haversine(pos(state.position), pos(lm.settlement)) <= CORRIDOR_RADIUS_M) out[4] = done[4] = now;
  if (done[4] && !done[5] && state.position === lm.settlement && now <= state.deadline && state.survivors.every((s) => s.health > 0)) out[5] = done[5] = now;
  return out;
}

export function stageViews(state: MissionState, p: PlanResult, realNow: number): StageView[] {
  const lm = BASE.landmarks;
  const now = missionNow(state, realNow);
  const done = state.stageCompletedAt;
  const late = now > state.deadline;
  const here = pos(state.position);
  const start = pos(lm.shelter);
  const settle = pos(lm.settlement);
  const exitP = pos(lm.exit);
  const active = ([1, 2, 3, 4, 5] as StageId[]).find((id) => !done[id]) ?? null;
  const rec = p.recommended;
  const threatsOnRoute = (filter: (lng: number) => boolean) =>
    state.threats
      .filter((t) => t.status === 'active' && THREAT_CATALOG[t.category].kind !== 'cache' && rec?.hazardIds.includes(t.id) && filter(t.lng))
      .map((t) => `L${t.severity} ${THREAT_CATALOG[t.category].label} at ${t.place}`);
  const status = (id: StageId): StageView['status'] => (done[id] ? 'complete' : late ? 'failed' : active === id ? 'active' : 'pending');
  const maxLng = Math.max(...state.trail.map((id) => nodeById.get(id)?.lng ?? 0));
  const sup = suppliesSufficient(state, p);
  const c = combined(state);
  const dSettle = haversine(here, settle);

  return [
    {
      id: 1,
      title: 'Escape the shelter',
      objective: 'Leave the Fontvieille Shelter and reach the Shelter Exit Point.',
      condition: 'The group reaches the exit node.',
      status: status(1),
      progress: done[1] ? 1 : state.position === lm.shelter ? 0 : Math.min(0.99, 1 - haversine(here, exitP) / Math.max(1, haversine(start, exitP))),
      requirements: ['None'],
      threats: threatsOnRoute((lng) => lng < exitP[1] + 0.002),
      completedAt: done[1],
    },
    {
      id: 2,
      title: 'Cross the city',
      objective: 'Cross La Condamine to the Sainte-Dévote transit line.',
      condition: `The group reaches a node east of longitude ${TRANSIT_LNG} along a planned route.`,
      status: status(2),
      progress: done[2] ? 1 : Math.max(0, Math.min(0.99, (maxLng - start[1]) / (TRANSIT_LNG - start[1]))),
      requirements: rec ? [`${fmtL(rec.water)} water and ${rec.food.toFixed(2)} meals for the full route`] : ['A feasible route'],
      threats: threatsOnRoute((lng) => lng < TRANSIT_LNG),
      completedAt: done[2],
    },
    {
      id: 3,
      title: 'Secure essential supplies',
      objective: 'Collect or confirm enough water and food for the rest of the journey.',
      condition: 'Supplies cover the remaining route and stay above reserve, or an exception is recorded.',
      status: status(3),
      progress: done[3] ? 1 : rec ? Math.min(0.99, Math.min(c.water / Math.max(0.01, rec.water + state.config.consumption.reserveWater * 2), c.food / Math.max(0.01, rec.food + state.config.consumption.reserveFood * 2))) : 0,
      requirements: [sup.detail],
      threats: rec?.stops.length ? threatsOnRoute(() => true) : [],
      completedAt: done[3],
      note: state.stage3Exception ? `Exception recorded: ${state.stage3Exception}` : undefined,
    },
    {
      id: 4,
      title: 'Reach the evacuation corridor',
      objective: 'Reach the approach zone around the Larvotto Settlement.',
      condition: `The group is within ${CORRIDOR_RADIUS_M} m of the settlement via a feasible route.`,
      status: status(4),
      progress: done[4] ? 1 : Math.max(0, Math.min(0.99, 1 - (dSettle - CORRIDOR_RADIUS_M) / Math.max(1, haversine(start, settle) - CORRIDOR_RADIUS_M))),
      requirements: ['Stage 3 complete'],
      threats: threatsOnRoute((lng) => lng >= TRANSIT_LNG),
      completedAt: done[4],
    },
    {
      id: 5,
      title: 'Reach the final beacon',
      objective: 'Enter the Larvotto Settlement before the beacon shuts down.',
      condition: 'The group is at the settlement before the deadline with both survivors alive.',
      status: status(5),
      progress: done[5] ? 1 : Math.max(0, Math.min(0.99, 1 - dSettle / Math.max(1, haversine(start, settle)))),
      requirements: ['Arrive before the deadline'],
      threats: threatsOnRoute((lng) => lng >= settle[1] - 0.004),
      completedAt: done[5],
    },
  ];
}

export function missionOutcome(state: MissionState, realNow: number): 'in-progress' | 'success' | 'failed' {
  if (state.stageCompletedAt[5]) return 'success';
  if (missionNow(state, realNow) > state.deadline) return 'failed';
  if (state.survivors.some((s) => s.health <= 0)) return 'failed';
  return 'in-progress';
}
