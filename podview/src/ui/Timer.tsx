// The Timer screen's surfaces (design canvas A-Timer, Timer-pause, Timer-faerdig; the old wall's draft card):
// `TimerFace` is the dark card of one timer (the coral ring is remaining / known total, the time in mono 88 with
// »af 10:00« under it, the kicker, the 48 px title, the line under it and its K-Btn 56 actions), `TimerDraft` is the
// dark card a new timer is chosen on (−/+ a minute around the dial, four presets, »Start timer«), and `RecentTimers`
// is the light card »Tidligere timere« (»Justér før start«: a tap fills the draft). Material: running pulses
// inwards, paused stands still and faint, done is full and the ring blinks; still with reduced motion and while the
// screen waits out of sight. Presentational: every press is the caller's.
import {motion, useReducedMotion, useTransform} from 'motion/react';
import type {MotionValue} from 'motion/react';
import type {ReactNode, Ref} from 'react';
import {Button as AriaButton} from 'react-aria-components';
import {useShown} from '../lib/motion/shown';
import {TRANSITION} from '../lib/motion/tokens';
import {RollingDigits} from '../lib/motion/value';
import {pressable} from './Button';
import {Glyph} from './glyphs';
import {cx} from './tv';

export type TimerTone = 'koerer' | 'pause' | 'faerdig';

export interface TimerFaceProps {
  tone: TimerTone;
  /** The countdown (»8:42«, »0:00«). */
  time: string;
  /** »af 10:00« under the time (empty: none). */
  total?: string;
  /** Remaining / known total, 0–100 (a motion value follows the deadline); null: the total is not known. */
  progress: MotionValue<number> | number | null;
  kicker: string;
  title: string;
  /** The line under the title (»Færdig kl. 14.39«); hidden but kept when it repeats the title. */
  sub?: string;
  /** Over an hour: the time is smaller (60). */
  long?: boolean;
  /** The card's K-Btn 56 actions. */
  actions?: ReactNode;
  /** A line for the outcome of the last press, and the last-known mark. */
  note?: ReactNode;
  className?: string;
  ref?: Ref<HTMLElement>;
  [data: `data-${string}`]: string | undefined;
}

