/**
 * Day 19 demonstration scenario. Deterministic: createInitialState(now) depends only on `now`.
 * Places are real (OpenStreetMap, Monaco); every survivor, supply and threat value is fictional.
 */
import type { Amenity, MissionConfig, MissionState, ThreatReport } from '../types';
import { BASE, baseGraph, nearestEdge, nearestNode, placeName } from '../routing/graph';

export const DEFAULT_CONFIG: MissionConfig = {
  weights: { wT: 1, wR: 4, wS: 0.5, wU: 1.2, wH: 0.8 },
  consumption: {
    waterPerHour: 0.5,
    foodPerHour: 0.25,
    energyPerKm: 9,
    reserveWater: 0.25,
    reserveFood: 0.25,
    baseSpeedKmh: 4.2,
  },
  deadlineOffsetMin: 120,
  staleAfterMin: 180,
};

/** Geofence for stage 2: the Sainte-Dévote / La Condamine transit line (longitude). */
export const TRANSIT_LNG = 7.4235;
/** Stage 4: evacuation corridor radius around the settlement, metres. */
export const CORRIDOR_RADIUS_M = 380;

export const SCENARIO_DEVICE = 'SCENARIO';

function scenarioThreats(now: number): ThreatReport[] {
  const g = baseGraph();
  const mk = (
    id: string,
    category: ThreatReport['category'],
    severity: ThreatReport['severity'],
    confidence: number,
    lat: number,
    lng: number,
    snap: 'node' | 'edge',
    ageMin: number,
    description: string,
  ): ThreatReport => {
    const t =
      snap === 'edge'
        ? { kind: 'edge' as const, id: nearestEdge(g, [lat, lng], 200)!.id }
        : { kind: 'node' as const, id: nearestNode(g, [lat, lng], 200)!.id };
    const at = now - ageMin * 60000;
    return {
      id,
      category,
      severity,
      confidence,
      lat,
      lng,
      target: t,
      place: placeName(g, [lat, lng]),
      description,
      source: 'scenario',
      reporter: 'Pre-mission intel (radio, Day 18)',
      device: SCENARIO_DEVICE,
      createdAt: at,
      updatedAt: at,
      status: 'active',
      impassable: severity === 3,
      history: [{ at, note: 'Report received before departure' }],
    };
  };
  return [
    mk('scn-fire-quai', 'fire', 2, 0.6, 43.7325, 7.4243, 'node', 140, 'Smoke reported along the harbour quay'),
    mk('scn-move-moulins', 'movement', 1, 0.5, 43.7402, 7.4252, 'node', 95, 'Movement heard near Boulevard des Moulins'),
    mk('scn-flood-papalins', 'flood', 2, 0.55, 43.7290, 7.4196, 'edge', 220, 'Water over the road near the Fontvieille port'),
  ];
}

function scenarioAmenities(now: number): Amenity[] {
  return BASE.amenities.map((a) => ({
    id: a.id,
    type: a.type,
    name: a.name,
    lat: a.lat,
    lng: a.lng,
    node: a.node,
    supplies: { ...a.supplies },
    reportedAt: now - a.ageMin * 60000,
    notes: a.notes,
    origin: 'scenario',
  }));
}

export function createInitialState(now: number, config: MissionConfig = DEFAULT_CONFIG): MissionState {
  const lm = BASE.landmarks;
  return {
    schema: 1,
    scenarioStartedAt: now,
    deadline: now + config.deadlineOffsetMin * 60000,
    simElapsedMs: 0,
    position: lm.shelter,
    trail: [lm.shelter],
    walkedEdges: [],
    walkedM: 0,
    survivors: [
      {
        id: 'aarav',
        name: 'Aarav',
        health: 82,
        energy: 76,
        cognition: 80,
        injured: false,
        flags: [],
        inventory: { water: 0.9, food: 1, medkits: 1 },
        updatedAt: now,
      },
      {
        id: 'mira',
        name: 'Mira',
        health: 71,
        energy: 64,
        cognition: 74,
        injured: false,
        flags: [],
        inventory: { water: 0.6, food: 0.5, medkits: 0 },
        updatedAt: now,
      },
    ],
    shared: { water: 0.5, food: 0.5, medkits: 0, equipment: ['Torch', 'Rope (15 m)', 'Radio (no signal)'] },
    threats: scenarioThreats(now),
    amenities: scenarioAmenities(now),
    collected: {},
    paths: [],
    messages: [],
    simulatedIds: [],
    stageCompletedAt: {},
    stage3Exception: null,
    importedUpdates: [],
    syncConflicts: [],
    config: structuredClone(config),
    log: [{ at: now, kind: 'system', text: 'Day 19. Aarav and Mira at the Fontvieille Shelter. Beacon closes in ' + config.deadlineOffsetMin + ' min.' }],
    previousRoute: null,
    lastChange: null,
  };
}
