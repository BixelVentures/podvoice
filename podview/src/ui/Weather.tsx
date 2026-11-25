// A-Vejr's pieces (design canvas »PodView Retninger«, A-Vejr and Vejr-Ukendt): the full-colour hero (536 high: the
// place and the freshness chip, the 150-px temperature, the condition line, the advice slot, »Højst · Lavest«, a
// compact notice when Home Assistant is away, and the hourly row with rain and wind that runs on under a fade at the
// right edge), the »De næste dage« card with range bars, and the weather-type dot art behind the hero. Presentational:
// the screen gives the words, the kit gives the look. Nothing moves on first paint; the advice fades in over 240 ms
// when it arrives; the art's ambient motion stills with reduced motion or while the screen waits out of sight.
import {motion, useReducedMotion} from 'motion/react';
import type {TargetAndTransition, Transition} from 'motion/react';
import {useShown} from '../lib/motion/shown';
import {Fresh} from './Fresh';
import {Notice} from './Notice';
import {cx} from './tv';

export type WeatherArtTone = 'neutral' | 'clear' | 'partlycloudy' | 'cloudy' | 'rain' | 'snow' | 'fog' | 'wind' |
  'storm';

const loop = (seconds: number, extra: Transition = {}): Transition =>
  ({duration: seconds, ease: 'easeInOut', repeat: Infinity, ...extra});

// Each weather type's dot art (the same dots and the same blue, Vejr-Shadere) and its calm movement. The bitmaps are
// 2× rasters of the dot vectors (build/raster-weather.cjs: WebKit would rasterize masked vectors on every repaint).
const ART: Partial<Record<WeatherArtTone, {image: string; animate?: TargetAndTransition; transition?: Transition}>> = {
  clear: {
    image: 'bg-[url(/assets/weather/raster/weather-sun.webp)]',
    animate: {opacity: [0.32, 0.45, 0.32], transform: ['scale(0.9)', 'scale(1.08)', 'scale(0.9)']},
    transition: loop(3),
  },
  rain: {image: 'bg-[url(/assets/weather/raster/weather-rain.webp)]'},
  snow: {image: 'bg-[url(/assets/weather/raster/weather-snow.webp)]'},
  fog: {
    image: 'bg-[url(/assets/weather/raster/weather-fog.webp)]',
    animate: {opacity: [0.16, 0.38]},
    transition: loop(7, {repeatType: 'reverse'}),
  },
  storm: {
    image: 'bg-[url(/assets/weather/raster/weather-storm.webp)]',
    // A flash now and then: dim, then lit for a moment, then dim again.
    animate: {opacity: [0.16, 0.16, 0.45, 0.45, 0.16, 0.16]},
    transition: {duration: 4, ease: 'linear', repeat: Infinity, times: [0, 0.9, 0.9001, 0.94, 0.9401, 1]},
  },
};
const DRIFT = {
  animate: {transform: ['translateX(0px)', 'translateX(14px)']},
  transition: loop(6, {repeatType: 'reverse'}),
};

/** The hero's dot art for a weather type; `faded` is the unknown state's 20 % (the material steps back). */
export function WeatherArt({tone, faded = false}: {tone: WeatherArtTone; faded?: boolean}) {
  const reduced = useReducedMotion() ?? false;
  const shown = useShown();
  const art = ART[tone];
  const drifts = tone === 'cloudy' || tone === 'partlycloudy' || tone === 'wind';
  const moves = faded || reduced || !shown ? null : drifts ? DRIFT : art?.animate ? art : null;
  return (
    <motion.div
      // A new condition starts its own movement from its resting look.
      key={`${tone}-${String(faded)}-${String(!!moves)}`}
      aria-hidden="true"
      data-weather-art={tone}
      className={cx(
        'pointer-events-none absolute top-0 right-0 z-0 bg-size-[100%_100%] bg-no-repeat',
        art ? 'h-[300px] w-[380px]' : 'h-[360px] w-[470px]',
        art?.image ?? 'bg-[url(/assets/weather/raster/weather-cloud.webp)]',
        faded ? 'opacity-9' : 'opacity-45',
      )}
      {...(moves ? {animate: moves.animate, transition: moves.transition} : {})}
    />
  );
}

export interface WeatherHourCell {
  id: string;
  time: string;
  /** The condition's icon (an assets/icons path), or null: the place stays. */
  icon: string | null;
  condition: string;
  temperature: string;
  /** »0,4 mm · 60 %« or »10 %«; empty keeps the line's height. */
  rain: string;
  /** »6,2 m/s«; empty keeps the line's height. */
  wind: string;
  /** The wind's direction as the arrow's rotation (degrees), or null: no arrow. */
  windDegrees: number | null;
  /** The hour as a sentence for assistive technology. */
  label: string;
}

