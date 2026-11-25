// The domain pages' own surfaces (A-Robot, A-Tesla, Robot-Sticky*): the status hero with its art, eyebrow, big
// title, sub line or compact notice and its foot; the »Mere ▾« key and what it opens (a drawer under the hero, or a
// menu under the sticky line); the sticky action line that slides down from the topbar when the hero has scrolled
// away; the robot's progress cells; the room chip with its dot; the options card and its rows (a main choice and the
// fine-tuning under it); the −/+ stepper; a maintenance meter and an event row. Each press is a tap, never a drag's
// release (tap.ts); colours come from the tokens.
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import type {ReactNode, Ref} from 'react';
import {Button as AriaButton} from 'react-aria-components';
import {TRANSITION} from '../lib/motion/tokens';
import {Button, pressable} from './Button';
import {Glyph} from './glyphs';
import type {GlyphName} from './glyphs';
import {NoticeSlot} from './Notice';
import type {ShownNotice} from './Notice';
import {tapOnly} from './tap';
import {cx, tv} from './tv';

// The canvas's own ease for things that arrive from above (the Basen fold, the sticky line, the menu).
const ARRIVE = [0.2, 0.9, 0.3, 1] as const;

// ---- Status hero -------------------------------------------------------------------------------------------------

/** The hero's surface: the domain's tint, a little warmer while the robot works or the car is live. */
export type HeroSurface = 'robot' | 'robotActive' | 'tesla' | 'teslaLive';
const SURFACE: Record<HeroSurface, string> = {
  robot: 'bg-pv-robot',
  robotActive: 'bg-pv-robot-active',
  tesla: 'bg-pv-tesla',
  teslaLive: 'bg-pv-tesla-live',
};
/** The title's colour: ink, red for a fault, grey for an unknown state, Tesla's deep green while live. */
export type HeroTitleTone = 'ink' | 'danger' | 'muted' | 'teslaOn';
const TITLE: Record<HeroTitleTone, string> = {
  ink: 'text-pv-ink',
  danger: 'text-pv-danger',
  muted: 'text-pv-ink-2',
  teslaOn: 'text-pv-tesla-on',
};

const hero = tv({
  slots: {
    root: 'relative flex shrink-0 flex-col overflow-hidden rounded-pv-widget font-pv text-pv-ink shadow-pv-edge',
    head: 'relative flex justify-between',
    eyebrow: 'text-[15px] font-semibold text-pv-ink-3',
    title: 'm-0 font-extrabold',
    sub: 'm-0 font-semibold text-pv-ink-2',
  },
  variants: {
    variant: {
      robot: {head: '-mt-1.5 h-8 items-center', title: 'relative mt-2 leading-none tracking-[-0.035em]',
        sub: 'relative mt-3 h-7 truncate text-[19px] leading-7'},
      tesla: {root: 'px-7 py-6', head: 'items-baseline',
        title: 'text-[40px] leading-[1.05] tracking-[-0.03em]', sub: 'mt-1.5 text-[17px] leading-6'},
    },
    size: {S: {}, L: {}},
  },
  compoundVariants: [
    {variant: 'robot', size: 'S', class: {root: 'p-6', title: 'text-[40px]'}},
    {variant: 'robot', size: 'L', class: {root: 'p-8', title: 'text-[56px]'}},
  ],
});

export interface StatusHeroProps {
  /** A-Robot's anatomy or A-Tesla's (padding, title and sub measures). */
  variant: 'robot' | 'tesla';
  surface: HeroSurface;
  /** S 221 (one widget row) or L 458 (two rows). */
  size?: 'S' | 'L';
  /** The dot art, absolutely placed (HeroArcs, HeroCar). */
  art?: ReactNode;
  /** The quiet line over the title (»Ved basen«, »Tilsluttet«). */
  eyebrow: string;
  /** Top right: the K-Fresh chip, or the model's name. */
  corner?: ReactNode;
  title: string;
  titleTone?: HeroTitleTone;
  /** The line under the title (battery, area, time; range and cabin). */
  sub?: string;
  /** A compact K-Notice in the sub line's place (Robot) or under it (Tesla). */
  notice?: ShownNotice | null;
  /** Tesla's big number at the top right. */
  big?: ReactNode;
  /** The hero's foot: actions and progress (Robot), metrics (Tesla). */
  footer?: ReactNode;
  id?: string;
  'aria-label'?: string;
  ref?: Ref<HTMLElement>;
  [data: `data-${string}`]: string | undefined;
}

