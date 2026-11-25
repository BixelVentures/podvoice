// K-Widget, the kit's one widget (design canvas »PodView Retninger«, K-Widget and W-*): every domain in every state
// has the same anatomy: the head (22-px glyph, the name, a »+N« chip, the chevron), one primary line, one context
// line, the domain's material in the middle, and for Vejr the big temperature and the hours. Sizes S 172×220,
// M 360×220 and L 360×456 (the grid gives the size; `size` sets the type). The domain colour is the surface; the
// state shows in the content, the material's intensity and its motion. Music, radio, recipes and answers are
// entries, not states: always a white surface. The whole widget is one press target (React Aria Button).
import {Button as AriaButton} from 'react-aria-components';
import {pressable} from './Button';
import {ArcsMaterial, BulbMaterial, CarMaterial, CloudMaterial} from './DotMaterial';
import type {CarTone} from './DotMaterial';
import {Fresh} from './Fresh';
import {Glyph} from './glyphs';
import type {GlyphName} from './glyphs';
import {tapOnly} from './tap';
import {cx, tv} from './tv';

export type WidgetKind = 'vejr' | 'robot' | 'lys' | 'tesla' | 'musik' | 'radio' | 'opskrift' | 'timer' | 'svar';
export type WidgetSize = 'S' | 'M' | 'L';

export const WIDGET_STATES = {
  vejr: ['sidstkendt', 'frisk', 'ukendt'],
  robot: ['oplader', 'rengoer', 'pause', 'tilbasen', 'fejl', 'ukendt'],
  lys: ['ikkeforbundet', 'taendt', 'slukket', 'ukendt'],
  tesla: ['sidstkendt', 'lader', 'klima', 'laast', 'ikkeforbundet'],
  // forslag (owner decision 25 Nov): while music plays, today's AI pick as the way to Find musik.
  musik: ['tom', 'ikketilg', 'forslag'],
  radio: ['vaelg', 'spiller', 'starter', 'ikketilg'],
  opskrift: ['igang', 'katalog', 'tom'],
  timer: ['start', 'startTom', 'koerer', 'pause', 'faerdig'],
  svar: ['seneste', 'tom'],
} as const satisfies Record<WidgetKind, readonly string[]>;

export type WidgetState<K extends WidgetKind = WidgetKind> = (typeof WIDGET_STATES)[K][number];

interface Look {
  /** The material: which, its colour (fill-*), opacity (opacity-*) and motion. */
  material?: 'cloud' | 'arcs' | 'arcsBroken' | 'bulb' | 'car';
  fill?: string;
  opacity?: string;
  animate?: string;
  /** Primary and context line colours (text-*), the big value's and the hours' colour. */
  prim?: string;
  ctx?: string;
  big?: string;
  hour?: string;
  /** The car's tone. */
  car?: CarTone;
  /** A grey foreground (a widget whose source is not there). */
  muted?: boolean;
}

const KIND: Record<WidgetKind, {label: string; glyph: GlyphName; size: WidgetSize; surface: string; base: Look}> = {
  vejr: {label: 'Vejr', glyph: 'cloud', size: 'L', surface: 'bg-pv-weather',
    base: {material: 'cloud', fill: 'fill-pv-weather-dot', ctx: 'text-pv-weather-line', hour: 'text-pv-weather-hour'}},
  robot: {label: 'Robotstøvsuger', glyph: 'robot', size: 'M', surface: 'bg-pv-robot',
    base: {material: 'arcs', fill: 'fill-pv-robot-dot', ctx: 'text-pv-robot-line'}},
  lys: {label: 'Lys', glyph: 'bulb', size: 'S', surface: 'bg-pv-light',
    base: {material: 'bulb', fill: 'fill-pv-light-dot'}},
  tesla: {label: 'Tesla', glyph: 'car', size: 'S', surface: 'bg-pv-tesla', base: {material: 'car'}},
  musik: {label: 'Musik', glyph: 'music', size: 'S', surface: 'bg-pv-entry', base: {}},
  radio: {label: 'Radio', glyph: 'radio', size: 'S', surface: 'bg-pv-entry', base: {}},
  opskrift: {label: 'Opskrifter', glyph: 'recipe', size: 'S', surface: 'bg-pv-entry', base: {}},
  timer: {label: 'Timer', glyph: 'timer', size: 'S', surface: 'bg-pv-dark',
    base: {material: 'arcs', fill: 'fill-pv-timer-accent', opacity: 'opacity-40', prim: 'text-pv-on-dark',
      ctx: 'text-pv-on-dark-3'}},
  svar: {label: 'Svar', glyph: 'answer', size: 'S', surface: 'bg-pv-entry', base: {}},
};

