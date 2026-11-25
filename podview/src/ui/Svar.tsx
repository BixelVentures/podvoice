// A-SvarKort and SvarK-Spec (design canvas): the answer card, its media and the »I dag« list beside it. One card per
// answer (744 × 696, padding 32, radius 24, the domain's tone and its corner dots): a header (type glyph 20 · label
// 15/600 · time 15 mono), follow-ups in the same card with the newest on top, the title 44/48, the question 17/24, a
// media surface (white, radius 20, padding 32) and the actions (K-Btn 56, 16 apart). Spacing only 8 · 16 · 24 · 32.
// »Svarkort · bygges« is the same card with quietly pulsing blocks in the title's and the media's places, so
// nothing jumps when the content arrives. The answer forms (A-Svar's) are media bodies of their own. Presentational:
// every press is the caller's; texts are the answer's own.
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import type {ReactNode} from 'react';
import {useId} from 'react';
import {Button as AriaButton} from 'react-aria-components';
import {TRANSITION} from '../lib/motion/tokens';
import {Button, pressable} from './Button';
import {Glyph} from './glyphs';
import type {FilledName, GlyphName} from './glyphs';
import {cx} from './tv';

// The answer's tone: the domain's surface (as the widgets) and its material's dots; answers without a domain are ink,
// fainter.
export type SvarTone = 'svar' | 'vejr' | 'musik' | 'lys' | 'robot';
export const SVAR_TONE: Record<SvarTone, {bg: string; dot: string; dots: number}> = {
  svar: {bg: 'bg-pv-answer', dot: 'var(--color-pv-ink)', dots: 0.22},
  vejr: {bg: 'bg-pv-weather', dot: 'var(--color-pv-weather-dot)', dots: 0.5},
  musik: {bg: 'bg-pv-music', dot: '#B4532A', dots: 0.5},
  lys: {bg: 'bg-pv-light', dot: 'var(--color-pv-light-dot)', dots: 0.5},
  robot: {bg: 'bg-pv-robot', dot: 'var(--color-pv-robot-dot)', dots: 0.5},
};

// The corner dots: square cells on a 9 px grid that grow towards the top right corner (up to 6 px), as the widget
// material, under a soft radial mask.
const CORNER = (() => {
  const dots: {x: number; y: number; w: number}[] = [];
  for (let y = 4.5; y < 120; y += 9) {
    for (let x = 4.5; x < 280; x += 9) {
      const w = Math.max(0, 6 - Math.hypot(280 - x, y) * 0.02);
      if (w > 0.8) dots.push({x: +(x - w / 2).toFixed(1), y: +(y - w / 2).toFixed(1), w: +w.toFixed(1)});
    }
  }
  return dots;
})();

const MASK = 'radial-gradient(120% 100% at 100% 0, #000 35%, transparent 80%)';

function CornerDots({tone}: {tone: SvarTone}) {
  const {dot, dots} = SVAR_TONE[tone];
  return (
    <svg className="pointer-events-none absolute top-0 right-0" width={280} height={120} viewBox="0 0 280 120"
      aria-hidden="true" style={{opacity: dots, maskImage: MASK, WebkitMaskImage: MASK}}>
      {CORNER.map(d => <rect key={`${String(d.x)}-${String(d.y)}`} x={d.x} y={d.y} width={d.w} height={d.w} rx={1}
        fill={dot} />)}
    </svg>
  );
}

// A block that breathes quietly while the answer is built (opacity .5 ↔ 1 over 1.4 s; still under reduced motion).
function Skeleton({className, label}: {className: string; label?: string}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.i className={cx('block bg-[rgba(23,23,26,.07)]', className)}
      {...(label ? {role: 'status', 'aria-label': label} : {'aria-hidden': true})}
      initial={false} animate={reduced ? {opacity: 0.75} : {opacity: [0.5, 1, 0.5]}}
      transition={reduced ? TRANSITION.reduced : {duration: 1.4, ease: 'easeInOut', repeat: Infinity}} />
  );
}

export interface SvarFollowUp {
  id: string;
  question: string;
  answer: string;
  time: string;
}

