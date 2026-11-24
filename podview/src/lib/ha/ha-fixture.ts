// A fake Home Assistant `hass` for tests and the browser journey (tests/browser/ha_panel_actual_e2e.cjs bundles
// this file): two areas with lights and a PodConnect player, a weather entity with forecasts, and the PodVoice
// timer bridge. Like HA, every change hands out a new `hass` whose unchanged entity states keep their identity.
// Calls are recorded; `mode` makes HA confirm after a delay, never show the effect, or refuse. Like
// home-assistant-js-websocket, a call while disconnected throws the bare number 3 (ERR_CONNECTION_LOST) unsent.
// Websocket commands (callWS) and subscriptions (connection.subscribeMessage) cover the timer bridge's push, the
// forecast subscription and the panel's reports and heartbeats.
import {installAddonFake} from './fixtures/addon';
import {installRecipesFake} from './fixtures/recipes';
export {addonAnswers} from './fixtures/addon';
import {installMusicFake} from './fixtures/music';
import {installRobotVehicleFake} from './fixtures/robot-vehicle';
import type {Hass, HassEntityState} from './hass';

export type FakeMode = 'confirm' | 'silent' | 'refuse' | 'drop';

export interface FakeCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
  entityId: string | undefined;
  at: number;
}

interface FakeTimer {
  id: string;
  name: string;
  seconds: number;
  startedAt: number;
  revision: number;
}

const iso = (at: number) => new Date(at).toISOString();

export function entity(
  entityId: string, state: string, attributes: Record<string, unknown>, at: number,
): HassEntityState {
  return {entity_id: entityId, state, attributes, last_changed: iso(at), last_updated: iso(at)};
}

const PLAYLIST = [
  {title: 'Holocene', artist: 'Bon Iver'},
  {title: 'Re: Stacks', artist: 'Bon Iver'},
  {title: 'Skinny Love', artist: 'Bon Iver'},
];

export function initialStates(now = Date.now()): Record<string, HassEntityState> {
  const states: HassEntityState[] = [
    entity('light.kokken_loft', 'on', {friendly_name: 'Køkken loft', brightness: 128,
      supported_color_modes: ['brightness'], color_mode: 'brightness'}, now),
    entity('light.kokken_o', 'off', {friendly_name: 'Køkkenø', supported_color_modes: ['onoff']}, now),
    entity('light.stue_lampe', 'on', {friendly_name: 'Stuelampe', brightness: 255,
      supported_color_modes: ['color_temp']}, now),
    entity('media_player.kokkenalrum', 'playing', {
      friendly_name: 'Køkkenalrum', media_title: PLAYLIST[0]?.title, media_artist: PLAYLIST[0]?.artist,
      media_content_id: 'spotify:track:0', volume_level: 0.3, supported_features: 1 | 4 | 16 | 32 | 16384,
    }, now),
    entity('media_player.stue', 'paused', {friendly_name: 'Stue', volume_level: 0.2,
      supported_features: 1 | 4 | 16 | 32 | 16384}, now),
    entity('media_player.spotify_fam', 'playing', {friendly_name: 'Spotify', supported_features: 1}, now),
    entity('weather.forecast_hjem', 'partlycloudy', {friendly_name: 'Forecast Hjem', temperature: 7.4,
      temperature_unit: '°C', precipitation_unit: 'mm', wind_speed_unit: 'km/h', supported_features: 3}, now),
  ];
  return Object.fromEntries(states.map(state => [state.entity_id, state]));
}

// HA keeps its registries' identity until they change; only states change here.
const REGISTRIES: Required<Pick<Hass, 'areas' | 'devices' | 'entities'>> = {
  areas: {
    kokken: {area_id: 'kokken', name: 'Køkkenalrum'},
    stue: {area_id: 'stue', name: 'Stue'},
    kontor: {area_id: 'kontor', name: 'Kontor'},
  },
  devices: {
    'device-kokken': {id: 'device-kokken', area_id: 'kokken', name: 'Voice PE'},
    'device-loft': {id: 'device-loft', area_id: 'kokken', name: 'Loft'},
  },
  entities: {
    'light.kokken_loft': {entity_id: 'light.kokken_loft', device_id: 'device-loft', platform: 'hue'},
    'light.kokken_o': {entity_id: 'light.kokken_o', area_id: 'kokken', platform: 'hue'},
    'light.stue_lampe': {entity_id: 'light.stue_lampe', area_id: 'stue', platform: 'hue'},
    'media_player.kokkenalrum': {entity_id: 'media_player.kokkenalrum', area_id: 'kokken', platform: 'podconnect'},
    'media_player.stue': {entity_id: 'media_player.stue', area_id: 'stue', platform: 'podconnect'},
    'media_player.spotify_fam': {entity_id: 'media_player.spotify_fam', area_id: 'stue', platform: 'spotify'},
    'weather.forecast_hjem': {entity_id: 'weather.forecast_hjem', platform: 'met'},
  },
};

