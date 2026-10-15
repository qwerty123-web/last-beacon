/**
 * Home-screen warnings, derived from state on every render (they disappear when the cause goes away).
 * priority = severity weight x relevance (on route > near > elsewhere) x confidence; top items are shown.
 */
import type { MissionState, PlanResult } from '../types';
import { THREAT_CATALOG } from '../threats/catalog';
import { combined, groupReserve } from '../resources/consumption';
import { missionNow } from '../routing/planner';
import { threatStatus } from '../threats/effects';
import { fmtDuration, fmtL } from '../utils/format';

export type WarnLevel = 'critical' | 'caution' | 'clear';

export interface Warning {
  id: string;
  level: WarnLevel;
  text: string;
  priority: number;
}

export function deriveWarnings(state: MissionState, p: PlanResult, realNow: number, env: { mapAvailable: boolean }): Warning[] {
  const out: Warning[] = [];
  const now = missionNow(state, realNow);
  const rec = p.recommended;
  const onRoute = new Set(rec?.hazardIds ?? []);

  if (!rec && state.position !== 'settlement') out.push({ id: 'noroute', level: 'critical', text: p.infeasibleReasons[0] ?? 'No feasible route.', priority: 100 });

  for (const t of state.threats) {
    if (t.status !== 'active' || THREAT_CATALOG[t.category].kind === 'cache') continue;
    const relevant = onRoute.has(t.id);
    if (!relevant && t.severity < 3) continue;
    const prio = (t.severity * 10 + (relevant ? 30 : 0)) * (0.5 + t.confidence / 2);
    out.push({
      id: `t-${t.id}`,
      level: t.severity >= 2 ? 'critical' : 'caution',
      text: `${relevant ? 'On route' : 'Nearby'}: ${THREAT_CATALOG[t.category].label.toLowerCase()} L${t.severity} at ${t.place}${t.source === 'simulated' ? ' (simulated)' : ''}${threatStatus(t, now, state.config.staleAfterMin) === 'stale' ? ', report stale' : ''}.`,
      priority: prio,
    });
  }

  const c = combined(state);
  const res = groupReserve(state.config.consumption, state.survivors.length);
  if (rec && !rec.resourcesOk) out.push({ id: 'short', level: 'critical', text: `Insufficient supplies: ${rec.shortages[0]}.`, priority: 80 });
  if (c.water < res.water) out.push({ id: 'water', level: 'critical', text: `Water ${fmtL(c.water)} is below the ${fmtL(res.water)} reserve.`, priority: 70 });
  else if (rec && rec.belowReserve.some((x) => x.startsWith('Water'))) out.push({ id: 'water2', level: 'caution', text: rec.belowReserve.find((x) => x.startsWith('Water'))!, priority: 40 });
  if (c.food < res.food) out.push({ id: 'food', level: 'caution', text: `Food ${c.food.toFixed(2)} meals is below the reserve.`, priority: 45 });

  for (const s of state.survivors) {
    if (s.health < 40) out.push({ id: `h-${s.id}`, level: 'critical', text: `${s.name}'s health is ${Math.round(s.health)}.`, priority: 60 });
    else if (s.injured) out.push({ id: `i-${s.id}`, level: 'caution', text: `${s.name} is injured: the group moves at reduced pace.${c.medkits ? ' A medkit is available.' : ''}`, priority: 50 });
    if (s.energy < 25) out.push({ id: `e-${s.id}`, level: 'caution', text: `${s.name}'s energy is ${Math.round(s.energy)}.`, priority: 42 });
  }

  const left = (state.deadline - now) / 60000;
  if (!state.stageCompletedAt[5]) {
    if (left <= 0) out.push({ id: 'dl', level: 'critical', text: 'The evacuation beacon has shut down.', priority: 110 });
    else if (rec && !rec.deadlineOk) out.push({ id: 'dl2', level: 'critical', text: `Recommended route arrives ${fmtDuration(-rec.deadlineMarginMin)} after the beacon closes.`, priority: 90 });
    else if (rec && rec.deadlineMarginMin < 15) out.push({ id: 'dl3', level: 'caution', text: `Only ${fmtDuration(rec.deadlineMarginMin)} of margin before the beacon closes.`, priority: 55 });
    else if (left < 30) out.push({ id: 'dl4', level: 'caution', text: `Beacon closes in ${fmtDuration(left)}.`, priority: 50 });
  }

  for (const path of state.paths) {
    if (path.validation === 'valid' && !path.verified && rec?.edges.includes(`dp:${path.id}`)) out.push({ id: `p-${path.id}`, level: 'caution', text: `Route uses an unverified discovered path (${path.note}).`, priority: 35 });
  }
  if (state.syncConflicts.length) out.push({ id: 'sync', level: 'caution', text: `QR sync conflict: ${state.syncConflicts[state.syncConflicts.length - 1]}.`, priority: 38 });
  if (!env.mapAvailable) out.push({ id: 'map', level: 'caution', text: 'Offline map data unavailable. Routing still works; the base map cannot be drawn.', priority: 30 });

  return out.sort((a, b) => b.priority - a.priority);
}
