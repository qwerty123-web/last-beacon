/** Small stroke icon set (24px grid). No emoji anywhere in the UI. */
const P: Record<string, string> = {
  home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  pack: 'M7 7V5a2 2 0 012-2h6a2 2 0 012 2v2M4 9a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2zM4 13h16M10 13v2h4v-2',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  sync: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2v2',
  water: 'M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z',
  food: 'M5 10h14l-1.5 9a2 2 0 01-2 1.6h-7a2 2 0 01-2-1.6zM8 10V7a4 4 0 018 0v3',
  medical: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  safehouse: 'M3 12l9-8 9 8M6 10v10h12V10M10 20v-5h4v5',
  cache: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8',
  beacon: 'M12 2v4M5 5l2.5 2.5M19 5l-2.5 2.5M8 22l4-12 4 12M9.5 17.5h5',
  person: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  target: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 16a4 4 0 100-8 4 4 0 000 8z',
  route: 'M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM6 15V9a4 4 0 014-4h0M18 9v6a4 4 0 01-4 4h-4',
  pen: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M4 12l5 5L20 6',
  gps: 'M12 21s7-6 7-12a7 7 0 00-14 0c0 6 7 12 7 12zM12 11.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  wifi: 'M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.5v.01',
  wifiOff: 'M2 2l20 20M8.5 16a5 5 0 017 0M5 12.5a10 10 0 015-2.6M2 9a15 15 0 015.4-3.3M14.5 9.3A10 10 0 0119 12.5M12 19.5v.01',
  camera: 'M3 8a2 2 0 012-2h2l2-2h6l2 2h2a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2zM12 17a4 4 0 100-8 4 4 0 000 8z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  step: 'M5 12h11M12 6l6 6-6 6',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  copy: 'M8 8h11v13H8zM5 16H4V3h11v1',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  upload: 'M12 15V3M7 8l5-5 5 5M4 21h16',
  path: 'M4 20c4-1 4-7 8-8s4-7 8-8',
  reset: 'M4 4v6h6M4.5 15a8 8 0 102-8.5L4 10',
  chevron: 'M9 6l6 6-6 6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14 3h-4l-.6 2.7a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 005 12a7 7 0 00.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 002 1.2L10 21h4l.6-2.7a7 7 0 002-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}

/** SVG markup string for Leaflet divIcons. */
export function iconSvg(name: IconName, size = 14, stroke = 'currentColor'): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${P[name]}"/></svg>`;
}
