import { describe, expect, it } from 'vitest';
import { dijkstra } from '../routing/dijkstra';
import { plan, evaluatePath, isFeasible } from '../routing/planner';
import { buildGraph, BASE } from '../routing/graph';
import { makeContext, edgeCost } from '../routing/cost';
import { computeThreatEffects } from '../threats/effects';
import { runAction } from '../app/engine';
import { createInitialState } from '../data/scenario';
import { CTX, NOW, cleanState, threat, toyGraph } from './helpers';

describe('Dijkstra', () => {
  it('finds the minimum-weight path', () => {
    const g = toyGraph();
    const p = dijkstra(g, 'S', 'T', (e) => e.len)!;
    expect(p.nodes).toEqual(['S', 'A', 'T']);
    expect(p.cost).toBe(200);
  });

  it('avoids edges excluded by the weight function (blocked)', () => {
    const g = toyGraph();
    const p = dijkstra(g, 'S', 'T', (e) => (e.id === 'AT' ? null : e.len))!;
    expect(p.nodes).toEqual(['S', 'B', 'T']);
    expect(p.cost).toBe(300);
  });

  it('returns null when the target is unreachable', () => {
    const g = toyGraph();
    expect(dijkstra(g, 'S', 'T', () => null)).toBeNull();
  });

  it('is deterministic', () => {
    const g = toyGraph();
    const a = dijkstra(g, 'S', 'T', () => 1)!;
    const b = dijkstra(g, 'S', 'T', () => 1)!;
    expect(a).toEqual(b);
    expect(a.edges).toEqual(['ST']);
  });
});

