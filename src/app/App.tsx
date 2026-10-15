import { useState } from 'react';
import { useStore, type Tab } from './store';
import { TopBar } from '../components/TopBar';
import { MapView } from '../map/MapView';
import { Legend, MapStatusChip, ModeBanner, SimulateMenu, useGps } from '../components/MapChrome';
import { HomePanel } from '../pages/HomePanel';
import { ResourcesPanel } from '../pages/ResourcesPanel';
import { ThreatsPanel } from '../pages/ThreatsPanel';
import { SyncPanel } from '../pages/SyncPanel';
import { Icon, type IconName } from '../components/Icon';

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'resources', label: 'Resources', icon: 'pack' },
  { id: 'threats', label: 'Threats', icon: 'alert' },
  { id: 'sync', label: 'Sync', icon: 'sync' },
];

function Nav() {
  const { tab, setTab, state } = useStore();
  const active = state.threats.filter((t) => t.status === 'active' && t.severity >= 2).length;
  return (
    <nav className="nav" aria-label="Sections">
      {TABS.map((t) => (
        <button key={t.id} className={`nav-btn${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
          <Icon name={t.icon} size={20} />
          <span>{t.label}</span>
          {t.id === 'threats' && active > 0 && <em className="badge">{active}</em>}
        </button>
      ))}
    </nav>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts" aria-live="assertive">
      {toasts.map((t) => (
        <button key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}

function ResetButton() {
  const { dispatch } = useStore();
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <span className="row gap">
      <button className="btn small danger" onClick={() => (dispatch({ type: 'reset' }), setConfirm(false))}>
        Confirm reset
      </button>
      <button className="btn small ghost" onClick={() => setConfirm(false)}>
        Keep
      </button>
    </span>
  ) : (
    <button className="btn small ghost" onClick={() => setConfirm(true)}>
      <Icon name="reset" /> Reset mission
    </button>
  );
}

export function App() {
  const { tab, mode, setMode, setCompare, setTab } = useStore();
  const [simOpen, setSimOpen] = useState(false);
  const [onlineTiles, setOnlineTiles] = useState(false);
  const { gps, locate } = useGps();
  const mapVisible = tab === 'home' || mode.kind !== 'idle';

  return (
    <div className={`app tab-${tab}${mapVisible ? ' map-on' : ''}`}>
      <TopBar />
      <div className="body">
        <Nav />
        <main className="stage" aria-label="Map">
          <MapView onlineTiles={onlineTiles} gps={gps} />
          <div className="map-tools">
            <button className={`btn tool${mode.kind === 'simulate' || simOpen ? ' on' : ''}`} onClick={() => setSimOpen(!simOpen)} aria-expanded={simOpen}>
              <Icon name="alert" /> SIMULATE THREAT
            </button>
            <button
              className={`btn tool${mode.kind === 'compare' ? ' on' : ''}`}
              onClick={() => {
                setSimOpen(false);
                setCompare(null);
                setTab('home');
                setMode(mode.kind === 'compare' ? { kind: 'idle' } : { kind: 'compare', points: [] });
              }}
            >
              <Icon name="pen" /> COMPARE ROUTE
            </button>
            <button className="btn tool icon-only" onClick={locate} title="Show my GPS position" aria-label="Show my GPS position">
              <Icon name="gps" />
            </button>
          </div>
          {simOpen && <SimulateMenu onClose={() => setSimOpen(false)} />}
          <ModeBanner />
          <MapStatusChip onlineTiles={onlineTiles} setOnlineTiles={setOnlineTiles} />
          <Legend />
        </main>
        <aside className="panel" aria-label={`${tab} panel`}>
          <div className="panel-scroll">
            {tab === 'home' && <HomePanel />}
            {tab === 'resources' && <ResourcesPanel />}
            {tab === 'threats' && <ThreatsPanel />}
            {tab === 'sync' && <SyncPanel />}
            <footer className="panel-foot">
              <ResetButton />
              <p className="disclaimer">
                Hackathon prototype. Real streets (OpenStreetMap, Monaco); every survivor, supply and threat value is fictional. Not a medically validated survival system. Confidence figures are model-derived, not survival probabilities.
              </p>
            </footer>
          </div>
        </aside>
      </div>
      <Toasts />
    </div>
  );
}
