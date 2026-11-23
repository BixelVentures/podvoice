// Vejr on HA: the weather entity (the first HA has) and weather.get_forecasts, drawn by the existing WeatherDetail
// through the same observation and view model as before (screens/weather), so the screen is unchanged.
import {useEffect} from 'react';
import {touchClock, useNow, useRefreshAt} from '../../lib/hooks/clock';
import {useForecast, weatherDto} from '../../lib/ha/weather';
import {useCatalog, useEntity, useLink} from '../../lib/ha/transport';
import type {WeatherDetailModel} from '../../screens/weather/model';
import {weatherObservation} from '../../screens/weather/observation';
import {liveWeatherModel} from '../../screens/weather/view-model';
import {WeatherDetail} from '../../screens/weather/WeatherDetail';

export function useHaWeather(): {model: WeatherDetailModel; entityId: string | null} {
  const {weather} = useCatalog();
  const entityId = weather[0] ?? null;
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
    readStatus: daily.isError ? 'error' : null,
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
    <section id="weather-view" className="response-widget weather-view" aria-label="Vejrudsigt">
      <WeatherDetail model={model} />
    </section>
  );
}
