// Timers from the PodVoice integration's HA timer bridge (custom_components/podvoice/timer_bridge.py), pushed:
// the panel subscribes with the websocket command podvoice/timer_subscribe and HA sends the endpoint's whole
// snapshot after every change (a native timer event or a command). podvoice/timer_read reads it once (on open, after
// a resync and after each command's answer). Nothing polls: a service call is a recorded event on HA's slow eMMC, a
// websocket command is not. podvoice.timer_command_v2 acts on the timers. The bridge owns the countdown; the page only
// counts down from the last snapshot between pushes.
import {useQuery, useQueryClient} from '@tanstack/react-query';
import type {QueryClient} from '@tanstack/react-query';
import {useEffect} from 'react';
import {z} from 'zod';
import type {Timer} from '../../screens/timer/model';
import type {CommandStore} from './commands';
import {commands as appCommands} from './commands';
import {callWs, haKeys, serviceResponse, subscribeHa, transport as appTransport} from './transport';
import type {HaTransport} from './transport';

export const endpointSchema = z.object({
  endpoint: z.string().min(1).max(80),
  name: z.string().max(120),
  device_id: z.string().max(128),
});
export type TimerEndpoint = z.infer<typeof endpointSchema>;

export function panelEndpoints(config: Record<string, unknown> | null): TimerEndpoint[] {
  const parsed = z.array(endpointSchema).max(32).safeParse(config?.endpoints);
  return parsed.success ? parsed.data : [];
}

const REVISION = /^(0|[1-9][0-9]{0,23})$/;
const timerRow = z.looseObject({
  id: z.string().min(1).max(200),
  name: z.string().max(120).default(''),
  seconds_left: z.number().int().min(0).max(86400),
  state: z.enum(['active', 'paused', 'finished']),
  duration_seconds: z.number().int().min(1).max(86400).optional(),
  revision: z.string().regex(REVISION).optional(),
});
const finishedRow = z.looseObject({
  id: z.string().min(1).max(200),
  name: z.string().max(120).default(''),
  alert_state: z.string().max(40).optional(),
  physical_stopped: z.boolean().optional(),
  physical_drained: z.boolean().optional(),
});
export const timerStatusSchema = z.union([
  z.looseObject({
    ok: z.literal(true),
    epoch: z.string().min(1).max(64),
    endpoint: z.string(),
    timers: z.array(timerRow).max(64),
    finished: z.array(finishedRow).max(64),
    recent: z
      .array(z.looseObject({id: z.string(), name: z.string(), seconds: z.number().int().min(1).max(86400)}))
      .max(12)
      .default([]),
  }),
  z.looseObject({ok: z.literal(false), error: z.string().max(80)}),
]);
export type TimerStatus = z.infer<typeof timerStatusSchema>;

export interface TimerRead {
  status: TimerStatus;
  // performance.now() when the read arrived: the local countdown runs from here.
  readAt: number;
}

export const timerKey = (endpoint: string) => [...haKeys.read, 'timers', endpoint] as const;

const readOf = (status: TimerStatus): TimerRead => ({status, readAt: globalThis.performance.now()});

export async function readTimers(endpoint: string, source: HaTransport = appTransport): Promise<TimerRead> {
  const result = await callWs({type: 'podvoice/timer_read', endpoint}, timerStatusSchema, source);
  if (!result.ok) throw new Error(result.reason || result.outcome);
  return readOf(result.value);
}

// One subscription per endpoint and link generation, however many parts of the page read it (Hjem's tile, Timer).
const live = new Map<string, {count: number; stop: () => void}>();

export function subscribeTimers(
  client: QueryClient,
  endpoint: string,
  generation: number,
  source: HaTransport = appTransport,
): () => void {
  const id = `${endpoint}\u0000${String(generation)}`;
  const held = live.get(id);
  if (held) held.count += 1;
  else {
    const stop = subscribeHa({type: 'podvoice/timer_subscribe', endpoint}, message => {
      const parsed = timerStatusSchema.safeParse(message);
      if (parsed.success) client.setQueryData<TimerRead>(timerKey(endpoint), readOf(parsed.data));
    }, () => undefined, source);
    live.set(id, {count: 1, stop});
  }
  return () => {
    const entry = live.get(id);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    live.delete(id);
    entry.stop();
  };
}

export function useTimerStatus(endpoint: string | null, generation: number) {
  const client = useQueryClient();
  useEffect(() => {
    if (!endpoint) return;
    return subscribeTimers(client, endpoint, generation);
  }, [client, endpoint, generation]);
  const query = useQuery({
    queryKey: timerKey(endpoint ?? ''),
    enabled: !!endpoint,
    // Pushed: the cache is current while subscribed. A resync reads once more (generation below).
    staleTime: Infinity,
    gcTime: 60_000,
    queryFn: () => readTimers(endpoint ?? ''),
  });
  const {refetch} = query;
  useEffect(() => {
    if (endpoint && generation > 0) void refetch();
  }, [endpoint, generation, refetch]);
  return query;
}