export type WeatherAdvice =
  | {state: 'none'}
  | {state: 'pending'; label: string}
  | {state: 'text'; text: string; ai: boolean; muted?: boolean; label?: string};

export interface WeatherHeroProps {
  /** The place (»Mårslet«): the screen's heading. */
  place: string;
  placeId?: string;
  /** K-Fresh's words when the data is older than 30 minutes (»Opdateret 11.02«), else null. */
  fresh?: string | null;
  /** The big temperature (»5°«), or »—« when unknown (`unknown` greys it). */
  big: string;
  unknown?: boolean;
  /** The condition line (»Skyet«, or »Skyet · Overvej en varm jakke.« with the rule sentence). */
  line: string;
  advice: WeatherAdvice;
  /** »Højst 5° · Lavest 4°« (or the source when nothing is known). */
  sub: string;
  /** Home Assistant is away: the compact info notice in the hero (the hybrid rule), nothing below moves. */
  notice?: string | null;
  tone: WeatherArtTone;
  hours: WeatherHourCell[];
  hoursLabel: string;
  /** The screen's state for tests and styling hooks. */
  state?: 'current' | 'stale' | 'empty';
}

function HourCell({hour}: {hour: WeatherHourCell}) {
  // A missing rain or wind keeps its line, so the hours stay in step.
  const small = 'flex h-5 items-center justify-center gap-1 text-[15px] leading-5 whitespace-nowrap ' +
    'text-pv-weather-ink';
  return (
    <div role="listitem" aria-label={hour.label} className="flex snap-start flex-col items-center gap-2">
      <span className="font-pv-mono text-[16px] leading-5 font-medium text-pv-weather-line">{hour.time}</span>
      {hour.icon ? (
        <img className="size-7" src={hour.icon} alt="" draggable={false} />
      ) : (
        <span className="size-7" aria-hidden="true" />
      )}
      <span className="text-[22px] leading-7 font-extrabold text-pv-weather-deep">{hour.temperature}</span>
      <span className={cx(small, !hour.rain && 'invisible')}>{hour.rain}</span>
      <span className={cx(small, '-mt-1', !hour.wind && hour.windDegrees === null && 'invisible')}>
        {hour.windDegrees !== null ? (
          <i aria-hidden="true" className="inline-block w-3 text-center not-italic"
            style={{transform: `rotate(${String(hour.windDegrees)}deg)`}}>↑</i>
        ) : null}
        {hour.wind}
      </span>
    </div>
  );
}

function Advice({advice}: {advice: WeatherAdvice}) {
  const reduced = useReducedMotion() ?? false;
  const shown = useShown();
  if (advice.state === 'none') return null;
  const bar = 'block h-4 rounded-[8px] bg-linear-to-r from-pv-weather-ink/10 via-pv-weather-ink/20 ' +
    'to-pv-weather-ink/10';
  const breathe = reduced || !shown ? {} : {animate: {opacity: [0.5, 1, 0.5]},
    transition: {duration: 1.6, ease: 'easeInOut' as const, repeat: Infinity}};
  return (
    <div className="relative mt-2 h-12 w-[540px] max-w-full overflow-hidden" aria-live="polite">
      {advice.state === 'pending' ? (
        <div aria-label={advice.label} role="status" className="flex flex-col gap-2 pt-1">
          <motion.i className={cx(bar, 'w-[92%]')} {...breathe} />
          <motion.i className={cx(bar, 'w-[68%]')} {...breathe} />
        </div>
      ) : (
        <motion.p
          key={advice.text}
          className={cx('m-0 text-[17px] leading-6', advice.muted ? 'text-pv-weather-line' : 'text-pv-ink')}
          // The advice tones in over 240 ms when it arrives (A-Vejr advIn); on first paint it simply stands.
          initial={reduced ? false : {opacity: 0, y: 4}}
          animate={{opacity: 1, y: 0}}
          transition={{duration: 0.24, ease: [0.2, 0, 0, 1]}}
          {...(advice.label ? {'aria-label': `${advice.label}: ${advice.text}`} : {})}
        >
          {advice.ai ? (
            <span aria-hidden="true" className={'mt-0.5 mr-2 inline-flex h-5 rounded-pv-pill bg-pv-surface px-2 ' +
              'align-top text-[15px] leading-5 font-semibold text-pv-weather-ink'}>AI</span>
          ) : null}
          {advice.text}
        </motion.p>
      )}
    </div>
  );
}

