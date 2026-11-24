// The HA transport: the panel's `hass` object → the TanStack Query cache, and typed commands → hass.
// - Entity states are written per entity (['ha', 'entity', id]) only when HA's object for that entity changed
//   identity, and then with structural sharing: an unrelated entity's change re-renders nothing.
// - The room catalogue (areas → lights, PodConnect players, weather) is rebuilt only when HA's registries change.
// - `resync` re-reads everything from the last `hass` and asks reads that are not pushed (forecasts, timers) again:
//   the wall iPad sleeps, and a page coming back must not show what it knew before it slept.
// - Commands are zod-validated before they reach hass.callService / hass.callWS; an answer is read, never resent.
import type {QueryClient} from '@tanstack/react-query';
import {useQueries, useQuery} from '@tanstack/react-query';
import {useEffect} from 'react';
import {z} from 'zod';
import {queryClient as appClient} from '../query/client';
import {buildCatalog, catalogKey, EMPTY_CATALOG} from './catalog';
import type {Catalog} from './catalog';
import type {Hass, HassEntityState, HassPanel} from './hass';
import {domainOf, readEntity} from './hass';

export const haKeys = {
  entity: (entityId: string) => ['ha', 'entity', entityId] as const,
  catalog: ['ha', 'catalog'] as const,
  link: ['ha', 'link'] as const,
  panel: ['ha', 'panel'] as const,
  // Reads HA does not push: forecasts and the PodVoice timer bridge.
  read: ['ha', 'read'] as const,
};

export interface Link {
  // HA's own websocket state; false while the frontend reconnects.
  connected: boolean;
  // Bumped on every resync, so reads that are not pushed know to read again.
  generation: number;
}

// Domains whose entities are written into the cache. Screens that read more (the robot's vacuum, the car's sensors)
// add their domains once at import (watchDomains); a new domain is written from the next `hass` on.
const WATCHED = new Set(['light', 'media_player', 'weather']);
export function watchDomains(...domains: string[]) {
  for (const domain of domains) WATCHED.add(domain);
}
// Single entities of a domain with many entities the panel does not show (a car's switch and select entities, the
// robot's settings): written once a screen reads them (useEntity/useEntities), not every switch and select in HA.
const WATCHED_IDS = new Set<string>();
const watched = (entityId: string) => WATCHED.has(domainOf(entityId)) || WATCHED_IDS.has(entityId);

export interface HaTransport {
  setHass: (hass: Hass) => void;
  setPanel: (panel: HassPanel | null) => void;
  resync: () => void;
  current: () => Hass | null;
  // HA's websocket is up now (false before the first `hass` and while the frontend reconnects).
  connected: () => boolean;
  // The entity as the cache has it now.
  read: (entityId: string) => HassEntityState | null;
  // Called after each ingested entity (the command store confirms wishes from here).
  onEntity: (listener: (entity: HassEntityState | null, entityId: string) => void) => () => void;
  // Writes these entities from now on (and at once from the last `hass`), whatever their domain.
  watch: (entityIds: readonly string[]) => void;
}

