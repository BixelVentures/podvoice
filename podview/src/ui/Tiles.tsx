// The page surfaces of the design canvas's domain pages (A-Lys first; Robot, Tesla and Skærm share them): a hero for
// a domain that is not there, a toggle card (a room: a tap chooses it, its switch powers it), a choice tile (a scene:
// name and level, the chosen one dark), a device row (a lamp: dot, name, state, switch, its own slider) and a fold
// row (»Lamper ⌄«). Each press is a tap, never a drag's release (tap.ts). Colours come from the domain's tone.
import {motion, useReducedMotion} from 'motion/react';
import type {ReactNode} from 'react';
import {
  Button as AriaButton, Disclosure as AriaDisclosure, DisclosurePanel, Heading,
} from 'react-aria-components';
import {pressable} from './Button';
import {SwitchKey} from './Controls';
import type {SwitchKeyProps} from './Controls';
import {GlowMaterial} from './DotMaterial';
import {Glyph} from './glyphs';
import type {GlyphName} from './glyphs';
import {tapOnly} from './tap';
import {cx, tv} from './tv';

/** The domains whose pages tint their surfaces (K-Widget: only the state domains are tinted). */
export type TileTone = 'lys' | 'robot' | 'tesla';

const TONE: Record<TileTone, {surface: string; on: string; ring: string; mark: string; lit: string}> = {
  lys: {surface: 'bg-pv-light', on: 'text-pv-light-on', ring: 'shadow-[inset_0_0_0_1px_rgba(122,82,5,.12)]',
    mark: 'text-pv-light-dot-off', lit: 'bg-pv-light-lit'},
  robot: {surface: 'bg-pv-robot', on: 'text-pv-robot-line', ring: 'shadow-[inset_0_0_0_2px_var(--color-pv-robot-dot)]',
    mark: 'text-pv-grey', lit: 'bg-pv-robot-dot'},
  tesla: {surface: 'bg-pv-tesla', on: 'text-pv-tesla-line', ring: 'shadow-[inset_0_0_0_1px_rgba(23,23,26,.08)]',
    mark: 'text-pv-car-unknown', lit: 'bg-pv-ok'},
};

// ---- Hero --------------------------------------------------------------------------------------------------------

export interface HeroProps {
  tone: TileTone;
  /** Over the title (»Køkkenalrum · denne skærms rum«). */
  eyebrow?: string;
  title: string;
  text?: ReactNode;
  /** The hero's one key at its foot (»Opdater lys«). */
  action?: ReactNode;
  /** S 221 (one widget row) or L 458 (two rows). */
  size?: 'S' | 'L';
  className?: string;
  id?: string;
}

/** A domain's hero when the domain is not there (A-Lys »Ikke forbundet«): its tint, the quiet glow, grey words. */
export function Hero({tone, eyebrow, title, text, action, size = 'S', className, id}: HeroProps) {
  const small = size === 'S';
  const height = small ? 221 : 458;
  return (
    <section id={id} className={cx('relative flex shrink-0 flex-col overflow-hidden rounded-pv-widget font-pv',
      'shadow-pv-edge', TONE[tone].surface, small ? 'p-6' : 'p-8', className)} style={{height}}>
      <GlowMaterial height={height} className={TONE[tone].mark} />
      {eyebrow ? <span className="relative text-[17px] leading-6 font-semibold text-pv-muted">{eyebrow}</span> : null}
      <h2 className={cx('relative m-0 mt-2 leading-none font-extrabold tracking-[-0.035em] text-pv-muted',
        small ? 'text-[40px]' : 'text-[56px]')}>{title}</h2>
      {text ? <p className="relative m-0 mt-3 max-w-[460px] text-[17px] leading-6 text-pv-ink-3">{text}</p> : null}
      {action ? <div className="relative mt-auto self-start">{action}</div> : null}
    </section>
  );
}

// ---- Toggle card -------------------------------------------------------------------------------------------------

export interface ToggleCardProps {
  tone: TileTone;
  /** The small line on top (»Denne skærms rum«, »Rum«). */
  tag: string;
  name: string;
  /** The state line at the foot (»Tændt«, »Slukket«, »Status ukendt«). */
  status: string;
  /** Lit: the tint and the tone's ink. */
  on: boolean;
  /** The card the page is showing (a 3 px ink ring). */
  isSelected: boolean;
  onSelect: () => void;
  /** The card's switch (its own press; the card's press only chooses). */
  power: Omit<SwitchKeyProps, 'className'>;
  id?: string;
  [data: `data-${string}`]: string | undefined;
}

/** A-Lys's room card: 128 high; a tap anywhere chooses it, the switch at the bottom right powers it. */
export function ToggleCard({tone, tag, name, status, on, isSelected, onSelect, power, id, ...data}:
  ToggleCardProps) {
  return (
    <div {...data} id={id} data-on={on ? 'true' : 'false'} data-selected={isSelected ? 'true' : undefined}
      className={cx('relative h-32 min-w-0 overflow-hidden rounded-pv-widget font-pv text-pv-ink',
        'transition-[background-color,box-shadow] duration-500',
        on ? TONE[tone].surface : 'bg-pv-surface',
        isSelected ? 'shadow-[inset_0_0_0_3px_var(--color-pv-ink)]' : 'shadow-pv-edge')}>
      <AriaButton aria-pressed={isSelected} onPress={tapOnly(onSelect)}
        className={cx(pressable, 'absolute inset-0 flex flex-col items-start rounded-[inherit] p-6 text-left')}>
        <span className={cx('text-[15px] leading-5 font-semibold', on ? TONE[tone].on : 'text-pv-muted')}>{tag}</span>
        <span className="max-w-full truncate text-[26px] leading-8 font-extrabold tracking-[-0.015em]">{name}</span>
        <span className={cx('mt-auto text-base leading-[22px]', on ? TONE[tone].on : 'text-pv-ink-3')}>{status}</span>
      </AriaButton>
      <SwitchKey {...power} className="absolute right-3 bottom-3.5" />
    </div>
  );
}

