// Find musik B's pieces (design canvas »Find musik koncepter«, Hylder.dc.html): the quick-pick grid's tile (64 high,
// the cover square at the left, the title and an »AI-valgt« badge), a shelf (its 22/800 title, the »AI-valgt« badge
// and why, then one horizontal row of 136-px cover tiles that scrolls and snaps), the cover tile itself, and the
// 56-px search field above the shelves (PARITY decision 5). Presentational: the screen gives the items and presses.
import {motion, useReducedMotion} from 'motion/react';
import {useId, useState} from 'react';
import type {ReactNode, SyntheticEvent} from 'react';
import {Button as AriaButton, Input, SearchField} from 'react-aria-components';
import {TRANSITION} from '../lib/motion/tokens';
import {Button, pressable} from './Button';
import {Glyph} from './glyphs';
import {QueueBars} from './Queue';
import {tapOnly} from './tap';
import {cx} from './tv';

/** A cover that fades in (opacity only) once decoded; until then the tile's own surface shows. */
export function ShelfCover({src, size = 136, round = false, className}: {src: string | null; size?: 64 | 136;
  round?: boolean; className?: string}) {
  const [ready, setReady] = useState(false);
  const reduced = useReducedMotion();
  return (
    <span className={cx('relative block flex-none overflow-hidden bg-pv-surface-2 [transform:translateZ(0)]',
      size === 136 ? 'size-[136px]' : 'size-16', round ? 'rounded-full' : size === 136 ? 'rounded-[16px]' : '',
      className)}>
      {src ? (
        <motion.img
          className="pointer-events-none block size-full object-cover"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          initial={false}
          animate={{opacity: ready ? 1 : 0}}
          transition={reduced ? TRANSITION.reduced : TRANSITION.fade}
          onLoad={() => {
            setReady(true);
          }}
        />
      ) : (
        // No cover: a calm grey note on the tile's own surface (as the player's empty cover).
        <span className="flex size-full items-center justify-center text-pv-grey" aria-hidden="true">
          <Glyph name="disc" size={size === 136 ? 48 : 28} stroke={1.4} />
        </span>
      )}
    </span>
  );
}

export interface ShelfTileProps {
  title: string;
  line: string;
  /** The line is the »AI-valgt« mark (bold). */
  ai?: boolean;
  cover: string | null;
  label: string;
  describedBy?: string | undefined;
  busy?: boolean;
  /** It plays now (the speaker confirmed the start): the queue's moving bars and »Spiller« (G7 #14). */
  playing?: boolean;
  disabled?: boolean;
  kind?: string;
  onPress: () => void;
}

// The playing mark on a tile: the queue's three bars in a white disc on the cover's corner.
function PlayingMark({size}: {size: 64 | 136}) {
  return (
    <span className={cx('absolute flex items-center justify-center rounded-full bg-pv-surface',
      'shadow-[0_4px_12px_-6px_rgba(23,23,26,.35)]', size === 136 ? 'right-2 bottom-2 size-9' : 'right-1 bottom-1 size-7')}
    data-playing-mark="">
      <span className={size === 136 ? '' : 'origin-center scale-[.8]'}><QueueBars /></span>
    </span>
  );
}

/** One 136-px cover with its title and one line; a start on its way dims the cover. */
export function ShelfTile({title, line, ai = false, cover, label, describedBy, busy = false, playing = false,
  disabled = false, kind, onPress}: ShelfTileProps) {
  return (
    <AriaButton
      className={cx(pressable, 'group/tile flex w-[136px] flex-none snap-start flex-col gap-2 text-left text-pv-ink')}
      data-kind={kind}
      data-busy={busy ? 'true' : undefined}
      data-playing={playing ? 'true' : undefined}
      aria-label={label}
      {...(describedBy ? {'aria-describedby': describedBy} : {})}
      isDisabled={disabled}
      onPress={tapOnly(onPress)}
    >
      <span className="relative">
        <ShelfCover src={cover} className="group-data-[busy]/tile:opacity-60" />
        {playing ? <PlayingMark size={136} /> : null}
      </span>
      <strong className="truncate text-[16px] leading-[1.2] font-bold">{title}</strong>
      <span className={cx('-mt-1 truncate text-[14px] leading-[normal] text-pv-ink-3', (ai || playing) && 'font-bold',
        playing && 'text-pv-ink')}>
        {playing ? 'Spiller' : line}
      </span>
    </AriaButton>
  );
}

/** A tile's place while its shelf fetches: one card's height, invisible (the page does not shrink and spring back). */
export function ShelfTileSpace() {
  return (
    <span className="invisible flex w-[136px] flex-none flex-col gap-2" aria-hidden="true">
      <span className="block size-[136px]" />
      <strong className="text-[16px] leading-[1.2]">&nbsp;</strong>
      <span className="-mt-1 text-[14px] leading-[normal]">&nbsp;</span>
    </span>
  );
}

