// Vejr on HA: the weather entity (the integration's option, else the first HA has) and its pushed forecasts, drawn
// by WeatherDetail (composed of the kit's A-Vejr pieces) through the observation and view model in screens/weather.
import {useEffect} from 'react';
import {touchClock, useNow, useRefreshAt} from '../../lib/hooks/clock';
import {useForecast, useWeatherPlace, weatherDto} from '../../lib/ha/weather';
import {useCatalog, useEntity, useLink, usePanelConfig} from '../../lib/ha/transport';
import type {WeatherDetailModel} from '../../screens/weather/model';
import {weatherObservation} from '../../screens/weather/observation';
import {liveWeatherModel, weatherOverviewDetail} from '../../screens/weather/view-model';
import {WeatherDetail} from '../../screens/weather/WeatherDetail';

const dayKey = (at: number) => new Date(at).toLocaleDateString('da-DK', {timeZone: 'Europe/Copenhagen'});

// The day's high and low (»Højst 17° · lavest 9°«): HA's daily forecast for today, else today's hours in its hourly
// forecast with the temperature now; only when neither is known, the overview's own words.
export function todayRange(model: WeatherDetailModel, now: number): string {
  const range = weatherOverviewDetail(model);
  if (!model.current || model.current.range) return range;
  const today = dayKey(now);
  const temperatures = [
    Number.parseFloat(model.current.temperature.replace(',', '.').replace('−', '-')),
    ...model.hours.filter(hour => dayKey(Date.parse(hour.id)) === today)
      .map(hour => hour.temperatureNumber),
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (temperatures.length < 2) return range;
  const format = (value: number) => `${String(Math.round(value)).replace('-', '−')}°`;
  return `Højst ${format(Math.max(...temperatures))} · lavest ${format(Math.min(...temperatures))}`;
}

export function useHaWeather(): {model: WeatherDetailModel; entityId: string | null} {
  const {weather} = useCatalog();
  const chosen = usePanelConfig()?.weather_entity;
  // The option names an entity HA has; one that is gone (removed, renamed) falls back to the first one.
  const entityId = (typeof chosen === 'string' && weather.includes(chosen) ? chosen : weather[0]) ?? null;
  const entity = useEntity(entityId);
  const link = useLink();
  const daily = useForecast(entity, 'daily', link.generation);
  const hourly = useForecast(entity, 'hourly', link.generation);
  // New data is judged by the time it arrived, never by an older clock.
  useEffect(() => {
    touchClock();
  }, [entity, daily.dataUpdatedAt, hourly.dataUpdatedAt]);
  const now = useNow();
  const place = useWeatherPlace(!!entityId);
  const dto = weatherDto(entity, daily.data, hourly.data, now, place.data ?? '');
  let observation = null;
  try {
    observation = dto ? weatherObservation(dto) : null;
  } catch {
    observation = null;
  }
  const model = liveWeatherModel(observation, {
    connected: link.connected,
    readStatus: null,
    now,
  });
  useRefreshAt(model.refreshAt ?? null);
  if (!entityId) {
    return {
      entityId,
      model: {
        ...model,
        subtitle: 'Ingen vejr-entitet',
        emptyTitle: 'Ingen vejr-entitet i Home Assistant',
        emptyDetail: 'Tilføj en vejrintegration i Home Assistant (fx Met.no) for at se vejret her.',
        overviewStatus: 'Ingen vejr-entitet',
      },
    };
  }
  return {model, entityId};
}

export function WeatherScreen() {
  const {model} = useHaWeather();
  const {connected} = useLink();
  const now = useNow();
  // »Højst 5° · Lavest 4°«: today's daily range, else today's hours (the widget's own rule).
  const today = model.current ? todayRange(model, now) : '';
  const range = today.startsWith('Højst ') ? today.replace(' · lavest ', ' · Lavest ') : '';
  const shown = model.current && range ? {...model, current: {...model.current, range}} : model;
  return (
    // A-Vejr: the hero and »De næste dage« in the column, 32 apart; the whole column scrolls under the fixed player.
    <section id="weather-view" className="flex flex-col gap-8 pb-6" aria-labelledby="weather-title">
      <WeatherDetail model={shown} connected={connected} />
    </section>
  );
}
