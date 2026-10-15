import { useState } from 'react';
import { useStore, type Layer } from '../app/store';
import { CATEGORY_ORDER, SEVERITY_LABEL, THREAT_CATALOG } from '../threats/catalog';
import { compareDrawn } from '../routing/compare';
import { AMENITY_COLOR, ALT, BLOCKED, COMPARE, DISCOVERED, PREV, ROUTE, SEV_COLOR } from '../styles/tokens';
import { Icon } from './Icon';
import type { LatLng, Severity, ThreatCategory } from '../types';
import { BASE } from '../routing/graph';
import { inBBox } from '../utils/geo';

export function SimulateMenu({ onClose }: { onClose: () => void }) {
  const { setMode, dispatch, state } = useStore();
  const [cat, setCat] = useState<ThreatCategory>('horde');
  const [sev, setSev] = useState<Severity>(THREAT_CATALOG.horde.defaultSeverity);
  const spec = THREAT_CATALOG[cat];
  return (
    <div className="popover sim-menu" role="dialog" aria-label="Simulate threat">
      <div className="popover-head">
        <strong>Simulate a threat</strong>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="cat-list" role="radiogroup" aria-label="Threat type">
        {CATEGORY_ORDER.map((c) => {
          const s = THREAT_CATALOG[c];
          return (
            <button
              key={c}
              role="radio"
              aria-checked={cat === c}
              className={`cat-row${cat === c ? ' on' : ''}`}
              onClick={() => {
                setCat(c);
                setSev(s.defaultSeverity);
              }}
            >
              <span className="sev-dot" style={{ background: s.kind === 'cache' ? AMENITY_COLOR.cache : SEV_COLOR[s.defaultSeverity] }} />
              <span>{s.label}</span>
              <span className="muted">{s.kind === 'cache' ? 'adds supplies' : `L${s.defaultSeverity}`}</span>
            </button>
          );
        })}
      </div>
      {spec.kind !== 'cache' && (
        <div className="field">
          <span className="label">Severity</span>
          <div className="seg">
            {([0, 1, 2, 3] as Severity[]).filter((x) => x >= 1 && x <= spec.maxSeverity).map((x) => (
              <button key={x} className={`seg-btn${sev === x ? ' on' : ''}`} style={{ ['--c' as string]: SEV_COLOR[x] }} onClick={() => setSev(x)}>
                {x} {SEVERITY_LABEL[x]}
              </button>
            ))}
          </div>
          <span className="hint">
            {sev === 3 && spec.impassableDefault ? 'Level 3 blocks the affected road segment.' : sev === 3 ? 'Level 3, passable: very high risk penalty.' : sev === 2 ? 'Substantial risk penalty; alternatives preferred.' : 'Mild cost increase; road stays open.'}
          </span>
        </div>
      )}
      <button
        className="btn primary wide"
        onClick={() => {
          setMode({ kind: 'simulate', category: cat, severity: spec.kind === 'cache' ? 0 : sev });
          onClose();
        }}
      >
        <Icon name="target" /> Arm and place on map
      </button>
      <div className="row gap">
        <button className="btn ghost" disabled={!state.simulatedIds.length} onClick={() => dispatch({ type: 'undoSim' })}>
          <Icon name="undo" /> Undo last
        </button>
        <button className="btn ghost" disabled={!state.simulatedIds.length} onClick={() => dispatch({ type: 'clearSim' })}>
          Clear simulated ({state.simulatedIds.length})
        </button>
      </div>
    </div>
  );
}

