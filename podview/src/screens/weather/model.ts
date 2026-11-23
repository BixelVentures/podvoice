// The weather detail's view model, as produced by liveWeatherModel / localWeatherModel in
// ./view-model.ts. That projection and the observation model it reads (./observation.ts) are
// erasable TypeScript only, so the server's tests can run them in plain Node with type stripping.
// This type is the contract the React screen renders.

export type WeatherTone = 'neutral' | 'clear' | 'partlycloudy' | 'cloudy' | 'rain' | 'snow' | 'fog' | 'wind' | 'storm';
export type WeatherPhase = 'day' | 'night' | 'unknown';

export interface WeatherAppearance {
  tone: WeatherTone;
  phase: WeatherPhase;
  photo: boolean;
}

export interface WeatherCurrent {
  temperature: string;
  condition: string;
  icon: string | null;
  range: string;
}

export interface WeatherMetadataRow {
  id: string;
  label: string;
  value: string;
}

export interface WeatherHour {
  id: string;
  time: string;
  temperature: string;
  // The hour's temperature in °C and rain in mm, as numbers, or null when unknown.
  temperatureNumber: number | null;
  rainNumber: number | null;
  condition: string;
  icon: string | null;
  rain: string;
  wind: string;
  windSpeed: string;
  windBearing: number | null;
}

export interface WeatherDay {
  id: string;
  day: string;
  condition: string;
  icon: string | null;
  low: string;
  high: string;
  start: number | null;
  length: number | null;
}

export type WeatherAdviceState = 'idle' | 'pending' | 'ready' | 'error' | 'unavailable' | null;

// Only the connection owner can name a cause for missing weather.
export type WeatherConnectionReason = 'setup' | 'unavailable' | 'denied';

export interface WeatherDetailModel {
  title: string;
  subtitle: string;
  appearance?: WeatherAppearance;
  current: WeatherCurrent | null;
  emptyTitle?: string;
  emptyDetail?: string;
  emptyIcon?: string | null;
  // The short status the overview card shows when there is no weather at all.
  overviewStatus?: string;
  connectionReason?: WeatherConnectionReason | null;
  sourceStale?: boolean;
  // The retrieval is outside its freshness window, whatever the connection says.
  timeStale?: boolean;
  updated?: string;
  metadata?: WeatherMetadataRow[];
  summary?: string;
  summaryKind?: string;
  summaryState?: WeatherAdviceState;
  summaryLabel?: string;
  conditionAdvice?: string;
  // Epoch ms when the shown advice expires, and when the model next needs recomputing.
  adviceUntil?: number | null;
  refreshAt?: number | null;
  hoursLabel?: string;
  hours: WeatherHour[];
  days: WeatherDay[];
  source: string;
}

export function hasWeatherFacts(model: WeatherDetailModel): boolean {
  return !!model.current || model.hours.length > 0 || model.days.length > 0;
}
