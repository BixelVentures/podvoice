// The vehicle's server payloads, read at the wire with zod:
// - the passive HA observation in the home read (`vehicle`), admitted by vehicleObservation. Only that closed shape
//   is ever car state; an observation never grants a command (actions stay empty).
// - a vehicle control setup (POST …/api/control/setup, podview.control.v1, domain `vehicle`): one task with one
//   option for one action, and the confirmation the user must see (effects, prior unresolved requests, wake, override).
// - the action's arguments: none, or the explicit acknowledgement of prior unresolved requests.
import {z} from 'zod';

// ---- The passive observation ----------------------------------------------------------------------------------------

const admission = Symbol('HA vehicle observation');

export type ClimateStatus = 'off' | 'heat' | 'cool' | 'auto' | 'heat_cool' | 'fan_only' | 'dry';
export type ChargingStatus = 'charging' | 'complete' | 'stopped' | 'disconnected' | 'starting';
export type SeatHeat = 'off' | 'low' | 'medium' | 'high';
export type ConnectionState = 'online' | 'asleep' | 'offline';

export interface VehicleObservation {
  readonly [admission]: true;
  kind: 'vehicle';
  mode: 'observed';
  connectionState: ConnectionState | null;
  connectionSince: number | null;
  historicalFields: string[];
  fieldObservedAt: Record<string, number>;
  stale?: true;
  source: 'home_assistant_state' | 'tesla_fleet_snapshot';
  observedAt: number;
  title: 'Tesla';
  context: string;
  modelName?: 'Model Y';
  status: string;
  batteryPercent: number | null;
  rangeKm: number | null;
  locked: boolean | null;
  charging: {status: ChargingStatus | null; powerKw: number | null; endsAt: number | null};
  climate: {
    status: ClimateStatus | null;
    temperatureC: number | null;
    targetTemperatureC: number | null;
    minTemperatureC: number | null;
    maxTemperatureC: number | null;
    temperatureStepC: 0.5 | null;
    defrost: boolean | null;
    driverSeatHeat: SeatHeat | null;
    passengerSeatHeat: SeatHeat | null;
  };
  access?: {rearTrunk: 'open' | 'closed'};
  history: [];
  actions: [];
}

// Admitted here and nowhere else; a copy ({...observation, stale: true}) stays admitted.
export const isVehicleObservation = (value: unknown): value is VehicleObservation =>
  !!value && typeof value === 'object' && (value as Record<symbol, unknown>)[admission] === true;

const CLIMATE: readonly string[] = ['off', 'heat', 'cool', 'auto', 'heat_cool', 'fan_only', 'dry'];
const CHARGING: readonly string[] = ['charging', 'complete', 'stopped', 'disconnected', 'starting'];
const SEAT_HEAT: readonly string[] = ['off', 'low', 'medium', 'high'];
const ENTITY = /^(sensor|binary_sensor|climate|lock|switch|select|cover)\.[a-z0-9_]+$/;
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;

const finite = (value: unknown, min = 0, max = Infinity): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
const field = (value: unknown, key: string): unknown =>
  value !== null && value !== undefined ? (value as Record<string, unknown>)[key] : undefined;
const oneOf = <T extends string>(value: unknown, allowed: readonly string[]): T | null =>
  typeof value === 'string' && allowed.includes(value) ? (value as T) : null;

const observationSchema = z.looseObject({
  status: z.enum(['observed', 'stale']),
  source: z.enum(['home_assistant_state', 'tesla_fleet_snapshot']),
  observedAt: z.number().min(0),
  entityIds: z.array(z.string().regex(ENTITY)).min(1).max(12).refine(unique),
  data: z.custom<unknown>(value => !!value),
  historicalFields: z.array(z.string()).refine(unique).optional(),
  connection: z.unknown().optional(),
  fieldObservedAt: z.unknown().optional(),
});

// Tesla's charging_state as the Tesla app says it. Disconnected or unknown says nothing about charging; stopped
// (also no_power) is plugged in but not charging.
export function vehicleChargeStatus(state: unknown): string {
  return (
    ({charging: 'Lader', starting: 'Starter opladning', stopped: 'Tilsluttet · lader ikke', complete: 'Opladet'} as
      Record<string, string>)[String(state)] ?? ''
  );
}

