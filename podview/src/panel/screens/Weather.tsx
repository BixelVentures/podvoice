// Vejr on HA: the weather entity (the integration's option, else the first HA has) and its pushed forecasts, drawn
// by WeatherDetail through the observation and view model in screens/weather.
import {useEffect} from 'react';
import {touchClock, useNow, useRefreshAt} from '../../lib/hooks/clock';
import {useForecast, weatherDto} from '../../lib/ha/weather';
import {useCatalog, useEntity, useLink, usePanelConfig} from '../../lib/ha/transport';
import type {WeatherDetailModel} from '../../screens/weather/model';
import {weatherObservation} from '../../screens/weather/observation';
import {liveWeatherModel} from '../../screens/weather/view-model';
import {WeatherDetail} from '../../screens/weather/WeatherDetail';

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
  const dto = weatherDto(entity, daily.data, hourly.data, now);
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
  return (
    <section
      id="weather-view"
      className={'mt-5 flex min-h-0 flex-1 basis-0 flex-col gap-pv-s3 overflow-x-hidden overflow-y-auto ' +
        'overscroll-contain rounded-pv-l p-pv-s3'}
      aria-label="Vejrudsigt"
    >
      <WeatherDetail model={model} />
    </section>
  );
}
