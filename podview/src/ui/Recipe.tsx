// The recipe pieces of the design canvas (A-Opskrifter, Opskrifter-Bog, A-Opskrift, Opskrift-TimerKoerer): the
// source's photo, the »I gang« band, the photo card, the Cover Flow of Udforsk, the hero with its portion stepper,
// an ingredient's check row, a step (its mark, its words and its timer key) and the sticky line the recipe page
// shows once its hero has scrolled away. Every press is a tap, never a drag's release (tap.ts); colours are the
// recipe domain's tokens. Texts come from the screen; nothing here invents a state.
import {animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform} from 'motion/react';
import type {MotionValue, PanInfo} from 'motion/react';
import {useEffect, useRef, useState} from 'react';
import type {KeyboardEvent, ReactNode} from 'react';
import {Button as AriaButton, ToggleButton as AriaToggleButton} from 'react-aria-components';
import {TRANSITION} from '../lib/motion/tokens';
import {pressable} from './Button';
import {Stepper} from './Domain';
import {Glyph} from './glyphs';
import {tapOnly} from './tap';
import {cx} from './tv';

// ---- Photo -------------------------------------------------------------------------------------------------------

/** A recipe's photo from its source: it fades in once decoded, over the recipe's ground; none is the ground alone. */
export function RecipePhoto({src, className, eager = false}: {src: string | undefined; className?: string;
  eager?: boolean}) {
  const [loaded, setLoaded] = useState(false);
  const reduced = useReducedMotion() ?? false;
  if (!src) return <span className={cx('block bg-pv-recipe-photo', className)} aria-hidden="true" />;
  // The ground stands under the photo, so a photo still on its way (or one that never comes) is the ground.
  return (
    <span className={cx('block overflow-hidden bg-pv-recipe-photo', className)} aria-hidden="true">
      <motion.img
        className="block size-full object-cover"
        src={src}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        initial={false}
        animate={{opacity: loaded ? 1 : 0}}
        transition={reduced ? TRANSITION.reduced : TRANSITION.fade}
        onLoad={() => {
          setLoaded(true);
        }}
      />
    </span>
  );
}

// ---- »I gang« band -------------------------------------------------------------------------------------------------

export interface ResumeBandProps {
  /** The recipe in progress (its title, step and phase: »Burgerboller · trin 2 af 5 · hvile og hævning«). */
  title: string;
  image?: string | undefined;
  /** The key's words (»Fortsæt madlavning«). */
  action: string;
  onPress: () => void;
  'aria-label': string;
  id?: string;
  [data: `data-${string}`]: string | undefined;
}

/** A-Opskrifter's band over the catalogue: 96 high on the recipe tint, the photo, »I gang« and the recipe, a dark
 *  key at the end. The whole band is the one press. */
export function ResumeBand({title, image, action, onPress, ...props}: ResumeBandProps) {
  return (
    <AriaButton {...props} onPress={tapOnly(onPress)}
      className={cx(pressable, 'flex h-24 w-full shrink-0 items-center gap-[18px] rounded-pv-widget bg-pv-recipe px-6',
        'text-left font-pv text-pv-ink shadow-pv-edge data-[pressed]:scale-[.985]')}>
      <RecipePhoto src={image} eager className="pointer-events-none size-14 shrink-0 rounded-2xl" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] leading-5 font-semibold text-pv-recipe-ink">I gang</span>
        <span className="truncate text-[22px] leading-7 font-extrabold">{title}</span>
      </span>
      <span className="flex h-14 shrink-0 items-center rounded-pv-pill bg-pv-ink px-6 text-[17px] font-semibold
        text-pv-on-dark">{action}</span>
    </AriaButton>
  );
}

/** The fixed line on a recipe page while another recipe is in progress: »Burgerboller er i gang · trin 2 af 5«
 *  with a quiet »Gå til«. */
