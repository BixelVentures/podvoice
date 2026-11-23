// Rooms are Home Assistant areas. An entity belongs to its own area, else its device's area. Only what HA says is
// shown: an area without lights or players is not a room here, and nothing is guessed from names.
import type {Hass} from './hass';
import {domainOf} from './hass';

export interface Room {
  id: string;
  name: string;
  lights: string[];
  players: string[];
}

export interface Catalog {
  rooms: Room[];
  // Lights and PodConnect players HA has not placed in an area.
  unplaced: {lights: string[]; players: string[]};
  weather: string[];
}

// The one owner of the HomePod players (docs/research/hjemmepanel-2026-11-23.md): PodConnect's integration.
export const PLAYER_PLATFORM = 'podconnect';

export const EMPTY_CATALOG: Catalog = {rooms: [], unplaced: {lights: [], players: []}, weather: []};

const collator = new Intl.Collator('da-DK');

export function entityArea(hass: Pick<Hass, 'entities' | 'devices'>, entityId: string): string | null {
  const entry = hass.entities?.[entityId];
  if (!entry) return null;
  if (entry.area_id) return entry.area_id;
  const device = entry.device_id ? hass.devices?.[entry.device_id] : undefined;
  return device?.area_id ?? null;
}

export function buildCatalog(hass: Pick<Hass, 'states' | 'areas' | 'devices' | 'entities'>): Catalog {
  const rooms = new Map<string, Room>();
  const unplaced = {lights: [] as string[], players: [] as string[]};
  const weather: string[] = [];
  for (const entityId of Object.keys(hass.states).sort()) {
    const domain = domainOf(entityId);
    const entry = hass.entities?.[entityId];
    if (entry?.hidden || entry?.entity_category) continue;
    if (domain === 'weather') {
      weather.push(entityId);
      continue;
    }
    const kind = domain === 'light' ? 'lights' : domain === 'media_player' && entry?.platform === PLAYER_PLATFORM
      ? 'players'
      : null;
    if (!kind) continue;
    const areaId = entityArea(hass, entityId);
    const area = areaId ? hass.areas?.[areaId] : undefined;
    if (!areaId || !area) {
      unplaced[kind].push(entityId);
      continue;
    }
    let room = rooms.get(areaId);
    if (!room) {
      room = {id: areaId, name: area.name, lights: [], players: []};
      rooms.set(areaId, room);
    }
    room[kind].push(entityId);
  }
  return {
    rooms: [...rooms.values()].sort((a, b) => collator.compare(a.name, b.name)),
    unplaced,
    weather,
  };
}

// The catalog only changes with the registries or the set of entity ids; a state change alone never rebuilds it.
export function catalogKey(hass: Pick<Hass, 'states' | 'areas' | 'devices' | 'entities'>): unknown[] {
  return [hass.areas, hass.devices, hass.entities, Object.keys(hass.states).length];
}
