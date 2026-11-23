// The weather observation model: validates the server's weather DTOs (current weather, forecast,
// rule advice, AI advice receipts, display locality) and projects them into one bounded shape.
// Pure functions, no DOM. Erasable TypeScript only (no enums, namespaces or parameter properties,
// explicit .ts imports), so the server's tests can run it in plain Node with type stripping.
import type {WeatherAppearance, WeatherPhase, WeatherTone} from './model.ts';

// ---- Shared helpers for reading untyped input ----------------------------------------------------

// A property bag read from untyped JSON. Reading a property of null throws, as in the original.
type Loose = Record<string, unknown>;
const loose = (value: unknown): Loose => value as Loose;
// The optional-chaining read `value?.key`: undefined for null/undefined, else the property.
const optional = (value: unknown): Loose | undefined => (value == null ? undefined : (value as Loose));
const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);
const isRecord = (value: unknown): value is Loose =>
  !!value && typeof value === 'object' && !Array.isArray(value);
// RegExp#test and Date.parse coerce their argument to a string; keep that coercion for untyped input.
const matches = (pattern: RegExp, value: unknown): boolean => pattern.test(value as string);
const parseTime = (value: unknown): number => Date.parse(value as string);
const hasExactKeys = (value: Loose, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const oneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  (values as readonly unknown[]).includes(value);

// ---- Types ---------------------------------------------------------------------------------------

export type TemperatureUnit = '°C' | '°F' | 'C' | 'F';
const TEMPERATURE_UNITS: readonly TemperatureUnit[] = ['°C', '°F', 'C', 'F'];

export interface WeatherUnits {
  temperature: TemperatureUnit;
  // The source's own unit strings, kept unvalidated; display code converts only known units.
  precipitation: unknown;
  windSpeed: unknown;
}

export interface WeatherCurrentObservation {
  temperature: number | null;
  condition: string;
  isDaytime?: boolean;
}

export interface WeatherPeriod {
  datetime: string;
  temperature: number | null;
  condition: string;
  // The source's precipitation probability in percent.
  rain: number | null;
  precipitation: number | null;
  wind_speed: number | null;
  wind_bearing: number | null;
  highTemperature?: number;
  lowTemperature?: number;
}

export interface WeatherObservationScope {
  entityId: string;
  ownerEpoch: string;
}

export interface ConfiguredDisplayLocation {
  name: string;
  source: 'configured_label';
}

export interface GeoNamesDisplayLocation {
  name: string;
  source: 'ha_home_geonames';
  method: 'nearest_populated_place';
  scope: 'ha_home';
  datasetVersion: string;
  observedAt: number;
  validUntil: number;
}

export type WeatherDisplayLocation = ConfiguredDisplayLocation | GeoNamesDisplayLocation;

export interface WeatherAdviceEvidence {
  field: 'temperature' | 'wind_speed' | 'precipitation' | 'precipitation_probability';
  value: number;
  unit: string;
  normalizedValue: number;
  normalizedUnit: string;
}

// A bounded source-owned clothing rule for one forecast hour.
export interface WeatherRuleAdvice {
  id: string;
  ruleVersion: 'next-hour-clothing-v1';
  source: string;
  retrievedAt: string;
  periodTime: string;
  evidence: WeatherAdviceEvidence[];
  kind: 'practical_guidance';
  scope: 'next_hourly_period';
  summary: string;
  children: string;
  validUntil: number;
}

export interface WeatherAiAdvice {
  schema: 'podview.weather-advice.v1';
  receiptId: string;
  weatherReceiptId: string;
  roomId: string;
  sessionId: string;
  turnId: string;
  taskId: string;
  inputRevision: number;
  providerGeneration: number;
  summary: string;
  summaryKind: 'ai_advice';
  evidenceFactIds: string[];
  validUntil: number;
  source: string;
  sourceRetrievedAt: unknown;
}

export type WeatherAdviceAvailability = 'available' | 'unavailable';
export type WeatherAdviceCapabilityStatus = 'idle' | 'pending' | 'ready' | 'unavailable' | 'error';

export interface WeatherAdviceCapability {
  schema: 'podview.weather-advice-capability.v1';
  bootId: string;
  roomId: string;
  weatherKey: string | null;
  source: string | null;
  sourceRetrievedAt: number | null;
  availability: WeatherAdviceAvailability;
  status: WeatherAdviceCapabilityStatus;
  validUntil: number | null;
}

export type WeatherPassiveStatus = 'pending' | 'ready' | 'unavailable' | 'error';

export interface WeatherPassiveAdvice {
  schema: 'podview.passive-weather-advice.v1';
  bootId: string;
  roomId: string;
  weatherKey: string;
  requestId: string | null;
  source: string;
  sourceRetrievedAt: number;
  validUntil: number;
  status: WeatherPassiveStatus;
  summaryKind: 'ai_advice';
  summary: string | null;
  evidenceFactIds: string[];
}

export interface WeatherCoverage {
  truncated: boolean;
  totalRows: unknown;
  returnedRows: number;
}

export interface WeatherObservation {
  hourlyUnavailable: boolean;
  observationScope?: WeatherObservationScope;
  // Null only on a stale retained observation (weatherFactObservation).
  displayLocation?: WeatherDisplayLocation | null;
  source: string;
  location: string;
  retrievedAt: string;
  // The source's own state timestamp, unvalidated.
  stateUpdatedAt: unknown;
  observedAt: number;
  units: WeatherUnits;
  // The display suffix: '°C', '°F' (a bare 'C'/'F' gains the degree sign).
  unit: string;
  current: WeatherCurrentObservation | null;
  forecast: WeatherPeriod[];
  aiAdvice: WeatherAiAdvice | null;
  passiveAdvice: WeatherPassiveAdvice | null;
  forecastType: string;
  advice: WeatherRuleAdvice | null;
  coverage: WeatherCoverage;
  hourly?: WeatherObservation;
  // Set by weatherFactObservation: the fixed display deadline (epoch ms) and a retained copy.
  displayUntil?: number;
  stale?: boolean;
}

// ---- Conditions and appearance -------------------------------------------------------------------

const conditions = {
  clear: 'Klart',
  sunny: 'Solrigt',
  partlycloudy: 'Let skyet',
  cloudy: 'Skyet',
  rainy: 'Regn',
  pouring: 'Kraftig regn',
  snowy: 'Sne',
  fog: 'Tåge',
  windy: 'Blæsende',
  'clear-night': 'Klar nat',
  lightning: 'Torden',
  'lightning-rainy': 'Torden og regn',
  'snowy-rainy': 'Slud',
  exceptional: 'Usædvanligt vejr',
};

export const conditionLabel = (value: unknown): string =>
  Object.hasOwn(conditions, value as PropertyKey)
    ? conditions[value as keyof typeof conditions]
    : // An unknown condition code is shown as the source's own text, coerced as before.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      String(value || '').slice(0, 80);

const icons = {
  clear: 'sun',
  sunny: 'sun',
  'clear-night': 'moon',
  partlycloudy: 'cloud-sun',
  cloudy: 'cloud',
  rainy: 'cloud-rain',
  pouring: 'cloud-rain',
  snowy: 'cloud-snow',
  'snowy-rainy': 'cloud-snow',
  fog: 'cloud-fog',
  windy: 'wind',
  lightning: 'cloud-lightning',
  'lightning-rainy': 'cloud-lightning',
  exceptional: 'warning',
};

export function conditionIcon(value: unknown, isDaytime?: unknown): string | null {
  if (isDaytime === false && oneOf(value, ['clear', 'sunny', 'partlycloudy'])) {
    return value === 'partlycloudy' ? 'cloud' : 'moon';
  }
  return Object.hasOwn(icons, value as PropertyKey) ? icons[value as keyof typeof icons] : null;
}

const tones: Record<string, Exclude<WeatherTone, 'neutral'>> = {
  clear: 'clear',
  sunny: 'clear',
  'clear-night': 'clear',
  partlycloudy: 'partlycloudy',
  cloudy: 'cloudy',
  rainy: 'rain',
  pouring: 'rain',
  snowy: 'snow',
  'snowy-rainy': 'snow',
  fog: 'fog',
  windy: 'wind',
  lightning: 'storm',
  'lightning-rainy': 'storm',
};

export interface WeatherConditionFacts {
  condition?: unknown;
  isDaytime?: unknown;
}

// Presentation uses admitted condition data. Neither the clock nor a household
// label can prove day/night; an absent source day flag stays unknown.
export function weatherAppearance(
  current: WeatherConditionFacts | null | undefined,
  {fresh = true}: {fresh?: boolean} = {},
): WeatherAppearance {
  const tone = current ? tones[current.condition as string] : undefined;
  if (!fresh || !current || !Object.hasOwn(tones, current.condition as PropertyKey) || tone === undefined) {
    return {tone: 'neutral', phase: 'unknown', photo: false};
  }
  let phase: WeatherPhase;
  if (current.condition === 'clear-night') phase = current.isDaytime === true ? 'unknown' : 'night';
  else if (typeof current.isDaytime === 'boolean') phase = current.isDaytime ? 'day' : 'night';
  else phase = 'unknown';
  return {tone, phase, photo: tone === 'partlycloudy' && phase === 'day'};
}

export function weatherTemperature(value: unknown, unit = '°C'): string {
  if (!isFiniteNumber(value)) return '—';
  const number = new Intl.NumberFormat('da-DK', {maximumFractionDigits: 0}).format(Math.abs(value) < 0.5 ? 0 : value);
  return `${number}${unit === '°C' || unit === 'C' ? '°' : unit}`;
}

// ---- Days ----------------------------------------------------------------------------------------

export const localDayKey = (date: Date): string =>
  `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-` +
  String(date.getDate()).padStart(2, '0');

export interface HourlyDayRange {
  key: string;
  start: Date;
  low: number;
  high: number;
}

// Only local days with every hour present (23, 24 or 25 rows) get a low/high range.
export function completeHourlyDayRanges(
  periods: readonly {datetime: unknown; temperature: unknown}[],
): HourlyDayRange[] {
  const groups = new Map<string, {date: Date; temperature: number}[]>();
  for (const row of periods) {
    const date = new Date(row.datetime as string);
    if (
      !Number.isFinite(date.getTime()) ||
      !isFiniteNumber(row.temperature) ||
      date.getMinutes() !== 0 ||
      date.getSeconds() !== 0 ||
      date.getMilliseconds() !== 0
    ) {
      continue;
    }
    const key = localDayKey(date);
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push({date, temperature: row.temperature});
  }
  const result: HourlyDayRange[] = [];
  for (const [key, rows] of groups) {
    const [year, month, day] = key.split('-').map(Number) as [number, number, number];
    const start = new Date(year, month - 1, day);
    const end = new Date(year, month - 1, day + 1);
    const expected: number[] = [];
    for (let t = start.getTime(); t < end.getTime(); t += 3600000) expected.push(t);
    const times = new Set(rows.map(row => row.date.getTime()));
    if (rows.length !== expected.length || times.size !== expected.length || expected.some(t => !times.has(t))) {
      continue;
    }
    const temperatures = rows.map(row => row.temperature);
    result.push({key, start, low: Math.min(...temperatures), high: Math.max(...temperatures)});
  }
  return result.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// ---- Display location ----------------------------------------------------------------------------

const GEONAMES_KEYS = ['name', 'source', 'method', 'scope', 'datasetVersion', 'observedAt', 'validUntil'] as const;

// Display locality is a bounded label, never the provider's forecast location.
export function weatherDisplayLocation(label: unknown, now: number = Date.now()): WeatherDisplayLocation | null {
  if (
    !isRecord(label) ||
    typeof label.name !== 'string' ||
    !label.name.length ||
    label.name.length > 80 ||
    /[\x00-\x1f\x7f]/.test(label.name)
  ) {
    return null;
  }
  const name = label.name;
  if (label.source === 'configured_label' && hasExactKeys(label, ['name', 'source'])) {
    return {name, source: label.source};
  }
  if (
    !hasExactKeys(label, GEONAMES_KEYS) ||
    label.source !== 'ha_home_geonames' ||
    label.method !== 'nearest_populated_place' ||
    label.scope !== 'ha_home' ||
    !/^Ved \S/.test(name) ||
    /[\p{C}\p{Z}]/u.test(name.replaceAll(' ', '')) ||
    typeof label.datasetVersion !== 'string' ||
    !/^[a-f0-9]{64}$/.test(label.datasetVersion) ||
    !Number.isFinite(now) ||
    !isFiniteNumber(label.observedAt) ||
    !isFiniteNumber(label.validUntil) ||
    label.observedAt * 1000 > now ||
    now >= label.validUntil * 1000 ||
    label.validUntil - label.observedAt > 60
  ) {
    return null;
  }
  return {
    name,
    source: label.source,
    method: label.method,
    scope: label.scope,
    datasetVersion: label.datasetVersion,
    observedAt: label.observedAt,
    validUntil: label.validUntil,
  };
}

// ---- The observation -----------------------------------------------------------------------------

const HOURLY_KEYS = [
  'source', 'location', 'retrievedAt', 'stateUpdatedAt', 'observedAt', 'units', 'current', 'forecastType',
  'forecast', 'advice', 'coverage', 'displayLocation', 'aiAdvice', 'passiveAdvice', 'observationScope',
];
const UNIT_KEYS = ['temperature', 'precipitation', 'windSpeed'] as const;

function weatherPeriod(value: unknown, daily: boolean): WeatherPeriod {
  const row = loose(value);
  if (
    daily &&
    (('highTemperature' in row &&
      (!isFiniteNumber(row.highTemperature) || row.highTemperature !== row.temperature)) ||
      ('lowTemperature' in row &&
        (!isFiniteNumber(row.lowTemperature) ||
          !isFiniteNumber(row.highTemperature) ||
          row.lowTemperature > row.highTemperature)))
  ) {
    throw new Error('invalid_daily_range');
  }
  if (typeof row.datetime !== 'string' || !Number.isFinite(Date.parse(row.datetime))) {
    throw new Error('invalid_weather_period');
  }
  const chance = row.precipitation_probability;
  return {
    datetime: row.datetime,
    temperature: isFiniteNumber(row.temperature) ? row.temperature : null,
    condition: typeof row.condition === 'string' ? row.condition.slice(0, 80) : '',
    rain: isFiniteNumber(chance) && chance >= 0 && chance <= 100 ? chance : null,
    precipitation: isFiniteNumber(row.precipitation) && row.precipitation >= 0 ? row.precipitation : null,
    wind_speed: isFiniteNumber(row.wind_speed) && row.wind_speed >= 0 ? row.wind_speed : null,
    wind_bearing:
      isFiniteNumber(row.wind_bearing) && row.wind_bearing >= 0 && row.wind_bearing <= 360 ? row.wind_bearing : null,
    ...(daily && isFiniteNumber(row.highTemperature) ? {highTemperature: row.highTemperature} : {}),
    ...(daily && isFiniteNumber(row.lowTemperature) ? {lowTemperature: row.lowTemperature} : {}),
  };
}

function observationScopeOf(identity: unknown): WeatherObservationScope | null {
  if (!isRecord(identity) || Object.keys(identity).sort().join(',') !== 'entityId,ownerEpoch') return null;
  if (!matches(/^weather\.[a-z0-9_]+$/, identity.entityId || '')) return null;
  if (!matches(/^[a-f0-9]{64}$/, identity.ownerEpoch || '')) return null;
  // The pattern checks coerce like the original; the values are passed through as given.
  return {entityId: identity.entityId as string, ownerEpoch: identity.ownerEpoch as string};
}

// Validates and projects a weather DTO; throws on a malformed observation.
export function weatherObservation(value: unknown, includeHourly = true): WeatherObservation {
  const v = loose(value);
  if (
    !value ||
    typeof v.source !== 'string' ||
    !v.source.length ||
    typeof v.retrievedAt !== 'string' ||
    !Number.isFinite(Date.parse(v.retrievedAt)) ||
    !isFiniteNumber(v.observedAt) ||
    !v.units ||
    !Array.isArray(v.forecast) ||
    v.forecast.length > 48
  ) {
    throw new Error('invalid_weather');
  }
  const units = loose(v.units);
  const unit = units.temperature;
  if (!oneOf(unit, TEMPERATURE_UNITS)) throw new Error('unknown_temperature_unit');
  const source = v.source;
  const raw = optional(v.current);
  const current: WeatherCurrentObservation | null =
    v.current === null
      ? null
      : {
          temperature: isFiniteNumber(raw?.temperature) ? raw.temperature : null,
          condition: typeof raw?.condition === 'string' ? raw.condition.slice(0, 80) : '',
          ...(typeof raw?.is_daytime === 'boolean' ? {isDaytime: raw.is_daytime} : {}),
        };
  const daily = v.forecastType === 'daily';
  const forecast = (v.forecast as unknown[]).map(row => weatherPeriod(row, daily));
  const displayLocation = weatherDisplayLocation(v.displayLocation);
  const observationScope = observationScopeOf(v.observationScope);
  const coverage = optional(v.coverage);
  const projected: WeatherObservation = {
    hourlyUnavailable: daily && !Object.hasOwn(v, 'hourly'),
    ...(observationScope ? {observationScope} : {}),
    ...(displayLocation ? {displayLocation} : {}),
    source: source.slice(0, 120),
    location: typeof v.location === 'string' ? v.location.slice(0, 120) : '',
    retrievedAt: v.retrievedAt,
    stateUpdatedAt: v.stateUpdatedAt,
    observedAt: v.observedAt,
    units: {temperature: unit, precipitation: units.precipitation, windSpeed: units.windSpeed},
    unit: unit.length === 1 ? '°' + unit : unit,
    current,
    forecast,
    aiAdvice: weatherAiAdvice(v.aiAdvice, v),
    passiveAdvice: weatherPassiveAdvice(v.passiveAdvice, v),
    forecastType: typeof v.forecastType === 'string' ? v.forecastType : '',
    advice: weatherAdvice(v.advice, v),
    coverage: {truncated: coverage?.truncated === true, totalRows: coverage?.totalRows, returnedRows: forecast.length},
  };
  if (includeHourly && daily && v.hourly) {
    // The server binds the owner. The display independently checks the closed
    // auxiliary shape and provenance; failure cannot remove the daily forecast.
    const h = loose(v.hourly);
    if (
      typeof v.hourly === 'object' &&
      !Array.isArray(v.hourly) &&
      Object.keys(h).every(key => HOURLY_KEYS.includes(key)) &&
      h.forecastType === 'hourly' &&
      h.source === v.source &&
      h.location === v.location &&
      UNIT_KEYS.every(key => optional(h.units)?.[key] === units[key])
    ) {
      try {
        const hourly = weatherObservation(h, false);
        const scope = hourly.observationScope;
        // Both unscoped, or both scoped to the same entity and owner epoch.
        const sameOwner =
          observationScope && scope
            ? observationScope.entityId === scope.entityId && observationScope.ownerEpoch === scope.ownerEpoch
            : !observationScope && !scope;
        if (sameOwner) projected.hourly = hourly;
      } catch {
        // An invalid hourly companion is dropped; the daily forecast stands.
      }
    }
  }
  return projected;
}

// ---- Freshness -----------------------------------------------------------------------------------

interface DeadlineFacts {
  observationScope?: WeatherObservationScope | undefined;
  retrievedAt: string;
  observedAt: number;
  stateUpdatedAt: unknown;
  current: WeatherCurrentObservation | null;
}

// One fixed display deadline from source facts. Delivery and rendering never
// renew it; the source's shorter hourly limit remains independently binding.
function weatherFactDeadline(weather: DeadlineFacts, now: number, allowCurrentOnly = false): number | null {
  const timestamp = (value: unknown) =>
    typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
  const retrieved = timestamp(weather.retrievedAt);
  const observed = weather.observedAt * 1000;
  const updated = weather.stateUpdatedAt == null ? null : timestamp(weather.stateUpdatedAt);
  if (
    (!weather.observationScope && !allowCurrentOnly) ||
    !Number.isFinite(now) ||
    !Number.isFinite(retrieved) ||
    retrieved > now ||
    !Number.isFinite(observed) ||
    observed < retrieved ||
    observed > now ||
    (updated !== null && (!Number.isFinite(updated) || updated > retrieved))
  ) {
    return null;
  }
  if (weather.current === null) return retrieved + 7200000;
  return updated !== null ? Math.min(retrieved + 7200000, updated + 7200000) : null;
}

export interface WeatherFactOptions {
  now?: number;
  // The server's retention bound for a stale copy, in epoch seconds.
  validUntil?: unknown;
  stale?: boolean;
  allowCurrentOnly?: boolean;
}

const STALE_FIELDS = {stale: true, advice: null, aiAdvice: null, passiveAdvice: null, displayLocation: null} as const;

// A displayable observation with its fixed display deadline, or null when it may not be shown.
export function weatherFactObservation(
  value: unknown,
  {now = Date.now(), validUntil = null, stale = false, allowCurrentOnly = false}: WeatherFactOptions = {},
): WeatherObservation | null {
  const currentOnly = allowCurrentOnly && !stale && isRecord(value) && !Object.hasOwn(value, 'observationScope');
  if (allowCurrentOnly && !currentOnly) return null;
  const weather = weatherObservation(value);
  const deadline = weatherFactDeadline(weather, now, currentOnly);
  if (deadline === null || deadline <= now) return null;
  let displayUntil = deadline;
  if (validUntil !== null) {
    if (!isFiniteNumber(validUntil)) return null;
    const offered = Math.floor(validUntil * 1000);
    if (offered <= now || offered > deadline) return null;
    displayUntil = offered;
  }
  const result: WeatherObservation = {...weather, displayUntil, ...(stale ? STALE_FIELDS : {})};
  if (weather.hourly) {
    const hourlyDeadline = weatherFactDeadline(weather.hourly, now);
    const hourlyUntil = Math.min(displayUntil, hourlyDeadline ?? 0, Date.parse(weather.hourly.retrievedAt) + 900000);
    if (!Number.isFinite(hourlyUntil) || hourlyUntil <= now) {
      delete result.hourly;
      result.hourlyUnavailable = false;
    } else {
      result.hourly = {...weather.hourly, displayUntil: hourlyUntil, ...(stale ? STALE_FIELDS : {})};
    }
  }
  return result;
}

export interface WeatherFreshFacts {
  retrievedAt: unknown;
  stateUpdatedAt?: unknown;
  current?: unknown;
  displayUntil?: unknown;
}

// A recent retrieval of the same old HA state cannot renew freshness. HA's
// met.no entity changes about once an hour, so its state may be up to the same
// 2 h the server and the fact deadline accept (it was 30 min, which hid the AI
// summary and called normal weather out of date between met.no updates).
export function weatherFreshUntil(weather: WeatherFreshFacts): number {
  const retrieved = parseTime(weather.retrievedAt) + 15 * 60 * 1000;
  if (!weather.current || !Number.isFinite(weather.displayUntil)) return retrieved;
  return Math.min(retrieved, parseTime(weather.stateUpdatedAt) + 2 * 60 * 60 * 1000);
}

// The hourly forecast that may be shown now: the observation itself or its hourly companion.
export function hourlyWeather(weather: WeatherObservation, now: number = Date.now()): WeatherObservation | null {
  const h = weather.forecastType === 'hourly' ? weather : weather.hourly;
  if (h && Object.hasOwn(h, 'displayUntil') && (!isFiniteNumber(h.displayUntil) || now >= h.displayUntil)) {
    return null;
  }
  if (
    h?.forecastType !== 'hourly' ||
    h.source !== weather.source ||
    h.location !== weather.location ||
    UNIT_KEYS.some(key => optional(h.units)?.[key] !== optional(weather.units)?.[key])
  ) {
    return null;
  }
  const retrieved = Date.parse(h.retrievedAt);
  return Number.isFinite(now) && retrieved <= now && now < retrieved + 900000 ? h : null;
}

export interface ForecastDayRow {
  key: string;
  start: Date;
  condition: string;
  // Daily rows carry the source's day temperature; ranged rows also carry low/high.
  temperature?: number | null;
  low?: number;
  high?: number;
}

export function forecastDayRows(weather: Pick<WeatherObservation, 'forecastType' | 'forecast'>): ForecastDayRow[] {
  if (weather.forecastType === 'hourly') {
    const sameDay = (key: string) => (x: WeatherPeriod) => localDayKey(new Date(x.datetime)) === key && x.condition;
    return completeHourlyDayRanges(weather.forecast).map(day => ({
      ...day,
      condition: weather.forecast.find(sameDay(day.key))?.condition || '',
    }));
  }
  if (weather.forecastType !== 'daily') return [];
  const rows: ForecastDayRow[] = weather.forecast.map(period => ({
    key: localDayKey(new Date(period.datetime)),
    start: new Date(period.datetime),
    temperature: period.temperature,
    condition: period.condition || '',
    ...(isFiniteNumber(period.highTemperature) && isFiniteNumber(period.lowTemperature)
      ? {high: period.highTemperature, low: period.lowTemperature}
      : {}),
  }));
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.key, (counts.get(row.key) ?? 0) + 1);
  return rows.filter(row => counts.get(row.key) === 1).sort((a, b) => a.start.getTime() - b.start.getTime());
}

// ---- Advice --------------------------------------------------------------------------------------

const ADVICE_KEYS = [
  'id', 'ruleVersion', 'source', 'retrievedAt', 'periodTime', 'evidence', 'kind', 'scope', 'summary', 'children',
  'validUntil',
];
const EVIDENCE_KEYS = ['field', 'value', 'unit', 'normalizedValue', 'normalizedUnit'];
// Per evidence field: the observation unit key, the accepted units and the normalized unit.
const EVIDENCE_FIELDS: Record<WeatherAdviceEvidence['field'], [keyof WeatherUnits | null, string[], string]> = {
  temperature: ['temperature', ['°C', 'C', '°F', 'F'], '°C'],
  wind_speed: ['windSpeed', ['m/s', 'km/h', 'mph', 'kn'], 'm/s'],
  precipitation: ['precipitation', ['mm', 'cm', 'in'], 'mm'],
  precipitation_probability: [null, ['%'], '%'],
};
// value → normalized: (value + offset) * factor.
const CONVERSIONS: Record<string, [number, number]> = {
  '°C': [1, 0],
  C: [1, 0],
  '°F': [5 / 9, -32],
  F: [5 / 9, -32],
  'm/s': [1, 0],
  'km/h': [1 / 3.6, 0],
  mph: [0.44704, 0],
  kn: [0.5144444444444445, 0],
  mm: [1, 0],
  cm: [10, 0],
  in: [25.4, 0],
  '%': [1, 0],
};
const OFFSET_TIME = /(?:Z|[+-]\d{2}:\d{2})$/;

// Advice is a bounded source-owned suggestion for one actual forecast hour.
export function weatherAdvice(advice: unknown, weather: unknown, now: number = Date.now()): WeatherRuleAdvice | null {
  const w = weather ? loose(weather) : null;
  if (
    !isRecord(advice) ||
    !hasExactKeys(advice, ADVICE_KEYS) ||
    !w ||
    !Array.isArray(w.forecast) ||
    !Number.isFinite(now) ||
    !isFiniteNumber(advice.validUntil) ||
    advice.ruleVersion !== 'next-hour-clothing-v1' ||
    advice.kind !== 'practical_guidance' ||
    advice.scope !== 'next_hourly_period' ||
    w.forecastType !== 'hourly' ||
    !matches(/^advice:[a-f0-9]{32}$/, advice.id || '') ||
    advice.source !== w.source ||
    advice.retrievedAt !== w.retrievedAt
  ) {
    return null;
  }
  const {periodTime, retrievedAt} = advice;
  if (typeof periodTime !== 'string' || periodTime.length > 64 || !OFFSET_TIME.test(periodTime)) return null;
  if (typeof retrievedAt !== 'string' || retrievedAt.length > 64 || !OFFSET_TIME.test(retrievedAt)) return null;
  // Date.parse keeps milliseconds; floor the numeric server expiry to the same
  // precision so valid Python microsecond timestamps do not fail their own bound.
  const period = Date.parse(periodTime);
  const retrieved = Date.parse(retrievedAt);
  const expiry = Math.floor(advice.validUntil * 1000);
  if (
    !Number.isFinite(period) ||
    !Number.isFinite(retrieved) ||
    retrieved > now ||
    !Number.isFinite(expiry) ||
    expiry <= now ||
    period <= now ||
    period > now + 3600000 ||
    expiry > period ||
    expiry > retrieved + 900000
  ) {
    return null;
  }
  const matching = (w.forecast as unknown[]).filter(row => loose(row).datetime === periodTime);
  if (matching.length !== 1) return null;
  const {summary, children, evidence} = advice;
  if (typeof summary !== 'string' || !summary.length || summary.length > 240) return null;
  if (typeof children !== 'string' || !children.length || children.length > 240) return null;
  if (!Array.isArray(evidence) || evidence.length !== 1) return null;
  const row = loose(matching[0]);
  const fact: unknown = evidence[0];
  const field = optional(fact)?.field;
  if (!isRecord(fact) || !hasExactKeys(fact, EVIDENCE_KEYS)) return null;
  if (typeof field !== 'string' || !Object.hasOwn(EVIDENCE_FIELDS, field)) return null;
  const [unitKey, units, normalizedUnit] = EVIDENCE_FIELDS[field as WeatherAdviceEvidence['field']];
  if (
    !isFiniteNumber(fact.value) ||
    !isFiniteNumber(fact.normalizedValue) ||
    row[field] !== fact.value ||
    !oneOf(fact.unit, units) ||
    fact.normalizedUnit !== normalizedUnit ||
    (unitKey && optional(w.units)?.[unitKey] !== fact.unit)
  ) {
    return null;
  }
  const [factor, offset] = CONVERSIONS[fact.unit] ?? [NaN, 0];
  const normalized = (fact.value + offset) * factor;
  if (
    !Number.isFinite(normalized) ||
    Math.abs(normalized - fact.normalizedValue) > 1e-12 * Math.max(1, Math.abs(normalized)) ||
    (field === 'precipitation_probability' && (fact.value < 0 || fact.value > 100)) ||
    ((field === 'wind_speed' || field === 'precipitation') && fact.value < 0)
  ) {
    return null;
  }
  return {...advice, evidence: [{...fact}]} as unknown as WeatherRuleAdvice;
}

const AI_ADVICE_KEYS = [
  'schema', 'receiptId', 'weatherReceiptId', 'roomId', 'sessionId', 'turnId', 'taskId', 'inputRevision',
  'providerGeneration', 'summary', 'summaryKind', 'evidenceFactIds', 'validUntil', 'source', 'sourceRetrievedAt',
];
const AI_ID_KEYS = ['receiptId', 'weatherReceiptId', 'roomId', 'sessionId', 'turnId', 'taskId'];

const boundedString = (value: unknown, max: number): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const validFactIds = (ids: unknown): boolean =>
  Array.isArray(ids) &&
  ids.length >= 1 &&
  ids.length <= 12 &&
  !ids.some(id => !boundedString(id, 160)) &&
  new Set(ids).size === ids.length;

// Only a typed server-projected advice receipt, never arbitrary assistant text.
export function weatherAiAdvice(value: unknown, weather: unknown, now: number = Date.now()): WeatherAiAdvice | null {
  const w = optional(weather);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, AI_ADVICE_KEYS) ||
    value.schema !== 'podview.weather-advice.v1' ||
    value.summaryKind !== 'ai_advice' ||
    value.source !== w?.source ||
    typeof value.summary !== 'string' ||
    !value.summary.trim() ||
    value.summary.length > 240 ||
    !isFiniteNumber(value.validUntil) ||
    value.validUntil * 1000 <= now ||
    !AI_ID_KEYS.every(key => boundedString(value[key], 160)) ||
    !['inputRevision', 'providerGeneration'].every(key => Number.isInteger(value[key]) && Number(value[key]) >= 0) ||
    !validFactIds(value.evidenceFactIds)
  ) {
    return null;
  }
  const retrieved = parseTime(value.sourceRetrievedAt);
  if (
    !Number.isFinite(retrieved) ||
    retrieved !== parseTime(w?.retrievedAt) ||
    retrieved > now ||
    value.validUntil * 1000 > retrieved + 900000
  ) {
    return null;
  }
  return {...value, evidenceFactIds: [...(value.evidenceFactIds as string[])]} as unknown as WeatherAiAdvice;
}

