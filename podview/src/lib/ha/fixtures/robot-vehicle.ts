// Fake HA services and entities for Robot and Bil (installed by createFakeHass): a Roborock-like vacuum and a Tesla
// Fleet car, and the PodVoice integration's podvoice.robot_* / podvoice.vehicle_* services with the same rules as
// custom_components/podvoice/robot_control.py and vehicle_control.py (transport table, lock and the climate controls
// but climate on direct, a confirmation token for unlock, the trunk and climate on, overrides for earlier unresolved
// access or trunk requests).
// The HA entity shows the effect a little later, unless the fake is silent.
import type {FakeHass} from '../ha-fixture';
import {entity} from '../ha-fixture';

const VACUUM = 'vacuum.qrevo';
const FEATURES = 4 | 8 | 16 | 8192;
// The car's charge cable and how current its read is: test knobs of the fake (patched like any entity).
const CHARGE = 'sensor.model_y_charging';
const FLEET = 'sensor.model_y_fleet_status';
const CAR = {
  locked: 'lock.model_y_lock',
  climate: 'climate.model_y_climate',
  defrost: 'switch.model_y_defrost',
  driverSeat: 'select.model_y_seat_heater_left',
  passengerSeat: 'select.model_y_seat_heater_right',
  trunk: 'cover.model_y_trunk',
};
const SEATS = ['off', 'low', 'medium', 'high'];
const EFFECT_MS = 60;

// action -> feature bit, the states that admit it, the state it leads to.
const TRANSPORT: Record<string, [number, string[], string]> = {
  resume: [8192, ['paused'], 'cleaning'],
  pause: [4, ['cleaning'], 'paused'],
  stop: [8, ['cleaning', 'paused', 'returning'], 'idle'],
  return: [16, ['cleaning', 'paused', 'idle'], 'returning'],
};
// action -> role, risk family, desired effect ('value' = from the arguments).
const ACTIONS: Record<string, [keyof typeof CAR, string, string]> = {
  lock: ['locked', 'access', 'locked'],
  unlock: ['locked', 'access', 'unlocked'],
  climateOn: ['climate', 'climate', 'on'],
  climateOff: ['climate', 'climate', 'off'],
  temperature: ['climate', 'temperature', 'value'],
  defrostOn: ['defrost', 'defrost', 'on'],
  defrostOff: ['defrost', 'defrost', 'off'],
  driverSeatHeat: ['driverSeat', 'driverSeat', 'value'],
  passengerSeatHeat: ['passengerSeat', 'passengerSeat', 'value'],
  rearTrunkToggle: ['trunk', 'trunk', 'actuate'],
};
const LABELS: Record<string, string> = {
  lock: 'Lås bilen',
  unlock: 'Lås op',
  climateOn: 'Tænd klima',
  climateOff: 'Sluk klima',
  temperature: 'Indstil temperatur',
  defrostOn: 'Tænd afrimning',
  defrostOff: 'Sluk afrimning',
  driverSeatHeat: 'Indstil førersæde',
  passengerSeatHeat: 'Indstil passagersæde',
};

interface Offer {
  action: string;
  args: string;
  effects: [string, string][];
  override: boolean;
  expiresAt: number;
}

export interface RobotVehicleFake {
  robot: boolean;
  vehicle: boolean;
  // A second vacuum / car in HA (the screens' segmented choice).
  secondRobot: boolean;
  secondCar: boolean;
  // The integration's journal of starts, newest last (podvoice.robot_cleaning_state's journal).
  journal: FakeJournal[];
  // The add-on's journal read: 'observed' or the honest addon_unavailable.
  addon: 'observed' | 'addon_unavailable';
  // The car's recorded changes (podvoice.vehicle_history); null: no recorder.
  history: {at: number; field: string; value: string}[] | null;
  // Every confirmed vehicle_command answer from now on (an integration error or an answer that never came).
  vehicleOutcome: null | {outcome: 'rejected' | 'unknown'; reason?: string; vehicleError?: string};
  unresolved: Record<string, string[]>;
  offers: Map<string, Offer>;
}

export interface FakeJournal {
  id: string;
  source: 'panel' | 'addon';
  recordedAt: number;
  outcome: 'accepted' | 'unknown';
  mapName: string;
  areaIds: string[];
  repeat: number;
  settings: Record<string, string>;
}

const controls = new WeakMap<FakeHass, RobotVehicleFake>();

