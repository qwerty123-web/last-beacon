/**
 * Action engine: every user action goes through runAction, which applies the change, re-runs the planner,
 * explains any route change, updates mission stages and logs the decision. Pure (given realNow), so it is
 * fully testable and works offline.
 */
import type { Amenity, LatLng, MissionState, PlanResult, RouteChangeNote, Severity, SurvivorState, ThreatCategory, ThreatReport, Inventory, MissionConfig } from '../types';
import { createInitialState } from '../data/scenario';
import { buildGraph, nearestNode } from '../routing/graph';
import { evaluatePath, missionNow, plan } from '../routing/planner';
import { THREAT_CATALOG, SEVERITY_LABEL } from '../threats/catalog';
import { findSafehouse, placeThreat } from '../threats/placement';
import { computeThreatEffects } from '../threats/effects';
import { validatePath } from '../routing/paths';
import { checkStages } from '../missions/stages';
import { advance, collectAt, treat, type AdvanceMode } from '../missions/movement';
import { mergePayload, type MergeReport } from '../sync/merge';
import type { SyncPayload } from '../sync/payload';
import { validQuantity } from '../resources/consumption';
import { clamp, fmtClock, fmtDuration, fmtL, round2, uid } from '../utils/format';

export interface ThreatInput {
  category: ThreatCategory;
  severity: Severity;
  confidence: number;
  description: string;
  latlng: LatLng;
  reporter: string;
}

export type Action =
  | { type: 'reset' }
  | { type: 'setDeadline'; minutesFromNow: number }
  | { type: 'simulate'; category: ThreatCategory; severity: Severity; latlng: LatLng }
  | { type: 'undoSim' }
  | { type: 'clearSim' }
  | { type: 'addThreat'; input: ThreatInput }
  | { type: 'reviseThreat'; id: string; patch: Partial<Pick<ThreatReport, 'severity' | 'confidence' | 'impassable' | 'status' | 'description'>>; note: string }
  | { type: 'addAmenity'; amenityType: Amenity['type']; name: string; supplies: Amenity['supplies']; latlng: LatLng; notes: string }
  | { type: 'addPath'; from: LatLng; to: LatLng; terrain: 'flat' | 'stairs' | 'rough'; note: string }
  | { type: 'verifyPath'; id: string }
  | { type: 'advance'; mode: AdvanceMode }
  | { type: 'collect'; amenityId: string }
  | { type: 'consume'; who: SurvivorState['id'] | 'shared'; resource: keyof Inventory; amount: number }
  | { type: 'setInventory'; who: SurvivorState['id'] | 'shared'; resource: keyof Inventory; value: number }
  | { type: 'treat'; survivor: SurvivorState['id'] }
  | { type: 'setSurvivor'; id: SurvivorState['id']; patch: Partial<Pick<SurvivorState, 'health' | 'energy' | 'cognition' | 'injured'>> }
  | { type: 'stage3Exception'; note: string }
  | { type: 'importSync'; payload: SyncPayload }
  | { type: 'message'; text: string; from: string }
  | { type: 'setConfig'; config: MissionConfig }
  | { type: 'resetInventory' };

export interface Outcome {
  state: MissionState;
  toast?: { kind: 'info' | 'error' | 'event'; text: string };
  merge?: MergeReport;
}

export interface Ctx {
  realNow: number;
  device: string;
  deviceName: string;
}

const EXPLAIN: Partial<Record<Action['type'], string>> = {
  simulate: 'Threat simulated',
  addThreat: 'Threat reported',
  reviseThreat: 'Threat report revised',
  undoSim: 'Simulated event undone',
  clearSim: 'Simulated events cleared',
  setSurvivor: 'Survivor condition changed',
  treat: 'Medical treatment recorded',
  consume: 'Supplies consumed',
  setInventory: 'Inventory adjusted',
  collect: 'Supplies collected',
  importSync: 'QR update imported',
  addPath: 'Path discovered',
  verifyPath: 'Path verified',
  addAmenity: 'Amenity marked',
  setDeadline: 'Deadline changed',
  setConfig: 'Planning configuration changed',
  resetInventory: 'Inventory reset',
};

