/**
 * QR sync payload: a compact, versioned DELTA of selected updates (never the whole mission state).
 *
 * Wire format:  LB1:<fnv1a-32 checksum, 8 hex>:<compact JSON>
 * Schema v1 (short keys keep QR codes small):
 *   { v:1, id, g:<graph version>, f:{d:<device>, n:<name>}, at:<unix s>,
 *     t?: threats[], a?: amenities[], p?: paths[], m?: messages[], s?: survivor status[] }
 */
import type { Amenity, DiscoveredPath, MissionState, Severity, SurvivorState, ThreatCategory, ThreatReport, UrgentMessage } from '../types';
import { THREAT_CATALOG } from '../threats/catalog';
import { BASE } from '../routing/graph';

export const SYNC_PREFIX = 'LB1:';
/** Above this many characters QR scanning on phones becomes unreliable. */
export const SAFE_QR_CHARS = 1100;
/** Hard limit (QR version 40-L byte capacity is 2953). */
export const MAX_QR_CHARS = 2300;
const MAX_ITEMS = 12;
const MAX_TEXT = 140;

export interface CThreat {
  i: string; c: ThreatCategory; s: Severity; f: number; la: number; ln: number; k: 'n' | 'e'; x: string;
  pl: string; d: string; o: 'sim' | 'usr' | 'scn' | 'syn'; r: string; dv: string; ca: number; ua: number; st: 'a' | 'r'; im: 0 | 1;
}
export interface CAmenity { i: string; y: Amenity['type']; n: string; la: number; ln: number; x: string; w: number; fd: number; mk: number; ra: number; cp: 0 | 1; nt: string }
export interface CPath { i: string; a: string; b: string; tr: DiscoveredPath['terrain']; ca: number; vf: 0 | 1; nt: string }
export interface CMsg { i: string; tx: string; fr: string; dv: string; at: number }
export interface CSurv { i: SurvivorState['id']; h: number; e: number; cg: number; inj: 0 | 1; w: number; fd: number; mk: number; ua: number }

export interface SyncPayload {
  v: 1;
  id: string;
  g: string;
  f: { d: string; n: string };
  at: number;
  t?: CThreat[];
  a?: CAmenity[];
  p?: CPath[];
  m?: CMsg[];
  s?: CSurv[];
}

export interface Selection {
  threats: string[];
  amenities: string[];
  paths: string[];
  messages: string[];
  survivors: Array<SurvivorState['id']>;
}

const sec = (ms: number) => Math.round(ms / 1000);
const ms = (s: number) => s * 1000;
const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
const cut = (s: string) => (s ?? '').slice(0, MAX_TEXT);
const SRC: Record<ThreatReport['source'], CThreat['o']> = { simulated: 'sim', user: 'usr', scenario: 'scn', sync: 'syn' };
const SRC_BACK: Record<CThreat['o'], ThreatReport['source']> = { sim: 'simulated', usr: 'user', scn: 'scenario', syn: 'sync' };

export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function buildPayload(state: MissionState, sel: Selection, device: string, name: string, now: number): SyncPayload {
  const p: SyncPayload = { v: 1, id: `u-${device}-${now.toString(36)}`, g: BASE.meta.version, f: { d: device, n: cut(name) }, at: sec(now) };
  const t = state.threats.filter((x) => sel.threats.includes(x.id));
  if (t.length)
    p.t = t.map((x) => ({
      i: x.id, c: x.category, s: x.severity, f: Math.round(x.confidence * 100), la: r5(x.lat), ln: r5(x.lng),
      k: x.target.kind === 'node' ? 'n' : 'e', x: x.target.id, pl: cut(x.place).slice(0, 48), d: cut(x.description).slice(0, 80),
      o: SRC[x.source], r: cut(x.reporter).slice(0, 40), dv: x.device, ca: sec(x.createdAt), ua: sec(x.updatedAt), st: x.status === 'active' ? 'a' : 'r', im: x.impassable ? 1 : 0,
    }));
  const a = state.amenities.filter((x) => sel.amenities.includes(x.id));
  if (a.length)
    p.a = a.map((x) => ({
      i: x.id, y: x.type, n: cut(x.name).slice(0, 40), la: r5(x.lat), ln: r5(x.lng), x: x.node, w: x.supplies.water ?? 0, fd: x.supplies.food ?? 0,
      mk: x.supplies.medkits ?? 0, ra: sec(x.reportedAt), cp: x.compromised ? 1 : 0, nt: cut(x.notes).slice(0, 60),
    }));
  const ps = state.paths.filter((x) => sel.paths.includes(x.id));
  if (ps.length) p.p = ps.map((x) => ({ i: x.id, a: x.a, b: x.b, tr: x.terrain, ca: sec(x.createdAt), vf: x.verified ? 1 : 0, nt: cut(x.note).slice(0, 48) }));
  const m = state.messages.filter((x) => sel.messages.includes(x.id));
  if (m.length) p.m = m.map((x) => ({ i: x.id, tx: cut(x.text), fr: cut(x.from).slice(0, 30), dv: x.device, at: sec(x.at) }));
  const s = state.survivors.filter((x) => sel.survivors.includes(x.id));
  if (s.length)
    p.s = s.map((x) => ({ i: x.id, h: Math.round(x.health), e: Math.round(x.energy), cg: Math.round(x.cognition), inj: x.injured ? 1 : 0, w: x.inventory.water, fd: x.inventory.food, mk: x.inventory.medkits, ua: sec(x.updatedAt) }));
  return p;
}