const CAPABILITY_KEYS = [
  'schema', 'bootId', 'roomId', 'weatherKey', 'source', 'sourceRetrievedAt', 'availability', 'status', 'validUntil',
];
const WEATHER_KEY = /^[a-f0-9]{64}$/;

export interface WeatherAdviceOwner {
  bootId?: unknown;
  roomId?: unknown;
}

export type WeatherAdviceSubject = WeatherFreshFacts & {source?: unknown; stale?: unknown};

// Passive advice has its own explicit weather owner; it never borrows a voice turn.
export function weatherAdviceCapability(
  value: unknown,
  weather: WeatherAdviceSubject | null | undefined,
  {bootId, roomId}: WeatherAdviceOwner = {},
  now: number = Date.now(),
): WeatherAdviceCapability | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, CAPABILITY_KEYS) ||
    value.schema !== 'podview.weather-advice-capability.v1' ||
    value.bootId !== bootId ||
    value.roomId !== roomId ||
    !boundedString(value.bootId, 160) ||
    !boundedString(value.roomId, 160) ||
    !oneOf(value.availability, ['available', 'unavailable']) ||
    !oneOf(value.status, ['idle', 'pending', 'ready', 'unavailable', 'error'])
  ) {
    return null;
  }
  if (value.availability === 'unavailable') {
    const valid =
      oneOf(value.status, ['unavailable', 'error']) &&
      (value.weatherKey === null || (typeof value.weatherKey === 'string' && WEATHER_KEY.test(value.weatherKey))) &&
      (value.source === null || boundedString(value.source, 120)) &&
      (value.sourceRetrievedAt === null || isFiniteNumber(value.sourceRetrievedAt)) &&
      (value.validUntil === null || isFiniteNumber(value.validUntil));
    return valid ? ({...value} as unknown as WeatherAdviceCapability) : null;
  }
  const retrieved = parseTime(weather?.retrievedAt);
  if (
    !weather ||
    weather.stale ||
    (Object.hasOwn(weather, 'displayUntil') &&
      (!isFiniteNumber(weather.displayUntil) || now >= weather.displayUntil)) ||
    !matches(WEATHER_KEY, value.weatherKey || '') ||
    value.source !== weather.source ||
    !isFiniteNumber(value.sourceRetrievedAt) ||
    Math.abs(value.sourceRetrievedAt * 1000 - retrieved) >= 1 ||
    !Number.isFinite(now) ||
    retrieved > now ||
    !(now < weatherFreshUntil(weather)) ||
    !isFiniteNumber(value.validUntil) ||
    value.validUntil * 1000 <= now ||
    Math.floor(value.validUntil * 1000) > retrieved + 900000
  ) {
    return null;
  }
  return {...value} as unknown as WeatherAdviceCapability;
}