export interface SvarCardProps {
  tone?: SvarTone;
  icon: GlyphName;
  /** »Resultat · 8. nov.«, »Fakta«, »Vejr · i morgen«: the answer's type in its own words. */
  kind: string;
  time: string;
  title: string;
  /** What was asked, shown as »…«. */
  question?: string;
  /** A text answer: the title is the answer itself (32/40 · 700) and there is no media. */
  long?: boolean;
  /** Follow-ups in the same card, newest first: each a short question and its answer. */
  followUps?: readonly SvarFollowUp[];
  /** »Svarkort · bygges«: the title and the media wait in their own places. */
  building?: boolean;
  /** A K-Notice above the title (afbrudt, offline, fejl). */
  notice?: ReactNode;
  /** The media surface (SvarMedia or a form); none for a text answer. */
  children?: ReactNode;
  /** K-Btn 56s. */
  actions?: ReactNode;
  className?: string;
  'data-answer-id'?: string;
  'data-answer-family'?: string;
  'data-answer-state'?: string;
}

export function SvarCard({tone = 'svar', icon, kind, time, title, question, long = false, followUps = [],
  building = false, notice, children, actions, className, ...data}: SvarCardProps) {
  const reduced = useReducedMotion() ?? false;
  const follow = followUps.length > 0;
  const titleSize = follow ? 'text-[32px] leading-9 font-extrabold tracking-[-0.03em]'
    : long ? 'text-[32px] leading-10 font-bold tracking-[-0.02em]'
      : 'text-[44px] leading-[48px] font-extrabold tracking-[-0.03em]';
  return (
    <article aria-label={building ? 'Svarer…' : kind} data-answer-card="" {...data}
      className={cx('relative flex h-full max-h-[696px] w-[744px] shrink-0 flex-col overflow-hidden rounded-[24px]',
        'p-8 font-pv text-pv-ink shadow-[inset_0_0_0_1px_rgba(23,23,26,.06)]', SVAR_TONE[building ? 'svar' : tone].bg,
        className)}>
      <CornerDots tone={building ? 'svar' : tone} />
      <header className="relative flex h-8 flex-none items-center gap-2">
        <Glyph name={building ? 'answer' : icon} size={20} />
        <span className="truncate text-[15px] font-semibold text-pv-ink-2">{building ? 'Svarer…' : kind}</span>
        <time className="flex-none font-pv-mono text-[15px] font-medium text-pv-ink-3">{time}</time>
      </header>
      <AnimatePresence initial={false}>
        {followUps.map(item => (
          <motion.div key={item.id} data-follow-up=""
            className="relative mt-6 flex flex-none flex-col gap-2 border-b border-[rgba(23,23,26,.12)] pb-6"
            initial={reduced ? {opacity: 0} : {opacity: 0, y: 12}} animate={{opacity: 1, y: 0}}
            transition={reduced ? TRANSITION.reduced : {...TRANSITION.smooth, opacity: TRANSITION.fade}}>
            <span className="text-[15px] font-semibold text-pv-ink-2">
              {`»${item.question}« `}
              <time className="font-pv-mono font-medium text-pv-ink-3">{item.time}</time>
            </span>
            <span className="text-[32px] leading-9 font-extrabold tracking-[-0.025em] wrap-break-word">
              {item.answer}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
      {notice ? <div className="relative mt-6 flex-none">{notice}</div> : null}
      {building ? <Skeleton className="mt-6 h-12 w-[56%] flex-none rounded-xl" />
        : <h2 className={cx('relative mt-6 max-w-[640px] flex-none wrap-break-word', titleSize)}>{title}</h2>}
      {question ? (
        <p className="relative mt-2 flex-none truncate text-[17px] leading-6 text-pv-ink-2">{`»${question}«`}</p>
      ) : null}
      <div className={cx('relative flex min-h-0 flex-1 flex-col', long && !building ? 'mt-0' : 'mt-6')}>
        {building ? <Skeleton className="flex-1 rounded-[20px]" label="Svaret bygges" /> : children}
      </div>
      {actions && !building ? <div className="relative mt-6 flex flex-none gap-4">{actions}</div> : null}
    </article>
  );
}

/** The media surface: white, radius 20, padding 32 (scrolls inside when an answer is longer than the card). */
export function SvarMedia({children, className, dark = false}: {children: ReactNode; className?: string;
  dark?: boolean}) {
  return (
    <div className={cx('min-h-0 flex-1 overflow-auto rounded-[20px] p-8', dark ? 'bg-pv-dark text-pv-on-dark'
      : 'bg-pv-entry shadow-[inset_0_0_0_1px_rgba(23,23,26,.06)]', className)}>
      {children}
    </div>
  );
}

const MD = 'rounded-[20px] bg-pv-entry shadow-[inset_0_0_0_1px_rgba(23,23,26,.06)]';

export interface SvarFact {
  id: string;
  label: string;
  value: string;
  detail?: string;
}

/** Fakta: tiles side by side (16 apart, padding 24), the value in Plex Mono 56. */
export function SvarFacts({facts}: {facts: readonly SvarFact[]}) {
  const cols = Math.min(3, Math.max(1, facts.length));
  return (
    <dl className="grid min-h-0 flex-1 gap-4 overflow-auto"
      style={{gridTemplateColumns: `repeat(${String(cols)}, minmax(0,1fr))`}}>
      {facts.map(fact => (
        <div key={fact.id} className={cx(MD, 'flex min-h-[200px] flex-col justify-between gap-4 p-6')}>
          <dt className="text-[15px] font-semibold text-pv-ink-3">{fact.label}</dt>
          <dd className={cx('font-pv-mono font-medium wrap-anywhere', fact.value.length > 9
            ? 'text-[36px] leading-[1.05] tracking-[-0.04em]' : 'text-[56px] leading-[.95] tracking-[-0.06em]')}>
            {fact.value}
          </dd>
          {fact.detail ? <dd className="text-[15px] leading-5 text-pv-ink-2">{fact.detail}</dd> : <dd />}
        </div>
      ))}
    </dl>
  );
}

/** Resultat: the dark score surface; each team a disc with its tag, its name and its scorers. */
export function SvarScore({home, away, compact = false}: {
  home: {name: string; tag: string; score: number | null; scorers?: string};
  away: {name: string; tag: string; score: number | null; scorers?: string};
  compact?: boolean;
}) {
  const known = home.score !== null && away.score !== null;
  const team = (side: typeof home) => (
    <div className="flex min-w-0 flex-col items-center gap-2">
      <span className="flex size-24 items-center justify-center rounded-full bg-pv-on-dark text-[22px] font-extrabold
        text-pv-ink" aria-hidden="true">{side.tag}</span>
      <span className="text-center text-[22px] font-bold wrap-break-word">{side.name}</span>
      {side.scorers ? <span className="text-center text-[15px] text-[rgba(247,246,243,.7)]">{side.scorers}</span>
        : null}
    </div>
  );
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_auto_1fr] items-center rounded-[20px] bg-pv-dark px-8
      text-pv-on-dark" role="group" aria-label={known ? `${home.name} ${String(home.score)}, ${away.name} `
        + String(away.score) : `${home.name} mod ${away.name}`}>
      {team(home)}
      <span className={cx('font-pv-mono leading-[.85] font-medium tracking-[-0.08em] whitespace-nowrap',
        compact ? 'text-[120px]' : 'text-[144px]')} aria-hidden="true">
        {known ? <>{String(home.score)}<span className="text-[rgba(247,246,243,.35)]">–</span>{String(away.score)}</>
          : <span className="text-[64px] tracking-[-0.04em]">mod</span>}
      </span>
      {team(away)}
    </div>
  );
}

