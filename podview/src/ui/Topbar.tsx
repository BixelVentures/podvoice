// A-Topbar (design canvas): the 72-px bar 24 from the top. Left: on Hjem the key to Ro (moon + »Ro«), elsewhere the
// back key and the page's title. Centre: Svar with its speaker grille. Right: the weather and the clock with the
// date. The bar's keys step down 2 px under the finger.
import {AnimatePresence, animate, motion, useIsPresent, useMotionValue, useReducedMotion, useTransform}
  from 'motion/react';
import type {MotionValue} from 'motion/react';
import type {ReactNode} from 'react';
import {useEffect, useState} from 'react';
import {Button as AriaButton} from 'react-aria-components';
import {Swap} from '../lib/motion/swap';
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

// The Svar key is a motion button, so its width can follow its label as a layout animation (scale, corrected for its
// radius and its content), never a width that reflows the bar every frame. It is measured only when its label
// changes (layoutDependency), never on the bar's other renders (a push re-renders the bar in the tap's frame).
const MotionAriaButton = motion.create(AriaButton);

// The left key's face (Ro or Tilbage) during their cross-fade: the one leaving is out of the flow (its own absolute
// class, not motion's popLayout, whose injected stylesheet restyles the whole page in the tap's frame) and out of
// reach at once: no tap, no tab stop, not read aloud.
function KeyFace({children, reduced}: {children: ReactNode; reduced: boolean}) {
  const present = useIsPresent();
  const face = reduced ? {opacity: 0} : {opacity: 0, scale: 0.92};
  return (
    <motion.span className={cx('flex', !present && 'pointer-events-none absolute top-1/2 left-0 -translate-y-1/2')}
      aria-hidden={present ? undefined : true} initial={face} animate={{opacity: 1, scale: 1}} exit={face}
      transition={reduced ? TRANSITION.reduced : {...TRANSITION.quick, opacity: TRANSITION.fade}}>
      {children}
    </motion.span>
  );
}

// How far the bar's title travels while it cross-fades with a push or a back (an iPadOS navigation bar).
const TITLE_SHIFT = 16;
// Where the title starts in the bar's left cluster: after the 44-px back key and its 14-px gap.
const TITLE_LEFT = 58;

interface TitleTurn {
  n: number;
  heading: string;
  shown: boolean;
}

// The bar's title: the h1 holds only the current page's title, which slides in from the side of the move on the page
// spring and fades in; the one it replaces fades out to the other side beside it (aria-hidden, outside the h1). Both
// start from where they are, so a tap mid-transition retargets without a jump. On the first paint nothing moves.
function Title({heading, shown, direction}: {heading: string; shown: boolean; direction: 1 | -1}) {
  const reduced = useReducedMotion() ?? false;
  const [turn, setTurn] = useState<TitleTurn>({n: 0, heading, shown});
  const [ghost, setGhost] = useState<(TitleTurn & {from: {x: number; opacity: number}; to: number}) | null>(null);
  const x = useMotionValue(0);
  const opacity = useMotionValue(1);
  if (turn.heading !== heading || turn.shown !== shown) {
    // The title being replaced leaves from where it is now (mid-entry after a quick second tap).
    setGhost(turn.shown ? {...turn, from: {x: x.get(), opacity: opacity.get()}, to: -direction * TITLE_SHIFT} : null);
    setTurn({n: turn.n + 1, heading, shown});
  }
  useEffect(() => {
    if (turn.n === 0) return;
    x.jump(reduced || !turn.shown ? 0 : direction * TITLE_SHIFT);
    opacity.jump(turn.shown ? 0 : 1);
    const moves = [
      animate(x, 0, reduced ? TRANSITION.reduced : TRANSITION.page),
      animate(opacity, 1, reduced ? TRANSITION.reduced : TRANSITION.fade),
    ];
    return () => {
      for (const move of moves) move.stop();
    };
    // Only a new turn starts the entry; direction and reduced are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn.n]);
  return (
    <>
      <h1 id="header-title" tabIndex={-1} className={cx('min-w-0 text-[22px] font-semibold tracking-[-0.01em]',
        'outline-none', shown ? '' : 'sr-only')}>
        <motion.span className="block truncate" style={{x, opacity}}>{heading}</motion.span>
      </h1>
      {ghost ? (
        <motion.span key={ghost.n} aria-hidden="true" data-title-ghost=""
          className="pointer-events-none absolute inset-y-0 right-0 flex items-center truncate text-[22px]
            font-semibold tracking-[-0.01em]"
          style={{left: TITLE_LEFT}}
          initial={ghost.from}
          animate={{x: reduced ? ghost.from.x : ghost.to, opacity: 0}}
          transition={reduced ? TRANSITION.reduced : {...TRANSITION.page, opacity: TRANSITION.fade}}
          onAnimationComplete={() => {
            setGhost(current => (current?.n === ghost.n ? null : current));
          }}>
          {ghost.heading}
        </motion.span>
      ) : null}
    </>
  );
}

// The timer chip's ring: its arc follows the time left as a motion value (one small SVG layer), gliding between
// readings instead of stepping.
function useRing(left: number, length: number): MotionValue<string> {
  const reduced = useReducedMotion() ?? false;
  const value = useMotionValue(Math.max(0, Math.min(1, left)));
  useEffect(() => {
    const to = Math.max(0, Math.min(1, left));
    const travel = Math.abs(to - value.get());
    // A countdown's next reading glides linear over its second; a jump (+1 min, a new timer) travels on smooth.
    const move = animate(value, to, reduced ? TRANSITION.reduced : travel > 0.05 ? TRANSITION.smooth
      : TRANSITION.tick());
    return () => {
      move.stop();
    };
  }, [left, reduced, value]);
  return useTransform(() => `${(length * value.get()).toFixed(1)} ${length.toFixed(1)}`);
}

function TimerRing({left}: {left: number}) {
  const ring = 2 * Math.PI * 9;
  const dash = useRing(left, ring);
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx={12} cy={12} r={9} fill="none" className="stroke-pv-timer-track" strokeWidth={3} />
      <motion.circle cx={12} cy={12} r={9} fill="none" className="stroke-pv-timer-accent" strokeWidth={3}
        strokeLinecap="round" transform="rotate(-90 12 12)" style={{strokeDasharray: dash}} />
    </svg>
  );
}

const KEY = cx(pressable, 'flex items-center bg-pv-surface text-pv-ink data-[pressed]:shadow-none');

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
  /** The way the last page move went (1 a push, -1 a back): the title and back key cross-fade from that side. */
  direction?: 1 | -1;
  className?: string;
}

