export function fmtDuration(min: number): string {
  if (!isFinite(min)) return '--';
  const neg = min < 0;
  const m = Math.abs(Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  const s = h > 0 ? `${h} h ${String(r).padStart(2, '0')} min` : `${r} min`;
  return neg ? `-${s}` : s;
}

export function fmtCountdown(ms: number): string {
  const neg = ms < 0;
  const t = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const body = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return neg ? `-${body}` : body;
}

export function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export function fmtL(l: number): string {
  return `${l.toFixed(2)} L`;
}

export function fmtMeals(m: number): string {
  return `${m.toFixed(2)} meal${Math.abs(m - 1) < 0.005 ? '' : 's'}`;
}

export function fmtAgo(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min ago`;
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function uid(prefix: string): string {
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${r}`;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