describe('Planner on the Monaco street graph', () => {
  it('produces at least three distinct alternatives and recommends a feasible one', () => {
    const p = plan(cleanState(), NOW);
    expect(p.alternatives.length).toBeGreaterThanOrEqual(3);
    expect(p.recommended).not.toBeNull();
    expect(isFeasible(p.recommended!)).toBe(true);
    expect(p.recommended!.status).toBe('RECOMMENDED');
    expect(p.reason.length).toBeGreaterThan(0);
    const ids = new Set(p.alternatives.map((r) => r.id));
    expect(ids.size).toBe(p.alternatives.length);
  });

  it('does not simply recommend the shortest route', () => {
    const s = cleanState();
    const g = buildGraph([]);
    const shortest = dijkstra(g, s.position, g.landmarks.settlement, (e) => e.len)!;
    const p = plan(s, NOW);
    expect(p.recommended!.edges).not.toEqual(shortest.edges);
    const shortEval = evaluatePath(s, NOW, shortest);
    expect(shortEval.distanceM).toBeLessThan(p.recommended!.distanceM);
    expect(shortEval.cost).toBeGreaterThan(p.recommended!.cost);
  });

  it('level 1 threats increase edge cost but keep the road traversable', () => {
    const s = cleanState();
    const g = buildGraph([]);
    const edge = g.edges.get(plan(s, NOW).recommended!.edges[5])!;
    const base = edgeCost(makeContext(g, s, NOW), edge);
    const s1 = { ...s, threats: [threat('t1', 'movement', 1, { kind: 'edge', id: edge.id }, edge.g[0][0], edge.g[0][1])] };
    const c1 = edgeCost(makeContext(g, s1, NOW), edge);
    expect(c1.C).toBeGreaterThan(base.C);
    expect(c1.R).toBeGreaterThan(0);
    expect(c1.blocked).toBe(false);
  });

  it('prefers an alternative when a level 2 threat sits on the recommended route', () => {
    const s = cleanState();
    const first = plan(s, NOW).recommended!;
    const m = BASE.nodes.find((n) => n.id === BASE.landmarks.market)!;
    expect(first.nodes).toContain(BASE.landmarks.market);
    const s2 = { ...s, threats: [threat('t2', 'fire', 2, { kind: 'node', id: m.id }, m.lat, m.lng)] };
    const second = plan(s2, NOW).recommended!;
    expect(second.id).not.toBe(first.id);
    expect(second.maxSeverity).toBeLessThan(2);
  });

  it('blocks level 3 impassable segments, but not level 3 hazards marked passable', () => {
    const s = cleanState();
    const g = buildGraph([]);
    const m = BASE.nodes.find((n) => n.id === BASE.landmarks.market)!;
    const imp = computeThreatEffects(g, { threats: [threat('a', 'horde', 3, { kind: 'node', id: m.id }, m.lat, m.lng)], config: s.config }, NOW);
    const incident = g.adj.get(m.id)!.map((x) => x.edge);
    for (const e of incident) expect(imp.get(e)?.blocked).toBe(true);
    const pass = computeThreatEffects(g, { threats: [threat('b', 'horde', 3, { kind: 'node', id: m.id }, m.lat, m.lng, { impassable: false })], config: s.config }, NOW);
    for (const e of incident) {
      expect(pass.get(e)?.blocked).toBe(false);
      expect(pass.get(e)!.exposure).toBeGreaterThan(1);
    }
    // a level 3 report blocks the crossing, not every road in the district
    const blockedCount = [...imp.values()].filter((v) => v.blocked).length;
    expect(blockedCount).toBeLessThan(60);
    const p = plan({ ...s, threats: [threat('a', 'horde', 3, { kind: 'node', id: m.id }, m.lat, m.lng)] }, NOW);
    expect(p.recommended!.nodes).not.toContain(m.id);
    for (const e of p.recommended!.edges) expect(imp.get(e)?.blocked ?? false).toBe(false);
  });

  it('recalculates after a simulated event and explains the change', () => {
    const s = cleanState();
    const before = plan(s, NOW).recommended!;
    const m = BASE.nodes.find((n) => n.id === BASE.landmarks.market)!;
    const out = runAction(s, { type: 'simulate', category: 'horde', severity: 3, latlng: [m.lat, m.lng] }, CTX);
    expect(out.state.simulatedIds).toHaveLength(1);
    expect(out.state.threats.at(-1)!.source).toBe('simulated');
    expect(out.plan.recommended!.id).not.toBe(before.id);
    expect(out.state.previousRoute).toEqual(before.nodes);
    expect(out.state.lastChange!.lines.join(' ')).toMatch(/unavailable/);
  });

  it('rejects a simulated threat placed away from any road', () => {
    const s = cleanState();
    const out = runAction(s, { type: 'simulate', category: 'roadblock', severity: 3, latlng: [43.726, 7.43] }, CTX); // open sea
    expect(out.toast?.kind).toBe('error');
    expect(out.state.threats).toHaveLength(0);
  });

  it('reports no feasible route when every route is blocked, and never invents one', () => {
    const s = cleanState();
    const g = buildGraph([]);
    const lanes = [...g.edges.values()].filter((e) => e.a === 'settlement' || e.b === 'settlement');
    const threats = lanes.map((e, i) => threat(`rb${i}`, 'roadblock', 3, { kind: 'edge', id: e.id }, e.g[1][0], e.g[1][1]));
    const p = plan({ ...s, threats }, NOW);
    expect(p.recommended).toBeNull();
    expect(p.alternatives).toHaveLength(0);
    expect(p.infeasibleReasons.join(' ')).toMatch(/No passable connection/);
  });

  it('reports no feasible route when every route misses the deadline', () => {
    const s = { ...cleanState(), deadline: NOW + 10 * 60000 };
    const p = plan(s, NOW);
    expect(p.recommended).toBeNull();
    expect(p.alternatives.length).toBeGreaterThan(0);
    for (const r of p.alternatives) expect(r.status).toBe('DEADLINE INFEASIBLE');
    expect(p.infeasibleReasons[0]).toMatch(/No feasible route/);
  });

  it('marks deadline feasibility with a margin', () => {
    const p = plan(cleanState(), NOW);
    expect(p.recommended!.deadlineOk).toBe(true);
    expect(p.recommended!.deadlineMarginMin).toBeCloseTo(120 - p.recommended!.travelMin, 5);
  });
});

