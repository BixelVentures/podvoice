// Vejr from HA: the weather entity's current state and its forecasts from weather.get_forecasts, composed into the
// observation PodView's weather model already reads (screens/weather/observation.ts), so the screen is the same.
import {useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import type {HassEntityState} from './hass';
import {UNAVAILABLE} from './hass';
import {haKeys, serviceResponse} from './transport';

export type ForecastType = 'daily' | 'hourly';
// HA's WeatherEntityFeature bits.
const FORECAST_FEATURE: Record<ForecastType, number> = {daily: 1, hourly: 2};

const forecastRow = z.looseObject({
  datetime: z.string(),
  condition: z.string().nullish(),
  temperature: z.number().nullish(),
  templow: z.number().nullish(),
  precipitation: z.number().nullish(),
  precipitation_probability: z.number().nullish(),
  wind_speed: z.number().nullish(),
  wind_bearing: z.number().nullish(),
  is_daytime: z.boolean().nullish(),
});
const forecastResponse = z.record(z.string(), z.object({forecast: z.array(forecastRow).max(240)}));
export type ForecastRow = z.infer<typeof forecastRow>;

export interface ForecastRead {
  rows: ForecastRow[];
  retrievedAt: string;
}

export const supportsForecast = (entity: HassEntityState | null, type: ForecastType) => {
  const features = entity?.attributes.supported_features;
  return typeof features === 'number' && (features & FORECAST_FEATURE[type]) !== 0;
};

// Read again when the entity reports new data (last_updated) or the page resyncs (generation), and every 10 min
// while shown: the hourly forecast is only shown for 15 min after it was read.
export function useForecast(entity: HassEntityState | null, type: ForecastType, generation: number) {
  const entityId = entity?.entity_id ?? '';
  const enabled = !!entity && !UNAVAILABLE.has(entity.state) && supportsForecast(entity, type);
  return useQuery({
    queryKey: [...haKeys.read, 'forecast', entityId, type, entity?.last_updated ?? '', generation],
    enabled,
    // A screen that mounts again (Hjem after Vejr) uses the read it has; new data comes with a new key.
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchInterval: 10 * 60_000,
    queryFn: async (): Promise<ForecastRead> => {
      const result = await serviceResponse(
        {domain: 'weather', service: 'get_forecasts', entityId, data: {type}, returnResponse: true},
        forecastResponse,
      );
      if (!result.ok) throw new Error(result.reason || result.outcome);
      return {rows: result.value[entityId]?.forecast ?? [], retrievedAt: new Date().toISOString()};
    },
  });
}

const temperatureUnit = (value: unknown) => (typeof value === 'string' && /^°?[CF]$/.test(value) ? value : '°C');

function rows(read: ForecastRead | undefined, daily: boolean, limit: number): Record<string, unknown>[] {
  return (read?.rows ?? []).slice(0, limit).map(row => {
    const high = row.temperature ?? null;
    const low = row.templow ?? null;
    return {
      datetime: row.datetime,
      condition: row.condition ?? '',
      temperature: high,
      precipitation: row.precipitation ?? null,
      precipitation_probability: row.precipitation_probability ?? null,
      wind_speed: row.wind_speed ?? null,
      wind_bearing: row.wind_bearing ?? null,
      ...(daily && high !== null ? {highTemperature: high} : {}),
      ...(daily && high !== null && low !== null && low <= high ? {lowTemperature: low} : {}),
    };
  });
}

// The observation DTO (observation.ts weatherObservation) for this entity and its reads, or null without facts.
export function weatherDto(
  entity: HassEntityState | null,
  daily: ForecastRead | undefined,
  hourly: ForecastRead | undefined,
  now = Date.now(),
): Record<string, unknown> | null {
  if (!entity || UNAVAILABLE.has(entity.state)) return null;
  const a = entity.attributes;
  const name = typeof a.friendly_name === 'string' ? a.friendly_name.slice(0, 80) : '';
  const units = {
    temperature: temperatureUnit(a.temperature_unit),
    precipitation: a.precipitation_unit,
    windSpeed: a.wind_speed_unit,
  };
  const base = {
    source: `Home Assistant / ${name || entity.entity_id}`,
    location: name,
    stateUpdatedAt: entity.last_updated,
    units,
  };
  const retrievedAt = daily?.retrievedAt ?? new Date(now).toISOString();
  return {
    ...base,
    retrievedAt,
    observedAt: Math.floor(now / 1000),
    current: {temperature: typeof a.temperature === 'number' ? a.temperature : null, condition: entity.state},
    forecastType: 'daily',
    forecast: rows(daily, true, 10),
    ...(hourly
      ? {
          hourly: {
            ...base,
            retrievedAt: hourly.retrievedAt,
            observedAt: Math.floor(Date.parse(hourly.retrievedAt) / 1000),
            current: null,
            forecastType: 'hourly',
            forecast: rows(hourly, false, 48),
          },
        }
      : {}),
  };
}