export function ResumeLine({text, action, onPress, 'aria-label': label}: {text: string; action: string;
  onPress: () => void; 'aria-label': string}) {
  return (
    <div className="flex h-16 shrink-0 items-center gap-4 rounded-pv-widget bg-pv-recipe pr-3 pl-6 font-pv
      shadow-pv-edge" role="status">
      <span className="min-w-0 flex-1 truncate text-[17px] leading-6 font-semibold text-pv-ink">{text}</span>
      <AriaButton aria-label={label} onPress={tapOnly(onPress)}
        className={cx(pressable, 'flex h-11 shrink-0 items-center rounded-pv-pill bg-pv-surface px-[18px] text-base',
          'font-semibold text-pv-ink data-[pressed]:brightness-[.92]')}>{action}</AriaButton>
    </div>
  );
}

// ---- Photo card -----------------------------------------------------------------------------------------------------

export interface RecipeCardProps {
  title: string;
  /** One line under the title (»15 stk. · 2–3 timer hævning«). */
  meta: string;
  image?: string | undefined;
  /** The source, as a badge on the photo; none hides it. */
  publisher?: string | undefined;
  /** The recipe in progress: »I gang« on the photo. */
  active?: boolean;
  onPress: () => void;
  eager?: boolean;
  [data: `data-${string}`]: string | undefined;
}

/** A-Opskrifter's card on fixed lines: the photo 150 high, the title always two lines (44), the meta one (20). */
export function RecipeCard({title, meta, image, publisher, active = false, onPress, eager = false, ...data}:
  RecipeCardProps) {
  return (
    <AriaButton {...data} onPress={tapOnly(onPress)} aria-label={[title, active ? 'i gang' : '', meta, publisher]
      .filter(Boolean).join(', ')}
      className={cx(pressable, 'flex w-full min-w-0 flex-col gap-3 overflow-hidden rounded-pv-widget bg-pv-surface p-3',
        'text-left font-pv text-pv-ink shadow-pv-edge data-[pressed]:scale-[.985]')}>
      <span className="relative block h-[150px] shrink-0 overflow-hidden rounded-2xl bg-pv-recipe-photo">
        <RecipePhoto src={image} eager={eager} className="pointer-events-none absolute inset-0 size-full" />
        {publisher ? (
          <small className="absolute bottom-2 left-2 h-7 max-w-[calc(100%-16px)] truncate rounded-pv-pill
            bg-pv-surface px-2.5 py-1 text-[15px] leading-5 font-semibold text-pv-ink-2">{publisher}</small>
        ) : null}
        {active ? (
          <span className="absolute top-2.5 left-2.5 flex h-7 items-center rounded-pv-pill bg-pv-ink px-2.5
            text-[15px] font-semibold text-pv-on-dark">I gang</span>
        ) : null}
      </span>
      <span className="line-clamp-2 h-11 shrink-0 text-lg leading-[22px] font-extrabold">{title}</span>
      <span className="h-5 shrink-0 truncate text-[15px] leading-5 text-pv-ink-3">{meta}</span>
    </AriaButton>
  );
}

// ---- Cover Flow (Opskrifter-Bog) ------------------------------------------------------------------------------------

export interface CoverItem {
  id: string;
  title: string;
  /** Over the title, in capitals (the first category). */
  kicker: string;
  meta: string;
  image?: string | undefined;
  /** On the photo (»I gang · trin 2 af 5«). */
  badge?: string | null;
}

/** The covers stand this far apart; a finger moving this far moves one cover. */
export const COVER_PITCH = 430;
/** At most this many dots, in a window that slides with the chosen cover. */
export const COVER_DOTS = 7;

