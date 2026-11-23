// The room the page shows: the chosen HA area, else the first one HA has.
import type {Room} from '../lib/ha/catalog';
import {useCatalog} from '../lib/ha/transport';
import {useNav} from './nav';

export function useRoom(): {room: Room | null; rooms: Room[]} {
  const {rooms} = useCatalog();
  const chosen = useNav(state => state.room);
  return {room: rooms.find(room => room.id === chosen) ?? rooms[0] ?? null, rooms};
}
