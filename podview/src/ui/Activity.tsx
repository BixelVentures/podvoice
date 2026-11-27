// Find musik D's activity pieces (design canvas »Find musik koncepter«, Stemning.dc.html): the »Hvad skal musikken
// til?« tile (84 high, radius 20, the title 16/700 and a small 13/600 hint), the results (a 22/800 heading with the
// »AI-valgt« badge when the picks are the AI's, then three cards: a 176-px cover, the title 18/700 and the playlist's
// meta 15) and a »Jeres seneste stemninger« row (72 high: a 48 colour square, the title 17/600 and the time 14).
// Presentational: the screen gives the words and the presses.
import {motion, useReducedMotion} from 'motion/react';
import type {ReactNode} from 'react';
import {Button as AriaButton, ToggleButton as AriaToggleButton} from 'react-aria-components';
import {TRANSITION} from '../lib/motion/tokens';
import {Button, pressable} from './Button';
import {ShelfCover} from './Shelf';
import {tapOnly} from './tap';
import {cx} from './tv';

export interface ActivityTileProps {
  title: string;
  /** The small line under the title, from real context only (»Nu: 17–19«, »Fredag«); '' for none. */
  hint?: string;
  /** The tile that fits now: ringed, not chosen. */
  suggested?: boolean;
  isSelected: boolean;
  onChange: (selected: boolean) => void;
}

/** One activity: a toggle; chosen is dark, the suggestion is ringed. It answers in the tap's own frame. */
export function ActivityTile({title, hint = '', suggested = false, isSelected, onChange}: ActivityTileProps) {
  return (
    <AriaToggleButton
      className={cx(pressable, 'flex h-[84px] min-w-0 flex-col items-center justify-center gap-1 rounded-[20px]',
        'px-2 text-center text-[16px] leading-[normal] font-bold',
        isSelected ? 'bg-pv-ink text-white' : 'bg-pv-surface text-pv-ink',
        suggested && !isSelected && 'shadow-[inset_0_0_0_2px_var(--color-pv-ink)]')}
      data-suggested={suggested ? 'true' : undefined}
      isSelected={isSelected}
      onChange={tapOnly(onChange)}
    >
      <span className="max-w-full truncate">{title}</span>
      {hint ? <span className="max-w-full truncate text-[13px] font-semibold opacity-80">{hint}</span> : null}
    </AriaToggleButton>
  );
}

export interface ActivityResultsProps {
  id: string;
  title: string;
  /** The picks are the AI's: the »AI-valgt« badge by the heading. */
  ai?: boolean;
  /** The product's own status line (a failure, nothing found) and its »Prøv igen«. */
  status?: string;
  retry?: (() => void) | undefined;
  busy?: boolean;
  children: ReactNode;
}

/** The three result cards under their heading; while busy, three calm card places keep the height. */
export function ActivityResults({id, title, ai = false, status, retry, busy = false, children}: ActivityResultsProps) {
  const reduced = useReducedMotion();
  return (
    <motion.section
      className="flex min-w-0 flex-col gap-3 [transform:translateZ(0)]"
      aria-labelledby={`activity-${id}`}
      initial={reduced ? false : {opacity: 0}}
      animate={{opacity: 1}}
      transition={TRANSITION.fade}
    >
      <div className="flex items-baseline gap-2.5">
        <h2 id={`activity-${id}`} className="text-[22px] leading-[1.2] font-extrabold tracking-[-0.4px]">{title}</h2>
        {ai ? (
          <span className="flex-none rounded-[11px] bg-pv-ai-tint px-[9px] py-[3px] text-[14px] leading-[normal]
            font-bold text-pv-ai-ink" data-badge="ai">
            AI-valgt
          </span>
        ) : null}
      </div>
      {status ? (
        <p className="text-pv-body leading-[normal] text-pv-ink-2" role="status">
          {status}{' '}
          {retry ? <Button variant="sekundaer" size={44} onPress={retry}>Prøv igen</Button> : null}
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-4 empty:hidden" role="group" aria-label={title} aria-busy={busy}>
        {busy && !status ? [0, 1, 2].map(index => <ActivityCardSpace key={index} />) : children}
      </div>
    </motion.section>
  );
}

export interface ActivityCardProps {
  title: string;
  /** The playlist's meta (»Playliste«, or its owner); »Spiller« while it plays. */
  line: string;
  cover: string | null;
  label: string;
  busy?: boolean;
  playing?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/** One result: a 176-px cover on a 24-radius card, the title and the meta; a tap starts it. */
export function ActivityCard({title, line, cover, label, busy = false, playing = false, disabled = false,
  onPress}: ActivityCardProps) {
  return (
    <AriaButton
      className={cx(pressable, 'group/tile flex min-w-0 flex-col gap-2.5 rounded-[24px] bg-pv-surface p-3.5',
        'text-left text-pv-ink')}
      data-kind="playlist"
      data-busy={busy ? 'true' : undefined}
      data-playing={playing ? 'true' : undefined}
      aria-label={label}
      isDisabled={disabled}
      onPress={tapOnly(onPress)}
    >
      <ShelfCover src={cover} size="fill" className="group-data-[busy]/tile:opacity-60" />
      <strong className="truncate text-[18px] leading-[normal] font-bold">{title}</strong>
      <span className={cx('truncate text-[15px] leading-[normal] text-pv-ink-2', playing && 'font-bold text-pv-ink')}>
        {playing ? 'Spiller' : line}
      </span>
    </AriaButton>
  );
}

/** A result card's place while the picks are read: the card's surface and size, without content. */
export function ActivityCardSpace() {
  return (
    <span className="flex flex-col gap-2.5 rounded-[24px] bg-pv-surface p-3.5" aria-hidden="true">
      <span className="block h-[176px] rounded-[16px] bg-pv-surface-2" />
      <strong className="text-[18px] leading-[normal]">&nbsp;</strong>
      <span className="text-[15px] leading-[normal]">&nbsp;</span>
    </span>
  );
}

export interface ActivityHistoryRowProps {
  title: string;
  when: string;
  /** The activity's colour square. */
  colour: string;
  onPress: () => void;
}

/** One of »Jeres seneste stemninger«: a tap chooses that activity again. */
export function ActivityHistoryRow({title, when, colour, onPress}: ActivityHistoryRowProps) {
  return (
    <AriaButton
      className={cx(pressable, 'flex h-[72px] items-center gap-3.5 rounded-[18px] bg-pv-surface px-4 text-left',
        'text-[17px] leading-[normal] font-semibold text-pv-ink')}
      onPress={tapOnly(onPress)}
    >
      <span className="size-12 flex-none rounded-[12px]" style={{background: colour}} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="flex-none text-[14px] text-pv-ink-3">{when}</span>
    </AriaButton>
  );
}
