// Types for the pre-React weather projection used by src/screens/weather.
import type {WeatherDetailModel} from './src/screens/weather/model';

export function localWeatherModel(weather?: unknown): WeatherDetailModel;
export function renderLocalWeatherSurfaces(doc: Document, model?: WeatherDetailModel): void;
