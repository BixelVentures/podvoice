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
type KitProps = Omit<SliderProps, 'variant'>;

export function Slider({variant, tone, showLabel, compact, ...props}: SliderProps) {
  if (variant === 'kit') {
    return <KitSlider {...props} {...(tone ? {tone} : {})} {...(showLabel === undefined ? {} : {showLabel})}
      {...(compact === undefined ? {} : {compact})} />;
  }
  return <PlainSlider {...props} {...(variant ? {variant} : {})} />;
}

function PlainSlider({label, value, min = 0, max = 100, isDisabled = false, format, onCommit, className,
  variant = 'default', ...data}: PlainProps) {
  const player = variant === 'player';
  const [draft, setDraft] = useState<number | null>(null);
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
          onCommit(next);
        } else setDraft(next);
      }}
      onChangeEnd={next => {
        setDraft(null);
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
              <span className="absolute top-5 left-0 h-1 rounded-xs bg-pv-ink"
                style={{width: `${String(state.getThumbPercent(0) * 100)}%`}} hidden={!known} />
              <SliderThumb
                className={cx(
                  'top-[22px] size-[18px] rounded-pv-pill bg-pv-ink shadow-[0_0_0_4px_var(--color-pv-surface)]',
                  'outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-4',
                  'data-[focus-visible]:outline-pv-ink', known ? '' : 'opacity-0',
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