/** A domain page's hero (A-Robot, A-Tesla): tinted, its dot art at the right, the state as a big title. */
export function StatusHero({variant, surface, size = 'S', art, eyebrow, corner, title, titleTone = 'ink', sub,
  notice = null, big, footer, ref, ...rest}: StatusHeroProps) {
  const slots = hero({variant, size});
  const height = size === 'S' ? 221 : 458;
  const subLine = sub ? <p className={slots.sub()}>{sub}</p> : null;
  const noticeLine = notice ? (
    <div className={cx('relative h-10', variant === 'robot' ? 'mt-1.5' : 'z-1 mt-3')}>
      <NoticeSlot compact notice={notice} />
    </div>
  ) : null;
  return (
    <section {...rest} ref={ref} className={slots.root({class: SURFACE[surface]})} style={{height}}>
      {art}
      <div className={slots.head()}>
        <span className={slots.eyebrow()}>{eyebrow}</span>
        {corner}
      </div>
      {variant === 'robot' ? (
        <>
          <h2 className={slots.title({class: TITLE[titleTone]})} aria-live="polite">{title}</h2>
          {noticeLine ?? subLine}
        </>
      ) : (
        <>
          <div className="relative z-1 mt-2 flex max-w-[470px] flex-col">
            <h2 className={slots.title({class: TITLE[titleTone]})} aria-live="polite">{title}</h2>
            {subLine}
          </div>
          {noticeLine}
        </>
      )}
      {big}
      {footer ? <div className={cx('relative mt-auto', variant === 'tesla' && 'z-1')}>{footer}</div> : null}
    </section>
  );
}

/** A-Tesla's big number at the hero's top right (»81 %«), in mono. */
export function HeroBig({value, unit = ' %', tone = 'ink'}: {value: string; unit?: string;
  tone?: 'ink' | 'muted' | 'teslaOn'}) {
  return (
    <span className={cx('absolute top-[60px] right-7 font-pv-mono text-[64px] leading-[0.85] font-medium',
      'tracking-[-0.07em] whitespace-nowrap', tone === 'ink' ? 'text-pv-ink' : tone === 'muted' ? 'text-pv-ink-3'
        : 'text-pv-tesla-on')}>
      {value}<span className="text-[32px]">{unit}</span>
    </span>
  );
}

