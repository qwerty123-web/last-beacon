import type { MissionState, Severity, ThreatCategory, ThreatReport } from '../types';
import { createInitialState } from '../data/scenario';
import type { RuntimeGraph, RuntimeEdge } from '../routing/graph';

export const NOW = Date.UTC(2026, 9, 15, 8, 0, 0);
export const CTX = { realNow: NOW, device: 'TST1', deviceName: 'Aarav' };

/** Scenario with no pre-mission threats, so tests control every hazard. */
export function cleanState(): MissionState {
  return { ...createInitialState(NOW), threats: [] };
}

export function threat(id: string, category: ThreatCategory, severity: Severity, target: ThreatReport['target'], lat: number, lng: number, extra: Partial<ThreatReport> = {}): ThreatReport {
  return {
    id, category, severity, confidence: 0.9, lat, lng, target, place: 'test', description: '', source: 'user', reporter: 'test', device: 'TST1',
    createdAt: NOW, updatedAt: NOW, status: 'active', impassable: severity === 3, history: [], ...extra,
  };
}

/** Tiny synthetic graph for algorithm tests:  S - A - T (short) and S - B - T (long) and S - T direct (very long). */
export function toyGraph(): RuntimeGraph {
  const nodes = new Map([
    ['S', { id: 'S', lat: 0, lng: 0 }],
    ['A', { id: 'A', lat: 0, lng: 0.001 }],
    ['B', { id: 'B', lat: 0.001, lng: 0.001 }],
    ['T', { id: 'T', lat: 0, lng: 0.002 }],
  ]);
  const mk = (id: string, a: string, b: string, len: number): RuntimeEdge => ({
    id, a, b, len, hw: 'residential', name: id, steps: 0, tunnel: 0, g: [[0, 0], [0, 0]], know: 'known', age: 0, statusKnown: true, origin: 'osm',
  });
  const edges = new Map<string, RuntimeEdge>([
    ['SA', mk('SA', 'S', 'A', 100)],
    ['AT', mk('AT', 'A', 'T', 100)],
    ['SB', mk('SB', 'S', 'B', 150)],
    ['BT', mk('BT', 'B', 'T', 150)],
    ['ST', mk('ST', 'S', 'T', 500)],
  ]);
  const adj = new Map<string, { edge: string; to: string }[]>();
  for (const e of edges.values()) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push({ edge: e.id, to: e.b });
    adj.get(e.b)!.push({ edge: e.id, to: e.a });
  }
  return { nodes, edges, adj, landmarks: { shelter: 'S', exit: 'A', settlement: 'T', gates: ['A'], market: 'A' }, meta: { source: '', snapshot: '', bbox: [0, 0, 1, 1], version: 'toy' } };
}
