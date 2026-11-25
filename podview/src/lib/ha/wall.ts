// Skærm og enhed: what Home Assistant knows about the wall's own screen. The wall is an iPad running the Home
// Assistant Companion app in its kiosk mode; with kiosk mode on, the app reports the screen's brightness
// (sensor.<device>_kiosk_brightness, in %) and takes `kiosk_set_brightness` (level 0–100) as a notification command
// through its notify service (notify.mobile_app_<device>); its SSID sensor names the Wi-Fi. The panel cannot ask the
// browser which Companion device it runs in, so the wall is the Companion device in kiosk mode (the first by name
// when there are several), and the sheet names that device. Nothing here is guessed: a value HA does not report
// reads »Ikke oplyst«, and without kiosk mode there is no brightness control at all.
import {callService, transport as appTransport} from './transport';
import type {HaTransport} from './transport';
import type {Hass, HassEntityState} from './hass';
import {UNAVAILABLE} from './hass';
import {commands as appCommands} from './commands';
import type {CommandStore} from './commands';

export interface WallDevice {
  /** The Companion device's object id (»ipad_kokken«): its entities and notify service are named after it. */
  slug: string;
  brightness: string;
  kioskMode: string;
  ssid: string;
  /** notify.mobile_app_<slug>, when HA offers it. */
  notify: string | null;
  /** The device's name and model in HA's device registry (»iPad Air«, »Køkken-iPad«). */
  name: string | null;
  model: string | null;
}

const KIOSK = /^sensor\.([a-z0-9_]+)_kiosk_brightness$/;

// The Companion devices HA has with a kiosk brightness sensor, the one in kiosk mode first.
export function findWallDevices(hass: Hass | null): WallDevice[] {
  if (!hass) return [];
  const devices: WallDevice[] = [];
  for (const entityId of Object.keys(hass.states)) {
    const slug = KIOSK.exec(entityId)?.[1];
    if (!slug) continue;
    const entry = hass.entities?.[entityId];
    const device = entry?.device_id ? hass.devices?.[entry.device_id] : undefined;
    const service = `mobile_app_${slug}`;
    devices.push({
      slug,
      brightness: entityId,
      kioskMode: `binary_sensor.${slug}_kiosk_mode`,
      ssid: `sensor.${slug}_ssid`,
      notify: hass.services?.notify?.[service] ? service : null,
      name: device?.name_by_user ?? device?.name ?? null,
      model: device?.model ?? null,
    });
  }
  const kiosk = (device: WallDevice) => hass.states[device.kioskMode]?.state === 'on';
  return devices.sort((a, b) => Number(kiosk(b)) - Number(kiosk(a)) || a.slug.localeCompare(b.slug));
}

const known = (entity: HassEntityState | null) => !!entity && !UNAVAILABLE.has(entity.state);

/** The brightness HA reports, 0–100, or null. */
export function brightnessOf(entity: HassEntityState | null): number | null {
  if (!known(entity)) return null;
  const value = Number(entity?.state);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null;
}

/** The Wi-Fi the Companion app reports (»Hjemme«), »Ikke forbundet« without one, else »Ikke oplyst«. */
export function wifiOf(entity: HassEntityState | null): string {
  if (!known(entity) || !entity) return 'Ikke oplyst';
  return entity.state === 'Not Connected' ? 'Ikke forbundet' : entity.state;
}

export const brightnessKey = (slug: string) => `wall:${slug}:brightness`;

// One drag's end → one kiosk_set_brightness; the wish ends when the kiosk sensor reports the level.
export function wallCommands(store: CommandStore = appCommands, source: HaTransport = appTransport) {
  return {
    brightness(device: WallDevice, percent: number) {
      const level = Math.round(Math.min(100, Math.max(0, percent)));
      const service = device.notify;
      if (!service) return;
      store.send({
        key: brightnessKey(device.slug),
        entityId: device.brightness,
        value: level,
        confirm: entity => {
          const seen = brightnessOf(entity);
          return seen !== null && Math.abs(seen - level) <= 1;
        },
        call: () => callService({domain: 'notify', service, data: {message: 'kiosk_set_brightness',
          data: {level}}}, source),
      });
    },
  };
}

export const wall = wallCommands();
