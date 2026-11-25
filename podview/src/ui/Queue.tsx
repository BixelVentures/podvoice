// Musik-Koe, the player's »Nu og kø« (design canvas): the heading »Kø« with its line (»20 numre · Køkkenalrum«), then
// one card of rows. The current song is just row 1 (no separate card, no »Næste«): bold dark ink with three moving
// bars (owner decision 25 Nov: no coral, coral is the timer's), or a pause mark while paused. A tapped row is pressed
// at once (grey surface, a small press) and shows a spinner and »Starter…« until the player confirms; only then does
// the caller reorder (nothing moves under the finger). No drag sorting, no handle (16 Nov). Presentational: every
// press is the caller's.
import {motion, useReducedMotion} from 'motion/react';
import type {ReactNode, Ref} from 'react';
import {Button as AriaButton} from 'react-aria-components';
import {TRANSITION} from '../lib/motion/tokens';
import {pressable} from './Button';
import {Glyph} from './glyphs';
import {cx} from './tv';

export type QueueMark = 'playing' | 'paused' | 'starting' | null;

export interface QueueCardProps {
  heading: string;
  /** The line at the right of the heading (the count and the speaker, or why there are no rows). */
  meta: ReactNode;
  /** Ready, loading (placeholders) or why the rows are missing (a status for assistive technology and tests). */
  status?: 'ready' | 'loading' | 'error';
  busy?: boolean;
  /** A key at the right of the heading (Afspiller's »Find musik«, G7 ruling). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** The queue's column: »Kø« and its line, then the card that holds the rows (it scrolls; the bottom fades). */
export function QueueCard({heading, meta, status = 'ready', busy = false, action, children, className}:
  QueueCardProps) {
  return (
    <section className={cx('flex min-h-0 flex-col gap-4 font-pv text-pv-ink', className)} aria-labelledby="queue-title">
      <div className={cx('flex shrink-0 justify-between gap-4', action ? 'h-11 items-center' : 'h-8 items-baseline')}>
        <h2 id="queue-title" className="text-2xl font-extrabold">{heading}</h2>
        <p id="queue-meta" className={cx('min-w-0 truncate text-[15px] text-pv-ink-3', action && 'ml-auto')}
          role="status">{meta}</p>
        {action}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[24px] bg-pv-surface">
        <div id="queue" className="h-full overflow-y-auto overscroll-contain px-5 pt-2 pb-12" role="group"
          aria-label={heading} aria-busy={busy} data-status={status}>
          {children}
        </div>
        <i className="pointer-events-none absolute inset-x-0 bottom-0 block h-12
          bg-[linear-gradient(180deg,rgba(247,246,243,0),var(--color-pv-surface))]" aria-hidden="true" />
      </div>
    </section>
  );
}

/** Three bars that move while the song plays (still with reduced motion, at their middle heights). */
export function QueueBars({still = false}: {still?: boolean}) {
  const reduced = (useReducedMotion() ?? false) || still;
  return (
    <span className="flex h-5 items-end gap-[3px]" aria-hidden="true" data-bars="">
      {[0, 0.2, 0.4].map((delay, index) => (
        <motion.i key={delay} className="block w-1 rounded-[2px] bg-pv-ink"
          initial={{height: reduced ? ([9, 16, 12][index] ?? 9) : 5}}
          {...(reduced ? {} : {animate: {height: [5, 16, 5]},
            transition: {duration: 0.9, ease: 'easeInOut', repeat: Infinity, delay}})} />
      ))}
    </span>
  );
}

function Spinner() {
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.span className="block size-5 rounded-full border-[2.5px] border-pv-ink/25 border-t-pv-ink"
      aria-hidden="true" data-spinner=""
      {...(reduced ? {} : {animate: {rotate: 360}, transition: {duration: 0.8, ease: 'linear', repeat: Infinity}})} />
  );
}

