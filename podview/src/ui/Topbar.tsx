// A-Topbar (design canvas): the 72-px bar 24 from the top. Left: on Hjem the key to Ro (moon + »Ro«), elsewhere the
// back key and the page's title. Centre: Svar with its speaker grille. Right: the weather and the clock with the
// date. The bar's keys step down 2 px under the finger.
import {animate, AnimatePresence, motion, useIsPresent, useMotionValue, useReducedMotion} from 'motion/react';
import type {HTMLMotionProps} from 'motion/react';
import type {ReactNode} from 'react';
import {useLayoutEffect, useRef} from 'react';
import {Button as AriaButton} from 'react-aria-components';
import {TRANSITION} from '../lib/motion/tokens';
import {pressable} from './Button';
import {Glyph} from './glyphs';
import type {GlyphName} from './glyphs';
import {cx} from './tv';

// Svar's grille: three calm rows of seven dots, the edge columns a little smaller (a speaker grille).
export const GRILLE = Array.from({length: 21}, (_, index) => {
  const i = index % 7;
  const j = Math.floor(index / 7);
  const w = 4.2 * (i === 0 || i === 6 ? 0.7 : 1);
  return {x: Math.round((i * 7 + 3.5 - w / 2) * 10) / 10, y: Math.round((j * 7.5 + 3.5 - w / 2) * 10) / 10,
    w: Math.round(w * 10) / 10};
});

// The voice's phases (A-Stemme): at rest the grille stands still; listening it gathers inwards (ripple), thinking
// a calm sweep crosses it, answering it opens from the middle (voice), and waiting for a follow-up it scatters (chat).
export type VoicePhase = 'rest' | 'ripple' | 'sweep' | 'voice' | 'chat';
export const VOICE_LABEL: Record<VoicePhase, string> = {rest: 'Svar', ripple: 'Lytter…', sweep: 'Tænker…',
  voice: 'Svarer…', chat: 'Spørg videre'};
// The Svar key's seven states (Kit-SvarKnap): its surface, ring, label and the grille's ink. The grille keeps the
// voice's phase (A-Stemme: the voice is a grille, never an equalizer); unread adds the red dot until the card is seen.
export type SvarPillState = 'hvile' | 'lytter' | 'taenker' | 'svarer' | 'ulaest' | 'fejl' | 'offline';
export const SVAR_PILL: Record<SvarPillState, {label: string; phase: VoicePhase; key: string; dot: string}> = {
  hvile: {label: 'Svar', phase: 'rest', key: 'bg-pv-surface text-pv-ink shadow-pv-key', dot: 'bg-pv-ink'},
  lytter: {label: 'Lytter…', phase: 'ripple', key: 'bg-pv-listen text-pv-ink shadow-[0_2px_0_rgba(23,23,26,.10),' +
    'inset_0_0_0_2px_var(--color-pv-listen-ring)]', dot: 'bg-pv-alert'},
  taenker: {label: 'Tænker…', phase: 'sweep', key: 'bg-pv-surface text-pv-ink shadow-pv-key', dot: 'bg-pv-ink'},
  svarer: {label: 'Svarer…', phase: 'voice', key: 'bg-pv-dark text-pv-on-dark shadow-[0_2px_0_rgba(23,23,26,.10)]',
    dot: 'bg-pv-on-dark'},
  ulaest: {label: 'Svar', phase: 'rest', key: 'bg-pv-surface text-pv-ink shadow-pv-key', dot: 'bg-pv-ink'},
  fejl: {label: 'Svar kom ikke', phase: 'rest', key: 'bg-pv-danger-tint text-pv-notice-error-ink ' +
    'shadow-[0_2px_0_rgba(23,23,26,.10),inset_0_0_0_1.5px_rgba(176,38,42,.35)]', dot: 'bg-pv-danger'},
  offline: {label: 'Offline', phase: 'rest', key: 'bg-pv-notice-info text-pv-ink-3 shadow-[0_2px_0_rgba(23,23,26,.10)]',
    dot: 'bg-pv-grey'},
};