export function encodePayload(p: SyncPayload): string {
  const json = JSON.stringify(p);
  return `${SYNC_PREFIX}${fnv1a(json)}:${json}`;
}

export type DecodeResult = { ok: true; payload: SyncPayload } | { ok: false; error: string };

/* ------------------------------------------------------------------ validation */

const isStr = (x: unknown, max = MAX_TEXT): x is string => typeof x === 'string' && x.length <= max;
const isId = (x: unknown): x is string => typeof x === 'string' && /^[\w:.-]{1,64}$/.test(x);
const isNum = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const isInt = (x: unknown, lo: number, hi: number) => isNum(x, lo, hi) && Number.isInteger(x);
const [S, W, N, E] = BASE.meta.bbox;
const inArea = (la: unknown, ln: unknown) => isNum(la, S - 0.01, N + 0.01) && isNum(ln, W - 0.01, E + 0.01);
const TS_MIN = 1577836800; // 2020-01-01
const tsOk = (x: unknown, nowS: number) => isInt(x, TS_MIN, nowS + 86400);

function fail(error: string): DecodeResult {
  return { ok: false, error };
}

export function decodePayload(text: string, now: number): DecodeResult {
  const raw = (text ?? '').trim();
  if (raw.length > MAX_QR_CHARS + 20) return fail('Update is too large to be a LAST BEACON sync code.');
  if (!raw.startsWith(SYNC_PREFIX)) return fail('Not a LAST BEACON sync code (missing LB1 header).');
  const rest = raw.slice(SYNC_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep !== 8) return fail('Malformed sync code: checksum missing.');
  const sum = rest.slice(0, 8);
  const json = rest.slice(9);
  if (fnv1a(json) !== sum) return fail('Checksum mismatch: the code was damaged or cut off. Scan again.');
  let p: SyncPayload;
  try {
    p = JSON.parse(json);
  } catch {
    return fail('Malformed sync code: invalid JSON.');
  }
  const nowS = sec(now);
  if (typeof p !== 'object' || p === null) return fail('Malformed payload.');
  if (p.v !== 1) return fail(`Unsupported payload version ${String((p as { v?: unknown }).v)}. Update the app on both devices.`);
  if (!isId(p.id) || !isStr(p.g, 16) || !p.f || !isId(p.f.d) || !isStr(p.f.n, 40) || !tsOk(p.at, nowS)) return fail('Malformed payload header.');
  for (const k of ['t', 'a', 'p', 'm', 's'] as const) {
    const arr = p[k];
    if (arr !== undefined && (!Array.isArray(arr) || arr.length > MAX_ITEMS)) return fail(`Too many or malformed "${k}" entries (max ${MAX_ITEMS}).`);
  }
  for (const t of p.t ?? []) {
    if (!isId(t.i) || !(t.c in THREAT_CATALOG) || !isInt(t.s, 0, 3) || !isInt(t.f, 0, 100) || !inArea(t.la, t.ln)) return fail(`Invalid threat report ${String(t?.i)}.`);
    if (t.s > THREAT_CATALOG[t.c].maxSeverity && THREAT_CATALOG[t.c].kind === 'threat') return fail(`Threat ${t.i}: severity above the category maximum.`);
    if ((t.k !== 'n' && t.k !== 'e') || !isId(t.x) || !isStr(t.pl, 48) || !isStr(t.d, 80) || !['sim', 'usr', 'scn', 'syn'].includes(t.o)) return fail(`Invalid threat target or text in ${t.i}.`);
    if (!isStr(t.r, 40) || !isId(t.dv) || !tsOk(t.ca, nowS) || !tsOk(t.ua, nowS) || t.ua < t.ca || (t.st !== 'a' && t.st !== 'r') || (t.im !== 0 && t.im !== 1)) return fail(`Invalid threat metadata in ${t.i}.`);
  }
  for (const a of p.a ?? []) {
    if (!isId(a.i) || !['water', 'food', 'medical', 'safehouse', 'cache'].includes(a.y) || !isStr(a.n, 40) || !inArea(a.la, a.ln) || !isId(a.x)) return fail(`Invalid amenity ${String(a?.i)}.`);
    if (!isNum(a.w, 0, 50) || !isNum(a.fd, 0, 50) || !isInt(a.mk, 0, 20) || !tsOk(a.ra, nowS) || (a.cp !== 0 && a.cp !== 1) || !isStr(a.nt, 60)) return fail(`Invalid amenity supplies in ${a.i}.`);
  }
  for (const x of p.p ?? []) {
    if (!isId(x.i) || !isId(x.a) || !isId(x.b) || !['flat', 'stairs', 'rough'].includes(x.tr) || !tsOk(x.ca, nowS) || (x.vf !== 0 && x.vf !== 1) || !isStr(x.nt, 48)) return fail(`Invalid path ${String(x?.i)}.`);
  }
  for (const m of p.m ?? []) {
    if (!isId(m.i) || !isStr(m.tx) || !m.tx.trim() || !isStr(m.fr, 30) || !isId(m.dv) || !tsOk(m.at, nowS)) return fail(`Invalid message ${String(m?.i)}.`);
  }
  for (const s of p.s ?? []) {
    if (!['aarav', 'mira'].includes(s.i) || !isInt(s.h, 0, 100) || !isInt(s.e, 0, 100) || !isInt(s.cg, 0, 100) || (s.inj !== 0 && s.inj !== 1)) return fail(`Invalid survivor status ${String(s?.i)}.`);
    if (!isNum(s.w, 0, 50) || !isNum(s.fd, 0, 50) || !isInt(s.mk, 0, 20) || !tsOk(s.ua, nowS)) return fail(`Invalid survivor inventory for ${s.i}.`);
  }
  if (!p.t?.length && !p.a?.length && !p.p?.length && !p.m?.length && !p.s?.length) return fail('The update is empty.');
  return { ok: true, payload: p };
}