function log(state: MissionState, at: number, kind: MissionState['log'][number]['kind'], text: string): MissionState {
  return { ...state, log: [...state.log, { at, kind, text }].slice(-200) };
}

function err(state: MissionState, text: string): Outcome {
  return { state, toast: { kind: 'error', text } };
}

/** Remove one simulated event and everything it created, restoring inventory if its cache was collected. */
function removeSimulated(state: MissionState, id: string): MissionState {
  const t = state.threats.find((x) => x.id === id);
  let s: MissionState = { ...state, threats: state.threats.filter((x) => x.id !== id), simulatedIds: state.simulatedIds.filter((x) => x !== id) };
  if (t?.amenityId) {
    if (t.category === 'cache') {
      const taken = s.collected[t.amenityId];
      if (taken) {
        s = {
          ...s,
          shared: {
            ...s.shared,
            water: round2(Math.max(0, s.shared.water - (taken.water ?? 0))),
            food: round2(Math.max(0, s.shared.food - (taken.food ?? 0))),
            medkits: Math.max(0, s.shared.medkits - (taken.medkits ?? 0)),
          },
        };
        const { [t.amenityId]: _drop, ...rest } = s.collected;
        void _drop;
        s = { ...s, collected: rest };
      }
      s = { ...s, amenities: s.amenities.filter((a) => a.id !== t.amenityId) };
    } else if (t.category === 'safehouse_compromised') {
      const stillCompromised = s.threats.some((x) => x.amenityId === t.amenityId && x.category === 'safehouse_compromised' && x.status === 'active');
      if (!stillCompromised) s = { ...s, amenities: s.amenities.map((a) => (a.id === t.amenityId ? { ...a, compromised: false } : a)) };
    }
  }
  return s;
}

function createReport(state: MissionState, input: ThreatInput, source: 'simulated' | 'user', ctx: Ctx): { state: MissionState; report?: ThreatReport; error?: string } {
  const now = missionNow(state, ctx.realNow);
  const g = buildGraph(state.paths);
  const spec = THREAT_CATALOG[input.category];
  const pl = placeThreat(g, input.latlng, input.category);
  if (!pl.ok) return { state, error: pl.error };
  const severity = clamp(input.severity, 0, spec.maxSeverity) as Severity;
  const id = uid(source === 'simulated' ? 'sim' : 'rep');
  const report: ThreatReport = {
    id,
    category: input.category,
    severity,
    confidence: clamp(input.confidence, 0.05, 1),
    lat: pl.lat,
    lng: pl.lng,
    target: pl.target,
    place: pl.place,
    description: input.description.slice(0, 140) || spec.label,
    source,
    reporter: input.reporter,
    device: ctx.device,
    createdAt: now,
    updatedAt: now,
    status: 'active',
    impassable: severity === 3 && spec.impassableDefault,
    history: [{ at: now, note: source === 'simulated' ? 'Simulated event placed on the map' : `Reported by ${input.reporter}` }],
  };
  let s = state;
  if (spec.kind === 'cache') {
    if (pl.target.kind !== 'node') {
      const n = nearestNode(g, input.latlng, 60);
      if (!n) return { state, error: 'No location within 60 m to attach the cache to.' };
      report.target = { kind: 'node', id: n.id };
    }
    const am: Amenity = {
      id: `am-${id}`,
      type: 'cache',
      name: source === 'simulated' ? 'Supply cache (simulated)' : 'Supply cache',
      lat: pl.lat,
      lng: pl.lng,
      node: report.target.id,
      supplies: { water: 2, food: 2, medkits: 1 },
      reportedAt: now,
      notes: `${input.description || 'Discovered cache'}. Quantities are scenario values.`,
      origin: source === 'simulated' ? 'simulated' : 'discovered',
      device: ctx.device,
    };
    report.severity = 0;
    report.amenityId = am.id;
    s = { ...s, amenities: [...s.amenities, am] };
  } else if (spec.kind === 'safehouse') {
    const sh = findSafehouse(state, input.latlng);
    if (!sh) return { state, error: 'No safehouse within 150 m. Double-click on a safehouse marker.' };
    report.amenityId = sh.id;
    report.lat = sh.lat;
    report.lng = sh.lng;
    report.place = sh.name;
    report.target = { kind: 'node', id: sh.node };
    s = { ...s, amenities: s.amenities.map((a) => (a.id === sh.id ? { ...a, compromised: true } : a)) };
  }
  s = { ...s, threats: [...s.threats, report] };
  if (source === 'simulated') s = { ...s, simulatedIds: [...s.simulatedIds, id] };
  return { state: s, report };
}

