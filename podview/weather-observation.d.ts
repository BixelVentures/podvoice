// Types for the pre-React weather observation helpers used by src/screens/weather.
import type {WeatherAppearance} from './src/screens/weather/model';

export function weatherAppearance(current: unknown, options?: {fresh?: boolean}): WeatherAppearance;
export function windFrom(bearing: number | null): {degrees: number; label: string} | null;