export interface QueueRowProps {
  /** The row's place in the list (1 is the current song). */
  index: number;
  title: string;
  artist: string;
  cover?: string | null;
  mark?: QueueMark;
  /** The row's accessible name (what a tap does). */
  label: string;
  isDisabled?: boolean;
  onPress?: () => void;
  ref?: Ref<HTMLButtonElement>;
  [data: `data-${string}`]: string | undefined;
}

export function QueueRow({index, title, artist, cover, mark = null, label, isDisabled = false, onPress, ref,
  ...data}: QueueRowProps) {
  const current = mark === 'playing' || mark === 'paused';
  const starting = mark === 'starting';
  const reduced = useReducedMotion() ?? false;
  return (
    <AriaButton
      {...data}
      ref={ref}
      className={cx(pressable, '-mx-3 grid h-[72px] w-[calc(100%+24px)] grid-cols-[32px_56px_minmax(0,1fr)]',
        'items-center gap-3.5 rounded-[14px] px-3 text-left data-[pressed]:bg-pv-surface-2',
        'data-[focus-visible]:outline-offset-0 data-[disabled]:opacity-100',
        index > 1 && 'shadow-[inset_0_1px_0_rgba(23,23,26,.07)]')}
      aria-label={label}
      {...(current ? {'aria-current': 'true' as const} : {})}
      data-mark={mark ?? 'none'}
      isDisabled={isDisabled}
      {...(onPress ? {onPress} : {})}
    >
      <span className="flex h-8 items-center justify-center">
        {mark === 'playing' ? <QueueBars /> : mark === 'paused' ? <Glyph name="pause" size={20} />
          : starting ? <Spinner /> : (
            <span className="font-pv-mono text-[15px] font-medium text-pv-ink-3">{index}</span>
          )}
      </span>
      <span className="relative size-14 overflow-hidden rounded-lg bg-pv-placeholder text-pv-grey">
        {cover ? (
          <motion.img className="block size-14 object-cover" src={cover} alt="" loading="lazy" decoding="async"
            draggable={false} initial={false} animate={{scale: starting ? 0.94 : 1}}
            transition={reduced ? TRANSITION.reduced : TRANSITION.quick} />
        ) : (
          <span className="flex size-full items-center justify-center"><Glyph name="music" size={24} /></span>
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cx('truncate text-[17px]', current ? 'font-extrabold' : 'font-bold')}>{title}</span>
        <span className="truncate text-[15px] text-pv-ink-3">{starting ? 'Starter…' : artist}</span>
      </span>
    </AriaButton>
  );
}

/** A row's place while the queue is read: the real row's size, pulsing softly, hidden from assistive technology. */
export function QueuePlaceholder({index}: {index: number}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <div className={cx('-mx-3 grid h-[72px] grid-cols-[32px_56px_minmax(0,1fr)] items-center gap-3.5 px-3',
      index > 1 && 'shadow-[inset_0_1px_0_rgba(23,23,26,.07)]')} data-placeholder="true" aria-hidden="true">
      <span />
      <motion.span className="size-14 rounded-lg bg-pv-surface-2" initial={{opacity: 0.6}}
        {...(reduced ? {} : {animate: {opacity: [0.6, 1, 0.6]}, transition: TRANSITION.ambient()})} />
      <motion.span className="flex flex-col gap-2" initial={{opacity: 0.6}}
        {...(reduced ? {} : {animate: {opacity: [0.6, 1, 0.6]}, transition: TRANSITION.ambient()})}>
        <i className="block h-4 w-40 rounded bg-pv-surface-2" />
        <i className="block h-3.5 w-24 rounded bg-pv-surface-2" />
      </motion.span>
    </div>
  );
}

/** A line in the card instead of rows (empty queue, other account, error). */
export function QueueNote({children}: {children: ReactNode}) {
  return <p className="py-4 text-[17px] text-pv-ink-3" data-empty="true">{children}</p>;
}
