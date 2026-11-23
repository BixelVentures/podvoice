// Bil's presentation model: what the vehicle screen, the Home card and the resource rail may say about the car.
// Tesla admits the closed passive HA observation (lib/api/vehicle.ts), never command authority; Spotify/player data
// and arbitrary live-shaped objects cannot supply vehicle state. The local fixture is an explicit example that never
// grants a household or remote action; its preview controls change only the fixture (vehiclePreviewAction).
import {isVehicleObservation} from '../../lib/api/vehicle';
import type {VehicleObservation} from '../../lib/api/vehicle';
import {updatedLabel, updatedWhen} from '../../lib/format/updated-label';

export const VEHICLE_ARTWORK = 'assets/vehicle-gray-model-y-2023.webp';

export interface FixtureSeats {
  driver: number;
  passenger: number;
}

export interface VehicleClimate {
  status: string | null;
  temperatureC?: number | null;
  targetTemperatureC?: number | null;
  minTemperatureC?: number | null;
  maxTemperatureC?: number | null;
  temperatureStepC?: number | null;
  defrost?: boolean | null;
  driverSeatHeat?: string | null;
  passengerSeatHeat?: string | null;
  seats?: FixtureSeats;
}

export interface VehicleCharging {
  status: string | null;
  powerKw?: number | null;
  endsAt?: number | null;
  limitPercent?: number;
}

export interface VehicleModel {
  kind: 'vehicle';
  mode: 'unconnected' | 'fixture' | 'observed';
  title: string;
  context: string;
  modelName?: string | null;
  modelYear?: number | null;
  status: string;
  shortStatus?: string;
  parked?: boolean | null;
  locked: boolean | null;
  batteryPercent: number | null;
  rangeKm: number | null;
  charging: VehicleCharging;
  climate: VehicleClimate;
  access?: {rearTrunk?: string | null};
  history: unknown[];
  source: string;
  actions: unknown[];
  revision?: number;
  controlsPreview?: boolean;
  fixtureCase?: 'charging' | 'parked';
  exampleOnly?: boolean;
  stale?: boolean;
  historicalFields?: string[];
  fieldObservedAt?: Record<string, number>;
  observedAt?: number;
  connectionState?: string | null;
  connectionSince?: number | null;
}

// A local fixture as the scene keeps it: any object; only an explicit {kind: 'vehicle', mode: 'fixture'} is one.
type Loose = Record<string, unknown> | null | undefined;
const get = (value: unknown, key: string): unknown =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const clock = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'});

export function unconnectedVehicleModel(): VehicleModel {
  return {
    kind: 'vehicle',
    mode: 'unconnected',
    title: 'Tesla',
    context: 'Bil',
    modelName: null,
    modelYear: null,
    status: 'Ikke forbundet',
    parked: null,
    locked: null,
    batteryPercent: null,
    rangeKm: null,
    charging: {status: null, powerKw: null},
    climate: {status: null, temperatureC: null},
    history: [],
    source: '',
    actions: [],
  };
}

// Explicit local fixture only. It never grants a household/remote action.
export function vehicleFixture({charging = false, now = Date.now(), controls = false} = {}): VehicleModel {
  return {
    ...unconnectedVehicleModel(),
    mode: 'fixture',
    revision: 1,
    controlsPreview: controls,
    access: {rearTrunk: 'closed'},
    fixtureCase: charging ? 'charging' : 'parked',
    exampleOnly: true,
    context: 'Model Y · 2023',
    modelName: 'Model Y',
    modelYear: 2023,
    connectionState: charging ? 'online' : 'asleep',
    status: charging ? 'Lader' : 'I dvale · Låst',
    parked: true,
    locked: true,
    batteryPercent: 72,
    rangeKm: 312,
    charging: {
      status: charging ? 'charging' : 'disconnected',
      powerKw: charging ? 11 : null,
      endsAt: charging ? Math.floor(now / 1000) + 2700 : null,
    },
    climate: {
      status: 'off',
      temperatureC: null,
      targetTemperatureC: 21,
      defrost: false,
      seats: {driver: 0, passenger: 0},
    },
    source: 'Lokalt eksempel',
  };
}

