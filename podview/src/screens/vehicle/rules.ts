// Bil's command rules, shared by the store (store.ts) and the presentation (presentation.ts): which live action a
// control means, what each live action expects to observe, when an observation is fresh enough to count as the
// car's answer, and the Danish texts for outcomes. Pure data and functions; no state.
import type {VehicleModel} from './model';

export type Family = 'trunk' | 'lock' | 'climate';
export type NoteKey = 'access' | 'climate';
export type Seat = 'driver' | 'passenger';
export type LiveAction = 'lock' | 'unlock' | 'climateOn' | 'climateOff';

// The controls a command can start from. A seat level is `seat:<seat>:<level 0-3>`.
export type ButtonControl =
  | 'climateToggle'
  | 'temperatureDown'
  | 'temperatureUp'
  | LiveAction
  | 'lockButton'
  | 'rearTrunkButton'
  | 'defrostButton';
export type SeatControl = `seat:${Seat}:${number}`;
export type Control = ButtonControl | SeatControl;
// What a press asks of the store: a control, or the confirmation dialog's two actions.
export type PressControl = Control | 'lockCancel' | 'lockConfirm';

export const SEATS: readonly Seat[] = ['driver', 'passenger'];
export const LIVE_ACTIONS: readonly LiveAction[] = ['lock', 'unlock', 'climateOn', 'climateOff'];
export const LEVELS = ['Fra', 'Lav', 'Mellem', 'Høj'];
export const SEAT_LEVELS = ['off', 'low', 'medium', 'high'];
export const SEAT_NAMES: Record<string, string> = {off: 'Fra', low: 'Lav', medium: 'Mellem', high: 'Høj'};
export const CLIMATE_NAMES: Record<string, string> = {
  off: 'Slukket',
  heat: 'Varmer',
  cool: 'Køler',
  auto: 'Automatisk',
  heat_cool: 'Varme/køling',
  fan_only: 'Ventilation',
  dry: 'Affugtning',
};
export const PRIOR_NAMES: Record<string, string> = {
  temperature: 'ændre temperaturen',
  defrost: 'betjene afrimningen',
  driverSeat: 'ændre førersædevarmen',
  passengerSeat: 'ændre passagersædevarmen',
  trunk: 'betjene bagagerummet',
};
export const UNLOCK_TITLE = 'Lås bilen op?';
export const UNLOCK_CONSEQUENCE = 'Bilen låses op. Den låses ikke automatisk igen herfra.';
export const UNKNOWN_OUTCOME = 'Udfald ukendt · kontrollér bilen.';

export const seatControl = (seat: Seat, level: number): SeatControl => `seat:${seat}:${level}`;
export const isSeatControl = (control: Control | null | undefined): control is SeatControl =>
  typeof control === 'string' && control.startsWith('seat:');
// A button that names its action (its label shows the command's progress); the icon buttons and the switch show
// progress themselves.
export const namedButton = (control: Control | null | undefined) =>
  !!control && !isSeatControl(control) && !['temperatureDown', 'temperatureUp', 'climateToggle'].includes(control);

export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const da = (value: number) => value.toLocaleString('da-DK');

export const activeClimateModes = new Set(['heat', 'cool', 'auto', 'heat_cool', 'fan_only', 'dry']);
export const liveClimateActive = (model: VehicleModel | undefined) =>
  !!model &&
  !model.stale &&
  !(model.historicalFields ?? []).includes('climate.status') &&
  activeClimateModes.has(model.climate.status ?? '');

// Lock and climate on/off are idempotent: an older or unknown HA value never blocks them.
export const idempotentActions = new Set(['lock', 'unlock', 'climateOn', 'climateOff']);
export const climateDependents = new Set(['temperature', 'defrostOn', 'defrostOff', 'driverSeatHeat',
  'passengerSeatHeat']);
export const CLIMATE_ACTIONS = ['climateOn', 'climateOff', 'temperature', 'defrostOn', 'defrostOff', 'driverSeatHeat',
  'passengerSeatHeat'];
export const TEMPERATURE_FIELDS = ['climate.status', 'climate.targetTemperatureC', 'climate.minTemperatureC',
  'climate.maxTemperatureC', 'climate.temperatureStepC'];
export const ACTION_FIELDS: Record<string, string[]> = {
  lock: ['locked'],
  unlock: ['locked'],
  rearTrunkToggle: ['trunk'],
  climateOn: ['climate.status'],
  climateOff: ['climate.status'],
  temperature: TEMPERATURE_FIELDS,
  defrostOn: ['climate.defrost'],
  defrostOff: ['climate.defrost'],
  driverSeatHeat: ['climate.driverSeatHeat'],
  passengerSeatHeat: ['climate.passengerSeatHeat'],
};

export const actionFamily = (action: string): Family =>
  action === 'rearTrunkToggle' ? 'trunk' : action === 'lock' || action === 'unlock' ? 'lock' : 'climate';
export const actionNote = (action: string): NoteKey =>
  ['lock', 'unlock', 'rearTrunkToggle'].includes(action) ? 'access' : 'climate';

export const historicalField = (model: VehicleModel, field: string, connected: boolean | undefined) =>
  model.stale === true || connected === false || (model.historicalFields ?? []).includes(field);

