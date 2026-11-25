// Radio from PodConnect Speakers, through the PodVoice integration (custom_components/podvoice/music_bridge.py:
// podvoice.radio_command; radio_live.py: podvoice/radio_subscribe). The integration pushes the radio's own state over
// HA's websocket while the screen exists: at once, every 5 s if it changed, after each command and when a room's
// speaker starts or stops playing radio; nothing is polled from the page and no service call is recorded. The room's
// media_player (podconnect_source: radio) is the speaker's status and confirms a start or stop; a radio Speakers
// cannot be reached is said so, never guessed. An integration without the subscription is read once.
import {useQuery, useQueryClient} from '@tanstack/react-query';
import type {QueryClient} from '@tanstack/react-query';
import {useEffect} from 'react';
import {z} from 'zod';
import type {CommandStore} from './commands';
import {commands as appCommands} from './commands';
import {bridgeCall, sourceOf} from './podconnect';
import {haKeys, serviceResponse, subscribeHa, transport as appTransport} from './transport';
import type {HaTransport} from './transport';

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

async function readRadio(source: HaTransport = appTransport): Promise<RadioState> {
  const result = await serviceResponse(
    {domain: 'podvoice', service: 'radio_state', data: {}, returnResponse: true},
    radioSchema,
    source,
  );
  if (!result.ok) throw new Error(result.reason || result.outcome);
  return result.value;
}

const live = new Map<number, {count: number; stop: () => void}>();

export function subscribeRadio(client: QueryClient, generation: number, source: HaTransport = appTransport) {
  const held = live.get(generation);
  if (held) held.count += 1;
  else {
    const stop = subscribeHa({type: 'podvoice/radio_subscribe'}, message => {
      const parsed = radioSchema.safeParse(message);
      if (parsed.success) client.setQueryData<RadioState>(radioKey(generation), parsed.data);
    }, () => {
      // An integration without the subscription (older than 0.1.28): one read.
      readRadio(source).then(
        state => client.setQueryData<RadioState>(radioKey(generation), state),
        () => undefined,
      );
    }, source);
    live.set(generation, {count: 1, stop});
  }
  return () => {
    const entry = live.get(generation);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    live.delete(generation);
    entry.stop();
  };
}

// Pushed from the moment the screen is built (the panel builds it as the finger lands on its control), so the
// stations are drawn before the slide, not during it. »Prøv igen« (refetch) reads once.
export function useRadio(generation: number) {
  const client = useQueryClient();
  useEffect(() => subscribeRadio(client, generation), [client, generation]);
  return useQuery({
    queryKey: radioKey(generation),
    enabled: false,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
    queryFn: () => readRadio(),
  });
}

// The radio plays now: Speakers says so for its own source.
export const radioPlaying = (radio: LiveRadio) => radio.state === 'playing' && radio.source_kind === 'radio';

export const RADIO_KEY = 'radio:command';

// The stations' own look and words (the design canvas's A-Radio and the product's catalogue, radio-model): the
// station colour (the hero's tint, the tile's ring, the needle's place), the scale's mark and the description. The
// catalogue order is P1 first (owner, 25 Nov), as on the canvas; Speakers' list is shown in that order.
export const STATION_LOOK: Readonly<Record<string, {name: string; mark: string; colour: string;
  description: string}>> = {
  p1: {name: 'P1', mark: 'P1', colour: '#FF6600', description: 'Nyheder og samtaler'},
  p3: {name: 'P3', mark: 'P3', colour: '#4DFF4D', description: 'Musik og underholdning'},
  'p4-ostjylland': {name: 'P4 Østjylland', mark: 'P4', colour: '#FF9900', description: 'Musik og regionalt indhold'},
  'p6-beat': {name: 'P6 Beat', mark: 'P6', colour: '#4F4A4F', description: 'Alternativ musik'},
  'p8-jazz': {name: 'P8 Jazz', mark: 'P8', colour: '#7E57C8', description: 'Jazz'},
};
export const STATION_ORDER = Object.keys(STATION_LOOK);

/** Speakers' stations in the catalogue's order (P1 first); a station the catalogue does not know comes last. */
export function catalogueOrder<T extends {id: string}>(stations: readonly T[]): T[] {
  const rank = (id: string) => {
    const at = STATION_ORDER.indexOf(id);
    return at < 0 ? STATION_ORDER.length : at;
  };
  return [...stations].sort((a, b) => rank(a.id) - rank(b.id));
}

export const stationLogo = (id: string) => `assets/radio-${id}.svg`;

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
        // The integration reads the radio again after the command and pushes the change (radio_live.poke).
        return bridgeCall({domain: 'podvoice', service: 'radio_command', data, returnResponse: true}, store.source);
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
