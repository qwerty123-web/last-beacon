import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useStore } from '../app/store';
import { buildPayload, decodePayload, encodePayload, MAX_QR_CHARS, SAFE_QR_CHARS, type Selection, type SyncPayload } from '../sync/payload';
import { mergePayload, type MergeReport } from '../sync/merge';
import { Scanner, cameraSupport } from '../sync/Scanner';
import { THREAT_CATALOG } from '../threats/catalog';
import { SEV_COLOR } from '../styles/tokens';
import { fmtClock } from '../utils/format';
import { missionNow } from '../routing/planner';
import { Icon } from '../components/Icon';

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function Generate() {
  const { state, device, toasts, dismissToast } = useStore();
  const shareable = useMemo(
    () => ({
      threats: state.threats.filter((t) => t.source !== 'scenario'),
      amenities: state.amenities.filter((a) => a.origin !== 'scenario'),
      paths: state.paths,
      messages: state.messages,
    }),
    [state],
  );
  const [sel, setSel] = useState<Selection>(() => ({
    threats: shareable.threats.filter((t) => t.status === 'active').map((t) => t.id).slice(-6),
    amenities: shareable.amenities.map((a) => a.id).slice(-4),
    paths: shareable.paths.map((p) => p.id).slice(-3),
    messages: shareable.messages.map((m) => m.id).slice(-3),
    survivors: [],
  }));
  const [code, setCode] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useMemo(() => encodePayload(buildPayload(state, sel, device.id, device.name, missionNow(state, Date.now()))), [state, sel, device]);
  const count = sel.threats.length + sel.amenities.length + sel.paths.length + sel.messages.length + sel.survivors.length;
  const toggle = (k: keyof Selection, id: string, on: boolean) => setSel((s) => ({ ...s, [k]: on ? [...(s[k] as string[]), id] : (s[k] as string[]).filter((x) => x !== id) }));

  useEffect(() => {
    if (code && canvas.current) {
      QRCode.toCanvas(canvas.current, code, { errorCorrectionLevel: 'L', margin: 2, width: Math.min(340, window.innerWidth - 64), color: { dark: '#000000', light: '#ffffff' } }).catch(() => setCode(null));
    }
  }, [code]);

  const download = () => {
    const blob = new Blob([code ?? text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `last-beacon-${device.id}-${Date.now().toString(36)}.lbsync`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Share updates</h2>
        <span className="hint">{count} selected</span>
      </div>
      <p className="hint">Only selected items travel, as a compact delta. Scenario intel is already on every device.</p>
      {shareable.threats.length + shareable.amenities.length + shareable.paths.length + shareable.messages.length === 0 && (
        <p className="note">Nothing new to share yet. Add a threat report, mark an amenity or a path, or write an urgent message.</p>
      )}
      <div className="sel-list">
        {shareable.threats.map((t) => (
          <Check key={t.id} checked={sel.threats.includes(t.id)} onChange={(v) => toggle('threats', t.id, v)}>
            <span className="sev-dot" style={{ background: SEV_COLOR[t.severity] }} />
            {THREAT_CATALOG[t.category].label} L{t.severity}, {t.place} {t.source === 'simulated' && <em className="tag">simulated</em>}
            {t.status === 'resolved' && <em className="tag">resolved</em>}
          </Check>
        ))}
        {shareable.amenities.map((a) => (
          <Check key={a.id} checked={sel.amenities.includes(a.id)} onChange={(v) => toggle('amenities', a.id, v)}>
            Amenity: {a.name} ({a.type})
          </Check>
        ))}
        {shareable.paths.map((p) => (
          <Check key={p.id} checked={sel.paths.includes(p.id)} onChange={(v) => toggle('paths', p.id, v)}>
            Path: {p.note} ({Math.round(p.len)} m{p.verified ? ', verified' : ''})
          </Check>
        ))}
        {shareable.messages.map((m) => (
          <Check key={m.id} checked={sel.messages.includes(m.id)} onChange={(v) => toggle('messages', m.id, v)}>
            Message: “{m.text}”
          </Check>
        ))}
        {state.survivors.map((s) => (
          <Check key={s.id} checked={sel.survivors.includes(s.id)} onChange={(v) => setSel((x) => ({ ...x, survivors: v ? [...x.survivors, s.id] : x.survivors.filter((y) => y !== s.id) }))}>
            {s.name}'s status and inventory <span className="muted">(resource update)</span>
          </Check>
        ))}
      </div>
      <div className={`size-meter ${text.length > SAFE_QR_CHARS ? (text.length > MAX_QR_CHARS ? 'crit' : 'warn') : ''}`}>
        <b style={{ width: `${Math.min(100, (text.length / MAX_QR_CHARS) * 100)}%` }} />
        <span>
          {text.length} characters
          {text.length > MAX_QR_CHARS ? ': too large for one QR code. Select fewer reports.' : text.length > SAFE_QR_CHARS ? ': large code, may be slow to scan. Consider selecting fewer reports.' : ''}
        </span>
      </div>
      <button className="btn primary wide" disabled={!count || text.length > MAX_QR_CHARS} onClick={() => {
          toasts.forEach((t) => dismissToast(t.id)); // nothing may cover the code while it is shown
          setCode(text);
          setTimeout(() => canvas.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
        }}>
        <Icon name="sync" /> GENERATE SYNC QR
      </button>
      {code && (
        <div className="qr-out">
          <canvas ref={canvas} aria-label="Sync QR code" />
          <p className="hint">
            From {device.name} ({device.id}). Show this to the other phone and choose SCAN QR there. No internet needed.
          </p>
          <div className="row gap wrap">
            <button className="btn small" onClick={() => navigator.clipboard?.writeText(code).catch(() => undefined)}>
              <Icon name="copy" /> Copy code text
            </button>
            <button className="btn small" onClick={download}>
              <Icon name="download" /> Save as file
            </button>
            <button className="btn small ghost" onClick={() => setCode(null)}>
              Hide
            </button>
          </div>
          <details>
            <summary className="hint">Show code text (manual fallback)</summary>
            <textarea className="input code" readOnly value={code} rows={4} />
          </details>
        </div>
      )}
    </section>
  );
}

function Preview({ payload, onDone }: { payload: SyncPayload; onDone: () => void }) {
  const { state, dispatch, toast } = useStore();
  const report: MergeReport = useMemo(() => mergePayload(state, payload, missionNow(state, Date.now())).report, [state, payload]);
  const types = [payload.t?.length && 'threat reports', payload.a?.length && 'amenities', payload.p?.length && 'paths', payload.m?.length && 'messages', payload.s?.length && 'survivor status'].filter(Boolean);
  const maxSev = Math.max(-1, ...(payload.t ?? []).map((t) => t.s));
  return (
    <div className="preview">
      <h3>Review before importing</h3>
      <dl className="mini">
        <div>
          <dt>Sender</dt>
          <dd>
            {payload.f.n} ({payload.f.d})
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{fmtClock(payload.at * 1000)}</dd>
        </div>
        <div>
          <dt>Contains</dt>
          <dd>{types.join(', ')}</dd>
        </div>
        <div>
          <dt>Reports</dt>
          <dd>
            {payload.t?.length ?? 0} threat, {payload.a?.length ?? 0} amenity, {payload.p?.length ?? 0} path, {payload.m?.length ?? 0} message
          </dd>
        </div>
        {maxSev >= 0 && (
          <div>
            <dt>Highest severity</dt>
            <dd>
              <span className="sev-dot" style={{ background: SEV_COLOR[maxSev as 0] }} /> Level {maxSev}
            </dd>
          </div>
        )}
      </dl>
      {(payload.t ?? []).map((t) => (
        <p key={t.i} className="hint">
          {THREAT_CATALOG[t.c].label} L{t.s} at {t.pl}, {t.f}% confidence, {t.o === 'sim' ? 'simulated' : 'field report'}
          {t.st === 'r' ? ', resolved' : ''}
        </p>
      ))}
      {(payload.m ?? []).map((m) => (
        <p key={m.i} className="note">
          “{m.tx}” from {m.fr}
        </p>
      ))}
      {report.alreadyImported && <p className="note warn">This update was already imported on this device.</p>}
      {report.survivorUpdates.length > 0 && <p className="note">Resource changes: {report.survivorUpdates.join('; ')}</p>}
      {report.duplicates > 0 && <p className="hint">{report.duplicates} item(s) already known and not newer: they will be skipped.</p>}
      {report.pathsInvalid > 0 && <p className="note warn">{report.pathsInvalid} path(s) fail local validation and will not be routable.</p>}
      {report.conflicts.map((c) => (
        <p key={c} className="note warn">
          Potential conflict: {c}. Both reports will be kept.
        </p>
      ))}
      <div className="row gap">
        <button
          className="btn primary"
          disabled={report.alreadyImported}
          onClick={() => {
            const r = dispatch({ type: 'importSync', payload });
            if (r.ok) {
              toast('event', 'Update imported. Route recalculated locally.');
              onDone();
            }
          }}
        >
          <Icon name="check" /> Accept and import
        </button>
        <button className="btn ghost" onClick={onDone}>
          Reject
        </button>
      </div>
    </div>
  );
}

function Receive() {
  const { state, toast } = useStore();
  const [scan, setScan] = useState(false);
  const [paste, setPaste] = useState('');
  const [payload, setPayload] = useState<SyncPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cam = cameraSupport();
  const handle = useCallback(
    (text: string) => {
      setScan(false);
      const d = decodePayload(text, missionNow(state, Date.now()) + 5 * 60000);
      if (d.ok) {
        setPayload(d.payload);
        setError(null);
      } else {
        setPayload(null);
        setError(d.error);
        toast('error', d.error);
      }
    },
    [state, toast],
  );
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 8000) return setError('File is too large to be a sync update.');
    handle(await f.text());
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>Receive updates</h2>
        <span className={`hint ${cam.ok ? '' : 'warn'}`}>{cam.ok ? 'Camera API available' : cam.reason}</span>
      </div>
      {!scan && !payload && (
        <button className="btn primary wide" onClick={() => (setScan(true), setError(null))}>
          <Icon name="camera" /> SCAN QR
        </button>
      )}
      {scan && <Scanner onCode={handle} onClose={() => setScan(false)} />}
      {payload && <Preview payload={payload} onDone={() => setPayload(null)} />}
      {error && <p className="note crit">Rejected: {error}</p>}
      {!payload && (
        <details className="fallback">
          <summary>Manual fallback: paste code or open a file</summary>
          <textarea className="input code" rows={4} placeholder="LB1:…" value={paste} onChange={(e) => setPaste(e.target.value)} />
          <div className="row gap wrap">
            <button className="btn small" disabled={!paste.trim()} onClick={() => handle(paste)}>
              Preview pasted code
            </button>
            <label className="btn small">
              <Icon name="upload" /> Open .lbsync file
              <input type="file" accept=".lbsync,.txt,text/plain" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
        </details>
      )}
    </section>
  );
}

function Identity() {
  const { device, setDevice, storage, online } = useStore();
  return (
    <section className="card">
      <div className="card-head">
        <h2>This device</h2>
        <span className="hint">ID {device.id}</span>
      </div>
      <div className="seg">
        {['Aarav', 'Mira'].map((n) => (
          <button key={n} className={`seg-btn${device.name === n ? ' on' : ''}`} onClick={() => setDevice({ ...device, name: n })}>
            Carried by {n}
          </button>
        ))}
      </div>
      <dl className="mini">
        <div>
          <dt>Local functions</dt>
          <dd className="ok">Available offline</dd>
        </div>
        <div>
          <dt>Storage</dt>
          <dd className={storage === 'memory' ? 'crit' : storage === 'localstorage' ? 'warn' : 'ok'}>{storage === 'indexeddb' ? 'IndexedDB' : storage === 'localstorage' ? 'Fallback (localStorage)' : 'Not saving (memory only)'}</dd>
        </div>
        <div>
          <dt>Internet</dt>
          <dd>{online ? 'Connection detected' : 'No connection'}</dd>
        </div>
      </dl>
      <p className="hint">QR sync still needs the two phones to see each other: one shows the code, the other scans it.</p>
    </section>
  );
}

function Messages() {
  const { state, dispatch, device } = useStore();
  const [text, setText] = useState('');
  return (
    <section className="card">
      <div className="card-head">
        <h2>Urgent messages</h2>
      </div>
      <div className="row gap">
        <input className="input grow" maxLength={140} value={text} placeholder="e.g. Pharmacy on Rue Grimaldi is empty" onChange={(e) => setText(e.target.value)} />
        <button
          className="btn small"
          disabled={!text.trim()}
          onClick={() => {
            if (dispatch({ type: 'message', text, from: device.name }).ok) setText('');
          }}
        >
          Save
        </button>
      </div>
      <ul className="log">
        {state.messages
          .slice()
          .reverse()
          .map((m) => (
            <li key={m.id}>
              <time>{fmtClock(m.at)}</time> <strong>{m.from}</strong> {m.text}
            </li>
          ))}
      </ul>
    </section>
  );
}

export function SyncPanel() {
  return (
    <>
      <Identity />
      <Receive />
      <Generate />
      <Messages />
    </>
  );
}
