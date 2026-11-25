// Lys by room, as Home Assistant shows it: one model for the Lys page and Hjem's Lys widget. A room is an HA area
// with lights. A group light (Hue's room: `is_hue_group`; an HA light group: an `entity_id` member list) is the
// room's own power and brightness, never a lamp: it is left out of the lamp grid and of every count. An unavailable
// lamp is shown (dimmed, locked) but counts neither as on nor as off. Scenes are the area's `scene.*`; the active one
// is Hue's scene select (its state is the scene's name). Nothing is guessed: a scene without a brightness shows no %.
// A wish (a tap not yet confirmed by HA) is shown at once over HA's state (commands.ts).
import type {Room} from './catalog';
import type {Wish} from './commands';
import type {HassEntityState} from './hass';
import {UNAVAILABLE} from './hass';
import {brightnessKey, lightModel, powerKey} from './lights';
import type {LightModel} from './lights';

export type Read = (entityId: string) => HassEntityState | null;
export type ReadWish = (key: string) => Wish | undefined;

// A group seen once stays a group, also when HA drops its attributes while it is unavailable.
const groups = new Set<string>();

export function isGroupLight(entity: HassEntityState | null): boolean {
  if (!entity) return false;
  const a = entity.attributes;
  if (a.is_hue_group === true || Array.isArray(a.entity_id)) groups.add(entity.entity_id);
  return groups.has(entity.entity_id);
}

export const sceneKey = (roomId: string) => `${roomId}:scene`;

const pending = (wish: Wish | undefined) => !!wish && (wish.phase === 'sending' || wish.phase === 'awaiting');

export interface LampView {
  entityId: string;
  name: string;
  /** HA reaches the lamp (not unavailable). */
  available: boolean;
  /** HA says on or off (an unavailable or unknown lamp does not). */
  known: boolean;
  on: boolean;
  dimmable: boolean;
  /** 1–100 while on and dimmable. */
  level: number | null;
  status: string;
  dot: 'on' | 'off' | 'unknown';
}

export interface SceneView {
  entityId: string;
  name: string;
  /** Hue's own scene brightness in %, when the scene has one. */
  level: number | null;
}

export type RoomState = 'taendt' | 'slukket' | 'ukendt' | 'tom';

export interface RoomLights {
  id: string;
  name: string;
  /** This screen's own room. */
  own: boolean;
  /** The room's group light (its power and brightness), if HA has one. */
  group: string | null;
  lamps: LampView[];
  lampsOn: number;
  /** Lamps whose on/off HA knows. */
  lampsKnown: number;
  state: RoomState;
  on: boolean;
  /** The room's level: the group's while it is on, else the brightest lit lamp's; null with nothing lit. */
  level: number | null;
  /** The room has something to dim (a dimmable group or lamp that is on). */
  dimmable: boolean;
  scenes: SceneView[];
  /** Hue's active-scene select, if HA has one for the room. */
  select: string | null;
  /** The active scene (the select's, or a scene tap on its way). */
  activeScene: string | null;
  /** A scene tap on its way (shown chosen before HA confirms it). */
  scenePending: boolean;
}

const pct = (raw: unknown) => typeof raw === 'number' && raw >= 0 && raw <= 255
  ? Math.max(1, Math.round((raw / 255) * 100)) : null;

// A summary (Hjem's widget) reads only power and brightness; the colour modes that say whether a lamp dims are read
// for the page's controls alone, so a lamp HA describes oddly can only take down Lys, never Hjem.
function summary(entity: HassEntityState): LightModel {
  const name = entity.attributes.friendly_name;
  const on = entity.state === 'on';
  const level = on ? pct(entity.attributes.brightness) : null;
  return {entityId: entity.entity_id, name: typeof name === 'string' && name ? name.slice(0, 120) : entity.entity_id,
    available: !UNAVAILABLE.has(entity.state), on, dimmable: level !== null, brightness: level};
}

function lampView(entity: HassEntityState, wish: ReadWish, stale: boolean, groupWish: Wish | undefined,
  detail: boolean): LampView {
  const model = detail ? lightModel(entity) : summary(entity);
  const unavailable = entity.state === 'unavailable';
  // Without a link to HA the last known state stays (a tap then says it was not sent); only its words say unknown.
  const known = entity.state === 'on' || entity.state === 'off';
  const power = wish(powerKey(entity.entity_id));
  const level = wish(brightnessKey(entity.entity_id));
  // The room's switch (a group) speaks for every lamp it reaches until HA shows the result.
  const on = !known ? false : pending(power) ? power?.value === true
    : pending(groupWish) ? groupWish?.value === true : model.on;
  const brightness = on && model.dimmable ? (pending(level) ? (level?.value as number) : model.brightness) : null;
  return {
    entityId: entity.entity_id,
    name: model.name,
    available: !unavailable,
    known,
    on,
    dimmable: model.dimmable,
    level: brightness,
    status: unavailable ? 'Ikke forbundet' : !known || stale ? 'Status ukendt' : on ? 'Tændt' : 'Slukket',
    dot: !known || stale ? 'unknown' : on ? 'on' : 'off',
  };
}