function effectLine(state: MissionState, report: ThreatReport, realNow: number): string {
  const spec = THREAT_CATALOG[report.category];
  if (spec.kind === 'cache') return `Cache added at ${report.place} (2 L water, 2 meals, 1 medkit, scenario values).`;
  const g = buildGraph(state.paths);
  const fx = computeThreatEffects(g, { threats: [report], config: state.config }, missionNow(state, realNow));
  let blocked = 0;
  let raised = 0;
  for (const v of fx.values()) v.blocked ? blocked++ : raised++;
  const parts: string[] = [];
  if (spec.kind === 'safehouse') parts.push(`${report.place} marked compromised (no rest or supplies)`);
  if (blocked) parts.push(`${blocked} segment${blocked > 1 ? 's' : ''} at ${report.place} blocked`);
  if (raised) parts.push(`threat exposure raised on ${raised} nearby segment${raised > 1 ? 's' : ''}`);
  return parts.length ? `${parts.join('; ')}.` : 'No mapped segment affected.';
}

function explain(title: string, before: PlanResult, after: PlanResult, state: MissionState, realNow: number, extra: string[]): RouteChangeNote {
  const lines = [...extra];
  const b = before.recommended;
  const a = after.recommended;
  if (b) {
    if (a && a.id === b.id) lines.push(`Previous route: ${b.name}, still recommended.`);
    else {
      const re = evaluatePath(state, realNow, b, { name: b.name });
      lines.push(
        re.blockedSegments > 0
          ? `Previous route: ${b.name}, unavailable (impassable segment).`
          : `Previous route: ${b.name}, now ${re.status === 'FEASIBLE' ? 'costlier' : re.status.toLowerCase()} (cost ${re.cost.toFixed(1)} vs ${b.cost.toFixed(1)}).`,
      );
    }
  }
  if (a) {
    lines.push(`Recommendation: ${a.name}${b && b.id !== a.id && b.name === a.name ? ', rerouted' : ''}.`);
    if (b && b.id !== a.id && a.streets.length) lines.push(`Now follows ${a.streets.slice(0, 4).join(', ')}.`);
    if (b) {
      const dt = a.travelMin - b.travelMin;
      lines.push(`Travel ${fmtDuration(a.travelMin)} (${dt >= 0 ? '+' : ''}${Math.round(dt)} min), arrival ${fmtClock(a.arrivalAt)}.`);
      lines.push(`Water ${fmtL(a.water)} (was ${fmtL(b.water)}), food ${a.food.toFixed(2)} meals (was ${b.food.toFixed(2)}).`);
    } else lines.push(`Travel ${fmtDuration(a.travelMin)}, arrival ${fmtClock(a.arrivalAt)}, water ${fmtL(a.water)}.`);
    if (a.stops.length) lines.push(`Includes supply stop at ${a.stops[0].name}.`);
  } else {
    lines.push('Recommendation: none. No feasible route.');
    lines.push(...after.infeasibleReasons.slice(0, 2));
  }
  return { at: missionNow(state, realNow), title, lines };
}

