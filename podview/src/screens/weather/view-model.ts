// The weather screens' view model: projects a validated observation (./observation.ts) or the
// local preview fixture into the WeatherDetailModel the detail, header, photo and overview render.
// Pure functions, no DOM. Erasable TypeScript only with explicit .ts imports, so the server's tests
// can run it in plain Node with type stripping.
import {formatDate} from '../../lib/format/date-format.ts';
import {updatedLabel} from '../../lib/format/updated-label.ts';
import type {
  WeatherAdviceState,
  WeatherConnectionReason,
  WeatherCurrent,
  WeatherDay,
  WeatherDetailModel,
  WeatherHour,
  WeatherMetadataRow,
} from './model.ts';
import {
  conditionIcon,
  conditionLabel,
  forecastDayRows,
  hourlyWeather,
  localDayKey,
  weatherAdvice,
  weatherAiAdvice,
  weatherAppearance,
  weatherDisplayLocation,
  weatherFreshUntil,
  weatherPassiveAdvice,
  weatherTemperature,
  windFrom,
  windStrength,
} from './observation.ts';
import type {ForecastDayRow, WeatherObservation, WeatherPassiveContext, WeatherUnits} from './observation.ts';

const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);
const oneOf = <T>(value: unknown, values: readonly T[]): value is T => (values as readonly unknown[]).includes(value);

export function weatherSourceLabel(source: unknown): string {
  if (source === 'Forhåndsvisning') return 'Eksempeldata';
  const provider = typeof source === 'string' ? source.replace(/^Home Assistant(?:\s*\/\s*|\s*$)/i, '').trim() : '';
  const names = [...new Set(provider.split(',').map(name => name.trim()).filter(Boolean))];
  return names.length ? `${names.length > 1 ? 'Kilder' : 'Kilde'}: ${names.join(', ')}` : '';
}

// The quantities of one forecast period that the view models read.
export interface WeatherPeriodQuantities {
  temperature?: unknown;
  precipitation?: unknown;
  wind_speed?: unknown;
  wind_bearing?: unknown;
  // The source's precipitation probability in percent.
  rain?: unknown;
  precipitation_probability?: unknown;
}

export interface WeatherUnitNames {
  temperature?: unknown;
  precipitation?: unknown;
  windSpeed?: unknown;
}

function quantity(value: unknown, unit: unknown, factors: Record<string, number>, suffix: string): string {
  const factor = typeof unit === 'string' && Object.hasOwn(factors, unit) ? (factors[unit] ?? null) : null;
  const converted = isFiniteNumber(value) && value >= 0 && factor !== null ? value * factor : null;
  if (!isFiniteNumber(converted)) return '';
  const shown =
    converted > 0 && converted < 0.1
      ? '<0,1'
      : new Intl.NumberFormat('da-DK', {maximumFractionDigits: 1}).format(converted);
  return `${shown} ${suffix}`;
}

