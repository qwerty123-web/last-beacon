import { describe, expect, it } from 'vitest';
import { buildPayload, decodePayload, encodePayload, fnv1a, SAFE_QR_CHARS } from '../sync/payload';
import { mergePayload } from '../sync/merge';
import { runAction } from '../app/engine';
import { plan } from '../routing/planner';
import { computeThreatEffects } from '../threats/effects';
import { buildGraph, BASE } from '../routing/graph';
import { CTX, NOW, cleanState, threat } from './helpers';

const empty = { threats: [], amenities: [], paths: [], messages: [], survivors: [] as Array<'aarav' | 'mira'> };
const market = () => BASE.nodes.find((n) => n.id === BASE.landmarks.market)!;

function deviceA() {
  const m = market();
  let s = cleanState();
  s = runAction(s, { type: 'addThreat', input: { category: 'horde', severity: 3, confidence: 0.85, description: 'Large group at the market', latlng: [m.lat, m.lng], reporter: 'Mira' } }, { ...CTX, device: 'MIRA' }).state;
  s = runAction(s, { type: 'message', text: 'Avoid Place d’Armes', from: 'Mira' }, { ...CTX, device: 'MIRA' }).state;
  return s;
}

describe('QR payload validation', () => {
  it('round-trips a compact payload', () => {
    const a = deviceA();
    const p = buildPayload(a, { ...empty, threats: [a.threats[0].id], messages: [a.messages[0].id] }, 'MIRA', 'Mira', NOW);
    const text = encodePayload(p);
    expect(text.startsWith('LB1:')).toBe(true);
    expect(text.length).toBeLessThan(SAFE_QR_CHARS);
    const d = decodePayload(text, NOW);
    expect(d.ok).toBe(true);
  });

  it('rejects malformed payloads', () => {
    const a = deviceA();
    const text = encodePayload(buildPayload(a, { ...empty, threats: [a.threats[0].id] }, 'MIRA', 'Mira', NOW));
    expect(decodePayload('hello', NOW).ok).toBe(false);
    expect(decodePayload(text.replace('"s":3', '"s":7'), NOW).ok).toBe(false); // checksum mismatch
    const bad = JSON.parse(text.slice(13));
    bad.t[0].s = 9;
    const j = JSON.stringify(bad);
    expect(decodePayload(`LB1:${fnv1a(j)}:${j}`, NOW)).toMatchObject({ ok: false });
    bad.t[0].s = 3;
    bad.v = 2;
    const j2 = JSON.stringify(bad);
    expect(decodePayload(`LB1:${fnv1a(j2)}:${j2}`, NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/version/) });
    bad.v = 1;
    bad.t[0].la = 48.85; // Paris: outside the map area
    const j3 = JSON.stringify(bad);
    expect(decodePayload(`LB1:${fnv1a(j3)}:${j3}`, NOW).ok).toBe(false);
  });

  it('rejects empty updates', () => {
    const p = buildPayload(cleanState(), empty, 'MIRA', 'Mira', NOW);
    expect(decodePayload(encodePayload(p), NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/empty/) });
  });
});