// The dotted material at the right: coral cells radiating from the right edge (asset drawn from the canvas's own
// loop), masked in from 200 px.
function Material({tone}: {tone: TimerTone}) {
  const reduced = useReducedMotion() ?? false;
  const shown = useShown();
  const breathes = tone === 'koerer' && !reduced && shown;
  return (
    <motion.span
      key={breathes ? 'breathes' : 'still'}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 right-0 h-[458px] w-[520px] bg-[url(/assets/timer/timer-material.svg)]
        bg-size-[520px_458px] bg-right bg-no-repeat [mask-image:linear-gradient(90deg,transparent_0,#000_200px)]"
      initial={{opacity: tone === 'pause' ? 0.3 : tone === 'faerdig' ? 0.9 : 0.55}}
      animate={breathes ? {opacity: [0.4, 0.6, 0.4]} : {opacity: tone === 'pause' ? 0.3 : tone === 'faerdig' ? 0.9
        : 0.55}}
      transition={breathes ? TRANSITION.ambient(2) : {duration: 0}}
    />
  );
}

function Ring({progress, done}: {progress: TimerFaceProps['progress']; done: boolean}) {
  const reduced = useReducedMotion() ?? false;
  const shown = useShown();
  const pulses = done && !reduced && shown;
  const value = typeof progress === 'number' || progress === null ? null : progress;
  const offset = useTransform(() => 100 - (value ? value.get() : typeof progress === 'number' ? progress : 0));
  return (
    <svg viewBox="0 0 340 340" className="absolute inset-0 size-[340px] -rotate-90" aria-hidden="true">
      <circle className="fill-none stroke-pv-dark-2" strokeWidth={22} cx="170" cy="170" r="150" />
      <motion.circle
        key={pulses ? 'pulses' : 'still'}
        className={cx('fill-none stroke-pv-timer-accent [stroke-dasharray:100_100]', progress === null && 'invisible')}
        strokeWidth={22} strokeLinecap="round" cx="170" cy="170" r="150" pathLength={100}
        style={{strokeDashoffset: done ? 0 : offset}}
        {...(pulses ? {animate: {opacity: [1, 0.45, 1]}, transition: {duration: 1.6, ease: 'easeInOut',
          repeat: Infinity}} : {})}
      />
    </svg>
  );
}

export function TimerFace({tone, time, total = '', progress, kicker, title, sub = '', long = false, actions, note,
  className, ref, ...data}: TimerFaceProps) {
  const done = tone === 'faerdig';
  return (
    <motion.article
      {...data}
      ref={ref}
      className={cx('relative grid h-[458px] shrink-0 grid-cols-[340px_minmax(0,1fr)] items-center gap-10',
        'overflow-hidden rounded-[24px] bg-pv-dark p-8 font-pv text-pv-on-dark',
        'shadow-[inset_0_0_0_1px_rgba(23,23,26,.06)] group-data-[link=offline]/host:opacity-55', className)}
      data-tone={tone}
    >
      <Material tone={tone} />
      <div className="relative z-[1] size-[340px]">
        <Ring progress={progress} done={done} />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5" aria-hidden="true">
          <span className={cx('font-pv-mono leading-none font-medium tracking-[-0.06em]',
            long ? 'text-[60px]' : 'text-[88px]')}>
            <RollingDigits text={time} still={2} />
          </span>
          {total ? <span className="text-[17px] text-pv-on-dark-3">{total}</span> : null}
        </div>
      </div>
      <div className="relative z-[1] flex min-w-0 flex-col gap-3">
        <span className="text-[17px] font-semibold wrap-anywhere text-pv-on-dark-3">{kicker}</span>
        <span className={cx('text-[48px] leading-[1.02] font-extrabold tracking-[-0.03em] whitespace-nowrap',
          done ? 'text-pv-timer-accent' : 'text-pv-on-dark')}>{title}</span>
        {sub ? <span className={cx('text-[18px] text-pv-on-dark-2', sub === title && 'invisible')}>{sub}</span>
          : null}
        {actions ? <div className="mt-5 flex flex-wrap gap-2.5" role="group" aria-label="Betjen timer">{actions}</div>
          : null}
        {note}
      </div>
    </motion.article>
  );
}

const ROUND = cx(pressable, 'flex size-16 items-center justify-center rounded-full bg-pv-ink-2 text-pv-on-dark',
  'data-[pressed]:brightness-[.92]');
const PRESET = cx(pressable, 'flex h-16 flex-1 items-center justify-center rounded-pv-pill bg-pv-ink-2 text-[17px]',
  'font-semibold text-pv-on-dark data-[pressed]:brightness-[.92] aria-pressed:bg-pv-on-dark aria-pressed:text-pv-ink');

export interface TimerDraftProps {
  /** The chosen time (»5:00«) and its unit line (»min : sek«). */
  time: string;
  unit: string;
  long?: boolean;
  presets: {minutes: number; chosen: boolean; onPress: () => void}[];
  onMinus: () => void;
  onPlus: () => void;
  onStart: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
  draftDisabled?: boolean;
  startDisabled?: boolean;
  busy?: boolean;
  note?: ReactNode;
  className?: string;
  ref?: Ref<HTMLFormElement>;
}

/** The new timer's card (the old wall's »Ny timer«, the dark draft card), as tall as the running face (L 458). */
export function TimerDraft({time, unit, long = false, presets, onMinus, onPlus, onStart, minusDisabled = false,
  plusDisabled = false, draftDisabled = false, startDisabled = false, busy = false, note, className,
  ref}: TimerDraftProps) {
  return (
    <form
      ref={ref}
      className={cx('relative flex h-[458px] shrink-0 flex-col gap-6 rounded-[24px] bg-pv-dark p-8 font-pv',
        'text-pv-on-dark',
        'shadow-[inset_0_0_0_1px_rgba(23,23,26,.06)] group-data-[link=offline]/host:opacity-55', className)}
      aria-label="Ny timer"
      aria-busy={busy}
      onSubmit={event => {
        event.preventDefault();
        if (!startDisabled) onStart();
      }}
    >
      <div className="flex h-[200px] items-center justify-center gap-6">
        <AriaButton className={ROUND} aria-label="1 minut mindre" isDisabled={minusDisabled} onPress={onMinus}>
          <Glyph name="minus" size={30} stroke={1.6} />
        </AriaButton>
        <div className="flex size-[200px] flex-col items-center justify-center rounded-full
          shadow-[inset_0_0_0_3px_var(--color-pv-ink-2)]">
          <output className={cx('font-pv-mono leading-none font-medium tracking-[-0.04em]',
            long ? 'text-[44px]' : 'text-[64px]')} aria-live="polite" aria-label="Valgt tid">{time}</output>
          <span className="mt-2 text-[15px]">{unit}</span>
        </div>
        <AriaButton className={ROUND} aria-label="1 minut mere" isDisabled={plusDisabled} onPress={onPlus}>
          <Glyph name="plus" size={30} stroke={1.6} />
        </AriaButton>
      </div>
      <div className="flex gap-4" role="group" aria-label="Faste tider">
        {presets.map(preset => (
          <AriaButton key={preset.minutes} className={PRESET} aria-pressed={preset.chosen}
            data-minutes={String(preset.minutes)} isDisabled={draftDisabled} onPress={preset.onPress}>
            {`${String(preset.minutes)} min`}
          </AriaButton>
        ))}
      </div>
      <AriaButton type="submit" className={cx(pressable, 'flex h-16 items-center justify-center gap-3 rounded-pv-pill',
        'bg-pv-surface text-[20px] font-semibold text-pv-ink data-[pressed]:brightness-[.92]')}
        isDisabled={startDisabled} data-busy={busy ? 'true' : undefined}>
        <Glyph name="play" size={22} />
        Start timer
      </AriaButton>
      {/* The outcome line sits in the card's foot, so the card keeps its L height. */}
      {note ? <div className="absolute inset-x-8 bottom-1">{note}</div> : null}
    </form>
  );
}

export interface RecentTimersProps {
  choices: {seconds: number; time: string; label: string}[];
  isDisabled?: boolean;
  onChoose: (seconds: number) => void;
  className?: string;
}

/** »Tidligere timere«: the product's own history, newest first (»Seneste«, »Tidligere«); a tap fills the draft. */
export function RecentTimers({choices, isDisabled = false, onChoose, className}: RecentTimersProps) {
  return (
    <section className={cx('flex min-h-0 flex-1 flex-col gap-3.5 rounded-[24px] bg-pv-surface p-6 font-pv',
      'text-pv-ink shadow-[inset_0_0_0_1px_rgba(23,23,26,.06)]', className)} aria-labelledby="timer-recent-title">
      <div className="flex items-baseline justify-between">
        <h2 id="timer-recent-title" className="text-2xl font-extrabold">Tidligere timere</h2>
        <span className="text-[15px] text-pv-ink-3">Justér før start</span>
      </div>
      <div className="flex flex-wrap gap-2.5" role="group" aria-label="Tidligere timere">
        {choices.map(choice => (
          <AriaButton key={choice.seconds}
            className={cx(pressable, 'flex h-14 flex-col items-start justify-center rounded-pv-pill bg-pv-surface-2',
              'px-[22px] data-[pressed]:brightness-[.92]')}
            data-recent-seconds={String(choice.seconds)}
            aria-label={`${choice.time}, ${choice.label}. Justér før start`}
            isDisabled={isDisabled}
            onPress={() => {
              onChoose(choice.seconds);
            }}>
            <span className="font-pv-mono text-[18px] leading-tight font-semibold">{choice.time}</span>
            <span className="text-[15px] leading-tight font-medium text-pv-ink-3">{choice.label}</span>
          </AriaButton>
        ))}
      </div>
    </section>
  );
}