// Tesla's own state beside the lock, like the Tesla app: "Låst · I dvale siden 09.44" (overview: "Låst · I dvale").
// Offline is not sleep: "Ikke forbundet".
export function vehicleStatus(
  value: {connectionState?: string | null; connectionSince?: number | null; status: string},
  now = Date.now(),
  {short = false} = {},
): string {
  if (value.connectionState === 'offline') return 'Ikke forbundet';
  if (value.connectionState !== 'asleep') return value.status;
  const since = finite(value.connectionSince) ? updatedWhen(value.connectionSince * 1000, new Date(now)) : '';
  return [value.status, short || !since ? 'I dvale' : `I dvale siden ${since}`].filter(Boolean).join(' · ');
}

// When the shown values were last reported by the car: "Opdateret: 17.40".
export function vehicleUpdatedLabel(value: unknown, now = new Date()): string {
  // Only Tesla's own block timestamps are the car's real update time, not HA re-reports.
  if (!isVehicleObservation(value) || value.source !== 'tesla_fleet_snapshot') return '';
  const times = [value.observedAt, ...Object.values(value.fieldObservedAt ?? {})].filter(
    time => Number.isFinite(time) && time > 0 && time * 1000 <= now.getTime() + 60000,
  );
  if (!times.length) return '';
  return updatedLabel(Math.max(...times) * 1000, now);
}

const fixtureSeat = (value: unknown) => (integer(value, 0, 3) ? value : 0);

export function vehicleModel(value: unknown): VehicleModel {
  // Only the admitted passive HA shape is accepted. Other remote shapes fail closed even when they contain plausible
  // battery/lock/temperature fields.
  if (isVehicleObservation(value)) {
    return {
      ...(value as VehicleObservation),
      status: vehicleStatus(value),
      shortStatus: vehicleStatus(value, Date.now(), {short: true}),
    } as unknown as VehicleModel;
  }
  if (get(value, 'kind') !== 'vehicle' || get(value, 'mode') !== 'fixture') return unconnectedVehicleModel();
  const v = value as Loose;
  const endsAt = get(get(v, 'charging'), 'endsAt');
  const base = vehicleFixture({
    charging: get(v, 'fixtureCase') === 'charging',
    now: finite(endsAt) ? (endsAt - 2700) * 1000 : Date.now(),
    controls: get(v, 'controlsPreview') === true,
  });
  if (!base.controlsPreview) return base;
  const lockedValue = get(v, 'locked');
  const locked = typeof lockedValue === 'boolean' ? lockedValue : true;
  const access = {rearTrunk: get(get(v, 'access'), 'rearTrunk') === 'open' ? 'open' : 'closed'};
  const climate = get(v, 'climate');
  const heat = get(climate, 'status') === 'heat';
  const charging = base.charging.status === 'charging';
  const connectionState =
    get(v, 'connectionState') === 'online' || heat || charging
      ? 'online'
      : get(v, 'connectionState') === 'asleep'
        ? 'asleep'
        : null;
  const status =
    access.rearTrunk === 'open'
      ? `Bagagerum åbent · ${locked ? 'Låst' : 'Ulåst'}`
      : charging
        ? 'Lader'
        : `${connectionState === 'asleep' ? 'I dvale · ' : ''}${locked ? 'Låst' : 'Ulåst'}`;
  const target = get(climate, 'targetTemperatureC');
  const seats = get(climate, 'seats');
  const limit = get(get(v, 'charging'), 'limitPercent');
  const revision = get(v, 'revision');
  return {
    ...base,
    status,
    access,
    connectionState,
    revision: Number.isSafeInteger(revision) ? (revision as number) : 1,
    locked,
    climate: {
      ...base.climate,
      status: heat ? 'heat' : 'off',
      targetTemperatureC: integer(target, 16, 30) ? target : 21,
      defrost: heat && get(climate, 'defrost') === true,
      seats: {driver: fixtureSeat(get(seats, 'driver')), passenger: fixtureSeat(get(seats, 'passenger'))},
    },
    charging: {...base.charging, limitPercent: integer(limit, 50, 100) ? limit : 80},
  };
}

