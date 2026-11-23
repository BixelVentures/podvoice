// The room the page shows: the chosen room, else the first one. Rooms are HA areas, with each PodConnect speaker in
// the room PodConnect's own room rules give it (lib/ha/speaker-rooms.ts).
import type {Room} from '../lib/ha/catalog';
import {useRoomCatalog} from '../lib/ha/speaker-rooms';
import {useNav} from './nav';

export function useRoom(): {room: Room | null; rooms: Room[]} {
  const {rooms} = useRoomCatalog();
  const chosen = useNav(state => state.room);
  return {room: rooms.find(room => room.id === chosen) ?? rooms[0] ?? null, rooms};
}
