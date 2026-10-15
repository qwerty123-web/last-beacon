import { useState } from 'react';
import { useStore, useNow } from '../app/store';
import { combined, enduranceHours, groupReserve } from '../resources/consumption';
import { describeModifiers } from '../survivors/rules';
import { missionNow } from '../routing/planner';
import { fmtL } from '../utils/format';
import { Icon } from '../components/Icon';
import type { Inventory, MissionConfig, SurvivorState } from '../types';

type Who = SurvivorState['id'] | 'shared';
const UNITS: Record<keyof Inventory, string> = { water: 'L', food: 'meals', medkits: 'kits' };
const STEP: Record<keyof Inventory, number> = { water: 0.1, food: 0.25, medkits: 1 };

function InvRow({ who, res, value }: { who: Who; res: keyof Inventory; value: number }) {
  const { dispatch } = useStore();
  const [draft, setDraft] = useState<string | null>(null);
  const st = STEP[res];
  return (
    <div className="inv-row">
      <span className="inv-k">
        <Icon name={res === 'medkits' ? 'medical' : res} size={14} /> {res}
      </span>
      <button className="icon-btn" aria-label={`Use ${st} ${res}`} disabled={value < st - 1e-9} onClick={() => dispatch({ type: 'consume', who, resource: res, amount: st })}>
        −
      </button>
      <input
        className="input num"
        inputMode="decimal"
        aria-label={`${who} ${res}`}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) dispatch({ type: 'setInventory', who, resource: res, value: Number(draft) });
          setDraft(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <button className="icon-btn" aria-label={`Add ${st} ${res}`} onClick={() => dispatch({ type: 'setInventory', who, resource: res, value: Math.round((value + st) * 100) / 100 })}>
        +
      </button>
      <span className="inv-u">{UNITS[res]}</span>
    </div>
  );
}

function Slider({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState<number | null>(null);
  const shown = v ?? value;
  return (
    <label className="slider">
      <span className="slider-k">{label}</span>
      <input type="range" min={0} max={100} value={shown} onChange={(e) => setV(Number(e.target.value))} onPointerUp={() => v !== null && (onCommit(v), setV(null))} onKeyUp={() => v !== null && (onCommit(v), setV(null))} onBlur={() => v !== null && (onCommit(v), setV(null))} />
      <span className={`slider-v ${shown < 30 ? 'crit' : shown < 55 ? 'warn' : ''}`}>{Math.round(shown)}</span>
    </label>
  );
}

function SurvivorCard({ s }: { s: SurvivorState }) {
  const { state, dispatch } = useStore();
  const cfg = state.config.consumption;
  const end = enduranceHours(s, state.shared, state.survivors.length, cfg);
  const lowW = s.inventory.water < cfg.reserveWater;
  const mods = describeModifiers([s]);
  return (
    <section className="card survivor">
      <div className="card-head">
        <h2>{s.name}</h2>
        <label className="toggle">
          <input type="checkbox" checked={s.injured} onChange={(e) => dispatch({ type: 'setSurvivor', id: s.id, patch: { injured: e.target.checked } })} />
          <span>Injured</span>
        </label>
      </div>
      <Slider label="Health" value={s.health} onCommit={(v) => dispatch({ type: 'setSurvivor', id: s.id, patch: { health: v } })} />
      <Slider label="Energy" value={s.energy} onCommit={(v) => dispatch({ type: 'setSurvivor', id: s.id, patch: { energy: v } })} />
      <Slider label="Cognition" value={s.cognition} onCommit={(v) => dispatch({ type: 'setSurvivor', id: s.id, patch: { cognition: v } })} />
      {mods.length > 0 && <p className="hint warn">{mods.join('. ')}.</p>}
      {s.flags.length > 0 && <p className="hint">Status: {s.flags.join(', ')}</p>}
      <h3>Carrying</h3>
      <InvRow who={s.id} res="water" value={s.inventory.water} />
      <InvRow who={s.id} res="food" value={s.inventory.food} />
      <InvRow who={s.id} res="medkits" value={s.inventory.medkits} />
      <dl className="mini">
        <div>
          <dt>Consumption</dt>
          <dd>
            {cfg.waterPerHour} L/h, {cfg.foodPerHour} meals/h
          </dd>
        </div>
        <div>
          <dt>Endurance</dt>
          <dd className={lowW ? 'warn' : ''}>
            water {end.water.toFixed(1)} h, food {end.food.toFixed(1)} h
          </dd>
        </div>
        <div>
          <dt>Reserve</dt>
          <dd>
            {fmtL(cfg.reserveWater)}, {cfg.reserveFood} meals
          </dd>
        </div>
      </dl>
      <p className="hint">Endurance counts personal stock plus an equal share of the pack.</p>
      {s.injured && (
        <button className="btn small" onClick={() => dispatch({ type: 'treat', survivor: s.id })}>
          <Icon name="medical" /> Record treatment (uses 1 medkit)
        </button>
      )}
    </section>
  );
}

function ConfigCard() {
  const { state, dispatch, toast } = useStore();
  const realNow = useNow(30000);
  const [mins, setMins] = useState(String(Math.max(5, Math.round((state.deadline - missionNow(state, realNow)) / 60000))));
  const [cfg, setCfg] = useState<MissionConfig>(state.config);
  const num = (path: string, val: string) => {
    const v = Number(val);
    const next = structuredClone(cfg) as unknown as Record<string, Record<string, number>>;
    const [a, b] = path.split('.');
    next[a][b] = v;
    setCfg(next as unknown as MissionConfig);
  };
  const save = () => {
    const w = cfg.weights;
    const c = cfg.consumption;
    const vals = [w.wT, w.wR, w.wS, w.wU, w.wH, c.waterPerHour, c.foodPerHour, c.energyPerKm, c.reserveWater, c.reserveFood, c.baseSpeedKmh];
    if (vals.some((x) => !Number.isFinite(x) || x < 0 || x > 50) || c.baseSpeedKmh < 1) {
      toast('error', 'Weights and rates must be numbers between 0 and 50 (speed at least 1 km/h).');
      return;
    }
    dispatch({ type: 'setConfig', config: cfg });
  };
  return (
    <section className="card config">
      <div className="card-head">
        <h2>Planning settings</h2>
      </div>
      <div className="row gap">
        <label className="field grow">
          <span className="label">Beacon closes in (minutes)</span>
          <input className="input" inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} />
        </label>
        <button className="btn small" onClick={() => dispatch({ type: 'setDeadline', minutesFromNow: Number(mins) })}>
          Set deadline
        </button>
      </div>
      <h3>Cost weights C(e) = wT·T + wR·R + wS·S + wU·U + wH·H</h3>
      <div className="grid5">
        {(['wT', 'wR', 'wS', 'wU', 'wH'] as const).map((k) => (
          <label key={k} className="field">
            <span className="label">{k}</span>
            <input className="input" inputMode="decimal" value={String(cfg.weights[k])} onChange={(e) => num(`weights.${k}`, e.target.value)} />
          </label>
        ))}
      </div>
      <h3>Rates (fictional, per survivor)</h3>
      <div className="grid3">
        {(
          [
            ['waterPerHour', 'Water L/h'],
            ['foodPerHour', 'Food meals/h'],
            ['energyPerKm', 'Energy per km'],
            ['reserveWater', 'Water reserve L'],
            ['reserveFood', 'Food reserve'],
            ['baseSpeedKmh', 'Walking km/h'],
          ] as const
        ).map(([k, l]) => (
          <label key={k} className="field">
            <span className="label">{l}</span>
            <input className="input" inputMode="decimal" value={String(cfg.consumption[k])} onChange={(e) => num(`consumption.${k}`, e.target.value)} />
          </label>
        ))}
      </div>
      <button className="btn" onClick={save}>
        Apply and recalculate
      </button>
    </section>
  );
}

