// The room the page shows: a room chip tapped this session, else the area in the panel's URL, else the integration's
// default area (options), else the first room HA has. An id HA does not know (yet) falls through to the next one.
// Rooms are HA areas, with each PodConnect speaker in the room PodConnect's own room rules give it
// (lib/ha/speaker-rooms.ts).
import type {Room} from '../lib/ha/catalog';
import {useRoomCatalog} from '../lib/ha/speaker-rooms';
import {usePanelConfig} from '../lib/ha/transport';
import {useNav} from './nav';

export function pickRoom(rooms: Room[], ...wishes: unknown[]): Room | null {
  for (const wish of wishes) {
    const room = typeof wish === 'string' ? rooms.find(item => item.id === wish) : undefined;
    if (room) return room;
  }
  return rooms[0] ?? null;
}

export function useRoom(): {room: Room | null; rooms: Room[]} {
  const {rooms} = useRoomCatalog();
  const chosen = useNav(state => state.room);
  const fromUrl = useNav(state => state.routeRoom);
  const fallback = usePanelConfig()?.default_area;
  return {room: pickRoom(rooms, chosen, fromUrl, fallback), rooms};
}
