// Vejr: the weather detail screen. Same anatomy, ids, kit attributes and classes as the
// pre-React renderer, so the stage stylesheet and the browser journeys apply unchanged.
// React keys keep each hour, day and metadata row as the same element across updates
// (no rebuild, no blink); an unchanged model writes nothing to the DOM.
import type {CSSProperties} from 'react';
import {weatherAppearance, windFrom} from '../../../weather-observation.js';
import {hasWeatherFacts} from './model';
import type {WeatherDay, WeatherDetailModel, WeatherHour} from './model';

// Number ranges read with an en dash (»12–15 min.«, »kl. 14–15«); dates stay untouched.
const RANGE = /(?<![\d.,:-])(\d{1,3}(?:[.,]\d+)?) ?- ?(\d{1,3}(?:[.,]\d+)?)(?![\d-])/g;
const rangeDash = (text: string) => text.replace(RANGE, '$1–$2');

function Artwork({file, label = '', slot}: {file: string | null | undefined; label?: string; slot?: string}) {
  return (
    <img
      alt={label}
      hidden={!file}
      src={file ? `assets/icons/${file}.svg` : undefined}
      data-kit-slot={slot}
    />
  );
}

function HourRow({hour, previous}: {hour: WeatherHour; previous: WeatherHour | undefined}) {
  const change = !previous
    ? 'first'
    : previous.condition !== hour.condition || previous.rain !== hour.rain
      ? 'change'
      : 'steady';
  const direction = windFrom(hour.windBearing);
  const windLabel = hour.windSpeed || hour.wind || '';
  const windDescription = [hour.wind, hour.windSpeed, direction?.label].filter(Boolean).join(' · ');
  const label = [
    hour.time,
    hour.condition,
    hour.temperature,
    hour.rain ? `Regn ${hour.rain}` : '',
    windDescription,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <div role="group" data-weather-change={change} aria-label={label}>
      <span>{hour.time}</span>
      <Artwork file={hour.icon} label={hour.condition} />
      <strong>{hour.temperature}</strong>
      <small className="weather-hour-rain" hidden={!hour.rain}>
        {hour.rain}
      </small>
      <small className="weather-hour-wind" hidden={!windLabel && !direction} title={windDescription}>
        <span className="weather-wind-label">{windLabel}</span>
        <span
          className="weather-wind-direction"
          role="img"
          hidden={!direction}
          aria-label={direction?.label}
          style={direction ? {transform: `rotate(${String(direction.degrees)}deg)`} : undefined}
        />
      </small>
    </div>
  );
}

function DayRow({day}: {day: WeatherDay}) {
  const range = Number.isFinite(day.start) && Number.isFinite(day.length);
  const label = [
    day.day,
    day.high ? `lavest ${day.low}, højst ${day.high}` : `temperaturprognose ${day.low}`,
    day.condition,
  ]
    .filter(Boolean)
    .join(', ');
  const bar = range
    ? ({'--start': `${String(day.start)}%`, '--length': `${String(day.length)}%`} as CSSProperties)
    : undefined;
  return (
    <div role="group" aria-label={label}>
      <strong>{day.day}</strong>
      <Artwork file={day.icon || 'dash'} label={day.condition || 'Vejrtype ikke oplyst'} />
      <span>{day.low}</span>
      <span className="temperature-range" hidden={!range} style={bar} />
      <strong hidden={!day.high}>{day.high}</strong>
    </div>
  );
}

export function WeatherDetail({model}: {model: WeatherDetailModel}) {
  const facts = hasWeatherFacts(model);
  const appearance = model.appearance ?? weatherAppearance(null);
  const metadata = [
    ...(model.sourceStale && facts && !model.metadata?.some(row => row.id === 'weather-retrieved')
      ? [{id: 'freshness', label: 'Status', value: model.updated || 'Ikke opdateret'}]
      : []),
    ...(model.metadata ?? []),
  ];
  const message = !!model.connectionReason && !facts;
  const current = model.current;
  const conditionAdvice = (current && model.conditionAdvice) || '';
  const summaryVisible = !!model.summary || model.summaryState === 'idle' || model.summaryState === 'pending';
  const range = current ? current.range : (model.emptyDetail ?? '');
  return (
    <>
      <header className="response-heading">
        <div>
          <h1 id="weather-title">{model.title}</h1>
          <p>{model.subtitle}</p>
        </div>
      </header>
      <div
        className="weather-current pv-kit pv-kit-hero pv-hero"
        data-kit="hero"
        data-kit-identity="weather"
        data-detail-zone="hero"
        data-kit-variant={message ? 'message' : undefined}
        data-kit-state={current ? 'ready' : 'empty'}
        data-weather-state={current ? (model.sourceStale ? 'stale' : 'current') : 'empty'}
        data-weather-tone={appearance.tone}
        data-weather-phase={appearance.phase}
        data-weather-photo={String(appearance.photo)}
      >
        <div data-kit-slot="copy">
          <strong hidden={message}>{current?.temperature ?? ''}</strong>
          <p data-kit-slot="title">
            {current ? current.condition : (model.emptyTitle ?? 'Aktuelt vejr ikke tilgængeligt')}
          </p>
          <span className="weather-condition-advice" hidden={!conditionAdvice}>
            {conditionAdvice}
          </span>
          {/* »ai« draws the CSS AI marker; a pending advice keeps its space and fades in when ready. */}
          <p
            className="weather-summary"
            data-kit-slot="body"
            hidden={!summaryVisible}
            data-advice-state={model.summaryState ?? 'none'}
            data-advice-kind={model.summary ? (model.summaryKind ?? '') : ''}
            aria-busy="false"
            aria-description={model.summaryLabel || undefined}
            aria-describedby={model.summaryLabel ? 'weather-source-info' : undefined}
          >
            {rangeDash(model.summary ?? '')}
          </p>
          <span data-kit-slot="body" hidden={!range}>
            {range}
          </span>
          <dl className="weather-metadata" hidden={!metadata.length}>
            {metadata.map(row => (
              <div key={row.id} data-meta-id={row.id}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <Artwork file={current ? current.icon : model.emptyIcon} slot="icon" />
      </div>
      <section
        className="weather-hours"
        tabIndex={0}
        role="region"
        aria-label={model.hoursLabel || 'Timeprognose ikke tilgængelig'}
        data-detail-zone="controls"
        hidden={!model.hours.length}
      >
        {model.hours.map((hour, index) => (
          <HourRow key={hour.id} hour={hour} previous={model.hours[index - 1]} />
        ))}
      </section>
      <section
        className="weather-days"
        aria-label="Vejrudsigt for de næste dage"
        data-detail-zone="history"
        hidden={!model.days.length}
      >
        <h2>De næste dage</h2>
        {model.days.map(day => (
          <DayRow key={day.id} day={day} />
        ))}
      </section>
      <footer className="weather-source" hidden={!model.source}>
        <p id="weather-source-info">{model.source}</p>
      </footer>
    </>
  );
}
