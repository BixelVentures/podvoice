// A level (volume, brightness) on React Aria Components' Slider. It follows the finger locally and sends once when
// the gesture ends (onChangeEnd, also when the gesture is cancelled); a change without a gesture (assistive
// technology setting the value) sends at once. So a draft never outlives its gesture; while no gesture runs the
// slider shows `value` (the wish, else what Home Assistant reports). `null` is a level HA does not report.
import {useContext, useLayoutEffect, useRef, useState} from 'react';
import type {RefObject} from 'react';
import {
  Label, Slider as AriaSlider, SliderOutput, SliderStateContext, SliderThumb, SliderTrack,
} from 'react-aria-components';
import {animate, motion, useMotionValue, useReducedMotion, useTransform} from 'motion/react';
import {TRANSITION} from '../lib/motion/tokens';
import {cx} from './tv';

export interface SliderProps {
  label: string;
  value: number | null;
  min?: number;
  max?: number;
  isDisabled?: boolean;
  format: (value: number) => string;
  onCommit: (value: number) => void;
  className?: string;
  /** `player`: A-Player's volume (no visible label or value; a 4-px rail, an 18-px knob ringed in the surface).
   * `kit`: Kit-Kontroller's slider (an 8-px track in the domain's `tone`, a white 28 knob, the level in mono). */
  variant?: 'default' | 'player' | 'kit';
  /** kit: the track's colour, the domain's (Kit-Kontroller: lys is amber); default ink. */
  tone?: SliderTone;
  /** kit: the visible label left of the track (A-Lys »Lysstyrke«); else the label is for assistive technology. */
  showLabel?: boolean;
  /** kit: a lamp's own slider (a 24 knob, the level in 15 px mono). */
  compact?: boolean;
  /** player: how the rail follows a change from outside: `spring` (a level: the quick spring) or `clock` (a timeline:
   *  each second glides linear, a seek travels on the smooth spring, never a step back right after a release). */
  follow?: 'spring' | 'clock';
  [data: `data-${string}`]: string | undefined;
}

export const UNKNOWN_LEVEL = 'Ikke oplyst';

export type SliderTone = 'ink' | 'lys' | 'robot' | 'tesla' | 'vejr';
const TONE: Record<SliderTone, string> = {
  ink: 'bg-pv-ink', lys: 'bg-pv-light-track', robot: 'bg-pv-robot-dot', tesla: 'bg-pv-ok', vejr: 'bg-pv-weather-dot',
};

type Dragging = RefObject<(() => boolean) | null>;

// Tells the slider whether its thumb is in a gesture right now.
function DragProbe({draggingRef}: {draggingRef: Dragging}) {
  const state = useContext(SliderStateContext);
  useLayoutEffect(() => {
    draggingRef.current = state ? () => state.isThumbDragging(0) : null;
  }, [state, draggingRef]);
  return null;
}

type PlainProps = Omit<SliderProps, 'tone' | 'showLabel' | 'compact'>;
type KitPropsOmit = 'variant' | 'follow';
type KitProps = Omit<SliderProps, KitPropsOmit>;

export function Slider({variant, tone, showLabel, compact, follow, ...props}: SliderProps) {
  if (variant === 'kit') {
    return <KitSlider {...props} {...(tone ? {tone} : {})} {...(showLabel === undefined ? {} : {showLabel})}
      {...(compact === undefined ? {} : {compact})} />;
  }
  return <PlainSlider {...props} {...(variant ? {variant} : {})} {...(follow ? {follow} : {})} />;
}

