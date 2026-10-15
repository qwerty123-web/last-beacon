import type { LatLng } from '../types';

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Local equirectangular projection (metres) around a reference latitude; accurate at city scale. */
function project(p: LatLng, refLat: number): [number, number] {
  return [rad(p[1]) * R * Math.cos(rad(refLat)), rad(p[0]) * R];
}

/** Distance in metres from point p to segment ab. */
export function pointSegmentDistance(p: LatLng, a: LatLng, b: LatLng): number {
  const ref = p[0];
  const [px, py] = project(p, ref);
  const [ax, ay] = project(a, ref);
  const [bx, by] = project(b, ref);
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance in metres from point p to a polyline. */
export function pointPolylineDistance(p: LatLng, line: LatLng[]): number {
  if (line.length === 1) return haversine(p, line[0]);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const d = pointSegmentDistance(p, line[i], line[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

export function polylineLength(line: LatLng[]): number {
  let s = 0;
  for (let i = 0; i < line.length - 1; i++) s += haversine(line[i], line[i + 1]);
  return s;
}

/** Resample a polyline every `step` metres (keeps first and last points). */
export function resample(line: LatLng[], step: number): LatLng[] {
  if (line.length < 2) return line.slice();
  const out: LatLng[] = [line[0]];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const d = haversine(a, b);
    const n = Math.floor(d / step);
    for (let k = 1; k <= n; k++) {
      const f = (k * step) / d;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
  }
  out.push(line[line.length - 1]);
  return out;
}

export function inBBox(p: LatLng, bbox: [number, number, number, number]): boolean {
  const [s, w, n, e] = bbox;
  return p[0] >= s && p[0] <= n && p[1] >= w && p[1] <= e;
}