// The canvas's flow at a fractional position: the chosen cover flat, its neighbours turned 55° away and pushed back,
// further ones closer together; a cover between two places travels smoothly (the near ones ease into their turn).
export function coverPose(d: number, reduced = false) {
  const a = Math.abs(d);
  const s = Math.sign(d);
  const near = a <= 1;
  const ease = a * a * (3 - 2 * a);
  const x = near ? d * COVER_PITCH : s * (COVER_PITCH + (a - 1) * 110);
  const z = reduced ? 0 : near ? -260 * a : -260 - (a - 1) * 60;
  const turn = reduced ? 0 : near ? -s * 55 * ease : -s * 55;
  return {x, z, turn, opacity: a > 3 ? Math.max(0, 4 - a) : 1, shade: near ? 1 - 0.18 * a : 0.82,
    zIndex: 20 - Math.round(a)};
}

// The dots' window: at most seven, the chosen one long; an edge dot is small while more lie beyond it.
export function coverDots(index: number, count: number) {
  const shown = Math.min(COVER_DOTS, count);
  const start = Math.max(0, Math.min(index - 3, count - shown));
  return Array.from({length: shown}, (_, o) => {
    const k = start + o;
    const edge = (o === 0 && start > 0) || (o === shown - 1 && start + shown < count);
    return {k, chosen: k === index, edge};
  });
}

function Cover({item, k, position, reduced, chosen, onPress}: {item: CoverItem; k: number;
  position: MotionValue<number>; reduced: boolean; chosen: boolean; onPress: () => void}) {
  const transform = useTransform(position, p => {
    const pose = coverPose(k - p, reduced);
    return `translate3d(${String(pose.x)}px,0,${String(pose.z)}px) rotateY(${String(pose.turn)}deg)`;
  });
  const opacity = useTransform(position, p => coverPose(k - p, reduced).opacity);
  const zIndex = useTransform(position, p => coverPose(k - p, reduced).zIndex);
  const filter = useTransform(position, p => `brightness(${String(coverPose(k - p, reduced).shade)})`);
  const visibility = useTransform(position, p => (Math.abs(k - p) > 4 ? 'hidden' : 'visible'));
  return (
    <motion.div className="absolute top-0 left-1/2 -ml-[360px] h-[460px] w-[720px] [transform-style:preserve-3d]"
      style={{transform, opacity, zIndex, visibility}}>
      <AriaButton onPress={tapOnly(onPress)} aria-label={chosen ? `Åbn ${item.title}` : `Vælg ${item.title}`}
        aria-hidden={chosen ? undefined : true} excludeFromTabOrder={!chosen}
        className={cx('relative block size-full overflow-hidden rounded-[22px] bg-pv-recipe-photo outline-none',
          'data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-4 data-[focus-visible]:outline-pv-ink',
          chosen ? 'shadow-[0_40px_70px_-30px_rgba(23,23,26,.6)]' : 'shadow-[0_20px_40px_-24px_rgba(23,23,26,.5)]')}>
        <motion.span className="absolute inset-0 block" style={{filter}}>
          <RecipePhoto src={item.image} eager={Math.abs(k) < 4} className="pointer-events-none size-full" />
        </motion.span>
        {item.badge ? (
          <span className="absolute top-4 left-4 flex h-8 items-center rounded-pv-pill bg-pv-surface px-3.5
            text-[15px] font-bold text-pv-ink">{item.badge}</span>
        ) : null}
      </AriaButton>
    </motion.div>
  );
}

export interface CoverFlowProps {
  items: readonly CoverItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onOpen: (item: CoverItem) => void;
  'aria-label': string;
}

/** Opskrifter-Bog's Cover Flow: swipe sideways (the flow follows the finger and settles on the nearest cover with
 *  the finger's momentum), a tap on a neighbour chooses it, a tap on the chosen cover opens it; arrow keys move.
 *  The chosen cover's kicker, title and meta stand fixed under it (they cross-fade), then the dots. */
