// A-Radio's pieces (design canvas »PodView Retninger«, A-Radio and Radio-Starter/Spiller/IkkeTilg; System): the
// hero (L 458) with the station's 144-px logo, the status line, the 56-px title and the station's description over
// the fixed station scale (61 ticks, one mark per station), and the station tiles. The red needle stands on the
// scale only while a station plays (it breathes while live; amber while it starts); unavailable greys the scale to
// 30 % with no needle, and the reason is the hero's sub line (the hybrid rule: no extra notice). The surface tones
// into the station's colour (500 ms). The first pick animates: the logo pops in (500 ms, a slight overshoot) and the
// needle grows from the scale; nothing animates on first paint, and reduced motion keeps only fades.
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {Button as AriaButton} from 'react-aria-components';
import {useShown} from '../lib/motion/shown';
import {pressable} from './Button';
import {tapOnly} from './tap';
import {cx} from './tv';

// The canvas's tint recipe: the station colour mixed toward the paper surface (#F7F6F3).
export function stationTint(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const m = 0xF7F6F3;
  const channel = (shift: number) => Math.round(((n >> shift) & 255) * (1 - t) + ((m >> shift) & 255) * t);
  return `rgb(${String(channel(16))},${String(channel(8))},${String(channel(0))})`;
}

const TICKS = Array.from({length: 61}, (_, index) => (index % 10 === 0 ? 96 : index % 5 === 0 ? 64 : 38));
/** The scale position of the station at `index` of `count` (the canvas: 10 %, 30 %, … 90 % for five). */
export const stationAt = (index: number, count: number) => `${String(((index + 0.5) / count) * 100)}%`;

export type RadioPhase = 'vaelg' | 'starter' | 'spiller' | 'stoppet' | 'ikketilg';

export interface RadioHeroProps {
  phase: RadioPhase;
  /** The station shown (starting or playing): its logo, name and colour. */
  station: {id: string; name: string; logo: string; colour: string} | null;
  status: string;
  title: string;
  sub: string;
  /** The scale's marks (»P1«, »P3« …) in catalogue order, and the shown station's place on it. */
  marks: string[];
  index: number | null;
}

function Needle({phase, at, enter}: {phase: RadioPhase; at: string; enter: boolean}) {
  const reduced = useReducedMotion() ?? false;
  const shown = useShown();
  // The needle grows from the scale when it appears after the hero stands (never on first paint).
  const grows = enter && !reduced;
  const starting = phase === 'starter';
  return (
    <motion.i
      aria-hidden="true"
      data-needle={phase}
      className={cx('absolute top-0 bottom-7 -ml-0.5 block w-1 origin-bottom rounded-xs',
        starting ? 'bg-pv-starting shadow-[0_0_12px_rgba(201,162,39,.4)]'
          : 'bg-pv-live shadow-[0_0_12px_rgba(229,38,30,.5)]')}
      initial={grows ? {opacity: 0, scaleY: 0.2, left: at} : {left: at}}
      animate={{opacity: phase === 'spiller' && shown && !reduced ? [1, 0.5, 1] : 1, scaleY: 1, left: at}}
      transition={{
        left: reduced ? {duration: 0} : {duration: 0.5, ease: [0.2, 0.9, 0.3, 1]},
        scaleY: {duration: 0.5, ease: [0.2, 0.9, 0.3, 1]},
        opacity: phase === 'spiller' && shown && !reduced ? {duration: 2.4, ease: 'easeInOut', repeat: Infinity}
          : {duration: 0.5},
      }}
    />
  );
}

function Logo({station, phase, enter}: {station: NonNullable<RadioHeroProps['station']>; phase: RadioPhase;
  enter: boolean}) {
  const reduced = useReducedMotion() ?? false;
  const pops = enter && !reduced;
  return (
    <motion.img
      // A new station pops in on its own element (500 ms, a slight overshoot).
      key={station.id}
      src={station.logo}
      alt={station.name}
      draggable={false}
      className="size-36 flex-none rounded-pv-widget shadow-[0_16px_32px_-16px_rgba(23,23,26,.45)]"
      initial={pops ? {opacity: 0, scale: 0.6, rotate: -6} : false}
      animate={{opacity: phase === 'starter' ? 0.7 : 1, scale: 1, rotate: 0}}
      transition={{duration: 0.5, ease: [0.2, 1.3, 0.4, 1]}}
    />
  );
}

