/**
 * Consumption model (fictional demonstration rates, configurable in MissionConfig.consumption).
 *
 *   water needed = waterPerHour x hours x number of survivors
 *   food needed  = foodPerHour  x hours x number of survivors
 *   energy cost  = see survivors/rules.ts (distance, terrain, condition)
 *
 * Inventory accounting: each survivor carries a personal inventory; the group also has ONE shared pack.
 * Combined supply = sum of personal inventories + shared pack (each litre/meal counted exactly once).
 * Survivors draw from their own inventory first, then from the shared pack.
 */
import type { ConsumptionConfig, Inventory, MissionState, SurvivorState } from '../types';
import { round2 } from '../utils/format';

export type Resource = 'water' | 'food' | 'medkits';

export function combined(state: Pick<MissionState, 'survivors' | 'shared'>): Inventory {
  const c: Inventory = { water: state.shared.water, food: state.shared.food, medkits: state.shared.medkits };
  for (const s of state.survivors) {
    c.water += s.inventory.water;
    c.food += s.inventory.food;
    c.medkits += s.inventory.medkits;
  }
  return { water: round2(c.water), food: round2(c.food), medkits: Math.round(c.medkits) };
}

export function needFor(travelMin: number, survivors: number, cfg: ConsumptionConfig): { water: number; food: number } {
  const h = travelMin / 60;
  return { water: cfg.waterPerHour * h * survivors, food: cfg.foodPerHour * h * survivors };
}

/** Group reserve threshold (sum of per-survivor reserves). */
export function groupReserve(cfg: ConsumptionConfig, survivors: number): { water: number; food: number } {
  return { water: cfg.reserveWater * survivors, food: cfg.reserveFood * survivors };
}

/** Hours of travel the current supplies last for one survivor drawing on personal stock + an equal share of the pack. */
export function enduranceHours(s: SurvivorState, shared: Inventory, survivors: number, cfg: ConsumptionConfig): { water: number; food: number } {
  const w = s.inventory.water + shared.water / survivors;
  const f = s.inventory.food + shared.food / survivors;
  return { water: cfg.waterPerHour > 0 ? w / cfg.waterPerHour : Infinity, food: cfg.foodPerHour > 0 ? f / cfg.foodPerHour : Infinity };
}

/**
 * Apply consumption for `minutes` of travel and per-survivor energy costs.
 * Returns new survivors/shared plus any deficit (supplies that were needed but not available).
 */
export function applyConsumption(
  survivors: SurvivorState[],
  shared: MissionState['shared'],
  minutes: number,
  energy: Record<string, number>,
  cfg: ConsumptionConfig,
  now: number,
): { survivors: SurvivorState[]; shared: MissionState['shared']; deficit: { water: number; food: number } } {
  const sh = { ...shared };
  const deficit = { water: 0, food: 0 };
  const out = survivors.map((s) => {
    const inv = { ...s.inventory };
    const need = { water: (cfg.waterPerHour * minutes) / 60, food: (cfg.foodPerHour * minutes) / 60 };
    for (const r of ['water', 'food'] as const) {
      let n = need[r];
      const own = Math.min(inv[r], n);
      inv[r] = round2(inv[r] - own);
      n -= own;
      const fromPack = Math.min(sh[r], n);
      sh[r] = round2(sh[r] - fromPack);
      n -= fromPack;
      deficit[r] += n;
    }
    let health = s.health;
    const flags = [...s.flags];
    // Running out has a (fictional) health cost proportional to the unmet share.
    const unmet = deficit.water + deficit.food;
    if (unmet > 0.01) {
      health = Math.max(0, health - Math.min(10, unmet * 20));
      if (!flags.includes('Short of supplies')) flags.push('Short of supplies');
    }
    return {
      ...s,
      inventory: inv,
      energy: Math.max(0, round2(s.energy - (energy[s.id] ?? 0))),
      health: round2(health),
      flags,
      updatedAt: now,
    };
  });
  return { survivors: out, shared: sh, deficit };
}

/** Validate a manual inventory value: finite, non-negative, capped. */
export function validQuantity(v: number, max = 50): number | null {
  if (!Number.isFinite(v) || v < 0 || v > max) return null;
  return round2(v);
}
