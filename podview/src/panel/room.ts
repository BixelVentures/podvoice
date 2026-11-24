// The room the page shows: a room chip tapped this session, else the area in the panel's URL (/podview/<area_id>),
// else the integration's default area (PodVoice → Konfigurer → PodView-vægskærm → Standardrum), else the
// household's main room (mainRoom). An id HA does not know (yet) falls through to the next one.
// Rooms are HA areas, with each PodConnect speaker in the room PodConnect's own room rules give it
// (lib/ha/speaker-rooms.ts).
import type {Room} from '../lib/ha/catalog';
import {useRoomCatalog} from '../lib/ha/speaker-rooms';
import {usePanelConfig} from '../lib/ha/transport';
import {useNav} from './nav';

const collator = new Intl.Collator('da-DK');

// Without a setting: the room the wall can do the most in. A room with both a speaker and lights first (PodView is
// the room's music and its lights), then the one with the most of them, then by name. Only HA's own data counts: a
// bedroom with one speaker never wins over the room with the household's speaker and lamps because it sorts first.
export function mainRoom(rooms: readonly Room[]): Room | null {
  const both = (room: Room) => Number(room.players.length > 0 && room.lights.length > 0);
  const size = (room: Room) => room.players.length + room.lights.length;
  return (
    [...rooms].sort((a, b) => both(b) - both(a) || size(b) - size(a) || collator.compare(a.name, b.name))[0] ??
    null
  );
}

export function pickRoom(rooms: Room[], ...wishes: unknown[]): Room | null {
  for (const wish of wishes) {
    const room = typeof wish === 'string' ? rooms.find(item => item.id === wish) : undefined;
    if (room) return room;
  }
  return mainRoom(rooms);
}

export function useRoom(): {room: Room | null; rooms: Room[]} {
  const {rooms} = useRoomCatalog();
  const chosen = useNav(state => state.room);
  const fromUrl = useNav(state => state.routeRoom);
  const fallback = usePanelConfig()?.default_area;
  return {room: pickRoom(rooms, chosen, fromUrl, fallback), rooms};
}
