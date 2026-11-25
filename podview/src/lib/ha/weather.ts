// Vejr from HA: the weather entity's current state and its forecasts, pushed by HA (weather/subscribe_forecast through
// hass.connection.subscribeMessage; HA sends a new forecast whenever the integration has one), composed into the
// observation PodView's weather model already reads (screens/weather/observation.ts), so the screen is the same.
// Nothing is fetched again on every state update: weather.get_forecasts would be a recorded service call each time.
import {useQuery, useQueryClient} from '@tanstack/react-query';
import type {QueryClient} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import {z} from 'zod';
import type {HassEntityState} from './hass';
import {UNAVAILABLE} from './hass';
import {haKeys, serviceResponse, subscribeHa} from './transport';

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
export type ForecastRow = z.infer<typeof forecastRow>;

export interface ForecastRead {
  rows: ForecastRow[];
  retrievedAt: string;
}

export const supportsForecast = (entity: HassEntityState | null, type: ForecastType) => {
  const features = entity?.attributes.supported_features;
  return typeof features === 'number' && (features & FORECAST_FEATURE[type]) !== 0;
};

const forecastMessage = z.looseObject({
  type: z.string().optional(),
  forecast: z.array(forecastRow).max(240).nullable(),
});

export const forecastKey = (entityId: string, type: ForecastType) =>
  [...haKeys.read, 'forecast', entityId, type] as const;

// One subscription per entity, type and link generation, however many parts of the page read it (Hjem, Vejr).
const live = new Map<string, {count: number; stop: () => void}>();

export function subscribeForecast(client: QueryClient, entityId: string, type: ForecastType, generation: number) {
  const id = [entityId, type, String(generation)].join('\u0000');
  const held = live.get(id);
  if (held) held.count += 1;
  else {
    const stop = subscribeHa(
      {type: 'weather/subscribe_forecast', entity_id: entityId, forecast_type: type},
      message => {
        const parsed = forecastMessage.safeParse(message);
        if (!parsed.success) return;
        client.setQueryData<ForecastRead>(forecastKey(entityId, type), {
          rows: parsed.data.forecast ?? [],
          retrievedAt: new Date().toISOString(),
        });
      },
    );
    live.set(id, {count: 1, stop});
  }
  return () => {
    const entry = live.get(id);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    live.delete(id);
    entry.stop();
  };
}

