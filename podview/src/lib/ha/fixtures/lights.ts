// Philips Hue as Home Assistant's hue platform shows it (installed by createFakeHass), shaped after the owner's HA
// Green: each Hue room is a group light (`is_hue_group`, `hue_type: room`, an `entity_id` member list) beside its
// lamps, the room's scenes are `scene.*` entities with Hue's attributes (`name`, `brightness` when the scene has one),
// and the active scene is a `select.<room>_scene` whose state is the scene's name. Two lamps in Stue are unavailable
// (unplugged) and one lamp has no area. A scene run sets its room's lamps and the select; any other lamp change
// leaves the scene (the select goes back to unknown), as the bridge does; a group follows its members.
import type {Hass} from '../hass';
import type {FakeHass} from '../ha-fixture';
import {entity} from '../ha-fixture';

export const HUE = {
  kokkenGroup: 'light.kokkenalrum_kokkenalrum',
  stueGroup: 'light.stue_stue',
  mushroom: 'light.stue_mushroom',
  panton: 'light.stue_verner_panton',
  unplaced: 'light.hue_ambiance_lamp_1',
  kokkenSelect: 'select.kokkenalrum_kokkenalrum_scene',
  stueSelect: 'select.stue_stue_scene',
} as const;

interface HueScene {
  id: string;
  name: string;
  // Hue's own scene brightness (0–100), when the scene has one.
  brightness?: number;
}

interface HueRoom {
  area: string;
  group: string;
  select: string;
  members: string[];
  scenes: HueScene[];
}

export const HUE_ROOMS: HueRoom[] = [
  {area: 'kokken', group: HUE.kokkenGroup, select: HUE.kokkenSelect,
    members: ['light.kokken_loft', 'light.kokken_o'],
    scenes: [
      {id: 'scene.kokkenalrum_kokkenalrum_natlys', name: 'Natlys', brightness: 50.2},
      {id: 'scene.kokkenalrum_kokkenalrum_laes', name: 'Læs', brightness: 100},
      {id: 'scene.kokkenalrum_kokkenalrum_slap_af', name: 'Slap af'},
    ]},
  {area: 'stue', group: HUE.stueGroup, select: HUE.stueSelect,
    members: ['light.stue_lampe', HUE.mushroom, HUE.panton],
    scenes: [
      {id: 'scene.stue_stue_alt_lys', name: 'Alt lys', brightness: 100},
      {id: 'scene.stue_stue_nat_for_frida', name: 'Nat for Frida', brightness: 12},
      {id: 'scene.stue_stue_stue', name: 'Stue'},
    ]},
];

const DIMMABLE = {supported_color_modes: ['color_temp', 'xy'], color_mode: 'color_temp'};
type Entry = NonNullable<Hass['entities']>[string];

