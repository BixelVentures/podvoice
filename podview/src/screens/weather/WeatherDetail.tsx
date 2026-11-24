// Vejr: the weather detail screen: the hero (temperature, condition, advice), the next hours and the next days.
// React keys keep each hour, day and metadata row as the same element across updates (no rebuild, no blink); an
// unchanged model writes nothing to the DOM. The hero's decoration is a 2× bitmap of the condition's artwork
// (build/raster-weather.cjs: WebKit would rasterize the masked vectors again on every repaint) and moves with
// motion/react; with reduced motion, or while Vejr waits out of sight, it stands still.
import {motion, useReducedMotion} from 'motion/react';
import type {TargetAndTransition, Transition} from 'motion/react';
import {useShown} from '../../lib/motion/shown';
import {TRANSITION} from '../../lib/motion/tokens';
import {LastKnown} from '../../panel/ui';
import {cx} from '../../ui';
import {windFrom} from './observation.ts';
import {hasWeatherFacts} from './model';
import type {WeatherDay, WeatherDetailModel, WeatherHour, WeatherTone} from './model';

// Number ranges read with an en dash (»12–15 min.«, »kl. 14–15«); dates stay untouched.
const RANGE = /(?<![\d.,:-])(\d{1,3}(?:[.,]\d+)?) ?- ?(\d{1,3}(?:[.,]\d+)?)(?![\d-])/g;
const rangeDash = (text: string) => text.replace(RANGE, '$1–$2');

const iconUrl = (file: string) => `assets/icons/${file}.svg`;

const loop = (seconds: number, extra: Transition = {}): Transition =>
  ({duration: seconds, ease: 'easeInOut', repeat: Infinity, ...extra});