// The home read's vehicle block, admitted or null. A shape PodView cannot read is no car.
export function vehicleObservation(value: unknown): VehicleObservation | null {
  const parsed = observationSchema.safeParse(value);
  if (!parsed.success) return null;
  const v = parsed.data;
  const rawConnection = v.connection;
  const state = oneOf<ConnectionState>(field(rawConnection, 'state'), ['online', 'asleep', 'offline']);
  const since = field(rawConnection, 'since');
  const connection = state && (since === null || finite(since) !== null) ? {state, since: since as number | null} : null;
  const d = v.data;
  const charging = oneOf<ChargingStatus>(field(field(d, 'charging'), 'status'), CHARGING);
  const climate = field(d, 'climate');
  const locked = field(d, 'locked');
  const model = field(d, 'modelName') === 'Model Y';
  const trunk = oneOf<'open' | 'closed'>(field(d, 'trunk'), ['open', 'closed']);
  const temperature = (key: string) => finite(field(climate, key), -50, 70);
  const defrost = field(climate, 'defrost');
  return {
    [admission]: true,
    kind: 'vehicle',
    mode: 'observed',
    connectionState: connection?.state ?? null,
    connectionSince: connection?.since ?? null,
    historicalFields: v.historicalFields ?? [],
    fieldObservedAt: (v.fieldObservedAt || {}) as Record<string, number>,
    ...(v.status === 'stale' ? {stale: true as const} : {}),
    source: v.source,
    observedAt: v.observedAt,
    title: 'Tesla',
    context: model ? 'Model Y' : 'Home Assistant',
    ...(model ? {modelName: 'Model Y' as const} : {}),
    status:
      vehicleChargeStatus(charging) || (typeof locked === 'boolean' ? (locked ? 'Låst' : 'Ulåst') : 'Status ukendt'),
    batteryPercent: finite(field(d, 'batteryPercent'), 0, 100),
    rangeKm: finite(field(d, 'rangeKm')),
    locked: typeof locked === 'boolean' ? locked : null,
    charging: {
      status: charging,
      powerKw: finite(field(field(d, 'charging'), 'powerKw')),
      endsAt: v.status === 'observed' && charging === 'charging' ? finite(field(field(d, 'charging'), 'endsAt')) : null,
    },
    climate: {
      status: oneOf<ClimateStatus>(field(climate, 'status'), CLIMATE),
      temperatureC: temperature('temperatureC'),
      targetTemperatureC: temperature('targetTemperatureC'),
      minTemperatureC: temperature('minTemperatureC'),
      maxTemperatureC: temperature('maxTemperatureC'),
      temperatureStepC: field(climate, 'temperatureStepC') === 0.5 ? 0.5 : null,
      defrost: typeof defrost === 'boolean' ? defrost : null,
      driverSeatHeat: oneOf<SeatHeat>(field(climate, 'driverSeatHeat'), SEAT_HEAT),
      passengerSeatHeat: oneOf<SeatHeat>(field(climate, 'passengerSeatHeat'), SEAT_HEAT),
    },
    ...(trunk ? {access: {rearTrunk: trunk}} : {}),
    history: [],
    actions: [],
  };
}

// ---- The control setup ----------------------------------------------------------------------------------------------

export const VEHICLE_ACTIONS = ['lock', 'unlock', 'climateOn', 'climateOff', 'temperature', 'defrostOn', 'defrostOff',
  'driverSeatHeat', 'passengerSeatHeat', 'rearTrunkToggle'] as const;
export type VehicleAction = (typeof VEHICLE_ACTIONS)[number];
export const isVehicleAction = (value: unknown): value is VehicleAction =>
  (VEHICLE_ACTIONS as readonly unknown[]).includes(value);

const PRIOR_VALUES: Record<string, readonly string[]> = {
  access: ['locked', 'unlocked'],
  climate: ['on', 'off'],
  defrost: ['on', 'off'],
  driverSeat: ['off', 'low', 'medium', 'high'],
  passengerSeat: ['off', 'low', 'medium', 'high'],
  trunk: ['actuate'],
};
const PRIOR_KEYS = ['access', 'climate', 'temperature', 'defrost', 'driverSeat', 'passengerSeat', 'trunk'];
const EFFECT_FAMILIES = ['access', 'climate', 'temperature', 'defrost', 'driverSeat', 'passengerSeat', 'trunk'];
const text = (value: unknown, max = 160): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

export type PriorUnresolved = Record<string, string[]> & {access: string[]; climate: string[]};