export function CoverFlow({items, index, onIndexChange, onOpen, 'aria-label': label}: CoverFlowProps) {
  const reduced = useReducedMotion() ?? false;
  const count = items.length;
  const at = Math.max(0, Math.min(count - 1, index));
  const position = useMotionValue(at);
  const start = useRef(at);
  const dragging = useRef(false);
  // A change from outside (a new catalogue) puts the flow on its cover without a move.
  useEffect(() => {
    if (!dragging.current && Math.round(position.get()) !== at) position.jump(at);
  }, [at, position]);
  const go = (target: number, velocity = 0) => {
    const k = Math.max(0, Math.min(count - 1, target));
    void animate(position, k, reduced ? TRANSITION.reduced : {...TRANSITION.page, velocity});
    if (k !== at) onIndexChange(k);
  };
  const onPanStart = () => {
    dragging.current = true;
    position.stop();
    start.current = position.get();
  };
  const onPan = (_: PointerEvent, info: PanInfo) => {
    const raw = start.current - info.offset.x / COVER_PITCH;
    // Past either end the flow gives a little (rubber band).
    const lo = 0, hi = count - 1;
    position.set(raw < lo ? lo + (raw - lo) / 3 : raw > hi ? hi + (raw - hi) / 3 : raw);
  };
  const onPanEnd = (_: PointerEvent, info: PanInfo) => {
    dragging.current = false;
    const velocity = -info.velocity.x / COVER_PITCH;
    go(Math.round(position.get() + velocity * 0.25), velocity);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') go(at + 1);
    else if (event.key === 'ArrowLeft') go(at - 1);
    else return;
    event.preventDefault();
  };
  const current = items[at];
  return (
    // The canvas's flow (covers 460, the text 24 under them, the dots 36 under the text) tightened to 8 and 8 px so
    // the dots stand inside the panel's stage (its topbar sits 16 lower than the canvas's, and the stage keeps 24 at
    // the bottom). The flow clips at the page's edges: a cover beyond them never widens or scrolls the page, also when focus moves
    // to it.
    <div className="relative h-[584px] w-full shrink-0 overflow-clip font-pv" role="group"
      aria-roledescription="karrusel"
      aria-label={label} onKeyDown={onKeyDown}>
      <motion.div className="absolute inset-x-0 top-0 h-[470px] touch-pan-y [perspective:1600px]"
        onPanStart={onPanStart} onPan={onPan} onPanEnd={onPanEnd}>
        {items.map((item, k) => (
          <Cover key={item.id} item={item} k={k} position={position} reduced={reduced} chosen={k === at}
            onPress={() => {
              if (k === at) onOpen(item);
              else go(k);
            }} />
        ))}
      </motion.div>
      <div className="absolute inset-x-0 top-[468px] flex flex-col items-center gap-1.5 text-center" aria-live="polite">
        <AnimatePresence initial={false} mode="popLayout">
          {current ? (
            <motion.div key={current.id} className="flex flex-col items-center gap-1.5"
              initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}}
              transition={reduced ? TRANSITION.reduced : TRANSITION.fade}>
              <span className="h-5 text-[15px] leading-5 font-semibold tracking-[.08em] text-pv-recipe-ink uppercase">
                {current.kicker}</span>
              <span className="h-11 max-w-[900px] truncate text-4xl leading-[44px] font-extrabold tracking-[-0.02em]">
                {current.title}</span>
              <span className="h-6 text-[17px] leading-6 text-pv-ink-3">{current.meta}</span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <div className="absolute inset-x-0 top-[578px] flex justify-center gap-2" aria-hidden="true">
        {coverDots(at, count).map(dot => (
          <motion.i key={dot.k} className={cx('block self-center rounded-[3px]',
            dot.chosen ? 'bg-pv-ink' : 'bg-pv-ink/22')}
            initial={false}
            animate={{width: dot.chosen ? 28 : dot.edge ? 5 : 8, height: dot.edge ? 5 : 6}}
            transition={reduced ? TRANSITION.reduced : TRANSITION.quick} />
        ))}
      </div>
    </div>
  );
}

// ---- Hero and its portion stepper -----------------------------------------------------------------------------------