// A-Player's rail (fill and knob) as one motion value, drawn with transforms only: the fill is a full-width bar slid
// into a rounded clip, the knob rides a full-width layer translated by the same share. Under the finger it follows
// 1:1; a change from outside glides (`follow`). Reduced motion: in place.
function PlayerRail({percent, value, dragging, known, follow, committed}: {percent: number; value: number;
  dragging: boolean; known: boolean; follow: 'spring' | 'clock'; committed: RefObject<number>}) {
  const reduced = useReducedMotion() ?? false;
  const at = useMotionValue(percent);
  const last = useRef({value, percent});
  useLayoutEffect(() => {
    const previous = last.current;
    const step = value - previous.value;
    const now = globalThis.performance.now();
    // Right after a release the confirmed position may read a little behind the wish: hold, never step back.
    if (follow === 'clock' && !dragging && step < 0 && step >= -3 && now - committed.current < 5000) return;
    last.current = {value, percent};
    if (dragging || reduced) {
      at.jump(percent);
      return;
    }
    const transition = follow === 'clock' ? (step > 0 && step <= 1.5 ? TRANSITION.tick() : TRANSITION.smooth)
      : TRANSITION.quick;
    const controls = animate(at, percent, transition);
    return () => {
      controls.stop();
    };
  }, [at, percent, value, dragging, reduced, follow, committed]);
  const fill = useTransform(at, v => `${String(v - 100)}%`);
  const knob = useTransform(at, v => `${String(v)}%`);
  return (
    <>
      <span className="absolute inset-x-0 top-5 h-1 overflow-hidden rounded-xs" hidden={!known}>
        <motion.span className="absolute inset-0 rounded-xs bg-pv-ink" style={{x: fill}} />
      </span>
      <motion.span className="pointer-events-none absolute inset-x-0 top-[22px] h-0" style={{x: knob}}
        hidden={!known} aria-hidden="true">
        <span className="absolute -top-[9px] -left-[9px] size-[18px] rounded-pv-pill bg-pv-ink
          shadow-[0_0_0_4px_var(--color-pv-surface)]" />
      </motion.span>
    </>
  );
}

function PlainSlider({label, value, min = 0, max = 100, isDisabled = false, format, onCommit, className,
  variant = 'default', follow = 'spring', ...data}: PlainProps) {
  const player = variant === 'player';
  const [draft, setDraft] = useState<number | null>(null);
  // When the finger last let go (the rail holds its place against a small step back while the change is confirmed).
  const committed = useRef(0);
  const draggingRef: Dragging = useRef(null);
  const known = value !== null || draft !== null;
  const shown = draft ?? value ?? min;
  return (
    <AriaSlider
      {...data}
      className={cx('grid grid-cols-[minmax(0,1fr)_auto] font-pv text-pv-body', className)}
      minValue={min}
      maxValue={max}
      step={1}
      value={shown}
      isDisabled={isDisabled}
      data-known={known ? 'true' : 'false'}
      onChange={next => {
        if (draggingRef.current?.() === false) {
          setDraft(null);
          committed.current = globalThis.performance.now();
          onCommit(next);
        } else setDraft(next);
      }}
      onChangeEnd={next => {
        setDraft(null);
        committed.current = globalThis.performance.now();
        onCommit(next);
      }}
    >
      <DragProbe draggingRef={draggingRef} />
      <Label className={player ? 'sr-only' : 'min-w-0 truncate font-medium text-pv-ink-2'}>{label}</Label>
      <SliderOutput className={player ? 'sr-only' : 'text-right font-semibold text-pv-ink tabular-nums'}>
        {() => (known ? format(shown) : UNKNOWN_LEVEL)}
      </SliderOutput>
      {/* The thumb's centre travels between half a thumb from either end, as a native range's does. */}
      {player ? (
        <SliderTrack className="relative col-span-2 h-11 touch-none data-[disabled]:opacity-45">
          {({state}) => (
            <>
              <span className="absolute inset-x-0 top-5 h-1 rounded-xs bg-pv-ink/12" />
              <PlayerRail percent={state.getThumbPercent(0) * 100} value={shown} dragging={draft !== null}
                known={known} follow={follow} committed={committed} />
              {/* React Aria's thumb is the hit, focus and keyboard target; the drawn knob follows the rail. */}
              <SliderThumb
                className={cx(
                  'top-[22px] size-[18px] rounded-pv-pill',
                  'outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-4',
                  'data-[focus-visible]:outline-pv-ink',
                )}
              />
            </>
          )}
        </SliderTrack>
      ) : (
      <SliderTrack className="relative col-span-2 mx-3 h-pv-hit touch-none">
        {({state}) => (
          <>
            <span className="absolute -inset-x-3 top-1/2 h-1.5 -translate-y-1/2 rounded-pv-pill bg-pv-line" />
            <span
              className="absolute top-1/2 -left-3 h-1.5 -translate-y-1/2 rounded-pv-pill bg-pv-ink"
              style={{width: `calc(${String(state.getThumbPercent(0) * 100)}% + 12px)`}}
              hidden={!known}
            />
            <SliderThumb
              className={cx(
                'top-1/2 size-6 rounded-pv-pill bg-pv-ink outline-none data-[focus-visible]:outline-2',
                'data-[focus-visible]:outline-offset-4 data-[focus-visible]:outline-pv-ink',
                known ? '' : 'opacity-0',
              )}
            />
          </>
        )}
      </SliderTrack>
      )}
    </AriaSlider>
  );
}

