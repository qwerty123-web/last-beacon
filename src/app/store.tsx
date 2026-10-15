import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LatLng, MissionState, PlanResult, Severity, ThreatCategory } from '../types';
import { createInitialState } from '../data/scenario';
import { plan as runPlan } from '../routing/planner';
import { runAction, refreshStages, type Action } from './engine';
import { loadDevice, loadMission, saveDevice, saveMission, type DeviceInfo, type StorageMode } from '../storage/db';
import type { MergeReport } from '../sync/merge';
import type { RouteEvaluation } from '../types';
import type { MatchResult } from '../routing/compare';

export type Tab = 'home' | 'resources' | 'threats' | 'sync';

export type MapMode =
  | { kind: 'idle' }
  | { kind: 'simulate'; category: ThreatCategory; severity: Severity }
  | { kind: 'compare'; points: LatLng[] }
  | { kind: 'pick'; purpose: 'threat' | 'amenity'; }
  | { kind: 'path'; points: LatLng[] };

export type Layer = 'route' | 'alternatives' | 'threats' | 'water' | 'food' | 'medical' | 'safehouse' | 'cache' | 'paths' | 'zones';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'event';
  text: string;
}

export interface MapStatus {
  offline: 'loading' | 'available' | 'unavailable';
  online: 'off' | 'loading' | 'available' | 'unavailable';
}

interface Store {
  state: MissionState;
  plan: PlanResult;
  dispatch: (a: Action) => { ok: boolean; merge?: MergeReport };
  device: DeviceInfo;
  setDevice: (d: DeviceInfo) => void;
  storage: StorageMode;
  tab: Tab;
  setTab: (t: Tab) => void;
  mode: MapMode;
  setMode: (m: MapMode) => void;
  picked: LatLng | null;
  setPicked: (p: LatLng | null) => void;
  layers: Record<Layer, boolean>;
  toggleLayer: (l: Layer) => void;
  toasts: Toast[];
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
  focus: { latlng: LatLng; zoom?: number; key: number } | null;
  focusOn: (latlng: LatLng, zoom?: number) => void;
  compare: { route: RouteEvaluation | null; match: MatchResult } | null;
  setCompare: (c: { route: RouteEvaluation | null; match: MatchResult } | null) => void;
  previewRoute: string | null;
  setPreviewRoute: (id: string | null) => void;
  mapStatus: MapStatus;
  setMapStatus: (m: Partial<MapStatus>) => void;
  online: boolean;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('Store not ready');
  return s;
}

/** Ticks every `ms`; used for the countdown and to keep time-dependent plans fresh. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const DEFAULT_LAYERS: Record<Layer, boolean> = {
  route: true, alternatives: true, threats: true, water: true, food: true, medical: true, safehouse: true, cache: true, paths: true, zones: true,
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MissionState | null>(null);
  const [device, setDeviceState] = useState<DeviceInfo>({ id: '....', name: 'Aarav' });
  const [storage, setStorage] = useState<StorageMode>('indexeddb');
  const [tab, setTab] = useState<Tab>('home');
  const [mode, setMode] = useState<MapMode>({ kind: 'idle' });
  const [picked, setPicked] = useState<LatLng | null>(null);
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [focus, setFocus] = useState<Store['focus']>(null);
  const [compare, setCompare] = useState<Store['compare']>(null);
  const [previewRoute, setPreviewRoute] = useState<string | null>(null);
  const [mapStatus, setMapStatusState] = useState<MapStatus>({ offline: 'loading', online: 'off' });
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const planTick = useNow(30000);
  const stateRef = useRef<MissionState | null>(null);
  stateRef.current = state;
  const toastId = useRef(1);

  // load persisted state (or start the scenario)
  useEffect(() => {
    let alive = true;
    (async () => {
      const [saved, dev] = await Promise.all([loadMission().catch(() => null), loadDevice().catch(() => ({ id: 'TEMP', name: 'Aarav' }))]);
      if (!alive) return;
      setDeviceState(dev);
      const s = saved ?? createInitialState(Date.now());
      setState(s);
      if (!saved) setStorage(await saveMission(s));
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = toastId.current++;
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 4500);
  }, []);

  const persist = useCallback(async (s: MissionState) => {
    setStorage(await saveMission(s));
  }, []);

  const dispatch = useCallback(
    (a: Action) => {
      const cur = stateRef.current;
      if (!cur) return { ok: false };
      const out = runAction(cur, a, { realNow: Date.now(), device: device.id, deviceName: device.name });
      if (out.toast) toast(out.toast.kind, out.toast.text);
      if (out.state !== cur) {
        stateRef.current = out.state;
        setState(out.state);
        void persist(out.state);
        if (a.type !== 'advance') setCompare(null);
      }
      return { ok: out.state !== cur, merge: out.merge };
    },
    [device, persist, toast],
  );

  const plan = useMemo(() => (state ? runPlan(state, Date.now()) : null), [state, planTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // stages can also complete or fail with time (deadline); keep them in sync
  useEffect(() => {
    if (!state || !plan) return;
    const next = refreshStages(state, Date.now(), plan);
    if (next !== state) {
      setState(next);
      void persist(next);
    }
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDevice = useCallback((d: DeviceInfo) => {
    setDeviceState(d);
    void saveDevice(d);
  }, []);

  const value = useMemo<Store | null>(() => {
    if (!state || !plan) return null;
    return {
      state, plan, dispatch, device, setDevice, storage, tab, setTab, mode, setMode, picked, setPicked, layers,
      toggleLayer: (l) => setLayers((x) => ({ ...x, [l]: !x[l] })),
      toasts, toast, dismissToast: (id) => setToasts((t) => t.filter((x) => x.id !== id)),
      focus, focusOn: (latlng, zoom) => setFocus({ latlng, zoom, key: Date.now() }),
      compare, setCompare, previewRoute, setPreviewRoute, mapStatus,
      setMapStatus: (m) => setMapStatusState((x) => ({ ...x, ...m })),
      online,
    };
  }, [state, plan, dispatch, device, setDevice, storage, tab, mode, picked, layers, toasts, toast, focus, compare, previewRoute, mapStatus, online]);

  if (!value) {
    return (
      <div className="boot">
        <span>Loading local mission data</span>
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