export interface PreviewEvent {
  action: string;
  value?: unknown;
  confirmed?: boolean;
  revision?: number | undefined;
  seat?: string;
  temperatureC?: number | null | undefined;
  seats?: FixtureSeats | undefined;
  setting?: string;
}

const CONFIRMED_SETTINGS = ['climate', 'defrost', 'temperature', 'seat-heat', 'climate-settings'];
export const validSeatLevels = (seats: unknown): seats is FixtureSeats =>
  !!seats &&
  typeof seats === 'object' &&
  !Array.isArray(seats) &&
  Object.keys(seats).length === 2 &&
  Object.hasOwn(seats, 'driver') &&
  Object.hasOwn(seats, 'passenger') &&
  (['driver', 'passenger'] as const).every(key => integer((seats as Record<string, unknown>)[key], 0, 3));

// Explicit preview control state. Observed HA data never enters this reducer.
export function vehiclePreviewAction<T>(value: T, event: PreviewEvent = {action: ''}): T {
  const {action, value: amount, confirmed = false, revision, seat, temperatureC, seats} = event;
  if (
    get(value, 'kind') !== 'vehicle' ||
    get(value, 'mode') !== 'fixture' ||
    get(value, 'controlsPreview') !== true ||
    !Number.isSafeInteger(revision) ||
    (revision as number) < 0 ||
    revision !== get(value, 'revision')
  ) {
    return value;
  }
  const model = vehicleModel(value);
  const climate = model.climate;
  const currentSeats = climate.seats ?? {driver: 0, passenger: 0};
  let patch: Partial<VehicleModel> | undefined;
  if (CONFIRMED_SETTINGS.includes(action) && confirmed !== true) return value;
  // Seat heat levels remain selected settings; stopping cabin climate does not assert an undocumented seat-heater
  // side effect. Defrost requires cabin heat.
  if (action === 'climate') {
    // New callers send explicit intent. The confirmed legacy toggle remains for existing internal consumers;
    // malformed explicit values never become toggles.
    const enabled = Object.hasOwn(event, 'value') ? amount : climate.status === 'off';
    if (typeof enabled === 'boolean' && (enabled !== (climate.status === 'heat') || climate.defrost)) {
      patch = {climate: {...climate, status: enabled ? 'heat' : 'off', defrost: false}};
    }
  }
  if (action === 'defrost' && typeof amount === 'boolean' && amount !== climate.defrost) {
    patch = {climate: {...climate, defrost: amount, status: amount ? 'heat' : climate.status}};
  }
  if (
    action === 'seat-heat' &&
    (seat === 'driver' || seat === 'passenger') &&
    integer(amount, 0, 3) &&
    amount !== currentSeats[seat]
  ) {
    const startsClimate = amount > 0 && climate.status === 'off';
    if (!startsClimate || confirmed) {
      patch = {
        climate: {...climate, status: startsClimate ? 'heat' : climate.status, seats: {...currentSeats, [seat]: amount}},
      };
    }
  }
  if (action === 'temperature' && integer(amount, 16, 30) && amount !== climate.targetTemperatureC) {
    patch = {climate: {...climate, targetTemperatureC: amount}};
  }
  if (action === 'climate-settings' && integer(temperatureC, 16, 30) && validSeatLevels(seats)) {
    const changed =
      temperatureC !== climate.targetTemperatureC ||
      seats.driver !== currentSeats.driver ||
      seats.passenger !== currentSeats.passenger;
    if (changed) {
      patch = {
        climate: {
          ...climate,
          targetTemperatureC: temperatureC,
          seats: {driver: seats.driver, passenger: seats.passenger},
          status: seats.driver > 0 || seats.passenger > 0 ? 'heat' : climate.status,
        },
      };
    }
  }
  if (action === 'charge-limit' && integer(amount, 50, 100)) patch = {charging: {...model.charging, limitPercent: amount}};
  if (action === 'lock' && typeof amount === 'boolean' && amount !== model.locked && (amount || confirmed)) {
    patch = {locked: amount};
  }
  if (
    action === 'rear-trunk' &&
    confirmed &&
    (amount === 'open' || amount === 'closed') &&
    amount !== model.access?.rearTrunk
  ) {
    patch = {access: {...model.access, rearTrunk: amount}};
  }
  return patch
    ? (vehicleModel({...model, ...patch, connectionState: 'online', revision: (model.revision ?? 0) + 1}) as T)
    : value;
}