function applyRaw(state: MissionState, action: Action, ctx: Ctx, before: PlanResult): Outcome & { extra?: string[] } {
  const now = missionNow(state, ctx.realNow);
  switch (action.type) {
    case 'reset': {
      const s = createInitialState(ctx.realNow, state.config);
      return { state: s, toast: { kind: 'info', text: 'Mission reset to the Day 19 scenario.' } };
    }
    case 'setDeadline': {
      const m = action.minutesFromNow;
      if (!Number.isFinite(m) || m < 5 || m > 720) return err(state, 'Deadline must be between 5 and 720 minutes from now.');
      return { state: log({ ...state, deadline: now + m * 60000 }, now, 'system', `Beacon deadline set to ${fmtClock(now + m * 60000)}.`) };
    }
    case 'simulate':
    case 'addThreat': {
      const sim = action.type === 'simulate';
      const input: ThreatInput = sim
        ? { category: action.category, severity: action.severity, confidence: 0.9, description: `${THREAT_CATALOG[action.category].label} (simulated)`, latlng: action.latlng, reporter: 'Simulation' }
        : action.input;
      const r = createReport(state, input, sim ? 'simulated' : 'user', ctx);
      if (r.error || !r.report) return err(state, r.error ?? 'Could not place the report.');
      const label = THREAT_CATALOG[r.report.category].label;
      const s = log(r.state, now, 'threat', `${sim ? 'SIMULATED' : 'Reported'}: ${label}, level ${r.report.severity} at ${r.report.place}.`);
      return {
        state: s,
        extra: [
          `${sim ? 'Threat simulated' : 'Threat reported'}: ${label}.`,
          `Location: ${r.report.place}.`,
          `Severity: level ${r.report.severity}, ${SEVERITY_LABEL[r.report.severity].toLowerCase()}${r.report.impassable ? ', impassable' : ''}.`,
          `Effect: ${effectLine(s, r.report, ctx.realNow)}`,
        ],
      };
    }
    case 'undoSim': {
      const id = state.simulatedIds[state.simulatedIds.length - 1];
      if (!id) return err(state, 'No simulated event to undo.');
      const t = state.threats.find((x) => x.id === id);
      const s = log(removeSimulated(state, id), now, 'threat', `Undid simulated ${t ? THREAT_CATALOG[t.category].label.toLowerCase() : 'event'}${t ? ` at ${t.place}` : ''}.`);
      return { state: s, extra: [`Removed: ${t ? `${THREAT_CATALOG[t.category].label} at ${t.place}` : id}.`] };
    }
    case 'clearSim': {
      if (!state.simulatedIds.length) return err(state, 'There are no simulated events.');
      let s = state;
      for (const id of [...state.simulatedIds].reverse()) s = removeSimulated(s, id);
      return { state: log(s, now, 'threat', `Cleared ${state.simulatedIds.length} simulated event(s).`), extra: [`Removed ${state.simulatedIds.length} simulated event(s).`] };
    }
    case 'reviseThreat': {
      const t = state.threats.find((x) => x.id === action.id);
      if (!t) return err(state, 'Report not found.');
      const p = action.patch;
      const spec = THREAT_CATALOG[t.category];
      const next: ThreatReport = {
        ...t,
        severity: p.severity !== undefined ? (clamp(p.severity, 0, spec.maxSeverity) as Severity) : t.severity,
        confidence: p.confidence !== undefined ? clamp(p.confidence, 0.05, 1) : t.confidence,
        impassable: p.impassable ?? t.impassable,
        status: p.status ?? t.status,
        description: p.description !== undefined ? p.description.slice(0, 140) : t.description,
        updatedAt: now,
      };
      const changes: string[] = [];
      if (next.severity !== t.severity) changes.push(`level ${t.severity} -> ${next.severity}`);
      if (next.confidence !== t.confidence) changes.push(`confidence ${Math.round(t.confidence * 100)}% -> ${Math.round(next.confidence * 100)}%`);
      if (next.impassable !== t.impassable) changes.push(next.impassable ? 'now impassable' : 'passable with caution');
      if (next.status !== t.status) changes.push(next.status === 'resolved' ? 'resolved' : 'reopened');
      if (next.description !== t.description) changes.push('description updated');
      if (!changes.length) return err(state, 'Nothing changed.');
      next.history = [...t.history, { at: now, note: `${changes.join(', ')}${action.note ? `: ${action.note}` : ''}` }];
      let s: MissionState = { ...state, threats: state.threats.map((x) => (x.id === t.id ? next : x)) };
      if (t.category === 'safehouse_compromised' && t.amenityId && next.status === 'resolved') s = { ...s, amenities: s.amenities.map((a) => (a.id === t.amenityId ? { ...a, compromised: false } : a)) };
      s = log(s, now, 'threat', `Revised ${spec.label.toLowerCase()} at ${t.place}: ${changes.join(', ')}.`);
      return { state: s, extra: [`${spec.label} at ${t.place}: ${changes.join(', ')}.`] };
    }
    case 'addAmenity': {
      const g = buildGraph(state.paths);
      const n = nearestNode(g, action.latlng, 80, (id) => id === 'shelter' || id === 'settlement');
      if (!n) return err(state, 'No mapped road within 80 m. Place the amenity next to a street.');
      const sup = { water: validQuantity(action.supplies.water ?? 0, 50) ?? 0, food: validQuantity(action.supplies.food ?? 0, 50) ?? 0, medkits: Math.round(validQuantity(action.supplies.medkits ?? 0, 20) ?? 0) };
      const am: Amenity = { id: uid('am'), type: action.amenityType, name: action.name.slice(0, 40) || 'Discovered amenity', lat: action.latlng[0], lng: action.latlng[1], node: n.id, supplies: sup, reportedAt: now, notes: action.notes.slice(0, 60), origin: 'discovered', device: ctx.device };
      return { state: log({ ...state, amenities: [...state.amenities, am] }, now, 'supply', `Marked ${am.type} location: ${am.name}.`), extra: [`Marked ${am.name} (${am.type}).`] };
    }
    case 'addPath': {
      const g = buildGraph(state.paths);
      const a = nearestNode(g, action.from, 40);
      const b = nearestNode(g, action.to, 40);
      if (!a || !b) return err(state, 'Each end of a path must be within 40 m of a mapped street or intersection.');
      const v = validatePath(g, a.id, b.id, action.terrain);
      const p = { id: uid('path'), a: a.id, b: b.id, len: v.len, terrain: action.terrain, createdAt: now, validation: v.validation, validationNote: v.note, verified: false, origin: 'discovered' as const, device: ctx.device, note: action.note.slice(0, 48) || 'Discovered path' };
      const s = log({ ...state, paths: [...state.paths, p] }, now, 'route', `Discovered path (${p.terrain}, ${Math.round(p.len)} m): ${v.validation === 'valid' ? 'validated, routable' : `not routable: ${v.note}`}`);
      return { state: s, toast: { kind: v.validation === 'valid' ? 'event' : 'error', text: v.validation === 'valid' ? `Path added (${Math.round(p.len)} m). ${v.note}` : `Path saved but not routable: ${v.note}` }, extra: [`Path ${p.note}: ${v.note}`] };
    }
    case 'verifyPath': {
      const p = state.paths.find((x) => x.id === action.id);
      if (!p) return err(state, 'Path not found.');
      if (p.validation !== 'valid') return err(state, 'Only validated paths can be verified.');
      return { state: log({ ...state, paths: state.paths.map((x) => (x.id === p.id ? { ...x, verified: true } : x)) }, now, 'route', `Path ${p.note} verified on foot.`), extra: [`${p.note} verified: uncertainty lowered.`] };
    }
    case 'advance': {
      const r = advance(state, before, ctx.realNow, action.mode);
      if (!r.moved) return err(state, r.message);
      return { state: r.state, toast: { kind: 'info', text: r.message } };
    }
    case 'collect': {
      const r = collectAt(state, action.amenityId, now);
      if (r.state === state) return err(state, r.message);
      return { state: r.state, toast: { kind: 'info', text: r.message }, extra: [r.message] };
    }
    case 'consume':
    case 'setInventory': {
      const v = validQuantity(action.type === 'consume' ? action.amount : action.value, action.resource === 'medkits' ? 20 : 50);
      if (v === null) return err(state, 'Enter a value between 0 and 50.');
      const cur = action.who === 'shared' ? state.shared[action.resource] : state.survivors.find((s) => s.id === action.who)!.inventory[action.resource];
      const next = action.type === 'consume' ? round2(cur - v) : action.resource === 'medkits' ? Math.round(v) : v;
      if (next < 0) return err(state, `Cannot consume ${v}: only ${cur} available.`);
      const who = action.who === 'shared' ? 'Shared pack' : state.survivors.find((s) => s.id === action.who)!.name;
      let s: MissionState;
      if (action.who === 'shared') s = { ...state, shared: { ...state.shared, [action.resource]: next } };
      else s = { ...state, survivors: state.survivors.map((x) => (x.id === action.who ? { ...x, inventory: { ...x.inventory, [action.resource]: next }, updatedAt: now } : x)) };
      const text = action.type === 'consume' ? `${who} used ${v} ${action.resource}.` : `${who} ${action.resource} set to ${next}.`;
      return { state: log(s, now, 'supply', text), extra: [text] };
    }
    case 'treat': {
      const r = treat(state, action.survivor, now);
      if (r.state === state) return err(state, r.message);
      return { state: r.state, extra: [r.message] };
    }
    case 'setSurvivor': {
      const sv = state.survivors.find((x) => x.id === action.id)!;
      const p = action.patch;
      const next: SurvivorState = {
        ...sv,
        health: p.health !== undefined ? clamp(Math.round(p.health), 0, 100) : sv.health,
        energy: p.energy !== undefined ? clamp(Math.round(p.energy), 0, 100) : sv.energy,
        cognition: p.cognition !== undefined ? clamp(Math.round(p.cognition), 0, 100) : sv.cognition,
        injured: p.injured ?? sv.injured,
        updatedAt: now,
      };
      next.flags = next.injured ? [...new Set([...sv.flags, 'Injured'])] : sv.flags.filter((f) => f !== 'Injured');
      const changes: string[] = [];
      if (next.health !== sv.health) changes.push(`health ${Math.round(sv.health)} -> ${next.health}`);
      if (next.energy !== sv.energy) changes.push(`energy ${Math.round(sv.energy)} -> ${next.energy}`);
      if (next.cognition !== sv.cognition) changes.push(`cognition ${Math.round(sv.cognition)} -> ${next.cognition}`);
      if (next.injured !== sv.injured) changes.push(next.injured ? 'injured' : 'injury cleared');
      if (!changes.length) return { state };
      const s = log({ ...state, survivors: state.survivors.map((x) => (x.id === sv.id ? next : x)) }, now, 'health', `${sv.name}: ${changes.join(', ')}.`);
      return { state: s, extra: [`${sv.name}: ${changes.join(', ')}.`] };
    }
    case 'stage3Exception': {
      if (!state.stageCompletedAt[2]) return err(state, 'An exception can be recorded once the group has crossed the city (stage 2).');
      if (state.stageCompletedAt[3]) return err(state, 'Stage 3 is already complete.');
      if (action.note.trim().length < 5) return err(state, 'Describe why supplies cannot be obtained.');
      return { state: log({ ...state, stage3Exception: action.note.trim().slice(0, 140) }, now, 'stage', `Stage 3 exception recorded: ${action.note.trim()}`) };
    }
    case 'importSync': {
      const r = mergePayload(state, action.payload, now);
      if (r.report.alreadyImported) return { state, toast: { kind: 'error', text: 'This update was already imported.' }, merge: r.report };
      return { state: r.state, merge: r.report, extra: [r.state.log[r.state.log.length - 1].text, ...r.report.conflicts.map((c) => `Conflict retained: ${c}`)] };
    }
    case 'message': {
      const text = action.text.trim().slice(0, 140);
      if (!text) return err(state, 'Message is empty.');
      const m = { id: uid('msg'), text, from: action.from, device: ctx.device, at: now };
      return { state: log({ ...state, messages: [...state.messages, m] }, now, 'sync', `Urgent message saved: "${text}"`), toast: { kind: 'info', text: 'Message saved. Add it to a sync QR to share it.' } };
    }
    case 'resetInventory': {
      const init = createInitialState(ctx.realNow, state.config);
      const survivors = state.survivors.map((x) => ({ ...x, inventory: { ...init.survivors.find((y) => y.id === x.id)!.inventory }, updatedAt: now }));
      return { state: log({ ...state, survivors, shared: { ...init.shared }, collected: {} }, now, 'supply', 'Inventories reset to scenario defaults.'), extra: ['Inventories reset to scenario defaults.'] };
    }
    case 'setConfig': {
      return { state: log({ ...state, config: action.config }, now, 'system', 'Planning configuration updated.'), extra: ['Weights or consumption rates changed.'] };
    }
  }
}