// The decoration of each condition: its artwork and its ambient movement. The bitmaps are named whole, so the
// stylesheet links them and the build copies them.
const ART: Partial<Record<WeatherTone, {image: string; animate?: TargetAndTransition; transition?: Transition}>> = {
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

function Decoration({tone, empty}: {tone: WeatherTone; empty: boolean}) {
  const reduced = useReducedMotion() ?? false;
  const shown = useShown();
  const art = ART[tone];
  const drifts = tone === 'cloudy' || tone === 'partlycloudy' || tone === 'wind';
  const moves = empty || reduced || !shown ? null : drifts ? DRIFT : art?.animate ? art : null;
  return (
    <motion.div
      // A new condition starts its own movement from its resting look.
      key={`${tone}-${String(empty)}-${String(!!moves)}`}
      aria-hidden="true"
      className={cx(
        'pointer-events-none absolute top-0 right-0 z-0 bg-size-[100%_100%] bg-no-repeat',
        art ? 'h-[300px] w-[380px]' : 'h-[360px] w-[470px]',
        art?.image ?? 'bg-[url(/assets/weather/raster/weather-cloud.webp)]',
        empty ? 'opacity-9' : 'opacity-45',
      )}
      {...(moves ? {animate: moves.animate, transition: moves.transition} : {})}
    />
  );
}

function HourRow({hour}: {hour: WeatherHour}) {
  const direction = windFrom(hour.windBearing);
  const windLabel = hour.windSpeed || hour.wind || '';
  const windDescription = [hour.wind, hour.windSpeed, direction?.label].filter(Boolean).join(' · ');
  const label = [hour.time, hour.condition, hour.temperature, hour.rain ? `Regn ${hour.rain}` : '', windDescription]
    .filter(Boolean)
    .join(', ');
  // A missing rain or wind keeps its line, so the hours stay in step.
  const small = 'flex h-5 items-center justify-center gap-1 text-pv-meta whitespace-nowrap text-pv-weather-ink';
  return (
    <div role="group" aria-label={label} className="flex w-[156px] snap-start flex-col items-center gap-pv-s1">
      <span className="font-pv-mono text-[16px] leading-5 font-medium whitespace-nowrap text-pv-weather-deep">
        {hour.time}
      </span>
      {hour.icon ? <img className="size-7" src={iconUrl(hour.icon)} alt={hour.condition} /> : null}
      <strong className="text-[22px] leading-7 font-extrabold whitespace-nowrap text-pv-weather-deep">
        {hour.temperature}
      </strong>
      <small className={cx(small, !hour.rain && 'invisible')}>{hour.rain}</small>
      <small
        className={cx(small, '-mt-1 max-w-full self-stretch text-center', !windLabel && !direction && 'invisible')}
        title={windDescription}
      >
        <span className="block max-w-full truncate">{windLabel}</span>
        {direction ? (
          <span
            className="order-first block w-3 shrink-0 leading-[15px]"
            role="img"
            aria-label={direction.label}
            style={{transform: `rotate(${String(direction.degrees)}deg)`}}
          >
            ↑
          </span>
        ) : null}
      </small>
    </div>
  );
}

function DayRow({day, first, last}: {day: WeatherDay; first: boolean; last: boolean}) {
  const range = day.start !== null && day.length !== null && Number.isFinite(day.start) && Number.isFinite(day.length);
  const label = [
    day.day,
    day.high ? `lavest ${day.low}, højst ${day.high}` : `temperaturprognose ${day.low}`,
    day.condition,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    // The days read as one card: the first and last rows round it and close the gap the radius leaves.
    <div
      role="group"
      aria-label={label}
      className={cx(
        'grid h-16 grid-cols-[120px_40px_minmax(0,1fr)_60px_60px] items-center gap-pv-s2 border-b',
        'border-pv-ink/7 bg-pv-surface px-pv-s3 text-pv-meta',
        first && last ? 'rounded-[24px]' : first ? 'rounded-t-[24px] shadow-[0_-8px_0_var(--color-pv-surface)]'
          : last ? 'rounded-b-[24px] shadow-[0_8px_0_var(--color-pv-surface)]' : '',
      )}
    >
      <strong className="col-start-1 min-w-0 truncate text-[18px] leading-6 font-bold">{day.day}</strong>
      <img
        className="col-start-2 size-7 justify-self-center"
        src={iconUrl(day.icon || 'dash')}
        alt={day.condition || 'Vejrtype ikke oplyst'}
      />
      <span className="col-start-4 row-start-1 text-right text-[18px] leading-6 whitespace-nowrap text-pv-ink-3">
        {day.low}
      </span>
      {range ? (
        <span className="relative col-start-3 row-start-1 h-2 overflow-hidden rounded-[4px] bg-pv-bg">
          <span
            className="absolute inset-y-0 rounded-[4px] bg-linear-to-r from-pv-weather-soft to-pv-weather-deep"
            style={{left: `${String(day.start)}%`, width: `${String(day.length)}%`}}
          />
        </span>
      ) : null}
      {day.high ? (
        <strong className="col-start-5 row-start-1 text-right text-[18px] leading-6 font-extrabold whitespace-nowrap">
          {day.high}
        </strong>
      ) : null}
    </div>
  );
}

// The advice while it is on its way: two lines that breathe (still with reduced motion, or out of sight).
function AdvicePending() {
  const reduced = useReducedMotion() ?? false;
  const shown = useShown();
  const bar = 'absolute left-0 h-4 rounded-[8px] bg-linear-to-r from-pv-weather-ink/10 via-pv-weather-ink/20 ' +
    'to-pv-weather-ink/10';
  const breathe = reduced || !shown ? {} : {animate: {opacity: [0.5, 1, 0.5]}, transition: TRANSITION.ambient()};
  return (
    <>
      <motion.span aria-hidden="true" className={cx(bar, 'top-1 w-[92%]')} {...breathe} />
      <motion.span aria-hidden="true" className={cx(bar, 'top-7 w-[68%]')} {...breathe} />
    </>
  );
}

export function WeatherDetail({model}: {model: WeatherDetailModel}) {
  const reduced = useReducedMotion() ?? false;
  const facts = hasWeatherFacts(model);
  const tone = model.appearance?.tone ?? 'neutral';
  const metadata = [
    ...(model.sourceStale && facts && !model.metadata?.some(row => row.id === 'weather-retrieved')
      ? [{id: 'freshness', label: 'Status', value: model.updated || 'Ikke opdateret'}]
      : []),
    ...(model.metadata ?? []),
  ];
  const message = !!model.connectionReason && !facts;
  const current = model.current;
  const stale = !!current && !!model.sourceStale;
  // Stale weather says how old it is in a pill on the hero; the other facts stay in the model.
  const freshness = stale ? metadata.filter(row => row.id === 'weather-retrieved' || row.id === 'freshness') : [];
  const conditionAdvice = (current && model.conditionAdvice) || '';
  const summaryState = model.summaryState ?? null;
  const summaryVisible = !!model.summary || summaryState === 'idle' || summaryState === 'pending';
  const waiting = summaryState === 'idle' || summaryState === 'pending';
  const ai = !!model.summary && model.summaryKind === 'ai';
  const range = current ? current.range : (model.emptyDetail ?? '');
  const muted = 'text-pv-weather-deep';
  return (
    <>
      <header className="relative z-[2] flex shrink-0 items-end px-pv-s4">
        <div className="flex h-[22px] w-full min-w-0 items-center">
          <h1
            id="weather-title"
            className={cx('max-w-[60%] flex-none truncate text-pv-body leading-[22px] font-semibold tracking-normal',
              muted)}
          >
            {model.title}
          </h1>
          {model.subtitle && !stale ? (
            <p className={cx('truncate text-pv-body leading-[22px] font-semibold tracking-normal', muted)}>
              <span className="whitespace-pre" aria-hidden="true">
                {' · '}
              </span>
              {model.subtitle}
            </p>
          ) : null}
        </div>
      </header>
      <div
        className={cx(
          'relative isolate z-0 h-[536px] shrink-0 overflow-hidden rounded-[24px] bg-pv-weather px-pv-s4 pt-[54px]',
          'text-pv-ink shadow-[inset_0_0_0_1px_rgb(23_23_26/0.06)] group-data-[link=offline]/host:opacity-55',
        )}
        data-weather-state={current ? (model.sourceStale ? 'stale' : 'current') : 'empty'}
        data-weather-tone={tone}
      >
        <Decoration tone={tone} empty={!current} />
        <div className="relative z-[1] pt-pv-s1 text-left">
          {message ? null : (
            <strong
              className={'mb-pv-s3 block text-[150px] leading-[0.85] font-medium tracking-[-0.065em] ' +
                'text-pv-weather-deep'}
              data-weather={current ? 'temperature' : undefined}
            >
              {current ? current.temperature : <span className="text-pv-ink-3">—</span>}
            </strong>
          )}
          <p className="inline text-[26px] leading-8 font-extrabold" data-weather={current ? 'condition' : undefined}>
            {current ? current.condition : (model.emptyTitle ?? 'Aktuelt vejr ikke tilgængeligt')}
          </p>
          {conditionAdvice ? (
            <span className="inline text-[26px] leading-8 font-extrabold">
              {' · '}
              {conditionAdvice}
            </span>
          ) : null}
          {summaryVisible ? (
            <motion.p
              key={ai ? 'ai' : 'plain'}
              className={cx(
                'relative mt-pv-s1 block h-12 max-w-[48ch] overflow-hidden text-pv-body',
                summaryState === 'error' || summaryState === 'unavailable' ? muted : 'text-pv-ink',
              )}
              {...(ai && !reduced
                ? {
                    initial: {opacity: 0, y: 4},
                    animate: {opacity: 1, y: 0},
                    transition: {...TRANSITION.quick, opacity: TRANSITION.fade},
                  }
                : {})}
              aria-description={model.summaryLabel || undefined}
              aria-describedby={model.summaryLabel ? 'weather-source-info' : undefined}
            >
              {/* A summary from the AI says so. */}
              {ai ? (
                <span
                  className={cx('mt-0.5 mr-pv-s1 inline-block h-5 rounded-pv-pill bg-pv-surface px-pv-s1 align-top',
                    'text-pv-meta font-semibold text-pv-weather-ink')}
                  aria-hidden="true"
                >
                  AI
                </span>
              ) : null}
              {waiting ? <AdvicePending /> : null}
              {rangeDash(model.summary ?? '')}
            </motion.p>
          ) : null}
          {range ? <span className={cx('mt-pv-s1 block text-pv-body', muted)}>{range}</span> : null}
          {freshness.length ? (
            <dl
              className={cx(
                'absolute -top-[27px] right-0 z-[2] flex h-8 items-center rounded-pv-pill bg-pv-surface px-3',
                'text-pv-meta leading-8 font-semibold whitespace-nowrap text-pv-ink',
              )}
            >
              {freshness.map(row => (
                <div key={row.id} className="flex gap-1">
                  <dt hidden={row.id === 'freshness'}>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        <LastKnown />
      </div>
      {model.hours.length ? (
        <section
          className={cx(
            // As wide as the column, so the hours run on under the fade at the right edge.
            'relative z-[1] ml-pv-s4 grid h-48 w-full shrink-0 auto-cols-[156px] grid-flow-col overflow-x-auto',
            'overflow-y-hidden overscroll-x-contain border-t border-pv-ink/10 pt-5 pr-pv-s4 pb-7',
            'snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            '[mask-image:linear-gradient(90deg,#000_78%,transparent)]',
          )}
          tabIndex={0}
          aria-label={model.hoursLabel || 'Timeprognose ikke tilgængelig'}
        >
          {model.hours.map(hour => (
            <HourRow key={hour.id} hour={hour} />
          ))}
        </section>
      ) : null}
      {model.days.length ? (
        <section className="mt-pv-s4 flex shrink-0 flex-col pb-pv-s1" aria-label="Vejrudsigt for de næste dage">
          <h2 className="mb-pv-s3 px-1 text-[24px] leading-[30px] font-extrabold tracking-[-0.4px]">De næste dage</h2>
          {model.days.map((day, index) => (
            <DayRow key={day.id} day={day} first={index === 0} last={index === model.days.length - 1} />
          ))}
        </section>
      ) : null}
      {model.source ? (
        <footer className="mt-pv-s2 mb-16 shrink-0 px-1">
          <p id="weather-source-info" className="text-pv-meta whitespace-pre-line text-pv-ink-3">
            {model.source}
          </p>
        </footer>
      ) : null}
    </>
  );
}
