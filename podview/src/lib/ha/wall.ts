// Skærm og enhed: what Home Assistant knows about the wall's own screen. The wall is an iPad running the Home
// Assistant Companion app in its kiosk mode; with kiosk mode on, the app reports the screen's brightness
// (sensor.<device>_kiosk_brightness, in %) and takes `kiosk_set_brightness` (level 0–100) as a notification command
// through its notify service (notify.mobile_app_<device>); its SSID sensor names the Wi-Fi. The panel cannot ask the
// browser which Companion device it runs in: the integration names it (podvoice.wall below: the signed-in user's own
// device); only without that answer is the wall the Companion device in kiosk mode (the first by name when there are
// several). The sheet names that device. Nothing here is guessed: a value HA does not report
// reads »Ikke oplyst«, and without kiosk mode there is no brightness control at all.
import {useQuery} from '@tanstack/react-query';
import type {QueryClient} from '@tanstack/react-query';
import {z} from 'zod';
import {callService, haKeys, serviceResponse, transport as appTransport} from './transport';
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

// The wall, as the integration names it (podvoice.wall, wall_screen.py): the Companion device the signed-in Home
// Assistant user registered (the family iPad), not the first by name; the old rule only when that user has none.
// It also keeps the wall's two screen settings server-side, where the 21:00/07:00 dimming runs: Automatisk
// dæmpning and the day level (the last level set with the slider).
const wallDeviceSchema = z.looseObject({
  slug: z.string().regex(/^[a-z0-9_]{1,80}$/),
  device_id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  notify: z.string().nullable().optional(),
  brightness: z.string(),
  kiosk_mode: z.string(),
  source: z.enum(['user', 'rule']),
});
const wallSchema = z.looseObject({
  ok: z.literal(true),
  device: wallDeviceSchema.nullable(),
  auto_dim: z.boolean(),
  day_brightness: z.number().nullable(),
  night_brightness: z.number(),
  kiosk: z.boolean(),
  dims_screen: z.boolean(),
});
export type WallScreen = z.infer<typeof wallSchema>;
export const wallKey = [...haKeys.read, 'wall'] as const;

async function readWall(data: {auto_dim?: boolean; day_brightness?: number}, source: HaTransport) {
  const result = await serviceResponse({domain: 'podvoice', service: 'wall', data, returnResponse: true}, wallSchema,
    source);
  if (!result.ok) throw new Error(result.reason || result.outcome);
  return result.value;
}

/** The integration's wall (read once a session and when the sheet opens); null without it (an older integration). */
export function useWallScreen(fresh = false) {
  return useQuery({
    queryKey: wallKey,
    staleTime: fresh ? 0 : 5 * 60_000,
    refetchOnMount: fresh ? 'always' : true,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () => readWall({}, appTransport),
  });
}

/** Saves one wall setting in the integration; the answer is the new state. False when it could not be saved. */
export async function saveWall(client: QueryClient, data: {auto_dim?: boolean; day_brightness?: number},
  source: HaTransport = appTransport): Promise<boolean> {
  try {
    client.setQueryData(wallKey, await readWall(data, source));
    return true;
  } catch {
    return false;
  }
}

/** The wall device: the integration's choice when it answered, else the old rule (findWallDevices). */
export function wallDevice(hass: Hass | null, answer: WallScreen | undefined): WallDevice | null {
  const devices = findWallDevices(hass);
  const chosen = answer?.device;
  if (!chosen) return answer ? null : (devices[0] ?? null);
  const known = devices.find(device => device.slug === chosen.slug);
  if (known) return known;
  return {slug: chosen.slug, brightness: chosen.brightness, kioskMode: chosen.kiosk_mode,
    ssid: `sensor.${chosen.slug}_ssid`, notify: chosen.notify ?? null, name: chosen.name ?? null,
    model: chosen.model ?? null};
}