// Kit-Kontroller's slider. A drag moves the knob 1:1 with the finger; a change from outside (HA's state, a scene, the
// room's switch) glides the knob and the fill there on the quick spring (in place with reduced motion). RAC's own
// thumb is the invisible hit and focus target; the drawn knob follows one motion value.
function KitSlider({label, value, min = 0, max = 100, isDisabled = false, format, onCommit, className,
  tone = 'ink', showLabel = false, compact = false, ...data}: KitProps) {
  const [draft, setDraft] = useState<number | null>(null);
  const draggingRef: Dragging = useRef(null);
  // A change without a gesture (a key) is sent at once; React Aria ends it with onChangeEnd for the same value,
  // which must not send it twice.
  const sentRef = useRef<number | null>(null);
  const reduced = useReducedMotion() ?? false;
  const known = value !== null || draft !== null;
  const shown = draft ?? value ?? min;
  const percent = known ? Math.min(100, Math.max(0, ((shown - min) / Math.max(1, max - min)) * 100)) : 0;
  const at = useMotionValue(percent);
  useLayoutEffect(() => {
    if (draft !== null || reduced) {
      at.jump(percent);
      return;
    }
    const controls = animate(at, percent, TRANSITION.quick);
    return () => {
      controls.stop();
    };
  }, [at, percent, draft, reduced]);
  const knob = compact ? 24 : 28;
  const width = useTransform(at, v => `${String(v)}%`);
  const left = useTransform(at, v => `calc(${String(v)}% - ${String(knob / 2)}px)`);
  return (
    <AriaSlider
      {...data}
      className={cx('flex h-11 min-w-0 items-center font-pv', compact ? 'gap-3' : 'gap-4',
        'data-[disabled]:opacity-40', className)}
      minValue={min}
      maxValue={max}
      step={1}
      value={shown}
      isDisabled={isDisabled}
      data-known={known ? 'true' : 'false'}
      onChange={next => {
        if (draggingRef.current?.() === false) {
          setDraft(null);
          sentRef.current = next;
          onCommit(next);
        } else setDraft(next);
      }}
      onChangeEnd={next => {
        setDraft(null);
        const sent = sentRef.current;
        sentRef.current = null;
        if (sent !== next) onCommit(next);
      }}
    >
      <DragProbe draggingRef={draggingRef} />
      <Label className={showLabel ? 'w-24 shrink-0 text-[17px] leading-6 font-semibold text-pv-ink' : 'sr-only'}>
        {label}
      </Label>
      <SliderTrack className="relative h-11 min-w-0 flex-1 touch-none">
        <span className="absolute inset-x-0 top-[18px] h-2 rounded-[4px] bg-pv-ink/12" />
        <motion.span className={cx('absolute top-[18px] left-0 h-2 rounded-[4px]', TONE[tone])}
          style={{width}} hidden={!known} />
        <motion.span aria-hidden="true" hidden={!known}
          className="absolute rounded-full bg-pv-surface shadow-[0_2px_8px_rgba(23,23,26,.3)]"
          style={{left, top: 22 - knob / 2, width: knob, height: knob}} />
        <SliderThumb
          className={cx('top-1/2 rounded-full outline-none data-[focus-visible]:outline-2',
            'data-[focus-visible]:outline-offset-4 data-[focus-visible]:outline-pv-ink')}
          style={{width: knob, height: knob}}
        />
      </SliderTrack>
      <SliderOutput className={cx('shrink-0 text-right font-pv-mono font-medium text-pv-ink tabular-nums',
        compact ? 'w-12 text-[15px]' : 'w-16 text-[17px]')}>
        {() => (known ? format(shown) : '—')}
      </SliderOutput>
    </AriaSlider>
  );
}