export interface PortionStepperProps {
  value: number;
  /** The word under the number (»stk.«, »personer«). */
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

/** A-Opskrift's portions: the kit Stepper in the recipe's tone, the unit under it. */
export function PortionStepper({value, unit, min, max, step, onChange}: PortionStepperProps) {
  return (
    <div className="flex flex-col items-center gap-1 font-pv" role="group" aria-label={`Portioner, ${unit}`}>
      <Stepper tone="recipe" value={String(value)} decrementLabel={`Færre ${unit}`} incrementLabel={`Flere ${unit}`}
        canDecrement={value - step >= min} canIncrement={value + step <= max}
        onDecrement={() => {
          onChange(Math.max(min, value - step));
        }} onIncrement={() => {
          onChange(Math.min(max, value + step));
        }} />
      <span className="text-[15px] leading-5 text-pv-recipe-meta">{unit}</span>
    </div>
  );
}

/** The recipe's quiet text key (»Nulstil opskrift«): 56 high, no surface, the recipe's ink. */
export function RecipeTextKey({children, onPress, id}: {children: ReactNode; onPress: () => void; id?: string}) {
  return (
    <AriaButton {...(id ? {id} : {})} onPress={tapOnly(onPress)}
      className={cx(pressable, 'h-14 shrink-0 rounded-pv-pill px-[18px] font-pv text-[15px] font-semibold',
        'text-pv-recipe-ink data-[pressed]:bg-pv-recipe-key')}>{children}</AriaButton>
  );
}

export interface RecipeHeroProps {
  title: string;
  /** Over the title (»Trin 2 af 5 · af Meyers«). */
  label: string;
  /** Under the title (»12–15 min. bagetid · 2–3 timer hævning · bløde sesamboller«). */
  facts?: string;
  image?: string | undefined;
  /** The stepper and the recipe's keys, at the right. */
  children?: ReactNode;
  /** The recipe's keys in a box of their own, as wide as its widest key (»Start denne i stedet«), so the stepper
   *  beside it stands still when »Start opskrift« becomes »Nulstil opskrift«. */
  keys?: ReactNode;
  id?: string;
}

/** A-Opskrift's hero: 221 high on the recipe tint, the photo 160, the label, the title 40/800 and the facts. */
export function RecipeHero({title, label, facts, image, children, keys, id}: RecipeHeroProps) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined}
      className="grid h-[221px] shrink-0 grid-cols-[160px_minmax(0,1fr)_auto] items-center gap-[22px] rounded-pv-widget
        bg-pv-recipe p-6 font-pv text-pv-ink shadow-pv-edge">
      <RecipePhoto src={image} eager className="size-40 rounded-2xl" />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[15px] leading-5 font-semibold text-pv-recipe-ink" role="status">{label}</span>
        <h2 id={id ? `${id}-title` : undefined}
          className="m-0 line-clamp-2 text-[40px] leading-[1.05] font-extrabold tracking-[-0.025em]">{title}</h2>
        {facts ? <span className="line-clamp-2 text-base leading-[22px] text-pv-recipe-meta">{facts}</span> : null}
      </div>
      {children || keys ? (
        <div className="flex items-center gap-3.5">
          {children}
          {keys ? <div className="flex min-w-[218px] items-center justify-end gap-3.5">{keys}</div> : null}
        </div>
      ) : null}
    </section>
  );
}

// ---- Ingredients ---------------------------------------------------------------------------------------------------

export interface CheckRowProps {
  /** The amount column (»350 ml«); none is »—«. */
  amount: string | null;
  text: string;
  isSelected: boolean;
  onChange: (selected: boolean) => void;
  /** The amount follows a changed portion count (the recipe's brown). */
  scaled?: boolean;
  /** Ticking starts nothing yet: the row reads, it does not press. */
  isDisabled?: boolean;
}

/** An ingredient on A-Opskrift: 48 high, the box (filled when found), the amount in mono and the name; found, the
 *  row greys and is struck through. */
