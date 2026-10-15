/**
 * Threat effects: translate threat reports into per-edge routing effects.
 *
 * For each ACTIVE report (resolved reports have no effect):
 *   - Segments inside the hazard CORE (or the targeted segment itself) receive the report's full severity.
 *     A level 3 report that is marked impassable, with confidence >= BLOCK_MIN_CONFIDENCE, BLOCKS those segments.
 *   - Segments inside the SPILL zone receive max(severity - 1, 1) and are never blocked.
 *     This keeps "dangerous location" distinct from "impassable road": a level 3 horde blocks the crossing
 *     itself, not every road in the district.
 *
 * Weighted exposure of a report on a segment:
 *   exposure = LEVEL_PENALTY[level] * (0.4 + 0.6 * confidence * sourceReliability) * freshness
 *   freshness = 1 for reports up to 60 min old, then decays linearly to 0.5 at 2 x staleAfter.
 * A segment's exposure is the MAX over reports (duplicates of one hazard are not added together).
 *
 * Conflicts: when two reports cover the same segment core and their severities differ by >= 2, the lower
 * report wins only if its trust score (confidence x reliability x freshness) is more than 1.67x the higher
 * one's. Otherwise the more severe report is kept (safety bias). Either way both reports are retained and
 * the segment is flagged as conflicting, which raises its uncertainty.
 */
import type { MissionState, Severity, ThreatReport } from '../types';
import type { RuntimeGraph } from '../routing/graph';
import { BLOCK_MIN_CONFIDENCE, LEVEL_PENALTY, SOURCE_RELIABILITY, THREAT_CATALOG } from './catalog';
import { haversine, pointPolylineDistance } from '../utils/geo';

export interface EdgeThreat {
  exposure: number;
  level: Severity;
  blocked: boolean;
  threatIds: string[];
  /** mean trust (confidence x reliability) of reports touching this edge */
  trust: number;
  conflict: boolean;
}

export type ThreatEffects = Map<string, EdgeThreat>;

export function freshness(ageMin: number, staleAfterMin: number): number {
  if (ageMin <= 60) return 1;
  const end = staleAfterMin * 2;
  if (ageMin >= end) return 0.5;
  return 1 - 0.5 * ((ageMin - 60) / (end - 60));
}

export function threatStatus(t: ThreatReport, now: number, staleAfterMin: number): 'current' | 'stale' | 'resolved' {
  if (t.status === 'resolved') return 'resolved';
  return (now - t.updatedAt) / 60000 > staleAfterMin ? 'stale' : 'current';
}

export function trustScore(t: ThreatReport, now: number, staleAfterMin: number): number {
  return t.confidence * SOURCE_RELIABILITY[t.source] * freshness((now - t.updatedAt) / 60000, staleAfterMin);
}

export function isBlocking(t: ThreatReport): boolean {
  return t.status === 'active' && t.severity === 3 && t.impassable && t.confidence >= BLOCK_MIN_CONFIDENCE;
}

interface Hit {
  t: ThreatReport;
  level: Severity;
  core: boolean;
}

export function computeThreatEffects(g: RuntimeGraph, state: Pick<MissionState, 'threats' | 'config'>, now: number): ThreatEffects {
  const hits = new Map<string, Hit[]>();
  const push = (edgeId: string, h: Hit) => {
    if (!hits.has(edgeId)) hits.set(edgeId, []);
    hits.get(edgeId)!.push(h);
  };

  for (const t of state.threats) {
    if (t.status !== 'active') continue;
    const spec = THREAT_CATALOG[t.category];
    if (spec.kind === 'cache') continue;
    const p: [number, number] = [t.lat, t.lng];
    const spill = spec.spillRadiusM;
    const core = spec.coreRadiusM;
    const reach = Math.max(core, spill);
    for (const e of g.edges.values()) {
      let isCore = false;
      let d = Infinity;
      if (t.target.kind === 'edge' && t.target.id === e.id) {
        isCore = true;
        d = 0;
      } else if (t.target.kind === 'node' && (e.a === t.target.id || e.b === t.target.id)) {
        isCore = true;
        d = 0;
      } else {
        if (reach <= 0) continue;
        if (haversine(p, e.g[0]) > reach + e.len) continue;
        d = pointPolylineDistance(p, e.g);
        isCore = d <= core;
      }
      if (isCore) push(e.id, { t, level: t.severity, core: true });
      else if (d <= spill && t.severity > 0) push(e.id, { t, level: Math.max(1, t.severity - 1) as Severity, core: false });
    }
  }

  const out: ThreatEffects = new Map();
  const staleAfter = state.config.staleAfterMin;
  for (const [edgeId, list] of hits) {
    // conflict resolution among core hits
    const cores = list.filter((h) => h.core);
    let conflict = false;
    const discounted = new Set<string>();
    for (const hi of cores) {
      for (const lo of cores) {
        if (hi.t.severity - lo.t.severity >= 2) {
          conflict = true;
          if (trustScore(lo.t, now, staleAfter) > 1.67 * trustScore(hi.t, now, staleAfter)) discounted.add(hi.t.id);
        }
      }
    }
    let exposure = 0;
    let level: Severity = 0;
    let blocked = false;
    let trustSum = 0;
    for (const h of list) {
      trustSum += h.t.confidence * SOURCE_RELIABILITY[h.t.source];
      if (discounted.has(h.t.id)) continue;
      const fr = freshness((now - h.t.updatedAt) / 60000, staleAfter);
      const ex = LEVEL_PENALTY[h.level] * (0.4 + 0.6 * h.t.confidence * SOURCE_RELIABILITY[h.t.source]) * fr;
      if (ex > exposure) exposure = ex;
      if (h.level > level) level = h.level;
      if (h.core && isBlocking(h.t)) blocked = true;
    }
    out.set(edgeId, {
      exposure,
      level,
      blocked,
      threatIds: [...new Set(list.map((h) => h.t.id))],
      trust: trustSum / list.length,
      conflict,
    });
  }
  return out;
}
