import type { Severity, ThreatCategory, ThreatSource } from '../types';

export interface ThreatSpec {
  label: string;
  /** threat = affects routing; cache = adds a supply amenity; safehouse = compromises a safehouse */
  kind: 'threat' | 'cache' | 'safehouse';
  defaultSeverity: Severity;
  maxSeverity: Severity;
  /** hazard core: segments within this distance receive the full severity (and may be blocked) */
  coreRadiusM: number;
  /** spill zone: segments within this distance receive severity - 1 (never blocked) */
  spillRadiusM: number;
  /** whether a level 3 report of this kind makes the road impassable by default */
  impassableDefault: boolean;
  /** prefer snapping to a road segment (true) or a location/intersection (false) */
  snap: 'edge' | 'node';
}

export const THREAT_CATALOG: Record<ThreatCategory, ThreatSpec> = {
  horde: { label: 'Zombie horde', kind: 'threat', defaultSeverity: 3, maxSeverity: 3, coreRadiusM: 45, spillRadiusM: 140, impassableDefault: true, snap: 'node' },
  collapse: { label: 'Building collapse', kind: 'threat', defaultSeverity: 3, maxSeverity: 3, coreRadiusM: 20, spillRadiusM: 50, impassableDefault: true, snap: 'edge' },
  roadblock: { label: 'Road blocked', kind: 'threat', defaultSeverity: 3, maxSeverity: 3, coreRadiusM: 0, spillRadiusM: 0, impassableDefault: true, snap: 'edge' },
  fire: { label: 'Fire', kind: 'threat', defaultSeverity: 2, maxSeverity: 3, coreRadiusM: 35, spillRadiusM: 90, impassableDefault: true, snap: 'node' },
  flood: { label: 'Flooded passage', kind: 'threat', defaultSeverity: 2, maxSeverity: 3, coreRadiusM: 0, spillRadiusM: 30, impassableDefault: true, snap: 'edge' },
  structural: { label: 'Structural damage', kind: 'threat', defaultSeverity: 2, maxSeverity: 3, coreRadiusM: 20, spillRadiusM: 50, impassableDefault: false, snap: 'edge' },
  movement: { label: 'Unknown movement', kind: 'threat', defaultSeverity: 1, maxSeverity: 2, coreRadiusM: 60, spillRadiusM: 120, impassableDefault: false, snap: 'node' },
  cache: { label: 'Supply cache discovered', kind: 'cache', defaultSeverity: 0, maxSeverity: 0, coreRadiusM: 0, spillRadiusM: 0, impassableDefault: false, snap: 'node' },
  safehouse_compromised: { label: 'Safehouse compromised', kind: 'safehouse', defaultSeverity: 2, maxSeverity: 3, coreRadiusM: 30, spillRadiusM: 80, impassableDefault: false, snap: 'node' },
};

export const CATEGORY_ORDER: ThreatCategory[] = ['horde', 'collapse', 'roadblock', 'fire', 'flood', 'structural', 'movement', 'cache', 'safehouse_compromised'];

export const SEVERITY_LABEL: Record<Severity, string> = { 0: 'Clear', 1: 'Caution', 2: 'Dangerous', 3: 'Critical' };

/**
 * Route-cost penalty per severity level (R term before confidence/freshness weighting).
 * Level 0 adds nothing; level 1 is a mild increase; level 2 is substantial; level 3 that is not blocked is very high.
 */
export const LEVEL_PENALTY: Record<Severity, number> = { 0: 0, 1: 0.35, 2: 1.4, 3: 3.5 };

/** How much each source is trusted by default (multiplies the reporter's own confidence). */
export const SOURCE_RELIABILITY: Record<ThreatSource, number> = {
  simulated: 1.0, // demo events are treated as ground truth but always labelled SIMULATED
  user: 0.9, // first-hand report from this group
  sync: 0.85, // received from another survivor device
  scenario: 0.75, // pre-mission intel, possibly outdated
};

/** A level 3 impassable report blocks a road only if its confidence is at least this. */
export const BLOCK_MIN_CONFIDENCE = 0.35;