function sceneName(entity: HassEntityState, room: string): string {
  const own = entity.attributes.name;
  if (typeof own === 'string' && own.trim()) return own.trim().slice(0, 80);
  let name = typeof entity.attributes.friendly_name === 'string' ? entity.attributes.friendly_name.trim() : '';
  while (room && name.toLocaleLowerCase('da-DK').startsWith(`${room.toLocaleLowerCase('da-DK')} `))
    name = name.slice(room.length + 1).trim();
  return (name || entity.entity_id).slice(0, 80);
}

function sceneLevel(entity: HassEntityState): number | null {
  const raw = entity.attributes.brightness;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 100 ? Math.round(raw) : null;
}

const same = (a: string, b: string) => a.trim().toLocaleLowerCase('da-DK') === b.trim().toLocaleLowerCase('da-DK');

/** `stale`: no link to HA. The last known state stays and stays controllable; the words say »Status ukendt«. */
export function roomLights(room: Room, read: Read, wish: ReadWish, {own = false, stale = false, detail = true}:
  {own?: boolean; stale?: boolean; detail?: boolean} = {}): RoomLights {
  const entities = room.lights.map(read).filter((entity): entity is HassEntityState => !!entity);
  const groupEntities = entities.filter(isGroupLight);
  // The room's group: Hue's room group first, else a group whose members are this room's lamps.
  const group = groupEntities.find(entity => entity.attributes.hue_type === 'room') ?? groupEntities[0] ?? null;
  const groupWish = group ? wish(powerKey(group.entity_id)) : undefined;
  const lamps = entities.filter(entity => !isGroupLight(entity)).map(entity => lampView(entity, wish, stale,
    groupWish, detail));
  const lampsKnown = lamps.filter(lamp => lamp.known).length;
  const lampsOn = lamps.filter(lamp => lamp.on).length;
  const groupKnown = !!group && !UNAVAILABLE.has(group.state);
  const known = lamps.length ? lampsKnown > 0 : groupKnown;
  const on = lamps.length ? lampsOn > 0 : pending(groupWish) ? groupWish?.value === true : group?.state === 'on';
  const state: RoomState = !lamps.length && !group ? 'tom' : !known ? 'ukendt' : on ? 'taendt' : 'slukket';
  const groupModel = group ? (detail ? lightModel(group) : summary(group)) : null;
  const groupLevelWish = group ? wish(brightnessKey(group.entity_id)) : undefined;
  const groupLevel = group && groupModel?.dimmable && groupKnown
    ? pending(groupLevelWish) ? (groupLevelWish?.value as number) : pct(group.attributes.brightness)
    : null;
  const lit = lamps.flatMap(lamp => (lamp.on && lamp.level !== null ? [lamp.level] : []));
  const level = state !== 'taendt' ? null
    : groupLevel !== null && (group?.state === 'on' || pending(groupLevelWish)) ? groupLevel
      : lit.length ? Math.max(...lit) : null;
  const dimmable = state === 'taendt' && (!!groupModel?.dimmable || lamps.some(lamp => lamp.on && lamp.dimmable));

  const scenes = (room.scenes ?? []).map(read).filter((entity): entity is HassEntityState => !!entity)
    .map(entity => ({entityId: entity.entity_id, name: sceneName(entity, room.name), level: sceneLevel(entity)}));
  const selects = (room.selects ?? []).map(read).filter((entity): entity is HassEntityState => !!entity)
    .filter(entity => Array.isArray(entity.attributes.options) && (entity.attributes.options as unknown[])
      .some(option => typeof option === 'string' && scenes.some(scene => same(scene.name, option))));
  const select = selects.find(entity => entity.entity_id.endsWith('_scene')) ?? selects[0] ?? null;
  const sceneWish = wish(sceneKey(room.id));
  const scenePending = pending(sceneWish) && scenes.some(scene => scene.entityId === sceneWish?.value);
  const fromSelect = select ? scenes.find(scene => same(scene.name, select.state))?.entityId ?? null : null;
  return {
    id: room.id,
    name: room.name,
    own,
    group: group?.entity_id ?? null,
    lamps,
    lampsOn,
    lampsKnown,
    state,
    on: state === 'taendt',
    level,
    dimmable,
    scenes,
    select: select?.entity_id ?? null,
    activeScene: scenePending ? (sceneWish?.value as string) : fromSelect,
    scenePending,
  };
}

/** The rooms that have lights (a lamp or a group), this screen's room first. */
export function lightRooms(rooms: readonly Room[], ownId: string | null): Room[] {
  const lit = rooms.filter(room => room.lights.length > 0);
  return [...lit.filter(room => room.id === ownId), ...lit.filter(room => room.id !== ownId)];
}

/** Every entity a room's model reads (lights, scenes, selects). */
export function roomEntities(room: Room): string[] {
  return [...room.lights, ...(room.scenes ?? []), ...(room.selects ?? [])];
}
