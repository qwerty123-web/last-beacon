import { useState } from 'react';
import { useStore, useNow } from '../app/store';
import { deriveWarnings } from '../app/warnings';
import { stageViews, missionOutcome, suppliesSufficient } from '../missions/stages';
import { combined } from '../resources/consumption';
import { uncertaintyLabel } from '../routing/uncertainty';
import { isFeasible, missionNow } from '../routing/planner';
import { SEV_COLOR } from '../styles/tokens';
import { fmtClock, fmtDist, fmtDuration, fmtL, pct } from '../utils/format';
import { Icon } from '../components/Icon';
import type { RouteEvaluation, RouteStatus } from '../types';

export function StatusPill({ status }: { status: RouteStatus }) {
  const cls = status === 'RECOMMENDED' || status === 'FEASIBLE' ? 'ok' : status === 'HIGH RISK' ? 'warn' : 'crit';
  return <span className={`pill ${cls}${status === 'RECOMMENDED' ? ' solid' : ''}`}>{status}</span>;
}

function threatTone(label: RouteEvaluation['threatLabel']) {
  return label === 'Clear' || label === 'Low' ? 'ok' : label === 'Moderate' ? 'warn' : 'crit';
}

function RouteCard() {
  const { state, plan, setPreviewRoute, previewRoute } = useStore();
  const realNow = useNow(15000);
  const r = plan.recommended;
  const c = combined(state);
  if (state.position === 'settlement') {
    return (
      <section className="card route-card">
        <div className="route-head">
          <span className="pill ok solid">ARRIVED</span>
        </div>
        <h2 className="route-name">Larvotto Settlement reached</h2>
      </section>
    );
  }
  if (!r) {
    return (
      <section className="card route-card none" aria-live="polite">
        <div className="route-head">
          <span className="pill crit solid">NO FEASIBLE ROUTE</span>
        </div>
        <h2 className="route-name">The planner cannot recommend a route</h2>
        <ul className="reasons">
          {plan.infeasibleReasons.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
        {plan.detourNote && <p className="note">{plan.detourNote}</p>}
        <Alternatives />
      </section>
    );
  }
  const arrival = missionNow(state, realNow) + r.travelMin * 60000;
  return (
    <section className="card route-card" aria-live="polite">
      <div className="route-head">
        <StatusPill status="RECOMMENDED" />
        {r.maxSeverity >= 2 && <StatusPill status="HIGH RISK" />}
        {r.stops.length > 0 && <span className="pill info">SUPPLY STOP</span>}
        <span className="route-id">Route {r.id.slice(1, 6).toUpperCase()}</span>
      </div>
      <h2 className="route-name">{r.name}</h2>
      {r.streets.length > 0 && <p className="streets">{r.streets.join(', ')}</p>}
      <dl className="stats">
        <div>
          <dt>Travel time</dt>
          <dd>{fmtDuration(r.travelMin)}</dd>
        </div>
        <div>
          <dt>Arrival</dt>
          <dd>{fmtClock(arrival)}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>{fmtDist(r.distanceM)}</dd>
        </div>
        <div>
          <dt>Threat level</dt>
          <dd className={threatTone(r.threatLabel)}>
            {r.threatLabel}
            <small>max L{r.maxSeverity}</small>
          </dd>
        </div>
        <div>
          <dt>Significant hazards</dt>
          <dd>{r.significantHazards}</dd>
        </div>
        <div>
          <dt>Info confidence</dt>
          <dd title="Model-derived from report age, source reliability, exploration and agreement. Not a survival probability.">
            {pct(r.confidence)}
            <small>{uncertaintyLabel(r.uncertainty).toLowerCase()} uncertainty</small>
          </dd>
        </div>
        <div>
          <dt>Water needed</dt>
          <dd>
            {fmtL(r.water)}
            <small>
              of {fmtL(c.water)}
              {r.stops[0]?.gain.water ? ` + ${r.stops[0].gain.water} L at stop` : ''}
            </small>
          </dd>
        </div>
        <div>
          <dt>Food needed</dt>
          <dd>
            {r.food.toFixed(2)}
            <small>
              of {c.food.toFixed(2)}
              {r.stops[0]?.gain.food ? ` + ${r.stops[0].gain.food}` : ''} meals
            </small>
          </dd>
        </div>
        <div>
          <dt>Energy cost</dt>
          <dd>
            {state.survivors.map((s) => `${s.name[0]} ${Math.round(r.energy[s.id] ?? 0)}`).join(' / ')}
          </dd>
        </div>
        <div>
          <dt>Supplies</dt>
          <dd className={r.resourcesOk ? (r.belowReserve.length ? 'warn' : 'ok') : 'crit'}>{r.resourcesOk ? (r.belowReserve.length ? 'Below reserve' : 'Sufficient') : 'Shortage'}</dd>
        </div>
        <div className="span2">
          <dt>Before the deadline</dt>
          <dd className={r.deadlineMarginMin < 15 ? 'warn' : 'ok'}>
            {r.deadlineOk ? `Yes, ${fmtDuration(r.deadlineMarginMin)} to spare` : 'No'}
          </dd>
        </div>
      </dl>
      {r.stops.length > 0 && (
        <p className="note">
          Stop at {r.stops[0].name}: +{[r.stops[0].gain.water ? `${r.stops[0].gain.water} L water` : '', r.stops[0].gain.food ? `${r.stops[0].gain.food} meals` : '', r.stops[0].gain.medkits ? `${r.stops[0].gain.medkits} medkit` : ''].filter(Boolean).join(', ')}
          {r.stops[0].treat ? ', treat injury' : ''}.
        </p>
      )}
      <div className="why">
        <h3>Why this route</h3>
        <ul className="reasons">
          {plan.reason.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
        {plan.detourNote && <p className="note">{plan.detourNote}</p>}
        {r.belowReserve.map((x) => (
          <p key={x} className="note warn">
            {x}.
          </p>
        ))}
      </div>
      <Alternatives />
      {previewRoute && (
        <button className="btn ghost small" onClick={() => setPreviewRoute(null)}>
          Clear highlight
        </button>
      )}
    </section>
  );
}

function Alternatives() {
  const { plan, setPreviewRoute, previewRoute } = useStore();
  const alts = plan.alternatives.filter((a) => a.id !== plan.recommended?.id);
  if (!alts.length) return null;
  return (
    <div className="alts">
      <h3>Alternatives</h3>
      {alts.map((a) => (
        <button key={a.id + a.stops.length} className={`alt-row${previewRoute === a.id ? ' on' : ''}`} onClick={() => setPreviewRoute(previewRoute === a.id ? null : a.id)} title="Highlight on map">
          <span className="alt-name">{a.name}</span>
          <span className="alt-meta">
            {fmtDuration(a.travelMin)}, {fmtDist(a.distanceM)}, L{a.maxSeverity}
          </span>
          <StatusPill status={a.status} />
        </button>
      ))}
    </div>
  );
}

function CompareCard() {
  const { compare, setCompare, plan } = useStore();
  if (!compare) return null;
  const u = compare.route;
  const r = plan.recommended;
  if (!u) {
    return (
      <section className="card compare-card">
        <div className="card-head">
          <h2>Route comparison</h2>
          <button className="icon-btn" onClick={() => setCompare(null)} aria-label="Close comparison">
            <Icon name="x" />
          </button>
        </div>
        <p className="note crit">The drawing does not correspond to a traversable route.</p>
        <ul className="reasons">
          {compare.match.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </section>
    );
  }
  const rows: Array<[string, string, string, 'better' | 'worse' | '']> = [];
  const cmp = (a: number, b: number, lowerBetter = true): 'better' | 'worse' | '' => (Math.abs(a - b) < 1e-6 ? '' : (a < b) === lowerBetter ? 'better' : 'worse');
  if (r) {
    rows.push(['Travel time', fmtDuration(r.travelMin), fmtDuration(u.travelMin), cmp(u.travelMin, r.travelMin)]);
    rows.push(['Distance', fmtDist(r.distanceM), fmtDist(u.distanceM), cmp(u.distanceM, r.distanceM)]);
    rows.push(['Threat exposure', `${r.threatLabel} (L${r.maxSeverity})`, `${u.threatLabel} (L${u.maxSeverity})`, cmp(u.threatScore, r.threatScore)]);
    rows.push(['Water required', fmtL(r.water), fmtL(u.water), cmp(u.water, r.water)]);
    rows.push(['Food required', r.food.toFixed(2), u.food.toFixed(2), cmp(u.food, r.food)]);
    rows.push(['Uncertainty', `${uncertaintyLabel(r.uncertainty)} (${pct(r.uncertainty)})`, `${uncertaintyLabel(u.uncertainty)} (${pct(u.uncertainty)})`, cmp(u.uncertainty, r.uncertainty)]);
    rows.push(['Energy (A / M)', `${Math.round(r.energy.aarav)} / ${Math.round(r.energy.mira)}`, `${Math.round(u.energy.aarav)} / ${Math.round(u.energy.mira)}`, cmp(u.energy.mira + u.energy.aarav, r.energy.mira + r.energy.aarav)]);
    rows.push(['Deadline feasible', r.deadlineOk ? 'Yes' : 'No', u.deadlineOk ? 'Yes' : 'No', u.deadlineOk === r.deadlineOk ? '' : u.deadlineOk ? 'better' : 'worse']);
    rows.push(['Composite cost', r.cost.toFixed(1), u.cost.toFixed(1), cmp(u.cost, r.cost)]);
    rows.push(['Overall', 'Recommended', isFeasible(u) ? (u.status === 'HIGH RISK' ? 'High risk' : 'Feasible') : u.status.toLowerCase(), '']);
  }
  const verdict = !r
    ? 'There is no recommended route to compare against.'
    : u.blockedSegments > 0
      ? 'Your route crosses an impassable segment. The recommended route avoids it.'
      : u.cost <= r.cost + 0.01
        ? 'Your route scores as well as the recommendation on the composite cost.'
        : (() => {
            const w = { T: 'it is slower', R: 'it has more threat exposure', S: 'it uses more supplies', U: 'it relies on less-known roads', H: 'it is more strenuous' } as const;
            const k = (['T', 'R', 'S', 'U', 'H'] as const).reduce((best, x) => (u.terms[x] - r.terms[x] > u.terms[best] - r.terms[best] ? x : best), 'T' as 'T' | 'R' | 'S' | 'U' | 'H');
            return `The recommended route is preferable mainly because yours ${w[k].replace('it ', '')} (cost ${u.cost.toFixed(1)} vs ${r.cost.toFixed(1)}).`;
          })();
  return (
    <section className="card compare-card">
      <div className="card-head">
        <h2>Route comparison</h2>
        <button className="icon-btn" onClick={() => setCompare(null)} aria-label="Close comparison">
          <Icon name="x" />
        </button>
      </div>
      {u.approximate && <p className="note warn">Approximate: {u.notes[0] ?? 'part of the drawing was inferred.'}</p>}
      <table className="cmp">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Recommended</th>
            <th>Your route</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b, d]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{a}</td>
              <td className={d}>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="verdict">{verdict}</p>
      {!u.approximate && u.notes.length > 0 && <p className="hint">{u.notes.join(' ')}</p>}
      <p className="hint">{pct(compare.match.coverage)} of your points are on mapped roads; {Math.round(compare.match.inferredM)} m of connecting road was inferred.</p>
    </section>
  );
}

function ChangeCard() {
  const { state } = useStore();
  const [dismissed, setDismissed] = useState<number | null>(null);
  const c = state.lastChange;
  if (!c || dismissed === c.at + c.lines.length) return null;
  return (
    <section className="card change-card" aria-live="polite">
      <div className="card-head">
        <h2>{c.title}</h2>
        <button className="icon-btn" onClick={() => setDismissed(c.at + c.lines.length)} aria-label="Dismiss">
          <Icon name="x" />
        </button>
      </div>
      <ul>
        {c.lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </section>
  );
}

function MoveControls() {
  const { state, plan, dispatch } = useStore();
  const here = state.amenities.filter((a) => a.node === state.position);
  const hurt = state.survivors.find((s) => s.injured);
  const c = combined(state);
  const at = state.position === 'settlement';
  return (
    <section className="card move">
      <div className="card-head">
        <h2>Move the group</h2>
        <span className="hint">Simulated travel advances the mission clock.</span>
      </div>
      <div className="row gap wrap">
        <button className="btn primary" disabled={!plan.recommended || at} onClick={() => dispatch({ type: 'advance', mode: 'checkpoint' })}>
          <Icon name="flag" /> To next checkpoint
        </button>
        <button className="btn" disabled={!plan.recommended || at} onClick={() => dispatch({ type: 'advance', mode: 'step' })}>
          <Icon name="step" /> Advance ~6 min
        </button>
        {here.map((a) => (
          <button key={a.id} className="btn" onClick={() => dispatch({ type: 'collect', amenityId: a.id })}>
            <Icon name="download" /> Collect at {a.name}
          </button>
        ))}
        {hurt && c.medkits > 0 && (
          <button className="btn" onClick={() => dispatch({ type: 'treat', survivor: hurt.id })}>
            <Icon name="medical" /> Treat {hurt.name}
          </button>
        )}
      </div>
    </section>
  );
}

function Warnings() {
  const { state, plan, mapStatus } = useStore();
  const realNow = useNow(10000);
  const [all, setAll] = useState(false);
  const w = deriveWarnings(state, plan, realNow, { mapAvailable: mapStatus.offline !== 'unavailable' });
  if (!w.length)
    return (
      <section className="card warnings">
        <p className="warn-row clear">
          <span className="sev-dot" style={{ background: SEV_COLOR[0] }} />
          No active warnings for the current plan.
        </p>
      </section>
    );
  const shown = all ? w : w.slice(0, 4);
  return (
    <section className="card warnings" aria-live="polite">
      {shown.map((x) => (
        <p key={x.id} className={`warn-row ${x.level}`}>
          <span className="sev-dot" />
          {x.text}
        </p>
      ))}
      {w.length > 4 && (
        <button className="btn ghost small" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `${w.length - 4} lower-priority warning${w.length - 4 > 1 ? 's' : ''}`}
        </button>
      )}
    </section>
  );
}

function Stages() {
  const { state, plan, dispatch } = useStore();
  const realNow = useNow(15000);
  const v = stageViews(state, plan, realNow);
  const [open, setOpen] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const active = v.find((x) => x.status === 'active');
  const showException = active?.id === 3 && !suppliesSufficient(state, plan).ok && !plan.recommended?.stops.length;
  return (
    <section className="card stages">
      <div className="card-head">
        <h2>Mission stages</h2>
        <span className="hint">{v.filter((x) => x.status === 'complete').length} of 5 complete</span>
      </div>
      <ol>
        {v.map((s) => (
          <li key={s.id} className={`stage ${s.status}`}>
            <button className="stage-row" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
              <span className="stage-num">{s.status === 'complete' ? <Icon name="check" size={13} /> : s.id}</span>
              <span className="stage-title">{s.title}</span>
              <span className="stage-prog">
                <b style={{ width: `${Math.round(s.progress * 100)}%` }} />
              </span>
              <span className="stage-state">{s.status}</span>
            </button>
            {(open === s.id || s.status === 'active') && (
              <div className="stage-body">
                <p>{s.objective}</p>
                <p className="hint">Complete when: {s.condition}</p>
                <p className="hint">Requires: {s.requirements.join('; ')}</p>
                {s.threats.length > 0 && <p className="hint warn">Relevant threats: {s.threats.join('; ')}</p>}
                {s.note && <p className="hint">{s.note}</p>}
                {s.completedAt && <p className="hint">Completed at {fmtClock(s.completedAt)} (mission clock).</p>}
                {s.id === 3 && showException && (
                  <div className="row gap">
                    <input className="input" placeholder="Why supplies cannot be obtained" value={note} onChange={(e) => setNote(e.target.value)} />
                    <button className="btn small" onClick={() => dispatch({ type: 'stage3Exception', note })}>
                      Record exception
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Outcome() {
  const { state, dispatch } = useStore();
  const realNow = useNow(5000);
  const o = missionOutcome(state, realNow);
  if (o === 'in-progress') return null;
  const decisions = state.log.filter((l) => ['threat', 'route', 'supply', 'health', 'sync', 'stage'].includes(l.kind)).slice(-10);
  return (
    <section className={`card outcome ${o}`}>
      <h2>{o === 'success' ? 'Aarav and Mira reached the beacon' : 'The mission failed'}</h2>
      <p>
        {o === 'success'
          ? `Arrived ${fmtDuration((state.deadline - (state.stageCompletedAt[5] ?? 0)) / 60000)} before the beacon shut down, after walking ${fmtDist(state.walkedM)}.`
          : 'The beacon shut down before the group reached the settlement.'}
      </p>
      <h3>Decisions</h3>
      <ul className="log">
        {decisions.map((l, i) => (
          <li key={i}>
            <time>{fmtClock(l.at)}</time> {l.text}
          </li>
        ))}
      </ul>
      <button className="btn" onClick={() => dispatch({ type: 'reset' })}>
        <Icon name="reset" /> Reset the scenario
      </button>
    </section>
  );
}

export function HomePanel() {
  return (
    <>
      <Outcome />
      <CompareCard />
      <ChangeCard />
      <RouteCard />
      <Warnings />
      <MoveControls />
      <Stages />
    </>
  );
}