const PASSIVE_KEYS = [
  'schema', 'bootId', 'roomId', 'weatherKey', 'requestId', 'source', 'sourceRetrievedAt', 'validUntil', 'status',
  'summaryKind', 'summary', 'evidenceFactIds',
];

export interface WeatherPassiveContext {
  bootId?: unknown;
  roomId?: unknown;
  weatherKey?: unknown;
}

export function weatherPassiveAdvice(
  value: unknown,
  weather: unknown,
  now: number = Date.now(),
  context: WeatherPassiveContext | null = null,
  {allowUnadmitted = false}: {allowUnadmitted?: boolean} = {},
): WeatherPassiveAdvice | null {
  const w = optional(weather);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, PASSIVE_KEYS) ||
    value.schema !== 'podview.passive-weather-advice.v1' ||
    value.summaryKind !== 'ai_advice' ||
    !oneOf(value.status, ['pending', 'ready', 'unavailable', 'error']) ||
    !boundedString(value.bootId, 160) ||
    !boundedString(value.roomId, 160) ||
    !matches(WEATHER_KEY, value.weatherKey || '') ||
    !(
      (typeof value.requestId === 'string' && /^[a-f0-9]{32}$/.test(value.requestId)) ||
      (allowUnadmitted && value.status === 'unavailable' && value.requestId === null)
    ) ||
    value.source !== w?.source ||
    !Number.isFinite(parseTime(w?.retrievedAt)) ||
    !isFiniteNumber(value.sourceRetrievedAt) ||
    Math.abs(value.sourceRetrievedAt * 1000 - parseTime(w?.retrievedAt)) >= 1 ||
    !Number.isFinite(now) ||
    !isFiniteNumber(value.validUntil)
  ) {
    return null;
  }
  const retrieved = value.sourceRetrievedAt * 1000;
  if (
    !Number.isFinite(retrieved) ||
    retrieved > now ||
    value.validUntil * 1000 <= now ||
    Math.floor(value.validUntil * 1000) > Math.floor(retrieved) + 900000 ||
    (context && (['bootId', 'roomId', 'weatherKey'] as const).some(key => value[key] !== context[key]))
  ) {
    return null;
  }
  if (value.status === 'ready') {
    if (
      typeof value.summary !== 'string' ||
      !value.summary.trim() ||
      value.summary.length > 120 ||
      /[\p{C}<>]|https?:\/\//u.test(value.summary) ||
      !validFactIds(value.evidenceFactIds)
    ) {
      return null;
    }
  } else if (value.summary !== null || !Array.isArray(value.evidenceFactIds) || value.evidenceFactIds.length) {
    return null;
  }
  return {...value, evidenceFactIds: [...(value.evidenceFactIds as string[])]} as unknown as WeatherPassiveAdvice;
}