// Earlier requests the owner has not seen resolved, by family; each value as the owner names it.
const priorUnresolved = z.custom<PriorUnresolved>(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rows = Object.entries(value as Record<string, unknown>);
  if (!['access', 'climate'].every(key => Array.isArray((value as Record<string, unknown>)[key]))) return false;
  return rows.every(
    ([key, values]) =>
      PRIOR_KEYS.includes(key) &&
      Array.isArray(values) &&
      values.length <= 101 &&
      unique(values) &&
      values.every(
        item =>
          text(item, 24) &&
          (key === 'temperature'
            ? /^(?:[0-9]|[1-4][0-9]|50)(?:\.0|\.5)?$/.test(item)
            : (PRIOR_VALUES[key] ?? []).includes(item)),
      ),
  );
});

const confirmationSchema = z
  .strictObject({
    action: z.enum(VEHICLE_ACTIONS),
    label: z.string().min(1).max(120),
    args: z.unknown().optional(),
    effects: z.unknown().optional(),
    requiresConfirmation: z.boolean(),
    nativeWakePossible: z.literal(true),
    priorUnresolved,
    riskRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    requiresOverride: z.boolean(),
  })
  .refine(c => !c.requiresOverride || c.requiresConfirmation);

const taskSchema = z.strictObject({
  ok: z.literal(true),
  schema: z.literal('podview.control.v1'),
  roomId: z.string(),
  bootId: z.string(),
  taskId: z.string().regex(/^control:[a-f0-9]{32}$/),
  revision: z.literal(1),
  expiresAt: z.number(),
  domain: z.literal('vehicle'),
  options: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-f0-9]{24}$/),
        label: z.string().min(1).max(120),
        action: z.string().min(1).max(80),
        argsSchema: z.strictObject({kind: z.literal('none')}),
      }),
    )
    .length(1),
  setup: z.strictObject({confirmation: confirmationSchema}),
});

export type Effect = [string, string];

export interface VehicleConfirmation {
  action: VehicleAction;
  label: string;
  args: Record<string, unknown>;
  effects?: Effect[];
  requiresConfirmation: boolean;
  nativeWakePossible: true;
  priorUnresolved: PriorUnresolved;
  riskRevision: number;
  requiresOverride: boolean;
}

export interface VehicleTask {
  roomId: string;
  bootId: string;
  taskId: string;
  revision: 1;
  expiresAt: number;
  domain: 'vehicle';
  options: [{id: string; label: string; action: VehicleAction; argsSchema: {kind: 'none'}}];
  mapName: null;
  volume: null;
  confirmation: VehicleConfirmation;
}

const exactKeys = (value: unknown, keys: string[]) =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

// The effects the owner must name for an action, in order.
function expectedEffects(action: VehicleAction, args: Record<string, unknown>): Effect[] {
  const option = String(args.option);
  const seat = (family: string): Effect[] => [[family, option], ...(option === 'off' ? [] : [['climate', 'on'] as Effect])];
  switch (action) {
    case 'lock':
      return [['access', 'locked']];
    case 'unlock':
      return [['access', 'unlocked']];
    case 'climateOn':
      return [['climate', 'on']];
    case 'climateOff':
      return [['climate', 'off']];
    case 'temperature':
      return [['temperature', String(args.temperature)]];
    case 'defrostOn':
      return [['defrost', 'on'], ['climate', 'on']];
    case 'defrostOff':
      return [['defrost', 'off'], ['climate', 'on'], ['climate', 'off']];
    case 'driverSeatHeat':
      return seat('driverSeat');
    case 'passengerSeatHeat':
      return seat('passengerSeat');
    case 'rearTrunkToggle':
      return [['trunk', 'actuate']];
  }
}

const validArgs = (action: VehicleAction, args: Record<string, unknown>) => {
  if (action === 'temperature') {
    const value = args.temperature;
    return exactKeys(args, ['temperature']) && typeof value === 'number' && Number.isFinite(value) &&
      value * 2 === Math.round(value * 2);
  }
  if (action === 'driverSeatHeat' || action === 'passengerSeatHeat') {
    return exactKeys(args, ['option']) && SEAT_HEAT.includes(args.option as string);
  }
  if (action === 'rearTrunkToggle') return exactKeys(args, ['direction']) && ['open', 'close'].includes(args.direction as string);
  return Object.keys(args).length === 0;
};

