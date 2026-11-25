// Vejr (the design canvas's A-Vejr and Vejr-Ukendt), composed of the kit's weather pieces (src/ui/Weather.tsx): the
// full-colour hero with the place, the freshness chip, the temperature, the condition, the advice and the day's
// high and low, the hours with rain and wind inside it, then »De næste dage« and the source line. The freshness rule
// (K-Fresh): data under 30 minutes has no chip, older data shows its time and keeps its full colour (owner 10 Nov:
// never a weaker colour). Without any weather the temperature is »—«, the art steps back to 20 % and the hours to
// 30 %; Home Assistant away is a compact notice in the hero (the hybrid rule). React keys keep each hour and day the
// same element across updates (no rebuild, no blink).
import {iconUrl} from '../../ui';
import {ColumnFade, WeatherDays, WeatherHero} from '../../ui/Weather';
import type {WeatherAdvice, WeatherDayRow, WeatherHourCell} from '../../ui/Weather';
import {windFrom} from './observation.ts';
import {hasWeatherFacts} from './model';
import type {WeatherDetailModel, WeatherHour} from './model';

// Number ranges read with an en dash (»12–15 min.«, »kl. 14–15«); dates stay untouched.
const RANGE = /(?<![\d.,:-])(\d{1,3}(?:[.,]\d+)?) ?- ?(\d{1,3}(?:[.,]\d+)?)(?![\d-])/g;
const rangeDash = (text: string) => text.replace(RANGE, '$1–$2');

// »7 °C« reads »7°« on the hero and in the hours, as on the canvas.
const degrees = (value: string) => value.replace(/\s*°[CF]$/, '°');

export const HA_AWAY = 'Home Assistant svarer ikke lige nu';

function hourCell(hour: WeatherHour): WeatherHourCell {
  const direction = windFrom(hour.windBearing);
  const wind = hour.windSpeed || hour.wind || '';
  const windWords = [hour.wind, hour.windSpeed, direction?.label].filter(Boolean).join(' · ');
  return {
    id: hour.id,
    time: hour.time,
    icon: hour.icon ? iconUrl(hour.icon) : null,
    condition: hour.condition,
    temperature: degrees(hour.temperature),
    rain: hour.rain,
    wind,
    windDegrees: direction ? direction.degrees : null,
    label: [hour.time, hour.condition, hour.temperature, hour.rain ? `Regn ${hour.rain}` : '', windWords]
      .filter(Boolean).join(', '),
  };
}

function advice(model: WeatherDetailModel): WeatherAdvice {
  const state = model.summaryState ?? null;
  if (state === 'idle' || state === 'pending') return {state: 'pending', label: 'Et vejrråd er på vej'};
  if (!model.summary) return {state: 'none'};
  const ai = model.summaryKind === 'ai';
  return {state: 'text', text: rangeDash(model.summary), ai, muted: !ai,
    ...(model.summaryLabel ? {label: model.summaryLabel} : {})};
}

export function WeatherDetail({model, connected = true}: {model: WeatherDetailModel; connected?: boolean}) {
  const current = model.current;
  const facts = hasWeatherFacts(model);
  const stale = !!current && !!model.sourceStale;
  // K-Fresh: »Opdateret 11.02« on the hero for data over 30 minutes old; never »Sidst kendt«.
  const fresh = stale ? (model.updated ? model.updated.replace('Opdateret: ', 'Opdateret ') : 'Ikke opdateret')
    : null;
  const line = current
    ? [current.condition, model.conditionAdvice ?? ''].filter(Boolean).join(' · ')
    : (model.emptyTitle ?? 'Vejret kunne ikke hentes');
  const sub = current ? current.range : (model.source.split('\n')[0] || model.emptyDetail || '');
  const days: WeatherDayRow[] = model.days.map(day => ({
    id: day.id,
    day: day.day,
    icon: iconUrl(day.icon || 'dash'),
    condition: day.condition,
    low: degrees(day.low),
    high: degrees(day.high),
    start: day.start,
    length: day.length,
    label: [day.day, day.high ? `lavest ${day.low}, højst ${day.high}` : `temperaturprognose ${day.low}`,
      day.condition].filter(Boolean).join(', '),
  }));
  return (
    <>
      <WeatherHero
        place={model.title}
        placeId="weather-title"
        fresh={fresh}
        big={current ? degrees(current.temperature) : '—'}
        unknown={!current}
        line={line}
        advice={current ? advice(model) : {state: 'none'}}
        sub={sub}
        notice={connected ? null : HA_AWAY}
        tone={model.appearance?.tone ?? 'neutral'}
        hours={model.hours.map(hourCell)}
        hoursLabel={model.hoursLabel || 'Timeprognose'}
        state={current ? (stale ? 'stale' : 'current') : 'empty'}
      />
      {facts || model.source ? (
        <WeatherDays days={days} credit={model.source.replace('\n', ' · ')} creditId="weather-source-info" />
      ) : null}
      <ColumnFade />
    </>
  );
}