/** Billede med kilde: the picture square to the media's height, its caption and its credit beside it. */
export function SvarImage({image, caption, credit}: {image: ReactNode; caption: string; credit: string}) {
  return (
    <figure className="flex min-h-0 flex-1 gap-6">
      <div className="aspect-square h-full max-w-[60%] flex-none overflow-hidden rounded-[20px] bg-pv-placeholder
        [&>img]:size-full [&>img]:object-cover">{image}</div>
      <figcaption className="flex min-w-0 flex-col justify-end gap-2">
        <span className="text-[17px] leading-[1.4]">{caption}</span>
        <span className="text-[15px] font-semibold text-pv-ink-3">{credit}</span>
      </figcaption>
    </figure>
  );
}

export interface SvarEvent {
  id: string;
  time: ReactNode;
  label: string;
  detail?: string;
}

/** Tidslinje: the time in Plex Mono, a ring on a line, the event and its detail. */
export function SvarTimeline({events}: {events: readonly SvarEvent[]}) {
  return (
    <ol className="flex min-h-0 flex-col overflow-auto">
      {events.map((event, index) => (
        <li key={event.id} className="grid min-h-[84px] grid-cols-[96px_24px_1fr] gap-4">
          <span className="pt-0.5 font-pv-mono text-[22px] font-medium">{event.time}</span>
          <span className="relative block" aria-hidden="true">
            <i className="absolute top-2 left-[7px] block size-2.5 rounded-full shadow-[inset_0_0_0_2px_#17171A]" />
            {index < events.length - 1 ? <i className="absolute top-6 bottom-0 left-[11px] block w-0.5
              bg-[rgba(23,23,26,.2)]" /> : null}
          </span>
          <span className="flex flex-col gap-0.5 pb-4">
            <span className="text-[20px] font-extrabold">{event.label}</span>
            {event.detail ? <span className="text-base text-pv-ink-3">{event.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

export interface SvarNode {
  id: string;
  label: string;
  detail?: string;
}

/** Enkelt diagram and numbered points: black numbered discs with a part and its explanation (with a picture). */
export function SvarNodes({nodes, image}: {nodes: readonly SvarNode[]; image?: ReactNode}) {
  return (
    <div className="flex min-h-0 flex-1 gap-6">
      {image ? <div className="h-full w-[360px] flex-none overflow-hidden rounded-[20px] bg-pv-placeholder
        [&>img]:size-full [&>img]:object-cover">{image}</div> : null}
      <ol className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto">
        {nodes.map((node, index) => (
          <li key={node.id} className="flex items-start gap-3.5">
            <span className="flex size-8 flex-none items-center justify-center rounded-full bg-pv-dark font-pv-mono
              text-[15px] font-semibold text-pv-on-dark">{String(index + 1)}</span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[19px] font-extrabold wrap-break-word">{node.label}</span>
              {node.detail ? <span className="text-[15px] leading-[1.35] text-pv-ink-3">{node.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export interface SvarChoice {
  id: string;
  title: string;
  detail?: string;
  meta?: string;
}

/** Valgmuligheder: tiles of 168 (three across); the chosen one white with a 3 px ink ring. */
export function SvarChoices({items, selected}: {items: readonly SvarChoice[]; selected?: string}) {
  return (
    <ul className="grid min-h-0 grid-cols-3 gap-4 overflow-auto">
      {items.map(item => (
        <li key={item.id} aria-current={item.id === selected ? 'true' : undefined}
          className={cx('flex min-h-[168px] flex-col gap-1.5 rounded-[20px] p-5', item.id === selected
            ? 'bg-pv-entry shadow-[inset_0_0_0_3px_#17171A]'
            : 'bg-[rgba(255,255,255,.55)] shadow-[inset_0_0_0_1px_rgba(23,23,26,.06)]')}>
          <span className="text-[22px] font-extrabold wrap-break-word">{item.title}</span>
          {item.detail ? <span className="text-[15px] leading-[1.35] text-pv-ink-2">{item.detail}</span> : null}
          {item.meta ? <span className="mt-auto font-pv-mono text-base font-medium">{item.meta}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Sammenligning: a table; each row the thing compared, its values in Plex Mono under the columns. */
export function SvarComparison({columns, rows}: {columns: readonly {id: string; label: string}[];
  rows: readonly {id: string; label: string; values: readonly string[]}[]}) {
  const template = {gridTemplateColumns: `1.6fr repeat(${String(Math.max(1, columns.length))}, 1fr)`};
  return (
    <div className="flex min-h-0 flex-col overflow-auto" role="table">
      <div role="row" className="grid border-b-2 border-pv-ink pb-3" style={template}>
        <span role="columnheader" />
        {columns.map(column => <span key={column.id} role="columnheader"
          className="text-[15px] font-semibold text-pv-ink-3">{column.label}</span>)}
      </div>
      {rows.map(row => (
        <div key={row.id} role="row" className="grid min-h-[72px] items-center border-b border-[rgba(23,23,26,.08)]"
          style={template}>
          <span role="rowheader" className="text-[20px] font-extrabold wrap-break-word">{row.label}</span>
          {row.values.map((value, index) => (
            <span key={columns[index]?.id ?? index} role="cell" className="font-pv-mono text-[20px] font-medium">
              {value}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Datagraf: a bar per item (40 high, radius 12) to the largest value, the value at the right, the unit below. */
export function SvarChart({items, unit}: {items: readonly {id: string; label: string; value: number;
  text: string}[]; unit?: string}) {
  const max = Math.max(1, ...items.map(item => Math.abs(item.value)));
  return (
    <div className="flex min-h-0 flex-col gap-5 overflow-auto">
      <ul className="flex flex-col gap-5">
        {items.map(item => (
          <li key={item.id} className="grid grid-cols-[160px_1fr_auto] items-center gap-4">
            <span className="text-lg font-bold wrap-break-word">{item.label}</span>
            <span className="relative block h-10 rounded-xl bg-[rgba(23,23,26,.07)]" role="meter"
              aria-valuemin={0} aria-valuemax={max} aria-valuenow={item.value}
              aria-label={`${item.label}: ${item.text}`}>
              <i className="absolute inset-y-0 left-0 block rounded-xl bg-pv-dark"
                style={{width: `${String(Math.round((Math.abs(item.value) / max) * 100))}%`}} />
            </span>
            <span className="text-right font-pv-mono text-[20px] font-medium whitespace-nowrap">{item.text}</span>
          </li>
        ))}
      </ul>
      {unit ? <span className="text-[15px] font-semibold text-pv-ink-3">{`Enhed: ${unit}`}</span> : null}
    </div>
  );
}

/** Trin for trin: the progress bar, »Trin N af M« and the step in 34/1.2. */
export function SvarSteps({steps, index}: {steps: readonly string[]; index: number}) {
  const at = Math.min(Math.max(index, 0), Math.max(steps.length - 1, 0));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="grid gap-1.5" aria-hidden="true"
        style={{gridTemplateColumns: `repeat(${String(Math.max(steps.length, 1))}, minmax(0,1fr))`}}>
        {steps.map((step, i) => <i key={`${String(i)}-${step}`} className={cx('block h-1.5 rounded-[3px]',
          i <= at ? 'bg-pv-dark' : 'bg-[rgba(23,23,26,.14)]')} />)}
      </div>
      <span className="text-[15px] font-semibold text-pv-ink-3">
        {`Trin ${String(at + 1)} af ${String(steps.length)}`}
      </span>
      <p className="max-w-[680px] text-[34px] leading-[1.2] font-bold tracking-[-0.015em] wrap-break-word"
        aria-live="polite">{steps[at] ?? ''}</p>
    </div>
  );
}

/** Tjekliste: rows of 72 that toggle (a 32 box with a ✓; done is struck through). */
export function SvarChecklist({items, onToggle}: {items: readonly {id: string; label: string; checked: boolean}[];
  onToggle: (id: string) => void}) {
  return (
    <ul className="flex min-h-0 flex-col overflow-auto">
      {items.map(item => (
        <li key={item.id}>
          <AriaButton className={cx(pressable, 'flex h-[72px] w-full items-center gap-4 border-b',
            'border-[rgba(23,23,26,.08)] text-left text-[22px] font-bold')} aria-pressed={item.checked}
            data-checked={String(item.checked)} onPress={() => {
              onToggle(item.id);
            }}>
            <span className={cx('flex size-8 flex-none items-center justify-center rounded-[10px]',
              'shadow-[inset_0_0_0_2px_#17171A]', item.checked ? 'bg-pv-dark text-pv-on-dark' : 'text-transparent')}>
              <Glyph name="check" size={18} stroke={3} />
            </span>
            <span className={item.checked ? 'text-pv-ink-3 line-through' : ''}>{item.label}</span>
          </AriaButton>
        </li>
      ))}
    </ul>
  );
}

/** Hjem: the device, its state in 72 and a detail beside a disc in the domain's colour (grey when undone). */
export function SvarHome({glyph, device, state, detail, disc, quiet = false}: {glyph: GlyphName; device: string;
  state: string; detail?: string; disc: string; quiet?: boolean}) {
  return (
    <SvarMedia className="grid grid-cols-[160px_1fr] items-center gap-8">
      <span className={cx('flex size-40 items-center justify-center rounded-full', quiet ? 'bg-pv-line' : disc)}
        aria-hidden="true"><Glyph name={glyph} size={80} stroke={1.4} /></span>
      <span role="status" className="flex min-w-0 flex-col gap-2">
        <span className="text-[17px] leading-6 font-semibold text-pv-ink-2">{device}</span>
        <span className={cx('text-[72px] leading-[72px] font-extrabold tracking-[-0.04em]', quiet && 'text-pv-ink-3')}>
          {state}
        </span>
        {detail ? <span className="text-[17px] leading-6 text-pv-ink-3">{detail}</span> : null}
      </span>
    </SvarMedia>
  );
}

/** The card's K-Btn 56 (Kilder, Se vejret, Åbn afspiller, Forrige/Næste trin). */
export function SvarAction({label, variant = 'sekundaer', icon, expanded, onPress}: {label: string;
  variant?: 'primaer' | 'sekundaer'; icon?: GlyphName | FilledName; expanded?: boolean; onPress: () => void}) {
  return (
    <Button variant={variant} size={56} {...(icon ? {icon} : {})}
      {...(expanded === undefined ? {} : {'aria-expanded': expanded})} onPress={onPress}>{label}</Button>
  );
}

export interface SvarMiniProps {
  id: string;
  tone?: SvarTone;
  icon: GlyphName;
  kind: string;
  time: string;
  title: string;
  question?: string;
  current: boolean;
  live?: boolean;
  /** How the row names itself (the answer's own title), when it differs from the drawn title. */
  name?: string;
  onPress: () => void;
}

const RowButton = motion.create(AriaButton);

/** One answer in »I dag«: the card's anatomy in small (header 24 · title 17/22 in two lines · the question 15). */
export function SvarMini({id, tone = 'svar', icon, kind, time, title, question, current, live, name, onPress}:
  SvarMiniProps) {
  return (
    <RowButton layout="position"
      className={cx(pressable, 'relative flex h-[150px] w-full shrink-0 flex-col items-stretch overflow-hidden rounded-[20px]',
        'p-4 text-left font-pv text-pv-ink data-[pressed]:scale-[.985] data-[pressed]:brightness-[.96]',
        current ? 'bg-pv-entry shadow-[inset_0_0_0_3px_#17171A]'
          : cx(SVAR_TONE[tone].bg, 'shadow-[inset_0_0_0_1px_rgba(23,23,26,.06)]'))}
      data-answer-id={id} data-live={live ? 'true' : undefined}
      {...(current ? {'aria-current': 'true' as const} : {})}
      aria-label={`${kind} · ${name ?? title} · ${time}`} onPress={onPress}>
      <span className="flex h-6 items-center gap-2">
        <Glyph name={icon} size={18} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-pv-ink-2">{kind}</span>
        <time className="font-pv-mono text-[15px] font-medium text-pv-ink-3">{time}</time>
      </span>
      <span className="mt-2 line-clamp-2 text-[17px] leading-[22px] font-bold">{title}</span>
      {question ? <span className="mt-auto truncate text-[15px] leading-5 text-pv-ink-3">{`»${question}«`}</span>
        : null}
    </RowButton>
  );
}

/**
 * »I dag«: the player column's list (372 wide, header 32, rows of 150, 16 apart, newest on top). »↑ N nye svar«
 * floats 8 under the list's top, centred; it never pushes the list and enters over 360 ms.
 */
export function SvarToday({title, children, newer, onNewer, listRef}: {
  title: string;
  children: ReactNode;
  /** »1 nyt svar« / »2 nye svar«, or nothing. */
  newer?: string | null;
  onNewer?: () => void;
  listRef?: React.Ref<HTMLDivElement>;
}) {
  const reduced = useReducedMotion() ?? false;
  const id = useId();
  return (
    <aside className="flex h-full max-h-[696px] w-[372px] min-w-0 flex-none flex-col gap-4 font-pv text-pv-ink"
      aria-labelledby={id}>
      <header className="flex h-8 flex-none items-center justify-between">
        <h2 id={id} className="text-[22px] font-extrabold">{title}</h2>
        <span className="text-[15px] font-semibold text-pv-ink-3">Nyeste øverst</span>
      </header>
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {newer ? (
            <motion.div key="newer" className="absolute top-2 left-1/2 z-3 -translate-x-1/2 rounded-pv-pill
              shadow-[0_10px_24px_-10px_rgba(23,23,26,.55)]"
              initial={reduced ? {opacity: 0} : {opacity: 0, y: -8}} animate={{opacity: 1, y: 0}}
              exit={{opacity: 0}}
              transition={reduced ? TRANSITION.reduced : {...TRANSITION.snappy, opacity: TRANSITION.fade}}>
              <Button variant="primaer" size={44} icon="up" aria-label={`Vis nyeste svar · ${newer}`}
                onPress={() => onNewer?.()}>{newer}</Button>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <motion.div ref={listRef} role="group" aria-labelledby={id} layoutScroll
          className="flex h-full flex-col gap-4 overflow-auto overscroll-contain">
          {children}
        </motion.div>
      </div>
    </aside>
  );
}
