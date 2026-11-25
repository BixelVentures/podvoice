// The kit's own line glyphs (24-unit paths from the design canvas: K-Widget, K-Btn, A-Topbar, A-Player), drawn in
// currentColor. Decorative: the control around a glyph names itself.
import {cx} from './tv';

export const GLYPH = {
  cloud: 'M6 18h11a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.5A3.3 3.3 0 0 0 6 18z',
  sun: 'M7 19h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.5A3.3 3.3 0 0 0 7 19zM11 8a3 3 0 1 0-5.5 1.7',
  rain: 'M7 15h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.5A3.3 3.3 0 0 0 7 15zM9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5',
  robot: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0M10 4.5h4',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z',
  car: 'M3 15v-3l3-4h12l4 4h1v3H3zM10 16a2 2 0 1 1-4 0a2 2 0 1 1 4 0M20 16a2 2 0 1 1-4 0a2 2 0 1 1 4 0',
  music: 'M9 18V5l11-2v13M9 18a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0M20 16a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0',
  radio: 'M3 10a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM7 8l10-4M6 12h4M6 15h4M17.5 14a2.5 ' +
    '2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0',
  recipe: 'M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 3v18M12 8h5M12 12h5',
  timer: 'M20 13a8 8 0 1 1-16 0a8 8 0 1 1 16 0M12 9v4l2 2M10 2h4',
  answer: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5',
  disc: 'M9 18V5l11-2v13M6.5 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  back: 'M19 12H5M11 6l-6 6 6 6',
  moon: 'M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6z',
  speaker: 'M7 3h10v18H7zM12 14a3 3 0 1 0 0 .01M12 7v.01',
  phone: 'M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2',
  computer: 'M4 5h16v10H4zM2 19h20',
  elsewhere: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  next: 'M18 5v14M5 5.5v13L15.5 12z',
  prev: 'M6 5v14M19 5.5v13L8.5 12z',
  restart: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5',
  up: 'M12 19V5M6 11l6-6 6 6',
  lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z',
  unlock: 'M7 11V7a5 5 0 0 1 9.6-2M5 11h14v10H5z',
  offline: 'M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18',
  volume: 'M4 9h4l5-4v14l-5-4H4z',
  volumeWave: 'M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  clock: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0M12 7v5l3 2',
  // A-SvarKort's answer-type marks: a result (ball), a fact (info) and the home.
  ball: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0M12 7.5l3.8 2.8-1.4 4.4H9.6l-1.4-4.4z',
  info: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0M12 11v5M12 8h.01',
  house: 'M4 11l8-7 8 7v9H4zM10 20v-5h4v5',
} as const;

// Filled glyphs (play, pause, stop): the transport's own, filled with currentColor.
export const FILLED = {
  play: 'M8 4.5v15l12-7.5z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  stop: 'M6 6h12v12H6z',
} as const;

export type GlyphName = keyof typeof GLYPH;
export type FilledName = keyof typeof FILLED;

export function Glyph({name, size = 24, stroke = 1.8, className}: {
  name: GlyphName | FilledName;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  const filled = name in FILLED;
  return (
    <svg className={cx('block shrink-0', className)} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round">
      <path d={filled ? FILLED[name as FilledName] : GLYPH[name as GlyphName]} />
    </svg>
  );
}
