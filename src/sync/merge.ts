/**
 * Local merge of a validated sync payload. Never overwrites the recipient's whole state.
 *
 *  - Whole update already imported (same update id)      -> no-op
 *  - Threat with an id we already hold                   -> newer updatedAt wins (a revision of the same report);
 *                                                            history is appended, provenance kept
 *  - New threat                                           -> added with source "sync" (simulated stays "simulated")
 *  - New threat disagreeing (>= 2 levels) with a local
 *    report on the same road/location                     -> BOTH kept and flagged as a conflict. Routing resolves it
 *                                                            by trust (confidence x reliability x freshness) with a
 *                                                            safety bias (threats/effects.ts), not by recency alone
 *  - Amenities                                            -> add new; update known ones only if the report is newer
 *  - Discovered paths                                     -> re-validated locally before becoming routable
 *  - Survivor status / inventory                          -> applied only when explicitly shared and newer than local
 */
import type { MissionState, ThreatReport } from '../types';
import { BASE, baseGraph, nearestEdge, nearestNode } from '../routing/graph';
import { revalidate } from '../routing/paths';
import { haversine } from '../utils/geo';
import { THREAT_CATALOG } from '../threats/catalog';
import { expandAmenity, expandMessage, expandPath, expandThreat, secToMs, type SyncPayload } from './payload';

export interface MergeReport {
  alreadyImported: boolean;
  threatsAdded: number;
  threatsUpdated: number;
  duplicates: number;
  conflicts: string[];
  amenitiesAdded: number;
  amenitiesUpdated: number;
  pathsAdded: number;
  pathsInvalid: number;
  messagesAdded: number;
  survivorUpdates: string[];
  maxSeverity: number;
}

function resnap(t: ThreatReport): ThreatReport {
  const g = baseGraph();
  const ok = t.target.kind === 'node' ? g.nodes.has(t.target.id) : g.edges.has(t.target.id);
  if (ok) return t;
  const n = THREAT_CATALOG[t.category].snap === 'node' ? nearestNode(g, [t.lat, t.lng], 80) : null;
  if (n) return { ...t, target: { kind: 'node', id: n.id } };
  const e = nearestEdge(g, [t.lat, t.lng], 80);
  if (e) return { ...t, target: { kind: 'edge', id: e.id } };
  return t;
}

export function findConflicts(local: ThreatReport[], incoming: ThreatReport): ThreatReport[] {
  return local.filter(
    (l) =>
      l.id !== incoming.id &&
      l.status === 'active' &&
      incoming.status === 'active' &&
      Math.abs(l.severity - incoming.severity) >= 2 &&
      ((l.target.kind === incoming.target.kind && l.target.id === incoming.target.id) || haversine([l.lat, l.lng], [incoming.lat, incoming.lng]) < 30),
  );
}

/** Dry-run: what would the merge do? Used for the preview screen. */
export function previewMerge(state: MissionState, p: SyncPayload): MergeReport {
  return mergePayload(state, p, Date.now()).report;
}

