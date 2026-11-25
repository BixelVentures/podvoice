// Lights by HA area: on/off and brightness (light.turn_on / light.turn_off). Brightness is shown only for a light
// whose color modes support dimming; HA's 0–255 scale is shown in percent.
import type {HassEntityState} from './hass';
import {UNAVAILABLE} from './hass';
import type {CommandStore} from './commands';
import {commands as appCommands} from './commands';
import {callService} from './transport';

export interface LightModel {
  entityId: string;
  name: string;
  available: boolean;
  on: boolean;
  dimmable: boolean;
  // 1–100 while on and dimmable, else null.
  brightness: number | null;
}

const DIMMABLE = new Set(['brightness', 'color_temp', 'hs', 'xy', 'rgb', 'rgbw', 'rgbww', 'white']);

export function lightModel(entity: HassEntityState): LightModel {
  const a = entity.attributes;
  const modes = Array.isArray(a.supported_color_modes) ? (a.supported_color_modes as unknown[]) : [];
  const dimmable = modes.some(mode => typeof mode === 'string' && DIMMABLE.has(mode));
  const on = entity.state === 'on';
  const raw = a.brightness;
  return {
    entityId: entity.entity_id,
    name: (typeof a.friendly_name === 'string' ? a.friendly_name.slice(0, 120) : '') || entity.entity_id,
    available: !UNAVAILABLE.has(entity.state),
    on,
    dimmable,
    brightness:
      on && dimmable && typeof raw === 'number' && raw >= 0 && raw <= 255 ? Math.max(1, Math.round((raw / 255) * 100)) : null,
  };
}

export const powerKey = (entityId: string) => `${entityId}:power`;
export const brightnessKey = (entityId: string) => `${entityId}:brightness`;

const pctOf = (entity: HassEntityState | null) => {
  const raw = entity?.attributes.brightness;
  return typeof raw === 'number' ? Math.round((raw / 255) * 100) : null;
};

export function lightCommands(store: CommandStore = appCommands) {
  return {
    power(entityId: string, on: boolean) {
      const wish = on ? 'on' : 'off';
      store.send({
        key: powerKey(entityId),
        entityId,
        value: on,
        confirm: entity => entity?.state === wish,
        observed: () => store.source.read(entityId),
        call: () => callService({domain: 'light', service: on ? 'turn_on' : 'turn_off', entityId}, store.source),
      });
    },
    brightness(entityId: string, percent: number) {
      const value = Math.round(Math.min(100, Math.max(1, percent)));
      store.send({
        key: brightnessKey(entityId),
        entityId,
        value,
        confirm: entity => {
          const seen = pctOf(entity);
          return entity?.state === 'on' && seen !== null && Math.abs(seen - value) <= 1;
        },
        observed: () => store.source.read(entityId),
        call: () => callService({domain: 'light', service: 'turn_on', entityId, data: {brightness_pct: value}}, store.source),
      });
    },
  };
}

export const lights = lightCommands();

// ---- Rooms, scenes and the whole home -------------------------------------------------------------------------

export interface RoomTarget {
  id: string;
  group: string | null;
  lamps: {entityId: string; available: boolean; on: boolean; dimmable: boolean; level: number | null}[];
}

export function roomCommands(store: CommandStore = appCommands, lamp = lightCommands(store)) {
  return {
    /** The room's switch: its group when HA has one (one call, the bridge switches the room), else each lamp. */
    power(room: RoomTarget, on: boolean) {
      if (room.group) {
        lamp.power(room.group, on);
        return;
      }
      for (const item of room.lamps) if (item.available && item.on !== on) lamp.power(item.entityId, on);
    },
    /** The room's brightness: its group, else every lit, dimmable lamp. */
    brightness(room: RoomTarget, percent: number) {
      if (room.group) {
        lamp.brightness(room.group, percent);
        return;
      }
      for (const item of room.lamps) if (item.on && item.dimmable) lamp.brightness(item.entityId, percent);
    },
    /** Runs a scene; the room shows it chosen at once, and HA's scene select (or the scene's own state) confirms. */
    scene(roomId: string, sceneId: string, select: {entityId: string; name: string} | null) {
      const before = store.source.read(sceneId)?.state;
      store.send({
        key: `${roomId}:scene`,
        entityId: select?.entityId ?? sceneId,
        value: sceneId,
        confirm: entity => select
          ? !!entity && entity.state.trim().toLocaleLowerCase('da-DK') === select.name.trim().toLocaleLowerCase('da-DK')
          : !!entity && entity.state !== before,
        observed: () => store.source.read(select?.entityId ?? sceneId),
        call: () => callService({domain: 'scene', service: 'turn_on', entityId: sceneId}, store.source),
      });
    },
  };
}

export const rooms = roomCommands();
