// What the weather screen is drawn from, as the shell's home read leaves it in the query cache (ingestWeather).
// Live: the admitted observation and its read facts; the screen composes them with the snapshot and the connection.
// Preview: the local stage's ready-made model (no server, nothing observed).
import type {WeatherObservation} from './observation.ts';
import type {WeatherDetailModel} from './model.ts';

export type WeatherReadStatus = 'ready' | 'error' | 'empty' | 'denied';

export type WeatherSource =
  | {kind: 'preview'; model: WeatherDetailModel}
  | {
      kind: 'live';
      // The current admitted observation (home-model.js), or null when there is none.
      weather: WeatherObservation | null;
      // The outcome of the last home read, and the [bootId, roomId] (JSON) it was for.
      readStatus: WeatherReadStatus | null;
      readScope: string | null;
      // [bootId, roomId] the observation belongs to (JSON), or null.
      scope: string | null;
      // The server's passive-advice capability for this observation (podview.weather-advice-capability.v1).
      adviceCapability: unknown;
    };