export function createHaTransport(client: QueryClient = appClient): HaTransport {
  let hass: Hass | null = null;
  let seen = new Map<string, unknown>();
  let registries: unknown[] = [];
  let generation = 0;
  const listeners = new Set<(entity: HassEntityState | null, entityId: string) => void>();

  const writeEntity = (entityId: string, raw: unknown) => {
    const entity = raw === undefined ? null : readEntity(raw);
    client.setQueryData(haKeys.entity(entityId), entity);
    // The cache's structurally shared copy is what everyone reads.
    const shared = client.getQueryData<HassEntityState | null>(haKeys.entity(entityId)) ?? null;
    for (const listener of listeners) listener(shared, entityId);
  };

  const ingest = (next: Hass, force: boolean) => {
    const states = next.states;
    const present = new Map<string, unknown>();
    for (const entityId in states) {
      if (!watched(entityId)) continue;
      const raw = states[entityId];
      present.set(entityId, raw);
      if (force || seen.get(entityId) !== raw) writeEntity(entityId, raw);
    }
    for (const entityId of seen.keys()) if (!present.has(entityId)) writeEntity(entityId, undefined);
    seen = present;
    const key = catalogKey(next);
    if (force || key.length !== registries.length || key.some((part, index) => part !== registries[index])) {
      registries = key;
      client.setQueryData<Catalog>(haKeys.catalog, buildCatalog(next));
    }
    writeLink(next.connected !== false);
  };
  // Only a real change reaches the cache: every `hass` HA hands over would otherwise notify every link reader.
  const writeLink = (connected: boolean) => {
    const old = client.getQueryData<Link>(haKeys.link);
    if (old?.connected === connected && old.generation === generation) return;
    client.setQueryData<Link>(haKeys.link, {connected, generation});
  };

  let wasConnected: boolean | null = null;
  return {
    setHass(next) {
      hass = next;
      const connected = next.connected !== false;
      const reconnected = wasConnected === false && connected;
      wasConnected = connected;
      // HA's websocket came back (false → true): everything is read again, as after the wall woke up. Reads and
      // subscriptions keyed by the generation start over; one that failed while HA restarted gets a new try.
      if (reconnected) generation += 1;
      ingest(next, reconnected);
    },
    setPanel(panel) {
      client.setQueryData(haKeys.panel, panel?.config ?? null);
    },
    resync() {
      generation += 1;
      if (hass) ingest(hass, true);
      else writeLink(false);
    },
    current: () => hass,
    connected: () => hass?.connected !== false && hass !== null,
    read: entityId => client.getQueryData<HassEntityState | null>(haKeys.entity(entityId)) ?? null,
    onEntity(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    watch(entityIds) {
      const added = entityIds.filter(entityId => !watched(entityId));
      for (const entityId of added) WATCHED_IDS.add(entityId);
      if (!hass || !added.length) return;
      for (const entityId of added) {
        const raw = hass.states[entityId];
        if (raw === undefined) continue;
        seen.set(entityId, raw);
        writeEntity(entityId, raw);
      }
    },
  };
}

// The one transport of the page (the panel element feeds it; tests make their own or feed this one).
export const transport = createHaTransport();

// ---- Reading ---------------------------------------------------------------------------------------------------

const neverFetch = () => Promise.reject(new Error('pushed by the HA transport'));
const NO_IDS: readonly string[] = [];

// Entities a component reads are written from then on (transport.watch); an entity of a watched domain already is.
function useWatch(entityIds: readonly string[]) {
  const key = entityIds.join('\u0000');
  useEffect(() => {
    if (key) transport.watch(key.split('\u0000'));
  }, [key]);
}

export function useEntity(entityId: string | null | undefined): HassEntityState | null {
  useWatch(entityId ? [entityId] : NO_IDS);
  const {data} = useQuery({
    queryKey: haKeys.entity(entityId ?? ''),
    queryFn: neverFetch,
    enabled: false,
  });
  return entityId ? ((data as HassEntityState | null | undefined) ?? null) : null;
}

export function useCatalog(): Catalog {
  const {data} = useQuery({queryKey: haKeys.catalog, queryFn: neverFetch, enabled: false});
  return (data as Catalog | undefined) ?? EMPTY_CATALOG;
}

export function useLink(): Link {
  const {data} = useQuery({queryKey: haKeys.link, queryFn: neverFetch, enabled: false});
  return (data as Link | undefined) ?? {connected: false, generation: 0};
}

export function usePanelConfig(): Record<string, unknown> | null {
  const {data} = useQuery({queryKey: haKeys.panel, queryFn: neverFetch, enabled: false});
  return (data as Record<string, unknown> | null | undefined) ?? null;
}

// ---- Commands --------------------------------------------------------------------------------------------------

// What a failed call means. HA's own refusals (a service that does not exist, invalid data, no permission) are a
// clear »no«. A call the websocket library never sent (it throws its bare numeric ERR_CONNECTION_LOST = 3 while the
// socket is down, and rejects queued messages with it) is »not sent«. Anything else (the socket dropped with the call
// in flight, which the library reports as {code: 3, message: 'Connection lost'}, or a timeout) leaves it unknown.
export type FailedOutcome = 'rejected' | 'unknown' | 'not_sent';
export type CallOutcome = {ok: true; response: unknown} | {ok: false; outcome: FailedOutcome; reason: string};

const REFUSALS = new Set(['not_found', 'invalid_format', 'unauthorized', 'service_validation_error', 'not_allowed']);

// home-assistant-js-websocket's ERR_CANNOT_CONNECT and ERR_CONNECTION_LOST, thrown as bare numbers before sending.
const NOT_SENT_CODES = new Set([1, 3]);

export function readFailure(error: unknown): {outcome: FailedOutcome; reason: string} {
  if (typeof error === 'number' && NOT_SENT_CODES.has(error)) return {outcome: 'not_sent', reason: 'not_connected'};
  const code = (error as {code?: unknown} | null)?.code;
  const message = (error as {message?: unknown} | null)?.message;
  const reason = typeof message === 'string' ? message.slice(0, 160) : '';
  return typeof code === 'string' && REFUSALS.has(code) ? {outcome: 'rejected', reason} : {outcome: 'unknown', reason};
}

// Service data: JSON values only (PodVoice's services take nested arguments, e.g. a car action's args). PodConnect is
// never called from the page: the integration exposes the few typed PodConnect calls the screens need.
type Json = string | number | boolean | null | Json[] | {[key: string]: Json};
const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string().max(4096), z.number(), z.boolean(), z.null(), z.array(jsonValue).max(256),
    z.record(z.string().max(128), jsonValue)]),
);

