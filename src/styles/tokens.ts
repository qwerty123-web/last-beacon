import type { AmenityType, Severity } from '../types';

/** One source of truth for colours used on the map (mirrors CSS custom properties in app.css). */
export const SEV_COLOR: Record<Severity, string> = { 0: '#4fb37a', 1: '#e3a23b', 2: '#ec7a3c', 3: '#e5484d' };
export const AMENITY_COLOR: Record<AmenityType, string> = {
  water: '#3bb8c9',
  food: '#b79ef0',
  medical: '#f07fa8',
  safehouse: '#b8c4d0',
  cache: '#e9edf2',
};
export const ROUTE = '#8ec5ff';
export const ROUTE_CASING = '#0b2238';
export const ALT = '#b3c0ce';
export const PREV = '#6b7b8c';
export const COMPARE = '#f4f1e8';
export const DISCOVERED = '#7fd6c4';
export const BLOCKED = '#e5484d';

export const BASEMAP = {
  sea: '#0c1722',
  land: '#151f29',
  building: '#202c38',
  buildingStroke: '#26333f',
  park: '#16271f',
  water: '#10283a',
  major: '#4a5868',
  minor: '#35424f',
  path: '#2e3a46',
  tunnel: '#2a3540',
  pier: '#2a3744',
};
