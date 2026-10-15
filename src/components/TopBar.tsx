import { useStore, useNow } from '../app/store';
import { missionNow } from '../routing/planner';
import { missionOutcome } from '../missions/stages';
import { fmtCountdown, fmtDuration } from '../utils/format';
import { Icon } from './Icon';
import type { SurvivorState } from '../types';

const STAGE_TITLES = ['Escape the shelter', 'Cross the city', 'Secure essential supplies', 'Reach the evacuation corridor', 'Reach the final beacon'];

function Vital({ s }: { s: SurvivorState }) {
  const tone = (v: number) => (v < 30 ? 'crit' : v < 55 ? 'warn' : 'ok');
  return (
    <div className="vital" title={`${s.name}: health ${Math.round(s.health)}, energy ${Math.round(s.energy)}, cognition ${Math.round(s.cognition)}${s.injured ? ', injured' : ''}`}>
      <span className="vital-name">
        {s.name}
        {s.injured && <em className="flag">injured</em>}
      </span>
      <span className="vital-bars">
        <span className="bar-row">
          <i>HP</i>
          <span className={`bar ${tone(s.health)}`}>
            <b style={{ width: `${s.health}%` }} />
          </span>
          <span className="num">{Math.round(s.health)}</span>
        </span>
        <span className="bar-row">
          <i>EN</i>
          <span className={`bar ${tone(s.energy)}`}>
            <b style={{ width: `${s.energy}%` }} />
          </span>
          <span className="num">{Math.round(s.energy)}</span>
        </span>
      </span>
    </div>
  );
}

export function TopBar() {
  const { state, plan, online } = useStore();
  const realNow = useNow(1000);
  const now = missionNow(state, realNow);
  const left = state.deadline - now;
  const total = Math.max(1, state.deadline - state.scenarioStartedAt);
  const frac = Math.max(0, Math.min(1, left / total));
  const rec = plan.recommended;
  const outcome = missionOutcome(state, realNow);
  const stageIdx = [1, 2, 3, 4, 5].find((i) => !state.stageCompletedAt[i as 1]) ?? 6;
  let status: { text: string; tone: string };
  if (outcome === 'success') status = { text: 'Mission complete', tone: 'ok' };
  else if (outcome === 'failed') status = { text: 'Mission failed', tone: 'crit' };
  else if (!rec) status = { text: 'No feasible route', tone: 'crit' };
  else if (rec.status === 'HIGH RISK' || rec.deadlineMarginMin < 15 || rec.belowReserve.length) status = { text: 'At risk', tone: 'warn' };
  else status = { text: 'On track', tone: 'ok' };
  const urgency = left < 0 ? 'crit' : rec && rec.travelMin * 60000 > left ? 'crit' : left < 30 * 60000 ? 'warn' : 'ok';

  return (
    <header className="topbar">
      <div className="tb-day">
        <span className="day">DAY 19</span>
        <span className="outbreak">OUTBREAK</span>
      </div>
      <div className="tb-stage">
        <span className="tb-k">Stage {Math.min(stageIdx, 5)} of 5</span>
        <span className="tb-v">{stageIdx > 5 ? 'All stages complete' : STAGE_TITLES[stageIdx - 1]}</span>
      </div>
      <div className={`tb-beacon ${urgency}`} aria-live="off">
        <span className="tb-k">Beacon shuts down in</span>
        <span className="countdown">{left > 0 ? fmtCountdown(left) : 'CLOSED'}</span>
        <span className="beacon-bar">
          <b style={{ width: `${frac * 100}%` }} />
        </span>
      </div>
      <div className="tb-eta">
        <span className="tb-k">Travel needed</span>
        <span className="tb-v big">{state.position === 'settlement' ? 'Arrived' : rec ? fmtDuration(rec.travelMin) : 'No route'}</span>
      </div>
      <div className={`tb-status ${status.tone}`}>
        <span className="tb-k">Mission</span>
        <span className="tb-v">{status.text}</span>
      </div>
      <div className={`tb-net ${online ? 'on' : 'off'}`} title="Browser connectivity report. Planning, storage and QR sync all work offline.">
        <Icon name={online ? 'wifi' : 'wifiOff'} />
        <span>{online ? 'ONLINE' : 'OFFLINE'}</span>
      </div>
      <div className="tb-vitals">
        {state.survivors.map((s) => (
          <Vital key={s.id} s={s} />
        ))}
      </div>
    </header>
  );
}
