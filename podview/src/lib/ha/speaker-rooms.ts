// Which room each PodConnect speaker is in. PodConnect Control owns that (its room rules, the same source voice and
// the old PodView use), read through the PodVoice integration's podvoice.speaker_rooms. HA's areas are only the
// fallback for a speaker PodConnect places nowhere, so a room is never configured twice. The read is not pushed: it
// is made on open, after a resync and every five minutes; until it answers, the HA areas show.
import {useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import type {Catalog, Room} from './catalog';
import {haKeys, serviceResponse, useCatalog, useLink} from './transport';

export const speakerRoomsSchema = z.looseObject({
  ok: z.boolean(),
  speakers: z
    .array(
      z.object({
        entity_id: z.string().regex(/^media_player\.[a-z0-9_]+$/),
        area_id: z.string().min(1).max(128),
        area_name: z.string().min(1).max(120),
      }),
    )
    .max(64),
});
export type SpeakerRooms = z.infer<typeof speakerRoomsSchema>['speakers'];

const collator = new Intl.Collator('da-DK');

// The catalog with PodConnect's rooms applied: a speaker PodConnect places moves to that room (created from
// PodConnect's area name when HA's catalog has no lights or players there); every other speaker keeps its HA area.
export function placeSpeakers(catalog: Catalog, placed: SpeakerRooms): Catalog {
  if (!placed.length) return catalog;
  const target = new Map(placed.map(row => [row.entity_id, row]));
  const rooms = new Map<string, Room>(
    catalog.rooms.map(room => [room.id, {...room, players: room.players.filter(id => !target.has(id))}]),
  );
  for (const row of placed) {
    let room = rooms.get(row.area_id);
    if (!room) {
      room = {id: row.area_id, name: row.area_name, lights: [], players: []};
      rooms.set(row.area_id, room);
    }
    if (!room.players.includes(row.entity_id)) room.players = [...room.players, row.entity_id];
  }
  return {
    ...catalog,
    rooms: [...rooms.values()]
      .filter(room => room.lights.length || room.players.length)
      .sort((a, b) => collator.compare(a.name, b.name)),
    unplaced: {...catalog.unplaced, players: catalog.unplaced.players.filter(id => !target.has(id))},
  };
}

export const speakerRoomsKey = (generation: number) => [...haKeys.read, 'speaker-rooms', generation] as const;

export function useSpeakerRooms(): SpeakerRooms {
  const {generation} = useLink();
  const {data} = useQuery({
    queryKey: speakerRoomsKey(generation),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: previous => previous,
    queryFn: async () => {
      const result = await serviceResponse(
        {domain: 'podvoice', service: 'speaker_rooms', data: {}, returnResponse: true},
        speakerRoomsSchema,
      );
      if (!result.ok) throw new Error(result.reason || result.outcome);
      return result.value.speakers;
    },
  });
  return data ?? EMPTY;
}

const EMPTY: SpeakerRooms = [];

// The catalog every room view reads: HA's areas with PodConnect's speaker rooms on top.
export function useRoomCatalog(): Catalog {
  const catalog = useCatalog();
  const placed = useSpeakerRooms();
  return placeSpeakers(catalog, placed);
}