export const serviceCallSchema = z.object({
  domain: z.enum(['light', 'media_player', 'weather', 'podvoice']),
  service: z.string().regex(/^[a-z0-9_]{1,64}$/),
  data: z.record(z.string(), jsonValue).default({}),
  entityId: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/).optional(),
  returnResponse: z.boolean().default(false),
});
export type ServiceCall = z.input<typeof serviceCallSchema>;

// One call, sent exactly once. Never throws: the answer is read into an outcome.
export async function callService(call: ServiceCall, source: HaTransport = transport): Promise<CallOutcome> {
  const hass = source.current();
  const parsed = serviceCallSchema.safeParse(call);
  if (!parsed.success) return {ok: false, outcome: 'rejected', reason: 'invalid_command'};
  // Without a live link the call is never handed to HA: the tap says so instead of an unknown outcome.
  if (!hass || !source.connected()) return {ok: false, outcome: 'not_sent', reason: 'not_connected'};
  const {domain, service, data, entityId, returnResponse} = parsed.data;
  try {
    const response = await hass.callService(
      domain,
      service,
      data,
      entityId ? {entity_id: entityId} : undefined,
      false,
      returnResponse,
    );
    return {ok: true, response};
  } catch (error) {
    return {ok: false, ...readFailure(error)};
  }
}

// A service's response (return_response) for a target entity, validated with the caller's schema.
export async function serviceResponse<T>(
  call: ServiceCall & {returnResponse: true},
  schema: z.ZodType<T>,
  source: HaTransport = transport,
): Promise<{ok: true; value: T} | {ok: false; outcome: FailedOutcome; reason: string}> {
  const result = await callService(call, source);
  if (!result.ok) return result;
  const response = (result.response as {response?: unknown} | null)?.response;
  const parsed = schema.safeParse(response);
  return parsed.success ? {ok: true, value: parsed.data} : {ok: false, outcome: 'unknown', reason: 'unreadable'};
}

// Several entities at once (a room's players or lights); each still re-renders only when its own data changes.
export function useEntities(entityIds: readonly string[]): (HassEntityState | null)[] {
  useWatch(entityIds);
  return useQueries({
    queries: entityIds.map(entityId => ({
      queryKey: haKeys.entity(entityId),
      queryFn: neverFetch,
      enabled: false,
    })),
    combine: results => results.map(result => (result.data as HassEntityState | null | undefined) ?? null),
  });
}

// One websocket command (callWS), validated with the caller's schema. Never throws.
export async function callWs<T>(
  message: Record<string, unknown>,
  schema: z.ZodType<T>,
  source: HaTransport = transport,
): Promise<{ok: true; value: T} | {ok: false; outcome: FailedOutcome; reason: string}> {
  const hass = source.current();
  if (!hass || !source.connected()) return {ok: false, outcome: 'not_sent', reason: 'not_connected'};
  try {
    const parsed = schema.safeParse(await hass.callWS(message));
    return parsed.success ? {ok: true, value: parsed.data} : {ok: false, outcome: 'unknown', reason: 'unreadable'};
  } catch (error) {
    return {ok: false, ...readFailure(error)};
  }
}

// A websocket subscription HA pushes on (hass.connection.subscribeMessage; the library resubscribes by itself after
// a reconnect). Returns the stop function at once. A subscription that could not start (no connection yet, or HA
// refused it: the integration's bridge is not ready) is tried again with backoff (1 s doubling to 60 s) until it
// starts or is stopped; onError hears the first failure only, so a fallback read runs once, not on every retry.
// A command HA does not know is reported and not retried.
export const SUBSCRIBE_RETRY_MS = {first: 1000, max: 60_000};

export function subscribeHa(
  message: Record<string, unknown>,
  onMessage: (message: unknown) => void,
  onError: (reason: string) => void = () => undefined,
  source: HaTransport = transport,
): () => void {
  let stopped = false;
  let stop: (() => unknown) | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let delay = SUBSCRIBE_RETRY_MS.first;
  let reported = false;
  const failed = (reason: string) => {
    if (stopped) return;
    if (!reported) {
      reported = true;
      onError(reason);
    }
    retry = setTimeout(attempt, delay);
    delay = Math.min(SUBSCRIBE_RETRY_MS.max, delay * 2);
  };
  function attempt() {
    retry = null;
    if (stopped) return;
    const connection = source.current()?.connection;
    if (!connection?.subscribeMessage || !source.connected()) {
      failed('no_connection');
      return;
    }
    connection.subscribeMessage(pushed => {
      if (!stopped) onMessage(pushed);
    }, message).then(
      unsubscribe => {
        if (stopped) void Promise.resolve(unsubscribe()).catch(() => undefined);
        else stop = unsubscribe;
      },
      (error: unknown) => {
        // A command this HA does not know (an older integration) is not retried; the next generation tries again.
        const unknown = (error as {code?: unknown} | null)?.code === 'unknown_command';
        if (unknown && !stopped) onError('unknown_command');
        else failed(readFailure(error).reason || 'subscribe_failed');
      },
    );
  }
  attempt();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (stop) void Promise.resolve(stop()).catch(() => undefined);
  };
}
