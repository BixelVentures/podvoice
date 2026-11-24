// A panel state the PodVoice integration pushes over HA's websocket (podvoice/robot_subscribe,
// podvoice/vehicle_subscribe: custom_components/podvoice/panel_live.py) instead of the page polling a service, which
// HA records as an event on the Green's slow eMMC. One subscription per command and link generation, however many
// parts of the page read it (Hjem's tile, the screen, the shell's prefetch); the cache holds the last push. An
// integration without the command (older than this panel) is read once through its service instead.
import {useQuery, useQueryClient} from '@tanstack/react-query';
import type {QueryClient} from '@tanstack/react-query';
import {useEffect} from 'react';
import type {z} from 'zod';
import {serviceResponse, subscribeHa, transport as appTransport} from './transport';
import type {HaTransport} from './transport';

export interface PushedState<T> {
  // The websocket command (podvoice/robot_subscribe).
  type: string;
  // The service with the same read, for an integration without the command (robot_panel_state).
  service: string;
  key: (generation: number) => readonly unknown[];
  schema: z.ZodType<T>;
}

const live = new Map<string, {count: number; stop: () => void}>();

async function readService<T>(state: PushedState<T>, source: HaTransport): Promise<T> {
  const result = await serviceResponse(
    {domain: 'podvoice', service: state.service, data: {}, returnResponse: true},
    state.schema,
    source,
  );
  if (!result.ok) throw new Error(result.reason || result.outcome);
  return result.value;
}

export function subscribePushed<T>(
  client: QueryClient,
  state: PushedState<T>,
  generation: number,
  source: HaTransport = appTransport,
): () => void {
  const id = `${state.type}\u0000${String(generation)}`;
  const key = state.key(generation);
  const held = live.get(id);
  if (held) held.count += 1;
  else {
    const stop = subscribeHa(
      {type: state.type},
      message => {
        const parsed = state.schema.safeParse(message);
        if (parsed.success) client.setQueryData(key, parsed.data);
      },
      reason => {
        // Not yet subscribed: the service answers once (the subscription keeps trying, transport.ts).
        if (client.getQueryData(key) === undefined || reason === 'unknown_command')
          void client.query({queryKey: key, queryFn: () => readService(state, source)}).catch(() => undefined);
      },
      source,
    );
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

// The pushed state: the last value at once, nothing fetched by the query itself.
export function usePushedState<T>(state: PushedState<T>, generation: number) {
  const client = useQueryClient();
  useEffect(() => subscribePushed(client, state, generation), [client, state, generation]);
  return useQuery<T>({
    queryKey: state.key(generation),
    enabled: false,
    staleTime: Infinity,
    gcTime: 60_000,
    queryFn: () => Promise.reject(new Error('pushed')),
  });
}
