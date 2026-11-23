// Timers from the PodVoice integration's HA timer bridge (custom_components/podvoice/timer_bridge.py):
// podvoice.timer_status reads one endpoint's native timers, podvoice.timer_command_v2 acts on them. HA does not
// push these, so the page reads them: on open, after every command, every 5 s while a timer exists (30 s otherwise)
// and after a resync. The bridge owns the countdown; the page only counts down from the last read between reads.
import {useQuery, useQueryClient} from '@tanstack/react-query';
import type {QueryClient} from '@tanstack/react-query';
import {z} from 'zod';
import type {Timer} from '../../screens/timer/model';
import type {CommandStore} from './commands';
import {commands as appCommands} from './commands';
import {haKeys, serviceResponse} from './transport';

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

export const timerKey = (endpoint: string, generation: number) =>
  [...haKeys.read, 'timers', endpoint, generation] as const;

export function useTimerStatus(endpoint: string | null, generation: number) {
  return useQuery({
    queryKey: timerKey(endpoint ?? '', generation),
    enabled: !!endpoint,
    staleTime: 2000,
    gcTime: 60_000,
    refetchInterval: query => {
      const status = query.state.data?.status;
      return status?.ok && (status.timers.length || status.finished.length) ? 5000 : 30_000;
    },
    queryFn: async (): Promise<TimerRead> => {
      const result = await serviceResponse(
        {domain: 'podvoice', service: 'timer_status', data: {endpoint: endpoint ?? ''}, returnResponse: true},
        timerStatusSchema,
      );
      if (!result.ok) throw new Error(result.reason || result.outcome);
      return {status: result.value, readAt: globalThis.performance.now()};
    },
  });
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

export const timerWishKey = (endpoint: string) => `timer:${endpoint}`;

const requestId = () =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

// One explicit tap → one timer_command_v2 with a fresh request id, in the epoch of the last read. The proof is the
// next read (settled by the screen); a refused or unreadable answer is shown, never resent.
export function timerCommands(store: CommandStore = appCommands, client?: QueryClient) {
  return (endpoint: string, epoch: string, request: TimerAction, generation: number) => {
    const data: Record<string, string | number> = {endpoint, epoch, request_id: requestId(), action: request.action};
    if (request.action === 'start') Object.assign(data, {seconds: request.seconds, name: request.name});
    else data.timer_id = request.timerId;
    if (request.action === 'adjust')
      Object.assign(data, {delta_seconds: request.deltaSeconds, expected_revision: request.expectedRevision});
    store.send({
      key: timerWishKey(endpoint),
      entityId: null,
      value: request,
      confirm: () => false,
      call: async () => {
        const result = await serviceResponse(
          {domain: 'podvoice', service: 'timer_command_v2', data, returnResponse: true},
          commandReply,
          store.source,
        );
        void client?.invalidateQueries({queryKey: timerKey(endpoint, generation)});
        if (!result.ok) return result;
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

export function useTimerCommands() {
  const client = useQueryClient();
  return timerCommands(appCommands, client);
}