export function installLightsFake(fake: FakeHass): void {
  const at = Date.now();
  const roomOf = (lightId: string) => HUE_ROOMS.find(room => room.group === lightId || room.members.includes(lightId));
  const read = (id: string) => fake.hass.states[id];
  const groupState = (room: HueRoom) => {
    const lit = room.members.map(read).filter(state => state?.state === 'on');
    const levels = lit.map(state => state?.attributes.brightness).filter((v): v is number => typeof v === 'number');
    return {
      state: lit.length ? 'on' : 'off',
      brightness: levels.length ? Math.round(levels.reduce((sum, v) => sum + v, 0) / levels.length) : null,
    };
  };
  const added = HUE_ROOMS.flatMap(room => [
    entity(room.group, 'off', {friendly_name: room.area === 'kokken' ? 'Køkkenalrum' : 'Stue', is_hue_group: true,
      hue_type: 'room', entity_id: room.members, ...DIMMABLE}, at),
    entity(room.select, room.area === 'kokken' ? 'Natlys' : 'unknown', {friendly_name: 'Scene',
      options: room.scenes.map(scene => scene.name)}, at),
    ...room.scenes.map(scene => entity(scene.id, 'unknown', {friendly_name: `${room.area === 'kokken'
      ? 'Køkkenalrum' : 'Stue'} ${scene.name}`, name: scene.name, group_type: 'room', is_dynamic: false,
    speed: 0.5, ...(scene.brightness === undefined ? {} : {brightness: scene.brightness})}, at)),
  ]);
  added.push(
    entity(HUE.mushroom, 'unavailable', {friendly_name: 'Mushroom', ...DIMMABLE}, at),
    entity(HUE.panton, 'unavailable', {friendly_name: 'Verner Panton', ...DIMMABLE}, at),
    entity(HUE.unplaced, 'on', {friendly_name: 'Hue ambiance lamp 1', brightness: 200, ...DIMMABLE}, at),
  );
  const entries: Record<string, Entry> = {};
  for (const room of HUE_ROOMS) {
    entries[room.group] = {entity_id: room.group, area_id: room.area, platform: 'hue'};
    entries[room.select] = {entity_id: room.select, area_id: room.area, platform: 'hue', entity_category: 'config'};
    for (const scene of room.scenes) entries[scene.id] = {entity_id: scene.id, area_id: room.area, platform: 'hue'};
  }
  entries[HUE.mushroom] = {entity_id: HUE.mushroom, area_id: 'stue', platform: 'hue'};
  entries[HUE.panton] = {entity_id: HUE.panton, area_id: 'stue', platform: 'hue'};
  entries[HUE.unplaced] = {entity_id: HUE.unplaced, platform: 'hue'};
  fake.addEntities(added, entries);

  const patch = fake.patch;
  const syncGroup = (room: HueRoom) => {
    const next = groupState(room);
    patch(room.group, next.state, {brightness: next.brightness});
  };
  for (const room of HUE_ROOMS) syncGroup(room);
  // A lamp patched by a test (a wall switch) moves its group, and leaves the scene.
  fake.patch = (entityId, state, attributes) => {
    patch(entityId, state, attributes);
    const room = roomOf(entityId);
    if (room && entityId !== room.group) {
      syncGroup(room);
      patch(room.select, 'unknown');
    }
  };
  const later = (effect: () => void) => {
    if (fake.mode === 'silent' || fake.mode === 'drop') return;
    setTimeout(effect, fake.confirmMs);
  };
  const lightService = (on: boolean) => (data: Record<string, unknown>, entityId: string | undefined) => {
    const room = entityId ? roomOf(entityId) : undefined;
    if (!entityId || !room) return undefined;
    const pct = typeof data.brightness_pct === 'number' ? data.brightness_pct : null;
    const level = pct === null ? {} : {brightness: Math.round((pct / 100) * 255)};
    if (entityId === room.group) {
      // The bridge switches the room's reachable lamps; the group follows them.
      later(() => {
        for (const member of room.members) {
          if (read(member)?.state === 'unavailable') continue;
          patch(member, on ? 'on' : 'off', on ? level : {brightness: null});
        }
        syncGroup(room);
        patch(room.select, 'unknown');
      });
      return {context: {id: `hue-${String(Date.now())}`}};
    }
    // A member: the generic light effect runs; its group and the scene follow a moment later.
    later(() => {
      setTimeout(() => {
        syncGroup(room);
        patch(room.select, 'unknown');
      }, 1);
    });
    return undefined;
  };
  fake.handle('light.turn_on', lightService(true));
  fake.handle('light.turn_off', lightService(false));
  fake.handle('scene.turn_on', (_data, entityId) => {
    const room = HUE_ROOMS.find(item => item.scenes.some(scene => scene.id === entityId));
    const scene = room?.scenes.find(item => item.id === entityId);
    if (!room || !scene || !entityId) return undefined;
    later(() => {
      const brightness = Math.round(((scene.brightness ?? 100) / 100) * 255);
      for (const member of room.members) {
        if (read(member)?.state === 'unavailable') continue;
        patch(member, 'on', {brightness});
      }
      syncGroup(room);
      patch(entityId, new Date().toISOString());
      patch(room.select, scene.name);
    });
    return {context: {id: `scene-${String(Date.now())}`}};
  });
}
