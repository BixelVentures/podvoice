// The wall's iPad as the Home Assistant Companion app shows it in kiosk mode (installed by createFakeHass): its
// kiosk brightness sensor (%), kiosk mode, SSID sensor and its notify service, which takes `kiosk_set_brightness`
// and reports the new level on the sensor a moment later, as the app does. `wallState.kiosk = false` is the app
// without kiosk mode (its kiosk sensors are disabled, so HA has no brightness). `podvoice.wall` is the integration's
// answer: this user's own Companion device is the wall, and it keeps Automatisk dæmpning and the day level.
import type {FakeHass} from '../ha-fixture';
import {entity} from '../ha-fixture';

export const WALL = {
  brightness: 'sensor.ipad_kokken_kiosk_brightness',
  kiosk: 'binary_sensor.ipad_kokken_kiosk_mode',
  ssid: 'sensor.ipad_kokken_ssid',
  notify: 'mobile_app_ipad_kokken',
} as const;

export function installWallFake(fake: FakeHass): void {
  const now = Date.now();
  const entry = (entityId: string) => ({entity_id: entityId, device_id: 'device-ipad', platform: 'mobile_app'});
  fake.addEntities([
    entity(WALL.brightness, '70', {friendly_name: 'iPad Kiosk brightness', unit_of_measurement: '%'}, now),
    entity(WALL.kiosk, 'on', {friendly_name: 'iPad Kiosk mode'}, now),
    entity(WALL.ssid, 'Hjemme', {friendly_name: 'iPad SSID'}, now),
  ], {[WALL.brightness]: entry(WALL.brightness), [WALL.kiosk]: entry(WALL.kiosk), [WALL.ssid]: entry(WALL.ssid)},
  {'device-ipad': {id: 'device-ipad', area_id: 'kokken', name: 'Køkken-iPad', model: 'iPad Air'}});
  fake.handle(`notify.${WALL.notify}`, data => {
    const level = (data.data as {level?: unknown} | undefined)?.level;
    if (data.message === 'kiosk_set_brightness' && typeof level === 'number') {
      setTimeout(() => {
        fake.patch(WALL.brightness, String(level));
      }, fake.confirmMs);
    }
    return {context: {id: 'notify'}};
  });
}

export const wallSettings = {autoDim: true, dayBrightness: null as number | null};

export function installWallService(fake: FakeHass): void {
  wallSettings.autoDim = true;
  wallSettings.dayBrightness = null;
  fake.handle('podvoice.wall', data => {
    if (typeof data.auto_dim === 'boolean') wallSettings.autoDim = data.auto_dim;
    if (typeof data.day_brightness === 'number') wallSettings.dayBrightness = data.day_brightness;
    const present = !!fake.hass.states[WALL.brightness];
    const kiosk = fake.hass.states[WALL.kiosk]?.state === 'on';
    return {response: {ok: true, auto_dim: wallSettings.autoDim, day_brightness: wallSettings.dayBrightness,
      night_brightness: 10, kiosk, dims_screen: present && kiosk,
      device: present ? {slug: 'ipad_kokken', device_id: 'device-ipad', name: 'Køkken-iPad', model: 'iPad Air',
        notify: WALL.notify, brightness: WALL.brightness, kiosk_mode: WALL.kiosk, source: 'user'} : null}};
  });
}