const VOICE_SECONDS: Record<Exclude<VoicePhase, 'rest'>, number> = {ripple: 1.8, sweep: 1.6, voice: 1.3, chat: 2.4};

function voiceGrid(phase: Exclude<VoicePhase, 'rest'>) {
  const dots: {x: number; y: number; delay: number}[] = [];
  const cols = 7, rows = 3, step = 7, cx = 3, cy = 1, rmax = Math.hypot(cx, cy);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const r = Math.hypot((i - cx) * 0.8, (j - cy) * 1.6);
      const delay = phase === 'ripple' ? -(r / rmax) * 1800 : phase === 'sweep' ? -(i / cols) * 1600
        : phase === 'voice' ? -(Math.abs(j - cy) * 260 + Math.abs(i - cx) * 40)
          : -(((i * 37 + j * 91) % 23) / 23) * 2400;
      dots.push({x: i * step + (j % 2 ? step / 2 : 0), y: j * step * 0.9 * 1.1 + 1, delay});
    }
  }
  return dots;
}

function Grille({phase, ink = 'bg-pv-ink', small = false}: {phase: VoicePhase; ink?: string; small?: boolean}) {
  const reduced = useReducedMotion() ?? false;
  if (phase === 'rest' || reduced) {
    return (
      <span className="relative block h-[22px] w-[46px]" aria-hidden="true">
        {GRILLE.map(dot => (
          <i key={`${String(dot.x)}-${String(dot.y)}`} className={cx('absolute rounded-full', ink)}
            style={{left: dot.x, top: dot.y, width: dot.w, height: dot.w, scale: small ? 0.7 : 1}} />
        ))}
      </span>
    );
  }
  const seconds = VOICE_SECONDS[phase];
  return (
    <span className="relative block h-[22px] w-[46px]" aria-hidden="true" data-voice={phase}>
      {voiceGrid(phase).map(dot => (
        <motion.i key={`${String(dot.x)}-${String(dot.y)}`}
          className={cx('absolute block size-[5px] rounded-full', ink)}
          style={{left: dot.x, top: dot.y, scale: 0.38}}
          animate={{scale: [0.38, 1, 0.38]}}
          transition={{duration: seconds, ease: 'easeInOut', repeat: Infinity,
            // The canvas starts each dot part-way through its cycle (a negative delay): the same phase, shifted.
            delay: ((dot.delay / 1000) % seconds + seconds) % seconds}} />
      ))}
    </span>
  );
}

// A chip entering the bar's right side (the running timer, an alert): it drops in 8 px and settles (canvas tbin .32 s).
const CHIP_IN = {initial: {opacity: 0, y: -8, scale: 0.96}, animate: {opacity: 1, y: 0, scale: 1},
  exit: {opacity: 0, y: -8, scale: 0.96}};

// A push or a back: the bar's left side (the key and the title) cross-fades and travels a short way with the page
// spring, the way the page itself moves (enters from the push's side, leaves toward the other). Reduced motion:
// opacity only.
const PAGE_SHIFT = 20;
const PAGE_SIDE = {
  enter: ({direction, reduced}: PageCustom) => ({opacity: 0, x: reduced ? 0 : direction * PAGE_SHIFT}),
  shown: {opacity: 1, x: 0},
  exit: ({direction, reduced}: PageCustom) => ({opacity: 0, x: reduced ? 0 : -direction * PAGE_SHIFT}),
};
interface PageCustom {direction: 1 | -1; reduced: boolean}

// A part of the bar that may be on its way out: while it leaves it is hidden from assistive tech and the heading's
// name and takes no tap (never `inert`: a tap is never locked), so the title reads as the new page's at once and
// only the new key answers.
// It also steps out of the flow as it leaves (absolute at its corner, as motion's popLayout would, without the
// stylesheet popLayout injects: that forced a whole-document style recalc on every phase change).
function Leaving({className, centred = false, ...props}: HTMLMotionProps<'span'> & {centred?: boolean}) {
  const present = useIsPresent();
  return <motion.span {...props} className={cx(className, !present && 'pointer-events-none absolute left-0',
    !present && (centred ? 'top-1/2 -translate-y-1/2' : 'top-0'))}
    aria-hidden={present ? undefined : true} />;
}

