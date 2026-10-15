/**
 * Route uncertainty: a deterministic, documented estimate of how little we know about a segment.
 * Unknown roads are never assumed safe.
 *
 *   U(e) = clamp( base + age + status + tunnel + reportTrust + conflict , 0, 1 )
 *
 *   base         verified 0.05 | known 0.15 | unexplored 0.45
 *                discovered path: verified 0.10 | unverified 0.50
 *                segments the group has walked during this mission count as verified with age 0
 *   age          0.20 x min(1, minutes since latest report / 360); never reported -> 0.20
 *   status       +0.10 if the road's open/closed status is unknown
 *   tunnel       +0.60 x fraction of the segment that is a road tunnel (unlit, enclosed, no side exits)
 *   reportTrust  +0.15 x (1 - mean(confidence x source reliability)) of threat reports touching the segment
 *   conflict     +0.20 if threat reports on the segment disagree by >= 2 severity levels
 *
 * Route uncertainty is the distance-weighted mean of U(e). The UI shows 1 - U as a
 * "model-derived information confidence". It is NOT a probability of survival.
 */
import type { RuntimeEdge } from './graph';
import type { EdgeThreat } from '../threats/effects';

export function edgeUncertainty(e: RuntimeEdge, nowMinutesSinceStart: number, walked: boolean, threat: EdgeThreat | undefined): number {
  let u: number;
  let age: number | null;
  if (walked) {
    u = 0.05;
    age = 0;
  } else if (e.origin === 'discovered') {
    u = e.pathVerified ? 0.1 : 0.5;
    age = 0;
  } else {
    u = e.know === 'verified' ? 0.05 : e.know === 'known' ? 0.15 : 0.45;
    age = e.age === null ? null : e.age + Math.max(0, nowMinutesSinceStart);
  }
  u += age === null ? 0.2 : 0.2 * Math.min(1, age / 360);
  if (!walked && !e.statusKnown) u += 0.1;
  if (!walked) u += 0.6 * e.tunnel;
  if (threat) {
    u += 0.15 * (1 - Math.min(1, threat.trust));
    if (threat.conflict) u += 0.2;
  }
  return Math.max(0, Math.min(1, u));
}

export function uncertaintyLabel(u: number): 'Low' | 'Medium' | 'High' {
  return u < 0.25 ? 'Low' : u < 0.45 ? 'Medium' : 'High';
}
