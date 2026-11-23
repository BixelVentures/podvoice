// Fake HA services and entities for Robot and Bil (installed by createFakeHass): a Roborock-like vacuum and a Tesla
// Fleet car, and the PodVoice integration's podvoice.robot_* / podvoice.vehicle_* services with the same rules as
// custom_components/podvoice/robot_control.py and vehicle_control.py (transport table, lock direct, a confirmation
// token for everything else, overrides for earlier unresolved requests). The HA entity shows the effect a little
// later, unless the fake is silent.
import type {FakeHass} from '../ha-fixture';
import {entity} from '../ha-fixture';

const VACUUM = 'vacuum.qrevo';
const FEATURES = 4 | 8 | 16 | 8192;
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
  // Every confirmed vehicle_command answer from now on (an integration error or an answer that never came).
  vehicleOutcome: null | {outcome: 'rejected' | 'unknown'; reason?: string; vehicleError?: string};
  unresolved: Record<string, string[]>;
  offers: Map<string, Offer>;
}

const controls = new WeakMap<FakeHass, RobotVehicleFake>();

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
  };
  controls.set(fake, state);
  let serial = 0;
  const at = Date.now();
  const ids = [VACUUM, ...Object.values(CAR)];
  fake.addEntities(
    [
      entity(VACUUM, 'docked', {friendly_name: 'Qrevo', supported_features: FEATURES}, at),
      entity(CAR.locked, 'locked', {friendly_name: 'Model Y Lås'}, at),
      entity(CAR.climate, 'off', {friendly_name: 'Model Y Klima', hvac_modes: ['off', 'heat_cool'],
        supported_features: 1 | 128 | 256, min_temp: 15, max_temp: 28, temperature: 21}, at),
      entity(CAR.defrost, 'off', {friendly_name: 'Model Y Afrimning'}, at),
      entity(CAR.driverSeat, 'off', {options: SEATS}, at),
      entity(CAR.passengerSeat, 'off', {options: SEATS}, at),
      entity(CAR.trunk, 'closed', {supported_features: 3}, at),
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

  fake.handle('podvoice.robot_panel_state', () => {
    const vacuum = current(VACUUM);
    if (!state.robot || !vacuum) return {response: {schema: 'podvoice.robot_panel.v1', robots: []}};
    const features = Number(vacuum.attributes.supported_features);
    const cleaning = vacuum.state === 'cleaning';
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
              ...(cleaning
                ? [
                    {key: 'current_room', value: 'Køkken', unit: null, updatedAt: now() - 5, stale: false},
                    {key: 'cleaning_area', value: 12.5, unit: 'm²', updatedAt: now() - 5, stale: false},
                  ]
                : []),
            ],
          },
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
      charging: {status: 'disconnected'},
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
    return {
      response: {
        schema: 'podvoice.vehicle_panel.v1',
        vehicles: [
          {
            deviceId: 'device-car',
            name: 'Model Y',
            status: 'observed',
            observedAt: now() - 60,
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
        (state.unresolved[name] ?? []).some(item => item !== value) ||
        (name === 'trunk' && !!state.unresolved[name]?.length),
    );
    if (action === 'lock' && !override) return execute(action, args, effects);
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
