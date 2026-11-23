// The HA transport: the panel's `hass` object → the TanStack Query cache, and typed commands → hass.
// - Entity states are written per entity (['ha', 'entity', id]) only when HA's object for that entity changed
//   identity, and then with structural sharing: an unrelated entity's change re-renders nothing.
// - The room catalogue (areas → lights, PodConnect players, weather) is rebuilt only when HA's registries change.
// - `resync` re-reads everything from the last `hass` and asks reads that are not pushed (forecasts, timers) again:
//   the wall iPad sleeps, and a page coming back must not show what it knew before it slept.
// - Commands are zod-validated before they reach hass.callService / hass.callWS; an answer is read, never resent.
import type {QueryClient} from '@tanstack/react-query';
import {useQueries, useQuery} from '@tanstack/react-query';
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

export interface HaTransport {
  setHass: (hass: Hass) => void;
  setPanel: (panel: HassPanel | null) => void;
  resync: () => void;
  current: () => Hass | null;
  // The entity as the cache has it now.
  read: (entityId: string) => HassEntityState | null;
  // Called after each ingested entity (the command store confirms wishes from here).
  onEntity: (listener: (entity: HassEntityState | null, entityId: string) => void) => () => void;
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
      if (!WATCHED.has(domainOf(entityId))) continue;
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
    client.setQueryData<Link>(haKeys.link, {connected: next.connected !== false, generation});
  };

  return {
    setHass(next) {
      hass = next;
      ingest(next, false);
    },
    setPanel(panel) {
      client.setQueryData(haKeys.panel, panel?.config ?? null);
    },
    resync() {
      generation += 1;
      if (hass) ingest(hass, true);
      else client.setQueryData<Link>(haKeys.link, {connected: false, generation});
    },
    current: () => hass,
    read: entityId => client.getQueryData<HassEntityState | null>(haKeys.entity(entityId)) ?? null,
    onEntity(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// The one transport of the page (the panel element feeds it; tests make their own or feed this one).
export const transport = createHaTransport();

// ---- Reading ---------------------------------------------------------------------------------------------------

const neverFetch = () => Promise.reject(new Error('pushed by the HA transport'));

export function useEntity(entityId: string | null | undefined): HassEntityState | null {
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
// clear »no«; anything else (the websocket dropped, a timeout) leaves the outcome unknown.
export type CallOutcome = {ok: true; response: unknown} | {ok: false; outcome: 'rejected' | 'unknown'; reason: string};

const REFUSALS = new Set(['not_found', 'invalid_format', 'unauthorized', 'service_validation_error', 'not_allowed']);

export function readFailure(error: unknown): {outcome: 'rejected' | 'unknown'; reason: string} {
  const code = (error as {code?: unknown} | null)?.code;
  const message = (error as {message?: unknown} | null)?.message;
  const reason = typeof message === 'string' ? message.slice(0, 160) : '';
  return typeof code === 'string' && REFUSALS.has(code) ? {outcome: 'rejected', reason} : {outcome: 'unknown', reason};
}

// Service data: JSON values only (PodConnect's and PodVoice's services take nested bindings and leases).
type Json = string | number | boolean | null | Json[] | {[key: string]: Json};
const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string().max(4096), z.number(), z.boolean(), z.null(), z.array(jsonValue).max(256),
    z.record(z.string().max(128), jsonValue)]),
);

export const serviceCallSchema = z.object({
  domain: z.enum(['light', 'media_player', 'weather', 'podvoice', 'podconnect']),
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
  if (!hass) return {ok: false, outcome: 'rejected', reason: 'not_connected'};
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
): Promise<{ok: true; value: T} | {ok: false; outcome: 'rejected' | 'unknown'; reason: string}> {
  const result = await callService(call, source);
  if (!result.ok) return result;
  const response = (result.response as {response?: unknown} | null)?.response;
  const parsed = schema.safeParse(response);
  return parsed.success ? {ok: true, value: parsed.data} : {ok: false, outcome: 'unknown', reason: 'unreadable'};
}

// Several entities at once (a room's players or lights); each still re-renders only when its own data changes.
export function useEntities(entityIds: readonly string[]): (HassEntityState | null)[] {
  return useQueries({
    queries: entityIds.map(entityId => ({
      queryKey: haKeys.entity(entityId),
      queryFn: neverFetch,
      enabled: false,
    })),
    combine: results => results.map(result => (result.data as HassEntityState | null | undefined) ?? null),
  });
}
