// Vejr: the weather page. It reads everything from the query cache (useWeatherModel); the shell mounts it once
// into #weather-view (mountWeather) and from then on only writes data into the cache.
import {mountScreen} from '../../app/mount';
import {useWeatherModel} from './useWeather';
import {WeatherDetail} from './WeatherDetail';

export function WeatherScreen() {
  return <WeatherDetail model={useWeatherModel()} />;
}

export function mountWeather(container: Element) {
  return mountScreen(container, <WeatherScreen />);
}