// Each state's look (K-Widget's state table): only what differs from the domain's own.
const LOOK: {[K in WidgetKind]: Record<WidgetState<K>, Look>} = {
  vejr: {
    sidstkendt: {},
    frisk: {},
    ukendt: {opacity: 'opacity-20', big: 'text-pv-grey', prim: 'text-pv-ink-3', ctx: 'text-pv-ink-3'},
  },
  robot: {
    oplader: {opacity: 'opacity-55'},
    rengoer: {animate: 'animate-pv-inward'},
    pause: {opacity: 'opacity-70'},
    tilbasen: {animate: 'animate-pv-inward', opacity: 'opacity-80'},
    fejl: {material: 'arcsBroken', fill: 'fill-pv-grey', opacity: 'opacity-45'},
    ukendt: {fill: 'fill-pv-grey', opacity: 'opacity-35', prim: 'text-pv-ink-3', ctx: 'text-pv-ink-3'},
  },
  lys: {
    ikkeforbundet: {prim: 'text-pv-muted', fill: 'fill-pv-light-dot-off', opacity: 'opacity-50'},
    taendt: {prim: 'text-pv-light-on', ctx: 'text-pv-light-on'},
    slukket: {fill: 'fill-pv-light-dot-off', opacity: 'opacity-35'},
    ukendt: {prim: 'text-pv-muted', fill: 'fill-pv-light-dot-off', opacity: 'opacity-30'},
  },
  tesla: {
    sidstkendt: {prim: 'text-pv-tesla-known', car: 'unknown'},
    // Black text everywhere (G7 ruling): the tint and the car carry the live state, never green words.
    lader: {car: 'charging'},
    klima: {car: 'climate'},
    laast: {car: 'parked'},
    ikkeforbundet: {prim: 'text-pv-ink-3', car: 'unknown'},
  },
  musik: {tom: {}, ikketilg: {}, forslag: {}},
  radio: {vaelg: {}, spiller: {}, starter: {}, ikketilg: {muted: true, prim: 'text-pv-grey', ctx: 'text-pv-grey'}},
  opskrift: {igang: {}, katalog: {}, tom: {prim: 'text-pv-ink-3'}},
  timer: {
    start: {},
    startTom: {},
    koerer: {animate: 'animate-pv-inward', opacity: 'opacity-60'},
    pause: {},
    faerdig: {animate: 'animate-pv-pulse', opacity: 'opacity-90', prim: 'text-pv-timer-accent'},
  },
  svar: {seneste: {}, tom: {prim: 'text-pv-ink-3'}},
};

export function widgetLook<K extends WidgetKind>(kind: K, state: WidgetState<K>): Look {
  return {...KIND[kind].base, ...(LOOK[kind] as Record<string, Look>)[state]};
}

export interface WidgetHour {
  time: string;
  value: string;
  glyph: GlyphName;
}

export interface WidgetProps<K extends WidgetKind = WidgetKind> {
  kind: K;
  state: WidgetState<K>;
  /** The type size; the grid cell gives the box. Defaults to the domain's slot (Vejr L, Robot M, the rest S). */
  size?: WidgetSize;
  /** `hvid`: a calmer overview, the surface in paper white; the domain is carried by its material and glyph. */
  tone?: 'farve' | 'hvid';
  /** The head's name (defaults to the domain's). */
  label?: string;
  /** More units than the widget shows (»+N«). */
  more?: number;
  prim: string;
  ctx?: string;
  /** A coloured dot before the context line (an alert is a dot, never coloured text): a fill-* or bg-* class. */
  alert?: 'warning' | 'error';
  /** Vejr: the big temperature and the five hours. */
  big?: string;
  hours?: WidgetHour[];
  /** Tesla: the battery level (0–1) the car's body is filled to. */
  level?: number;
  /** Recipe progress: one segment per step (done, current, ahead). */
  steps?: {total: number; current: number};
  /** The 64-px picture at right 20 / top 66: a cover or a logo, an icon tile, or Timer's ring (0–1 done). */
  cover?: string | null;
  logo?: string | null;
  tile?: GlyphName;
  ring?: number;
  /** The most lines the primary line may take: 3 lets it wrap (Musik's AI pick, titles up to 48 characters) at 16/20
   *  in the space the context line leaves (it is left out). Never an ellipsis. */
  primLines?: 1 | 3;
  /** K-Fresh's words for data over 30 minutes old (»Opdateret 15.48«): a badge in the head, never inline text. */
  fresh?: string | null;
  /** A direct action beside the primary line (Robot's »Pause«/»Fortsæt«): its own press, never the widget's. */
  action?: {label: string; onPress: () => void};
  /** The screen the widget opens (data-opens, prewarm), its id and its accessible name's extra words. */
  opens?: string;
  id?: string;
  description?: string;
  onPress?: () => void;
  className?: string;
}

