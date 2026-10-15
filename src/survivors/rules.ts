/**
 * Transparent, rule-based survivor modifiers. These are fictional planning rules for a prototype,
 * NOT a medical or clinical assessment of anyone.
 *
 * Pace (travel-time) multiplier per survivor  -> the group moves at the SLOWEST survivor's pace
 *   injured            x0.75
 *   energy < 30        x0.85
 *   health < 40        x0.85
 * Fatigue multiplier (scales the H term)        -> the group uses the WORST survivor
 *   1 + 0.5 if energy < 40, + 1.0 more if energy < 20, + 0.5 if injured
 * Cognitive penalty (scales the U term by 1 + penalty) -> WORST survivor
 *   cognition < 50 -> 0.5,  cognition < 30 -> 1.0
 * Energy cost of a segment for a survivor
 *   km x energyPerKm x terrainEnergy x (1.3 if injured) x (1.15 if health < 50)
 */
import type { RoadEdge, SurvivorState } from '../types';

export function paceMultiplier(s: SurvivorState): number {
  let m = 1;
  if (s.injured) m *= 0.75;
  if (s.energy < 30) m *= 0.85;
  if (s.health < 40) m *= 0.85;
  return m;
}

export function groupPace(survivors: SurvivorState[]): number {
  return Math.min(...survivors.map(paceMultiplier));
}

export function fatigueMultiplier(s: SurvivorState): number {
  let m = 1;
  if (s.energy < 40) m += 0.5;
  if (s.energy < 20) m += 1.0;
  if (s.injured) m += 0.5;
  return m;
}

export function groupFatigue(survivors: SurvivorState[]): number {
  return Math.max(...survivors.map(fatigueMultiplier));
}

export function cognitivePenalty(s: SurvivorState): number {
  if (s.cognition < 30) return 1.0;
  if (s.cognition < 50) return 0.5;
  return 0;
}

export function groupCognitivePenalty(survivors: SurvivorState[]): number {
  return Math.max(...survivors.map(cognitivePenalty));
}

/** Terrain multipliers: stairs and unpaved paths are slower and more tiring. */
export function terrainTime(e: Pick<RoadEdge, 'steps' | 'hw'>): number {
  return 1 + 0.6 * e.steps + (e.hw === 'path' || e.hw === 'track' ? 0.1 : 0);
}

export function terrainEnergy(e: Pick<RoadEdge, 'steps' | 'hw'>): number {
  return 1 + 1.2 * e.steps + (e.hw === 'path' || e.hw === 'track' ? 0.3 : 0);
}

export function energyCost(s: SurvivorState, e: Pick<RoadEdge, 'steps' | 'hw' | 'len'>, energyPerKm: number): number {
  let c = (e.len / 1000) * energyPerKm * terrainEnergy(e);
  if (s.injured) c *= 1.3;
  if (s.health < 50) c *= 1.15;
  return c;
}

/** Plain-language explanation of active modifiers, for the UI. */
export function describeModifiers(survivors: SurvivorState[]): string[] {
  const out: string[] = [];
  for (const s of survivors) {
    if (s.injured) out.push(`${s.name} injured: pace x0.75, energy use x1.3`);
    if (s.energy < 30) out.push(`${s.name} energy ${Math.round(s.energy)}: pace x0.85`);
    else if (s.energy < 40) out.push(`${s.name} energy ${Math.round(s.energy)}: long routes cost more`);
    if (s.health < 40) out.push(`${s.name} health ${Math.round(s.health)}: pace x0.85`);
    if (s.cognition < 50) out.push(`${s.name} cognition ${Math.round(s.cognition)}: uncertain roads penalised x${(1 + cognitivePenalty(s)).toFixed(1)}`);
  }
  return out;
}