export function RadioHero({phase, station, status, title, sub, marks, index}: RadioHeroProps) {
  const off = phase === 'ikketilg';
  const has = !!station && !off && index !== null;
  const at = has ? stationAt(index, marks.length) : '50%';
  const tint = has ? stationTint(station.colour, phase === 'starter' ? 0.84 : 0.74) : undefined;
  const needle = has && (phase === 'spiller' || phase === 'starter');
  return (
    <div
      className={cx('relative flex h-[458px] flex-none flex-col overflow-hidden rounded-pv-widget p-8',
        'shadow-pv-edge transition-[background-color] duration-500 ease-out',
        has ? '' : off ? 'bg-[#EEEDEA]' : 'bg-pv-surface')}
      style={tint ? {backgroundColor: tint} : undefined}
      data-radio-phase={phase}
    >
      <div className="flex min-h-36 items-center gap-6">
        {/* What is there on first paint just stands (initial={false}); a logo or needle that appears later enters. */}
        <AnimatePresence initial={false}>
          {has ? <Logo key={station.id} station={station} phase={phase} enter /> : null}
        </AnimatePresence>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="text-[17px] leading-[normal] font-semibold text-pv-ink-2">{status}</span>
          <span className={cx('truncate text-[56px] leading-none font-extrabold tracking-[-0.035em]',
            off ? 'text-pv-ink-3' : 'text-pv-ink')}>{title}</span>
          <span className="text-[20px] leading-[normal] text-pv-ink-2">{sub}</span>
        </div>
      </div>
      <div className={cx('relative mt-auto h-[152px]', off && 'opacity-30')} role="img"
        aria-label={`Stationsskala${has ? `, valgt ${station.name}` : ''}`}>
        <div className="absolute inset-x-0 bottom-8 flex items-end justify-between">
          {TICKS.map((height, tick) => (
            <i key={tick} className="block w-[3px] rounded-xs bg-pv-ink opacity-75" style={{height}} />
          ))}
        </div>
        {marks.map((mark, at) => (
          <span key={mark} className={cx('absolute bottom-0 -translate-x-1/2 text-[17px] font-bold',
            has && at === index ? 'text-pv-ink' : 'text-pv-ink-2')}
          style={{left: stationAt(at, marks.length)}}>{mark}</span>
        ))}
        <AnimatePresence initial={false}>
          {needle ? <Needle key="needle" phase={phase} at={at} enter /> : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

export interface StationTileProps {
  name: string;
  logo: string;
  colour: string;
  selected: boolean;
  disabled?: boolean;
  /** The accessible name (the station and where it plays). */
  label: string;
  onPress: () => void;
  id?: string;
}

/** One station on the canvas's grid: the 56-px logo and the name; the chosen one is ringed in its colour. */
export function StationTile({name, logo, colour, selected, disabled = false, label, onPress, id}: StationTileProps) {
  return (
    <AriaButton
      className={cx(pressable, 'flex min-w-0 flex-col items-start gap-2 rounded-pv-widget bg-pv-surface p-4',
        'text-left font-pv text-pv-ink data-[pressed]:scale-[.97] data-[pressed]:brightness-[.92]',
        'data-[disabled]:opacity-45 transition-[box-shadow] duration-300')}
      style={{boxShadow: selected && !disabled ? `inset 0 0 0 3px ${colour}` : 'inset 0 0 0 1px rgba(23,23,26,.06)'}}
      aria-pressed={selected}
      aria-label={label}
      isDisabled={disabled}
      onPress={tapOnly(onPress)}
      {...(id ? {'data-station': id} : {})}
    >
      <img src={logo} alt="" draggable={false} className={cx('size-14 rounded-2xl', disabled && 'grayscale')} />
      <span className="text-[17px] leading-[normal] font-extrabold">{name}</span>
    </AriaButton>
  );
}