// Forecast quantities keep their source units in the observation. Only these
// known conversions may produce the compact Danish presentation.
export function weatherMetrics(
  period: WeatherPeriodQuantities | null | undefined,
  units: WeatherUnitNames | null | undefined,
): {rain: string; wind: string} {
  return {
    rain: quantity(period?.precipitation, units?.precipitation, {mm: 1, cm: 10, in: 25.4}, 'mm'),
    wind: quantity(
      period?.wind_speed,
      units?.windSpeed,
      {'m/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, kn: 1852 / 3600},
      'm/s',
    ),
  };
}

// One hour's rain line: the amount only when some is forecast, the source's own chance when it has one
// (»1,7 mm · 60 %«, »10 %«). A dry hour without a chance has no line.
function hourPrecipitation(period: WeatherPeriodQuantities, units: WeatherUnitNames | null | undefined): string {
  const amount =
    isFiniteNumber(period.precipitation) && period.precipitation > 0 ? weatherMetrics(period, units).rain : '';
  const chance =
    isFiniteNumber(period.rain) && period.rain >= 0 && period.rain <= 100 ? `${String(Math.round(period.rain))} %` : '';
  return [amount, chance].filter(Boolean).join(' · ');
}

export interface WeatherFixtureHour {
  condition: string;
  datetime: string;
  temperature: number;
  wind_speed: number;
  precipitation: number;
  precipitation_probability?: number;
  wind_bearing?: number | null;
}

export interface WeatherFixtureDay {
  day: string;
  low: number;
  high: number;
  condition?: string;
}

export type WeatherAdvicePreview = 'idle' | 'pending' | 'ready' | 'error';

// The local preview fixture's shape (not an observation).
export interface WeatherFixture {
  place: string;
  previewAt: string;
  source: string;
  units?: {temperature: string; precipitation: string; windSpeed: string};
  temperature: number;
  condition: string;
  conditionCode: string;
  isDaytime: boolean;
  high: number;
  low: number;
  hours: WeatherFixtureHour[];
  days: WeatherFixtureDay[];
  advicePreview?: unknown;
}

// LOCAL visual fixture, fixed at the supplied screenshot's 15 October 13:46
// preview clock. These exact twelve hourly rows/units came from
// integration/observed-weather-20261015/ha-hourly-visible-response.json.
// Current weather/daylight, three daily ranges and Mårslet are curated household examples;
// they are NOT HA observations or city proof. No retrieval/freshness timestamps
// are fabricated, and this local model never enters the live validator.
export const WEATHER: WeatherFixture = {
  place: 'Mårslet',
  previewAt: '2026-10-15T13:46:00+02:00',
  source: 'Met.no',
  units: {temperature: '°C', precipitation: 'mm', windSpeed: 'km/h'},
  temperature: 15,
  condition: 'Let skyet',
  conditionCode: 'partlycloudy',
  isDaytime: true,
  high: 17,
  low: 9,
  hours: [
    {condition: 'cloudy', datetime: '2026-10-15T12:00:00+00:00', temperature: 14.9, wind_speed: 22.3, precipitation: 0},
    {condition: 'cloudy', datetime: '2026-10-15T13:00:00+00:00', temperature: 15.1, wind_speed: 21.6, precipitation: 0},
    {condition: 'cloudy', datetime: '2026-10-15T14:00:00+00:00', temperature: 15.1, wind_speed: 22.7, precipitation: 0},
    {condition: 'cloudy', datetime: '2026-10-15T15:00:00+00:00', temperature: 14.9, wind_speed: 18.7, precipitation: 0},
    {condition: 'cloudy', datetime: '2026-10-15T16:00:00+00:00', temperature: 14.8, wind_speed: 19.8, precipitation: 0},
    {condition: 'cloudy', datetime: '2026-10-15T17:00:00+00:00', temperature: 14.7, wind_speed: 24.1, precipitation: 0},
    {condition: 'cloudy', datetime: '2026-10-15T18:00:00+00:00', temperature: 14.5, wind_speed: 20.9, precipitation: 0},
    {condition: 'cloudy', datetime: '2026-10-15T19:00:00+00:00', temperature: 14.3, wind_speed: 19.8, precipitation: 0},
    {condition: 'cloudy', datetime: '2026-10-15T20:00:00+00:00', temperature: 13.9, wind_speed: 16.6, precipitation: 0},
    {condition: 'cloudy', datetime: '2026-10-15T21:00:00+00:00', temperature: 13.7, wind_speed: 17.3, precipitation: 0},
    {condition: 'cloudy', datetime: '2026-10-15T22:00:00+00:00', temperature: 13.8, wind_speed: 17.6, precipitation: 0},
    {condition: 'cloudy', datetime: '2026-10-15T23:00:00+00:00', temperature: 14, wind_speed: 19.1, precipitation: 0},
  ],
  days: [
    {day: 'I dag', low: 9, high: 17},
    {day: 'I morgen', low: 10, high: 16},
    {day: 'I overmorgen', low: 8, high: 14},
  ],
};

const CHANGE_CONDITIONS = [
  'partlycloudy', 'partlycloudy', 'rainy', 'rainy', 'cloudy', 'partlycloudy', 'partlycloudy', 'cloudy', 'cloudy',
  'cloudy', 'cloudy', 'cloudy',
];
const CHANGE_TEMPERATURES = [16, 17, 15, 14, 14, 13, 12, 12, 11, 11, 10, 10];
const CHANGE_PRECIPITATION = [0, 0, 1.2, 0.8, 0, 0, 0, 0, 0, 0, 0, 0];

// Explicit local review scenario: not an observation and never passed to liveWeatherModel.
export const WEATHER_CHANGE_EXAMPLE: WeatherFixture = {
  ...WEATHER,
  source: 'Forhåndsvisning',
  // Each list has one value per fixture hour.
  hours: WEATHER.hours.map((hour, index) => ({
    ...hour,
    condition: CHANGE_CONDITIONS[index] ?? hour.condition,
    temperature: CHANGE_TEMPERATURES[index] ?? hour.temperature,
    precipitation: CHANGE_PRECIPITATION[index] ?? hour.precipitation,
  })),
  days: [
    {day: 'I dag', low: 9, high: 17, condition: 'rainy'},
    {day: 'I morgen', low: 10, high: 16, condition: 'partlycloudy'},
    {day: 'I overmorgen', low: 8, high: 14, condition: 'cloudy'},
  ],
};

export function clothingTip({
  temperature,
  units = {temperature: '°C'},
}: {
  temperature?: unknown;
  units?: {temperature?: unknown} | null;
}): string {
  if (!isFiniteNumber(temperature) || !oneOf(units?.temperature, ['°C', 'C', '°F', 'F'])) return '';
  const fahrenheit = units.temperature === '°F' || units.temperature === 'F';
  const celsius = fahrenheit ? ((temperature - 32) * 5) / 9 : temperature;
  if (celsius < 1) return 'Tag en varm jakke, hue og handsker på.';
  if (celsius < 7) return 'Tag en varm jakke på.';
  if (celsius < 14) return 'Tag en jakke med.';
  if (celsius < 20) return 'Tag en trøje med.';
  return 'Let tøj kan være passende.';
}

const RAIN_FACTORS = {mm: 1, cm: 10, in: 25.4};

// The period's temperature in °C and rain in mm as numbers, or null when the unit is unknown.
export function forecastQuantities(
  period: WeatherPeriodQuantities | null | undefined,
  units: WeatherUnitNames = {},
): {temperatureNumber: number | null; rainNumber: number | null} {
  const temp = period?.temperature;
  const tempKnown = isFiniteNumber(temp) && oneOf(units.temperature, ['°C', 'C', '°F', 'F']);
  const rain = period?.precipitation;
  // A plain property read, as the original: any key resolves, and `rain * factor` coerces.
  const factor: unknown = (RAIN_FACTORS as Record<string, unknown>)[units.precipitation as string];
  const fahrenheit = units.temperature === '°F' || units.temperature === 'F';
  return {
    temperatureNumber: tempKnown ? (fahrenheit ? ((temp - 32) * 5) / 9 : temp) : null,
    rainNumber: isFiniteNumber(rain) && rain >= 0 && factor ? rain * Number(factor) : null,
  };
}

const ADVICE_PREVIEWS: readonly WeatherAdvicePreview[] = ['idle', 'pending', 'ready', 'error'];

function previewAdvice(preview: WeatherAdvicePreview): Pick<
  WeatherDetailModel,
  'summaryState' | 'summary' | 'summaryLabel'
> {
  const summary =
    preview === 'ready'
      ? 'Tag en trøje med – skyerne bliver hængende.'
      : preview === 'error'
        ? 'Vejrrådet er ikke tilgængeligt lige nu.'
        : '';
  const summaryLabel =
    preview === 'ready'
      ? 'Forfattet eksempel – ikke genereret af AI'
      : preview === 'pending'
        ? 'Visuelt eksempel på et afventende vejrråd'
        : preview === 'error'
          ? 'Visuelt eksempel på et utilgængeligt vejrråd'
          : '';
  return {summaryState: preview, summary, summaryLabel};
}

// The local preview fixture as the detail's view model.
export function localWeatherModel(w: WeatherFixture = WEATHER): WeatherDetailModel {
  const preview = oneOf(w.advicePreview, ADVICE_PREVIEWS) ? w.advicePreview : null;
  const nextRain = w.hours.find(hour => isFiniteNumber(hour.precipitation) && hour.precipitation > 0);
  const unit = w.units?.temperature || '°C';
  const time = (period: {datetime: string}) =>
    formatDate(new Date(period.datetime), {timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit'});
  const first = w.hours[0];
  const metadata: WeatherMetadataRow[] = isFiniteNumber(first?.precipitation_probability)
    ? [{id: 'rain', label: 'Regn næste time', value: `${String(Math.round(first.precipitation_probability))} %`}]
    : [];
  const hours = w.hours.map((h, i): WeatherHour => {
    const metrics = weatherMetrics(h, w.units);
    return {
      id: `fixture-hour-${String(i)}`,
      time: time(h),
      temperature: weatherTemperature(h.temperature, unit),
      ...forecastQuantities(h, w.units),
      condition: conditionLabel(h.condition),
      icon: conditionIcon(h.condition),
      ...metrics,
      rain: hourPrecipitation(h, w.units),
      wind: windStrength(h.wind_speed, w.units?.windSpeed),
      windSpeed: metrics.wind,
      windBearing: windFrom(h.wind_bearing)?.degrees ?? null,
    };
  });
  const days = w.days.map(
    (d, i): WeatherDay => ({
      id: `fixture-day-${String(i)}`,
      day: d.day,
      low: weatherTemperature(d.low, unit),
      high: weatherTemperature(d.high, unit),
      condition: conditionLabel(d.condition || 'cloudy'),
      icon: conditionIcon(d.condition || 'cloudy'),
      start: (d.low - 8) * 7,
      length: (d.high - d.low) * 7,
    }),
  );
  return {
    title: w.place,
    subtitle: '',
    appearance: weatherAppearance({condition: w.conditionCode, isDaytime: w.isDaytime}),
    current: {
      temperature: weatherTemperature(w.temperature, unit),
      condition: w.condition,
      icon: conditionIcon(w.conditionCode, w.isDaytime),
      range: `Højst ${weatherTemperature(w.high, unit)} · Lavest ${weatherTemperature(w.low, unit)}`,
    },
    metadata,
    summary: nextRain ? `Regn fra kl. ${time(nextRain)}. ${clothingTip(w)}` : clothingTip(w),
    hoursLabel: 'Timeprognose. Scroll vandret for flere timer',
    hours,
    days,
    source: 'Eksempeldata',
    ...(preview ? previewAdvice(preview) : {}),
  };
}

// The AI-advice owner a live answer must match to be shown.
export interface WeatherAiContext {
  roomId?: unknown;
  sessionId?: unknown;
  turnId?: unknown;
  taskId?: unknown;
  inputRevision?: unknown;
  providerGeneration?: unknown;
}

// The passive advice capability for this room (see weatherAdviceCapability).
export interface WeatherPassiveCapability extends WeatherPassiveContext {
  availability?: unknown;
  status?: unknown;
}

export interface LiveWeatherOptions {
  connected?: boolean;
  reason?: unknown;
  readStatus?: unknown;
  now?: number;
  aiContext?: WeatherAiContext | null;
  passiveContext?: WeatherPassiveCapability | null;
  passiveAdvice?: unknown;
  passiveStatus?: unknown;
}

const CONNECTION_REASONS: Record<WeatherConnectionReason, string> = {
  setup: 'Tilføj i Home Assistant',
  unavailable: 'Home Assistant svarer ikke lige nu',
  denied: 'PodView har ikke adgang – log ind i Home Assistant',
};
const AI_OWNER_KEYS = ['roomId', 'sessionId', 'turnId', 'taskId', 'inputRevision', 'providerGeneration'] as const;
const FAILED: readonly unknown[] = ['error', 'unavailable'];

// One source-provided clothing sentence occupies the advice slot. Prefer the
// existing clothing-specific text; do not concatenate overlapping rule outputs
// or present these bounded source rules as generated AI advice.
export function liveWeatherModel(
  w: WeatherObservation | null | undefined,
  {
    connected = true,
    reason = null,
    readStatus = null,
    now = Date.now(),
    aiContext = null,
    passiveContext = null,
    passiveAdvice = null,
    passiveStatus = null,
  }: LiveWeatherOptions = {},
): WeatherDetailModel {
  // Only the connection owner can name a cause. Missing observations or a lost
  // transport alone cannot establish missing setup, permission or provider error.
  const connectionReason =
    typeof reason === 'string' && Object.hasOwn(CONNECTION_REASONS, reason)
      ? (reason as WeatherConnectionReason)
      : null;
  const readFailed = connected && !connectionReason && readStatus === 'error';
  const readDenied = connected && !connectionReason && readStatus === 'denied';
  const status = connectionReason
    ? 'Ikke forbundet'
    : readDenied
      ? 'Adgang til vejret mangler'
      : readFailed
        ? 'Vejret kunne ikke hentes'
        : 'Ingen vejrdata';
  const emptyDetail = connectionReason
    ? CONNECTION_REASONS[connectionReason]
    : readDenied
      ? 'Vejroplysningerne kan ikke læses med den aktuelle adgang.'
      : readFailed
        ? 'Der er ingen aktuelle vejroplysninger at vise.'
        : 'Der er endnu ingen vejroplysninger at vise.';
  const empty = {
    title: 'Vejr',
    subtitle: status,
    appearance: weatherAppearance(null),
    current: null,
    emptyTitle: status,
    emptyDetail,
    emptyIcon: connectionReason ? 'cloud-sun' : null,
    overviewStatus: status,
    connectionReason,
    summary: '',
    hours: [],
    days: [],
    source: '',
  } satisfies WeatherDetailModel;
  if (
    !w ||
    (Object.hasOwn(w, 'displayUntil') &&
      (!isFiniteNumber(w.displayUntil) || !Number.isFinite(now) || now >= w.displayUntil))
  ) {
    return empty;
  }
  const displayLocation = weatherDisplayLocation(w.displayLocation, now);
  const geoNames = displayLocation?.source === 'ha_home_geonames' ? displayLocation : null;
  const format = (value: unknown) => weatherTemperature(value, w.unit);
  const days: ForecastDayRow[] =
    Object.hasOwn(w, 'displayUntil') && w.forecastType === 'hourly' && !hourlyWeather(w, now)
      ? []
      : forecastDayRows(w);
  const ranges = days.filter(
    (d): d is ForecastDayRow & {low: number; high: number} => isFiniteNumber(d.low) && isFiniteNumber(d.high),
  );
  const today = ranges.find(d => d.key === localDayKey(new Date(now)));
  const allLow = Math.min(...ranges.map(d => d.low));
  const allHigh = Math.max(...ranges.map(d => d.high));
  const span = Math.max(1, allHigh - allLow);
  const retrieved = Date.parse(w.retrievedAt);
  const freshUntil = weatherFreshUntil(w);
  const appearanceFresh =
    !w.stale && !readFailed && connected && Number.isFinite(now) && retrieved <= now && now < freshUntil;
  const appearance = weatherAppearance(w.current, {fresh: appearanceFresh});
  const retainedClock =
    !appearanceFresh && isFiniteNumber(w.displayUntil) && Number.isFinite(retrieved)
      ? new Date(retrieved).toLocaleString('da-DK', {
          timeZone: 'Europe/Copenhagen',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;
  const updated = appearanceFresh ? '' : updatedLabel(retrieved, new Date(now));
  const hourly = hourlyWeather(w, now);
  const ai = weatherAiAdvice(w.aiAdvice, w, now);
  const aiCurrent =
    !!ai &&
    appearanceFresh &&
    !hourly?.stale &&
    !!aiContext &&
    AI_OWNER_KEYS.every(key => ai[key] === aiContext[key]);
  const passive =
    passiveContext &&
    !FAILED.includes(passiveStatus) &&
    passiveContext.availability !== 'unavailable' &&
    appearanceFresh &&
    !hourly?.stale
      ? weatherPassiveAdvice(passiveAdvice || w.passiveAdvice, w, now, passiveContext)
      : null;
  const passiveReady = passive?.status === 'ready';
  const pending =
    !FAILED.includes(passiveStatus) &&
    !aiCurrent &&
    !passiveReady &&
    appearanceFresh &&
    !!passiveContext &&
    (passive?.status === 'pending' || passiveStatus === 'requesting' || passiveStatus === 'pending');
  // The status an unavailable passive advice reports: the caller's, else the receipt's.
  const failedStatus: unknown = passiveStatus || passive?.status;
  let summaryState: WeatherAdviceState;
  if (aiCurrent || passiveReady) summaryState = 'ready';
  else if (pending) summaryState = 'pending';
  else if (passiveContext && oneOf(failedStatus, ['error', 'unavailable'] as const)) summaryState = failedStatus;
  else if (
    passiveContext?.availability === 'available' &&
    passiveContext.status === 'idle' &&
    (passiveStatus === null || passiveStatus === 'idle')
  ) {
    summaryState = 'idle';
  } else summaryState = null;
  const rule = appearanceFresh && hourly && !hourly.stale ? weatherAdvice(hourly.advice, hourly, now) : null;
  const counts = new Map<string, number>();
  for (const p of hourly?.forecast ?? []) counts.set(p.datetime, (counts.get(p.datetime) ?? 0) + 1);
  const periods = hourly
    ? hourly.forecast
        .filter(p => counts.get(p.datetime) === 1 && Date.parse(p.datetime) > now)
        .sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime))
        .slice(0, 12)
    : [];
  const next = periods[0];
  const refreshTimes = [
    ...(isFiniteNumber(w.displayUntil) ? [w.displayUntil] : []),
    ...(geoNames ? [geoNames.validUntil * 1000] : []),
    ...(ai && aiCurrent ? [ai.validUntil * 1000] : []),
    ...(passive ? [passive.validUntil * 1000] : []),
    ...(hourly ? [Date.parse(hourly.retrievedAt) + 900000] : []),
    ...(next ? [Date.parse(next.datetime)] : []),
    ...(appearanceFresh ? [freshUntil] : []),
  ];
  const current: WeatherCurrent | null = w.current
    ? {
        temperature: format(w.current.temperature),
        condition: conditionLabel(w.current.condition) || 'Aktuel beskrivelse ikke oplyst',
        icon: conditionIcon(w.current.condition, w.current.isDaytime),
        range: today ? `Højst ${format(today.high)} · Lavest ${format(today.low)}` : '',
      }
    : null;
  const metadata: WeatherMetadataRow[] = [];
  if (retainedClock) {
    const value = updated ? updated.slice('Opdateret: '.length) : retainedClock;
    metadata.push({id: 'weather-retrieved', label: 'Opdateret', value});
  }
  if (isFiniteNumber(next?.rain)) {
    metadata.push({id: 'rain', label: 'Regn næste time', value: `${String(Math.round(next.rain))} %`});
  }
  const subtitle = readFailed
    ? ['Vejret kunne ikke opdateres', updated].filter(Boolean).join(' · ')
    : !appearanceFresh
      ? updated || 'Ikke opdateret'
      : hourly?.stale
        ? 'Vejret i dag · Timeprognosen er ikke opdateret'
        : 'Vejret i dag';
  // The AI slot holds only AI prose, its reserved pending space or the honest unavailable line.
  const summary =
    ai && aiCurrent
      ? ai.summary
      : passive && passiveReady
        ? (passive.summary ?? '')
        : pending
          ? ''
          : passiveContext && oneOf(summaryState, ['error', 'unavailable'])
            ? 'Vejrrådet er ikke tilgængeligt lige nu.'
            : '';
  const hours: WeatherHour[] = hourly
    ? periods.map(p => {
        const metrics = weatherMetrics(p, hourly.units);
        const units: WeatherUnits = hourly.units;
        return {
          id: p.datetime,
          time: formatDate(new Date(p.datetime), {hour: '2-digit', minute: '2-digit'}),
          temperature: format(p.temperature),
          ...forecastQuantities(p, {...units, temperature: w.unit}),
          condition: conditionLabel(p.condition),
          icon: conditionIcon(p.condition),
          ...metrics,
          rain: hourPrecipitation(p, units),
          wind: windStrength(p.wind_speed, units.windSpeed),
          windSpeed: metrics.wind,
          windBearing: windFrom(p.wind_bearing)?.degrees ?? null,
        };
      })
    : [];
  const model: WeatherDetailModel = {
    title: displayLocation?.name || w.location || 'Vejr',
    emptyTitle: 'Aktuelt vejr ikke tilgængeligt',
    emptyDetail:
      periods.length || days.length
        ? 'Se den tilgængelige prognose nedenfor.'
        : 'Der er endnu ingen vejroplysninger at vise.',
    sourceStale: !appearanceFresh,
    timeStale: !(Number.isFinite(now) && retrieved <= now && now < freshUntil),
    updated,
    subtitle,
    appearance,
    current,
    metadata,
    summary,
    summaryKind: aiCurrent || passiveReady ? 'ai' : '',
    summaryState,
    // Without AI prose on screen or on its way, the source's own next-hour rule sentence follows the condition
    // (»Skyet · Overvej en varm jakke.«), as on the canvas; it is never labelled or placed as AI.
    conditionAdvice: aiCurrent || passiveReady || pending || summaryState === 'idle' ? '' : rule?.summary || '',
    summaryLabel:
      aiCurrent || passiveReady ? 'AI-råd baseret på vejrudsigten' : pending ? 'Et vejrråd er på vej' : '',
    adviceUntil: ai && aiCurrent ? ai.validUntil * 1000 : passive ? passive.validUntil * 1000 : null,
    refreshAt: refreshTimes.length ? Math.min(...refreshTimes) : null,
    hoursLabel:
      !appearanceFresh || hourly?.stale
        ? 'Timeprognosen er ikke opdateret. Scroll vandret for flere timer'
        : 'Vejret de næste timer. Scroll vandret for flere timer',
    hours,
    days: days.map((d): WeatherDay => {
      const range = isFiniteNumber(d.low) && isFiniteNumber(d.high);
      return {
        id: d.key,
        // A-Vejr: »I dag«, then the weekday in full (»Tirsdag«).
        day: d.key === localDayKey(new Date(now)) ? 'I dag' : capitalise(formatDate(d.start, {weekday: 'long'})),
        condition: conditionLabel(d.condition),
        icon: conditionIcon(d.condition),
        low: format(range ? d.low : d.temperature),
        high: range ? format(d.high) : '',
        start: range ? (((d.low ?? 0) - allLow) / span) * 100 : null,
        length: range ? (((d.high ?? 0) - (d.low ?? 0)) / span) * 100 : null,
      };
    }),
    source: [weatherSourceLabel(w.source), geoNames ? 'Stednavn: GeoNames · CC BY 4.0' : '']
      .filter(Boolean)
      .join('\n'),
  };
  return !model.current && !model.hours.length && !model.days.length
    ? {...model, ...empty, title: model.title, source: model.source}
    : model;
}

const capitalise = (text: string) => text.charAt(0).toLocaleUpperCase('da-DK') + text.slice(1);

// The parts of a weather model the overview card reads.
export type WeatherOverviewInput = Partial<
  Pick<WeatherDetailModel, 'current' | 'overviewStatus' | 'hours' | 'days' | 'sourceStale' | 'updated' | 'emptyDetail'>
>;

// The local header, overview, photo and detail share one fixture projection.
// Live surfaces continue to be populated solely by their observed-data adapter.
export function weatherOverviewDetail(
  model: WeatherOverviewInput,
  {role = 'detail'}: {role?: 'detail' | 'condition'} = {},
): string {
  if (role === 'condition') {
    const condition = model.current?.condition || model.overviewStatus || '';
    const hasFacts = !!model.current || !!model.hours?.length || !!model.days?.length;
    if (!model.sourceStale || !hasFacts) return condition;
    return [condition, model.updated || 'Ikke opdateret'].filter(Boolean).join(' · ');
  }
  if (!model.current && !model.hours?.length && !model.days?.length) return model.emptyDetail || '';
  // K-Widget vejr: »Højst 8° · lavest 6°«.
  const range = (model.current?.range || '').replace(' · Lavest ', ' · lavest ');
  return range || (!model.sourceStale ? 'Se vejrudsigten' : '');
}

// Keep the header slot stable even when current data is unavailable.
// Photo has its own weather chip; disabled empty copy makes no forecast claim.
export const weatherHeaderVisible = (focus: unknown): boolean => focus !== 'photo';
