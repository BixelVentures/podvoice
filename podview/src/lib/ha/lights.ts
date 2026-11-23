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