describe('Health-aware routing', () => {
  it('an injury slows the group and raises travel time', () => {
    const s = cleanState();
    const a = plan(s, NOW).recommended!;
    const hurt = { ...s, survivors: s.survivors.map((x) => (x.id === 'mira' ? { ...x, injured: true } : x)) };
    const b = evaluatePath(hurt, NOW, a);
    expect(b.travelMin).toBeCloseTo(a.travelMin / 0.75, 3);
    expect(b.energy.mira).toBeGreaterThan(a.energy.mira);
  });

  it('low cognition raises the penalty on uncertain roads', () => {
    const s = cleanState();
    const g = buildGraph([]);
    const unexplored = [...g.edges.values()].find((e) => e.know === 'unexplored' && e.len > 50)!;
    const base = edgeCost(makeContext(g, s, NOW), unexplored);
    const foggy = { ...s, survivors: s.survivors.map((x) => (x.id === 'aarav' ? { ...x, cognition: 25 } : x)) };
    const c = edgeCost(makeContext(g, foggy, NOW), unexplored);
    expect(c.U).toBeCloseTo(base.U * 2, 6);
  });

  it('low energy makes strenuous routes more expensive', () => {
    const s = cleanState();
    const g = buildGraph([]);
    const stairs = [...g.edges.values()].find((e) => e.steps > 0.5)!;
    const base = edgeCost(makeContext(g, s, NOW), stairs);
    const tired = { ...s, survivors: s.survivors.map((x) => (x.id === 'mira' ? { ...x, energy: 15 } : x)) };
    expect(edgeCost(makeContext(g, tired, NOW), stairs).H).toBeGreaterThan(base.H * 2);
  });
});

describe('Reset', () => {
  it('restores the original route, resources and threats', () => {
    const s0 = createInitialState(NOW);
    const p0 = plan(s0, NOW);
    let s = runAction(s0, { type: 'simulate', category: 'horde', severity: 3, latlng: [43.73253, 7.41897] }, CTX).state;
    s = runAction(s, { type: 'consume', who: 'aarav', resource: 'water', amount: 0.5 }, CTX).state;
    s = runAction(s, { type: 'advance', mode: 'checkpoint' }, CTX).state;
    const r = runAction(s, { type: 'reset' }, CTX);
    expect(r.state.threats.map((t) => t.id)).toEqual(s0.threats.map((t) => t.id));
    expect(r.state.survivors).toEqual(s0.survivors);
    expect(r.state.shared).toEqual(s0.shared);
    expect(r.state.position).toBe(s0.position);
    expect(r.plan.recommended!.id).toBe(p0.recommended!.id);
  });
});

describe('Compare route', () => {
  it('maps a drawing along real streets and evaluates it against the recommendation', async () => {
    const { compareDrawn } = await import('../routing/compare');
    const s = cleanState();
    // drawn roughly along the tunnel corridor (the shortest-distance route)
    const drawn: [number, number][] = [[43.7290, 7.4166], [43.7302, 7.4192], [43.7318, 7.4222], [43.7334, 7.4232], [43.7362, 7.4250], [43.7385, 7.4285], [43.7410, 7.4300], [43.7432, 7.4315]];
    const r = compareDrawn(s, NOW, drawn);
    expect(r.match.valid).toBe(true);
    expect(r.match.coverage).toBeGreaterThan(0.6);
    expect(r.route!.distanceM).toBeLessThan(3500);
    expect(r.route!.cost).toBeGreaterThan(plan(s, NOW).recommended!.cost);
  });

  it('flags a drawing that does not follow roads as approximate', async () => {
    const { compareDrawn } = await import('../routing/compare');
    const s = cleanState();
    const r = compareDrawn(s, NOW, [[43.7262, 7.4300], [43.7300, 7.4330]]); // open sea
    expect(r.route?.approximate ?? true).toBe(true);
    expect(r.match.coverage).toBeLessThan(0.6);
  });
});