export interface ChargeContext {
  connected?: boolean;
  scope?: string;
  sourceScope?: string | null;
  readGranted?: boolean;
  visible?: boolean;
  suppress?: boolean;
}

export interface ChargePresentation {
  scope: string | undefined;
  eligible: boolean;
  observedAt: number | undefined;
  percent: number | null | undefined;
  status: string | null | undefined;
  cancel: boolean;
  cue: boolean;
}

// A finite display acknowledgement of a new passive source observation, never simulated charging progress. Both
// vehicle surfaces (the screen and the Home card) use this predicate.
export function vehicleChargeUpdate(
  previous: ChargePresentation | null | undefined,
  model: unknown,
  {connected = false, scope = '', sourceScope = '', readGranted = false, visible = true, suppress = false}:
    ChargeContext = {},
): ChargePresentation {
  const observation = isVehicleObservation(model) ? model : null;
  const percent = get(model, 'batteryPercent') as number | null | undefined;
  const status = get(get(model, 'charging'), 'status') as string | null | undefined;
  const observedAt = get(model, 'observedAt') as number | undefined;
  const eligible =
    connected === true &&
    readGranted === true &&
    typeof scope === 'string' &&
    scope.length > 0 &&
    scope === sourceScope &&
    visible === true &&
    !!observation &&
    observation.stale !== true &&
    !['batteryPercent', 'charging.status'].some(name => (observation.historicalFields ?? []).includes(name)) &&
    finite(observedAt) &&
    finite(percent) &&
    percent >= 0 &&
    percent <= 100;
  const sameScope = previous?.scope === scope;
  const retain =
    sameScope && finite(previous.observedAt) && (!finite(observedAt) || observedAt <= previous.observedAt);
  return {
    scope,
    eligible,
    observedAt: retain ? previous.observedAt : observedAt,
    percent: retain ? previous.percent : percent,
    status: retain ? previous.status : status,
    cancel: !eligible || status !== 'charging' || !sameScope,
    cue:
      !suppress &&
      eligible &&
      previous?.eligible === true &&
      sameScope &&
      (observedAt as number) > (previous.observedAt as number) &&
      status === 'charging' &&
      (previous.status !== 'charging' || percent !== previous.percent),
  };
}

export interface VehicleFact {
  id: string;
  label: string;
  value: string;
  stale: boolean;
}