// The Roborock-like robot's cleaning settings and floors (robot_cleaning.py reads the same from HA).
const SECOND_VACUUM = 'vacuum.s8';
const SELECTS = {
  cleaning_mode: 'select.qrevo_cleaning_mode',
  mop_intensity: 'select.qrevo_mop_intensity',
  mop_mode: 'select.qrevo_mop_mode',
  map: 'select.qrevo_selected_map',
} as const;
const OPTIONS: Record<string, string[]> = {
  cleaning_mode: ['vacuum', 'mop', 'vac_and_mop'],
  mop_intensity: ['off', 'mild', 'moderate', 'intense'],
  mop_mode: ['standard', 'deep', 'deep_plus', 'fast'],
  suction: ['quiet', 'balanced', 'turbo', 'max'],
  map: ['Stueplan', '1. sal'],
};
const FLOORS: Record<string, {id: string; name: string}[]> = {
  Stueplan: [
    {id: 'entre', name: 'Entré'},
    {id: 'kokken', name: 'Køkkenalrum'},
    {id: 'stue', name: 'Stue'},
  ],
  '1. sal': [{id: 'kontor', name: 'Kontor'}],
};
const READY = ['idle', 'docked'];
const revisionOf = (map: string) => (map === 'Stueplan' ? 'a' : 'b').repeat(64);

// The fake's switches for one createFakeHass (tests take the robot or the car away, or set the integration's answer).
export function robotVehicleFake(fake: FakeHass): RobotVehicleFake {
  const found = controls.get(fake);
  if (!found) throw new Error('robot-vehicle fake not installed');
  return found;
}