export function WeatherHero(props: WeatherHeroProps) {
  const {place, placeId, fresh, big, unknown = false, line, advice, sub, notice, tone, hours, hoursLabel,
    state = 'current'} = props;
  return (
    <div
      className={cx('relative isolate flex h-[536px] flex-none flex-col overflow-hidden rounded-pv-widget',
        'bg-pv-weather p-8 text-pv-ink shadow-pv-edge')}
      data-weather-state={state}
      data-weather-tone={tone}
    >
      <WeatherArt tone={tone} faded={unknown} />
      <div className="relative flex items-center justify-between">
        <h1 id={placeId} className="m-0 text-[17px] leading-[normal] font-semibold text-pv-weather-line">{place}</h1>
        {fresh ? <Fresh text={fresh} solid /> : null}
      </div>
      <span className={cx('relative mt-2 text-[150px] leading-[.85] font-medium tracking-[-0.065em]',
        unknown ? 'text-pv-ink-3' : 'text-pv-weather-deep')} data-weather="temperature">{big}</span>
      <span className="relative mt-6 text-[26px] leading-8 font-extrabold" data-weather="condition">{line}</span>
      <Advice advice={advice} />
      <span className="relative mt-2 text-[17px] leading-6 text-pv-weather-line" data-weather="range">{sub}</span>
      {notice ? (
        <span className="relative mt-3 block h-10">
          <Notice level="info" title={notice} compact className="w-[520px]" />
        </span>
      ) : null}
      {hours.length ? (
        <div
          role="list"
          tabIndex={0}
          aria-label={hoursLabel}
          className={cx(
            // It runs on to the hero's right edge, under the fade, and snaps hour by hour.
            'relative -mr-8 mt-auto grid auto-cols-[156px] grid-flow-col overflow-x-auto overflow-y-hidden',
            'snap-x snap-mandatory overscroll-x-contain border-t border-pv-ink/10 pt-5 pr-8 pb-7',
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            '[mask-image:linear-gradient(90deg,#000_78%,transparent)]',
            unknown && 'opacity-30',
          )}
        >
          {hours.map(hour => <HourCell key={hour.id} hour={hour} />)}
        </div>
      ) : null}
    </div>
  );
}

export interface WeatherDayRow {
  id: string;
  day: string;
  icon: string | null;
  condition: string;
  low: string;
  high: string;
  /** The range bar's start and length in % of the week's span, or null: no bar. */
  start: number | null;
  length: number | null;
  label: string;
}

/** »De næste dage«: one card of 64-px rows (day, icon, range bar, low, high) and the credit line under it. */
export function WeatherDays({days, credit, creditId}: {days: WeatherDayRow[]; credit: string; creditId?: string}) {
  return (
    <section className="flex flex-col gap-4" aria-label="Vejrudsigt for de næste dage">
      <h2 className="m-0 px-1 text-[24px] leading-[normal] font-extrabold">De næste dage</h2>
      {days.length ? (
        <div className="rounded-pv-widget bg-pv-surface px-6 py-2 shadow-pv-edge" role="list">
          {days.map(day => {
            const bar = day.start !== null && day.length !== null && Number.isFinite(day.start) &&
              Number.isFinite(day.length);
            return (
              <div key={day.id} role="listitem" aria-label={day.label}
                className={'grid h-[65px] grid-cols-[120px_40px_minmax(0,1fr)_60px_60px] items-center gap-4 border-b ' +
                  'border-pv-ink/7'}>
                <span className="truncate text-[18px] font-bold">{day.day}</span>
                {day.icon ? <img className="size-7" src={day.icon} alt="" draggable={false} />
                  : <span className="size-7" aria-hidden="true" />}
                <span className="relative h-2 rounded-[4px] bg-pv-bg">
                  {bar ? (
                    <i className="absolute inset-y-0 block rounded-[4px] bg-linear-to-r from-pv-weather-soft
                      to-pv-weather-deep" style={{left: `${String(day.start)}%`, width: `${String(day.length)}%`}} />
                  ) : null}
                </span>
                <span className="text-right text-[18px] text-pv-ink-3">{day.low}</span>
                <span className="text-right text-[18px] font-extrabold">{day.high}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      {credit ? <p id={creditId} className="m-0 px-1 text-[15px] whitespace-pre-line text-pv-ink-3">{credit}</p>
        : null}
    </section>
  );
}

// The canvas's fold: the next section peeks out under the fixed player and fades (A-Vejr: 48 px at the column's
// bottom edge). A screen that scrolls puts it last in its column.
export function ColumnFade() {
  return (
    <div aria-hidden="true" className="pointer-events-none sticky bottom-0 z-[4] -mt-12 h-12 shrink-0
      bg-linear-to-b from-pv-bg/0 to-pv-bg" />
  );
}
