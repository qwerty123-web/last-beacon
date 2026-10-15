/**
 * Discovered-path validation. A path the group marks in the field becomes routable only if:
 *   - both endpoints are existing graph nodes and are different
 *   - straight-line length is between 5 m and 500 m
 *   - no existing segment already connects the two endpoints directly
 *   - terrain is one of flat | stairs | rough
 * Length is estimated as straight-line distance x 1.15 (paths are rarely straight).
 */
import type { DiscoveredPath } from '../types';
import { baseGraph, type RuntimeGraph } from './graph';
import { haversine } from '../utils/geo';

export function validatePath(g: RuntimeGraph, a: string, b: string, terrain: string): { validation: 'valid' | 'invalid'; note: string; len: number } {
  const na = g.nodes.get(a);
  const nb = g.nodes.get(b);
  if (!na || !nb) return { validation: 'invalid', note: 'An endpoint is not on the mapped road network.', len: 0 };
  if (a === b) return { validation: 'invalid', note: 'Both ends snap to the same point.', len: 0 };
  if (!['flat', 'stairs', 'rough'].includes(terrain)) return { validation: 'invalid', note: 'Unknown terrain type.', len: 0 };
  const d = haversine([na.lat, na.lng], [nb.lat, nb.lng]);
  const len = Math.round(d * 1.15 * 10) / 10;
  if (d < 5) return { validation: 'invalid', note: 'Shorter than 5 m: endpoints are effectively the same.', len };
  if (d > 500) return { validation: 'invalid', note: 'Longer than 500 m: split it into shorter verified sections.', len };
  for (const { to } of g.adj.get(a) ?? []) if (to === b) return { validation: 'invalid', note: 'A mapped road already connects these points.', len };
  return { validation: 'valid', note: 'Endpoints and length validated. Unverified until walked.', len };
}

export function revalidate(p: DiscoveredPath): DiscoveredPath {
  const v = validatePath(baseGraph(), p.a, p.b, p.terrain);
  return { ...p, validation: v.validation, validationNote: v.note, len: v.len || p.len };
}