/** A-Tesla's metrics at the hero's foot: the value in mono, its name quiet beside it. */
export function HeroMetrics({items}: {items: readonly {value: string; label: string}[]}) {
  if (!items.length) return null;
  return (
    <dl className="m-0 flex gap-7">
      {items.map(item => (
        <div key={item.label} className="flex items-baseline gap-2">
          <dd className="m-0 font-pv-mono text-[22px] font-medium tracking-[-0.04em] whitespace-nowrap">{item.value}</dd>
          <dt className="order-1 text-[15px] text-pv-ink-3">{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** A-Robot's progress: 25 cells over 220 px and the share in mono (only from a reported value, never a guess). */
export function ProgressCells({percent, label}: {percent: number; label: string}) {
  const filled = Math.round(Math.max(0, Math.min(100, percent)) / 4);
  return (
    <div className="flex items-center gap-3">
      <div className="grid w-[220px] grid-cols-[repeat(25,minmax(0,1fr))] gap-0.5" role="img" aria-label={label}>
        {Array.from({length: 25}, (_, index) => (
          <i key={index} className={cx('block h-2 rounded-[2px]',
            index < filled ? 'bg-pv-robot-progress' : 'bg-pv-robot-progress/16')} />
        ))}
      </div>
      <span className="font-pv-mono text-base font-medium" aria-hidden="true">{label}</span>
    </div>
  );
}

// ---- »Mere ▾« ----------------------------------------------------------------------------------------------------

export interface MoreKeyProps {
  isExpanded: boolean;
  onPress: () => void;
  /** The hero's key (56, ringed, white when open) or the sticky line's K-Btn kant 44. */
  size?: 56 | 44;
  /** The id of what it opens. */
  controls?: string;
  label?: string;
}

/** »Mere ▾«: the hero's second key; the chevron turns when what it opens is open. */
export function MoreKey({isExpanded, onPress, size = 56, controls, label = 'Mere'}: MoreKeyProps) {
  const reduced = useReducedMotion() ?? false;
  return (
    <AriaButton onPress={tapOnly(onPress)} aria-expanded={isExpanded} {...(controls ? {'aria-controls': controls} : {})}
      className={cx(pressable, 'inline-flex shrink-0 items-center gap-2 rounded-pv-pill font-pv font-semibold',
        'text-pv-ink data-[pressed]:brightness-[.92]',
        size === 56 ? 'h-14 pr-[18px] pl-[22px] text-[17px] shadow-[inset_0_0_0_1.5px_rgba(23,23,26,.14)]'
          : 'h-11 pr-3.5 pl-[18px] text-base shadow-[inset_0_0_0_1.5px_rgba(23,23,26,.2)]',
        isExpanded && size === 56 ? 'bg-pv-entry' : 'bg-transparent')}>
      {label}
      <motion.span className="inline-flex" initial={false} animate={{rotate: isExpanded ? 180 : 0}}
        transition={reduced ? {duration: 0} : {type: 'tween', duration: 0.24, ease: 'easeOut'}}>
        <Glyph name="chevronDown" size={18} stroke={2.2} />
      </motion.span>
    </AriaButton>
  );
}

// ---- What »Mere ▾« opens -----------------------------------------------------------------------------------------

/** One action in »Mere«: plain (white, ringed), fare (Afslut) or amber (a stop that is running, »Stop moppevask«). */
export interface MenuAction {
  id: string;
  label: string;
  icon?: GlyphName;
  tone?: 'plain' | 'fare' | 'amber';
  onPress: () => void;
  isDisabled?: boolean;
  /** Sent and waiting for the device (styling only; it stays pressable). */
  busy?: boolean;
}
export interface MenuGroup {
  id: string;
  title: string;
  actions: readonly MenuAction[];
}

const drawerAction = tv({
  base: [pressable, 'inline-flex h-14 items-center gap-2.5 rounded-pv-pill font-pv text-base font-semibold',
    'data-[pressed]:brightness-[.92] data-[busy]:animate-pv-pulse motion-reduce:data-[busy]:animate-none'],
  variants: {
    tone: {
      plain: 'bg-pv-entry text-pv-ink shadow-[inset_0_0_0_1.5px_rgba(23,23,26,.14)]',
      fare: 'bg-pv-entry text-pv-danger shadow-[inset_0_0_0_2px_var(--color-pv-danger)]',
      amber: 'bg-pv-notice-action text-pv-notice-action-ink shadow-[inset_0_0_0_2px_var(--color-pv-warning)]',
    },
    icon: {true: 'pr-[22px] pl-4', false: 'px-[22px]'},
  },
});

function arrive(reduced: boolean, distance: number) {
  return {
    initial: reduced ? {opacity: 0} : {opacity: 0, y: -distance},
    animate: {opacity: 1, y: 0},
    exit: {opacity: 0, transition: reduced ? TRANSITION.reduced : {duration: 0.22}},
    transition: reduced ? TRANSITION.reduced : {type: 'tween' as const, duration: 0.28, ease: ARRIVE},
  };
}

/** A-Robot's »Mere« fold under the hero: a group per kind (Rengøring, Basen), each a quiet label over its keys. It
 * arrives from above over 280 ms. */
export function ActionDrawer({id, groups, isOpen}: {id: string; groups: readonly MenuGroup[]; isOpen: boolean}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <AnimatePresence initial={false}>
      {isOpen && groups.length ? (
        <motion.div key="drawer" id={id} {...arrive(reduced, 12)} role="group" aria-label="Flere handlinger"
          className="-mt-5 flex flex-col gap-3 rounded-[20px] bg-pv-surface p-4 font-pv shadow-pv-edge">
          {groups.map((group, index) => (
            <div key={group.id} className="flex flex-col gap-3" role="group" aria-label={group.title}>
              {index ? <i className="block h-px bg-pv-ink/8" aria-hidden="true" /> : null}
              <span className="text-[15px] font-semibold text-pv-ink-3">{group.title}</span>
              <div className="flex flex-wrap gap-2">
                {group.actions.map(action => (
                  <AriaButton key={action.id} onPress={tapOnly(action.onPress)} data-action-id={action.id}
                    isDisabled={action.isDisabled ?? false} data-busy={action.busy ? 'true' : undefined}
                    className={drawerAction({tone: action.tone ?? 'plain', icon: !!action.icon})}>
                    {action.icon ? <Glyph name={action.icon} size={22} stroke={1.8} /> : null}
                    {action.label}
                  </AriaButton>
                ))}
              </div>
            </div>
          ))}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Robot-Sticky-Mere: the same groups as a menu right under the sticky line (K-Btn 44, full width). */
export function ActionMenu({id, groups, isOpen, className}: {id: string; groups: readonly MenuGroup[];
  isOpen: boolean; className?: string}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <AnimatePresence initial={false}>
      {isOpen && groups.length ? (
        <motion.div key="menu" id={id} {...arrive(reduced, 8)} role="group" aria-label="Flere handlinger"
          className={cx('flex w-[352px] flex-col gap-2 rounded-[20px] bg-pv-surface p-4 font-pv',
            'shadow-[0_24px_48px_-20px_rgba(23,23,26,.55),inset_0_0_0_1px_rgba(23,23,26,.08)]', className)}>
          {groups.map(group => (
            <div key={group.id} className="flex flex-col gap-2" role="group" aria-label={group.title}>
              <span className="px-1 pt-1.5 text-[15px] font-bold text-pv-ink-3">{group.title}</span>
              {group.actions.map(action => (
                <Button key={action.id} size={44} variant={action.tone === 'fare' ? 'fare' : 'sekundaer'}
                  className={cx('w-full', action.tone === 'amber' && 'bg-pv-notice-action text-pv-notice-action-ink')}
                  isDisabled={action.isDisabled ?? false} busy={action.busy ?? false} data-action-id={action.id}
                  onPress={action.onPress}>
                  {action.label}
                </Button>
              ))}
            </div>
          ))}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ---- Sticky action line ------------------------------------------------------------------------------------------

export interface StickyLineProps {
  /** The hero has scrolled out: the line is down. */
  isShown: boolean;
  /** The domain's tint. */
  surface: 'robot' | 'tesla';
  /** The status dot's colour (the domain's dot, red on a fault, grey when unknown). */
  dot: 'robot' | 'danger' | 'grey' | 'ok';
  title: string;
  sub?: string;
  /** The hero's primary action, as K-Btn 44. */
  primary?: ReactNode;
  /** »Mere ▾« and what it opens (an ActionMenu, placed under the line by the caller). */
  more?: ReactNode;
  label: string;
  className?: string;
}

const DOTS = {robot: 'bg-pv-robot-dot', danger: 'bg-pv-danger', grey: 'bg-pv-grey', ok: 'bg-pv-ok'} as const;

/** Robot-Sticky: a 72-px line under the topbar (radius 0 above, 20 below) that slides down over 240 ms when the hero
 * scrolls out, and up again when it returns. It repeats the hero's status, its primary action and »Mere ▾«. */
export function StickyLine({isShown, surface, dot, title, sub, primary, more, label, className}: StickyLineProps) {
  const reduced = useReducedMotion() ?? false;
  return (
    <AnimatePresence initial={false}>
      {isShown ? (
        <motion.div key="sticky" role="region" aria-label={label}
          className={cx('flex h-[72px] items-center gap-4 rounded-b-[20px] pr-3 pl-5 font-pv text-pv-ink',
            'shadow-[0_14px_28px_-18px_rgba(23,23,26,.55),inset_0_0_0_1px_rgba(23,23,26,.06)]',
            surface === 'robot' ? 'bg-pv-robot' : 'bg-pv-tesla', className)}
          initial={reduced ? {opacity: 0} : {y: '-100%', opacity: 0}}
          animate={{y: 0, opacity: 1}}
          exit={reduced ? {opacity: 0} : {y: '-100%', opacity: 0}}
          transition={reduced ? TRANSITION.reduced : {type: 'tween', duration: 0.24, ease: 'easeOut'}}>
          <span className={cx('size-3 flex-none rounded-full', DOTS[dot])} aria-hidden="true" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xl leading-[26px] font-extrabold">{title}</span>
            {sub ? <span className="truncate text-[15px] leading-5 text-pv-ink-3">{sub}</span> : null}
          </span>
          {primary}
          {more}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ---- Room chip ---------------------------------------------------------------------------------------------------

/** A-Robot's room: 64 high, a dot and the name; chosen it takes the robot's tint, a 2-px ring and a red dot. Static
 * (»Denne tur«), it is the same look without a press. */
export function DotChip({label, isSelected, onPress, isDisabled = false, isStatic = false, ...data}: {
  label: string;
  isSelected: boolean;
  onPress?: () => void;
  isDisabled?: boolean;
  isStatic?: boolean;
  [data: `data-${string}`]: string | undefined;
}) {
  const look = cx('flex h-16 min-w-0 items-center gap-2.5 rounded-[20px] px-[18px] text-left font-pv',
    'text-base font-semibold text-pv-ink transition-[scale,background-color,box-shadow] duration-300',
    isSelected ? 'bg-pv-robot shadow-[inset_0_0_0_2px_var(--color-pv-robot-dot)]' : 'bg-pv-surface');
  const content = (
    <>
      <i aria-hidden="true" className={cx('block size-2.5 flex-none rounded-full transition-colors duration-300',
        isSelected ? 'bg-pv-robot-dot' : 'bg-pv-ink/20')} />
      <span className="min-w-0 truncate">{label}</span>
    </>
  );
  if (isStatic) return <span {...data} className={look}>{content}</span>;
  return (
    <AriaButton {...data} aria-pressed={isSelected} isDisabled={isDisabled}
      {...(onPress ? {onPress: tapOnly(onPress)} : {})}
      className={cx(pressable, look, 'data-[pressed]:brightness-[.92]')}>
      {content}
    </AriaButton>
  );
}

// ---- Options card ------------------------------------------------------------------------------------------------

/** A-Robot's »Rengøringsvalg« card: rows on hairlines, 12 above and below, 24 at the sides. */
export function OptionsCard({children, className, ...rest}: {children: ReactNode; className?: string;
  'aria-label'?: string; 'aria-labelledby'?: string; role?: string}) {
  return (
    <div {...rest} className={cx('flex flex-col rounded-pv-widget bg-pv-surface px-6 py-3 font-pv shadow-pv-edge',
      className)}>
      {children}
    </div>
  );
}

/** One choice in the options card: the main one (Type: 20/800, keys 56) or a fine-tuning (15/600 grey, keys 44). */
export function SettingRow({label, labelId, main = false, children, hidden}: {
  label: string;
  labelId: string;
  main?: boolean;
  children: ReactNode;
  hidden?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-pv-ink/7 py-3.5 last:border-b-0" hidden={hidden}>
      <span id={labelId} className={main ? 'text-xl font-extrabold text-pv-ink'
        : 'text-[15px] font-semibold text-pv-ink-3'}>{label}</span>
      {children}
    </div>
  );
}

// ---- Stepper -----------------------------------------------------------------------------------------------------

/** A-Tesla's temperature: round 48 keys −/+ inside a grey pill around the value in mono. */
export function Stepper({value, muted = false, onDecrement, onIncrement, decrementLabel, incrementLabel,
  canDecrement = true, canIncrement = true, isPending = false}: {
  value: string;
  muted?: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementLabel: string;
  incrementLabel: string;
  canDecrement?: boolean;
  canIncrement?: boolean;
  /** Asked for and on its way: the value pulses until the device shows it. */
  isPending?: boolean;
}) {
  const key = cx(pressable, 'size-12 rounded-full bg-pv-surface font-pv-mono text-2xl font-medium text-pv-ink',
    'data-[pressed]:brightness-[.92]');
  return (
    <div className="grid grid-cols-[48px_92px_48px] items-center rounded-pv-pill bg-pv-bg p-1">
      <AriaButton className={key} aria-label={decrementLabel} isDisabled={!canDecrement}
        onPress={tapOnly(onDecrement)}>−</AriaButton>
      <span aria-live="polite" className={cx('text-center font-pv-mono text-[28px] font-medium tracking-[-0.05em]',
        muted ? 'text-pv-ink-3' : 'text-pv-ink', isPending && 'animate-pv-pulse motion-reduce:animate-none')}>
        {value}
      </span>
      <AriaButton className={key} aria-label={incrementLabel} isDisabled={!canIncrement}
        onPress={tapOnly(onIncrement)}>+</AriaButton>
    </div>
  );
}

// ---- Maintenance meter, event row --------------------------------------------------------------------------------

/** A-Robot's »Vedligehold«: the part, what is left in mono, and a 6-px bar; red when it is (nearly) due. */
export function MeterRow({label, value, percent, due}: {label: string; value: string; percent: number;
  due: boolean}) {
  return (
    <div className="flex flex-col gap-1.5 font-pv">
      <div className="flex justify-between gap-3">
        <span className="text-base">{label}</span>
        <span className={cx('font-pv-mono text-[15px] font-medium', due ? 'text-pv-danger' : 'text-pv-ink')}>
          {value}
        </span>
      </div>
      <div className="h-1.5 rounded-[3px] bg-pv-bg" role="meter" aria-label={`${label}: ${value}`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
        <div className={cx('h-1.5 rounded-[3px]', due ? 'bg-pv-danger' : 'bg-pv-ink')}
          style={{width: `${String(Math.max(0, Math.min(100, percent)))}%`}} />
      </div>
    </div>
  );
}

/** One event (A-Robot »Seneste hændelser«): when in mono, what in bold, the detail quiet, and an action beside. */
export function EventRow({time, title, detail, action}: {time: string; title: string; detail?: string;
  action?: ReactNode}) {
  return (
    <div className="flex items-center gap-3 border-b border-pv-ink/7 pb-3 font-pv">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-pv-mono text-[15px] font-medium text-pv-ink-3">{time}</span>
        <span className="text-[17px] font-bold">{title}</span>
        {detail ? <span className="text-[15px] text-pv-ink-3">{detail}</span> : null}
      </div>
      {action}
    </div>
  );
}