export function CheckRow({amount, text, isSelected, onChange, scaled = false, isDisabled = false}: CheckRowProps) {
  return (
    <AriaToggleButton isSelected={isSelected} onChange={tapOnly(onChange)} isDisabled={isDisabled}
      aria-label={amount ? `${amount} ${text}` : text}
      className={cx(pressable, 'grid h-12 w-full shrink-0 grid-cols-[26px_84px_minmax(0,1fr)] items-center gap-2',
        'rounded-pv-pill px-1.5 text-left font-pv text-[17px] font-medium data-[disabled]:opacity-100',
        'data-[pressed]:bg-pv-surface-2', isSelected ? 'text-pv-ink-3' : 'text-pv-ink')}>
      <i className={cx('block size-5 rounded-md transition-colors duration-(--duration-pv-tap)',
        isSelected ? 'bg-pv-recipe-ink shadow-[inset_0_0_0_1.8px_var(--color-pv-recipe-ink)]'
          : 'shadow-[inset_0_0_0_1.8px_rgba(23,23,26,.35)]')} aria-hidden="true" />
      <span className={cx('truncate font-pv-mono text-base font-medium transition-colors duration-300',
        scaled && amount ? 'text-pv-recipe-scaled' : isSelected ? 'text-pv-ink-3' : 'text-pv-ink')}>
        {amount ?? '—'}</span>
      <span className={cx('min-w-0', isSelected && 'line-through')}>{text}</span>
    </AriaToggleButton>
  );
}

// ---- Steps ---------------------------------------------------------------------------------------------------------

export type StepState = 'done' | 'current' | 'todo';

export interface StepRowProps {
  number: number;
  /** The step's phase (»Hvile og hævning«), when the recipe names one here. */
  heading?: string | null;
  text: string;
  state: StepState;
  onToggle: () => void;
  /** Without a cooking session the step only reads. */
  isInteractive?: boolean;
  /** The step's timer key or running chip, at the right. */
  timer?: ReactNode;
}

/** A step on A-Opskrift: the mark (its number, ✓ when done) and the words are both the press that marks it done; a
 *  second press brings it back. The current step stands on the tint with a ring, larger; a done one greys and is
 *  struck through. */
export function StepRow({number, heading, text, state, onToggle, isInteractive = true, timer}: StepRowProps) {
  const done = state === 'done';
  const current = state === 'current';
  const reduced = useReducedMotion() ?? false;
  const mark = (
    <span className={cx('flex size-8 items-center justify-center rounded-full font-pv-mono text-[15px] font-semibold',
      'transition-colors duration-[250ms]',
      done ? 'bg-pv-recipe-ink text-pv-on-dark' : current ? 'bg-pv-ink text-pv-on-dark' : 'bg-pv-step-todo text-pv-ink-3')}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={done ? 'done' : 'todo'} initial={{opacity: 0, scale: 0.6}} animate={{opacity: 1, scale: 1}}
          exit={{opacity: 0, scale: 0.6}}
          transition={reduced ? TRANSITION.reduced : {...TRANSITION.snappy, opacity: TRANSITION.fade}}>
          {done ? '✓' : number}
        </motion.span>
      </AnimatePresence>
    </span>
  );
  const words = (
    <>
      {heading ? (
        // The current step grows to A-Opskrift's 22/19 over the canvas's 250 ms (never in one jump).
        <span className={cx('font-extrabold decoration-2 transition-[color,font-size,line-height] duration-[250ms]',
          'ease-pv-out motion-reduce:transition-none',
          current ? 'text-[22px] leading-7' : 'text-[17px] leading-[22px]', done ? 'text-pv-ink-3 line-through' : '')}>
          {heading}</span>
      ) : null}
      <span className={cx('leading-[1.4] transition-[color,font-size] duration-[250ms] ease-pv-out',
        'motion-reduce:transition-none', current ? 'text-[19px] text-pv-step-now' : 'text-[15px] text-pv-ink-3',
        done && 'line-through')}>{text}</span>
    </>
  );
  const label = done ? `Trin ${String(number)} er færdigt` : `Markér trin ${String(number)} færdigt`;
  return (
    <div data-step={number} data-state={state}
      className={cx('grid grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3.5 rounded-[18px] font-pv',
        'transition-[background-color,box-shadow,padding] duration-[250ms]',
        current ? 'bg-pv-recipe p-4 shadow-[inset_0_0_0_2px_var(--color-pv-recipe-ring)]' : 'px-4 py-1.5')}>
      {isInteractive ? (
        <AriaButton aria-label={label} aria-pressed={done} onPress={tapOnly(onToggle)}
          className={cx(pressable, '-m-1.5 flex size-11 items-center justify-center rounded-full')}>{mark}</AriaButton>
      ) : <span className="-m-1.5 flex size-11 items-center justify-center" aria-hidden="true">{mark}</span>}
      {isInteractive ? (
        <AriaButton aria-pressed={done} onPress={tapOnly(onToggle)}
          className={cx(pressable, 'flex min-h-11 flex-col gap-[3px] text-left data-[pressed]:scale-[.99]')}>
          {words}</AriaButton>
      ) : <div className="flex min-h-11 flex-col gap-[3px]">{words}</div>}
      {timer ? <div className="self-center">{timer}</div> : null}
    </div>
  );
}

