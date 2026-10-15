/**
 * LAST BEACON domain model.
 * All survivor, supply and threat values are fictional simulation parameters for a hackathon prototype.
 */

export type LatLng = [number, number];

/* ------------------------------------------------------------------ map graph */

export type Knowledge = 'verified' | 'known' | 'unexplored';

/** A routable location: an intersection, shelter, amenity attachment point or the settlement. */
export interface MapNode {
  id: string;
  lat: number;
  lng: number;
  name?: string;
}

/** A traversable road or path segment between two nodes, built from real OSM geometry. */
export interface RoadEdge {
  id: string;
  a: string;
  b: string;
  /** length in metres */
  len: number;
  /** OSM highway class */
  hw: string;
  name: string;
  /** fraction of the segment that is stairs (0..1) */
  steps: number;
  /** fraction of the segment that is a road tunnel (0..1) */
  tunnel: number;
  /** geometry [lat, lng][] from a to b */
  g: LatLng[];
  /** how much the group knows about this segment */
  know: Knowledge;
  /** minutes between the latest report on this segment and scenario start (null = never reported) */
  age: number | null;
  /** whether the road's current status (open/closed) is known */
  statusKnown: boolean;
}

export interface GraphMeta {
  source: string;
  snapshot: string;
  bbox: [number, number, number, number];
  version: string;
}

export type AmenityType = 'water' | 'food' | 'medical' | 'safehouse' | 'cache';

export interface Supplies {
  water?: number; // litres
  food?: number; // meals
  medkits?: number;
}

export interface Amenity {
  id: string;
  type: AmenityType;
  name: string;
  lat: number;
  lng: number;
  node: string;
  supplies: Supplies;
  /** absolute ms timestamp of the latest report */
  reportedAt: number;
  notes: string;
  origin: 'scenario' | 'discovered' | 'simulated' | 'sync';
  compromised?: boolean;
  /** device that created it */
  device?: string;
}

export interface BaseGraph {
  meta: GraphMeta;
  nodes: MapNode[];
  edges: RoadEdge[];
  amenities: Array<Omit<Amenity, 'reportedAt' | 'origin'> & { ageMin: number }>;
  landmarks: { shelter: string; exit: string; settlement: string; gates: string[]; market: string };
}

/** A path the group discovered in the field. Usable by the planner only once validated. */
export interface DiscoveredPath {
  id: string;
  a: string;
  b: string;
  len: number;
  terrain: 'flat' | 'stairs' | 'rough';
  createdAt: number;
  /** 'valid' = passed validation and is routable; 'invalid' = kept for reference, not routable */
  validation: 'valid' | 'invalid';
  validationNote: string;
  /** walked and confirmed by the group */
  verified: boolean;
  origin: 'discovered' | 'sync';
  device: string;
  note: string;
}

/* ------------------------------------------------------------------ threats */

export type ThreatCategory =
  | 'horde'
  | 'collapse'
  | 'roadblock'
  | 'fire'
  | 'flood'
  | 'structural'
  | 'movement'
  | 'cache'
  | 'safehouse_compromised';

export type Severity = 0 | 1 | 2 | 3;

export type ThreatSource = 'simulated' | 'user' | 'sync' | 'scenario';

export interface ThreatTarget {
  kind: 'node' | 'edge';
  id: string;
}

export interface ThreatHistoryEntry {
  at: number;
  note: string;
}

export interface ThreatReport {
  id: string;
  category: ThreatCategory;
  severity: Severity;
  /** reporter's confidence, 0..1 */
  confidence: number;
  lat: number;
  lng: number;
  target: ThreatTarget;
  /** human readable location (street or landmark) */
  place: string;
  description: string;
  source: ThreatSource;
  /** who reported it, e.g. "Aarav (device A3F2)" */
  reporter: string;
  /** device id that created the report (provenance) */
  device: string;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'resolved';
  /** level 3 blocks the road only when the hazard is impassable */
  impassable: boolean;
  history: ThreatHistoryEntry[];
  /** amenity created (supply cache) or affected (compromised safehouse) by this report */
  amenityId?: string;
}

/* ------------------------------------------------------------------ survivors & resources */

export interface Inventory {
  water: number; // litres
  food: number; // meals
  medkits: number;
}

export interface SurvivorState {
  id: 'aarav' | 'mira';
  name: string;
  health: number; // 0..100
  energy: number; // 0..100
  cognition: number; // 0..100
  injured: boolean;
  flags: string[];
  inventory: Inventory;
  updatedAt: number;
}

