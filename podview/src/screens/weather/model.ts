// The weather detail's view model, as produced by liveWeatherModel / localWeatherModel in
// podview/weather-view.js. The projection stays in plain JS (the server's tests import it in
// Node); this type is the contract the React screen renders.

export interface WeatherAppearance {
  tone: string;
  phase: string;
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

export interface WeatherDetailModel {
  title: string;
  subtitle: string;
  appearance?: WeatherAppearance;
  current: WeatherCurrent | null;
  emptyTitle?: string;
  emptyDetail?: string;
  emptyIcon?: string | null;
  connectionReason?: string | null;
  sourceStale?: boolean;
  updated?: string;
  metadata?: WeatherMetadataRow[];
  summary?: string;
  summaryKind?: string;
  summaryState?: WeatherAdviceState;
  summaryLabel?: string;
  conditionAdvice?: string;
  hoursLabel?: string;
  hours: WeatherHour[];
  days: WeatherDay[];
  source: string;
}

export function hasWeatherFacts(model: WeatherDetailModel): boolean {
  return !!model.current || model.hours.length > 0 || model.days.length > 0;
}