const surface = tv({
  base: [
    pressable,
    'relative flex size-full min-w-0 flex-col overflow-hidden rounded-pv-widget p-5 text-left font-pv shadow-pv-edge',
    'group-data-[link=offline]/host:opacity-55',
  ],
});

const TILE: Partial<Record<WidgetKind, string>> = {
  radio: 'bg-pv-radio',
  opskrift: 'bg-pv-recipe',
  musik: 'bg-pv-music',
};

function Picture({kind, state, cover, logo, tile, ring}: Pick<WidgetProps, 'kind' | 'state' | 'cover' | 'logo' |
  'tile' | 'ring'>) {
  if (ring !== undefined) {
    const length = 2 * Math.PI * 26;
    return (
      <svg className="absolute top-[66px] right-[22px]" width={64} height={64} viewBox="0 0 64 64" aria-hidden="true">
        <circle cx={32} cy={32} r={26} fill="none" className="stroke-pv-timer-track" strokeWidth={7} />
        <circle cx={32} cy={32} r={26} fill="none" strokeWidth={7} strokeLinecap="round" transform="rotate(-90 32 32)"
          className={cx('stroke-pv-timer-accent', state === 'faerdig' && 'animate-pv-pulse motion-reduce:animate-none')}
          strokeDasharray={`${(length * Math.max(0, Math.min(1, ring))).toFixed(1)} ${length.toFixed(1)}`} />
      </svg>
    );
  }
  if (cover) {
    return <img className="absolute top-[66px] right-5 size-16 rounded-xl object-cover
      shadow-[0_10px_20px_-10px_rgba(23,23,26,.5)]" src={cover} alt="" decoding="async" draggable={false} />;
  }
  if (logo) {
    return <img className="absolute top-[66px] right-5 size-16 rounded-pv-s" src={logo} alt="" draggable={false} />;
  }
  if (tile) {
    const muted = (kind === 'radio' && state === 'ikketilg') || (kind === 'opskrift' && state === 'tom');
    return (
      <span className={cx('absolute top-[66px] right-5 grid size-16 place-items-center rounded-pv-s text-pv-ink',
        muted ? 'bg-pv-placeholder opacity-60' : TILE[kind] ?? 'bg-pv-music')} aria-hidden="true">
        <Glyph name={tile} size={30} stroke={1.7} />
      </span>
    );
  }
  return null;
}