const KEY = cx(pressable, 'flex items-center bg-pv-surface text-pv-ink data-[pressed]:shadow-none');

// The Svar key's surface (its colour and ring) is its own layer, so a new state's width is a spring on that layer
// alone (measured, the quick spring, centred on the key) while the label cross-fades: the bar itself never reflows
// frame by frame. No layout projection here: measuring it would reset the moving screens' transforms on every
// phase change. Reduced motion: the width changes at once and the label cross-fades.
const SURFACE = /^(bg-|shadow-)/;
function SvarKey({className, label, ariaLabel, current, state, phase, ink, small, onPress}: {
  className: string; label: string; ariaLabel: string; current: boolean; state: SvarPillState | undefined;
  phase: VoicePhase; ink: string; small: boolean; onPress: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const key = useRef<HTMLButtonElement>(null);
  const width = useMotionValue<number | null>(null);
  useLayoutEffect(() => {
    const node = key.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    let move: ReturnType<typeof animate> | null = null;
    const fit = () => {
      const to = node.offsetWidth;
      const from = width.get();
      move?.stop();
      if (from === null || reduced || from === to) width.set(to);
      else move = animate(width, to, TRANSITION.quick);
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(node);
    return () => {
      watch.disconnect();
      move?.stop();
    };
  }, [reduced, width]);
  const classes = className.split(/\s+/);
  const surface = classes.filter(name => SURFACE.test(name)).join(' ');
  const text = classes.filter(name => !SURFACE.test(name)).join(' ');
  return (
    <AriaButton ref={key} id="open-history" className={cx(pressable, 'group/svar relative flex h-12 items-center gap-3',
      'rounded-3xl pr-[22px] pl-4', text)}
      aria-label={ariaLabel} aria-current={current ? 'page' : false} data-opens="answers" data-svar-state={state}
      onPress={onPress}>
      <motion.span aria-hidden="true" className={cx('absolute inset-y-0 left-1/2 rounded-3xl transition-colors',
        'duration-(--duration-pv-tap) ease-pv-out group-data-[pressed]/svar:shadow-none', surface)}
        style={{x: '-50%', width: useWidth(width)}} />
      <span className="relative">
        <Grille phase={phase} ink={ink} small={small} />
      </span>
      <span className="relative grid">
        <AnimatePresence initial={false}>
          <Leaving key={label} className="text-lg font-semibold whitespace-nowrap" initial={{opacity: 0}}
            animate={{opacity: 1}} exit={{opacity: 0}} transition={reduced ? TRANSITION.reduced : TRANSITION.fade}>
            {label}
          </Leaving>
        </AnimatePresence>
      </span>
      {state === 'ulaest' ? (
        <i className="absolute -top-0.5 -right-0.5 block size-3.5 rounded-full bg-pv-live
          shadow-[0_0_0_3px_var(--color-pv-bg)]" aria-hidden="true" />
      ) : null}
    </AriaButton>
  );
}

// Before the first measure the surface is the key's own width (100%).
function useWidth(width: ReturnType<typeof useMotionValue<number | null>>) {
  const reading = width.get();
  return reading === null ? '100%' : width;
}

export interface TopbarProps {
  /** Hjem shows the key to Ro; any other page its back key and title. */
  back?: {onPress: () => void; opens?: string} | null;
  heading: string;
  onRest: () => void;
  svar: {onPress: () => void; current: boolean};
  weather?: {temperature: string; condition: string; glyph: GlyphName} | null;
  clock: string;
  date: string;
  /** Something the bar says before the weather (the link to Home Assistant). */
  status?: ReactNode;
  /** The voice's phase in the Svar key's grille. */
  voice?: VoicePhase;
  /** The Svar key's state (Kit-SvarKnap): its look and label; its grille follows `voice`, else the state's phase. */
  svarState?: SvarPillState;
  /** A running timer as a chip (every page but Timer): its count, its name and how much is left (0–1). */
  timer?: {count: string; name: string; left: number; onPress: () => void} | null;
  /** An event from another domain (a robot fault while on Tesla): a red badge; a tap goes to that domain. */
  alert?: {text: string; domain: string; onPress: () => void} | null;
  /** The clock is a key: it opens Skærm og enhed (A-Skaerm), as the old wall page's clock did. */
  onClock?: () => void;
  /** The page the bar shows (a push or a back changes it): the left side cross-fades; defaults to `heading`. */
  page?: string;
  /** The direction of the last move (1 a push, −1 a back): the side the left side's cross-fade comes from. */
  direction?: 1 | -1;
  className?: string;
}

export function Topbar({back, heading, onRest, svar, weather, clock, date, status, voice, svarState, timer, alert,
  onClock, page, direction = 1, className}: TopbarProps) {
  const pill = svarState ? SVAR_PILL[svarState] : null;
  const phase = voice ?? pill?.phase ?? 'rest';
  const label = pill ? pill.label : VOICE_LABEL[phase];
  const reduced = useReducedMotion() ?? false;
  const chip = reduced ? {initial: {opacity: 0}, animate: {opacity: 1}, exit: {opacity: 0}} : CHIP_IN;
  const chipTransition = reduced ? TRANSITION.reduced : {...TRANSITION.snappy, opacity: TRANSITION.fade};
  const ring = 2 * Math.PI * 9;
  const custom: PageCustom = {direction, reduced};
  const sideTransition = reduced ? TRANSITION.reduced : {...TRANSITION.page, opacity: TRANSITION.fade};
  const side = {variants: PAGE_SIDE, custom, initial: 'enter', animate: 'shown', exit: 'exit',
    transition: sideTransition} as const;
  return (
    <nav aria-label="Visning" className={cx('grid h-[72px] grid-cols-[1fr_auto_1fr] items-center bg-pv-bg px-7',
      'font-pv text-pv-ink', className)}>
      <div className="relative flex min-w-0 items-center gap-3.5">
        <AnimatePresence initial={false} custom={custom}>
          {back ? (
            <Leaving key="back" centred {...side} className="flex shrink-0">
              <AriaButton className={cx(KEY, 'size-11 justify-center rounded-pv-s shadow-[0_2px_0_rgba(23,23,26,.10)]')}
                aria-label="Tilbage" data-opens={back.opens} onPress={back.onPress}>
                <Glyph name="back" size={22} stroke={2} />
              </AriaButton>
            </Leaving>
          ) : (
            <Leaving key="rest" centred {...side} className="flex shrink-0">
              <AriaButton className={cx(KEY, 'h-14 min-w-24 justify-center gap-2.5 rounded-[28px] pr-[22px] pl-4',
                'shadow-pv-key')} aria-label="Gå til Ro" data-navigation="rest" onPress={onRest}>
                <Glyph name="moon" size={24} />
                <span className="text-lg font-semibold">Ro</span>
              </AriaButton>
            </Leaving>
          )}
        </AnimatePresence>
        <h1 id="header-title" tabIndex={-1} className={cx('relative min-w-0 flex-1 text-[22px] font-semibold',
          'tracking-[-0.01em] whitespace-nowrap outline-none', back ? '' : 'sr-only')}>
          <AnimatePresence initial={false} custom={custom}>
            <Leaving key={page ?? heading} {...side} className="block truncate">{heading}</Leaving>
          </AnimatePresence>
        </h1>
      </div>
      <SvarKey className={pill ? pill.key : 'bg-pv-surface text-pv-ink shadow-pv-key'} label={label}
        ariaLabel={['Se tidligere svar', ...(pill && label !== 'Svar' ? [label] : []),
          ...(svarState === 'ulaest' ? ['nyt svar'] : [])].join(' · ')}
        current={svar.current} state={svarState} phase={phase} ink={pill?.dot ?? 'bg-pv-ink'}
        small={svarState === 'offline'} onPress={svar.onPress} />
      <div className="flex items-center justify-end gap-7">
        {status}
        <AnimatePresence initial={false}>
          {alert ? (
            <motion.span key="alert" {...chip} transition={chipTransition} className="flex">
              <AriaButton className={cx(KEY, 'h-11 gap-2 rounded-[22px] bg-pv-danger-tint pr-3.5 pl-2.5',
                'text-pv-notice-error-ink shadow-[inset_0_0_0_1.5px_rgba(176,38,42,.35)]')}
                aria-label={`${alert.text}. Gå til ${alert.domain}`} onPress={alert.onPress}>
                <span className="flex size-[22px] items-center justify-center rounded-full bg-pv-danger text-[13px]
                  font-extrabold text-white">!</span>
                <span className="text-[15px] font-bold whitespace-nowrap">{alert.text}</span>
              </AriaButton>
            </motion.span>
          ) : null}
          {timer ? (
            <motion.span key="timer" {...chip} transition={chipTransition} className="flex">
              <AriaButton className={cx(KEY, 'h-11 gap-2.5 rounded-[22px] bg-pv-ink pr-3.5 pl-2.5 text-pv-on-dark')}
                aria-label={`Timer ${timer.count}, ${timer.name}`} data-opens="timers" onPress={timer.onPress}>
                <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx={12} cy={12} r={9} fill="none" className="stroke-pv-timer-track" strokeWidth={3} />
                  <circle cx={12} cy={12} r={9} fill="none" className="stroke-pv-timer-accent" strokeWidth={3}
                    strokeLinecap="round" transform="rotate(-90 12 12)"
                    strokeDasharray={`${(ring * Math.max(0, Math.min(1, timer.left))).toFixed(1)} ${ring.toFixed(1)}`} />
                </svg>
                <span className="font-pv-mono text-lg font-medium tracking-[-0.03em]">{timer.count}</span>
              </AriaButton>
            </motion.span>
          ) : null}
        </AnimatePresence>
        {weather ? (
          <div className="flex items-center gap-2.5" data-topbar="weather">
            {weather.glyph === 'rain' ? <Glyph name="rain" size={28} stroke={1.6} /> : (
              // The canvas's own bar mark: a sun behind a cloud filled with the bar's colour.
              <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
                strokeLinejoin="round" aria-hidden="true" className="block shrink-0">
                <circle cx={8} cy={8} r={3} />
                <path d="M7 19h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.5A3.3 3.3 0 0 0 7 19z" className="fill-pv-bg" />
              </svg>
            )}
            <div className="flex flex-col leading-[1.1]">
              <span className="text-[19px] font-semibold tabular-nums">{weather.temperature}</span>
              <span className="text-[15px] text-pv-ink-3">{weather.condition}</span>
            </div>
          </div>
        ) : null}
        {onClock ? (
          <AriaButton id="header-clock" className={cx(pressable, '-m-2 flex flex-col items-end rounded-pv-s p-2',
            'leading-[1.1] whitespace-nowrap')}
            aria-label={`${clock}, ${date}. Skærm og enhed`} aria-haspopup="dialog" onPress={onClock}>
            <span className="font-pv-mono text-xl font-medium tracking-[-0.02em]">{clock}</span>
            <span className="text-[15px] text-pv-ink-3">{date}</span>
          </AriaButton>
        ) : (
          <div className="flex flex-col items-end leading-[1.1] whitespace-nowrap">
            <span className="font-pv-mono text-xl font-medium tracking-[-0.02em]">{clock}</span>
            <span className="text-[15px] text-pv-ink-3">{date}</span>
          </div>
        )}
      </div>
    </nav>
  );
}
