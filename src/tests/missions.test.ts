import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { runAction } from '../app/engine';
import { stageViews, checkStages } from '../missions/stages';
import { plan } from '../routing/planner';
import { loadMission, saveMission, kvSet, isMissionState } from '../storage/db';
import { createInitialState } from '../data/scenario';
import { CTX, NOW, cleanState } from './helpers';

describe('Mission stages', () => {
  it('no stage is complete at the start, and stage 1 is active', () => {
    const s = cleanState();
    const p = plan(s, NOW);
    expect(checkStages(s, p, NOW)).toEqual({});
    const v = stageViews(s, p, NOW);
    expect(v).toHaveLength(5);
    expect(v[0].status).toBe('active');
    expect(v.slice(1).every((x) => x.status === 'pending')).toBe(true);
  });

  it('stages complete only from measured movement and supplies, in order, before the deadline', () => {
    let s = cleanState();
    const order: string[] = [];
    for (let i = 0; i < 20 && !s.stageCompletedAt[5]; i++) {
      const out = runAction(s, { type: 'advance', mode: 'checkpoint' }, CTX);
      expect(out.state).not.toBe(s);
      s = out.state;
      order.push(Object.keys(s.stageCompletedAt).join(''));
    }
    expect(s.position).toBe('settlement');
    expect(Object.keys(s.stageCompletedAt).map(Number)).toEqual([1, 2, 3, 4, 5]);
    expect(order[0]).toBe('1');
    const t = s.stageCompletedAt;
    expect(t[1]! <= t[2]! && t[2]! <= t[3]! && t[3]! <= t[4]! && t[4]! <= t[5]!).toBe(true);
    expect(t[5]!).toBeLessThanOrEqual(s.deadline);
    expect(s.walkedEdges.length).toBeGreaterThan(5);
    expect(s.survivors[0].inventory.water).toBeLessThan(0.9);
  });

  it('stage 3 exception requires stage 2 first', () => {
    const s = cleanState();
    const out = runAction(s, { type: 'stage3Exception', note: 'All pharmacies looted' }, CTX);
    expect(out.toast?.kind).toBe('error');
    expect(out.state.stage3Exception).toBeNull();
  });

  it('stage 5 fails when the deadline passes', () => {
    const s = { ...cleanState(), deadline: NOW - 1000 };
    const v = stageViews(s, plan(s, NOW), NOW);
    expect(v[0].status).toBe('failed');
    expect(checkStages(s, plan(s, NOW), NOW)).toEqual({});
  });

  it('undo removes only the most recent simulated event', () => {
    let s = cleanState();
    s = runAction(s, { type: 'simulate', category: 'fire', severity: 2, latlng: [43.7368, 7.4214] }, CTX).state;
    s = runAction(s, { type: 'simulate', category: 'cache', severity: 0, latlng: [43.7345, 7.4205] }, CTX).state;
    expect(s.simulatedIds).toHaveLength(2);
    expect(s.amenities.some((a) => a.type === 'cache')).toBe(true);
    s = runAction(s, { type: 'undoSim' }, CTX).state;
    expect(s.simulatedIds).toHaveLength(1);
    expect(s.amenities.some((a) => a.type === 'cache')).toBe(false);
    s = runAction(s, { type: 'clearSim' }, CTX).state;
    expect(s.threats).toHaveLength(0);
    expect(plan(s, NOW).recommended!.id).toBe(plan(cleanState(), NOW).recommended!.id);
  });
});

describe('Persistence', () => {
  it('saves and restores mission state through IndexedDB', async () => {
    let s = createInitialState(NOW);
    s = runAction(s, { type: 'simulate', category: 'horde', severity: 3, latlng: [43.73253, 7.41897] }, CTX).state;
    const mode = await saveMission(s);
    expect(mode).toBe('indexeddb');
    const back = await loadMission();
    expect(back).toEqual(s);
    expect(plan(back!, NOW).recommended!.id).toBe(plan(s, NOW).recommended!.id);
  });

  it('ignores a corrupted record instead of crashing', async () => {
    await kvSet('mission', { schema: 1, deadline: 'soon' });
    expect(await loadMission()).toBeNull();
    expect(isMissionState(createInitialState(NOW))).toBe(true);
  });
});
