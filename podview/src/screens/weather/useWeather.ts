// The weather screen's data: the cached weather source, the snapshot and the connection, composed into the
// detail model (view-model.ts) at the current time, with the passive AI advice of the binding on screen
// (advice-store.ts: one paid request per binding, never replayed).
import {useEffect} from 'react';
import {homeConnectionPresentation} from '../../lib/api/connection';
import type {Snapshot} from '../../lib/api/schemas';
import {useDocumentVisible, useNow, useRefreshAt} from '../../lib/hooks/clock';
import {useConnection, useSnapshot, useWeatherSource} from '../../lib/query/live';
import type {Connection} from '../../lib/query/live';
import {useShell} from '../../lib/store/shell';
import type {WeatherDetailModel} from './model.ts';
import {adviceProjection, invalidateAdvice, reconcileAdvice, useWeatherAdvice} from './advice-store.ts';
import type {AdviceContext, PassiveAdvice} from './advice-store.ts';
import {weatherAdviceCapability, weatherAiAdvice} from './observation.ts';
import type {WeatherSource} from './source.ts';
import {liveWeatherModel} from './view-model.ts';

const AI_OWNER = ['sessionId', 'turnId', 'taskId', 'inputRevision', 'providerGeneration'] as const;

type LiveSource = Extract<WeatherSource, {kind: 'live'}>;
// The weather page does not depend on when the last heartbeat arrived; leaving it out spares a render per second.
export type Link = Omit<Connection, 'acceptedReadAt'>;
const link = ({mode, status, connected, blocked, sessionExpired, browserOffline}: Connection): Link => ({
  mode,
  status,
  connected,
  blocked,
  sessionExpired,
  browserOffline,
});

// The binding the advice belongs to, or null when this page may not ask for one now.
export function adviceContext(
  source: WeatherSource | null,
  snapshot: Snapshot | null,
  connection: Link,
  focused: boolean,
  visible: boolean,
  now: number,
): AdviceContext | null {
  if (source?.kind !== 'live' || !focused || !visible || !snapshot) return null;
  if (!connection.connected || connection.blocked || !snapshot.capabilities.homeRead?.includes('weather')) return null;
  if (source.scope !== JSON.stringify([snapshot.bootId, snapshot.roomId]) || !source.weather) return null;
  const weather = source.weather;
  const cap = weatherAdviceCapability(source.adviceCapability, weather, snapshot, now);
  if (!cap) return null;
  const voice = weatherAiAdvice(weather.aiAdvice, weather, now);
  const answers = snapshot.answers as Record<string, unknown> | undefined;
  const owner = voice as unknown as Record<string, unknown> | null;
  const voiceCurrent = !!owner && owner.roomId === snapshot.roomId && AI_OWNER.every(key => owner[key] === answers?.[key]);
  const advisory = new Set(['aiAdvice', 'passiveAdvice', 'displayLocation', 'advice']);
  const facts = Object.fromEntries(Object.entries(weather).filter(([key]) => !advisory.has(key)));
  return {
    cap,
    key: JSON.stringify([cap.bootId, cap.roomId, cap.weatherKey]),
    source: JSON.stringify(facts),
    weather,
    voiceCurrent,
  };
}

function usePassiveAdvice(source: WeatherSource | null, snapshot: Snapshot | null, connection: Link, now: number) {
  const focused = useShell(state => state.focus === 'weather');
  const visible = useDocumentVisible();
  const advice = useWeatherAdvice();
  const context = adviceContext(source, snapshot, connection, focused, visible, now);
  const projection = adviceProjection(context, now, advice);
  const status = projection?.status;
  useEffect(() => {
    reconcileAdvice(context);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the binding's identity, not the object
  }, [context?.key, context?.source, context?.cap, context?.voiceCurrent, status, now]);
  useEffect(() => invalidateAdvice, []);
  return projection;
}

function liveModel(source: LiveSource, snapshot: Snapshot | null, connection: Link, now: number,
  passive: PassiveAdvice | null): WeatherDetailModel {
  const reason = homeConnectionPresentation(connection).reason;
  const scope = snapshot ? JSON.stringify([snapshot.bootId, snapshot.roomId]) : null;
  const readStatus =
    source.readScope === scope && snapshot?.capabilities.homeRead?.includes('weather') ? source.readStatus : null;
  return liveWeatherModel(source.weather, {
    connected: connection.connected,
    reason,
    readStatus,
    now,
    passiveContext: passive?.context ?? null,
    passiveAdvice: passive?.advice,
    passiveStatus: passive?.status,
    aiContext: snapshot ? {...snapshot.answers, roomId: snapshot.roomId} : null,
  });
}

const EMPTY: WeatherDetailModel = {title: 'Vejr', subtitle: '', current: null, hours: [], days: [], source: ''};

// The detail model for the current source, at the current time.
export function useWeatherModel(): WeatherDetailModel {
  const source = useWeatherSource();
  const snapshot = useSnapshot();
  const connection = useConnection(link);
  const now = useNow();
  const passive = usePassiveAdvice(source, snapshot, connection, now);
  const model = !source
    ? EMPTY
    : source.kind === 'preview'
      ? source.model
      : liveModel(source, snapshot, connection, now, passive);
  useRefreshAt(source?.kind === 'live' ? (model.refreshAt ?? model.adviceUntil ?? null) : null);
  return model;
}