export function ModeBanner() {
  const { mode, setMode, state, setCompare, toast, setTab } = useStore();
  if (mode.kind === 'idle') return null;
  if (mode.kind === 'simulate') {
    const s = THREAT_CATALOG[mode.category];
    return (
      <div className="mode-banner" role="status">
        <span className="sev-dot" style={{ background: s.kind === 'cache' ? AMENITY_COLOR.cache : SEV_COLOR[mode.severity] }} />
        <span>
          <strong>{s.label}{s.kind !== 'cache' ? `, level ${mode.severity}` : ''} armed.</strong> Double-click a location or road on the map to place the simulated event.
        </span>
        <button className="btn small" onClick={() => setMode({ kind: 'idle' })}>
          Cancel
        </button>
      </div>
    );
  }
  if (mode.kind === 'compare') {
    const finish = () => {
      if (mode.points.length < 2) {
        toast('error', 'Click at least two points along streets.');
        return;
      }
      const r = compareDrawn(state, Date.now(), mode.points);
      setCompare(r);
      setMode({ kind: 'idle' });
      setTab('home');
      if (!r.route) toast('error', r.match.notes[0] ?? 'The drawing does not map to a traversable route. Adjust it and try again.');
    };
    return (
      <div className="mode-banner" role="status">
        <Icon name="pen" />
        <span>
          <strong>Draw your route.</strong> Click points along streets from the group toward the settlement ({mode.points.length} points).
        </span>
        <button className="btn small" disabled={!mode.points.length} onClick={() => setMode({ kind: 'compare', points: mode.points.slice(0, -1) })}>
          Undo point
        </button>
        <button className="btn small primary" onClick={finish}>
          Compare
        </button>
        <button className="btn small" onClick={() => setMode({ kind: 'idle' })}>
          Cancel
        </button>
      </div>
    );
  }
  if (mode.kind === 'path') {
    return (
      <div className="mode-banner" role="status">
        <Icon name="path" />
        <span>
          <strong>Mark a discovered path.</strong> Click its two ends on the map ({mode.points.length}/2). Then save it in the Threats tab.
        </span>
        <button className="btn small" onClick={() => setMode({ kind: 'idle' })}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="mode-banner" role="status">
      <Icon name="target" />
      <span>
        <strong>Pick a location.</strong> Click the map where the {mode.purpose === 'threat' ? 'hazard' : 'amenity'} is.
      </span>
      <button className="btn small" onClick={() => setMode({ kind: 'idle' })}>
        Cancel
      </button>
    </div>
  );
}

const LEGEND: Array<{ layer: Layer | null; label: string; swatch: JSX.Element }> = [
  { layer: 'route', label: 'Recommended route', swatch: <i className="sw-line" style={{ background: ROUTE }} /> },
  { layer: 'alternatives', label: 'Alternatives', swatch: <i className="sw-line dashed" style={{ color: ALT }} /> },
  { layer: null, label: 'Previous route', swatch: <i className="sw-line dotted" style={{ color: PREV }} /> },
  { layer: null, label: 'Your compared route', swatch: <i className="sw-line dashed" style={{ color: COMPARE }} /> },
  { layer: 'threats', label: 'Threats L1, L2, L3', swatch: <i className="sw-sev"><b style={{ background: SEV_COLOR[1] }} /><b style={{ background: SEV_COLOR[2] }} /><b style={{ background: SEV_COLOR[3] }} /></i> },
  { layer: null, label: 'Blocked road', swatch: <i className="sw-line dashed thick" style={{ color: BLOCKED }} /> },
  { layer: 'water', label: 'Water', swatch: <i className="sw-dot" style={{ borderColor: AMENITY_COLOR.water }} /> },
  { layer: 'food', label: 'Food', swatch: <i className="sw-dot" style={{ borderColor: AMENITY_COLOR.food }} /> },
  { layer: 'medical', label: 'Medical', swatch: <i className="sw-dot" style={{ borderColor: AMENITY_COLOR.medical }} /> },
  { layer: 'safehouse', label: 'Safehouse', swatch: <i className="sw-dot" style={{ borderColor: AMENITY_COLOR.safehouse }} /> },
  { layer: 'cache', label: 'Discovered cache', swatch: <i className="sw-dot" style={{ borderColor: AMENITY_COLOR.cache }} /> },
  { layer: 'paths', label: 'Discovered path', swatch: <i className="sw-line dashed" style={{ color: DISCOVERED }} /> },
  { layer: 'zones', label: 'Transit line, corridor', swatch: <i className="sw-line dotted" style={{ color: '#9fb0c2' }} /> },
  { layer: null, label: 'Group (simulated)', swatch: <i className="sw-group" /> },
  { layer: null, label: 'Settlement beacon', swatch: <i className="sw-beacon" /> },
];

export function Legend() {
  const { layers, toggleLayer } = useStore();
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth > 900);
  return (
    <div className={`legend${open ? ' open' : ''}`}>
      <button className="legend-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="layers" /> Legend
      </button>
      {open && (
        <ul>
          {LEGEND.map((l) => (
            <li key={l.label}>
              {l.layer ? (
                <button className={`legend-row${layers[l.layer] ? '' : ' off'}`} onClick={() => toggleLayer(l.layer!)} aria-pressed={layers[l.layer]}>
                  {l.swatch}
                  <span>{l.label}</span>
                </button>
              ) : (
                <span className="legend-row static">
                  {l.swatch}
                  <span>{l.label}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MapStatusChip({ onlineTiles, setOnlineTiles }: { onlineTiles: boolean; setOnlineTiles: (v: boolean) => void }) {
  const { mapStatus } = useStore();
  const off = mapStatus.offline;
  return (
    <div className="map-status">
      <span className={`dot ${off === 'available' ? 'ok' : off === 'loading' ? 'wait' : 'bad'}`} />
      <span>
        {off === 'available' ? 'Offline map available' : off === 'loading' ? 'Loading map data' : 'Map data unavailable'}
        <small>Monaco extract only (OSM, 2016)</small>
      </span>
      <label className="tiles-toggle">
        <input type="checkbox" checked={onlineTiles} onChange={(e) => setOnlineTiles(e.target.checked)} />
        <span>
          Online tiles
          <small>{!onlineTiles ? 'off' : mapStatus.online === 'available' ? 'available' : mapStatus.online === 'loading' ? 'loading' : 'unavailable'}</small>
        </span>
      </label>
    </div>
  );
}

export function useGps() {
  const { toast, focusOn } = useStore();
  const [gps, setGps] = useState<LatLng | null>(null);
  const locate = () => {
    if (!('geolocation' in navigator)) {
      toast('error', 'GPS is not available on this device. Pick locations on the map instead.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const ll: LatLng = [p.coords.latitude, p.coords.longitude];
        if (!inBBox(ll, BASE.meta.bbox)) {
          setGps(null);
          toast('info', `GPS fix ${ll[0].toFixed(4)}, ${ll[1].toFixed(4)} (±${Math.round(p.coords.accuracy)} m) is outside the Monaco demo area, so it is not shown.`);
          return;
        }
        setGps(ll);
        focusOn(ll, 17);
        toast('info', `GPS position shown (±${Math.round(p.coords.accuracy)} m). This is real device data.`);
      },
      (e) => toast('error', e.code === 1 ? 'Location permission denied. Pick locations on the map instead.' : 'Could not get a GPS fix. Pick locations on the map instead.'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };
  return { gps, locate };
}
