// Radio from PodConnect Speakers, through the PodVoice integration's bridge
// (custom_components/podvoice/music_bridge.py: podvoice.radio_state, podvoice.radio_command). HA does not push the
// radio's own state, so the page reads it while Radio is open, after every command and whenever a room's speaker
// starts or stops playing radio. The room's media_player (podconnect_source: radio) is the speaker's status and
// confirms a start or stop; a radio Speakers cannot be reached is said so, never guessed.
import {keepPreviousData, useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import type {CommandStore} from './commands';
import {commands as appCommands} from './commands';
import {bridgeCall, sourceOf} from './podconnect';
import {haKeys, serviceResponse} from './transport';
import {queryClient} from '../query/client';

const station = z.object({id: z.string().max(64), name: z.string().max(120)});
const target = z.object({
  id: z.string().max(128),
  name: z.string().max(160),
  available: z.boolean(),
  selectable: z.boolean(),
  default: z.boolean(),
  entity_id: z.string().regex(/^media_player\.[a-z0-9_]+$/).nullable(),
});
export type RadioTarget = z.infer<typeof target>;

export const radioSchema = z.union([
  z.looseObject({
    ok: z.literal(true),
    available: z.literal(true),
    enabled: z.boolean(),
    blocked: z.array(z.string().max(80)).max(24),
    state: z.string().max(32),
    station_id: z.string().max(64).nullable(),
    target_id: z.string().max(128).nullable(),
    source_kind: z.string().max(32),
    volume_percent: z.number().int().min(0).max(100).nullable(),
    actions: z.array(z.enum(['start', 'stop', 'move', 'volume'])).max(4),
    stations: z.array(station).max(16),
    targets: z.array(target).max(64),
  }),
  z.looseObject({ok: z.literal(true), available: z.literal(false), reason: z.string().max(40)}),
]);
export type RadioState = z.infer<typeof radioSchema>;
export type LiveRadio = Extract<RadioState, {available: true}>;

export const radioKey = (generation: number) => [...haKeys.read, 'radio', generation] as const;

// Read from the moment the screen is built (the panel builds it as the finger lands on its control), so the stations
// are drawn before the slide, not during it; polled only while it is shown.
export function useRadio(generation: number, open: boolean) {
  return useQuery({
    queryKey: radioKey(generation),
    staleTime: 2000,
    gcTime: 60_000,
    placeholderData: keepPreviousData,
    refetchInterval: open ? 5000 : false,
    queryFn: async (): Promise<RadioState> => {
      const result = await serviceResponse(
        {domain: 'podvoice', service: 'radio_state', data: {}, returnResponse: true},
        radioSchema,
      );
      if (!result.ok) throw new Error(result.reason || result.outcome);
      return result.value;
    },
  });
}

// The radio plays now: Speakers says so for its own source.
export const radioPlaying = (radio: LiveRadio) => radio.state === 'playing' && radio.source_kind === 'radio';

export const RADIO_KEY = 'radio:command';

export function radioCommands(store: CommandStore = appCommands) {
  const send = (
    entityId: string | null,
    value: unknown,
    data: Record<string, string | number>,
    confirm: (playing: boolean) => boolean,
  ) => {
    store.send({
      key: RADIO_KEY,
      entityId,
      value,
      // The room's speaker confirms: it plays radio (a start) or no longer does (a stop).
      confirm: entity => confirm(entity?.state === 'playing' && sourceOf(entity) === 'radio'),
      call: async () => {
        const outcome = await bridgeCall({domain: 'podvoice', service: 'radio_command', data, returnResponse: true},
          store.source);
        void queryClient.invalidateQueries({queryKey: [...haKeys.read, 'radio']});
        return outcome;
      },
      timeoutMs: 15_000,
    });
  };
  return {
    start(stationId: string, to: RadioTarget) {
      send(to.entity_id, {station: stationId, target: to.id}, {action: 'start', station_id: stationId,
        target_id: to.id}, playing => playing);
    },
    move(to: RadioTarget) {
      send(to.entity_id, {target: to.id}, {action: 'move', target_id: to.id}, playing => playing);
    },
    stop(from: RadioTarget | null) {
      send(from?.entity_id ?? null, 'stop', {action: 'stop'}, playing => !playing);
    },
  };
}

export const radio = radioCommands();