// The forecast HA pushes for this entity; a resync (generation) subscribes again. The cache only ever holds pushes.
export function useForecast(entity: HassEntityState | null, type: ForecastType, generation: number) {
  const client = useQueryClient();
  const entityId = entity?.entity_id ?? '';
  const enabled = !!entity && !UNAVAILABLE.has(entity.state) && supportsForecast(entity, type);
  useEffect(() => {
    if (!enabled) return;
    return subscribeForecast(client, entityId, type, generation);
  }, [client, enabled, entityId, type, generation]);
  return useQuery({
    queryKey: forecastKey(entityId, type),
    queryFn: () => Promise.reject(new Error('pushed by weather/subscribe_forecast')),
    enabled: false,
    gcTime: 15 * 60_000,
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

// The weather provider HA's attribution names (Met.no: »Weather forecast from met.no, delivered by …«), or ''.
const PROVIDERS: [RegExp, string][] = [[/\bmet\.no\b/i, 'Met.no'], [/openweathermap/i, 'OpenWeatherMap'],
  [/\bdmi\b/i, 'DMI'], [/accuweather/i, 'AccuWeather'], [/\bsmhi\b/i, 'SMHI']];
export function providerOf(attribution: unknown): string {
  if (typeof attribution !== 'string') return '';
  return PROVIDERS.find(([pattern]) => pattern.test(attribution))?.[1] ?? '';
}

// The observation DTO (observation.ts weatherObservation) for this entity and its reads, or null without facts.
export function weatherDto(
  entity: HassEntityState | null,
  daily: ForecastRead | undefined,
  hourly: ForecastRead | undefined,
  now = Date.now(),
  place = '',
): Record<string, unknown> | null {
  if (!entity || UNAVAILABLE.has(entity.state)) return null;
  const a = entity.attributes;
  const name = providerOf(a.attribution);
  const units = {
    temperature: temperatureUnit(a.temperature_unit),
    precipitation: a.precipitation_unit,
    windSpeed: a.wind_speed_unit,
  };
  const base = {
    // The provider HA's attribution names (»Kilde: Met.no«); never the entity's own name or id.
    source: name ? `Home Assistant / ${name}` : 'Home Assistant',
    // The entity's friendly name (»Forecast Hjem«) is the source, never the place: the place is weather_place's.
    location: '',
    stateUpdatedAt: entity.last_updated,
    units,
  };
  const retrievedAt = daily?.retrievedAt ?? new Date(now).toISOString();
  return {
    ...base,
    ...(place ? {displayLocation: {name: place, source: 'configured_label'}} : {}),
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

// The place Vejr names (podvoice.weather_place): the PodVoice add-on's podview_weather_city, else HA's
// location_name, else the home zone's name; '' when none names one. Read once and kept (it changes rarely).
const placeSchema = z.looseObject({ok: z.literal(true), name: z.string().max(80), source: z.string().max(40)});
export const placeKey = [...haKeys.read, 'weather_place'] as const;

export function useWeatherPlace(enabled = true) {
  return useQuery({
    queryKey: placeKey,
    enabled,
    staleTime: 30 * 60_000,
    gcTime: Infinity,
    retry: false,
    queryFn: async () => {
      const result = await serviceResponse(
        {domain: 'podvoice', service: 'weather_place', data: {}, returnResponse: true}, placeSchema);
      if (!result.ok) throw new Error(result.reason || result.outcome);
      return result.value.name;
    },
  });
}

// Vejr's AI advice (podvoice.weather_advice; A-Vejr, DECISIONS §9): the PodVoice add-on's passive advice owner,
// bound to the add-on's own current weather. Lazy: asked only while Vejr is on screen, started once per visit (the
// add-on runs one paid request per weather and answers the same record again), then read every 1.5 s while it is
// on its way (about 6 s on Green). Nothing is retried after a failure; `null` while unasked or unanswerable.
export type WeatherAdviceStatus = 'idle' | 'pending' | 'ready' | 'error' | 'unavailable';
export interface WeatherAdviceRead {
  status: WeatherAdviceStatus;
  summary: string | null;
  /** Epoch seconds the advice holds until (ready only). */
  validUntil: number | null;
}
const adviceSchema = z.object({
  ok: z.literal(true),
  status: z.enum(['idle', 'pending', 'ready', 'error', 'unavailable']),
  summary: z.string().max(240).nullable(),
  validUntil: z.number().nullable(),
});
export const adviceKey = [...haKeys.read, 'weather_advice'] as const;
export const ADVICE_POLL_MS = 1500;

export function useWeatherAdvice(shown: boolean, current: boolean) {
  const client = useQueryClient();
  // One start per visit: each time Vejr is shown again is a new read (its own key; the last one is dropped).
  const [visit, setVisit] = useState({count: 0, on: false});
  if (visit.on !== shown) setVisit({count: shown ? visit.count + 1 : visit.count, on: shown});
  const key = [...adviceKey, visit.count] as const;
  return useQuery({
    queryKey: key,
    enabled: shown && current,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
    refetchInterval: query => (query.state.data?.status === 'pending' ? ADVICE_POLL_MS : false),
    queryFn: async (): Promise<WeatherAdviceRead> => {
      // The visit's first read starts the advice; the reads after it only ask.
      const start = client.getQueryData(key) === undefined;
      const result = await serviceResponse({domain: 'podvoice', service: 'weather_advice', data: {start},
        returnResponse: true}, adviceSchema);
      if (!result.ok) return {status: 'unavailable', summary: null, validUntil: null};
      return {status: result.value.status, summary: result.value.summary, validUntil: result.value.validUntil};
    },
  });
}