export function Topbar({back, heading, onRest, svar, weather, clock, date, status, voice, svarState, timer, alert,
  onClock, direction = 1, className}: TopbarProps) {
  const pill = svarState ? SVAR_PILL[svarState] : null;
  const phase = voice ?? pill?.phase ?? 'rest';
  const label = pill ? pill.label : VOICE_LABEL[phase];
  const reduced = useReducedMotion() ?? false;
  const chip = reduced ? {initial: {opacity: 0}, animate: {opacity: 1}, exit: {opacity: 0}} : CHIP_IN;
  const chipTransition = reduced ? TRANSITION.reduced : {...TRANSITION.snappy, opacity: TRANSITION.fade};
  // The left key swaps between Ro and Tilbage as a quick cross-fade with a small scale; the Svar key's label
  // cross-fades while the key's width follows it.
  const keyTransition = reduced ? TRANSITION.reduced : {...TRANSITION.quick, opacity: TRANSITION.fade};
  return (
    <nav aria-label="Visning" className={cx('grid h-[72px] grid-cols-[1fr_auto_1fr] items-center bg-pv-topbar px-7',
      'font-pv text-pv-ink', className)}>
      <div className="relative flex min-w-0 items-center gap-3.5">
        <AnimatePresence initial={false}>
          {back ? (
            <KeyFace key="back" reduced={reduced}>
              <AriaButton className={cx(KEY, 'size-11 justify-center rounded-pv-s',
                'shadow-[0_2px_0_rgba(23,23,26,.10)]')}
                aria-label="Tilbage" data-opens={back.opens} onPress={back.onPress}>
                <Glyph name="back" size={22} stroke={2} />
              </AriaButton>
            </KeyFace>
          ) : (
            <KeyFace key="rest" reduced={reduced}>
              <AriaButton className={cx(KEY, 'h-14 min-w-24 justify-center gap-2.5 rounded-[28px] pr-[22px] pl-4',
                'shadow-pv-key')} aria-label="Gå til Ro" data-navigation="rest" onPress={onRest}>
                <Glyph name="moon" size={24} />
                <span className="text-lg font-semibold">Ro</span>
              </AriaButton>
            </KeyFace>
          )}
        </AnimatePresence>
        <Title heading={heading} shown={!!back} direction={direction} />
      </div>
      <MotionAriaButton id="open-history" layout layoutDependency={label} initial={false} transition={keyTransition}
        className={cx(KEY, 'relative h-12 rounded-3xl pr-[22px] pl-4', pill ? pill.key : 'shadow-pv-key')}
        style={{borderRadius: 24}}
        aria-label={['Se tidligere svar', ...(pill && label !== 'Svar' ? [label] : []),
          ...(svarState === 'ulaest' ? ['nyt svar'] : [])].join(' · ')}
        aria-current={svar.current ? 'page' : false} data-opens="answers" data-svar-state={svarState}
        onPress={svar.onPress}>
        {/* The key's content keeps its own shape while the key's width follows the label (layout correction). */}
        <motion.span layout="position" layoutDependency={label} className="flex items-center gap-3"
          transition={keyTransition}>
          <Grille phase={phase} ink={pill?.dot ?? 'bg-pv-ink'} small={svarState === 'offline'} />
          <span className="relative flex">
            <Swap swapKey={label} text={label} className="text-lg font-semibold whitespace-nowrap"
              out="absolute top-0 left-0">
              {label}
            </Swap>
          </span>
        </motion.span>
        <AnimatePresence initial={false}>
          {svarState === 'ulaest' ? (
            <motion.i key="unread" className="absolute -top-0.5 -right-0.5 block size-3.5 rounded-full bg-pv-live
              shadow-[0_0_0_3px_var(--color-pv-topbar)]" aria-hidden="true"
              initial={reduced ? {opacity: 0} : {opacity: 0, scale: 0.4}} animate={{opacity: 1, scale: 1}}
              exit={reduced ? {opacity: 0} : {opacity: 0, scale: 0.4}}
              transition={reduced ? TRANSITION.reduced : {...TRANSITION.snappy, opacity: TRANSITION.fade}} />
          ) : null}
        </AnimatePresence>
      </MotionAriaButton>
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
                <TimerRing left={timer.left} />
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
                <path d="M7 19h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.5A3.3 3.3 0 0 0 7 19z" className="fill-pv-topbar" />
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