// ---- Wind ----------------------------------------------------------------------------------------

// DMI Beaufort lower bounds in m/s. Classify raw SI, never a rounded display speed.
const windLevels = [
  [0, 'Stille'],
  [0.3, 'Næsten stille'],
  [1.6, 'Svag vind'],
  [3.4, 'Let vind'],
  [5.5, 'Jævn vind'],
  [8, 'Frisk vind'],
  [10.8, 'Hård vind'],
  [13.9, 'Stiv kuling'],
  [17.2, 'Hård kuling'],
  [20.8, 'Stormende kuling'],
  [24.5, 'Storm'],
  [28.5, 'Stærk storm'],
] as const;
const WIND_FACTORS: Record<string, number> = {'m/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, kn: 1852 / 3600};

export function windStrength(speed: unknown, unit: unknown): string {
  if (!isFiniteNumber(speed) || speed < 0 || typeof unit !== 'string' || !Object.hasOwn(WIND_FACTORS, unit)) return '';
  const si = speed * (WIND_FACTORS[unit] ?? NaN);
  if (!Number.isFinite(si)) return '';
  if (si > 32.6) return 'Orkan';
  let label: string = windLevels[0][1];
  for (const [minimum, name] of windLevels) {
    if (si < minimum) break;
    label = name;
  }
  return label;
}

const WIND_DIRECTIONS = ['nord', 'nordøst', 'øst', 'sydøst', 'syd', 'sydvest', 'vest', 'nordvest'];

export function windFrom(bearing: unknown): {degrees: number; label: string} | null {
  if (!isFiniteNumber(bearing) || bearing < 0 || bearing > 360) return null;
  const degrees = bearing === 360 ? 0 : bearing;
  return {degrees, label: `Vind fra ${WIND_DIRECTIONS[Math.floor((degrees + 22.5) / 45) % 8] ?? ''}`};
}