// Overview tile facts. Charge power and finish time only while the car is charging: a stopped or unknown charge
// shows a plain battery/range tile, never "0 kW" (B7).
export function vehicleOverviewFacts(vehicle: unknown): VehicleFact[] {
  if (!vehicle || get(vehicle, 'mode') === 'unconnected') return [];
  const charging = get(get(vehicle, 'charging'), 'status') === 'charging';
  const battery = get(vehicle, 'batteryPercent');
  const range = get(vehicle, 'rangeKm');
  const power = get(get(vehicle, 'charging'), 'powerKw');
  const endsAt = get(get(vehicle, 'charging'), 'endsAt');
  const cabin = get(get(vehicle, 'climate'), 'temperatureC');
  const locked = get(vehicle, 'locked');
  const rows: [string, string, string | null][] = [
    ['battery', 'Batteri', finite(battery) ? `${String(Math.round(battery))} %` : null],
    ['range', 'Rækkevidde', finite(range) ? `${String(Math.round(range))} km` : null],
    ['power', 'Ladeeffekt', charging && finite(power) ? `${power.toLocaleString('da-DK')} kW` : null],
    ['ends', 'Opladning færdig', charging && finite(endsAt) ? clock(endsAt) : null],
    ['temperature', 'Kabinetemperatur', finite(cabin) ? `${cabin.toLocaleString('da-DK')}°` : null],
    ['lock', 'Lås', typeof locked === 'boolean' ? (locked ? 'Låst' : 'Ulåst') : null],
  ];
  return rows.flatMap(([id, label, value]) => (value === null ? [] : [{id, label, value, stale: false}]));
}

export interface VehicleRailResource {
  id: 'vehicle';
  target: 'vehicle';
  kind: 'vehicle';
  title: 'Tesla';
  status: 'stale' | 'charging';
  resourceStatus: 'stale' | 'charging';
  detail: string;
  value: string;
  stale: boolean;
  observedAt: number | null;
  exampleOnly: boolean;
  facts: VehicleFact[];
  actions: [];
}

// Ro reuses the existing passive resource tile. Retained charging is explicitly last-known; neither the tile nor its
// optional facts grants command authority.
export function vehicleRailPresentation(
  value: unknown,
  {
    live = true,
    connected = false,
    readGranted = false,
    scope = '',
    sourceScope = '',
  }: {live?: boolean; connected?: boolean; readGranted?: boolean; scope?: string; sourceScope?: string | null} = {},
): VehicleRailResource | null {
  const observed = isVehicleObservation(value);
  const local =
    live === false &&
    get(value, 'kind') === 'vehicle' &&
    get(value, 'mode') === 'fixture' &&
    get(value, 'exampleOnly') === true &&
    get(value, 'fixtureCase') === 'charging' &&
    scope === 'local' &&
    sourceScope === 'local';
  const bound = typeof scope === 'string' && scope.length > 0 && scope === sourceScope;
  if (!bound || readGranted !== true || (!observed && !local) || (local && connected !== true)) return null;
  const model = vehicleModel(value);
  if (model.charging.status !== 'charging') return null;
  const stale =
    observed &&
    (model.stale === true ||
      connected !== true ||
      ['batteryPercent', 'charging.status', 'charging.powerKw'].some(name =>
        (model.historicalFields ?? []).includes(name),
      ));
  const facts: VehicleFact[] = [];
  const power = model.charging.powerKw;
  const endsAt = model.charging.endsAt;
  if (finite(power) && power >= 0) {
    facts.push({id: 'power', label: 'Ladeeffekt', value: `${power.toLocaleString('da-DK')} kW`, stale});
  }
  if (finite(endsAt) && endsAt >= 0) facts.push({id: 'ends', label: 'Opladning færdig', value: clock(endsAt), stale});
  const battery = model.batteryPercent;
  return {
    id: 'vehicle',
    target: 'vehicle',
    kind: 'vehicle',
    title: 'Tesla',
    status: stale ? 'stale' : 'charging',
    resourceStatus: stale ? 'stale' : 'charging',
    detail: stale ? vehicleUpdatedLabel(model) || 'Lader' : 'Lader',
    value: finite(battery) && battery >= 0 && battery <= 100 ? `${String(Math.round(battery))} %` : '',
    stale,
    observedAt: observed ? (model.observedAt ?? null) : null,
    exampleOnly: local,
    facts,
    actions: [],
  };
}