export interface StepTimerProps {
  /** »30 min«, »2 t«. */
  duration: string;
  /** On the current step the key is the dark 56 »Start timer · 30 min«; elsewhere a grey 48 with the time alone. */
  current: boolean;
  /** The step's timer is running: the dark chip with its ring and count (the topbar's chip). */
  running?: {count: string; left: number} | null;
  onStart: () => void;
  /** The running chip's press (the Timer page). */
  onOpen?: () => void;
  isDisabled?: boolean;
}

/** A step's timer (Opskrift-TimerKoerer): one tap starts a timer named after the step; while it runs, the step shows
 *  the same chip as the topbar. */
export function StepTimer({duration, current, running, onStart, onOpen, isDisabled = false}: StepTimerProps) {
  const ring = 2 * Math.PI * 9;
  if (running) {
    return (
      <AriaButton {...(onOpen ? {onPress: tapOnly(onOpen)} : {})} aria-label={`Timer kører · ${running.count}`}
        data-opens="timers"
        className={cx(pressable, 'flex h-11 shrink-0 items-center gap-2.5 rounded-pv-pill bg-pv-ink pr-3.5 pl-2.5',
          'text-pv-on-dark data-[pressed]:brightness-[.92]')}>
        <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx={12} cy={12} r={9} fill="none" className="stroke-pv-timer-track" strokeWidth={3} />
          <circle cx={12} cy={12} r={9} fill="none" className="stroke-pv-timer-accent" strokeWidth={3}
            strokeLinecap="round" transform="rotate(-90 12 12)"
            strokeDasharray={`${(ring * Math.max(0, Math.min(1, running.left))).toFixed(1)} ${ring.toFixed(1)}`} />
        </svg>
        <span className="font-pv-mono text-lg font-medium tracking-[-0.03em]">{running.count}</span>
      </AriaButton>
    );
  }
  return (
    <AriaButton onPress={tapOnly(onStart)} isDisabled={isDisabled}
      aria-label={`Start timer på ${duration}`}
      className={cx(pressable, 'flex shrink-0 items-center gap-2 rounded-pv-pill px-4 font-pv text-[15px] font-semibold',
        'whitespace-nowrap data-[pressed]:brightness-[.92]',
        current ? 'h-14 bg-pv-ink text-pv-on-dark' : 'h-12 bg-pv-step-todo text-pv-ink')}>
      <Glyph name="timer" size={18} stroke={2} />
      {current ? `Start timer · ${duration}` : duration}
    </AriaButton>
  );
}
