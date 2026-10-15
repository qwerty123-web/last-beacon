/**
 * Local persistence. Primary: IndexedDB (database "last-beacon", store "kv").
 * If IndexedDB is unavailable or fails (private mode, quota, blocked), falls back to localStorage,
 * and if that fails too, the app keeps working in memory and reports "not saved".
 * Persistence is separate from route scoring: this module only stores and restores JSON.
 */
import type { MissionState } from '../types';

const DB = 'last-beacon';
const STORE = 'kv';
const LS_PREFIX = 'last-beacon:';

export type StorageMode = 'indexeddb' | 'localstorage' | 'memory';

let dbPromise: Promise<IDBDatabase> | null = null;
let mode: StorageMode = 'indexeddb';

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    } catch (e) {
      reject(e);
    }
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function lsGet<T>(key: string): T | undefined {
  try {
    const v = localStorage.getItem(LS_PREFIX + key);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}

function lsSet(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result as T | undefined);
      r.onerror = () => reject(r.error);
    });
  } catch {
    mode = 'localstorage';
    return lsGet<T>(key);
  }
}

export async function kvSet(key: string, value: unknown): Promise<StorageMode> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    mode = 'indexeddb';
  } catch {
    mode = lsSet(key, value) ? 'localstorage' : 'memory';
  }
  return mode;
}

export async function kvDelete(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try {
      localStorage.removeItem(LS_PREFIX + key);
    } catch {
      /* ignore */
    }
  }
}

export function storageMode(): StorageMode {
  return mode;
}

/* ------------------------------------------------------------------ typed helpers */

export const MISSION_KEY = 'mission';
export const DEVICE_KEY = 'device';

export interface DeviceInfo {
  id: string;
  name: string;
}

/** Basic shape check so a corrupted or old record never crashes the app. */
export function isMissionState(x: unknown): x is MissionState {
  const s = x as MissionState;
  return !!s && s.schema === 1 && typeof s.deadline === 'number' && Array.isArray(s.survivors) && s.survivors.length === 2 && Array.isArray(s.threats) && typeof s.position === 'string' && Array.isArray(s.walkedEdges);
}

export async function loadMission(): Promise<MissionState | null> {
  const v = await kvGet<unknown>(MISSION_KEY);
  return isMissionState(v) ? v : null;
}

export function saveMission(s: MissionState): Promise<StorageMode> {
  return kvSet(MISSION_KEY, s);
}

export async function loadDevice(): Promise<DeviceInfo> {
  const d = await kvGet<DeviceInfo>(DEVICE_KEY);
  if (d && typeof d.id === 'string' && /^[A-Z0-9]{4}$/.test(d.id)) return d;
  const id = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
  const dev = { id, name: 'Aarav' };
  await kvSet(DEVICE_KEY, dev);
  return dev;
}

export function saveDevice(d: DeviceInfo): Promise<StorageMode> {
  return kvSet(DEVICE_KEY, d);
}
