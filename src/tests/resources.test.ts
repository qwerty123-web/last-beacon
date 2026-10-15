import { describe, expect, it } from 'vitest';
import { applyConsumption, combined, needFor } from '../resources/consumption';
import { plan, evaluatePath } from '../routing/planner';
import { runAction } from '../app/engine';
import { CTX, NOW, cleanState } from './helpers';

describe('Consumption model', () => {
  it('water and food scale with duration and survivors', () => {
    const cfg = cleanState().config.consumption;
    const n = needFor(60, 2, cfg);
    expect(n.water).toBeCloseTo(cfg.waterPerHour * 2);
    expect(n.food).toBeCloseTo(cfg.foodPerHour * 2);
    expect(needFor(30, 2, cfg).water).toBeCloseTo(cfg.waterPerHour);
  });

  it('route water requirement = rate x duration x survivors', () => {
    const s = cleanState();
    const r = plan(s, NOW).recommended!;
    expect(r.water).toBeCloseTo((s.config.consumption.waterPerHour * r.travelMin * 2) / 60, 2);
  });

  it('survivors draw from their own inventory before the shared pack, without double counting', () => {
    const s = cleanState();
    const before = combined(s);
    const out = applyConsumption(s.survivors, s.shared, 120, { aarav: 0, mira: 0 }, s.config.consumption, NOW);
    // each needs 1.0 L: Aarav has 0.9 (takes 0.1 from pack), Mira has 0.6 (takes 0.4 from pack)
    expect(out.survivors.find((x) => x.id === 'aarav')!.inventory.water).toBe(0);
    expect(out.survivors.find((x) => x.id === 'mira')!.inventory.water).toBe(0);
    expect(out.shared.water).toBeCloseTo(0);
    expect(out.deficit.water).toBeCloseTo(0);
    const after = combined({ survivors: out.survivors, shared: out.shared });
    expect(before.water - after.water).toBeCloseTo(2.0);
  });

  it('rejects invalid inventory changes', () => {
    const s = cleanState();
    expect(runAction(s, { type: 'consume', who: 'aarav', resource: 'water', amount: 5 }, CTX).toast?.kind).toBe('error');
    expect(runAction(s, { type: 'setInventory', who: 'mira', resource: 'food', value: -1 }, CTX).toast?.kind).toBe('error');
    expect(runAction(s, { type: 'setInventory', who: 'mira', resource: 'food', value: Number.NaN }, CTX).toast?.kind).toBe('error');
    const ok = runAction(s, { type: 'consume', who: 'aarav', resource: 'water', amount: 0.4 }, CTX);
    expect(ok.state.survivors[0].inventory.water).toBeCloseTo(0.5);
  });
});

describe('Shortage detection and supply detours', () => {
  const dry = () => {
    const s = cleanState();
    return {
      ...s,
      shared: { ...s.shared, water: 0 },
      survivors: s.survivors.map((x) => ({ ...x, inventory: { ...x.inventory, water: 0.1 } })),
    };
  };

  it('flags routes that exceed the water budget', () => {
    const s = dry();
    const base = plan(cleanState(), NOW).recommended!;
    const r = evaluatePath(s, NOW, base);
    expect(r.resourcesOk).toBe(false);
    expect(r.status).toBe('RESOURCE SHORTAGE');
    expect(r.shortages[0]).toMatch(/Water/);
  });

  it('recommends a feasible supply stop instead of an infeasible direct route', () => {
    const p = plan(dry(), NOW);
    expect(p.detourConsidered).toBe(true);
    expect(p.recommended).not.toBeNull();
    expect(p.recommended!.stops).toHaveLength(1);
    expect(p.recommended!.resourcesOk).toBe(true);
    expect(p.reason[0]).toMatch(/supply|stop/i);
  });

  it('states the shortage when no supply location is usable', () => {
    const s = { ...dry(), amenities: [] };
    const p = plan(s, NOW);
    expect(p.recommended).toBeNull();
    expect(p.detourNote).toMatch(/No reachable supply/);
    expect(p.infeasibleReasons.join(' ')).toMatch(/Water/);
  });

  it('does not take a detour when supplies are sufficient', () => {
    const p = plan(cleanState(), NOW);
    expect(p.detourConsidered).toBe(false);
    expect(p.recommended!.stops).toHaveLength(0);
  });
});
