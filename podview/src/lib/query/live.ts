// Server data in the query cache. Writers: the SSE snapshot stream (ingestSnapshot, called by the transport's
// onSnapshot), the connection owner (ingestConnection) and the shell's home read (ingestWeather). Readers: the
// hooks below. Data is never fetched by a component: it is pushed, and a component renders the last known value
// at once. Writing equal data keeps the same object (structural sharing), so nothing re-renders for a heartbeat.
import {skipToken, useQuery} from '@tanstack/react-query';
import {snapshotSchema} from '../api/schemas';
import type {Snapshot} from '../api/schemas';
import type {WeatherSource} from '../../screens/weather/source';
import {touchClock} from '../hooks/clock';
import {queryClient} from './client';

export const queryKeys = {
  snapshot: ['podvoice', 'snapshot'] as const,
  connection: ['podvoice', 'connection'] as const,
  weather: ['podvoice', 'weather'] as const,
  weatherAdvice: (bootId: string, roomId: string, weatherKey: string) =>
    ['podvoice', 'weather-advice', bootId, roomId, weatherKey] as const,
};

// The connection as the screens need it (podvoice-transport.js + connection-model.js own it).
export interface Connection {
  // 'demo' is the local preview: no transport, the scene's own `connected` flag decides.
  mode: 'live' | 'demo';
  status: string;
  // The transport holds an admitted, fresh snapshot.
  connected: boolean;
  blocked: boolean;
  sessionExpired: boolean;
  browserOffline: boolean;
  // When the current snapshot was read (ms epoch), for display anchors that must stop on an old read.
  acceptedReadAt: number | null;
}

export const DEMO_CONNECTION: Connection = {
  mode: 'demo',
  status: 'connected',
  connected: true,
  blocked: false,
  sessionExpired: false,
  browserOffline: false,
  acceptedReadAt: null,
};

export function ingestSnapshot(value: unknown, client = queryClient): Snapshot | null {
  const parsed = snapshotSchema.safeParse(value);
  // The transport admitted it; a payload the screens cannot read shows nothing rather than a guess.
  const snapshot = parsed.success ? parsed.data : null;
  touchClock();
  client.setQueryData(queryKeys.snapshot, snapshot);
  return snapshot;
}

export function ingestConnection(connection: Connection, client = queryClient) {
  touchClock();
  client.setQueryData(queryKeys.connection, connection);
}

export function ingestWeather(source: WeatherSource, client = queryClient) {
  touchClock();
  client.setQueryData(queryKeys.weather, source);
}

export const readSnapshot = (client = queryClient) => client.getQueryData<Snapshot | null>(queryKeys.snapshot) ?? null;
export const readConnection = (client = queryClient) =>
  client.getQueryData<Connection>(queryKeys.connection) ?? DEMO_CONNECTION;

// A pushed value: no query function, the cache entry is the value.
function usePushed<T, S>(key: readonly unknown[], fallback: T, select: (value: T) => S): S {
  const {data} = useQuery<T, Error, S>({queryKey: key, queryFn: skipToken, select});
  return data ?? select(fallback);
}

const same = <T,>(value: T) => value;

export function useSnapshot(): Snapshot | null;
export function useSnapshot<S>(select: (snapshot: Snapshot | null) => S): S;
export function useSnapshot<S>(select?: (snapshot: Snapshot | null) => S) {
  return usePushed<Snapshot | null, S | Snapshot | null>(queryKeys.snapshot, null, select ?? same);
}

export function useConnection(): Connection;
export function useConnection<S>(select: (connection: Connection) => S): S;
export function useConnection<S>(select?: (connection: Connection) => S) {
  return usePushed<Connection, S | Connection>(queryKeys.connection, DEMO_CONNECTION, select ?? same);
}

export const useWeatherSource = () => usePushed<WeatherSource | null, WeatherSource | null>(
  queryKeys.weather,
  null,
  same,
);