// The bridge's timers as PodView's timer records (screens/timer/model.ts): the screen's cards draw these unchanged.
export function bridgeTimers(read: TimerRead | undefined, now = globalThis.performance.now()): Timer[] {
  const status = read?.status;
  if (!read || !status?.ok) return [];
  const elapsed = Math.max(0, Math.floor((now - read.readAt) / 1000));
  const running = status.timers.map(row => ({
    id: row.id,
    name: row.name || 'Timer',
    status: row.state === 'active' ? 'running' : row.state === 'paused' ? 'paused' : 'done',
    remaining: row.state === 'active' ? Math.max(0, row.seconds_left - elapsed) : row.seconds_left,
    duration: row.duration_seconds ?? null,
    sourceRevision: row.revision,
    deadline: null,
    ownerBootId: status.epoch,
  }));
  const finished = status.finished.map(row => ({
    id: row.id,
    name: row.name || 'Timer',
    status: 'done',
    remaining: 0,
    duration: null,
    deadline: null,
    ownerBootId: status.epoch,
    alertState: row.alert_state ?? null,
    physicalStopped: row.physical_stopped ?? null,
    physicalDrained: row.physical_drained ?? null,
  }));
  return [...running, ...finished];
}

const commandReply = z.looseObject({ok: z.boolean(), error: z.string().optional(), outcome: z.string().optional()});

export type TimerAction =
  | {action: 'start'; seconds: number; name: string}
  | {action: 'cancel' | 'acknowledge_finished'; timerId: string}
  | {action: 'adjust'; timerId: string; deltaSeconds: number; expectedRevision: string};

// One wish per timer (cancel, adjust, acknowledge) and one for starting a new one, so a tap on one card never
// replaces or shows on another.
export const timerWishKey = (endpoint: string, target: string) => `timer:${endpoint}:${target}`;
export const timerWishPrefix = (endpoint: string) => `timer:${endpoint}:`;
export const timerTarget = (request: TimerAction) => (request.action === 'start' ? 'start' : `id:${request.timerId}`);

const requestId = () =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

// One explicit tap → one timer_command_v2 with a fresh request id, in the epoch of the last read. The proof is a
// read newer than the answer (the bridge acts before it answers; settled by the screen, see settleTimerWishes): the
// answer asks for that read at once. A refused or unreadable answer is shown, never resent.
export function timerCommands(store: CommandStore = appCommands, client?: QueryClient) {
  return (endpoint: string, epoch: string, request: TimerAction) => {
    const data: Record<string, string | number> = {endpoint, epoch, request_id: requestId(), action: request.action};
    if (request.action === 'start') Object.assign(data, {seconds: request.seconds, name: request.name});
    else data.timer_id = request.timerId;
    if (request.action === 'adjust')
      Object.assign(data, {delta_seconds: request.deltaSeconds, expected_revision: request.expectedRevision});
    store.send({
      key: timerWishKey(endpoint, timerTarget(request)),
      entityId: null,
      value: request,
      confirm: () => false,
      call: async () => {
        const result = await serviceResponse(
          {domain: 'podvoice', service: 'timer_command_v2', data, returnResponse: true},
          commandReply,
          store.source,
        );
        if (!result.ok) {
          if (result.outcome !== 'not_sent') void client?.invalidateQueries({queryKey: timerKey(endpoint)});
          return result;
        }
        // After the answer (the wish has its answeredAt by the time this read lands).
        setTimeout(() => {
          void client?.invalidateQueries({queryKey: timerKey(endpoint)});
        }, 0);
        if (result.value.ok) return {ok: true, response: result.value};
        return {
          ok: false,
          outcome: result.value.outcome === 'unknown' ? 'unknown' : 'rejected',
          reason: result.value.error ?? 'rejected',
        };
      },
    });
  };
}

// Ends every answered timer wish of the endpoint once a read newer than its answer has arrived.
export function settleTimerWishes(store: CommandStore, endpoint: string, readAt: number) {
  for (const wish of Object.values(store.store.getState().wishes)) {
    if (!wish?.key.startsWith(timerWishPrefix(endpoint))) continue;
    if (wish.phase === 'awaiting' && wish.answeredAt > 0 && readAt > wish.answeredAt) store.settle(wish.key, true);
  }
}

export function useTimerCommands() {
  const client = useQueryClient();
  return timerCommands(appCommands, client);
}
