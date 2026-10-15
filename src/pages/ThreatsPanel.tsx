import { useState } from 'react';
import { useStore, useNow } from '../app/store';
import { CATEGORY_ORDER, SEVERITY_LABEL, THREAT_CATALOG } from '../threats/catalog';
import { threatStatus } from '../threats/effects';
import { missionNow } from '../routing/planner';
import { SEV_COLOR, AMENITY_COLOR } from '../styles/tokens';
import { fmtAgo, fmtClock } from '../utils/format';
import { Icon } from '../components/Icon';
import { BASE } from '../routing/graph';
import { inBBox } from '../utils/geo';
import type { AmenityType, LatLng, Severity, ThreatCategory, ThreatReport } from '../types';

const SOURCE_LABEL: Record<ThreatReport['source'], string> = { simulated: 'SIMULATED', user: 'User report', sync: 'Via QR sync', scenario: 'Pre-mission intel' };

function SevPicker({ value, max, onChange }: { value: Severity; max: Severity; onChange: (s: Severity) => void }) {
  return (
    <div className="seg">
      {([0, 1, 2, 3] as Severity[]).filter((x) => x <= max).map((x) => (
        <button key={x} type="button" className={`seg-btn${value === x ? ' on' : ''}`} style={{ ['--c' as string]: SEV_COLOR[x] }} onClick={() => onChange(x)}>
          {x} {SEVERITY_LABEL[x]}
        </button>
      ))}
    </div>
  );
}