// ---- Choice tile -------------------------------------------------------------------------------------------------

export interface ChoiceTileProps {
  tone: TileTone;
  title: string;
  /** The mono line under the title (»60 %«); none when the product does not know it. */
  meta?: string | null;
  isSelected: boolean;
  /** Chosen and on its way (the wish before HA confirms): the tile is dark and its meta line pulses. */
  isPending?: boolean;
  isDisabled?: boolean;
  onPress: () => void;
  [data: `data-${string}`]: string | undefined;
}

const choiceTile = tv({
  base: [
    pressable,
    'flex h-[72px] min-w-0 flex-col items-start justify-center gap-0.5 rounded-[20px] px-5 text-left font-pv',
    'transition-[scale,background-color,color,filter] duration-300 data-[pressed]:brightness-[.92]',
  ],
});

/** A-Lys's scene tile: 72 high, the name 19/800 and the level in mono; chosen it is dark. */
export function ChoiceTile({tone, title, meta = null, isSelected, isPending = false, isDisabled = false, onPress,
  ...data}: ChoiceTileProps) {
  return (
    <AriaButton {...data} aria-pressed={isSelected} isDisabled={isDisabled} onPress={tapOnly(onPress)}
      data-sending={isPending ? 'true' : undefined}
      className={cx(choiceTile(), isSelected ? 'bg-pv-ink text-pv-on-dark' : cx(TONE[tone].surface, 'text-pv-ink',
        TONE[tone].ring))}>
      <span className="max-w-full truncate text-[19px] leading-6 font-extrabold">{title}</span>
      {meta ? (
        <span className={cx('font-pv-mono text-[15px] leading-5 font-medium opacity-75',
          isPending && 'animate-pv-pulse motion-reduce:animate-none')}>{meta}</span>
      ) : null}
    </AriaButton>
  );
}

// ---- Device row --------------------------------------------------------------------------------------------------

export interface DeviceRowProps {
  tone: TileTone;
  name: string;
  /** The state under the name (»Tændt«, »Slukket«, »Status ukendt«, »Ikke forbundet«). */
  status: string;
  /** The dot: lit, off, or not known (grey). */
  dot: 'on' | 'off' | 'unknown';
  power: Omit<SwitchKeyProps, 'className'>;
  /** Under the row, indented (the lamp's own slider). */
  children?: ReactNode;
  [data: `data-${string}`]: string | undefined;
}

/** A-Lys's lamp: a 48 row (dot, name 17/700, state 15 grey, switch) and its own control under it. */
export function DeviceRow({tone, name, status, dot, power, children, ...data}: DeviceRowProps) {
  return (
    <div {...data} className="flex min-w-0 flex-col gap-1 border-t border-pv-ink/7 pt-2 pb-3 font-pv text-pv-ink">
      <div className="flex h-12 items-center gap-3">
        <i aria-hidden="true" className={cx('block size-3 shrink-0 rounded-full transition-colors duration-300',
          dot === 'on' ? TONE[tone].lit : 'bg-pv-ink/16')} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[17px] leading-[22px] font-bold">{name}</span>
          <span className="truncate text-[15px] leading-5 text-pv-ink-3">{status}</span>
        </span>
        <SwitchKey {...power} className="-mr-1.5" />
      </div>
      {children ? <div className="pl-6">{children}</div> : null}
    </div>
  );
}

/** A device row's quiet second line when there is no control for it (a lamp that only switches). */
export function DeviceNote({children}: {children: ReactNode}) {
  return <span className="flex h-11 items-center font-pv text-[15px] leading-5 text-pv-ink-3">{children}</span>;
}

// ---- Fold row ----------------------------------------------------------------------------------------------------

export interface FoldRowProps {
  title: string;
  icon?: GlyphName;
  /** Mono, before the chevron (»2 stk.«). */
  count?: string;
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: ReactNode;
  className?: string;
}

/** A-Lys's »Lamper« fold: a 56 row with a line above it; the chevron turns (200 ms) and the panel opens in place. */
export function FoldRow({title, icon, count, isExpanded, onExpandedChange, children, className}: FoldRowProps) {
  const reduced = useReducedMotion() ?? false;
  return (
    <AriaDisclosure isExpanded={isExpanded} onExpandedChange={tapOnly(onExpandedChange)}
      className={cx('flex min-w-0 flex-col', className)}>
      <Heading className="m-0">
        <AriaButton slot="trigger" className={cx(pressable, 'flex h-14 w-full items-center gap-3 border-t',
          'border-pv-ink/7 text-left font-pv text-[17px] leading-6 font-semibold text-pv-ink')}>
          {icon ? <Glyph name={icon} size={22} stroke={1.6} /> : null}
          <span className="flex-1">{title}</span>
          {count ? <span className="font-pv-mono text-[15px] font-medium text-pv-ink-3">{count}</span> : null}
          <motion.span className="inline-flex" initial={false} animate={{rotate: isExpanded ? 180 : 0}}
            transition={reduced ? {duration: 0} : {type: 'tween', duration: 0.2, ease: 'easeOut'}}>
            <Glyph name="chevronDown" size={20} stroke={2} />
          </motion.span>
        </AriaButton>
      </Heading>
      <DisclosurePanel>{children}</DisclosurePanel>
    </AriaDisclosure>
  );
}