export interface ShelfProps {
  id: string;
  title: string;
  ai?: boolean;
  why?: string | undefined;
  /** The product's own status line (a failure, nothing found) and its »Prøv igen«. */
  status?: string;
  retry?: (() => void) | undefined;
  busy?: boolean;
  /** Opened under a chip (Stemning/Humør): the chip is its title, so the heading is for assistive technology only,
   *  and the row slides in under the chips. */
  bare?: boolean;
  /** The row's tiles; a function gets the ids that describe an AI tile (the badge and why). */
  children: ReactNode | ((describedBy: string | undefined) => ReactNode);
}

export function Shelf({id, title, ai = false, why, status, retry, busy, bare = false, children}: ShelfProps) {
  const reduced = useReducedMotion();
  const uid = useId();
  const described = ai && why ? `${uid}-badge ${uid}-why` : undefined;
  return (
    <motion.section
      className="flex min-w-0 flex-col gap-2.5 [transform:translateZ(0)]"
      aria-labelledby={`find-${id}`}
      initial={reduced ? false : bare ? {opacity: 0, y: -12} : {opacity: 0}}
      animate={{opacity: 1, y: 0}}
      transition={bare ? {...TRANSITION.quick, opacity: TRANSITION.fade} : TRANSITION.fade}
    >
      <div className={cx('flex flex-col gap-1', bare && 'sr-only')}>
        <div className="flex items-baseline gap-2.5">
          <h2 id={`find-${id}`} className="text-[22px] leading-[1.2] font-extrabold tracking-[-0.4px]">{title}</h2>
          {ai ? (
            <span id={`${uid}-badge`} className="flex-none rounded-[11px] bg-pv-ai-tint px-[9px] py-[3px] text-[14px]
              leading-[normal] font-bold text-pv-ai-ink" data-badge="ai">
              AI-valgt
            </span>
          ) : null}
        </div>
        {why ? <p id={`${uid}-why`} className="text-[15px] leading-[1.35] text-pv-ink-2">{why}</p> : null}
      </div>
      {status ? (
        <p className="text-pv-body leading-[normal] text-pv-ink-2" role="status">
          {status}{' '}
          {retry ? <Button variant="sekundaer" size={44} onPress={retry}>Prøv igen</Button> : null}
        </p>
      ) : null}
      <div className="flex gap-pv-s2 overflow-x-auto overflow-y-hidden overscroll-x-contain snap-x snap-mandatory
        [scrollbar-width:none] empty:hidden [&::-webkit-scrollbar]:hidden" role="group" aria-label={title}
        aria-busy={busy}>
        {typeof children === 'function' ? children(described) : children}
      </div>
    </motion.section>
  );
}

export interface QuickPickProps {
  title: string;
  /** »AI-valgt« (with its why, shortened) or ''. */
  badge: string;
  cover: string | null;
  label: string;
  busy?: boolean;
  /** It plays now: the playing mark on the cover (G7 #14). */
  playing?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/** A quick pick (the grid of six at the top of Find musik): 64 high, the cover at the left, title and badge. */
export function QuickPick({title, badge, cover, label, busy = false, playing = false, disabled = false, onPress}:
  QuickPickProps) {
  return (
    <AriaButton
      className={cx(pressable, 'group/tile flex h-16 min-w-0 items-center gap-3 overflow-hidden rounded-[14px]',
        'bg-pv-surface pr-3 text-left text-pv-ink')}
      data-busy={busy ? 'true' : undefined}
      data-playing={playing ? 'true' : undefined}
      aria-label={label}
      isDisabled={disabled}
      onPress={tapOnly(onPress)}
    >
      <span className="relative flex-none">
        <ShelfCover src={cover} size={64} className="group-data-[busy]/tile:opacity-60" />
        {playing ? <PlayingMark size={64} /> : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[16px] leading-5 font-bold">{title}</span>
        {playing ? <span className="truncate text-[12px] leading-4 font-bold">Spiller</span>
          : badge ? <span className="truncate text-[12px] leading-4 font-bold text-pv-ai-ink">{badge}</span> : null}
      </span>
    </AriaButton>
  );
}

/** The 56-px search field with its »Søg« key (one search per submitted query). */
export function SearchBox({value, onChange, onSubmit, onClear, label, placeholder}: {value: string;
  onChange: (value: string) => void; onSubmit: () => void; onClear: () => void; label: string; placeholder: string}) {
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form className="flex items-center gap-pv-s2" role="search" aria-label="Søg efter musik" onSubmit={submit}>
      <SearchField className="min-w-0 flex-1" aria-label={label} value={value} onChange={onChange} onClear={onClear}>
        <Input className="h-14 w-full rounded-pv-pill bg-pv-surface px-6 text-[17px] text-pv-ink shadow-pv-edge
          outline-none placeholder:text-pv-ink-3 focus-visible:shadow-[inset_0_0_0_2px_var(--color-pv-ink)]
          [&::-webkit-search-cancel-button]:hidden" placeholder={placeholder} maxLength={160} />
      </SearchField>
      <Button variant="primaer" size={56} type="submit" isDisabled={!value.trim()}>Søg</Button>
    </form>
  );
}