export interface ConsumptionConfig {
  /** litres per survivor per hour of travel */
  waterPerHour: number;
  /** meals per survivor per hour of travel */
  foodPerHour: number;
  /** energy points per km on flat ground */
  energyPerKm: number;
  /** reserve thresholds per survivor */
  reserveWater: number;
  reserveFood: number;
  /** base walking speed of a healthy group, km/h */
  baseSpeedKmh: number;
}

export interface CostWeights {
  wT: number;
  wR: number;
  wS: number;
  wU: number;
  wH: number;
}

export interface MissionConfig {
  weights: CostWeights;
  consumption: ConsumptionConfig;
  /** minutes added to "now" to form the deadline when the scenario is reset */
  deadlineOffsetMin: number;
  /** a report becomes stale after this many minutes */
  staleAfterMin: number;
}

/* ------------------------------------------------------------------ mission */

export type StageId = 1 | 2 | 3 | 4 | 5;

export interface LogEntry {
  at: number;
  kind: 'threat' | 'route' | 'supply' | 'health' | 'stage' | 'sync' | 'move' | 'system';
  text: string;
}

export interface UrgentMessage {
  id: string;
  text: string;
  from: string;
  device: string;
  at: number;
}

export interface MissionState {
  schema: 1;
  scenarioStartedAt: number;
  /** absolute timestamp (ms) when the beacon shuts down */
  deadline: number;
  /** simulated travel time already spent, ms; mission clock = real now + this */
  simElapsedMs: number;
  /** node the group currently stands on */
  position: string;
  /** nodes traversed, in order */
  trail: string[];
  /** edges traversed (become verified knowledge) */
  walkedEdges: string[];
  /** distance already walked, metres */
  walkedM: number;
  survivors: SurvivorState[];
  shared: Inventory & { equipment: string[] };
  threats: ThreatReport[];
  amenities: Amenity[];
  /** amenities whose supplies were collected: id -> amounts taken */
  collected: Record<string, Supplies>;
  paths: DiscoveredPath[];
  messages: UrgentMessage[];
  /** ids of simulated events in creation order (undo stack keys) */
  simulatedIds: string[];
  stageCompletedAt: Partial<Record<StageId, number>>;
  stage3Exception: string | null;
  /** ids of sync imports already applied */
  importedUpdates: string[];
  syncConflicts: string[];
  config: MissionConfig;
  log: LogEntry[];
  /** previous recommended route (faint line after a change) */
  previousRoute: string[] | null;
  lastChange: RouteChangeNote | null;
}

export interface RouteChangeNote {
  at: number;
  title: string;
  lines: string[];
}

/* ------------------------------------------------------------------ routing results */

export type RouteStatus = 'RECOMMENDED' | 'FEASIBLE' | 'HIGH RISK' | 'RESOURCE SHORTAGE' | 'DEADLINE INFEASIBLE';

export interface SupplyStop {
  amenityId: string;
  nodeId: string;
  name: string;
  gain: Supplies;
  /** whether a medkit picked up here is used to treat an injury */
  treat: boolean;
}

export interface RouteEvaluation {
  id: string;
  name: string;
  /** main named streets in travel order */
  streets: string[];
  nodes: string[];
  edges: string[];
  distanceM: number;
  travelMin: number;
  arrivalAt: number;
  /** composite cost (sum of C(e)) */
  cost: number;
  /** mean threat exposure 0..1+ weighted by distance, and the label */
  threatScore: number;
  threatLabel: 'Clear' | 'Low' | 'Moderate' | 'High' | 'Critical';
  maxSeverity: Severity;
  significantHazards: number;
  hazardIds: string[];
  /** distance-weighted uncertainty 0..1 */
  uncertainty: number;
  /** model-derived information confidence = 1 - uncertainty */
  confidence: number;
  water: number; // litres combined
  food: number; // meals combined
  energy: Record<string, number>; // per survivor energy cost
  resourcesOk: boolean;
  belowReserve: string[];
  shortages: string[];
  deadlineOk: boolean;
  deadlineMarginMin: number;
  status: RouteStatus;
  stops: SupplyStop[];
  /** sum of each normalised cost term along the route */
  terms: { T: number; R: number; S: number; U: number; H: number };
  /** number of impassable segments on the route (only possible for user-drawn routes) */
  blockedSegments: number;
  approximate?: boolean;
  notes: string[];
}

export interface PlanResult {
  recommended: RouteEvaluation | null;
  alternatives: RouteEvaluation[];
  reason: string[];
  /** when no route is feasible, why */
  infeasibleReasons: string[];
  detourConsidered: boolean;
  detourNote: string | null;
}