export function installRobotVehicleFake(fake: FakeHass): void {
  const state: RobotVehicleFake = {
    robot: true,
    vehicle: true,
    vehicleOutcome: null,
    unresolved: {access: [], climate: []},
    offers: new Map(),
    secondRobot: false,
    secondCar: false,
    journal: [
      {
        id: '1'.repeat(32),
        source: 'addon',
        recordedAt: Date.now() / 1000 - 3600,
        outcome: 'accepted',
        mapName: 'Stueplan',
        areaIds: ['kokken', 'stue'],
        repeat: 2,
        settings: {cleaning_mode: 'vacuum', suction: 'turbo'},
      },
    ],
    addon: 'observed',
    history: [],
  };
  controls.set(fake, state);
  let serial = 0;
  const at = Date.now();
  const ids = [VACUUM, ...Object.values(CAR)];
  fake.addEntities(
    [
      entity(VACUUM, 'docked', {friendly_name: 'Qrevo', supported_features: FEATURES,
        fan_speed: 'balanced', fan_speed_list: OPTIONS.suction}, at),
      entity(SECOND_VACUUM, 'docked', {friendly_name: 'S8', supported_features: FEATURES}, at),
      entity(SELECTS.cleaning_mode, 'vac_and_mop', {options: OPTIONS.cleaning_mode}, at),
      entity(SELECTS.mop_intensity, 'moderate', {options: OPTIONS.mop_intensity}, at),
      entity(SELECTS.mop_mode, 'standard', {options: OPTIONS.mop_mode}, at),
      entity(SELECTS.map, 'Stueplan', {options: OPTIONS.map}, at),
      entity(CAR.locked, 'locked', {friendly_name: 'Model Y Lås'}, at),
      entity(CAR.climate, 'off', {friendly_name: 'Model Y Klima', hvac_modes: ['off', 'heat_cool'],
        supported_features: 1 | 128 | 256, min_temp: 15, max_temp: 28, temperature: 21}, at),
      entity(CAR.defrost, 'off', {friendly_name: 'Model Y Afrimning'}, at),
      entity(CAR.driverSeat, 'off', {options: SEATS}, at),
      entity(CAR.passengerSeat, 'off', {options: SEATS}, at),
      entity(CAR.trunk, 'closed', {supported_features: 3}, at),
      entity(CHARGE, 'disconnected', {}, at),
      entity(FLEET, 'observed', {}, at),
    ],
    Object.fromEntries(
      ids.map(id => [
        id,
        id === VACUUM
          ? {entity_id: id, device_id: 'device-robot', platform: 'roborock'}
          : {entity_id: id, device_id: 'device-car', platform: 'tesla_fleet'},
      ]),
    ),
    {'device-robot': {id: 'device-robot', name: 'Qrevo'}, 'device-car': {id: 'device-car', name: 'Model Y'}},
  );
  const now = () => Date.now() / 1000;
  const current = (id: string) => fake.hass.states[id];
  const effect = (id: string, value: string | null, attributes: Record<string, unknown> = {}) => {
    if (fake.mode === 'silent') return;
    setTimeout(() => {
      fake.patch(id, value, attributes);
    }, EFFECT_MS);
  };

  // Pushed like the integration's panel_live.py: at subscribe, after each HA change and each service answer.
  fake.subscribers.set('podvoice/robot_subscribe', () => fake.answer('podvoice.robot_panel_state'));
  fake.subscribers.set('podvoice/vehicle_subscribe', () => fake.answer('podvoice.vehicle_panel_state'));
  fake.pushOnChange.add('podvoice/robot_subscribe');
  fake.pushOnChange.add('podvoice/vehicle_subscribe');

  const latestStart = () => [...state.journal].reverse().find(item => item.outcome === 'accepted');
  fake.handle('podvoice.robot_panel_state', () => {
    const vacuum = current(VACUUM);
    if (!state.robot || !vacuum) return {response: {schema: 'podvoice.robot_panel.v1', robots: []}};
    const features = Number(vacuum.attributes.supported_features);
    const cleaning = vacuum.state === 'cleaning';
    const second = current(SECOND_VACUUM);
    const extra =
      state.secondRobot && second
        ? [
            {
              entityId: SECOND_VACUUM,
              name: 'S8',
              state: second.state,
              observedAt: Date.parse(second.last_updated) / 1000,
              supportedFeatures: FEATURES,
              actions: [],
              telemetry: [{key: 'battery', value: 64, unit: '%', updatedAt: now() - 10, stale: false}],
            },
          ]
        : [];
    return {
      response: {
        schema: 'podvoice.robot_panel.v1',
        robots: [
          {
            entityId: VACUUM,
            name: 'Qrevo',
            state: vacuum.state,
            observedAt: Date.parse(vacuum.last_updated) / 1000,
            supportedFeatures: features,
            actions: Object.entries(TRANSPORT)
              .filter(([, [bit, states]]) => (features & bit) !== 0 && states.includes(vacuum.state))
              .map(([action]) => action),
            telemetry: [
              {key: 'battery', value: 87, unit: '%', updatedAt: now() - 10, stale: false},
              {key: 'cleaning_area', value: 12.5, unit: 'm²', updatedAt: now() - 5, stale: false},
              {key: 'cleaning_time', value: 600, unit: 's', updatedAt: now() - 5, stale: false},
              {key: 'last_clean_end', value: now() - 7200, unit: null, updatedAt: now() - 7200, stale: false},
              // The robot's consumable counters (A-Robot »Vedligehold«).
              {key: 'main_brush_time_left', value: 142, unit: 'h', updatedAt: now() - 60, stale: false},
              {key: 'side_brush_time_left', value: 64, unit: 'h', updatedAt: now() - 60, stale: false},
              {key: 'filter_time_left', value: 12, unit: 'h', updatedAt: now() - 60, stale: false},
              {key: 'sensor_time_left', value: 2, unit: 'h', updatedAt: now() - 60, stale: false},
              ...(cleaning
                ? [
                    {key: 'current_room', value: 'Køkken', unit: null, updatedAt: now() - 5, stale: false},
                    {key: 'clean_percent', value: 38, unit: '%', updatedAt: now() - 5, stale: false},
                  ]
                : []),
            ],
            // The Roborock cache's job while it works: the newest confirmed start's rooms and repeat.
            ...(['cleaning', 'paused', 'returning'].includes(vacuum.state) && latestStart()
              ? {job: {scope: 'selected', segmentIds: latestStart()?.areaIds.map((_, index) => 16 + index) ?? [],
                roomIds: latestStart()?.areaIds.map((_, index) => 16 + index) ?? [], repeat: latestStart()?.repeat ?? 1}}
              : {}),
          },
          ...extra,
        ],
      },
    };
  });

  fake.handle('podvoice.robot_command', data => {
    const vacuum = current(VACUUM);
    const rule = TRANSPORT[String(data.action)];
    if (!state.robot || !vacuum || !rule) return {response: {outcome: 'rejected', reason: 'state_unavailable'}};
    if (vacuum.state !== data.expected_state || vacuum.attributes.supported_features !== data.expected_features)
      return {response: {outcome: 'rejected', reason: 'changed_observation'}};
    const [bit, states, next] = rule;
    if ((FEATURES & bit) === 0 || !states.includes(vacuum.state))
      return {response: {outcome: 'rejected', reason: 'unsupported_action'}};
    effect(VACUUM, next);
    return {response: {outcome: 'accepted'}};
  });

  // ---- Rooms, settings, recipes and the journal (robot_cleaning.py's rules) ------------------------------------

  const settingRows = (entityId: string) => {
    if (entityId !== VACUUM) return [];
    const vacuum = current(VACUUM);
    const rows = (['cleaning_mode', 'mop_intensity', 'mop_mode'] as const).map(key => ({
      key,
      entityId: SELECTS[key],
      options: OPTIONS[key] ?? [],
      current: current(SELECTS[key])?.state ?? null,
    }));
    return [
      ...rows,
      {key: 'suction', entityId: VACUUM, options: OPTIONS.suction ?? [],
        current: typeof vacuum?.attributes.fan_speed === 'string' ? vacuum.attributes.fan_speed : null},
      {key: 'map', entityId: SELECTS.map, options: OPTIONS.map ?? [], current: current(SELECTS.map)?.state ?? null},
    ];
  };
  const floor = () => current(SELECTS.map)?.state ?? 'Stueplan';
  const blocked = () => state.journal.some(item => item.outcome === 'unknown' && item.source === 'panel');
  const journalItems = (entityId: string) => {
    if (entityId !== VACUUM) return [];
    const rooms = FLOORS[floor()] ?? [];
    return [...state.journal]
      .filter(item => state.addon === 'observed' || item.source === 'panel')
      .reverse()
      .map(item => ({
        ...item,
        acceptedAt: item.outcome === 'accepted' ? item.recordedAt + 1 : null,
        areaNames: item.areaIds.map(id => rooms.find(room => room.id === id)?.name ?? null),
        reusable:
          item.outcome === 'accepted' &&
          item.mapName === floor() &&
          item.areaIds.every(id => rooms.some(room => room.id === id)) &&
          Object.entries(item.settings).every(([key, value]) => (OPTIONS[key] ?? []).includes(value)),
      }));
  };

  fake.handle('podvoice.robot_cleaning_state', data => {
    const entityId = String(data.entity_id);
    const vacuum = current(entityId);
    if (!state.robot || !vacuum) return {response: {schema: 'podvoice.robot_cleaning.v1', entityId, status: 'unknown'}};
    const own = entityId === VACUUM;
    return {
      response: {
        schema: 'podvoice.robot_cleaning.v1',
        entityId,
        status: 'observed',
        state: vacuum.state,
        revision: own ? revisionOf(floor()) : 'c'.repeat(64),
        mapName: own ? floor() : null,
        rooms: own ? FLOORS[floor()] : [],
        repeat: {min: 1, max: own ? 3 : 1},
        settings: settingRows(entityId),
        startable: own,
        reason: own ? null : 'area_mapping_not_configured',
        blocked: own && blocked(),
        journal: {status: 'observed', addon: state.addon, items: journalItems(entityId)},
      },
    };
  });

  fake.handle('podvoice.robot_setting', data => {
    const vacuum = current(String(data.entity_id));
    const row = settingRows(String(data.entity_id)).find(item => item.key === data.key);
    if (!state.robot || !vacuum) return {response: {outcome: 'rejected', reason: 'state_unavailable'}};
    if (!row || row.entityId !== data.setting_entity_id || !row.options.includes(String(data.value)))
      return {response: {outcome: 'rejected', reason: 'unsupported_setting'}};
    if (row.key === 'map' && !READY.includes(vacuum.state))
      return {response: {outcome: 'rejected', reason: 'not_ready'}};
    if ((data.expected_current ?? null) !== row.current)
      return {response: {outcome: 'rejected', reason: 'changed_observation'}};
    if (row.key === 'suction') effect(VACUUM, null, {fan_speed: data.value});
    else effect(row.entityId, String(data.value));
    return {response: {outcome: 'accepted'}};
  });

  fake.handle('podvoice.robot_start', data => {
    const vacuum = current(String(data.entity_id));
    const reject = (reason: string) => ({response: {outcome: 'rejected', reason}});
    if (!state.robot || !vacuum || data.entity_id !== VACUUM) return reject('state_unavailable');
    if (vacuum.state !== data.expected_state) return reject('changed_observation');
    if (!READY.includes(vacuum.state)) return reject('not_ready');
    if (data.revision !== revisionOf(floor())) return reject('changed_observation');
    const rooms = FLOORS[floor()] ?? [];
    const areaIds = data.area_ids as string[];
    if (!areaIds.every(id => rooms.some(room => room.id === id))) return reject('unknown_room');
    const repeat = Number(data.repeat ?? 1);
    if (repeat < 1 || repeat > 3) return reject('unsupported_repeat');
    const chosen = (data.settings ?? {}) as Record<string, string>;
    if (!Object.entries(chosen).every(([key, value]) => key !== 'map' && (OPTIONS[key] ?? []).includes(value)))
      return reject('unsupported_setting');
    if (blocked()) return reject('previous_unknown');
    if (typeof data.recipe_id === 'string') {
      const recipe = journalItems(VACUUM).find(item => item.id === data.recipe_id);
      if (
        !recipe?.reusable ||
        JSON.stringify(recipe.areaIds) !== JSON.stringify(areaIds) ||
        recipe.repeat !== repeat ||
        JSON.stringify(Object.entries(recipe.settings).sort()) !== JSON.stringify(Object.entries(chosen).sort())
      )
        return reject('recipe_changed');
    }
    for (const [key, value] of Object.entries(chosen)) {
      if (key === 'suction') fake.patch(VACUUM, null, {fan_speed: value});
      else fake.patch(SELECTS[key as keyof typeof SELECTS], value);
    }
    serial += 1;
    state.journal.push({
      id: String(serial).padStart(32, 'f'),
      source: 'panel',
      recordedAt: now(),
      outcome: fake.mode === 'silent' ? 'unknown' : 'accepted',
      mapName: floor(),
      areaIds,
      repeat,
      settings: chosen,
    });
    effect(VACUUM, 'cleaning');
    return {response: {outcome: 'accepted'}};
  });

  const seat = (id: string) => {
    const value = current(id)?.state;
    return value && SEATS.includes(value) ? {value} : {};
  };
  const carData = () => {
    const lock = current(CAR.locked)?.state;
    const climate = current(CAR.climate);
    const trunk = current(CAR.trunk)?.state;
    return {
      batteryPercent: 71,
      rangeKm: 320.4,
      ...(lock === 'locked' || lock === 'unlocked' ? {locked: lock === 'locked'} : {}),
      ...(trunk === 'open' || trunk === 'closed' ? {trunk} : {}),
      charging: current(CHARGE)?.state === 'charging'
        ? {status: 'charging', powerKw: 11, endsAt: now() + 2 * 3600}
        : {status: current(CHARGE)?.state ?? 'disconnected'},
      climate: {
        ...(climate?.state === 'off' || climate?.state === 'heat_cool' ? {status: climate.state} : {}),
        temperatureC: 9.5,
        targetTemperatureC: climate?.attributes.temperature,
        defrost: current(CAR.defrost)?.state === 'on',
        ...(seat(CAR.driverSeat).value ? {driverSeatHeat: seat(CAR.driverSeat).value} : {}),
        ...(seat(CAR.passengerSeat).value ? {passengerSeatHeat: seat(CAR.passengerSeat).value} : {}),
      },
    };
  };

  fake.handle('podvoice.vehicle_panel_state', () => {
    if (!state.vehicle) return {response: {schema: 'podvoice.vehicle_panel.v1', vehicles: []}};
    const second = state.secondCar
      ? [
          {
            deviceId: 'device-car-2',
            name: 'Model 3',
            modelName: 'Model 3',
            status: 'observed',
            observedAt: now() - 120,
            entities: {},
            controls: [],
            data: {batteryPercent: 44, rangeKm: 210, locked: true, charging: {status: 'charging', powerKw: 11}},
            fieldObservedAt: {},
            connection: {state: 'online', since: null},
            risk: {revision: 0, unresolved: {access: [], climate: []}, pending: false},
          },
        ]
      : [];
    return {
      response: {
        schema: 'podvoice.vehicle_panel.v1',
        vehicles: [
          ...second,
          {
            deviceId: 'device-car',
            name: 'Model Y',
            modelName: 'Model Y',
            status: current(FLEET)?.state === 'stale' ? 'stale' : 'observed',
            observedAt: current(FLEET)?.state === 'stale' ? now() - 7200 : now() - 60,
            entities: {...CAR, batteryPercent: 'sensor.model_y_battery_level'},
            controls: Object.keys(ACTIONS).sort(),
            data: carData(),
            fieldObservedAt: {},
            connection: {state: 'asleep', since: null},
            temperatureRange: {min: 15, max: 28, step: 0.5},
            risk: {revision: 0, unresolved: state.unresolved, pending: false},
          },
        ],
      },
    };
  });

  fake.handle('podvoice.vehicle_history', data => {
    if (!state.vehicle || !['device-car', 'device-car-2'].includes(String(data.device_id)))
      return {response: {status: 'unknown', items: []}};
    if (state.history === null) return {response: {status: 'unavailable', items: []}};
    return {response: {status: 'observed', items: [...state.history].sort((a, b) => b.at - a.at)}};
  });

  const remember = (family: string, desired: string) => {
    const known = new Set([...(state.unresolved[family] ?? []), desired]);
    state.unresolved = {...state.unresolved, [family]: [...known].sort()};
  };
  const execute = (action: string, args: Record<string, unknown>, effects: [string, string][]) => {
    const answer = {retryAllowed: false, physicalResultVerified: false};
    if (state.vehicleOutcome) {
      if (state.vehicleOutcome.outcome === 'unknown') {
        for (const [family, desired] of effects) remember(family, desired);
      }
      return {response: {...answer, ...state.vehicleOutcome}};
    }
    for (const [family, desired] of effects) remember(family, desired);
    const id = CAR[ACTIONS[action]?.[0] ?? 'locked'];
    const next: Record<string, string | null> = {
      lock: 'locked',
      unlock: 'unlocked',
      climateOn: 'heat_cool',
      climateOff: 'off',
      defrostOn: 'on',
      defrostOff: 'off',
      rearTrunkToggle: args.direction === 'open' ? 'open' : 'closed',
      temperature: null,
    };
    if (action === 'temperature') effect(id, null, {temperature: args.temperature});
    else effect(id, next[action] ?? String(args.option));
    return {response: {...answer, outcome: 'accepted'}};
  };

  fake.handle('podvoice.vehicle_command', data => {
    const action = String(data.action);
    const args = (data.args ?? {}) as Record<string, unknown>;
    const token = typeof data.confirmation === 'string' ? data.confirmation : '';
    const rejected = (reason: string) => ({
      response: {outcome: 'rejected', reason, retryAllowed: false, physicalResultVerified: false},
    });
    const rule = ACTIONS[action];
    if (!state.vehicle || !rule) return rejected('vehicle_unavailable');
    if (token) {
      const offer = state.offers.get(token);
      state.offers.delete(token);
      if (offer?.action !== action || offer.args !== JSON.stringify(args)) return rejected('confirmation_unknown');
      if (now() > offer.expiresAt) return rejected('confirmation_expired');
      if (data.acknowledge_prior_unresolved !== offer.override) return rejected('acknowledgement_required');
      return execute(action, args, offer.effects);
    }
    const [, family, fixed] = rule;
    const desired = fixed === 'value' ? String(args.temperature ?? args.option) : fixed;
    const effects: [string, string][] = [[family, desired]];
    if (action.endsWith('SeatHeat') && desired !== 'off') effects.push(['climate', 'on']);
    if (action === 'defrostOn') effects.push(['climate', 'on']);
    if (action === 'defrostOff') effects.push(['climate', 'on'], ['climate', 'off']);
    const override = effects.some(
      ([name, value]) =>
        (name === 'access' || name === 'trunk') &&
        ((state.unresolved[name] ?? []).some(item => item !== value) || (name === 'trunk' &&
          !!state.unresolved[name]?.length)),
    );
    if (!['unlock', 'rearTrunkToggle', 'climateOn'].includes(action) && !override) return execute(action, args, effects);
    serial += 1;
    const tokenId = String(serial).padStart(32, '0');
    const expiresAt = now() + 15;
    state.offers.set(tokenId, {action, args: JSON.stringify(args), effects, override, expiresAt});
    const label =
      action === 'rearTrunkToggle' ? (args.direction === 'open' ? 'Åbn bagagerum' : 'Luk bagagerum') : LABELS[action];
    return {
      response: {
        outcome: 'confirmation_required',
        confirmation: {
          token: tokenId,
          expiresAt,
          action,
          label,
          args,
          effects,
          requiresConfirmation: true,
          nativeWakePossible: true,
          priorUnresolved: state.unresolved,
          riskRevision: 0,
          requiresOverride: override,
        },
      },
    };
  });
}