export const fieldValue = (model: VehicleModel, field: string): unknown => {
  if (field === 'trunk') return model.access?.rearTrunk;
  let value: unknown = model;
  for (const key of field.split('.')) {
    value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  }
  return value;
};

// HA's clock (last_changed) and the screen's clock can differ by a few seconds. The field must still be newer than
// what was shown before the tap.
export const CLOCK_SKEW_S = 30;

type Args = Record<string, unknown>;
type Text = string | ((args: Args) => string);
export const text = (value: Text | undefined, args: Args) => (typeof value === 'function' ? value(args) : value);
const opening = (args: Args) => args.direction === 'open';

// What a live action expects: the observed field, its wished value, how it is read, the progress and the
// confirmation texts.
export interface Effect {
  field: string;
  wanted: (args: Args) => unknown;
  read: (model: VehicleModel) => unknown;
  label: Text;
  confirmation: Text;
}
const effect = (
  field: string,
  wanted: Effect['wanted'],
  read: Effect['read'],
  label: Text,
  confirmation: Text,
): Effect => ({field, wanted, read, label, confirmation});

export const LIVE_EFFECTS: Record<string, Effect> = {
  lock: effect('locked', () => true, model => model.locked, 'Låser…', 'Bilen er låst.'),
  unlock: effect('locked', () => false, model => model.locked, 'Låser op…', 'Bilen er låst op.'),
  rearTrunkToggle: effect(
    'trunk',
    args => (opening(args) ? 'open' : 'closed'),
    model => model.access?.rearTrunk,
    args => (opening(args) ? 'Åbner bagagerum…' : 'Lukker bagagerum…'),
    args => (opening(args) ? 'Bagagerummet er åbent.' : 'Bagagerummet er lukket.'),
  ),
  climateOn: effect(
    'climate.status',
    () => true,
    model => activeClimateModes.has(model.climate.status ?? '') || undefined,
    'Tænder…',
    'Klimaet er tændt.',
  ),
  climateOff: effect(
    'climate.status',
    () => true,
    model => model.climate.status === 'off' || undefined,
    'Slukker…',
    'Klimaet er slukket.',
  ),
  temperature: effect(
    'climate.targetTemperatureC',
    args => args.temperature,
    model => model.climate.targetTemperatureC,
    'Ændrer temperatur…',
    args => `Måltemperaturen er ${(args.temperature as number | undefined)?.toLocaleString('da-DK') ?? ''} °C.`,
  ),
  defrostOn: effect('climate.defrost', () => true, model => model.climate.defrost, 'Afrimer…', 'Afrimningen er tændt.'),
  defrostOff: effect(
    'climate.defrost',
    () => false,
    model => model.climate.defrost,
    'Stopper afrimning…',
    'Afrimningen er slukket.',
  ),
  driverSeatHeat: effect(
    'climate.driverSeatHeat',
    args => args.option,
    model => model.climate.driverSeatHeat,
    'Ændrer sædevarme…',
    'Førerens sædevarme er opdateret.',
  ),
  passengerSeatHeat: effect(
    'climate.passengerSeatHeat',
    args => args.option,
    model => model.climate.passengerSeatHeat,
    'Ændrer sædevarme…',
    'Passagerens sædevarme er opdateret.',
  ),
};

// HA's explicit service error (closed code from the server) in short Danish.
export const ERROR_TEXTS: Record<string, string> = {
  access_denied: 'Home Assistant afviste adgangen til bilen.',
  missing_scope: 'Tesla-forbindelsen mangler tilladelse til kommandoer.',
  wake_failed: 'Bilen kunne ikke vækkes.',
  no_response: 'Bilen svarede ikke.',
  rate_limited: 'Tesla afviser flere kommandoer lige nu · prøv igen senere.',
  refused: 'Bilen afviste kommandoen.',
};

// A fresh observation after the command that contradicts it: what the car did not do.
export const NOT_DONE: Record<string, Text> = {
  lock: 'Bilen låste ikke',
  unlock: 'Bilen låste ikke op',
  rearTrunkToggle: args => (opening(args) ? 'Bagagerummet åbnede ikke' : 'Bagagerummet lukkede ikke'),
  climateOn: 'Bilen tændte ikke klimaet',
  climateOff: 'Bilen slukkede ikke klimaet',
  temperature: 'Bilen ændrede ikke temperaturen',
  defrostOn: 'Bilen tændte ikke afrimningen',
  defrostOff: 'Bilen slukkede ikke afrimningen',
  driverSeatHeat: 'Bilen ændrede ikke sædevarmen',
  passengerSeatHeat: 'Bilen ændrede ikke sædevarmen',
};

// Tesla may refuse remote climate at low battery; HA reports no error then.
const LOW_BATTERY_PERCENT = 15;
export const lowBattery = (model: VehicleModel | undefined) =>
  model?.mode === 'observed' && finite(model.batteryPercent) && model.batteryPercent < LOW_BATTERY_PERCENT
    ? Math.round(model.batteryPercent)
    : null;

export const seatHeat = (model: VehicleModel, seat: Seat) =>
  seat === 'driver' ? model.climate.driverSeatHeat : model.climate.passengerSeatHeat;