function ThreatItem({ t }: { t: ThreatReport }) {
  const { state, plan, dispatch, focusOn, setTab } = useStore();
  const realNow = useNow(30000);
  const now = missionNow(state, realNow);
  const [edit, setEdit] = useState(false);
  const [hist, setHist] = useState(false);
  const [sev, setSev] = useState<Severity>(t.severity);
  const [conf, setConf] = useState(Math.round(t.confidence * 100));
  const [imp, setImp] = useState(t.impassable);
  const [note, setNote] = useState('');
  const spec = THREAT_CATALOG[t.category];
  const st = threatStatus(t, now, state.config.staleAfterMin);
  const onRoute = plan.recommended?.hazardIds.includes(t.id);
  return (
    <li className={`threat-item ${st}`}>
      <div className="threat-top">
        <span className="sev-badge" style={{ background: spec.kind === 'cache' ? AMENITY_COLOR.cache : SEV_COLOR[t.severity] }}>
          {spec.kind === 'cache' ? '+' : t.severity}
        </span>
        <div className="threat-main">
          <strong>{spec.label}</strong>
          <span className="muted">
            {t.place}
            {t.target.kind === 'edge' ? ' (road segment)' : ' (location)'}
          </span>
        </div>
        <span className={`src ${t.source}`}>{SOURCE_LABEL[t.source]}</span>
      </div>
      <div className="threat-meta">
        <span>{spec.kind === 'cache' ? 'Supply cache' : `Level ${t.severity}, ${SEVERITY_LABEL[t.severity].toLowerCase()}${t.severity === 3 ? (t.impassable ? ', impassable' : ', passable') : ''}`}</span>
        <span>{Math.round(t.confidence * 100)}% confidence</span>
        <span>{fmtClock(t.updatedAt)} ({fmtAgo(now - t.updatedAt)})</span>
        <span className={`state ${st}`}>{st}</span>
        {onRoute && <span className="state onroute">on route</span>}
      </div>
      <p className="muted small">
        {t.description} Reporter: {t.reporter}.
      </p>
      <div className="row gap wrap">
        <button
          className="btn small ghost"
          onClick={() => {
            focusOn([t.lat, t.lng], 18);
            setTab('home');
          }}
        >
          <Icon name="eye" /> View on map
        </button>
        <button className="btn small ghost" onClick={() => setEdit(!edit)}>
          Revise
        </button>
        <button className="btn small ghost" onClick={() => dispatch({ type: 'reviseThreat', id: t.id, patch: { status: t.status === 'active' ? 'resolved' : 'active' }, note: '' })}>
          {t.status === 'active' ? 'Resolve' : 'Reopen'}
        </button>
        <button className="btn small ghost" onClick={() => setHist(!hist)}>
          History ({t.history.length})
        </button>
      </div>
      {edit && (
        <div className="revise">
          {spec.kind === 'threat' || spec.kind === 'safehouse' ? <SevPicker value={sev} max={spec.maxSeverity} onChange={setSev} /> : null}
          <label className="field">
            <span className="label">Confidence {conf}%</span>
            <input type="range" min={5} max={100} value={conf} onChange={(e) => setConf(Number(e.target.value))} />
          </label>
          {sev === 3 && (
            <label className="toggle">
              <input type="checkbox" checked={imp} onChange={(e) => setImp(e.target.checked)} />
              <span>Impassable (blocks the road)</span>
            </label>
          )}
          <input className="input" placeholder="What changed? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn small primary"
            onClick={() => {
              dispatch({ type: 'reviseThreat', id: t.id, patch: { severity: sev, confidence: conf / 100, impassable: sev === 3 ? imp : false }, note });
              setEdit(false);
            }}
          >
            Save revision
          </button>
        </div>
      )}
      {hist && (
        <ul className="log">
          {t.history.map((h, i) => (
            <li key={i}>
              <time>{fmtClock(h.at)}</time> {h.note}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function useLocationPicker(purpose: 'threat' | 'amenity') {
  const { setMode, picked, setPicked, toast } = useStore();
  const [owner, setOwner] = useState(false);
  const pick = () => {
    setPicked(null);
    setOwner(true);
    setMode({ kind: 'pick', purpose });
  };
  const gps = () => {
    if (!('geolocation' in navigator)) return toast('error', 'GPS unavailable. Pick the location on the map.');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const ll: LatLng = [p.coords.latitude, p.coords.longitude];
        if (!inBBox(ll, BASE.meta.bbox)) return toast('error', 'Your GPS position is outside the Monaco demo area. Pick the location on the map.');
        setPicked(ll);
        setOwner(true);
        toast('info', `Using GPS (±${Math.round(p.coords.accuracy)} m).`);
      },
      (e) => toast('error', e.code === 1 ? 'Location permission denied. Pick the location on the map.' : 'No GPS fix. Pick the location on the map.'),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };
  return { loc: owner ? picked : null, pick, gps, clear: () => (setPicked(null), setOwner(false)) };
}

function AddThreat({ onDone }: { onDone: () => void }) {
  const { dispatch, device } = useStore();
  const [cat, setCat] = useState<ThreatCategory>('movement');
  const [sev, setSev] = useState<Severity>(THREAT_CATALOG.movement.defaultSeverity);
  const [conf, setConf] = useState(70);
  const [desc, setDesc] = useState('');
  const [reporter, setReporter] = useState(device.name);
  const { loc, pick, gps, clear } = useLocationPicker('threat');
  const spec = THREAT_CATALOG[cat];
  return (
    <section className="card form">
      <div className="card-head">
        <h2>Add threat report</h2>
        <button className="icon-btn" onClick={onDone} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <label className="field">
        <span className="label">Category</span>
        <select
          className="input"
          value={cat}
          onChange={(e) => {
            const c = e.target.value as ThreatCategory;
            setCat(c);
            setSev(THREAT_CATALOG[c].defaultSeverity);
          }}
        >
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {THREAT_CATALOG[c].label}
            </option>
          ))}
        </select>
      </label>
      {spec.kind !== 'cache' && (
        <div className="field">
          <span className="label">Severity</span>
          <SevPicker value={sev} max={spec.maxSeverity} onChange={setSev} />
        </div>
      )}
      <label className="field">
        <span className="label">Confidence {conf}%</span>
        <input type="range" min={5} max={100} value={conf} onChange={(e) => setConf(Number(e.target.value))} />
      </label>
      <label className="field">
        <span className="label">Description</span>
        <input className="input" maxLength={140} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What did you see?" />
      </label>
      <label className="field">
        <span className="label">Source (who reports it)</span>
        <input className="input" maxLength={40} value={reporter} onChange={(e) => setReporter(e.target.value)} />
      </label>
      <div className="field">
        <span className="label">Location</span>
        <div className="row gap wrap">
          <button className="btn small" onClick={pick}>
            <Icon name="target" /> Pick on map
          </button>
          <button className="btn small" onClick={gps}>
            <Icon name="gps" /> Use GPS
          </button>
          <span className="muted small">{loc ? `${loc[0].toFixed(5)}, ${loc[1].toFixed(5)}` : 'Not set'}</span>
        </div>
      </div>
      <button
        className="btn primary"
        disabled={!loc}
        onClick={() => {
          if (!loc) return;
          const r = dispatch({ type: 'addThreat', input: { category: cat, severity: spec.kind === 'cache' ? 0 : sev, confidence: conf / 100, description: desc, latlng: loc, reporter: reporter || device.name } });
          if (r.ok) {
            clear();
            onDone();
          }
        }}
      >
        Save report locally
      </button>
    </section>
  );
}

function AddAmenity({ onDone }: { onDone: () => void }) {
  const { dispatch } = useStore();
  const [type, setType] = useState<AmenityType>('water');
  const [name, setName] = useState('');
  const [w, setW] = useState('2');
  const [f, setF] = useState('0');
  const [m, setM] = useState('0');
  const { loc, pick, gps, clear } = useLocationPicker('amenity');
  return (
    <section className="card form">
      <div className="card-head">
        <h2>Mark an amenity</h2>
        <button className="icon-btn" onClick={onDone} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="row gap wrap">
        <label className="field">
          <span className="label">Type</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as AmenityType)}>
            <option value="water">Water</option>
            <option value="food">Food</option>
            <option value="medical">Medical</option>
            <option value="safehouse">Safehouse</option>
            <option value="cache">Supply cache</option>
          </select>
        </label>
        <label className="field grow">
          <span className="label">Name</span>
          <input className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rooftop tank" />
        </label>
      </div>
      <div className="grid3">
        <label className="field">
          <span className="label">Water L</span>
          <input className="input" inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Meals</span>
          <input className="input" inputMode="decimal" value={f} onChange={(e) => setF(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Medkits</span>
          <input className="input" inputMode="numeric" value={m} onChange={(e) => setM(e.target.value)} />
        </label>
      </div>
      <div className="row gap wrap">
        <button className="btn small" onClick={pick}>
          <Icon name="target" /> Pick on map
        </button>
        <button className="btn small" onClick={gps}>
          <Icon name="gps" /> Use GPS
        </button>
        <span className="muted small">{loc ? `${loc[0].toFixed(5)}, ${loc[1].toFixed(5)}` : 'Not set'}</span>
      </div>
      <button
        className="btn primary"
        disabled={!loc}
        onClick={() => {
          if (!loc) return;
          const r = dispatch({ type: 'addAmenity', amenityType: type, name, supplies: { water: Number(w) || 0, food: Number(f) || 0, medkits: Number(m) || 0 }, latlng: loc, notes: 'Marked in the field' });
          if (r.ok) {
            clear();
            onDone();
          }
        }}
      >
        Save amenity
      </button>
    </section>
  );
}

function AddPath({ onDone }: { onDone: () => void }) {
  const { mode, setMode, dispatch } = useStore();
  const [terrain, setTerrain] = useState<'flat' | 'stairs' | 'rough'>('flat');
  const [note, setNote] = useState('');
  const pts = mode.kind === 'path' ? mode.points : [];
  const [saved, setSaved] = useState<LatLng[]>([]);
  const ends = pts.length === 2 ? pts : saved;
  return (
    <section className="card form">
      <div className="card-head">
        <h2>Mark a discovered path</h2>
        <button className="icon-btn" onClick={onDone} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <p className="hint">A courtyard, stairway or gap the group found. It becomes routable only after its endpoints and length pass validation, and stays marked unverified until walked.</p>
      <div className="row gap wrap">
        <button
          className="btn small"
          onClick={() => {
            setSaved([]);
            setMode({ kind: 'path', points: [] });
          }}
        >
          <Icon name="path" /> Click both ends on the map
        </button>
        <span className="muted small">{ends.length === 2 ? 'Both ends set' : `${pts.length}/2 ends set`}</span>
      </div>
      <div className="row gap wrap">
        <label className="field">
          <span className="label">Terrain</span>
          <select className="input" value={terrain} onChange={(e) => setTerrain(e.target.value as typeof terrain)}>
            <option value="flat">Flat</option>
            <option value="stairs">Stairs</option>
            <option value="rough">Rough</option>
          </select>
        </label>
        <label className="field grow">
          <span className="label">Name</span>
          <input className="input" maxLength={48} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Courtyard cut-through" />
        </label>
      </div>
      <button
        className="btn primary"
        disabled={ends.length !== 2}
        onClick={() => {
          const r = dispatch({ type: 'addPath', from: ends[0], to: ends[1], terrain, note });
          if (r.ok) {
            setSaved([]);
            setMode({ kind: 'idle' });
            onDone();
          } else if (pts.length === 2) setSaved(pts);
        }}
      >
        Validate and save path
      </button>
    </section>
  );
}

function Discoveries() {
  const { state, dispatch } = useStore();
  const found = state.amenities.filter((a) => a.origin !== 'scenario');
  if (!found.length && !state.paths.length) return null;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Field discoveries</h2>
      </div>
      <ul className="plain">
        {state.paths.map((p) => (
          <li key={p.id} className="disc-row">
            <Icon name="path" />
            <span>
              <strong>{p.note}</strong>
              <span className="muted small">
                {' '}
                {Math.round(p.len)} m, {p.terrain}, {p.origin === 'sync' ? 'via sync, ' : ''}
                {p.validation === 'valid' ? (p.verified ? 'verified' : 'new, unverified') : `not routable: ${p.validationNote}`}
              </span>
            </span>
            {p.validation === 'valid' && !p.verified && (
              <button className="btn small ghost" onClick={() => dispatch({ type: 'verifyPath', id: p.id })}>
                Mark walked
              </button>
            )}
          </li>
        ))}
        {found.map((a) => (
          <li key={a.id} className="disc-row">
            <span className="sw-dot" style={{ borderColor: AMENITY_COLOR[a.type] }} />
            <span>
              <strong>{a.name}</strong>
              <span className="muted small">
                {' '}
                {a.type}, {a.origin}
                {a.compromised ? ', compromised' : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ThreatsPanel() {
  const { state } = useStore();
  const [sevF, setSevF] = useState<number | 'all'>('all');
  const [catF, setCatF] = useState<ThreatCategory | 'all'>('all');
  const [showResolved, setShowResolved] = useState(true);
  const [form, setForm] = useState<'threat' | 'amenity' | 'path' | null>(null);
  const list = state.threats
    .filter((t) => (sevF === 'all' ? true : t.severity === sevF))
    .filter((t) => (catF === 'all' ? true : t.category === catF))
    .filter((t) => showResolved || t.status === 'active')
    .slice()
    .sort((a, b) => (a.status === b.status ? b.severity - a.severity || b.updatedAt - a.updatedAt : a.status === 'active' ? -1 : 1));
  return (
    <>
      <div className="row gap wrap actions-row">
        <button className="btn primary" onClick={() => setForm('threat')}>
          <Icon name="alert" /> Add threat
        </button>
        <button className="btn" onClick={() => setForm('amenity')}>
          <Icon name="water" /> Mark amenity
        </button>
        <button className="btn" onClick={() => setForm('path')}>
          <Icon name="path" /> Discovered path
        </button>
      </div>
      {form === 'threat' && <AddThreat onDone={() => setForm(null)} />}
      {form === 'amenity' && <AddAmenity onDone={() => setForm(null)} />}
      {form === 'path' && <AddPath onDone={() => setForm(null)} />}
      <section className="card">
        <div className="card-head">
          <h2>Threat reports</h2>
          <span className="hint">{state.threats.filter((t) => t.status === 'active').length} active</span>
        </div>
        <div className="filters">
          <select className="input" value={String(sevF)} onChange={(e) => setSevF(e.target.value === 'all' ? 'all' : Number(e.target.value))} aria-label="Filter by severity">
            <option value="all">All severities</option>
            {[3, 2, 1, 0].map((s) => (
              <option key={s} value={s}>
                Level {s} {SEVERITY_LABEL[s as Severity]}
              </option>
            ))}
          </select>
          <select className="input" value={catF} onChange={(e) => setCatF(e.target.value as ThreatCategory | 'all')} aria-label="Filter by category">
            <option value="all">All categories</option>
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {THREAT_CATALOG[c].label}
              </option>
            ))}
          </select>
          <label className="toggle">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            <span>Resolved</span>
          </label>
        </div>
        {list.length ? (
          <ul className="threat-list">
            {list.map((t) => (
              <ThreatItem key={t.id} t={t} />
            ))}
          </ul>
        ) : (
          <p className="hint">No reports match. Add one, or simulate a threat from the map.</p>
        )}
      </section>
      <Discoveries />
    </>
  );
}