/* ------------------------------------------------------------------ expand compact records */

export function expandThreat(t: CThreat, sender: string): ThreatReport {
  const source = t.o === 'sim' ? 'simulated' : 'sync';
  return {
    id: t.i, category: t.c, severity: t.s, confidence: t.f / 100, lat: t.la, lng: t.ln,
    target: { kind: t.k === 'n' ? 'node' : 'edge', id: t.x }, place: t.pl, description: t.d,
    source, reporter: t.r.includes('via ') ? t.r : `${t.r} via ${sender}`.slice(0, 60), device: t.dv,
    createdAt: ms(t.ca), updatedAt: ms(t.ua), status: t.st === 'a' ? 'active' : 'resolved', impassable: t.im === 1,
    history: [{ at: ms(t.ua), note: `Received via QR sync from ${sender} (original source: ${SRC_BACK[t.o]})` }],
  };
}

export function expandAmenity(a: CAmenity, sender: string): Amenity {
  return {
    id: a.i, type: a.y, name: a.n, lat: a.la, lng: a.ln, node: a.x, supplies: { water: a.w, food: a.fd, medkits: a.mk },
    reportedAt: ms(a.ra), notes: a.nt || `Shared by ${sender}`, origin: 'sync', compromised: a.cp === 1, device: sender,
  };
}

export function expandPath(x: CPath, sender: string): DiscoveredPath {
  return { id: x.i, a: x.a, b: x.b, len: 0, terrain: x.tr, createdAt: ms(x.ca), validation: 'invalid', validationNote: 'Pending validation', verified: x.vf === 1, origin: 'sync', device: sender, note: x.nt };
}

export function expandMessage(m: CMsg): UrgentMessage {
  return { id: m.i, text: m.tx, from: m.fr, device: m.dv, at: ms(m.at) };
}

export { ms as secToMs };