describe('QR merge', () => {
  it('imports reports, preserves provenance and recalculates the route', () => {
    const a = deviceA();
    const p = buildPayload(a, { ...empty, threats: [a.threats[0].id], messages: [a.messages[0].id] }, 'MIRA', 'Mira', NOW);
    const d = decodePayload(encodePayload(p), NOW);
    if (!d.ok) throw new Error(d.error);
    const b = cleanState();
    const before = plan(b, NOW).recommended!;
    const out = runAction(b, { type: 'importSync', payload: d.payload }, { ...CTX, device: 'AARV' });
    const t = out.state.threats.find((x) => x.id === a.threats[0].id)!;
    expect(t.source).toBe('sync');
    expect(t.device).toBe('MIRA');
    expect(t.reporter).toMatch(/via Mira/);
    expect(out.state.messages).toHaveLength(1);
    expect(out.plan.recommended!.id).not.toBe(before.id);
    expect(out.state.importedUpdates).toContain(p.id);
  });

  it('deduplicates repeated updates and repeated reports', () => {
    const a = deviceA();
    const p = buildPayload(a, { ...empty, threats: [a.threats[0].id] }, 'MIRA', 'Mira', NOW);
    const b = cleanState();
    const once = mergePayload(b, p, NOW).state;
    const again = mergePayload(once, p, NOW);
    expect(again.report.alreadyImported).toBe(true);
    expect(again.state.threats).toHaveLength(1);
    // same report in a different update: counted as duplicate, not added twice
    const p2 = { ...p, id: p.id + 'x' };
    const third = mergePayload(once, p2, NOW);
    expect(third.state.threats).toHaveLength(1);
    expect(third.report.duplicates).toBe(1);
  });

  it('applies a newer revision of the same report', () => {
    const a = deviceA();
    const id = a.threats[0].id;
    const b = mergePayload(cleanState(), buildPayload(a, { ...empty, threats: [id] }, 'MIRA', 'Mira', NOW), NOW).state;
    const a2 = runAction(a, { type: 'reviseThreat', id, patch: { status: 'resolved' }, note: 'Horde moved on' }, { ...CTX, realNow: NOW + 120000 }).state;
    const p2 = buildPayload(a2, { ...empty, threats: [id] }, 'MIRA', 'Mira', NOW + 120000);
    const out = mergePayload(b, p2, NOW + 120000);
    expect(out.report.threatsUpdated).toBe(1);
    const t = out.state.threats.find((x) => x.id === id)!;
    expect(t.status).toBe('resolved');
    expect(t.history.at(-1)!.note).toMatch(/Revised via QR sync/);
  });

  it('keeps conflicting reports and resolves them by trust, not recency alone', () => {
    const m = market();
    const g = buildGraph([]);
    const local = threat('local-l3', 'horde', 3, { kind: 'node', id: m.id }, m.lat, m.lng, { confidence: 0.9, source: 'user', updatedAt: NOW - 20 * 60000 });
    const b = { ...cleanState(), threats: [local] };
    // incoming: newer but low-confidence "only movement" report on the same crossing
    const sender = { ...cleanState(), threats: [threat('remote-l1', 'movement', 1, { kind: 'node', id: m.id }, m.lat, m.lng, { confidence: 0.3, source: 'user' })] };
    const p = buildPayload(sender, { ...empty, threats: ['remote-l1'] }, 'MIRA', 'Mira', NOW);
    const out = mergePayload(b, p, NOW);
    expect(out.report.conflicts).toHaveLength(1);
    expect(out.state.threats.map((t) => t.id).sort()).toEqual(['local-l3', 'remote-l1']);
    expect(out.state.syncConflicts).toHaveLength(1);
    const fx = computeThreatEffects(g, out.state, NOW);
    const e = g.adj.get(m.id)![0].edge;
    expect(fx.get(e)!.conflict).toBe(true);
    expect(fx.get(e)!.blocked).toBe(true); // safety bias: the trusted critical report still holds

    // a highly trusted fresh all-clear CAN outweigh a weak, stale critical report
    const weak = threat('weak-l3', 'horde', 3, { kind: 'node', id: m.id }, m.lat, m.lng, { confidence: 0.4, source: 'scenario', updatedAt: NOW - 400 * 60000 });
    const clear = threat('clear-l0', 'movement', 0, { kind: 'node', id: m.id }, m.lat, m.lng, { confidence: 1, source: 'user' });
    const fx2 = computeThreatEffects(g, { threats: [weak, clear], config: b.config }, NOW);
    expect(fx2.get(e)!.blocked).toBe(false);
    expect(fx2.get(e)!.conflict).toBe(true);
  });

  it('applies shared survivor status only when newer', () => {
    const a = cleanState();
    const aMira = { ...a, survivors: a.survivors.map((x) => (x.id === 'mira' ? { ...x, injured: true, inventory: { ...x.inventory, water: 0.2 }, updatedAt: NOW + 5000 } : x)) };
    const p = buildPayload(aMira, { ...empty, survivors: ['mira'] }, 'MIRA', 'Mira', NOW + 5000);
    const out = mergePayload(cleanState(), p, NOW + 6000);
    const mira = out.state.survivors.find((x) => x.id === 'mira')!;
    expect(mira.injured).toBe(true);
    expect(mira.inventory.water).toBe(0.2);
    expect(out.report.survivorUpdates[0]).toMatch(/water 0.6 -> 0.2/);
  });
});