export function mergePayload(state: MissionState, p: SyncPayload, now: number): { state: MissionState; report: MergeReport } {
  const report: MergeReport = {
    alreadyImported: false, threatsAdded: 0, threatsUpdated: 0, duplicates: 0, conflicts: [], amenitiesAdded: 0,
    amenitiesUpdated: 0, pathsAdded: 0, pathsInvalid: 0, messagesAdded: 0, survivorUpdates: [], maxSeverity: 0,
  };
  if (state.importedUpdates.includes(p.id)) {
    report.alreadyImported = true;
    return { state, report };
  }
  const sender = `${p.f.n} (${p.f.d})`;
  const sameGraph = p.g === BASE.meta.version;
  const threats = state.threats.slice();
  for (const ct of p.t ?? []) {
    // Same build -> ids match; otherwise (or if an id is unknown) re-snap by coordinates.
    const inc = sameGraph ? resnap(expandThreat(ct, sender)) : resnap({ ...expandThreat(ct, sender), target: { kind: 'node', id: '?' } });
    report.maxSeverity = Math.max(report.maxSeverity, inc.severity);
    const idx = threats.findIndex((x) => x.id === inc.id);
    if (idx >= 0) {
      const cur = threats[idx];
      if (inc.updatedAt > cur.updatedAt) {
        threats[idx] = {
          ...cur,
          severity: inc.severity, confidence: inc.confidence, status: inc.status, impassable: inc.impassable, description: inc.description, updatedAt: inc.updatedAt,
          history: [...cur.history, { at: now, note: `Revised via QR sync from ${sender}: level ${inc.severity}, ${Math.round(inc.confidence * 100)}% confidence, ${inc.status}` }],
        };
        report.threatsUpdated++;
      } else report.duplicates++;
      continue;
    }
    for (const c of findConflicts(threats, inc)) {
      report.conflicts.push(`${THREAT_CATALOG[inc.category].label} L${inc.severity} from ${p.f.n} vs local L${c.severity} ${THREAT_CATALOG[c.category].label.toLowerCase()} at ${c.place}`);
    }
    threats.push(inc);
    report.threatsAdded++;
  }

  const amenities = state.amenities.slice();
  for (const ca of p.a ?? []) {
    const inc = expandAmenity(ca, sender);
    if (!baseGraph().nodes.has(inc.node)) {
      const n = nearestNode(baseGraph(), [inc.lat, inc.lng], 90);
      if (!n) continue;
      inc.node = n.id;
    }
    const idx = amenities.findIndex((x) => x.id === inc.id);
    if (idx < 0) {
      amenities.push(inc);
      report.amenitiesAdded++;
    } else if (inc.reportedAt > amenities[idx].reportedAt) {
      amenities[idx] = { ...amenities[idx], supplies: inc.supplies, compromised: inc.compromised, reportedAt: inc.reportedAt };
      report.amenitiesUpdated++;
    } else report.duplicates++;
  }

  const paths = state.paths.slice();
  for (const cp of p.p ?? []) {
    if (paths.some((x) => x.id === cp.i)) {
      report.duplicates++;
      continue;
    }
    const v = revalidate(expandPath(cp, sender));
    paths.push(v);
    report.pathsAdded++;
    if (v.validation !== 'valid') report.pathsInvalid++;
  }

  const messages = state.messages.slice();
  for (const m of p.m ?? []) {
    if (messages.some((x) => x.id === m.i)) {
      report.duplicates++;
      continue;
    }
    messages.push(expandMessage(m));
    report.messagesAdded++;
  }

  const survivors = state.survivors.map((s) => {
    const inc = p.s?.find((x) => x.i === s.id);
    if (!inc) return s;
    const at = secToMs(inc.ua);
    if (at <= s.updatedAt) {
      report.duplicates++;
      return s;
    }
    const changes: string[] = [];
    if (Math.round(s.health) !== inc.h) changes.push(`health ${Math.round(s.health)} -> ${inc.h}`);
    if (Math.round(s.energy) !== inc.e) changes.push(`energy ${Math.round(s.energy)} -> ${inc.e}`);
    if (s.injured !== (inc.inj === 1)) changes.push(inc.inj ? 'now injured' : 'injury treated');
    if (s.inventory.water !== inc.w) changes.push(`water ${s.inventory.water} -> ${inc.w} L`);
    if (s.inventory.food !== inc.fd) changes.push(`food ${s.inventory.food} -> ${inc.fd}`);
    if (s.inventory.medkits !== inc.mk) changes.push(`medkits ${s.inventory.medkits} -> ${inc.mk}`);
    if (changes.length) report.survivorUpdates.push(`${s.name}: ${changes.join(', ')}`);
    return { ...s, health: inc.h, energy: inc.e, cognition: inc.cg, injured: inc.inj === 1, inventory: { water: inc.w, food: inc.fd, medkits: inc.mk }, updatedAt: at };
  });

  const summary = [
    report.threatsAdded && `${report.threatsAdded} threat report(s)`,
    report.threatsUpdated && `${report.threatsUpdated} revision(s)`,
    report.amenitiesAdded && `${report.amenitiesAdded} amenit${report.amenitiesAdded > 1 ? 'ies' : 'y'}`,
    report.pathsAdded && `${report.pathsAdded} path(s)`,
    report.messagesAdded && `${report.messagesAdded} message(s)`,
    report.survivorUpdates.length && `${report.survivorUpdates.length} survivor update(s)`,
  ].filter(Boolean);
  return {
    state: {
      ...state,
      threats,
      amenities,
      paths,
      messages,
      survivors,
      importedUpdates: [...state.importedUpdates, p.id].slice(-100),
      syncConflicts: [...state.syncConflicts, ...report.conflicts].slice(-20),
      log: [...state.log, { at: now, kind: 'sync', text: `Imported QR update from ${sender}: ${summary.join(', ') || 'nothing new'}${report.conflicts.length ? `; ${report.conflicts.length} conflict(s) retained` : ''}.` }],
    },
    report,
  };
}