export function Widget<K extends WidgetKind>(props: WidgetProps<K>) {
  const {kind, state, tone = 'farve', more = 0, prim, ctx = '', alert, big, hours, level = 0, steps, opens, id,
    description, onPress, className, action, fresh, primLines = 1} = props;
  const wrap = primLines === 3;
  const meta = KIND[kind];
  const look = widgetLook(kind, state);
  const size = props.size ?? meta.size;
  const small = size === 'S';
  const label = props.label ?? meta.label;
  const white = tone === 'hvid' && kind !== 'timer';
  const unit = kind === 'robot' ? ['robot', 'robotter'] : kind === 'lys' ? ['rum', 'rum'] : ['enhed', 'enheder'];
  const moreLabel = more ? `, ${String(more)} ${more === 1 ? (unit[0] ?? '') : (unit[1] ?? '')} mere` : '';
  const name = [`${label}, ${prim}${moreLabel}`, description, fresh].filter(Boolean).join(' · ');
  const materialClass = cx(look.fill, look.opacity);
  const widget = (
    <AriaButton
      {...(id ? {id} : {})}
      className={cx(surface(), white ? 'bg-pv-entry' : meta.surface,
        kind === 'timer' ? 'text-pv-on-dark' : look.muted ? 'text-pv-grey' : 'text-pv-ink', className)}
      aria-label={name}
      data-kind={kind}
      data-state={state}
      data-opens={opens}
      {...(onPress ? {onPress: tapOnly(onPress)} : {})}
    >
      {look.material === 'cloud' ? <CloudMaterial className={materialClass} /> : null}
      {look.material === 'arcs' || look.material === 'arcsBroken' ? (
        <ArcsMaterial className={materialClass} broken={look.material === 'arcsBroken'}
          {...(look.animate ? {animate: look.animate} : {})} />
      ) : null}
      {look.material === 'bulb' ? <BulbMaterial className={materialClass} /> : null}
      {look.material === 'car' ? <CarMaterial level={level} tone={look.car ?? 'parked'} /> : null}
      <Picture kind={kind} state={state} {...pick(props)} />
      <span className="relative z-2 flex h-[26px] items-center gap-2">
        <Glyph name={meta.glyph} size={22} stroke={1.7} />
        <span className={cx('min-w-0 truncate font-semibold', small ? 'text-base' : 'text-[17px]',
          more || fresh ? '' : 'flex-1')} data-widget-title="">{label}</span>
        {fresh ? <Fresh text={fresh} solid className="-my-[3px] ml-auto flex-none" /> : null}
        {more ? (
          <b className="ml-auto inline-flex h-[26px] min-w-[26px] flex-none items-center justify-center rounded-pv-pill
            bg-pv-ink/8 px-2 text-[15px] font-bold tabular-nums">{`+${String(more)}`}</b>
        ) : null}
        {/* The chevron's glyph is drawn in its middle 6 px: its empty left edge may sit under the title's end, so an S
            title (»Opskrifter«) stands whole. */}
        <Glyph name="chevron" size={20} stroke={2} className="-ml-1.5" />
      </span>
      {big ? (
        <span className={cx('relative z-2 mt-[22px] text-[120px] leading-[.85] font-medium tracking-[-0.06em]',
          look.big ?? 'text-pv-ink')}>{big}</span>
      ) : null}
      <span className={cx('flex flex-col', kind === 'vejr' ? 'mt-5' : 'mt-auto')}>
        {steps ? (
          <span className="relative z-2 mb-3 grid gap-1" role="img"
            style={{gridTemplateColumns: `repeat(${String(steps.total)}, minmax(0, 1fr))`}}
            aria-label={`Trin ${String(steps.current)} af ${String(steps.total)}`}>
            {Array.from({length: steps.total}, (_, index) => (
              <i key={index} className={cx('block h-1.5 rounded-[3px]', index + 1 < steps.current ? 'bg-pv-recipe-ink'
                : index + 1 === steps.current ? 'bg-pv-recipe-now' : 'bg-pv-recipe-ahead')} />
            ))}
          </span>
        ) : null}
        <span className="flex items-end gap-4">
        <span className="relative z-2 flex min-w-0 flex-1 flex-col">
          <span className={cx('font-extrabold tracking-[-0.015em]',
            wrap ? 'max-h-[60px] overflow-hidden text-base leading-5 break-words'
              : cx('h-[26px] truncate leading-[26px]', small ? 'text-lg' : 'text-xl'), look.prim)}
            data-widget-prim={wrap ? 'wrap' : ''}>{prim}</span>
          <span className={cx('mt-1 h-5 truncate text-[15px] leading-5', look.ctx ?? 'text-pv-ink-3')}
            data-widget-ctx="" hidden={wrap}>
            {alert ? (
              <i className={cx('mr-1.5 inline-block size-2 rounded-full align-[1px]',
                alert === 'error' ? 'bg-pv-danger' : 'bg-pv-alert')} />
            ) : null}
            {ctx}
          </span>
        </span>
        {action ? <span className={cx(ACTION, 'invisible')} aria-hidden="true">{action.label}</span> : null}
        </span>
      </span>
      {hours?.length ? (
        <span className="relative z-2 mt-auto grid grid-cols-5 border-t border-pv-ink/8 pt-[18px]">
          {hours.slice(0, 5).map(hour => (
            <span key={hour.time} className="flex flex-col items-center gap-2">
              <span className="text-[15px] text-pv-weather-line">{hour.time}</span>
              <Glyph name={hour.glyph} size={24} stroke={1.6} />
              <span className={cx('text-[19px] font-extrabold', look.hour)}>{hour.value}</span>
            </span>
          ))}
        </span>
      ) : null}
    </AriaButton>
  );
  if (!action) return widget;
  // The action lies over the reserved place at the bottom right: a sibling of the widget's press, not inside it.
  return (
    <div className="relative grid size-full">
      <div className="col-start-1 row-start-1 min-h-0 min-w-0">{widget}</div>
      <AriaButton className={cx(pressable, ACTION, 'z-3 col-start-1 row-start-1 m-5 self-end justify-self-end',
        'data-[pressed]:brightness-[.92]')} onPress={tapOnly(action.onPress)}>
        {action.label}
      </AriaButton>
    </div>
  );
}

const ACTION = 'flex h-14 shrink-0 items-center rounded-pv-pill bg-pv-ink px-6 text-[17px] font-semibold ' +
  'text-pv-on-dark';

function pick({cover, logo, tile, ring}: WidgetProps): Pick<WidgetProps, 'cover' | 'logo' | 'tile' | 'ring'> {
  return {
    ...(cover ? {cover} : {}),
    ...(logo ? {logo} : {}),
    ...(tile ? {tile} : {}),
    ...(ring !== undefined ? {ring} : {}),
  };
}

export const WIDGET_KINDS = Object.keys(KIND) as WidgetKind[];
export const widgetLabel = (kind: WidgetKind) => KIND[kind].label;