export function ResourcesPanel() {
  const { state, plan, dispatch } = useStore();
  const c = combined(state);
  const res = groupReserve(state.config.consumption, state.survivors.length);
  const r = plan.recommended;
  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Combined supplies</h2>
          <span className="hint">personal + shared pack, each counted once</span>
        </div>
        <dl className="stats three">
          <div>
            <dt>Water</dt>
            <dd className={c.water < res.water ? 'crit' : ''}>{fmtL(c.water)}</dd>
          </div>
          <div>
            <dt>Food</dt>
            <dd className={c.food < res.food ? 'warn' : ''}>{c.food.toFixed(2)} meals</dd>
          </div>
          <div>
            <dt>Medkits</dt>
            <dd>{c.medkits}</dd>
          </div>
        </dl>
        {r ? (
          <p className={`note ${r.resourcesOk ? (r.belowReserve.length ? 'warn' : '') : 'crit'}`}>
            {r.name} needs {fmtL(r.water)} water and {r.food.toFixed(2)} meals over {Math.round(r.travelMin)} min. Group reserve: {fmtL(res.water)} water, {res.food.toFixed(2)} meals.
            {r.belowReserve.length ? ` ${r.belowReserve[0]}.` : ''}
          </p>
        ) : (
          <p className="note crit">No feasible route. {plan.infeasibleReasons[1] ?? ''}</p>
        )}
        {plan.detourNote && <p className="note">{plan.detourNote}</p>}
      </section>
      {state.survivors.map((s) => (
        <SurvivorCard key={s.id} s={s} />
      ))}
      <section className="card">
        <div className="card-head">
          <h2>Shared pack</h2>
        </div>
        <InvRow who="shared" res="water" value={state.shared.water} />
        <InvRow who="shared" res="food" value={state.shared.food} />
        <InvRow who="shared" res="medkits" value={state.shared.medkits} />
        <p className="hint">Equipment: {state.shared.equipment.join(', ')}</p>
        <p className="hint">Collected supplies go into the shared pack. Survivors draw from their own stock first.</p>
        <button className="btn ghost small" onClick={() => dispatch({ type: 'resetInventory' })}>
          <Icon name="reset" /> Reset inventories for the demo
        </button>
      </section>
      <ConfigCard />
      <p className="disclaimer">Hackathon prototype. Survivor and supply values are fictional simulation parameters; this is not a medically validated survival system.</p>
    </>
  );
}
