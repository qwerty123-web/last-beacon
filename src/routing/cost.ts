/**
 * Composite edge cost
 *
 *   C(e) = wT*T(e) + wR*R(e) + wS*S(e) + wU*U(e) + wH*H(e)
 *
 * Every factor is normalised against a 5-minute / 350 m reference segment so that, on a clear, known,
 * flat street, T, S, U-ish and H are each ~1 per reference segment and the weights are comparable:
 *
 *   T(e) travel time      = travelMin(e) / 5
 *                           travelMin = km / (baseSpeed x groupPace) x 60 x terrainTime
 *   R(e) threat exposure  = exposure(e) x clamp(len / 100, 0.3, 1.5)
 *                           exposure from threats/effects.ts (0 clear ... ~3.5 critical); scaled by time spent in it
 *   S(e) resource use     = ((water(e) / waterRef) + (food(e) / foodRef)) / 2 x scarcity
 *                           refs = what the group consumes in 5 minutes; scarcity = 1, +1 if water below reserve, +0.5 if food below reserve
 *   U(e) uncertainty      = U(e) from routing/uncertainty.ts x (len / 350) x (1 + cognitive penalty)
 *   H(e) health / energy  = mean survivor energy cost / (energy for 350 m flat) x group fatigue multiplier
 *
 * Blocked edges (impassable level 3 reports) are excluded from the graph search entirely.
 * Deterministic: the same state and clock produce the same costs.
 */
import type { MissionState, SurvivorState } from '../types';
import type { RuntimeEdge, RuntimeGraph } from './graph';
import { computeThreatEffects, type ThreatEffects } from '../threats/effects';
import { edgeUncertainty } from './uncertainty';
import { energyCost, groupCognitivePenalty, groupFatigue, groupPace, terrainTime } from '../survivors/rules';
import { combined, groupReserve } from '../resources/consumption';

export const T_REF_MIN = 5;
export const L_REF_M = 350;

export interface CostContext {
  graph: RuntimeGraph;
  effects: ThreatEffects;
  survivors: SurvivorState[];
  state: MissionState;
  now: number;
  pace: number;
  fatigue: number;
  cogPenalty: number;
  scarcity: number;
  walked: Set<string>;
  minutesSinceStart: number;
}

export interface EdgeCostBreakdown {
  C: number;
  T: number;
  R: number;
  S: number;
  U: number;
  H: number;
  travelMin: number;
  uncertainty: number;
  blocked: boolean;
}

export function makeContext(graph: RuntimeGraph, state: MissionState, now: number, effects?: ThreatEffects): CostContext {
  const survivors = state.survivors;
  const c = combined(state);
  const res = groupReserve(state.config.consumption, survivors.length);
  let scarcity = 1;
  if (c.water < res.water) scarcity += 1;
  if (c.food < res.food) scarcity += 0.5;
  return {
    graph,
    effects: effects ?? computeThreatEffects(graph, state, now),
    survivors,
    state,
    now,
    pace: groupPace(survivors),
    fatigue: groupFatigue(survivors),
    cogPenalty: groupCognitivePenalty(survivors),
    scarcity,
    walked: new Set(walkedEdges(state)),
    minutesSinceStart: (now - state.scenarioStartedAt) / 60000,
  };
}

export function walkedEdges(state: Pick<MissionState, 'trail'> & { walkedEdges?: string[] }): string[] {
  return state.walkedEdges ?? [];
}

export function edgeTravelMin(ctx: Pick<CostContext, 'state'>, e: RuntimeEdge, pace: number): number {
  const kmh = ctx.state.config.consumption.baseSpeedKmh * pace;
  return (e.len / 1000 / kmh) * 60 * terrainTime(e);
}

export function edgeCost(ctx: CostContext, e: RuntimeEdge): EdgeCostBreakdown {
  const w = ctx.state.config.weights;
  const cfg = ctx.state.config.consumption;
  const threat = ctx.effects.get(e.id);
  const travelMin = edgeTravelMin(ctx, e, ctx.pace);

  const T = travelMin / T_REF_MIN;
  const R = threat ? threat.exposure * Math.max(0.3, Math.min(1.5, e.len / 100)) : 0;

  const n = ctx.survivors.length;
  const waterRef = (cfg.waterPerHour * T_REF_MIN * n) / 60;
  const foodRef = (cfg.foodPerHour * T_REF_MIN * n) / 60;
  const water = (cfg.waterPerHour * travelMin * n) / 60;
  const food = (cfg.foodPerHour * travelMin * n) / 60;
  const S = ((waterRef > 0 ? water / waterRef : 0) + (foodRef > 0 ? food / foodRef : 0)) / 2 * ctx.scarcity;

  const uncertainty = edgeUncertainty(e, ctx.minutesSinceStart, ctx.walked.has(e.id), threat);
  const U = uncertainty * (e.len / L_REF_M) * (1 + ctx.cogPenalty);

  const refEnergy = (L_REF_M / 1000) * cfg.energyPerKm;
  const meanEnergy = ctx.survivors.reduce((s, sv) => s + energyCost(sv, e, cfg.energyPerKm), 0) / Math.max(1, n);
  const H = (refEnergy > 0 ? meanEnergy / refEnergy : 0) * ctx.fatigue;

  const C = w.wT * T + w.wR * R + w.wS * S + w.wU * U + w.wH * H;
  return { C, T, R, S, U, H, travelMin, uncertainty, blocked: !!threat?.blocked };
}