const validEffects = (effects: unknown): effects is Effect[] =>
  Array.isArray(effects) &&
  effects.length > 0 &&
  effects.length <= 3 &&
  effects.every(
    effect => Array.isArray(effect) && effect.length === 2 && EFFECT_FAMILIES.includes(effect[0]) && text(effect[1], 24),
  );

// One vehicle setup for the current boot and room, valid for at most 15 s, or null. Nothing PodView cannot read
// exactly becomes a command.
export function readVehicleTask(
  raw: unknown,
  snapshot: {bootId?: unknown; roomId?: unknown},
  now = Date.now(),
): VehicleTask | null {
  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) return null;
  const value = parsed.data;
  const c = value.setup.confirmation;
  const [option] = value.options;
  if (
    !option ||
    value.roomId !== snapshot.roomId ||
    value.bootId !== snapshot.bootId ||
    !Number.isFinite(value.expiresAt) ||
    value.expiresAt * 1000 <= now ||
    value.expiresAt * 1000 > now + 15000 ||
    option.action !== c.action ||
    option.label !== c.label
  ) {
    return null;
  }
  const raws = (raw as {setup: {confirmation: Record<string, unknown>}}).setup.confirmation;
  const needsBoth = !['lock', 'unlock', 'climateOn', 'climateOff'].includes(c.action);
  if (needsBoth && (!Object.hasOwn(raws, 'effects') || !Object.hasOwn(raws, 'args'))) return null;
  if (c.effects !== undefined && !validEffects(c.effects)) return null;
  const args = (c.args ?? {}) as Record<string, unknown>;
  if (!args || typeof args !== 'object' || Array.isArray(args) || !validArgs(c.action, args)) return null;
  if (c.effects !== undefined) {
    const expected = expectedEffects(c.action, args);
    const effects = c.effects as Effect[];
    if (
      effects.length !== expected.length ||
      effects.some(([family, value], index) => {
        const want = expected[index];
        if (!want) return true;
        return family !== want[0] || (family === 'temperature' ? Number(value) !== args.temperature : value !== want[1]);
      })
    ) {
      return null;
    }
  }
  const prior = Object.fromEntries(
    Object.entries(c.priorUnresolved).map(([key, values]) => [key, [...values]]),
  ) as PriorUnresolved;
  const confirmation: VehicleConfirmation = {
    action: c.action,
    label: c.label,
    args: {...args},
    ...(c.effects !== undefined ? {effects: c.effects as Effect[]} : {}),
    requiresConfirmation: c.requiresConfirmation,
    nativeWakePossible: true,
    priorUnresolved: prior,
    riskRevision: c.riskRevision,
    requiresOverride: c.requiresOverride,
  };
  return {
    roomId: value.roomId,
    bootId: value.bootId,
    taskId: value.taskId,
    revision: 1,
    expiresAt: value.expiresAt,
    domain: 'vehicle',
    options: [{id: option.id, label: option.label, action: c.action, argsSchema: {kind: 'none'}}],
    mapName: null,
    volume: null,
    confirmation,
  };
}

// The action's arguments: the explicit acknowledgement when the owner requires an override, else none. An expired
// task has no arguments (null): it is never sent.
export function vehicleActionArgs(
  task: VehicleTask,
  now = Date.now(),
): {acknowledgePriorUnresolved: true} | Record<string, never> | null {
  if (task.expiresAt * 1000 <= now) return null;
  return task.confirmation.requiresOverride ? {acknowledgePriorUnresolved: true} : {};
}

// The owner's receipt (the transport has checked its request id and shape). Anything else is UNKNOWN: never resent.
const receiptSchema = z.looseObject({
  ok: z.boolean().optional(),
  outcome: z.string().optional(),
  requestId: z.string().optional(),
  vehicleError: z.enum(['access_denied', 'missing_scope', 'wake_failed', 'no_response', 'rate_limited', 'refused'])
    .optional()
    .catch(undefined),
});
export type VehicleReceipt = z.infer<typeof receiptSchema>;

export function readVehicleReceipt(value: unknown): {
  status: 'accepted' | 'failed' | 'unknown';
  requestId: string | undefined;
  error: string | undefined;
} {
  const receipt = receiptSchema.safeParse(value).data;
  const status =
    receipt?.outcome === 'accepted' && receipt.ok === true
      ? 'accepted'
      : receipt?.outcome === 'rejected' && receipt.ok === false
        ? 'failed'
        : 'unknown';
  return {status, requestId: receipt?.requestId, error: receipt?.vehicleError};
}