export function runAction(state: MissionState, action: Action, ctx: Ctx): Outcome & { plan: PlanResult } {
  const before = plan(state, ctx.realNow);
  const out = applyRaw(state, action, ctx, before);
  if (out.state === state) return { ...out, plan: before };
  let s = out.state;
  if (action.type === 'reset') {
    const p = plan(s, ctx.realNow);
    return { state: s, toast: out.toast, plan: p };
  }
  let after = plan(s, ctx.realNow);
  const title = EXPLAIN[action.type];
  const changed = (before.recommended?.id ?? null) !== (after.recommended?.id ?? null);
  if (title && (out.extra || changed)) {
    s = { ...s, lastChange: explain(title, before, after, s, ctx.realNow, out.extra ?? []) };
  }
  if (action.type === 'advance') s = { ...s, previousRoute: null, lastChange: null };
  else if (changed && before.recommended) s = { ...s, previousRoute: before.recommended.nodes };
  if (changed && action.type !== 'advance') {
    s = log(s, missionNow(s, ctx.realNow), 'route', after.recommended ? `Route changed to ${after.recommended.name} (${fmtDuration(after.recommended.travelMin)}).` : 'No feasible route remains.');
  }
  // stage completion (may need several passes: e.g. stage 3 completes right after stage 2)
  for (let i = 0; i < 5; i++) {
    const newly = checkStages(s, after, ctx.realNow);
    const ids = Object.keys(newly);
    if (!ids.length) break;
    s = { ...s, stageCompletedAt: { ...s.stageCompletedAt, ...newly } };
    for (const id of ids) s = log(s, missionNow(s, ctx.realNow), 'stage', `Stage ${id} complete.`);
    after = plan(s, ctx.realNow);
  }
  return { state: s, toast: out.toast ?? (title && s.lastChange ? { kind: 'event', text: s.lastChange.title } : undefined), merge: out.merge, plan: after };
}

/** Re-check stages without an action (e.g. when the deadline passes). */
export function refreshStages(state: MissionState, realNow: number, p: PlanResult): MissionState {
  const newly = checkStages(state, p, realNow);
  if (!Object.keys(newly).length) return state;
  return { ...state, stageCompletedAt: { ...state.stageCompletedAt, ...newly } };
}