// A screen's own fake service (robot, vehicle, PodConnect, the PodVoice bridge): return undefined to fall through.
export type FakeHandler = (
  data: Record<string, unknown>, entityId: string | undefined, returnResponse: boolean,
) => unknown;

export function createFakeHass({
  onChange,
  confirmMs = 120,
  now = () => Date.now(),
}: {onChange?: (hass: Hass) => void; confirmMs?: number; now?: () => number} = {}) {
  let states = initialStates(now());
  const calls: FakeCall[] = [];
  const timers = new Map<string, FakeTimer>();
  let serial = 0;
  let track = 0;
  const fake = {mode: 'confirm' as FakeMode, connected: true, calls, hass: null as unknown as Hass,
    ws: [] as Record<string, unknown>[], subscriptions: new Map<number, {message: Record<string, unknown>;
      push: (message: unknown) => void}>(),
    // A fixture's own websocket subscription (fixtures/addon.ts, fixtures/music.ts): its first push for a message.
    subscribers: new Map<string, (message: Record<string, unknown>) => unknown>(),
    // Subscriptions pushed again after every change of HA's state and every PodVoice service answer, as the
    // integration's panel_live.py does (podvoice/robot_subscribe, podvoice/vehicle_subscribe).
    pushOnChange: new Set<string>(),
    // Push again to every open subscription of one type (a test changing what HA would send).
    pushAll(type: string) {
      const first = fake.subscribers.get(type);
      if (!first) return;
      for (const {message, push} of fake.subscriptions.values()) if (message.type === type) push(first(message));
    }};
  let subscriptionId = 0;
  const pushTimers = () => {
    for (const {message, push} of fake.subscriptions.values())
      if (message.type === 'podvoice/timer_subscribe') push(bridgeStatus());
  };
  // The bridge's snapshot: a test's own podvoice.timer_status handler (its rows), else the fake's timers.
  const bridgeStatus = (): unknown => {
    const own = handlers.get('podvoice.timer_status')?.({endpoint: 'kokken'}, undefined, true) as
      {response?: unknown} | undefined;
    return own?.response ?? timerStatus();
  };
  const handlers = new Map<string, FakeHandler>();
  let registries = REGISTRIES;

  const publish = () => {
    fake.hass = make();
    onChange?.(fake.hass);
    for (const type of fake.pushOnChange) fake.pushAll(type);
  };
  const patch = (entityId: string, state: string | null, attributes: Record<string, unknown> = {}) => {
    const old = states[entityId];
    if (!old) return;
    const at = now();
    states = {
      ...states,
      [entityId]: {...old, state: state ?? old.state, attributes: {...old.attributes, ...attributes},
        last_changed: state && state !== old.state ? iso(at) : old.last_changed, last_updated: iso(at)},
    };
    publish();
  };
  const later = (effect: () => void) => {
    if (fake.mode === 'silent' || fake.mode === 'drop') return;
    setTimeout(effect, confirmMs);
  };

  const timerStatus = () => ({
    epoch: 'e'.repeat(32), owner: 'home_assistant_intent', ok: true, contract: 'podvoice_native_timers_v1',
    endpoint: 'kokken', binding: {device_id: 'device-kokken'},
    timers: [...timers.values()].map(timer => ({
      id: timer.id, name: timer.name,
      seconds_left: Math.max(0, timer.seconds - Math.floor((now() - timer.startedAt) / 1000)),
      state: 'active', duration_seconds: timer.seconds, revision: String(timer.revision),
    })),
    finished: [], recent: [],
  });

  async function callService(
    domain: string, service: string, data: Record<string, unknown> = {}, target?: {entity_id?: string | string[]},
    _notify?: boolean, returnResponse?: boolean,
  ): Promise<unknown> {
    const entityId = typeof target?.entity_id === 'string' ? target.entity_id : undefined;
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the library throws the bare code
    if (!fake.connected) throw 3;
    calls.push({domain, service, data, entityId, at: now()});
    if (fake.mode === 'refuse') throw Object.assign(new Error('Service not allowed'), {code: 'not_allowed'});
    if (fake.mode === 'drop' && domain !== 'weather' && service !== 'timer_status')
      return new Promise(() => undefined);
    const handler = handlers.get(`${domain}.${service}`);
    if (handler) {
      const answer = await handler(data, entityId, returnResponse === true);
      // Like the bridge: a timer command is pushed to subscribers before its answer.
      if (answer !== undefined && domain === 'podvoice' && service === 'timer_command_v2') pushTimers();
      if (answer !== undefined && domain === 'podvoice') for (const type of fake.pushOnChange) fake.pushAll(type);
      if (answer !== undefined) return answer;
    }
    if (domain === 'light' && entityId) {
      if (service === 'turn_off') later(() => { patch(entityId, 'off', {brightness: null}); });
      else {
        const pct = typeof data.brightness_pct === 'number' ? data.brightness_pct : null;
        later(() => { patch(entityId, 'on', pct === null ? {} : {brightness: Math.round((pct / 100) * 255)}); });
      }
      return {context: {id: String(++serial)}};
    }
    if (domain === 'media_player' && entityId) {
      if (service === 'media_play') later(() => { patch(entityId, 'playing'); });
      if (service === 'media_pause') later(() => { patch(entityId, 'paused'); });
      if (service === 'volume_set') later(() => { patch(entityId, null, {volume_level: data.volume_level}); });
      if (service === 'media_next_track' || service === 'media_previous_track') {
        track = (track + (service === 'media_next_track' ? 1 : PLAYLIST.length - 1)) % PLAYLIST.length;
        const next = PLAYLIST[track];
        later(() => {
          patch(entityId, null, {media_title: next?.title, media_artist: next?.artist,
            media_content_id: `spotify:track:${String(track)}`});
        });
      }
      return {context: {id: String(++serial)}};
    }
    if (domain === 'weather' && service === 'get_forecasts' && entityId && returnResponse) {
      const start = new Date(now());
      start.setMinutes(0, 0, 0);
      const hourly = data.type === 'hourly';
      const forecast = Array.from({length: hourly ? 24 : 7}, (_, index) => {
        const at = new Date(start.getTime() + (index + 1) * (hourly ? 3600_000 : 86_400_000));
        return {
          datetime: at.toISOString(), condition: index % 3 ? 'cloudy' : 'rainy', temperature: 6 + (index % 5),
          ...(hourly ? {} : {templow: 1 + (index % 3)}), precipitation: index % 3 ? 0 : 1.2,
          precipitation_probability: index % 3 ? 10 : 70, wind_speed: 14, wind_bearing: 240,
        };
      });
      return {context: {id: String(++serial)}, response: {[entityId]: {forecast}}};
    }
    if (domain === 'podvoice' && service === 'timer_status') return {response: timerStatus()};
    if (domain === 'podvoice' && service === 'timer_command_v2') {
      if (data.action === 'start') {
        const id = `t${String(++serial)}`;
        timers.set(id, {id, name: typeof data.name === 'string' ? data.name : '', seconds: Number(data.seconds),
          startedAt: now(), revision: serial});
        // Like the bridge: subscribers hear the change before the call's answer.
        pushTimers();
        return {response: {ok: true, id}};
      }
      if (data.action === 'cancel') {
        timers.delete(String(data.timer_id));
        pushTimers();
        return {response: {ok: true}};
      }
      if (data.action === 'adjust') {
        const timer = timers.get(String(data.timer_id));
        if (!timer) return {response: {ok: false, error: 'timer_not_found', outcome: 'rejected'}};
        timer.seconds += Number(data.delta_seconds);
        timer.revision = ++serial;
        pushTimers();
        return {response: {ok: true}};
      }
      return {response: {ok: false, error: 'unsupported_action'}};
    }
    throw Object.assign(new Error(`Service ${domain}.${service} not found`), {code: 'not_found'});
  }

  const forecast = (type: unknown) => {
    const start = new Date(now());
    start.setMinutes(0, 0, 0);
    const hourly = type === 'hourly';
    return Array.from({length: hourly ? 24 : 7}, (_, index) => {
      const at = new Date(start.getTime() + (index + 1) * (hourly ? 3600_000 : 86_400_000));
      return {
        datetime: at.toISOString(), condition: index % 3 ? 'cloudy' : 'rainy', temperature: 6 + (index % 5),
        ...(hourly ? {} : {templow: 1 + (index % 3)}), precipitation: index % 3 ? 0 : 1.2,
        precipitation_probability: index % 3 ? 10 : 70, wind_speed: 14, wind_bearing: 240,
      };
    });
  };

  // Answers arrive a moment later, as over a real socket.
  const answer = <T,>(value: T) => new Promise<T>(resolve => setTimeout(() => {
    resolve(value);
  }, 2));

  async function callWS(message: Record<string, unknown>): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the library throws the bare code
    if (!fake.connected) throw 3;
    fake.ws.push(message);
    if (message.type === 'podvoice/timer_read') return answer(bridgeStatus());
    if (message.type === 'podvoice/panel_report') return answer({logged: true});
    if (message.type === 'podvoice/panel_heartbeat') return answer({expected_bundle: null, stale: false});
    throw Object.assign(new Error('Unknown command.'), {code: 'unknown_command'});
  }

  async function subscribeMessage(push: (message: unknown) => void, message: Record<string, unknown>) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the library throws the bare code
    if (!fake.connected) throw 3;
    fake.ws.push(message);
    const id = ++subscriptionId;
    fake.subscriptions.set(id, {message, push});
    if (message.type === 'podvoice/timer_subscribe') setTimeout(() => {
      push(bridgeStatus());
    }, 2);
    else if (typeof message.type === 'string' && fake.subscribers.has(message.type)) {
      const first = fake.subscribers.get(message.type);
      setTimeout(() => {
        if (first && fake.subscriptions.has(id)) push(first(message));
      }, 2);
    } else if (message.type === 'weather/subscribe_forecast') setTimeout(() => {
      push({type: message.forecast_type, forecast: forecast(message.forecast_type)});
    }, 2);
    else {
      fake.subscriptions.delete(id);
      throw Object.assign(new Error('Unknown command.'), {code: 'unknown_command'});
    }
    return answer(() => {
      fake.subscriptions.delete(id);
    });
  }

  function make(): Hass {
    return {
      states,
      connected: fake.connected,
      language: 'da',
      areas: registries.areas,
      devices: registries.devices,
      entities: registries.entities,
      callService,
      callWS,
      connection: {subscribeMessage},
    };
  }

  fake.hass = make();
  const full = Object.assign(fake, {
    patch,
    publish,
    // Registers a fake service (`domain.service`); the handler sees each call after it is recorded.
    handle(name: string, handler: FakeHandler) {
      handlers.set(name, handler);
    },
    // What a registered fake service answers now (its `response`), without recording a call.
    answer(name: string, data: Record<string, unknown> = {}): unknown {
      const answered = handlers.get(name)?.(data, undefined, true) as {response?: unknown} | undefined;
      return answered?.response;
    },
    // Adds entities (and their registry entries) the way HA does when an integration loads: new registry objects.
    addEntities(
      added: HassEntityState[],
      entries: Record<string, NonNullable<Hass['entities']>[string]> = {},
      devices: Record<string, NonNullable<Hass['devices']>[string]> = {},
    ) {
      states = {...states, ...Object.fromEntries(added.map(state => [state.entity_id, state]))};
      registries = {
        areas: registries.areas,
        devices: {...registries.devices, ...devices},
        entities: {...registries.entities, ...entries},
      };
      publish();
    },
    setConnected(connected: boolean) {
      fake.connected = connected;
      publish();
    },
  });
  installMusicFake(full);
  installRobotVehicleFake(full);
  installAddonFake(full);
  installRecipesFake(full);
  return full;
}

export type FakeHass = ReturnType<typeof createFakeHass>;

export const FAKE_PANEL = {
  url_path: 'podview',
  config: {integration_version: '0.1.25', endpoints: [{endpoint: 'kokken', name: 'Køkken', device_id: 'device-kokken'}]},
};
